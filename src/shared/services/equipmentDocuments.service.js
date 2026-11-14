/**
 * equipmentDocuments.service.js — Documents d'un équipement (trois portées)
 * ============================================================================
 * Notice technique, vue éclatée… (table majordhome.equipment_documents,
 * migration 20261028_5) déposés depuis la fiche client avec une PORTÉE
 * (`scope`, 2026-11-14) :
 *   - `appareil` : cet équipement seulement (`equipment_id`) ;
 *   - `modele`   : tous les équipements de l'org de même marque + modèle
 *                  (défaut de la base, ancien et seul comportement) ;
 *   - `marque`   : tous les équipements de la marque (modèle forcé à NULL en base).
 * L'écran présélectionne `appareil`, et ce service aussi : un document propre à
 * un client ne doit jamais s'afficher sur tout le parc par mégarde. Portée et
 * équipement sont immuables après dépôt (on retire et on redépose).
 * La normalisation marque / modèle vit EN BASE (majordhome.equipment_model_key,
 * posée par trigger) : ici on ne calcule jamais de clé, on lit par equipment_id
 * via la vue majordhome_equipment_model_documents (les trois portées, colonne `scope`).
 *
 * Fichiers : bucket product-documents, chemin `${orgId}/equipment-models/…`
 * (marque, modèle) ou `${orgId}/equipments/${equipmentId}/…` (appareil — forme
 * exigée par un CHECK en base). Policies Storage org existantes.
 *
 * Depuis 20261111_3, la même vue rend aussi les documents RELEVÉS sur le site du
 * fabricant (notice, fiche technique, procédures) pour un équipement rattaché à
 * son modèle fabricant (`from_site`) : lecture seule ici, écrits par l'import.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { storageService } from '@services/storage.service';
import { PORTEES_DOCUMENT } from '@/lib/catalogue/documentsAppareil';

const EQUIPMENT_DOCUMENT_BUCKET = 'product-documents';

/** Types de document (valeurs du CHECK en base) — libellés affichés. */
export const EQUIPMENT_DOCUMENT_TYPES = [
  { value: 'notice', label: 'Notice technique' },
  { value: 'vue_eclatee', label: 'Vue éclatée' },
  { value: 'fiche_technique', label: 'Fiche technique' },
  { value: 'procedure', label: 'Procédure' },
  { value: 'autre', label: 'Autre' },
];

/**
 * Un document RELEVÉ sur le site du fabricant (`from_site` de la vue par équipement, ou `equipment_model_id`
 * renseigné) partage son fichier avec d'autres modèles : le retirer retire la ligne, jamais le fichier.
 */
export const estDocumentReleve = (doc) => doc?.from_site === true || !!doc?.equipment_model_id;

export const equipmentDocumentTypeLabel = (value) =>
  EQUIPMENT_DOCUMENT_TYPES.find((t) => t.value === value)?.label || 'Document';

/**
 * Un équipement peut porter des documents s'il a une marque ET un modèle avec au moins un caractère utile,
 * hors textes de remplissage (« À renseigner » de l'import Excel, « Inconnu », « NC »). Miroir de la règle
 * de majordhome.equipment_model_key (migration 20261028_5), qui reste l'arbitre : un dépôt qu'elle refuse
 * revient en erreur `equipment_document_model_required`.
 */
const PLACEHOLDERS = new Set(['arenseigner', 'inconnu', 'inconnue', 'nc', 'na']);
const champUtile = (v) => {
  const k = String(v || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return k.length > 0 && !PLACEHOLDERS.has(k);
};
export const equipmentHasModel = (equipment) => champUtile(equipment?.brand) && champUtile(equipment?.model);
/** Un équipement peut porter des documents de MARQUE s'il a une marque utile (même règle `champUtile`). */
export const equipmentHasBrand = (equipment) => champUtile(equipment?.brand);

const trimOrNull = (v) => (typeof v === 'string' && v.trim()) || null;

export const equipmentDocumentsService = {
  /**
   * Documents du modèle de chaque équipement : `{ [equipmentId]: doc[] }`.
   * Un document partagé par N équipements apparaît sous chacun d'eux.
   */
  async getByEquipmentIds(orgId, equipmentIds = []) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[equipmentDocumentsService] orgId est requis');
      const ids = [...new Set((equipmentIds || []).filter(Boolean))];
      if (ids.length === 0) return {};
      const { data, error } = await supabase
        .from('majordhome_equipment_model_documents')
        .select('*')
        .eq('org_id', orgId)
        .in('equipment_id', ids)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const map = {};
      for (const row of data || []) {
        (map[row.equipment_id] ||= []).push(row);
      }
      return map;
    }, 'equipmentDocuments.getByEquipmentIds');
  },

  /**
   * Dépose un document pour `equipment` selon sa portée (`scope`, défaut `appareil`) :
   *   - `appareil` : `equipment_id` posé, fichier sous `${orgId}/equipments/${equipment.id}/`, marque / modèle
   *     recopiés s'ils sont renseignés (sinon NULL) ;
   *   - `modele`   : exige marque + modèle utiles (`equipment_document_model_required`) ;
   *   - `marque`   : exige une marque utile (`equipment_document_brand_required`), aucun modèle envoyé.
   * Marque + modèle tels que saisis sur la fiche ; la base en dérive la clé partagée. Fichier téléversé d'abord ;
   * si la ligne est refusée, le fichier est retiré.
   */
  async upload({ orgId, equipment, file, documentType = 'notice', label = null, userId = null, scope = 'appareil' }) {
    return withErrorHandling(async () => {
      if (!orgId || !file) throw new Error('[equipmentDocumentsService] orgId et file requis');
      if (!PORTEES_DOCUMENT.includes(scope)) throw new Error(`[equipmentDocumentsService] portée inconnue : ${scope}`);
      if (scope === 'appareil' && !equipment?.id) throw new Error('equipment_document_equipment_required');
      if (scope === 'modele' && !equipmentHasModel(equipment)) throw new Error('equipment_document_model_required');
      if (scope === 'marque' && !equipmentHasBrand(equipment)) throw new Error('equipment_document_brand_required');
      const ext = (file.name || 'document').split('.').pop().toLowerCase();
      const dossier = scope === 'appareil' ? `equipments/${equipment.id}` : 'equipment-models';
      const storagePath = `${orgId}/${dossier}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await storageService.uploadFile(EQUIPMENT_DOCUMENT_BUCKET, storagePath, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data, error } = await supabase
        .from('majordhome_equipment_documents')
        .insert({
          org_id: orgId,
          scope,
          equipment_id: scope === 'appareil' ? equipment.id : null,
          brand: trimOrNull(equipment?.brand),
          model: scope === 'marque' ? null : trimOrNull(equipment?.model),
          document_type: documentType,
          label: label?.trim() || null,
          file_name: file.name,
          storage_path: storagePath,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: userId,
        })
        .select()
        .single();
      if (error) {
        await storageService.deleteFile(EQUIPMENT_DOCUMENT_BUCKET, storagePath);
        throw error;
      }
      return data;
    }, 'equipmentDocuments.upload');
  },

  /** URL signée (1 h) pour ouvrir un document. */
  async getSignedUrl(doc) {
    const { url, error } = await storageService.getSignedUrl(EQUIPMENT_DOCUMENT_BUCKET, doc?.storage_path, 3600);
    return { data: url, error };
  },

  /**
   * Retire un document (en base : `appareil` avec le droit de modifier la fiche client, `marque` / `modele`
   * avec le droit de supprimer — org_admin ; la RLS filtre, 0 ligne = refus bruyant ici, jamais un succès
   * annoncé sur un fichier resté en place).
   */
  async remove(orgId, doc) {
    return withErrorHandling(async () => {
      if (!orgId || !doc?.id) throw new Error('[equipmentDocumentsService] orgId et doc requis');
      const { data, error } = await supabase
        .from('majordhome_equipment_documents')
        .delete()
        .eq('id', doc.id)
        .eq('org_id', orgId)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('equipment_document_delete_refused');
      // fichier d'un document relevé = partagé par contenu avec d'autres modèles (migration 20261111_3) : on le garde
      if (doc.storage_path && !estDocumentReleve(doc)) await storageService.deleteFile(EQUIPMENT_DOCUMENT_BUCKET, doc.storage_path);
      return true;
    }, 'equipmentDocuments.remove');
  },
};
