// src/lib/devisLigneArticle.js
// Module PUR (aucun import React / Supabase / alias) : réaligne une ligne de devis sur son article après une édition
// de la fiche faite depuis le devis. Testé : node --test scripts/devis-ligne-article.test.mjs
import { lignesCaracteristiques } from './devisCaracteristiques.js';

/** Horodatage en ms, NaN si absent ou illisible. */
function instant(valeur) {
  return valeur ? Date.parse(valeur) : NaN;
}

/**
 * Réaligne une ligne sur la fiche modifiée de son article. Même objet si la fiche n'a pas bougé (`updated_at` non postérieur).
 * Suivent la fiche : libellé, unité, référence (code, sinon vide), caractéristiques (si la ligne les imprime) et le prix
 * unitaire SEULEMENT si la ligne portait encore l'ancien prix de vente (un prix ajusté à la main est conservé).
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
  const suitLePrix = Number(ligne.unit_price_ht) === Number(articleAvant?.selling_price_ht);
  return {
    ...ligne,
    designation: articleApres.name,
    unit: articleApres.unit,
    reference: articleApres.code || '',
    caracteristiques: ligne.show_specs ? lignesCaracteristiques(articleApres, champs) : [],
    unit_price_ht: suitLePrix ? Number(articleApres.selling_price_ht) : ligne.unit_price_ht,
  };
}
