// src/lib/devisCalculs.js
// Calculs d'un devis — module PUR (aucun import), testé (scripts/devis-calculs.test.mjs). Sorti de devis.service.js
// (qui le ré-exporte) pour porter la remise à la ligne (demande d'Eric, 2026-10-25) : total HT d'une ligne =
// quantité × prix unitaire × (1 − remise de ligne), puis remise globale sur le total, ventilée par taux de TVA.

// ============================================================================
// HELPERS CALCUL
// ============================================================================

/**
 * Remise de la ligne en pourcentage (`discount_percent`), bornée à [0, 100] ; illisible ⇒ 0.
 * @param {{ discount_percent?: unknown }} line
 * @returns {number}
 */
export function remiseLigne(line) {
  const n = typeof line?.discount_percent === 'number' ? line.discount_percent : parseFloat(String(line?.discount_percent ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
}

/**
 * Calcule les totaux d'une ligne de devis
 */
export function computeLineTotals(line) {
  if (line.line_type === 'section_title') {
    return { total_ht: 0, total_tva: 0, total_ttc: 0 };
  }
  const qty = parseFloat(line.quantity) || 0;
  const unitPrice = parseFloat(line.unit_price_ht) || 0;
  const tvaRate = parseFloat(line.tva_rate) || 0;

  // remise de ligne appliquée au HT avant TVA (la remise globale vient ensuite, au total)
  const totalHt = Math.round(qty * unitPrice * (1 - remiseLigne(line) / 100) * 100) / 100;
  const totalTva = Math.round(totalHt * tvaRate / 100 * 100) / 100;
  const totalTtc = Math.round((totalHt + totalTva) * 100) / 100;

  return { total_ht: totalHt, total_tva: totalTva, total_ttc: totalTtc };
}

/**
 * Marge brute sur les lignes portant un prix d'achat (fournitures), avant remise globale
 * (qui s'applique au total, pas ligne à ligne). Affichée dans le pied de la modale de devis.
 * @param {Array<object>} lines - lignes du devis
 * @returns {{ nb: number, vente: number, achat: number, marge: number, taux: number }}
 */
export function margeFournitures(lines) {
  const produits = lines.filter((l) => l.line_type !== 'section_title' && l.purchase_price_ht != null && l.purchase_price_ht !== '');
  const vente = produits.reduce((s, l) => s + (parseFloat(l.unit_price_ht) || 0) * (parseFloat(l.quantity) || 0) * (1 - remiseLigne(l) / 100), 0);
  const achat = produits.reduce((s, l) => s + (parseFloat(l.purchase_price_ht) || 0) * (parseFloat(l.quantity) || 0), 0);
  const marge = vente - achat;
  return { nb: produits.length, vente, achat, marge, taux: vente > 0 ? (marge / vente) * 100 : 0 };
}

/**
 * Calcule les totaux globaux du devis avec ventilation TVA
 */
export function computeQuoteTotals(lines, globalDiscountPercent = 0) {
  const discount = parseFloat(globalDiscountPercent) || 0;

  // Somme par taux de TVA
  const tvaBreakdown = {};
  let subtotalHt = 0;

  for (const line of lines) {
    if (line.line_type === 'section_title') continue;
    const { total_ht, total_tva } = computeLineTotals(line);
    subtotalHt += total_ht;

    const rate = parseFloat(line.tva_rate) || 0;
    if (!tvaBreakdown[rate]) {
      tvaBreakdown[rate] = { rate, base_ht: 0, tva_amount: 0 };
    }
    tvaBreakdown[rate].base_ht += total_ht;
    tvaBreakdown[rate].tva_amount += total_tva;
  }

  // Remise globale
  const discountAmount = Math.round(subtotalHt * discount / 100 * 100) / 100;
  const totalHtAfterDiscount = Math.round((subtotalHt - discountAmount) * 100) / 100;

  // Appliquer la remise proportionnellement sur chaque tranche TVA
  const ratio = subtotalHt > 0 ? totalHtAfterDiscount / subtotalHt : 0;
  let totalTva = 0;
  const tvaDetails = Object.values(tvaBreakdown).map((t) => {
    const adjustedBase = Math.round(t.base_ht * ratio * 100) / 100;
    const adjustedTva = Math.round(adjustedBase * t.rate / 100 * 100) / 100;
    totalTva += adjustedTva;
    return { rate: t.rate, base_ht: adjustedBase, tva_amount: adjustedTva };
  });

  totalTva = Math.round(totalTva * 100) / 100;
  const totalTtc = Math.round((totalHtAfterDiscount + totalTva) * 100) / 100;

  return {
    subtotal_ht: subtotalHt,
    discount_amount: discountAmount,
    total_ht: totalHtAfterDiscount,
    total_tva: totalTva,
    total_ttc: totalTtc,
    tva_breakdown: tvaDetails,
  };
}
