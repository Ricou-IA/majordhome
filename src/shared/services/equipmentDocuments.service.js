/**
 * equipmentDocuments.service.js — Documents du MODÈLE d'appareil
 * ============================================================================
 * Notice technique, vue éclatée… rattachés au couple marque + modèle (table
 * majordhome.equipment_documents, migration 20261028_5) : déposés une fois
 * depuis n'importe quelle fiche client, visibles sur tous les équipements de
 * l'org qui portent le même appareil. La normalisation marque / modèle vit
 * EN BASE (majordhome.equipment_model_key, posée par trigger) : ici on ne
 * calcule jamais de clé, on lit par equipment_id via la vue
 * majordhome_equipment_model_documents.
 *
 * Fichiers : bucket product-documents, chemin `${orgId}/equipment-models/…`
 * (policies Storage org existantes).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { storageService } from '@services/storage.service';

const EQUIPMENT_DOCUMENT_BUCKET = 'product-documents';

/** Types de document (valeurs du CHECK en base) — libellés affichés. */
export const EQUIPMENT_DOCUMENT_TYPES = [
  { value: 'notice', label: 'Notice technique' },
  { value: 'vue_eclatee', label: 'Vue éclatée' },
  { value: 'autre', label: 'Autre' },
];

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
   * Dépose un document pour le modèle de `equipment` (marque + modèle tels que saisis sur la fiche ;
   * la base en dérive la clé partagée). Fichier téléversé d'abord ; si la ligne est refusée, le fichier est retiré.
   */
  async upload({ orgId, equipment, file, documentType = 'notice', label = null, userId = null }) {
    return withErrorHandling(async () => {
      if (!orgId || !file) throw new Error('[equipmentDocumentsService] orgId et file requis');
      if (!equipmentHasModel(equipment)) throw new Error('equipment_document_model_required');
      const ext = (file.name || 'document').split('.').pop().toLowerCase();
      const storagePath = `${orgId}/equipment-models/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await storageService.uploadFile(EQUIPMENT_DOCUMENT_BUCKET, storagePath, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data, error } = await supabase
        .from('majordhome_equipment_documents')
        .insert({
          org_id: orgId,
          brand: equipment.brand.trim(),
          model: equipment.model.trim(),
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
   * Retire un document du modèle (org_admin en base : la RLS filtre, 0 ligne = refus bruyant ici,
   * jamais un succès annoncé sur un fichier resté en place).
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
      if (doc.storage_path) await storageService.deleteFile(EQUIPMENT_DOCUMENT_BUCKET, doc.storage_path);
      return true;
    }, 'equipmentDocuments.remove');
  },
};
