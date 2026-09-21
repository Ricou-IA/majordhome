// src/lib/contractPricing.js
// ============================================================================
// Calcul tarifaire d'un contrat d'entretien — module PUR (aucun import React /
// Supabase), testé par scripts/entretien-invoice-model.test.mjs.
//
// Sorti de pricing.service.js le 2026-09-21 pour être partagé entre l'écran de
// signature, le PDF contrat, la configuration tarifaire ET la facture Pennylane
// (une facture qui recalculerait ses lignes autrement que le contrat signé
// serait un bug). pricing.service.js ré-exporte ces fonctions : les appelants
// existants ne changent pas.
// ============================================================================

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

/**
 * Calcule le prix d'une ligne tarifaire.
 * Le zoneSupplement (déplacement) est ajouté une fois par ligne d'équipement.
 * Note : les splits (unit_pricing) comptent comme 1 seul équipement pour la remise.
 */
export function calculateLineTotal(rate, equipType, quantity = 1, zoneSupplement = 0) {
  if (!rate) return 0;

  const basePrice = parseFloat(rate.price) || 0;
  const supplement = parseFloat(zoneSupplement) || 0;

  if (equipType?.has_unit_pricing) {
    const unitPrice = parseFloat(rate.unit_price) || 0;
    const included = equipType.included_units || 0;
    const extra = Math.max(0, quantity - included);
    return basePrice + extra * unitPrice + supplement;
  }

  return basePrice + supplement;
}

/**
 * Calcule le montant total d'un contrat à partir des lignes tarifaires.
 * Accepte les deux formats : camelCase (frontend) et snake_case (DB).
 * total = sous-total − dégressivité − remise exceptionnelle (`contracts.exceptional_discount`,
 * saisie Tarification, 2026-09-21 : ajuste le montant global à l'euro près sans forcer chaque ligne).
 */
export function calculateContractTotal(items, discounts = [], exceptionalDiscount = 0) {
  const exceptional = round2(Math.max(0, parseFloat(exceptionalDiscount) || 0));
  if (!items?.length) return { subtotal: 0, discountPercent: 0, discountAmount: 0, exceptionalDiscount: exceptional, total: 0 };

  // Supporter camelCase (lineTotal) et snake_case (line_total)
  const subtotal = items.reduce((sum, item) => {
    const val = item.lineTotal ?? item.line_total ?? 0;
    return sum + (parseFloat(val) || 0);
  }, 0);

  // Nombre d'équipements (1 item = 1 équipement pour la remise)
  const equipmentCount = items.reduce((count, item) => {
    const val = item.lineTotal ?? item.line_total ?? 0;
    if (parseFloat(val) <= 0) return count;
    return count + 1;
  }, 0);

  // Trouver la remise applicable (plus grande remise dont le seuil est atteint)
  const applicableDiscount = discounts
    .filter((d) => d.is_active !== false && equipmentCount >= d.min_equipments)
    .sort((a, b) => b.min_equipments - a.min_equipments)[0];

  const discountPercent = applicableDiscount?.discount_percent || 0;
  const discountAmount = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - discountAmount - exceptional) * 100) / 100);

  return { subtotal, discountPercent, discountAmount, exceptionalDiscount: exceptional, total };
}

/**
 * Lignes tarifaires d'un contrat : 1 ligne par équipement au prix grille de la zone
 * (ou prix forcé par ligne), puis dégressivité — exactement le calcul de l'écran
 * de signature (`ContractSign`) et du PDF contrat.
 *
 * @param {object} p
 * @param {Array} p.equipments      équipements du contrat (`majordhome_equipments`)
 * @param {Array} p.rates           `majordhome_pricing_rates` (zone_id × equipment_type_id)
 * @param {Array} p.equipmentTypes  `majordhome_pricing_equipment_types`
 * @param {object|null} p.zone      zone tarifaire active (`supplement` = déplacement)
 * @param {Object<string, number>} [p.overrides]  prix forcé par `equipment.id`
 * @param {Array} [p.discounts]     `majordhome_pricing_discounts`
 * @param {number} [p.exceptionalDiscount]  `contracts.exceptional_discount` (€ TTC, après dégressivité)
 * @returns {{ items: Array, subtotal: number, discountPercent: number, discountAmount: number, exceptionalDiscount: number, total: number }}
 */
export function computeContractLines({ equipments = [], rates = [], equipmentTypes = [], zone = null, overrides = {}, discounts = [], exceptionalDiscount = 0 }) {
  const rateIndex = {};
  for (const r of rates || []) {
    const zId = r.zone_id || r.zone?.id;
    const etId = r.equipment_type_id || r.equipment_type?.id;
    if (zId && etId) rateIndex[`${zId}_${etId}`] = r;
  }
  const typeById = {};
  for (const et of equipmentTypes || []) typeById[et.id] = et;
  const zoneSupplement = parseFloat(zone?.supplement || 0);

  const items = (equipments || []).map((eq) => {
    const etId = eq.equipment_type_id || null;
    const rate = etId && zone ? rateIndex[`${zone.id}_${etId}`] || null : null;
    const equipType = etId ? typeById[etId] || null : null;
    const unitCount = eq.unit_count || 1;
    // Prix forcé par ligne (override) → substitue le prix grille ; dégressivité appliquée en aval.
    const ov = overrides?.[eq.id];
    const lineTotal = ov != null ? ov : calculateLineTotal(rate, equipType, unitCount, zoneSupplement);
    // Référence : "Marque · Modèle · Année · Pose · N splits"
    const refParts = [
      eq.brand,
      eq.model,
      eq.installation_year,
      eq.installation_type === 'ventouse' ? 'Pose ventouse' : eq.installation_type === 'verticale' ? 'Pose verticale' : null,
      unitCount > 1 && equipType?.unit_label ? `${unitCount} ${equipType.unit_label}s` : null,
    ].filter(Boolean);
    const label = equipType?.label || 'Équipement';
    // « PAC Air/Air (2 splits) » — le nombre d'unités fait partie de la prestation
    // (barème par split), il doit se lire sur la facture comme sur la Tarification.
    const unitsSuffix = unitCount > 1 && equipType?.unit_label ? ` (${unitCount} ${equipType.unit_label}s)` : '';
    return {
      equipmentId: eq.id,
      equipmentTypeId: etId,
      equipment: eq,
      label,
      labelWithUnits: label + unitsSuffix,
      unitCount,
      reference: refParts.length > 0 ? refParts.join(' · ') : null,
      quantity: unitCount,
      basePrice: rate ? parseFloat(rate.price) : 0,
      lineTotal,
    };
  });

  return { items, ...calculateContractTotal(items, discounts, exceptionalDiscount) };
}

/**
 * Construit la présentation tarifaire (lignes équipement + remises) cohérente avec
 * le montant RÉELLEMENT facturé, qu'il soit calculé depuis la grille ou forcé par
 * un admin. Garantit toujours que la somme des lignes (± remises) retombe sur le total.
 *
 * Trois cas :
 *  - billable ≈ computedTotal (calcul grille standard) :
 *      lignes au prix grille + dégressivité éventuelle, pas de remise commerciale.
 *  - billable < computedTotal (forçage à la BAISSE) :
 *      lignes au prix grille + ligne "Remise commerciale" = computedTotal − billable.
 *  - billable > computedTotal (forçage à la HAUSSE) :
 *      les prix d'articles sont MAJORÉS au prorata de leur prix grille pour que la
 *      somme des lignes = montant facturé. Pas de remise négative ni de dégressivité
 *      affichée (absorbées dans les prix de ligne). Un équipement unique forcé à 350 €
 *      voit simplement sa ligne passer à 350 €.
 *
 * @param {{items:Array, subtotal:number, discountPercent:number, discountAmount:number, total:number}|null} computedPricing
 * @param {number} billableTotal - montant facturé (forcé ou calculé)
 * @returns {{equipmentLines:Array, subtotal:number, discountPercent:number, discountAmount:number, extraDiscountAmount:number, total:number}}
 */
export function buildContractPresentation(computedPricing, billableTotal) {
  const items = computedPricing?.items || [];
  const computedTotal = computedPricing?.total || 0;
  const billable = round2(billableTotal);

  // Index des lignes réellement chiffrées (lineTotal > 0) — les lignes "Sur devis"
  // (lineTotal = 0) restent inchangées et ne reçoivent jamais de prix redistribué.
  const pricedIndexes = items
    .map((it, i) => ((parseFloat(it.lineTotal) || 0) > 0 ? i : -1))
    .filter((i) => i >= 0);

  // --- Forçage à la hausse : majorer les lignes pour que leur somme = montant facturé ---
  if (pricedIndexes.length > 0 && billable > computedTotal + 0.01) {
    const baseSum = pricedIndexes.reduce((s, i) => s + parseFloat(items[i].lineTotal), 0);
    const remainderIdx = pricedIndexes[pricedIndexes.length - 1]; // absorbe l'arrondi
    let allocated = 0;
    const equipmentLines = items.map((it, i) => {
      if (!pricedIndexes.includes(i)) return it; // ligne "Sur devis" : inchangée
      if (i === remainderIdx) return { ...it, lineTotal: round2(billable - allocated) };
      const price = round2(billable * (parseFloat(it.lineTotal) / baseSum));
      allocated += price;
      return { ...it, lineTotal: price };
    });
    return {
      equipmentLines,
      subtotal: billable,
      discountPercent: 0,
      discountAmount: 0,
      exceptionalDiscountAmount: 0,
      extraDiscountAmount: 0,
      total: billable,
    };
  }

  // --- Calcul standard / forçage à la baisse : remise commerciale absorbe l'écart ---
  // La remise exceptionnelle (saisie sur le contrat) est déjà dans computedTotal : elle
  // s'affiche à part, la « remise commerciale » ne porte que l'écart legacy (amount_forced).
  const extraDiscountAmount = billable < computedTotal - 0.01 ? round2(computedTotal - billable) : 0;
  return {
    equipmentLines: items,
    subtotal: computedPricing?.subtotal || 0,
    discountPercent: computedPricing?.discountPercent || 0,
    discountAmount: computedPricing?.discountAmount || 0,
    exceptionalDiscountAmount: computedPricing?.exceptionalDiscount || 0,
    extraDiscountAmount,
    total: billable,
  };
}
