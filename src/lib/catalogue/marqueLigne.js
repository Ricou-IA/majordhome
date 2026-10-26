// src/lib/catalogue/marqueLigne.js
// Marque d'une ligne de devis posée depuis un article de stock (plusieurs marques en offres) — module PUR, testé
// (scripts/catalogue/marque-ligne.test.mjs). Décision d'Eric (2026-10-25) : un article de stock est un TYPE
// (« Disjoncteur 1P+N 16 A courbe C »), la marque se choisit dans le devis ; la marge prend le prix d'achat le plus bas
// de la marque choisie (de toutes les marques si aucune n'est choisie).

export const SEP = ' – ';

/**
 * Marques des offres actives d'un article, une par marque (casse ignorée, première graphie gardée), avec leur prix
 * d'achat le plus bas non nul (null si aucun), triées par prix puis par nom.
 * @param {Array<{ brand?: string|null, purchase_price_ht?: number|null, is_active?: boolean }>|null|undefined} offres
 * @returns {Array<{ marque: string, prix: number|null }>}
 */
export function marquesDesOffres(offres) {
  const parCle = new Map();
  for (const o of offres || []) {
    const marque = String(o?.brand ?? '').trim();
    if (!marque || o?.is_active === false) continue;
    const cle = marque.toLowerCase();
    const prix = Number(o.purchase_price_ht) > 0 ? Number(o.purchase_price_ht) : null;
    const deja = parCle.get(cle);
    if (!deja) parCle.set(cle, { marque, prix });
    else if (prix != null && (deja.prix == null || prix < deja.prix)) deja.prix = prix;
  }
  return [...parCle.values()].sort((a, b) => {
    if (a.prix == null && b.prix != null) return 1;
    if (b.prix == null && a.prix != null) return -1;
    return (a.prix ?? 0) - (b.prix ?? 0) || a.marque.localeCompare(b.marque, 'fr');
  });
}

/** Libellé sans le suffixe « – Marque » de la marque actuellement posée (seul ce suffixe-là est retiré). */
function libelleSansMarque(designation, marqueActuelle) {
  const d = String(designation || '');
  if (!marqueActuelle) return d;
  const suffixe = `${SEP}${marqueActuelle}`;
  return d.toLowerCase().endsWith(suffixe.toLowerCase()) ? d.slice(0, d.length - suffixe.length) : d;
}

/**
 * Applique une marque à une ligne : libellé suffixé « – Marque » (le suffixe de la marque précédente est remplacé,
 * jamais doublé), prix d'achat = le plus bas de la marque. Marque vide ⇒ libellé générique, prix le plus bas toutes
 * marques. Marque absente des offres ⇒ ligne rendue telle quelle.
 * @template {{ designation?: string, brand?: string|null, purchase_price_ht?: number|null }} L
 * @param {L} ligne
 * @param {string|null|undefined} marque
 * @param {Parameters<typeof marquesDesOffres>[0]} offres
 * @returns {L}
 */
export function appliquerMarque(ligne, marque, offres) {
  const marques = marquesDesOffres(offres);
  const voulue = String(marque ?? '').trim();
  const base = libelleSansMarque(ligne.designation, ligne.brand);
  if (!voulue) {
    const prix = marques.map((m) => m.prix).filter((p) => p != null);
    return { ...ligne, brand: null, designation: base, purchase_price_ht: prix.length ? Math.min(...prix) : null };
  }
  const m = marques.find((x) => x.marque.toLowerCase() === voulue.toLowerCase());
  if (!m) return ligne;
  return { ...ligne, brand: m.marque, designation: `${base}${SEP}${m.marque}`, purchase_price_ht: m.prix };
}
