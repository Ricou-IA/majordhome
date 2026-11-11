/**
 * equipmentModels.service.js — Modèles fabricant d'appareil, nomenclature et fichiers
 * ============================================================================
 * Lecture seule : `majordhome.equipment_models` / `equipment_model_parts` ne s'écrivent que par l'import d'un
 * relevé du site du fabricant (RPC service_role, migrations 20261111_1 à _5). La seule écriture d'ici est le
 * RATTACHEMENT d'un équipement client à son modèle (`equipments.equipment_model_id`, droit clients.edit ; un
 * trigger refuse un modèle d'une autre organisation).
 * Fichiers (photo, vues éclatées, documents) : bucket privé product-documents, URL signées.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { storageService } from '@services/storage.service';
import { cle } from '@/lib/catalogue/nomenclature';

const BUCKET = 'product-documents';
const COLONNES_LISTE = 'id, org_id, brand, brand_key, reference, name, model_name, category, lifecycle, is_active, photo_path';

export const equipmentModelsService = {
  /** Un modèle fabricant (avec ses vues éclatées). */
  async getById(orgId, modelId) {
    return withErrorHandling(async () => {
      if (!orgId || !modelId) throw new Error('[equipmentModelsService] orgId et modelId requis');
      const { data, error } = await supabase.from('majordhome_equipment_models').select('*')
        .eq('org_id', orgId).eq('id', modelId).maybeSingle();
      if (error) throw error;
      return data;
    }, 'equipmentModels.getById');
  },

  /**
   * Modèles actifs proposables pour une marque saisie sur un équipement (clé = marque sans accents ni
   * ponctuation). Marque vide ou inconnue du référentiel : tous les modèles de l'org (le sélecteur filtre ensuite).
   * @returns {{ data: { modeles: object[], marqueReconnue: boolean }, error }}
   */
  async listForBrand(orgId, brand) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[equipmentModelsService] orgId requis');
      const base = () => supabase.from('majordhome_equipment_models').select(COLONNES_LISTE)
        .eq('org_id', orgId).eq('is_active', true).order('name').limit(1000); // plafond PostgREST ; l'écran signale une liste pleine
      const marque = cle(brand);
      if (marque) {
        const { data, error } = await base().eq('brand_key', marque);
        if (error) throw error;
        if (data?.length) return { modeles: data, marqueReconnue: true };
      }
      const { data, error } = await base();
      if (error) throw error;
      return { modeles: data || [], marqueReconnue: false };
    }, 'equipmentModels.listForBrand');
  },

  /** Nomenclature d'un modèle, dans l'ordre du site. */
  async getParts(orgId, modelId) {
    return withErrorHandling(async () => {
      if (!orgId || !modelId) throw new Error('[equipmentModelsService] orgId et modelId requis');
      const { data, error } = await supabase.from('majordhome_equipment_model_parts').select('*')
        .eq('org_id', orgId).eq('equipment_model_id', modelId).order('position', { ascending: true }).limit(1000);
      if (error) throw error;
      return data || [];
    }, 'equipmentModels.getParts');
  },

  /**
   * URL signées (1 h) de la photo et des vues éclatées d'un modèle. Une image qui ne se signe pas est omise et
   * comptée (`manquantes`) : l'écran le dit, la nomenclature reste lisible.
   * @returns {{ data: { photo: string|null, vues: Array<{ url: string, width: number|null, height: number|null }>, manquantes: number }, error }}
   */
  async getImages(model) {
    return withErrorHandling(async () => {
      const vuesSource = Array.isArray(model?.exploded_views) ? model.exploded_views.filter((v) => v?.path) : [];
      const [photo, ...vues] = await Promise.all([
        model?.photo_path ? storageService.getSignedUrl(BUCKET, model.photo_path, 3600) : Promise.resolve({ url: null, error: null }),
        ...vuesSource.map((v) => storageService.getSignedUrl(BUCKET, v.path, 3600)),
      ]);
      const ok = vues.map((r, i) => (r.url ? {
        url: r.url, width: vuesSource[i].width ?? null, height: vuesSource[i].height ?? null,
        // vue tirée de la notice (et non du site) : ses repères sont ceux de la notice — l'écran doit le dire
        origine: vuesSource[i].origine || 'site', role: vuesSource[i].role || 'vue', page: vuesSource[i].page ?? null,
      } : null)).filter(Boolean);
      return { photo: photo.url || null, vues: ok, manquantes: (vuesSource.length - ok.length) + (model?.photo_path && !photo.url ? 1 : 0) };
    }, 'equipmentModels.getImages');
  },

  /**
   * Rattache (ou détache, `modelId` null) un équipement à son modèle fabricant. 0 ligne modifiée = refus bruyant
   * (RLS : droit clients.edit), jamais un succès annoncé à tort.
   */
  async setEquipmentModel(equipmentId, modelId) {
    return withErrorHandling(async () => {
      if (!equipmentId) throw new Error('[equipmentModelsService] equipmentId requis');
      const { data, error } = await supabase.from('majordhome_equipments')
        .update({ equipment_model_id: modelId || null }).eq('id', equipmentId).select('id, equipment_model_id');
      if (error) throw error;
      if (!data?.length) throw new Error('equipment_model_update_refused');
      return data[0];
    }, 'equipmentModels.setEquipmentModel');
  },
};
