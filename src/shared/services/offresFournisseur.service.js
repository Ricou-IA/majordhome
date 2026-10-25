/**
 * offresFournisseur.service.js — Offre de prix fournisseur (PDF) importée dans un devis ou au catalogue
 * ============================================================================
 * Demande d'Eric (2026-10-25). Lecture du PDF et écriture au catalogue : edge `supplier-offer-import`
 * (extract : tout membre ; apply : org_admin, via l'écrivain unique supplier_catalog_upsert). Rapprochement : lectures
 * sous RLS (lignes du fournisseur aux références de l'offre, articles candidats) ; le classement est fait par le
 * module pur src/lib/catalogue/offreRapprochement.js. Retour : toujours { data, error }, jamais throw au caller.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { logger } from '@lib/logger';
import { calculerModelKey } from '@/lib/catalogue/modelKey.js';
import { catalogItemsService } from '@services/catalogItems.service';

const PDF_MAX = 8 * 1024 * 1024;
const COLONNES_ARTICLE = 'id, name, brand, model_key, product_kind, unit, selling_price_ht, meilleur_prix_achat, fournisseurs';

/** Contenu d'un fichier en base64 (par morceaux : String.fromCharCode(...) d'un gros tableau dépasse la pile). */
async function enBase64(file) {
  const octets = new Uint8Array(await file.arrayBuffer());
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

/** Appel de l'edge ; le message d'erreur de l'edge remonte tel quel. */
async function appel(body, etape) {
  try {
    const { data, error } = await supabase.functions.invoke('supplier-offer-import', { body });
    if (error) {
      let detail = null;
      try { detail = await error.context?.json?.(); } catch { /* corps illisible */ }
      throw new Error(detail?.error || error.message);
    }
    return { data, error: null };
  } catch (error) {
    logger.error(`[offresFournisseurService] ${etape}:`, error);
    return { data: null, error };
  }
}

/** Deux mots les plus longs d'un libellé (lettres, ≥ 4 caractères) : la recherche exige chaque mot. */
function motsCles(designation) {
  return [...new Set(String(designation || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter((m) => m.length >= 4 && /[a-z]/.test(m)))]
    .sort((a, b) => b.length - a.length).slice(0, 2);
}

export const offresFournisseurService = {
  /** Lit l'offre PDF (IA). Résout { offre, controle, modele, conso } — n'écrit rien. */
  async extraire(orgId, file) {
    if (!orgId || !file) return { data: null, error: new Error('[offresFournisseurService] orgId et fichier requis') };
    if (file.type && file.type !== 'application/pdf') return { data: null, error: new Error('Déposez un fichier PDF') };
    if (file.size > PDF_MAX) return { data: null, error: new Error('PDF trop lourd (plus de 8 Mo)') };
    try {
      const pdf = await enBase64(file);
      return appel({ action: 'extract', org_id: orgId, pdf_base64: pdf, file_name: file.name }, 'extraire');
    } catch (error) {
      logger.error('[offresFournisseurService] extraire:', error);
      return { data: null, error };
    }
  },

  /**
   * Écrit les lignes validées au catalogue du fournisseur (org_admin) : créations et prix d'achat. Résout
   * { resultat, produits: [{ id, reference, catalog_item_id }], ecartees }.
   */
  async appliquer(orgId, supplierId, offre, lignes) {
    if (!orgId || !supplierId || !lignes?.length) return { data: null, error: new Error('[offresFournisseurService] fournisseur et lignes requis') };
    return appel({ action: 'apply', org_id: orgId, supplier_id: supplierId, offre: { numero: offre?.numero ?? null, date: offre?.date ?? null }, lignes }, 'appliquer');
  },

  /**
   * Données du rapprochement : lignes du fournisseur aux références de l'offre, articles candidats (même référence
   * chez un autre fournisseur, même clé modèle, mots du libellé), avec les références de leurs lignes fournisseur.
   * Résout { produits, candidats: [{ article, references }], articlesParId: Map }.
   */
  async rapprochement(orgId, supplierId, lignes) {
    try {
      if (!orgId || !lignes?.length) return { data: { produits: [], candidats: [], articlesParId: new Map() }, error: null };
      const refs = [...new Set(lignes.flatMap((l) => [l.code, l.ref_fabricant]).filter(Boolean))].slice(0, 300);
      const cles = [...new Set(lignes.map((l) => calculerModelKey(l.marque || null, [l.ref_fabricant])).filter(Boolean))];

      const requetes = [
        // lignes de TOUS les fournisseurs à ces références (le fournisseur choisi + même référence fabricant ailleurs)
        refs.length
          ? supabase.from('majordhome_supplier_products')
            .select('id, supplier_id, reference, name, catalog_item_id, purchase_price_ht, purchase_price_at, is_active')
            .eq('org_id', orgId).in('reference', refs)
          : Promise.resolve({ data: [], error: null }),
        cles.length
          ? supabase.from('majordhome_catalog_items_list').select(COLONNES_ARTICLE)
            .eq('org_id', orgId).eq('is_active', true).is('merged_into', null).in('model_key', cles)
          : Promise.resolve({ data: [], error: null }),
      ];
      const [r1, r2] = await Promise.all(requetes);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      const parMots = await Promise.all(lignes.map((l) => {
        const mots = motsCles(l.designation);
        return mots.length ? catalogItemsService.listItems(orgId, { search: mots.join(' '), pageSize: 6 }) : Promise.resolve({ data: [], error: null });
      }));
      const echec = parMots.find((r) => r.error);
      if (echec) throw echec.error;

      const lignesTrouvees = r1.data || [];
      const produits = supplierId ? lignesTrouvees.filter((p) => p.supplier_id === supplierId) : [];
      const articles = new Map();
      for (const a of [...(r2.data || []), ...parMots.flatMap((r) => r.data || [])]) articles.set(a.id, a);
      // articles des lignes trouvées par référence, pas encore chargés
      const manquants = [...new Set(lignesTrouvees.map((p) => p.catalog_item_id).filter((id) => id && !articles.has(id)))];
      if (manquants.length) {
        const { data, error } = await supabase.from('majordhome_catalog_items_list').select(COLONNES_ARTICLE)
          .eq('org_id', orgId).in('id', manquants.slice(0, 150));
        if (error) throw error;
        for (const a of data || []) articles.set(a.id, a);
      }
      const refsParArticle = new Map();
      for (const p of lignesTrouvees) {
        if (!p.catalog_item_id) continue;
        if (!refsParArticle.has(p.catalog_item_id)) refsParArticle.set(p.catalog_item_id, new Set());
        refsParArticle.get(p.catalog_item_id).add(p.reference);
      }
      const candidats = [...articles.values()].map((article) => ({ article, references: [...(refsParArticle.get(article.id) || [])] }));
      return { data: { produits, candidats, articlesParId: articles }, error: null };
    } catch (error) {
      logger.error('[offresFournisseurService] rapprochement:', error);
      return { data: null, error };
    }
  },

  /** Articles (vue liste) par ids — ceux créés ou rattachés par l'écriture au catalogue. */
  async articles(orgId, ids = []) {
    try {
      if (!orgId || !ids.length) return { data: [], error: null };
      const { data, error } = await supabase.from('majordhome_catalog_items_list').select(COLONNES_ARTICLE)
        .eq('org_id', orgId).in('id', ids.slice(0, 150));
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error('[offresFournisseurService] articles:', error);
      return { data: [], error };
    }
  },
};
