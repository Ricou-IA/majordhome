// src/lib/entretienInvoiceModel.js
// ============================================================================
// Modèle de facture d'un entretien (push Majord'home → Pennylane).
// Module PUR : aucun import React / Supabase. Testé par
// scripts/entretien-invoice-model.test.mjs (inclus dans audit:quality).
//
// Règles (spec 2026-09-21-facturation-entretien-pennylane-push-design.md,
// révisées avec Eric le 2026-09-21 soir) :
//  - 1 LIGNE PAR ÉQUIPEMENT au prix grille de la zone (ou prix forcé par ligne),
//    calcul strictement identique au contrat signé (`computeContractLines`) ;
//  - la REMISE s'applique : dégressivité (+ remise commerciale si le montant du
//    contrat a été forcé à la baisse) = remise relative par ligne d'équipement,
//    jamais sur les pièces ; le total retombe sur `contract.amount`, source figée
//    à la signature. Montant forcé à la HAUSSE → lignes majorées au prorata ;
//  - TVA par ligne = TVA par défaut de la catégorie du type d'équipement ;
//    catégorie sans TVA → 20 % + avertissement (jamais silencieux) ;
//  - les pièces non offertes du certificat s'ajoutent sur la même facture, à
//    la TVA de la première ligne d'équipement, sans remise ;
//  - montants MDH en TTC → HT = TTC / (1 + taux), 10 décimales (Pennylane
//    recalcule et arrondit, comme la saisie manuelle `81.81818181818181`).
// ============================================================================

/**
 * Taux de TVA (en %) → code Pennylane. Un taux absent = erreur bloquante.
 * ⚠️ 5,5 % = `FR_55` (relevé sur les articles et comptes réels de Mayer), PAS `FR_055`
 * comme le suggère un exemple de doc : `FR_055` ⇒ 400 « schema of invoice_lines
 * isn't one of Product-based / Standard Invoice Line » (vécu 2026-09-22).
 */
export const VAT_CODES = { 20: 'FR_200', 10: 'FR_100', 5.5: 'FR_55', 0: 'exempt' };

export const DEFAULT_VAT_PERCENT = 20;
export const DEFAULT_DEADLINE_DAYS = 30;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/**
 * HT unitaire à partir d'un TTC total — chaîne, **6 décimales max** (limite du schéma
 * PL `raw_currency_unit_price` : 10 décimales ⇒ 400 « schema of invoice_lines isn't
 * one of Product-based / Standard Invoice Line », vécu 2026-09-22), sans zéros de queue.
 */
function unitHt(totalTtc, quantity, vatPercent) {
  const ht = totalTtc / (quantity || 1) / (1 + vatPercent / 100);
  return ht.toFixed(6).replace(/\.?0+$/, '');
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Résout l'identifiant du compte comptable Pennylane à envoyer sur une ligne.
 * Pennylane tient un compte par (numéro, taux de TVA) ; le paramétrage stocke un NUMÉRO
 * (ex. « 70601 »). On prend la déclinaison du taux de la ligne, sinon la générique `any`
 * (doc PL : préférer la déclinaison exacte). Tolère un id stocké (anciens réglages).
 *
 * @param {Array<{ id: number|string, number: string, vatRate?: string }>} catalog  `getLedgerAccounts()`
 * @param {string|number|null|undefined} ref  numéro (ou id) paramétré
 * @param {string|null} vatCode  code PL de la ligne (`FR_100`…)
 * @returns {number|string|null}
 */
export function resolveLedgerAccountId(catalog, ref, vatCode) {
  if (ref == null || ref === '') return null;
  const list = Array.isArray(catalog) ? catalog : [];
  const refStr = String(ref);
  const byNumber = list.filter((a) => String(a.number) === refStr);
  if (byNumber.length > 0) {
    const exact = vatCode ? byNumber.find((a) => (a.vatRate || 'any') === vatCode) : null;
    const generic = byNumber.find((a) => !a.vatRate || a.vatRate === 'any');
    return (exact || generic || byNumber[0]).id;
  }
  const byId = list.find((a) => String(a.id) === refStr);
  if (byId) return byId.id;
  return list.length === 0 ? ref : null; // catalogue absent : on fait confiance à la valeur ; présent : introuvable
}

/** Texte de remplissage saisi dans le parc à la place d'une vraie valeur : jamais sur une facture. */
const PLACEHOLDER_RE = /^\s*(à|a)\s+renseigner\s*$|^\s*(n\/?a|inconnu|\?+|-+)\s*$/i;
const clean = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s && !PLACEHOLDER_RE.test(s) ? s : null;
};

/**
 * « Marque · Modèle · N° série » d'un équipement, ou null si rien de renseigné.
 * Les textes de remplissage (« À renseigner »…) sont ignorés — vu sur le brouillon
 * FERNANDEZ du 2026-09-22 : « Entretien de votre poêle : À renseigner · À renseigner ».
 */
export function referenceEquipement(eq) {
  if (!eq) return null;
  const serial = clean(eq.serial_number);
  const parts = [clean(eq.brand), clean(eq.model), serial ? `N° ${serial}` : null].filter(Boolean);
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
 * @param {{ items: Array, subtotal: number, discountPercent: number, discountAmount: number, total: number }} p.pricing
 *   résultat de `computeContractLines` (src/lib/contractPricing.js) — le même calcul que le contrat signé
 * @param {Array<{ designation?: string, reference?: string, quantite?: number|string, prix_ht?: number|string, offert?: boolean }>} p.parts
 *   pièces du certificat (`prix_ht` contient du TTC, convention Phase 1)
 * @param {{ typesById: Map, categoriesById: Map }} p.referentiel  index types / catégories (TVA)
 * @param {{ byCategory?: Object<string, number|string>, parts?: number|string|null, catalog?: Array }} [p.ledgerAccounts]
 *   comptes de vente Pennylane (706xxx) par catégorie d'équipement + pièces — la « famille »
 *   comptable d'une ligne (Settings → Facturation Pennylane), stockés par NUMÉRO ; `catalog` =
 *   déclinaisons par TVA (`getLedgerAccounts()`) pour résoudre l'id. Absent → défaut PL + avertissement.
 * @param {number} [p.deadlineDays]
 * @param {string} p.today  YYYY-MM-DD
 * @returns {{ date: string, deadline: string, subject: string, lines: Array<{ kind: string, label: string, description: string|null, quantity: number, vatPercent: number, vatCode: string|null, ledgerAccountId: number|string|null, ledgerAccountNumber: string|null, equipmentId: string|null, equipmentTypeId: string|null, categoryId: string|null, grossTtc: number, netTtc: number, discountPercent: number, unitPriceHt: string }>, discount: object|null, totalTtc: number, warnings: Array<{code:string,message:string}>, errors: Array<{code:string,message:string}> }}
 */
export function buildEntretienInvoice({
  intervention,
  contract,
  pricing,
  parts = [],
  referentiel,
  ledgerAccounts = {},
  deadlineDays = DEFAULT_DEADLINE_DAYS,
  today,
}) {
  const warnings = [];
  const errors = [];
  const lines = [];
  const contractNumber = contract?.contract_number || (contract?.id ? `CTR-${String(contract.id).slice(0, 8).toUpperCase()}` : '');
  const date = today;
  const deadline = addDaysIso(today, Number(deadlineDays) || DEFAULT_DEADLINE_DAYS);
  const base = { date, deadline, subject: '', lines, discount: null, totalTtc: 0, warnings, errors, interventionId: intervention?.id };

  const amount = round2(contract?.amount);
  if (!(amount > 0)) {
    errors.push({ code: 'montant_contrat_nul', message: 'Le contrat n’a pas de montant : rien à facturer.' });
    return base;
  }

  const items = pricing?.items || [];
  const priced = items.filter((it) => (Number(it.lineTotal) || 0) > 0);
  for (const it of items) {
    if ((Number(it.lineTotal) || 0) > 0) continue;
    warnings.push({
      code: 'ligne_sans_tarif',
      message: `« ${it.label || 'Équipement'} » n’a pas de prix (grille de la zone ou type manquant) : il n’est pas facturé.`,
    });
  }
  if (priced.length === 0) {
    errors.push({ code: 'aucune_ligne', message: 'Aucun équipement tarifé sur ce contrat : impossible de construire la facture.' });
    return base;
  }

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

  // Compte de vente PL d'une catégorie (famille comptable), déclinaison du taux de la ligne.
  // Avertissement UNE fois par catégorie (absent ou introuvable dans le catalogue PL).
  const catalog = ledgerAccounts?.catalog || [];
  const warnedCats = new Set();
  const warnOnce = (key, message) => {
    if (warnedCats.has(key)) return;
    warnedCats.add(key);
    warnings.push({ code: 'compte_manquant', message });
  };
  const ledgerForCategory = (catId, catLabel, vatCode) => {
    const ref = catId ? ledgerAccounts?.byCategory?.[catId] : null;
    if (!ref) {
      warnOnce(catId || '__none__', catId
        ? `Pas de compte comptable paramétré pour « ${catLabel || 'cette catégorie'} » : Pennylane appliquera son compte de vente par défaut (Paramètres → Facturation Pennylane).`
        : 'Équipement sans catégorie : Pennylane appliquera son compte de vente par défaut.');
      return null;
    }
    const id = resolveLedgerAccountId(catalog, ref, vatCode);
    if (id == null) {
      warnOnce(`${catId}:introuvable`, `Le compte ${ref} paramétré pour « ${catLabel || 'cette catégorie'} » n’existe plus dans Pennylane : compte par défaut appliqué.`);
    }
    return id;
  };

  const pushLine = (line) => {
    const vatCode = VAT_CODES[line.vatPercent];
    if (!vatCode) {
      errors.push({ code: 'tva_inconnue', message: `Taux de TVA ${line.vatPercent} % sans équivalent Pennylane sur « ${line.label} ».` });
    }
    const grossTtc = round2(line.grossTtc);
    lines.push({
      ...line,
      grossTtc,
      netTtc: round2(line.netTtc ?? grossTtc),
      discountPercent: line.discountPercent || 0,
      vatCode: vatCode || null,
      ledgerAccountId: line.ledgerAccountId ?? null,
      ledgerAccountNumber: line.ledgerAccountNumber ?? null,
      equipmentId: line.equipmentId ?? null,
      equipmentTypeId: line.equipmentTypeId ?? null,
      categoryId: line.categoryId ?? null,
      unitPriceHt: unitHt(grossTtc, line.quantity, line.vatPercent),
    });
  };

  // --- Écart entre la grille (Σ lignes) et le montant contractuel figé ---
  const subtotal = round2(priced.reduce((s, it) => s + Number(it.lineTotal), 0));
  let discount = null;
  let scaleUp = null;
  if (amount < subtotal - 0.01) {
    const percent = round4(((subtotal - amount) / subtotal) * 100);
    const degressivite = Number(pricing?.discountPercent) || 0;
    const exceptional = round2(Number(pricing?.exceptionalDiscount) || 0);
    // Écart résiduel = forçage legacy du montant (amount_forced), hors dégressivité et remise exceptionnelle
    const commercial = round2(subtotal - amount - (Number(pricing?.discountAmount) || 0) - exceptional);
    discount = {
      percent,
      amount: round2(subtotal - amount),
      degressivitePercent: degressivite,
      exceptionalAmount: exceptional > 0.01 ? exceptional : 0,
      commercialAmount: commercial > 0.01 ? commercial : 0,
    };
  } else if (amount > subtotal + 0.01) {
    scaleUp = amount / subtotal;
  }

  // --- 1 ligne par équipement ---
  const subjectRefs = [];
  let allocatedNet = 0;
  priced.forEach((it, i) => {
    const last = i === priced.length - 1;
    const eq = it.equipment || null;
    const grossTtc = scaleUp
      ? (last ? round2(amount - allocatedNet) : round2(Number(it.lineTotal) * scaleUp))
      : round2(Number(it.lineTotal));
    const netTtc = discount
      ? (last ? round2(amount - allocatedNet) : round2(grossTtc * (1 - discount.percent / 100)))
      : grossTtc;
    allocatedNet += netTtc;
    const ref = referenceEquipement(eq);
    const typeId = it.equipmentTypeId || eq?.equipment_type_id || null;
    const catId = referentiel?.typesById?.get(typeId)?.category_id ?? eq?.category_id ?? null;
    const catLabel = categoryLabelForEquipment(eq, referentiel);
    if (ref) subjectRefs.push({ ref, category: catLabel });
    const label = it.labelWithUnits || it.label || 'Entretien';
    const vatPercent = resolveVat(typeId, label);
    const ledgerNumber = catId ? (ledgerAccounts?.byCategory?.[catId] ?? null) : null;
    pushLine({
      kind: 'contrat',
      label,
      description: ref,
      quantity: 1,
      vatPercent,
      ledgerAccountId: ledgerForCategory(catId, catLabel, VAT_CODES[vatPercent] || null),
      ledgerAccountNumber: ledgerNumber ? String(ledgerNumber) : null,
      equipmentId: eq?.id ?? null,
      equipmentTypeId: typeId,
      categoryId: catId,
      grossTtc,
      netTtc,
      discountPercent: discount ? discount.percent : 0,
    });
  });

  // --- Pièces non offertes, TVA de la première ligne d'équipement, sans remise ---
  const partsVat = lines[0]?.vatPercent ?? DEFAULT_VAT_PERCENT;
  const billableParts = (parts || []).filter((p) => p && !p.offert && (Number(p.prix_ht) || 0) > 0);
  let partsLedgerId = null;
  if (billableParts.length > 0) {
    if (!ledgerAccounts?.parts) {
      warnOnce('__parts__', 'Pas de compte comptable paramétré pour les pièces de rechange : Pennylane appliquera son compte de vente par défaut.');
    } else {
      partsLedgerId = resolveLedgerAccountId(catalog, ledgerAccounts.parts, VAT_CODES[partsVat] || null);
      if (partsLedgerId == null) {
        warnOnce('__parts__:introuvable', `Le compte ${ledgerAccounts.parts} paramétré pour les pièces n’existe plus dans Pennylane : compte par défaut appliqué.`);
      }
    }
  }
  for (const part of billableParts) {
    const qty = Number(part.quantite) || 1;
    const unitTtc = Number(part.prix_ht) || 0;
    pushLine({
      kind: 'piece',
      label: part.designation || 'Pièce de rechange',
      description: part.reference || null,
      quantity: qty,
      vatPercent: partsVat,
      ledgerAccountId: partsLedgerId,
      ledgerAccountNumber: ledgerAccounts?.parts ? String(ledgerAccounts.parts) : null,
      equipmentId: null,
      equipmentTypeId: null,
      categoryId: null,
      grossTtc: unitTtc * qty,
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

  const totalTtc = round2(lines.reduce((s, l) => s + l.netTtc, 0));
  return { ...base, subject, discount, totalTtc };
}

/**
 * Corps du `POST /customer_invoices` (API Pennylane v2) à partir du modèle.
 * `draft: true` crée un brouillon ; omis = facture finalisée immédiatement.
 * Les montants sont des CHAÎNES (exigence PL). La remise est portée PAR LIGNE
 * d'équipement (`discount: { type: 'relative', value }`), jamais globale : les
 * pièces ne sont pas remisées.
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
      const line = { label: l.label };
      if (l.description) line.description = l.description;
      // Schéma PL : `quantity` est un NOMBRE, les montants sont des chaînes (une
      // quantité en chaîne ⇒ 400 « schema of invoice_lines isn't one of… », 2026-09-22)
      line.quantity = Number(l.quantity);
      line.unit = 'piece';
      line.raw_currency_unit_price = l.unitPriceHt;
      line.vat_rate = l.vatCode;
      if (l.ledgerAccountId) line.ledger_account_id = Number(l.ledgerAccountId);
      if (l.discountPercent > 0) {
        line.discount = { type: 'relative', value: l.discountPercent.toFixed(4).replace(/\.?0+$/, '') };
      }
      return line;
    }),
  };
  if (draft) payload.draft = true;
  return payload;
}
