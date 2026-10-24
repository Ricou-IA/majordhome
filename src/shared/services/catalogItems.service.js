/**
 * catalogItems.service.js — Articles Majord'home de l'org (base du devis) et matrice fournisseurs
 * ============================================================================
 * Spec docs/superpowers/specs/2026-10-24-articles-majordhome-matrice-fournisseurs-design.md.
 * Lectures : vues `majordhome_catalog_items_list` (article + offres comptées), `majordhome_catalog_item_offers`
 * (article × ligne fournisseur), `majordhome_catalog_item_proposals`. Écriture des champs humains : vue miroir
 * `majordhome_catalog_items` (RLS org_admin). Liens et fusions : RPC `catalog_item_*` (org_admin).
 * Retour : toujours { data, error } (ou { data, count, error }), jamais throw au caller.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { escapePostgrestSearchTerm } from '@/lib/postgrestUtils';
import { logger } from '@lib/logger';

/** Âge au-delà duquel un prix d'achat n'est plus « frais » (spec § 5.4). */
export const SEUIL_FRAICHEUR_JOURS = 30;

function dateSeuilFraicheur(now = new Date()) {
  return new Date(now.getTime() - SEUIL_FRAICHEUR_JOURS * 86400000).toISOString();
}

export const catalogItemsService = {
  /**
   * Articles de l'org, paginés. `categories` vide = toutes ; `sansCategorie` = seulement les articles sans catégorie ;
   * `sansOffreFraiche` = aucune offre active de moins de 30 jours ; `actifsSeulement` (défaut) exclut les désactivés
   * et les absorbés.
   */
  async listItems(orgId, {
    search = '', categories = [], brand = null, gamme = null, sansCategorie = false, sansOffreFraiche = false,
    avecOffreActive = false, actifsSeulement = true, page = 0, pageSize = 50,
  } = {}) {
    try {
      if (!orgId) return { data: [], count: 0, error: null };
      let q = supabase.from('majordhome_catalog_items_list').select('*', { count: 'exact' }).eq('org_id', orgId).is('merged_into', null);
      if (actifsSeulement) q = q.eq('is_active', true);
      if (avecOffreActive) q = q.gt('offres_actives', 0);
      if (sansCategorie) q = q.is('category', null);
      else if (categories?.length) q = q.in('category', categories);
      if (brand) q = q.eq('brand', brand);
      if (gamme) q = q.eq('gamme', gamme);
      if (sansOffreFraiche) q = q.or(`prix_le_plus_recent.is.null,prix_le_plus_recent.lt.${dateSeuilFraicheur()}`);
      if (search) {
        const t = escapePostgrestSearchTerm(search);
        if (t) q = q.or(`name.ilike.%${t}%,brand.ilike.%${t}%,model_key.ilike.%${t}%,code_ean.ilike.%${t}%,gamme.ilike.%${t}%`);
      }
      q = q.order('name').range(page * pageSize, page * pageSize + pageSize - 1);
      const { data, count, error } = await q;
      if (error) throw error;
      return { data: data || [], count: count || 0, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] listItems:', error);
      return { data: [], count: 0, error };
    }
  },

  /** Un article (vue liste, avec ses compteurs) ; null si absent. */
  async getItem(orgId, itemId) {
    try {
      if (!orgId || !itemId) return { data: null, error: null };
      const { data, error } = await supabase.from('majordhome_catalog_items_list').select('*').eq('org_id', orgId).eq('id', itemId).maybeSingle();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] getItem:', error);
      return { data: null, error };
    }
  },

  /** Offres (lignes fournisseur) de plusieurs articles, les moins chères d'abord. */
  async getOffers(orgId, itemIds) {
    try {
      if (!orgId || !itemIds?.length) return { data: [], error: null };
      const { data, error } = await supabase.from('majordhome_catalog_item_offers').select('*').eq('org_id', orgId)
        .in('item_id', itemIds).order('purchase_price_ht', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error('[catalogItemsService] getOffers:', error);
      return { data: [], error };
    }
  },

  /** Champs humains de l'article (org_admin via RLS). Un champ absent n'est pas touché. */
  async updateItem(orgId, itemId, updates = {}) {
    try {
      if (!orgId || !itemId) throw new Error('[catalogItemsService] orgId et itemId requis');
      const row = { updated_at: new Date().toISOString() };
      if (updates.name !== undefined) row.name = String(updates.name || '').trim();
      if (updates.brand !== undefined) row.brand = updates.brand || null;
      if (updates.category !== undefined) row.category = updates.category || null;
      if (updates.gamme !== undefined) row.gamme = updates.gamme || null;
      if (updates.productKind !== undefined) row.product_kind = updates.productKind || 'main';
      if (updates.unit !== undefined) row.unit = updates.unit || 'pièce';
      if (updates.defaultTvaRate !== undefined) row.default_tva_rate = Number(updates.defaultTvaRate) || 20;
      if (updates.sellingPriceHt !== undefined) row.selling_price_ht = Number(updates.sellingPriceHt) || 0;
      if (updates.description !== undefined) row.description = updates.description || null;
      if (updates.imageUrl !== undefined) row.image_url = updates.imageUrl || null;
      if (updates.specs !== undefined) row.specs = updates.specs || {};
      if (updates.isActive !== undefined) row.is_active = !!updates.isActive;
      if (row.name === '') throw new Error('Le libellé est requis');
      const { data, error } = await supabase.from('majordhome_catalog_items').update(row).eq('id', itemId).eq('org_id', orgId).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Modification refusée (réservée à l\'administrateur)');
      return { data, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] updateItem:', error);
      return { data: null, error };
    }
  },

  /**
   * Téléverse une photo d'article (bucket public `product-images`, chemin `${orgId}/articles/${itemId}/…`) et la pose
   * sur l'article. Résout avec l'URL publique.
   */
  async uploadItemImage({ orgId, itemId, file }) {
    try {
      if (!orgId || !itemId || !file) throw new Error('[catalogItemsService] orgId, itemId et file requis');
      const ext = (file.name || 'image').split('.').pop().toLowerCase();
      const path = `${orgId}/articles/${itemId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('product-images').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
      const publicUrl = urlData?.publicUrl;
      if (!publicUrl) throw new Error('URL publique indisponible');
      const { error } = await this.updateItem(orgId, itemId, { imageUrl: publicUrl });
      if (error) throw error;
      return { data: publicUrl, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] uploadItemImage:', error);
      return { data: null, error };
    }
  },

  /** Marques distinctes des articles actifs de l'org (filtre). */
  async getDistinctBrands(orgId) {
    try {
      if (!orgId) return { data: [], error: null };
      const { data, error } = await supabase.from('majordhome_catalog_items_list').select('brand').eq('org_id', orgId)
        .eq('is_active', true).is('merged_into', null).not('brand', 'is', null).limit(5000);
      if (error) throw error;
      const marques = [...new Set((data || []).map((r) => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
      return { data: marques, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] getDistinctBrands:', error);
      return { data: [], error };
    }
  },

  /** Gammes distinctes des articles actifs, limitées à des catégories (vide = toutes). */
  async getDistinctGammes(orgId, categories = []) {
    try {
      if (!orgId) return { data: [], error: null };
      let q = supabase.from('majordhome_catalog_items_list').select('gamme').eq('org_id', orgId)
        .eq('is_active', true).is('merged_into', null).not('gamme', 'is', null).limit(5000);
      if (categories?.length) q = q.in('category', categories);
      const { data, error } = await q;
      if (error) throw error;
      const gammes = [...new Set((data || []).map((r) => r.gamme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
      return { data: gammes, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] getDistinctGammes:', error);
      return { data: [], error };
    }
  },

  /** Recherche courte (rattachement / fusion manuels). */
  async searchItems(orgId, query, limit = 20) {
    const { data, error } = await this.listItems(orgId, { search: query, pageSize: limit });
    return { data, error };
  },

  /** Compteurs de la page « Harmoniser les bases ». */
  async getStats(orgId) {
    try {
      if (!orgId) return { data: null, error: null };
      const base = () => supabase.from('majordhome_catalog_items_list').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true).is('merged_into', null);
      const [actifs, multi, sansCle, props] = await Promise.all([
        base(),
        base().gte('offres_actives', 2),
        base().is('model_key', null),
        supabase.from('majordhome_catalog_item_proposals').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('statut', 'propose'),
      ]);
      const err = actifs.error || multi.error || sansCle.error || props.error;
      if (err) throw err;
      return { data: { actifs: actifs.count || 0, multiOffres: multi.count || 0, sansCle: sansCle.count || 0, propositions: props.count || 0 }, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] getStats:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // HARMONISATION (propositions de fusion, fusions, rattachements)
  // ==========================================================================

  /** Propositions de l'org par statut (propose | fusionne | refuse ; null = toutes). */
  async listProposals(orgId, statut = null) {
    try {
      if (!orgId) return { data: [], error: null };
      let q = supabase.from('majordhome_catalog_item_proposals').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1000);
      if (statut) q = q.eq('statut', statut);
      const { data, error } = await q;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error('[catalogItemsService] listProposals:', error);
      return { data: [], error };
    }
  },

  /** Relance la proposition de fusions de l'org (edge supplier-catalog-sync, action `matches`, org_admin). */
  async propose(orgId) {
    try {
      if (!orgId) throw new Error('[catalogItemsService] orgId requis');
      const { data, error } = await supabase.functions.invoke('supplier-catalog-sync', { body: { action: 'matches', org_id: orgId } });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] propose:', error);
      return { data: null, error };
    }
  },

  /** Décide des propositions en lot : 'fusionne' | 'refuse' (org_admin). Résout avec le nombre traité. */
  async decideProposals(ids, statut) {
    try {
      if (!Array.isArray(ids) || !ids.length) return { data: 0, error: null };
      const { data, error } = await supabase.rpc('catalog_item_proposals_decide', { p_ids: ids, p_statut: statut });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] decideProposals:', error);
      return { data: null, error };
    }
  },

  /** Fusion explicite : l'absorbé disparaît, ses lignes fournisseur et de devis passent au survivant (org_admin). */
  async merge(survivorId, absorbedId) {
    try {
      if (!survivorId || !absorbedId) throw new Error('[catalogItemsService] deux articles requis');
      const { data, error } = await supabase.rpc('catalog_item_merge', { p_survivor_id: survivorId, p_absorbed_id: absorbedId });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] merge:', error);
      return { data: null, error };
    }
  },

  /** Rattache une ligne fournisseur à un article (org_admin). */
  async attach(productId, itemId) {
    try {
      if (!productId || !itemId) throw new Error('[catalogItemsService] ligne et article requis');
      const { error } = await supabase.rpc('catalog_item_attach', { p_product_id: productId, p_item_id: itemId });
      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] attach:', error);
      return { data: null, error };
    }
  },

  /** Détache une ligne fournisseur : elle reçoit son propre article (org_admin). Résout avec l'id du nouvel article. */
  async detach(productId) {
    try {
      if (!productId) throw new Error('[catalogItemsService] ligne requise');
      const { data, error } = await supabase.rpc('catalog_item_detach', { p_product_id: productId });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] detach:', error);
      return { data: null, error };
    }
  },
};
