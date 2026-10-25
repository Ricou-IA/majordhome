// src/lib/pennylaneQuotePayload.js
// Corps du POST /quotes de l'API Pennylane v2 depuis un devis Majord'home — module PUR (aucun import), testé
// (scripts/pennylane-quote-payload.test.mjs). Le schéma Pennylane est STRICT (additionalProperties: false partout) :
// une propriété en trop refuse le devis entier (incident 2026-10-25 : sections envoyées en { label }).
//   - section : { title, rank } — rank entier unique, de 1 en 1 ; une ligne s'y range par section_rank = rank
//   - ligne standard : label, quantity (NOMBRE), raw_currency_unit_price (chaîne HT avant remise), unit, vat_rate,
//     ledger_account_id?, description?, section_rank?, discount? { type: 'relative' | 'absolute', value }
//   - remise globale : discount { type, value }
// Un chapitre sans ligne n'est pas envoyé (même règle que le PDF).

/** Taux de TVA Majord'home → code Pennylane. */
export const TVA_MAPPING = Object.freeze({ 20: 'FR_200', 10: 'FR_100', 5.5: 'FR_55', 0: 'exempt' });

/** Unité Majord'home → unité Pennylane. */
export const UNIT_MAPPING = Object.freeze({ 'pièce': 'piece', h: 'hour', forfait: 'flat_rate', ml: 'meter', 'm²': 'square_meter' });

const montant = (v) => String((Number(v) || 0).toFixed(2));

function dateIso(d) {
  return d.toISOString().split('T')[0];
}

/**
 * @param {{ id: string, subject?: string, validity_days?: number, global_discount_percent?: number }} quote
 * @param {Array<{ line_type: string, designation: string, description?: string, quantity: unknown, unit?: string,
 *   unit_price_ht: unknown, tva_rate: unknown, discount_percent?: unknown, ledger_account_pl_id?: number | null }>} lines
 *   lignes ordonnées (sort_order), titres de chapitre compris
 * @param {number} customerId id du client Pennylane
 * @param {Date} [now]
 * @returns {Record<string, any>}
 */
export function buildPennylaneQuotePayload(quote, lines, customerId, now = new Date()) {
  // chapitres non vides seulement, numérotés de 1 en 1 dans l'ordre du devis
  const sections = [];
  const invoiceLines = [];
  let titreEnAttente = null; // titre rencontré, pas encore de ligne dessous
  let rangCourant = null;

  for (const line of lines || []) {
    if (line.line_type === 'section_title') {
      titreEnAttente = String(line.designation || '').trim();
      rangCourant = null;
      continue;
    }
    if (titreEnAttente != null && rangCourant == null) {
      sections.push({ title: titreEnAttente, rank: sections.length + 1 });
      rangCourant = sections.length;
    }
    const l = {
      label: line.designation,
      quantity: Number(line.quantity) || 1,
      raw_currency_unit_price: montant(line.unit_price_ht),
      unit: UNIT_MAPPING[line.unit] || 'piece',
      vat_rate: TVA_MAPPING[Number(line.tva_rate)] || 'FR_200',
    };
    if (line.ledger_account_pl_id) l.ledger_account_id = Number(line.ledger_account_pl_id);
    if (line.description) l.description = line.description;
    if (rangCourant != null) l.section_rank = rangCourant;
    const remise = Number(line.discount_percent) || 0;
    if (remise > 0) l.discount = { type: 'relative', value: montant(remise) };
    invoiceLines.push(l);
  }

  const echeance = new Date(now);
  echeance.setDate(echeance.getDate() + (Number(quote.validity_days) || 30));

  const result = {
    customer_id: customerId,
    date: dateIso(now),
    deadline: dateIso(echeance),
    currency: 'EUR',
    language: 'fr_FR',
    external_reference: quote.id,
    pdf_invoice_subject: quote.subject || 'Devis',
  };
  if (sections.length) result.invoice_line_sections = sections;
  if (invoiceLines.length) result.invoice_lines = invoiceLines;
  const remiseGlobale = Number(quote.global_discount_percent) || 0;
  if (remiseGlobale > 0) result.discount = { type: 'relative', value: montant(remiseGlobale) };
  return result;
}
