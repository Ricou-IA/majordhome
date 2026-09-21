// src/lib/entretienInvoiceModel.js
// ============================================================================
// Modèle de facture d'un entretien (push Majord'home → Pennylane).
// Module PUR : aucun import React / Supabase. Testé par
// scripts/entretien-invoice-model.test.mjs (inclus dans audit:quality).
//
// Règles (spec 2026-09-21-facturation-entretien-pennylane-push-design.md) :
//  - les lignes sont les lignes tarifaires ENREGISTRÉES du contrat, mises à
//    l'échelle du montant contractuel figé (`contract.amount`) — la facture porte
//    le prix facturé, jamais le prix catalogue ni une ligne de remise ;
//  - TVA par ligne = TVA par défaut de la catégorie du type d'équipement ;
//    catégorie sans TVA → 20 % + avertissement (jamais silencieux) ;
//  - les pièces non offertes du certificat s'ajoutent sur la même facture, à
//    la TVA de la première ligne d'équipement ;
//  - montants MDH en TTC → HT = TTC / (1 + taux), 10 décimales (Pennylane
//    recalcule et arrondit, comme la saisie manuelle `81.81818181818181`).
// ============================================================================

/** Taux de TVA (en %) → code Pennylane. Un taux absent = erreur bloquante. */
export const VAT_CODES = { 20: 'FR_200', 10: 'FR_100', 5.5: 'FR_055', 0: 'exempt' };

export const DEFAULT_VAT_PERCENT = 20;
export const DEFAULT_DEADLINE_DAYS = 30;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** HT unitaire à partir d'un TTC total, 10 décimales sans zéros de queue (chaîne, exigée par PL). */
function unitHt(totalTtc, quantity, vatPercent) {
  const ht = totalTtc / (quantity || 1) / (1 + vatPercent / 100);
  return ht.toFixed(10).replace(/\.?0+$/, '');
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** « Marque · Modèle · N° série » d'un équipement, ou null si rien de renseigné. */
export function referenceEquipement(eq) {
  if (!eq) return null;
  const parts = [eq.brand, eq.model, eq.serial_number ? `N° ${eq.serial_number}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * TVA (en %) d'un type d'équipement via sa catégorie. `null` si non configurée.
 * @param {string|null} typeId
 * @param {{ typesById: Map, categoriesById: Map }} referentiel
 */
function vatForType(typeId, referentiel) {
  const type = typeId ? referentiel?.typesById?.get(typeId) : null;
  const cat = type?.category_id ? referentiel?.categoriesById?.get(type.category_id) : null;
  const v = cat?.default_vat_rate;
  return v == null || v === '' ? null : Number(v);
}

function categoryLabelForEquipment(eq, referentiel) {
  const byType = eq?.equipment_type_id ? referentiel?.typesById?.get(eq.equipment_type_id) : null;
  const catId = byType?.category_id ?? eq?.category_id ?? null;
  return catId ? referentiel?.categoriesById?.get(catId)?.label ?? null : null;
}

/**
 * Construit le modèle de facture d'un entretien.
 *
 * @param {object} p
 * @param {{ id: string }} p.intervention
 * @param {{ id?: string, contract_number?: string, amount: number|string }} p.contract
 * @param {Array<{ equipment_id?: string, equipment_type_id?: string, equipment_type_label?: string, quantity?: number, line_total: number|string }>} p.pricingItems
 * @param {Array<{ id: string, brand?: string, model?: string, serial_number?: string, equipment_type_id?: string, category_id?: string }>} p.equipments
 * @param {Array<{ designation?: string, quantite?: number|string, prix_ht?: number|string, offert?: boolean }>} p.parts  pièces du certificat (`prix_ht` contient du TTC, convention Phase 1)
 * @param {{ typesById: Map, categoriesById: Map }} p.referentiel  index `indexReferentiel()`
 * @param {number} [p.deadlineDays]
 * @param {string} p.today  YYYY-MM-DD
 * @returns {{ date: string, deadline: string, subject: string, lines: Array, totalTtc: number, warnings: Array<{code:string,message:string}>, errors: Array<{code:string,message:string}> }}
 */
export function buildEntretienInvoice({
  intervention,
  contract,
  pricingItems = [],
  equipments = [],
  parts = [],
  referentiel,
  deadlineDays = DEFAULT_DEADLINE_DAYS,
  today,
}) {
  const warnings = [];
  const errors = [];
  const lines = [];
  const contractNumber = contract?.contract_number || (contract?.id ? `CTR-${String(contract.id).slice(0, 8).toUpperCase()}` : '');
  const date = today;
  const deadline = addDaysIso(today, Number(deadlineDays) || DEFAULT_DEADLINE_DAYS);

  const amount = round2(contract?.amount);
  if (!(amount > 0)) {
    errors.push({ code: 'montant_contrat_nul', message: 'Le contrat n’a pas de montant : rien à facturer.' });
    return { date, deadline, subject: '', lines, totalTtc: 0, warnings, errors, interventionId: intervention?.id };
  }

  const equipmentsById = new Map((equipments || []).map((e) => [e.id, e]));

  const resolveVat = (typeId, label) => {
    const v = vatForType(typeId, referentiel);
    if (v == null) {
      warnings.push({
        code: 'tva_par_defaut',
        message: `TVA ${DEFAULT_VAT_PERCENT} % appliquée par défaut sur « ${label} » : la catégorie de l’équipement n’a pas de TVA configurée (Paramètres → Équipements).`,
      });
      return DEFAULT_VAT_PERCENT;
    }
    return v;
  };

  const pushLine = (line) => {
    const vatCode = VAT_CODES[line.vatPercent];
    if (!vatCode) {
      errors.push({ code: 'tva_inconnue', message: `Taux de TVA ${line.vatPercent} % sans équivalent Pennylane sur « ${line.label} ».` });
    }
    lines.push({
      ...line,
      totalTtc: round2(line.totalTtc),
      vatCode: vatCode || null,
      unitPriceHt: unitHt(round2(line.totalTtc), line.quantity, line.vatPercent),
    });
  };

  // --- Lignes d'équipement : lignes enregistrées, mises à l'échelle du montant contractuel ---
  const priced = (pricingItems || []).filter((it) => (Number(it.line_total) || 0) > 0);
  const subjectRefs = [];
  if (priced.length > 0) {
    const base = priced.reduce((s, it) => s + Number(it.line_total), 0);
    let allocated = 0;
    priced.forEach((it, i) => {
      const last = i === priced.length - 1;
      const ttc = last ? round2(amount - allocated) : round2(amount * (Number(it.line_total) / base));
      allocated += ttc;
      const eq = it.equipment_id ? equipmentsById.get(it.equipment_id) : null;
      const label = it.equipment_type_label || referentiel?.typesById?.get(it.equipment_type_id)?.label || 'Entretien';
      const ref = referenceEquipement(eq);
      if (ref) subjectRefs.push({ ref, category: categoryLabelForEquipment(eq, referentiel) });
      pushLine({
        kind: 'contrat',
        label,
        description: ref,
        quantity: 1,
        vatPercent: resolveVat(it.equipment_type_id || eq?.equipment_type_id, label),
        totalTtc: ttc,
      });
    });
  } else {
    const firstEq = equipments?.[0] || null;
    const label = `Contrat d’entretien ${contractNumber}`.trim();
    const ref = referenceEquipement(firstEq);
    if (ref) subjectRefs.push({ ref, category: categoryLabelForEquipment(firstEq, referentiel) });
    pushLine({
      kind: 'contrat',
      label,
      description: ref,
      quantity: 1,
      vatPercent: resolveVat(firstEq?.equipment_type_id, label),
      totalTtc: amount,
    });
  }

  // --- Pièces non offertes, TVA de la première ligne d'équipement ---
  const partsVat = lines[0]?.vatPercent ?? DEFAULT_VAT_PERCENT;
  for (const part of parts || []) {
    if (part?.offert) continue;
    const qty = Number(part.quantite) || 1;
    const unitTtc = Number(part.prix_ht) || 0;
    if (unitTtc <= 0) continue;
    pushLine({
      kind: 'piece',
      label: part.designation || 'Pièce de rechange',
      description: part.reference || null,
      quantity: qty,
      vatPercent: partsVat,
      totalTtc: unitTtc * qty,
    });
  }

  // --- Objet du PDF ---
  let subject;
  if (subjectRefs.length === 1) {
    const cat = subjectRefs[0].category;
    const what = cat ? cat.charAt(0).toLowerCase() + cat.slice(1) : 'équipement';
    subject = `Entretien de votre ${what} : ${subjectRefs[0].ref}`;
  } else if (subjectRefs.length > 1) {
    subject = `Entretien de vos équipements : ${subjectRefs.map((s) => s.ref).join(' / ')}`;
  } else {
    subject = `Entretien — contrat ${contractNumber}`.trim();
  }

  const totalTtc = round2(lines.reduce((s, l) => s + l.totalTtc, 0));
  return { date, deadline, subject, lines, totalTtc, warnings, errors, interventionId: intervention?.id };
}

/**
 * Corps du `POST /customer_invoices` (API Pennylane v2) à partir du modèle.
 * `draft: true` crée un brouillon ; omis = facture finalisée immédiatement.
 * Les montants sont des CHAÎNES (exigence PL).
 *
 * @param {ReturnType<typeof buildEntretienInvoice>} model
 * @param {{ customerId: number, draft: boolean, externalReference: string }} opts
 */
export function toPennylaneInvoicePayload(model, { customerId, draft, externalReference }) {
  const payload = {
    customer_id: customerId,
    date: model.date,
    deadline: model.deadline,
    currency: 'EUR',
    language: 'fr_FR',
    external_reference: externalReference,
    pdf_invoice_subject: model.subject,
    invoice_lines: model.lines.map((l) => {
      const line = {
        label: l.label,
        quantity: String(l.quantity),
        unit: 'piece',
        raw_currency_unit_price: l.unitPriceHt,
        vat_rate: l.vatCode,
      };
      if (l.description) line.description = l.description;
      // Ordre des clés stable pour la lisibilité des tests/logs
      return l.description
        ? { label: line.label, description: line.description, quantity: line.quantity, unit: line.unit, raw_currency_unit_price: line.raw_currency_unit_price, vat_rate: line.vat_rate }
        : line;
    }),
  };
  if (draft) payload.draft = true;
  return payload;
}
