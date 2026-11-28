/**
 * catalogImports.service.js - Majord'home Artisan
 * ============================================================================
 * Import d'une base d'articles depuis un fichier : lecture des imports, des articles
 * et lignes fournisseur existants, écriture par lots, retrait. Les écritures passent
 * par les RPC `catalog_items_import_*` (SECURITY DEFINER, org dérivée de l'import
 * côté base). Les codes d'erreur de la base arrivent dans `error.message`
 * (cf. `messageErreurImportArticles`, src/lib/importArticles/lots.js).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { fetchAllPages } from '@/lib/postgrestUtils';
import { TAILLE_LOT_RETRAIT } from '@/lib/importClients/lots';

// Articles vivants : colonnes de la vue majordhome_catalog_items (miroir de catalog_items).
const COLONNES_ARTICLES = 'id, code, code_ean, brand, model_key, name, product_kind';

export const catalogImportsService = {
  /** Imports de l'entreprise, du plus récent au plus ancien. */
  async listImports(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_catalog_imports')
        .select('id, org_id, created_by, created_by_name, created_at, file_name, counts, status, removed_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    }, 'catalogImports.listImports');
  },

  /** Fournisseurs de l'entreprise (actifs ou non : le fichier peut viser un fournisseur éteint). */
  async getSuppliers(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_suppliers')
        .select('id, name, is_active')
        .eq('org_id', orgId)
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    }, 'catalogImports.getSuppliers');
  },

  /**
   * Articles vivants + lignes fournisseur (référence) des fournisseurs donnés, lus EN ENTIER.
   * Rejette si une page échoue : jamais une liste partielle rendue comme complète.
   */
  async getExistant(orgId, supplierIds) {
    return withErrorHandling(async () => {
      const ids = [...new Set(supplierIds ?? [])];
      const articles = await fetchAllPages((from, to) => supabase
        .from('majordhome_catalog_items')
        .select(COLONNES_ARTICLES)
        .eq('org_id', orgId)
        .eq('is_active', true)
        .is('merged_into', null)
        .order('id', { ascending: true })
        .range(from, to));
      const lignes = ids.length === 0
        ? []
        : await fetchAllPages((from, to) => supabase
          .from('majordhome_supplier_products_write')
          .select('id, supplier_id, reference')
          .eq('org_id', orgId)
          .in('supplier_id', ids)
          .order('id', { ascending: true })
          .range(from, to));
      return { articles, lignes };
    }, 'catalogImports.getExistant');
  },

  /** Ouvre un import ; rend `{ import_id, fournisseurs: [{ nom, supplier_id, cree }] }`. */
  async start({ orgId, fileName, mapping, counts, fournisseurs }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('catalog_items_import_start', {
        p_org_id: orgId,
        p_file_name: fileName,
        p_mapping: mapping,
        p_counts: counts,
        p_fournisseurs: fournisseurs ?? [],
      });
      if (error) throw error;
      return data;
    }, 'catalogImports.start');
  },

  /** Écrit un lot ; rend `{ created, skipped, lignes_fournisseur }`. Un lot renvoyé ne recrée rien. */
  async batch({ importId, rows }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('catalog_items_import_batch', { p_import_id: importId, p_rows: rows });
      if (error) throw error;
      return data;
    }, 'catalogImports.batch');
  },

  /** Clôt l'import avec son bilan. */
  async finish({ importId, counts }) {
    return withErrorHandling(async () => {
      const { error } = await supabase.rpc('catalog_items_import_finish', { p_import_id: importId, p_counts: counts });
      if (error) throw error;
      return true;
    }, 'catalogImports.finish');
  },

  /** Combien d'articles se retirent, combien sont conservés (déjà utilisés). */
  async removalPreview(importId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('catalog_items_import_removal_preview', { p_import_id: importId });
      if (error) throw error;
      return data;
    }, 'catalogImports.removalPreview');
  },

  /** Retire au plus `TAILLE_LOT_RETRAIT` articles ; rend `{ retirees, conservees, restantes }`. */
  async remove(importId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('catalog_items_import_remove', { p_import_id: importId, p_limit: TAILLE_LOT_RETRAIT });
      if (error) throw error;
      return data;
    }, 'catalogImports.remove');
  },
};
