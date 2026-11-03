// src/lib/devisLigneArticle.js
// Module PUR (aucun import React / Supabase / alias) : réaligne une ligne de devis sur son article après une édition
// de la fiche faite depuis le devis. Testé : node --test scripts/devis-ligne-article.test.mjs
import { lignesCaracteristiques } from './devisCaracteristiques.js';
import { SEP } from './catalogue/marqueLigne.js';

/** Horodatage en ms, NaN si absent ou illisible. */
function instant(valeur) {
  return valeur ? Date.parse(valeur) : NaN;
}

/**
 * Réaligne une ligne sur la fiche modifiée de son article. Même objet si la fiche n'a pas bougé (`updated_at` non postérieur).
 * Suivent la fiche : libellé (suffixe « – Marque » recomposé si la ligne a une marque), unité, caractéristiques (si la ligne
 * les imprime), la référence SEULEMENT si elle était l'ancien code de l'article (une référence fournisseur ou saisie est
 * conservée) et le prix unitaire SEULEMENT si la ligne portait encore l'ancien prix de vente (un prix ajusté est conservé).
 * Conservés : quantité, remise, TVA, description, coche des caractéristiques. Le prix d'achat n'est pas touché
 * (il suit la marque et les offres, pas la fiche).
 * @param {object} ligne ligne de devis
 * @param {{ selling_price_ht?: number|string|null, updated_at?: string|null }} articleAvant fiche à l'ouverture de l'éditeur
 * @param {{ name?: string, unit?: string, code?: string|null, selling_price_ht?: number|string|null, updated_at?: string|null, category?: string, specs?: object }} articleApres fiche relue à la fermeture
 * @param {Array<{ key: string, label?: string, unit?: string|null, type?: string, options?: Array<string|{ value: string, label?: string }> }>} champs schéma de la catégorie de l'article
 * @returns {object}
 */
export function realignerLigne(ligne, articleAvant, articleApres, champs) {
  const avant = instant(articleAvant?.updated_at);
  const apres = instant(articleApres?.updated_at);
  if (Number.isNaN(apres) || (!Number.isNaN(avant) && apres <= avant)) return ligne;
  const suitLaReference = (ligne.reference || '') === (articleAvant?.code || '');
  const suitLePrix = Number(ligne.unit_price_ht) === Number(articleAvant?.selling_price_ht);
  return {
    ...ligne,
    designation: ligne.brand ? `${articleApres.name}${SEP}${ligne.brand}` : articleApres.name,
    unit: articleApres.unit,
    reference: suitLaReference ? articleApres.code || '' : ligne.reference,
    caracteristiques: ligne.show_specs ? lignesCaracteristiques(articleApres, champs) : [],
    unit_price_ht: suitLePrix ? Number(articleApres.selling_price_ht) : ligne.unit_price_ht,
  };
}

/**
 * Remet sur les lignes d'un devis le prix de vente courant de leur article (bouton « Rafraîchir les prix » d'un
 * brouillon, geste de l'opérateur — Eric, 2026-11-03 : une ligne est figée à l'enregistrement, c'est lui qui décide de
 * reprendre les prix de la base, par exemple après un relevé de prix publics). Ne change que les lignes produit liées
 * à un article dont le prix de vente est renseigné (> 0) et différent du prix de la ligne ; un prix ajusté à la main est
 * donc remplacé lui aussi (c'est le sens du geste). Les totaux de la ligne suivent (mêmes arrondis que l'écran).
 * Les autres lignes sont renvoyées telles quelles (même objet).
 * @param {Array<object>} lignes lignes du devis
 * @param {Array<{ id: string, selling_price_ht?: number|string|null }>} articles articles relus en base
 * @returns {{ lignes: Array<object>, modifiees: Array<{ designation: string, avant: number, apres: number }>,
 *   sansPrix: Array<object> }} `sansPrix` = lignes produit sans article, article disparu ou article encore à 0
 */
export function rafraichirPrixLignes(lignes, articles) {
  const prixParArticle = new Map((articles || []).map((a) => [a.id, Number(a.selling_price_ht) || 0]));
  const modifiees = [];
  const sansPrix = [];
  const resultat = (lignes || []).map((ligne) => {
    if (ligne.line_type !== 'product') return ligne;
    const prix = ligne.catalog_item_id ? prixParArticle.get(ligne.catalog_item_id) || 0 : 0;
    if (!(prix > 0)) { sansPrix.push(ligne); return ligne; }
    const avant = Number(ligne.unit_price_ht) || 0;
    if (avant === prix) return ligne;
    modifiees.push({ designation: ligne.designation, avant, apres: prix });
    const qte = Number(ligne.quantity) || 0;
    const remise = Number(ligne.discount_percent) || 0;
    const totalHt = Math.round(qte * prix * (1 - remise / 100) * 100) / 100;
    const totalTva = Math.round(totalHt * (Number(ligne.tva_rate) || 0) / 100 * 100) / 100;
    return { ...ligne, unit_price_ht: prix, total_ht: totalHt, total_tva: totalTva, total_ttc: Math.round((totalHt + totalTva) * 100) / 100 };
  });
  return { lignes: resultat, modifiees, sansPrix };
}
