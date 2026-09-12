/**
 * equipmentCategories.service.js - Majord'home Artisan
 * ============================================================================
 * Catégories d'équipement de l'organisation (niveau 1 du référentiel :
 * catégorie → type). Table majordhome.equipment_categories, lue et écrite via
 * la vue publique majordhome_equipment_categories (security_invoker, miroir
 * updatable ; RLS : SELECT membre, écriture org_admin).
 *
 * Service séparé de pricing.service.js (796 LOC, seuil dépassé) — même pattern
 * `{ data, error }` que les zones tarifaires.
 * Spec : docs/superpowers/specs/2026-09-12-referentiel-equipements-tarifs-competences-design.md §4.1
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const VIEW = 'majordhome_equipment_categories';

export const equipmentCategoriesService = {
  /**
   * Catégories d'une org, triées (sort_order, label).
   * @param {string} orgId - org CORE (défense en profondeur, en plus de la RLS)
   * @param {{ activeOnly?: boolean }} [opts]
   */
  async getCategories(orgId, { activeOnly = true } = {}) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[equipmentCategoriesService] orgId est requis');
      let q = supabase.from(VIEW).select('*').eq('org_id', orgId).order('sort_order').order('label');
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }, 'equipmentCategories.getCategories');
  },

  /**
   * Création. `code` = slug immuable ([a-z0-9_], contrôlé aussi par la base).
   * @param {string} orgId
   * @param {{ code, label, sort_order?, is_active?, certificate_profile?, default_vat_rate? }} payload
   */
  async createCategory(orgId, payload) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[equipmentCategoriesService] orgId est requis');
      const { data, error } = await supabase
        .from(VIEW)
        .insert({ ...payload, org_id: orgId })
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'equipmentCategories.createCategory');
  },

  /**
   * Mise à jour partielle. Le code n'est JAMAIS envoyé (immuable : certificats
   * et site vitrine désignent par code ; la base le refuserait de toute façon).
   */
  async updateCategory(id, payload) {
    return withErrorHandling(async () => {
      if (!id) throw new Error('[equipmentCategoriesService] id est requis');
      const { code: _code, org_id: _org, ...patch } = payload || {};
      const { data, error } = await supabase
        .from(VIEW)
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'equipmentCategories.updateCategory');
  },

  /**
   * Suppression. Une catégorie référencée par des types ou des équipements est
   * refusée par la base (FK RESTRICT, code 23503) : l'écran propose alors de la
   * désactiver. L'erreur est remontée telle quelle, jamais avalée.
   */
  async deleteCategory(id) {
    return withErrorHandling(async () => {
      if (!id) throw new Error('[equipmentCategoriesService] id est requis');
      const { error } = await supabase.from(VIEW).delete().eq('id', id);
      if (error) throw error;
      return { success: true };
    }, 'equipmentCategories.deleteCategory');
  },
};

export default equipmentCategoriesService;
