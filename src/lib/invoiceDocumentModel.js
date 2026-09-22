// src/lib/invoiceDocumentModel.js
// ============================================================================
// Hub de facturation — modèle PUR (aucun import React / Supabase) de la facture
// émise par Majord'home. Testé par scripts/invoice-document-model.test.mjs
// (inclus dans audit:quality). Spec :
// docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md
//
//  - `buildInvoiceDraft` : du modèle d'entretien (`buildEntretienInvoice`) vers
//    l'en-tête + les lignes persistables (RPC invoice_create_draft). Montants au
//    centime : ht + tva = ttc PAR LIGNE, totaux = sommes des lignes, ventilation TVA
//    par taux. `customer` = photo du client : une facture émise ne suit plus la fiche.
//  - `buildInvoicePdfModel` : de la facture ÉMISE (valeurs enregistrées, jamais
//    recalculées) vers les chaînes du PDF, formatées ici (PDF-safe : pas de
//    glyphes hors cp1252, espaces ordinaires) — le composant react-pdf ne
//    calcule et ne formate rien.
//  - Réglages d'émission `settings.invoicing` avec défauts neutres (jamais Mayer).
// ============================================================================
import { formatFullAddress, buildLegalFooter } from './orgBranding.js';

export const INVOICING_DEFAULTS = Object.freeze({
  numberPrefix: 'F',
  iban: '',
  bic: '',
  paymentTerms: 'Paiement à réception, au plus tard à la date d’échéance.',
  latePenalty: 'Pénalités de retard : trois fois le taux d’intérêt légal en vigueur, exigibles sans rappel. Indemnité forfaitaire pour frais de recouvrement : 40 €.',
  discountNote: 'Pas d’escompte pour paiement anticipé.',
});

/**
 * Réglages d'émission (`settings.invoicing`), avec défauts neutres.
 * @param {object} settings  core.organizations.settings
 * @returns {{ numberPrefix: string, iban: string, bic: string, paymentTerms: string, latePenalty: string, discountNote: string }}
 */
export function invoicingSettings(settings) {
  const s = settings?.invoicing || {};
  const p = validateNumberPrefix(s.number_prefix);
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v : d);
  return {
    numberPrefix: p.ok ? p.value : INVOICING_DEFAULTS.numberPrefix,
    iban: typeof s.iban === 'string' ? s.iban : '',
    bic: typeof s.bic === 'string' ? s.bic : '',
    paymentTerms: str(s.payment_terms, INVOICING_DEFAULTS.paymentTerms),
    latePenalty: str(s.late_penalty, INVOICING_DEFAULTS.latePenalty),
    discountNote: str(s.discount_note, INVOICING_DEFAULTS.discountNote),
  };
}

/** Préfixe de numérotation : 1 à 6 caractères A-Z / 0-9, commence par une lettre. Normalisé en majuscules. */
export function validateNumberPrefix(raw) {
  const value = String(raw || '').trim().toUpperCase();
  return { ok: /^[A-Z][A-Z0-9]{0,5}$/.test(value), value };
}

/** IBAN : normalisé en majuscules par groupes de 4. Vide = OK (pas de bloc paiement). */
export function validateIban(raw) {
  const compact = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!compact) return { ok: true, value: '' };
  const ok = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact);
  return { ok, value: compact.replace(/(.{4})/g, '$1 ').trim() };
}

/** BIC : 8 ou 11 caractères. Vide = OK. */
export function validateBic(raw) {
  const value = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!value) return { ok: true, value: '' };
  return { ok: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value), value };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/** TTC → { ht, tva, ttc } au centime, avec ht + tva = ttc garanti. */
export function splitTtc(ttc, vatPercent) {
  const t = round2(ttc);
  const ht = round2(t / (1 + (Number(vatPercent) || 0) / 100));
  return { ht, tva: round2(t - ht), ttc: t };
}

/** `1 234,56 €` — espaces ORDINAIRES (Helvetica ne connaît pas U+202F), virgule décimale. */
export function fmtEur(n) {
  const v = round2(n);
  const sign = v < 0 ? '-' : '';
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
}

/**
 * Prix unitaire HT affiché sur le PDF (review round 1, 2026-09-22) : 2 décimales quand le
 * prix est exact au centime, sinon 4 décimales — sinon quantité × unitaire affiché ≠ HT de la
 * ligne affiché (`5,45 € × 2 = 10,90 €` alors que la ligne porte `10,91 €`). Usage : UNIQUEMENT
 * `rows[].unitHt` dans `buildInvoicePdfModel` — les autres montants du PDF sont déjà au centime.
 */
function fmtEurUnit(n) {
  const v = Number(n) || 0;
  if (round2(v) === round4(v)) return fmtEur(v);
  const sign = v < 0 ? '-' : '';
  const [int, dec] = Math.abs(v).toFixed(4).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
}

const fmtDateFr = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const fmtQty = (q) => String(round4(q)).replace('.', ',');
const fmtPct = (p) => `${String(round4(p)).replace('.', ',')} %`;

function customerSnapshot(client) {
  const c = client || {};
  const name = (c.display_name || `${c.first_name || ''} ${c.last_name || ''}`).trim() || 'Client';
  return {
    name,
    address: c.address || null,
    postal_code: c.postal_code || null,
    city: c.city || null,
    email: c.email || null,
    phone: c.phone || null,
    client_number: c.client_number ?? null,
  };
}

/**
 * En-tête + lignes persistables à partir du modèle d'entretien.
 * @param {object} p
 * @param {ReturnType<import('./entretienInvoiceModel.js').buildEntretienInvoice>} p.model
 * @param {string} p.orgId  org CORE
 * @param {string} [p.context]  clé de PENNYLANE_CHART_CONTEXTS (défaut 'contrat')
 * @param {object} p.client  fiche client (display_name, first_name, last_name, address, postal_code, city, email, phone, client_number, id)
 * @param {string|null} [p.contractId]
 * @param {string|null} [p.interventionId]
 * @param {number} p.dueDays
 * @returns {{ invoice: object, lines: object[] }}
 *
 * `lines[].metier_key` = `equipmentTypeId` du modèle (pas un libellé métier — nom conservé pour
 * matcher le vocabulaire du journal d'intégration).
 *
 * ⚠️ Ne vérifie PAS `model.errors` (montant contractuel nul, taux de TVA sans code Pennylane…) —
 * c'est un blocage à faire porter par l'appelant (garde UI) AVANT d'appeler `buildInvoiceDraft`,
 * cf. `buildEntretienInvoice`. Cette fonction assemble un brouillon, elle ne valide pas le modèle.
 */
export function buildInvoiceDraft({ model, orgId, context = 'contrat', client, contractId = null, interventionId = null, dueDays }) {
  const byRate = new Map();
  let totalHt = 0;
  let totalTva = 0;
  let totalTtc = 0;
  const lines = (model?.lines || []).map((l, i) => {
    const { ht, tva, ttc } = splitTtc(l.netTtc, l.vatPercent);
    const rate = Number(l.vatPercent) || 0;
    const acc = byRate.get(rate) || { rate, base: 0, amount: 0 };
    acc.base = round2(acc.base + ht);
    acc.amount = round2(acc.amount + tva);
    byRate.set(rate, acc);
    totalHt = round2(totalHt + ht);
    totalTva = round2(totalTva + tva);
    totalTtc = round2(totalTtc + ttc);
    return {
      position: i + 1,
      kind: l.kind || 'libre',
      label: l.label,
      description: l.description || null,
      quantity: Number(l.quantity) || 1,
      // Prix unitaire HT NET (après remise) — PAS une redite de `l.unitPriceHt` (review round 1,
      // 2026-09-22). `entretienInvoiceModel` porte deux prix unitaires distincts et volontairement
      // divergents : `l.unitPriceHt` est le prix unitaire HT BRUT (avant remise), c'est la base sur
      // laquelle la remise par ligne d'équipement est appliquée (cf. Module Contrats — forçage par
      // ligne). `invoice_lines.unit_price_ht` (ici) doit être le prix NET, pour que
      // quantité × unitaire = ht de la ligne tienne à l'affichage PDF (`buildInvoicePdfModel`,
      // cf. `fmtEurUnit`). Les deux valeurs ne sont égales que sur une ligne sans remise (`piece`) ;
      // ne jamais fusionner ce calcul avec `l.unitPriceHt`.
      // Calculé depuis `netTtc` (pas depuis `ht` déjà arrondi à la ligne) — ruling contrôleur
      // 2026-09-22 : round4(ht_ligne / qty) donne 5.455 sur la fixture 12€/qty2/10% (arrondi
      // intermédiaire), alors que round4(netTtc/qty/(1+taux)), calculé depuis le TTC exact, donne
      // la valeur attendue 5.4545 / 81.8182.
      unit_price_ht: round4(Number(l.netTtc) / (Number(l.quantity) || 1) / (1 + rate / 100)),
      vat_rate: rate,
      discount_percent: Number(l.discountPercent) || 0,
      ht,
      tva,
      ttc,
      ledger_account_number: l.ledgerAccountNumber ?? null,
      // Sans catalogue Pennylane, `resolveLedgerAccountId` renvoie le numéro lui-même — ce
      // n'est pas un id PL, on ne le stocke pas (review round 1, 2026-09-22).
      ledger_account_pl_id: l.ledgerAccountId != null && String(l.ledgerAccountId) !== String(l.ledgerAccountNumber ?? '') ? Number(l.ledgerAccountId) : null,
      metier_key: l.equipmentTypeId ?? null,
      equipment_id: l.equipmentId ?? null,
      category_id: l.categoryId ?? null,
      // Code TVA Pennylane figé (VAT_CODES du modèle d'entretien) : l'edge d'import le
      // relit tel quel, sans recopier la table de correspondance côté Deno.
      vat_code: l.vatCode ?? null,
    };
  });
  const invoice = {
    org_id: orgId,
    kind: 'invoice',
    context,
    client_id: client?.id ?? null,
    contract_id: contractId,
    intervention_id: interventionId,
    customer: customerSnapshot(client),
    subject: model?.subject || null,
    currency: 'EUR',
    due_days: Number.isFinite(Number(dueDays)) ? Number(dueDays) : 30,
    total_ht: totalHt,
    total_tva: totalTva,
    total_ttc: totalTtc,
    vat_breakdown: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    discount: model?.discount || null,
  };
  return { invoice, lines };
}

function discountLineOf(discount) {
  if (!discount || !(Number(discount.amount) > 0)) return null;
  const causes = [
    discount.degressivitePercent > 0 ? `dégressivité ${fmtPct(discount.degressivitePercent)}` : null,
    discount.exceptionalAmount > 0 ? `remise exceptionnelle ${fmtEur(discount.exceptionalAmount)}` : null,
    discount.commercialAmount > 0 ? `remise commerciale ${fmtEur(discount.commercialAmount)}` : null,
  ].filter(Boolean).join(' + ') || 'montant du contrat';
  return `Remise ${fmtPct(discount.percent)} appliquée sur les équipements (${causes}) : -${fmtEur(discount.amount)} TTC`;
}

/**
 * Modèle de rendu du PDF à partir d'une facture ÉMISE (valeurs enregistrées).
 * @param {object} p
 * @param {object} p.invoice  ligne de majordhome_invoices (+ `credited_number` pour un avoir)
 * @param {object[]} p.lines  lignes de majordhome_invoice_lines, triées par position
 * @param {object} p.company  `buildCompanyInfo(settings)`
 * @param {ReturnType<typeof invoicingSettings>} p.invoicing
 */
export function buildInvoicePdfModel({ invoice, lines, company, invoicing }) {
  const cust = invoice.customer || {};
  const customer = [
    cust.name,
    cust.address,
    [cust.postal_code, cust.city].filter(Boolean).join(' ') || null,
    cust.client_number != null ? `Client n° ${cust.client_number}` : null,
  ].filter(Boolean);
  const rows = [...(lines || [])].sort((a, b) => a.position - b.position).map((l) => ({
    label: l.label,
    description: l.description || null,
    qty: fmtQty(l.quantity),
    unitHt: fmtEurUnit(l.unit_price_ht),
    vat: fmtPct(l.vat_rate),
    ht: fmtEur(l.ht),
  }));
  const vatRows = (invoice.vat_breakdown || []).map((v) => ({ rate: fmtPct(v.rate), base: fmtEur(v.base), amount: fmtEur(v.amount) }));
  const payment = [invoicing.paymentTerms];
  const iban = validateIban(invoicing.iban);
  const bic = validateBic(invoicing.bic);
  if (iban.ok && iban.value) payment.push(`IBAN : ${iban.value}${bic.value ? ` — BIC : ${bic.value}` : ''}`);
  const footerParts = [buildLegalFooter(company)];
  if (company.siret) footerParts.push(`SIRET ${company.siret}`);
  if (company.tvaIntra) footerParts.push(`TVA ${company.tvaIntra}`);
  return {
    title: invoice.kind === 'credit_note' ? 'AVOIR' : 'FACTURE',
    number: invoice.number,
    creditedNumber: invoice.kind === 'credit_note' ? invoice.credited_number || null : null,
    dates: { invoice: fmtDateFr(invoice.invoice_date), due: fmtDateFr(invoice.due_at) },
    customer,
    subject: invoice.subject || null,
    rows,
    vatRows,
    totals: { ht: fmtEur(invoice.total_ht), tva: fmtEur(invoice.total_tva), ttc: fmtEur(invoice.total_ttc) },
    discountLine: discountLineOf(invoice.discount),
    payment,
    legal: [invoicing.latePenalty, invoicing.discountNote].filter(Boolean),
    rge: company.rgeCertifications?.length ? `Certifications : ${company.rgeCertifications.join(', ')}` : null,
    companyAddress: formatFullAddress(company),
    footer: footerParts.filter(Boolean).join(' — '),
  };
}

/**
 * Messages utilisateur des codes d'erreur de la chaîne d'émission (`invoice_create_draft` /
 * `invoice_issue`, cf. supabase/migrations/20260923_1_invoices_hub.sql et
 * 20260923_2_invoices_unique_issued_per_intervention.sql). Finding F3 de la revue finale
 * (2026-09-22) : un `RAISE EXCEPTION 'code'` PostgREST remonte tel quel dans `err.message`
 * (ex. `intervention_already_invoiced`, ou le message brut PostgREST qui l'englobe) — sans ce
 * mappage, l'utilisateur voit un code technique anglais au lieu d'une explication actionnable.
 */
export const INVOICE_RPC_MESSAGES = Object.freeze({
  unauthenticated: 'Session expirée : reconnectez-vous.',
  team_leader_required: 'Réservé aux chefs d’équipe et administrateurs.',
  lines_required: 'La facture n’a aucune ligne.',
  totals_mismatch: 'Les totaux ne correspondent pas à la somme des lignes : rechargez la page et réessayez.',
  invalid_prefix: 'Préfixe de numérotation invalide (Paramètres → Facturation → Émission).',
  prefix_mismatch: 'La série de l’année est déjà amorcée avec un autre préfixe : le préfixe ne peut plus changer avant l’année prochaine (Paramètres → Facturation → Émission).',
  invoice_already_issued: 'Cette facture est déjà émise.',
  intervention_already_invoiced: 'Cette intervention a déjà une facture émise.',
  invoice_not_found: 'Facture introuvable.',
  invoice_immutable: 'Facture émise : elle ne peut plus être modifiée (correction par avoir).',
  customer_not_synced: "Le client n'a pas encore de fiche Pennylane : rejouez l'import depuis la carte (elle sera créée).",
  pdf_missing: "Le PDF de la facture n'est pas archivé : rejouez l'export depuis la carte.",
  invoice_not_issued: "Cette facture n'est pas émise : rien à importer.",
  pennylane_import_failed: "Pennylane a refusé l'import de la facture : voir le détail et rejouer depuis la carte.",
  pennylane_disabled: "Pennylane n'est pas activé pour cette organisation.",
  already_imported: "Cette facture est déjà importée dans Pennylane.",
});

/**
 * Message utilisateur d'une erreur de la chaîne d'émission (code RPC → français, sinon message
 * brut renvoyé tel quel, jamais masqué — cf. posture « échouer fort »).
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export function invoiceErrorMessage(err, fallback = 'La facture n’a pas pu être émise') {
  const raw = String(err?.message || err || '');
  const code = Object.keys(INVOICE_RPC_MESSAGES).find((k) => raw.includes(k));
  return code ? INVOICE_RPC_MESSAGES[code] : (raw || fallback);
}
