/**
 * equipmentModels.service.js — Modèles fabricant d'appareil, nomenclature et fichiers
 * ============================================================================
 * Référentiel des appareils installés : `majordhome.equipment_models` ne s'écrit que par RPC — relevé fabricant
 * (service_role), fiche depuis un article, contrôle et fusion (migrations 20261112_4/_5), recherche web (edge
 * equipment-model-enrich). Écriture directe d'ici : le RATTACHEMENT d'un équipement client à une fiche
 * (`equipments.equipment_model_id`, droit clients.edit ; un trigger refuse une fiche d'une autre organisation).
 * Fichiers (photo, vues éclatées, documents) : bucket privé product-documents, URL signées.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { storageService } from '@services/storage.service';
import { catalogItemsService } from '@services/catalogItems.service';
import { cle } from '@/lib/catalogue/nomenclature';
import { champsRattachement, saisieOrigine } from '@/lib/equipements/saisieAppareil';
import { logger } from '@lib/logger';

const BUCKET = 'product-documents';
const COLONNES_LISTE = 'id, org_id, brand, brand_key, reference, name, model_name, category, lifecycle, is_active, photo_path, origin, review_status, equipment_type_id, catalog_item_id, catalog_source_product_id, merged_into';

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
        .eq('org_id', orgId).eq('is_active', true).is('merged_into', null).order('name').limit(1000); // plafond PostgREST ; l'écran signale une liste pleine
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
   * Rattache (ou détache, `modelId` null) un équipement à une fiche du référentiel. Rattacher NETTOIE la saisie :
   * marque de référence et nom du modèle de la fiche (`champsRattachement`), ligne fournisseur de l'article lié s'il y
   * en a un ; la saisie d'avant est gardée dans `metadata.saisie_origine` (posée une seule fois). Détacher ne touche
   * ni marque ni modèle. 0 ligne modifiée = refus bruyant (RLS : droit clients.edit), jamais un succès annoncé à tort.
   */
  async setEquipmentModel(equipmentId, modelId) {
    return withErrorHandling(async () => {
      if (!equipmentId) throw new Error('[equipmentModelsService] equipmentId requis');
      let patch = { equipment_model_id: null };
      if (modelId) {
        const [{ data: fiche, error: errFiche }, { data: eq, error: errEq }] = await Promise.all([
          supabase.from('majordhome_equipment_models').select('id, brand, model_name, catalog_source_product_id').eq('id', modelId).maybeSingle(),
          supabase.from('majordhome_equipments').select('id, brand, model, metadata').eq('id', equipmentId).maybeSingle(),
        ]);
        if (errFiche) throw errFiche;
        if (errEq) throw errEq;
        if (!fiche) throw new Error('equipment_model_not_found');
        if (!eq) throw new Error('equipment_model_update_refused');
        const champs = champsRattachement(fiche);
        const metadata = eq.metadata && typeof eq.metadata === 'object' ? eq.metadata : {};
        patch = {
          equipment_model_id: modelId, brand: champs.brand, model: champs.model,
          ...(champs.supplierProductId ? { supplier_product_id: champs.supplierProductId } : {}),
          ...(metadata.saisie_origine ? {} : { metadata: { ...metadata, saisie_origine: saisieOrigine(eq, 'rattachement', aujourdhui()) } }),
        };
      }
      const { data, error } = await supabase.from('majordhome_equipments')
        .update(patch).eq('id', equipmentId).select('id, equipment_model_id');
      if (error) throw error;
      if (!data?.length) throw new Error('equipment_model_update_refused');
      return data[0];
    }, 'equipmentModels.setEquipmentModel');
  },

  /** Marques de référence de l'org (écriture en majuscules + clé). */
  async listBrandRefs(orgId) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[equipmentModelsService] orgId requis');
      const { data, error } = await supabase.from('majordhome_equipment_brand_refs').select('name, brand_key')
        .eq('org_id', orgId).order('name').limit(1000);
      if (error) throw error;
      return data || [];
    }, 'equipmentModels.listBrandRefs');
  },

  /** Articles du catalogue qui pourraient être l'appareil saisi (marque + modèle), 30 au plus, pièces détachées exclues. */
  async searchArticles(orgId, brand, model) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[equipmentModelsService] orgId requis');
      const { data, error } = await catalogItemsService.listItems(orgId, {
        search: [brand, model].filter(Boolean).join(' '), sansPiecesDetachees: true, pageSize: 30,
      });
      if (error) throw error;
      return data || [];
    }, 'equipmentModels.searchArticles');
  },

  /** Fiche du référentiel depuis un article (rejouée = même fiche). `{ model_id, created }`. */
  async createFromCatalog(catalogItemId) {
    return withErrorHandling(async () => {
      if (!catalogItemId) throw new Error('[equipmentModelsService] catalogItemId requis');
      const { data, error } = await supabase.rpc('equipment_model_create_from_catalog', { p_catalog_item_id: catalogItemId });
      if (error) throw error;
      return data;
    }, 'equipmentModels.createFromCatalog');
  },

  /**
   * Recherche web d'un appareil (edge equipment-model-enrich, rien n'est écrit) : `{ appareils }`.
   * @param {string} orgId
   * @param {{ brand: string, model: string, equipmentTypeId?: string|null, typeLabel?: string|null, champs?: object[] }} saisie
   */
  async searchWeb(orgId, { brand, model, equipmentTypeId = null, typeLabel = null, champs = [] }) {
    return appelEdge({ action: 'chercher', org_id: orgId, brand, model, equipment_type_id: equipmentTypeId, type_label: typeLabel, champs }, 'searchWeb');
  },

  /**
   * Crée la fiche validée sur place (`a_controler`) : `{ model_id, created, existante, avertissements }`.
   * @param {string} orgId
   * @param {object} appareil appareil tel que validé (corrections de l'intervenant comprises)
   * @param {{ equipmentTypeId?: string|null, champs?: object[] }} [options]
   */
  async createFromWeb(orgId, appareil, { equipmentTypeId = null, champs = [] } = {}) {
    return appelEdge({ action: 'creer', org_id: orgId, appareil, equipment_type_id: equipmentTypeId, champs }, 'createFromWeb');
  },

  /** File de contrôle : fiches web à contrôler, avec les clients qui en ont une. */
  async listToReview(orgId) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[equipmentModelsService] orgId requis');
      const { data, error } = await supabase.from('majordhome_equipment_models_a_controler').select('*')
        .eq('org_id', orgId).order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
      return data || [];
    }, 'equipmentModels.listToReview');
  },

  /** Valider (patch vide) ou corriger puis valider une fiche (org_admin). */
  async review(modelId, patch = {}) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('equipment_model_review', { p_model_id: modelId, p_patch: patch || {} });
      if (error) throw error;
      return data;
    }, 'equipmentModels.review');
  },

  /** Fusionne la fiche absorbée dans la fiche gardée (org_admin) : `{ equipements, documents }`. */
  async merge(absorbedId, survivorId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('equipment_model_merge', { p_absorbed_id: absorbedId, p_survivor_id: survivorId });
      if (error) throw error;
      return data;
    }, 'equipmentModels.merge');
  },
};

/** Date du jour AAAA-MM-JJ (heure locale). */
function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Appel de l'edge de recherche web ; le message d'erreur de l'edge remonte tel quel (`{ data, error }`). */
async function appelEdge(body, etape) {
  try {
    if (!body.org_id) throw new Error('[equipmentModelsService] orgId requis');
    const { data, error } = await supabase.functions.invoke('equipment-model-enrich', { body });
    if (error) {
      let detail = null;
      try { detail = await error.context?.json?.(); } catch { /* corps illisible */ }
      const err = new Error(detail?.error || error.message);
      err.code = detail?.code || null;
      throw err;
    }
    return { data, error: null };
  } catch (error) {
    logger.error(`[equipmentModelsService] ${etape}:`, error);
    return { data: null, error };
  }
}
