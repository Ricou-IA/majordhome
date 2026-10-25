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
import { storageService } from '@services/storage.service';
import { escapeSearchTermKeepingDecimals } from '@/lib/postgrestUtils';
import { logger } from '@lib/logger';
import { SEUIL_FRAICHEUR_JOURS } from '@/lib/catalogue/ageDePrix.js';

/** Filtre « sans offre fraîche » de la page Articles (indicatif : l'âge du prix ne décide de rien au devis, spec § 9). */
function dateSeuilFraicheur(now = new Date()) {
  return new Date(now.getTime() - SEUIL_FRAICHEUR_JOURS * 86400000).toISOString();
}

/** Appel de l'edge catalog-item-enrich ; le message d'erreur de l'edge (« recherche trop longue »…) remonte tel quel. */
async function appelEnrichissement(body, etape) {
  try {
    if (!body.org_id || !body.item_id) throw new Error('[catalogItemsService] orgId et itemId requis');
    const { data, error } = await supabase.functions.invoke('catalog-item-enrich', { body });
    if (error) {
      let detail = null;
      try { detail = await error.context?.json?.(); } catch { /* corps illisible */ }
      throw new Error(detail?.error || error.message);
    }
    return { data, error: null };
  } catch (error) {
    logger.error(`[catalogItemsService] ${etape}:`, error);
    return { data: null, error };
  }
}

/**
 * Mots d'une recherche, normalisés comme la colonne `recherche` de la vue liste (NFD sans diacritiques, minuscules ;
 * « œ » n'est décomposé d'aucun côté) puis échappés pour PostgREST. Chaque mot doit apparaître quelque part.
 * @param {string} search
 * @returns {string[]}
 */
export function motsDeRecherche(search) {
  return String(search || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/\s+/)
    .map((m) => escapeSearchTermKeepingDecimals(m))
    .filter((m) => m && m.length >= 1)
    .slice(0, 8);
}

export const catalogItemsService = {
  /**
   * Articles de l'org, paginés. `categories` vide = toutes ; `sansCategorie` = seulement les articles sans catégorie ;
   * `natures` = valeurs de product_kind (vide = toutes) ; `proposable` = proposable au devis (au moins une offre
   * active, ou aucune offre jamais : article créé à la main, main d'œuvre) ; `sansOffreFraiche` = aucune offre active
   * de moins de 30 jours ; `actifsSeulement` (défaut) exclut les désactivés et les absorbés. La recherche porte sur
   * chaque mot, sans accents, dans le libellé, la marque, la gamme, la clé modèle, l'EAN et les références fournisseur.
   */
  async listItems(orgId, {
    search = '', categories = [], natures = [], brand = null, gamme = null, sansCategorie = false, sansOffreFraiche = false,
    proposable = false, actifsSeulement = true, page = 0, pageSize = 50,
  } = {}) {
    try {
      if (!orgId) return { data: [], count: 0, error: null };
      let q = supabase.from('majordhome_catalog_items_list').select('*', { count: 'exact' }).eq('org_id', orgId).is('merged_into', null);
      if (actifsSeulement) q = q.eq('is_active', true);
      if (proposable) q = q.or('offres_actives.gt.0,offres_total.eq.0');
      if (natures?.length) q = q.in('product_kind', natures);
      if (sansCategorie) q = q.is('category', null);
      else if (categories?.length) q = q.in('category', categories);
      if (brand) q = q.eq('brand', brand);
      if (gamme) q = q.eq('gamme', gamme);
      if (sansOffreFraiche) q = q.or(`prix_le_plus_recent.is.null,prix_le_plus_recent.lt.${dateSeuilFraicheur()}`);
      for (const mot of motsDeRecherche(search)) q = q.ilike('recherche', `%${mot}%`);
      q = q.order('name').range(page * pageSize, page * pageSize + pageSize - 1);
      const { data, count, error } = await q;
      if (error) throw error;
      return { data: data || [], count: count || 0, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] listItems:', error);
      return { data: [], count: 0, error };
    }
  },

  /** Nom et nombre de lignes de quelques articles (≤ 150 ids, la liste part dans l'URL) : article actuel des lignes candidates. */
  async getItemsResume(orgId, ids = []) {
    try {
      if (!orgId || !ids.length) return { data: [], error: null };
      const { data, error } = await supabase.from('majordhome_catalog_items_list').select('id, name, offres_total')
        .eq('org_id', orgId).in('id', ids.slice(0, 150));
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error('[catalogItemsService] getItemsResume:', error);
      return { data: [], error };
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

  /**
   * Crée un article à la main (org_admin via RLS) : depuis le devis ou la page Articles. `productKind` : main
   * (équipement), accessory (option), stock, main_oeuvre. Résout avec la ligne de la vue liste.
   */
  async createItem(orgId, { name, brand = null, category = null, gamme = null, productKind = 'main', unit = 'pièce', sellingPriceHt = 0, description = null } = {}) {
    try {
      if (!orgId) throw new Error('[catalogItemsService] orgId requis');
      const libelle = String(name || '').trim();
      if (!libelle) throw new Error('Le libellé est requis');
      const { data, error } = await supabase.from('majordhome_catalog_items').insert({
        org_id: orgId, name: libelle, brand: brand?.trim() || null, category: category || null, gamme: gamme?.trim() || null,
        product_kind: productKind || 'main', unit: unit || 'pièce', selling_price_ht: Number(sellingPriceHt) || 0,
        description: description?.trim() || null, origin: 'manuel', default_tva_rate: 20,
      }).select('id').single();
      if (error) {
        if (error.code === '42501') throw new Error('Création réservée à l\'administrateur');
        throw error;
      }
      const { data: item, error: errItem } = await this.getItem(orgId, data.id);
      if (errItem) throw errItem;
      return { data: item, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] createItem:', error);
      return { data: null, error };
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

  // ==========================================================================
  // DOCUMENTS DE L'ARTICLE (photo, fiche technique : métadonnées de l'article — décision d'Eric, 2026-10-25)
  // ==========================================================================

  /**
   * Documents d'un article : ceux posés sur l'article ET ceux de ses lignes fournisseur, une seule liste sans doublon
   * (même nom de fichier ⇒ celui de l'article d'abord). Chaque document dit d'où il vient (`origine`).
   */
  async getItemDocuments(orgId, itemId, productIds = []) {
    try {
      if (!orgId || !itemId) return { data: [], error: null };
      const filtres = [`catalog_item_id.eq.${itemId}`];
      if (productIds.length) filtres.push(`supplier_product_id.in.(${productIds.join(',')})`);
      const { data, error } = await supabase.from('majordhome_product_documents').select('*').eq('org_id', orgId)
        .or(filtres.join(',')).order('created_at', { ascending: false });
      if (error) throw error;
      const tries = [...(data || [])].sort((a, b) => (a.catalog_item_id ? 0 : 1) - (b.catalog_item_id ? 0 : 1));
      const vus = new Set();
      const uniques = tries.filter((d) => { const k = String(d.file_name || '').toLowerCase(); if (vus.has(k)) return false; vus.add(k); return true; });
      return { data: uniques.map((d) => ({ ...d, origine: d.catalog_item_id ? 'article' : 'fournisseur' })), error: null };
    } catch (error) {
      logger.error('[catalogItemsService] getItemDocuments:', error);
      return { data: [], error };
    }
  },

  /** Ajoute un document à l'article (bucket product-documents, `${orgId}/articles/${itemId}/…`). */
  async uploadItemDocument({ orgId, itemId, file, documentType = 'Fiche technique', userId = null }) {
    try {
      if (!orgId || !itemId || !file) throw new Error('[catalogItemsService] orgId, itemId et file requis');
      const ext = (file.name || 'document').split('.').pop().toLowerCase();
      const storagePath = `${orgId}/articles/${itemId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await storageService.uploadFile('product-documents', storagePath, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data, error } = await supabase.from('majordhome_product_documents_write').insert({
        catalog_item_id: itemId, org_id: orgId, document_type: documentType || 'Fiche technique', file_name: file.name,
        storage_path: storagePath, file_size: file.size, mime_type: file.type, uploaded_by: userId,
      }).select().single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] uploadItemDocument:', error);
      return { data: null, error };
    }
  },

  /** Retire un document posé sur l'article (ceux des lignes fournisseur se gèrent sur la ligne). */
  async deleteItemDocument(orgId, doc) {
    try {
      if (!orgId || !doc?.id || !doc.catalog_item_id) throw new Error('Seuls les documents de l\'article se retirent ici');
      const { error } = await supabase.from('majordhome_product_documents_write').delete().eq('id', doc.id).eq('org_id', orgId);
      if (error) throw error;
      if (doc.storage_path) await storageService.deleteFile('product-documents', doc.storage_path);
      return { data: true, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] deleteItemDocument:', error);
      return { data: null, error };
    }
  },

  /** Marques distinctes des articles actifs de l'org, limitées à des catégories (vide = toutes). */
  async getDistinctBrands(orgId, categories = []) {
    try {
      if (!orgId) return { data: [], error: null };
      let q = supabase.from('majordhome_catalog_items_list').select('brand').eq('org_id', orgId)
        .eq('is_active', true).is('merged_into', null).not('brand', 'is', null).limit(5000);
      if (categories?.length) q = q.in('category', categories);
      const { data, error } = await q;
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

  /** Crée l'article d'une ligne fournisseur qui n'en a pas (saisie manuelle, variante) — org_admin. Résout avec l'id. */
  async createForProduct(productId) {
    try {
      if (!productId) throw new Error('[catalogItemsService] ligne requise');
      const { data, error } = await supabase.rpc('catalog_item_create_for_product', { p_product_id: productId });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('[catalogItemsService] createForProduct:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // ENRICHISSEMENT WEB (edge catalog-item-enrich, org_admin — décision d'Eric, 2026-10-25)
  // ==========================================================================

  /**
   * Proposition de l'IA (recherche web) : photo, fiche PDF, page source, caractéristiques des `champs` du schéma de la
   * catégorie. Rien n'est écrit. Résout avec `{ photo_url, photo_refus, fiche_url, fiche_refus, source_url, specs, remarque }`.
   */
  async proposeEnrichment(orgId, itemId, champs = []) {
    return appelEnrichissement({ action: 'propose', org_id: orgId, item_id: itemId, champs }, 'proposeEnrichment');
  },

  /**
   * Applique ce que l'admin a coché : `{ photoUrl?, ficheUrl?, specs? }`. Résout avec `{ photo, document,
   * specs_appliquees, erreurs }` — un élément en échec n'empêche pas les autres, l'échec est dans `erreurs`.
   */
  async applyEnrichment(orgId, itemId, { photoUrl = null, ficheUrl = null, specs = {} } = {}) {
    return appelEnrichissement({ action: 'apply', org_id: orgId, item_id: itemId, photo_url: photoUrl, fiche_url: ficheUrl, specs }, 'applyEnrichment');
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
