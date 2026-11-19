/**
 * rapportSav.service.js — rapport d'intervention SAV (fiche SAV → PDF archivé → e-mail).
 * Spec : docs/superpowers/specs/2026-11-19-rapport-intervention-sav-design.md
 *
 * - `getPassages` : RDV de la carte et leurs techniciens (date et intervenants proposés).
 * - `archiver`    : PDF dans le dossier `interventions`, puis trace et « travaux réalisés » sur la carte.
 * - `envoyer`     : edge `sav-report-send` (elle relit la carte et dérive le chemin elle-même).
 * - `noterEnvoi`  : mention « envoyé le … à … » sur la carte après un envoi réussi.
 *
 * `interventions.metadata` est relu en base avant chaque écriture : la fiche ouverte peut porter
 * une copie ancienne, et d'autres clés y vivent.
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { buildInterventionReportPath } from '@/lib/interventionStoragePath';
import { RAPPORT_SAV_METADATA_KEY } from '@/lib/rapportSav';
import { traceRapport, traceEnvoi } from '@/lib/rapportSavModel';
import { storageService } from './storage.service';

const BUCKET = 'interventions';

/** Relit `metadata`, y pose la trace, écrit. Lève si la carte n'est pas modifiable (0 ligne). */
async function ecrireTrace(interventionId, fabriquer, autresChamps = {}) {
  const { data: carte, error: lectureError } = await supabase
    .from('majordhome_interventions')
    .select('id, metadata')
    .eq('id', interventionId)
    .maybeSingle();
  if (lectureError) throw lectureError;
  if (!carte) throw new Error('Demande SAV introuvable');

  const metadata = carte.metadata && typeof carte.metadata === 'object' ? carte.metadata : {};
  const trace = fabriquer(metadata[RAPPORT_SAV_METADATA_KEY] || null);
  const { data: ecrite, error } = await supabase
    .from('majordhome_interventions')
    .update({ ...autresChamps, metadata: { ...metadata, [RAPPORT_SAV_METADATA_KEY]: trace } })
    .eq('id', interventionId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!ecrite) throw new Error('La carte n’a pas pu être mise à jour (droits insuffisants ?)');
  return trace;
}

export const rapportSavService = {
  /**
   * RDV non annulés de la carte, avec leurs techniciens.
   * @param {string} interventionId
   * @returns {Promise<{ data: Array<{ id: string, scheduled_date: string, status: string, technician_ids: string[] }>|null, error: any }>}
   */
  async getPassages(interventionId) {
    return withErrorHandling(async () => {
      const { data: rdvs, error } = await supabase
        .from('majordhome_appointments')
        .select('id, scheduled_date, status')
        .eq('intervention_id', interventionId)
        .not('status', 'in', '(cancelled,no_show)');
      if (error) throw error;
      if (!rdvs?.length) return [];

      // 2ᵉ requête mergée en mémoire : la vue des RDV reste un miroir simple.
      const { data: liens, error: liensError } = await supabase
        .from('majordhome_appointment_technicians')
        .select('appointment_id, technician_id')
        .in('appointment_id', rdvs.map((r) => r.id));
      if (liensError) throw liensError;
      const parRdv = new Map();
      for (const l of liens || []) {
        if (!parRdv.has(l.appointment_id)) parRdv.set(l.appointment_id, []);
        parRdv.get(l.appointment_id).push(l.technician_id);
      }
      return rdvs.map((r) => ({ ...r, technician_ids: parRdv.get(r.id) || [] }));
    }, 'rapportSav.getPassages');
  },

  /**
   * Archive le PDF (un fichier par carte, remplacé) puis note la trace et les travaux sur la carte.
   * @param {object} p
   * @param {string} p.orgId  org CORE
   * @param {{ id: string, project_id: string }} p.carte
   * @param {object} p.contenu  cf. rapportSavModel.contenuInitial
   * @param {Blob} p.blob
   * @param {string|null} [p.userId]
   * @returns {Promise<{ data: { path: string, trace: object }|null, error: any }>}
   */
  async archiver({ orgId, carte, contenu, blob, userId = null }) {
    return withErrorHandling(async () => {
      const path = buildInterventionReportPath({ orgId, projectId: carte.project_id, interventionId: carte.id });
      const { error: depotError } = await storageService.uploadFile(BUCKET, path, blob, { upsert: true, contentType: 'application/pdf' });
      if (depotError) throw new Error(`archivage impossible : ${depotError.message || 'refusé'}`);

      const trace = await ecrireTrace(
        carte.id,
        () => traceRapport({ path, contenu, userId, maintenant: new Date().toISOString() }),
        { work_performed: String(contenu.travaux || '').trim() },
      );
      return { path, trace };
    }, 'rapportSav.archiver');
  },

  /** @param {string} path */
  async getUrl(path) {
    const { url, error } = await storageService.getSignedUrl(BUCKET, path);
    return { data: url || null, error: error || (url ? null : new Error('Rapport introuvable')) };
  },

  /**
   * Envoie le rapport archivé au client de la carte. Résout avec `{ to }` ; l'erreur porte `code`
   * (cf. RAPPORT_SAV_CODES).
   * @param {string} orgId
   * @param {string} interventionId
   */
  async envoyer(orgId, interventionId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.functions.invoke('sav-report-send', {
        body: { org_id: orgId, intervention_id: interventionId },
      });
      if (error) {
        // Fonction pas encore déployée (404) : à dire tel quel, ce n'est pas une panne.
        const err = new Error(error.message || 'envoi impossible');
        err.code = error.context?.status === 404 ? 'envoi_pas_en_service' : null;
        throw err;
      }
      if (data?.error) {
        const err = new Error(data.error);
        err.code = data.error;
        throw err;
      }
      return { to: data?.data?.to || null };
    }, 'rapportSav.envoyer');
  },

  /**
   * @param {string} interventionId
   * @param {{ to: string }} p
   */
  async noterEnvoi(interventionId, { to }) {
    return withErrorHandling(
      () => ecrireTrace(interventionId, (trace) => {
        if (!trace) throw new Error('Aucun rapport sur cette carte');
        return traceEnvoi(trace, { to, maintenant: new Date().toISOString() });
      }),
      'rapportSav.noterEnvoi',
    );
  },
};

export default rapportSavService;
