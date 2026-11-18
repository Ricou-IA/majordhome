/**
 * chantierPv.service.js - Majord'home Artisan
 * ============================================================================
 * PV de réception signé en ligne (edge `chantier-pv`, table `majordhome.chantier_pv`).
 * Le bureau envoie le lien ou le copie ; il LIT l'enregistrement de la signature
 * (vue `majordhome_chantier_pv`) mais ne l'écrit jamais : seule l'edge le fait.
 * Spec : docs/superpowers/specs/2026-11-17-chantier-apres-vente-pv-en-ligne-design.md
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { storageService } from '@services/storage.service';
import { chantiersService } from '@services/chantiers.service';
import { messagePv, donneesPdfPv, donneesPdfLevee, objetDuPv } from '@/lib/pvReception';

/**
 * Appelle l'edge. Une réponse non-2xx porte un CODE (`error`) : il devient `err.code`,
 * et `err.message` est le texte à afficher (`messagePv`).
 */
async function invoquer(body) {
  const { data, error } = await supabase.functions.invoke('chantier-pv', { body });
  if (!error) return data;
  let code = null;
  let detail = null;
  let gabarit = null;
  try {
    const corps = await error.context?.json?.();
    code = corps?.error || null;
    detail = corps?.detail || null;
    // `gabarit_different` : le gabarit qui fait foi côté serveur.
    gabarit = corps?.gabarit ?? null;
  } catch {
    // Corps non JSON : on garde le message brut.
  }
  const err = new Error(messagePv(code, detail || error.message || 'Le serveur n\'a pas répondu'));
  err.code = code;
  err.gabarit = gabarit;
  throw err;
}

export const chantierPvService = {
  /** Envoie au client l'e-mail qui porte le lien de signature. → `{ sent_to, sent_at, sent_count }` */
  envoyer: ({ orgId, chantierId }) =>
    withErrorHandling(() => invoquer({ action: 'envoyer', org_id: orgId, chantier_id: chantierId }), 'chantierPv.envoyer'),

  /** Rend le lien sans rien envoyer (à transmettre par SMS, WhatsApp…). → `{ url, expires_at }` */
  lien: ({ orgId, chantierId }) =>
    withErrorHandling(() => invoquer({ action: 'lien', org_id: orgId, chantier_id: chantierId }), 'chantierPv.lien'),

  /** Enregistrement du PV en ligne d'un chantier (envoi, ouverture, signature), ou `null`. */
  async getPv(orgId, chantierId) {
    return withErrorHandling(async () => {
      if (!orgId || !chantierId) throw new Error('[chantierPv] orgId et chantierId requis');
      const { data, error } = await supabase
        .from('majordhome_chantier_pv').select('*')
        .eq('chantier_id', chantierId).eq('org_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'chantierPv.getPv');
  },

  /**
   * Produit le PDF du PV depuis l'ENREGISTREMENT de la signature en ligne, puis l'archive
   * (`pv_reception_path`) si ce n'est pas déjà fait. Le PDF est rendu même si l'archivage
   * échoue : `archive` dit ce qui a été fait.
   * @returns {Promise<{ data: { blob: Blob, archive: boolean } | null, error: Error | null }>}
   */
  async genererPdf({ orgId, chantier, company }) {
    return withErrorHandling(async () => {
      const { data: pv, error } = await chantierPvService.getPv(orgId, chantier.id);
      if (error) throw error;
      if (!pv?.signed_at) throw new Error('Ce PV n\'a pas encore été signé');

      // react-pdf est lourd : chargé à la demande, pas avec le board.
      const { generatePvReceptionPdfBlob } = await import('@/apps/artisan/components/chantiers/PvReceptionPDF');
      const blob = await generatePvReceptionPdfBlob(donneesPdfPv({
        chantierId: chantier.id,
        client: {
          prenom: chantier.first_name, nom: chantier.last_name,
          adresse: chantier.address, code_postal: chantier.postal_code, ville: chantier.city,
        },
        objet: objetDuPv({ equipement: chantier.equipment_type_label, libelle: chantier.label }),
        entreprise: company?.name || '',
        signature: pv,
      }), company);

      if (chantier.pv_reception_path) return { blob, archive: true };
      const chemin = `${orgId}/pv-reception/${chantier.id}/PV_Reception_en_ligne.pdf`;
      const { error: uploadError } = await storageService.uploadFile('interventions', chemin, blob, { upsert: true, contentType: 'application/pdf' });
      if (uploadError) return { blob, archive: false };
      const { error: cheminError } = await chantiersService.updatePvReceptionPath(orgId, chantier.id, chemin);
      return { blob, archive: !cheminError };
    }, 'chantierPv.genererPdf');
  },

  /**
   * Enregistre les réponses du bureau aux points de contrôle (oui / non / sans objet). → `{ prepare_at }`
   * `gabarit` = celui que la fenêtre affiche ; le serveur le compare au sien et refuse
   * `gabarit_different` (`error.gabarit` = le sien) sans rien écrire.
   */
  preparer: ({ orgId, chantierId, gabarit, reponses }) =>
    withErrorHandling(
      () => invoquer({ action: 'preparer', org_id: orgId, chantier_id: chantierId, gabarit, reponses }),
      'chantierPv.preparer',
    ),

  /**
   * Réponse du bureau aux réserves. La base REMPLACE le texte ET la date à chaque appel :
   * les deux partent toujours, une valeur vide en `null`. → `{ ok, repondu_at }`
   */
  repondreReserves: ({ orgId, chantierId, reponse, echeance }) =>
    withErrorHandling(
      () => invoquer({
        action: 'repondre_reserves',
        org_id: orgId,
        chantier_id: chantierId,
        reponse: String(reponse ?? '').trim() || null,
        echeance: echeance || null,
      }),
      'chantierPv.repondreReserves',
    ),

  /** Demande de levée des réserves : `mode` 'email' → `{ sent_to }`, 'lien' → `{ url, expires_at }`. */
  demanderLevee: ({ orgId, chantierId, mode }) =>
    withErrorHandling(
      () => invoquer({ action: 'demander_levee', org_id: orgId, chantier_id: chantierId, mode }),
      'chantierPv.demanderLevee',
    ),

  /**
   * PDF de la levée des réserves, produit depuis l'ENREGISTREMENT de la signature de levée,
   * puis archivé (`pv_levee_path`) si ce n'est pas déjà fait. Le PDF est rendu même si
   * l'archivage échoue : `archive` dit ce qui a été fait.
   * @returns {Promise<{ data: { blob: Blob, archive: boolean } | null, error: Error | null }>}
   */
  async genererPdfLevee({ orgId, chantier, company }) {
    return withErrorHandling(async () => {
      const { data: pv, error } = await chantierPvService.getPv(orgId, chantier.id);
      if (error) throw error;
      if (!pv?.levee_signed_at) throw new Error('La levée des réserves n\'a pas encore été signée');

      const { generatePvLeveePdfBlob } = await import('@/apps/artisan/components/chantiers/PvLeveeReservesPDF');
      const blob = await generatePvLeveePdfBlob(donneesPdfLevee({
        chantierId: chantier.id,
        client: {
          prenom: chantier.first_name, nom: chantier.last_name,
          adresse: chantier.address, code_postal: chantier.postal_code, ville: chantier.city,
        },
        objet: objetDuPv({ equipement: chantier.equipment_type_label, libelle: chantier.label }),
        entreprise: company?.name || '',
        pv,
      }), company);

      if (chantier.pv_levee_path) return { blob, archive: true };
      const chemin = `${orgId}/pv-levee/${chantier.id}/PV_Levee_reserves.pdf`;
      const { error: uploadError } = await storageService.uploadFile('interventions', chemin, blob, { upsert: true, contentType: 'application/pdf' });
      if (uploadError) return { blob, archive: false };
      const { error: cheminError } = await chantiersService.updatePvLeveePath(orgId, chantier.id, chemin);
      return { blob, archive: !cheminError };
    }, 'chantierPv.genererPdfLevee');
  },
};

export default chantierPvService;
