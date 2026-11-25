/**
 * savInvoiceModel.js — facture d'une intervention SAV (module PUR, testé scripts/sav-invoice-model.test.mjs).
 *
 * Eric 2026-11-25 : le bouton « Facturé » d'une carte SAV ouvre la fenêtre de facturation. Elle
 * reprend le devis fait dans Majord'home (fléché vers la carte, `quotes.intervention_id`) s'il
 * existe ; sinon elle part d'une ligne « Intervention SAV » et des pièces de la carte, à compléter.
 *
 * Même forme que la facture d'entretien (`entretienInvoiceModel.js`) : les montants sont
 * calculés par `applyLineEdits`, le corps Pennylane par `toPennylaneInvoicePayload`. Ce module ne
 * fait que préparer les lignes éditables et le modèle de départ.
 */

import { applyLineEdits } from './entretienInvoiceModel.js';
import { devisDeReference } from './savDevis.js';

const DEFAULT_DEADLINE_DAYS = 30;
const TVA_DEFAUT = 20;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

function addDaysIso(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Devis repris sur la facture : le plus récent accepté, sinon le devis de référence de la carte
 * (le plus récent non refusé). `null` = pas de devis Majord'home.
 * @param {Array<{ id: string, status?: string, created_at?: string }> | null | undefined} quotes
 * @returns {object | null}
 */
export function devisAFacturer(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) return null;
  const tries = [...quotes].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return tries.find((q) => q.status === 'accepte') || devisDeReference(quotes);
}

/** Remise de ligne et remise globale du devis réunies en un seul pourcentage. */
function remiseCumulee(ligne, globale) {
  const l = Math.min(Math.max(Number(ligne) || 0, 0), 100);
  const g = Math.min(Math.max(Number(globale) || 0, 0), 100);
  return round4(100 * (1 - (1 - l / 100) * (1 - g / 100)));
}

const ligneVierge = (p) => ({
  kind: 'libre',
  label: '',
  description: null,
  quantity: 1,
  unitPriceHt: 0,
  vatPercent: TVA_DEFAUT,
  discountPercent: 0,
  ledgerAccountId: null,
  ledgerAccountNumber: null,
  equipmentId: null,
  equipmentTypeId: null,
  categoryId: null,
  ...p,
});

/**
 * Prépare la facture d'une carte SAV.
 *
 * @param {object} p
 * @param {object} p.item carte `majordhome_entretien_sav`
 * @param {{ subject?: string, quote_number?: string, global_discount_percent?: number|string } | null} [p.quote] devis repris
 * @param {Array<object>} [p.quoteLines] lignes du devis (`majordhome_quote_lines`)
 * @param {{ parts?: string|number|null }} [p.ledgerAccounts] comptes de vente paramétrés (`parts` = pièces)
 * @param {number} [p.deadlineDays]
 * @param {string} p.today AAAA-MM-JJ (date locale)
 * @returns {{ source: 'devis'|'saisie', base: object, edits: Array<object> }}
 *   `base` = modèle vide (date, échéance, objet, avertissements) à passer à `applyLineEdits`
 *   avec `edits`, les lignes éditables de départ
 */
export function preparerFactureSav({ item, quote = null, quoteLines = [], ledgerAccounts = {}, deadlineDays = DEFAULT_DEADLINE_DAYS, today }) {
  const comptePieces = ledgerAccounts?.parts ? String(ledgerAccounts.parts) : null;
  const warnings = [];
  let edits;
  let source;

  if (quote) {
    source = 'devis';
    const globale = quote.global_discount_percent;
    edits = (quoteLines || [])
      .filter((l) => l && l.line_type !== 'section_title')
      .map((l) => {
        const estProduit = l.line_type === 'product';
        const compteLigne = l.ledger_account_pl_id ?? null;
        return ligneVierge({
          kind: estProduit ? 'piece' : 'devis',
          label: String(l.designation || '').trim(),
          description: [l.reference, l.description].map((v) => String(v || '').trim()).filter(Boolean).join(' · ') || null,
          quantity: Number(l.quantity) || 1,
          unitPriceHt: round4(l.unit_price_ht),
          vatPercent: l.tva_rate == null || l.tva_rate === '' ? TVA_DEFAUT : Number(l.tva_rate),
          discountPercent: remiseCumulee(l.discount_percent, globale),
          ledgerAccountId: compteLigne,
          ledgerAccountNumber: compteLigne == null && estProduit ? comptePieces : null,
        });
      });
    if (edits.length === 0) warnings.push({ code: 'devis_vide', message: 'Le devis n’a aucune ligne : complétez la facture.' });
  } else {
    source = 'saisie';
    const pieces = (Array.isArray(item?.parts_detail) ? item.parts_detail : [])
      .filter((p) => p && !p.offert && (Number(p.prix_ht) || 0) > 0)
      .map((p) => ligneVierge({
        kind: 'piece',
        label: String(p.designation || 'Pièce de rechange').trim(),
        description: p.reference || null,
        quantity: Number(p.quantite) || 1,
        // Prix des pièces de la carte = TTC (même lecture que la facture d'entretien).
        unitPriceHt: round4((Number(p.prix_ht) || 0) / (1 + TVA_DEFAUT / 100)),
        ledgerAccountNumber: comptePieces,
      }));
    edits = [
      ligneVierge({
        kind: 'main_oeuvre',
        label: 'Intervention SAV',
        description: String(item?.sav_description || '').trim().slice(0, 250) || null,
      }),
      ...pieces,
    ];
  }

  if (edits.some((e) => e.kind !== 'piece' && e.ledgerAccountId == null)) {
    warnings.push({ code: 'compte_defaut', message: 'Main d’œuvre : Pennylane appliquera son compte de vente par défaut (à vérifier sur le brouillon).' });
  }

  const date = today;
  const subject = String(quote?.subject || '').trim()
    || (quote?.quote_number ? `Intervention SAV — devis ${quote.quote_number}` : 'Intervention SAV');
  return {
    source,
    edits,
    base: {
      date,
      deadline: addDaysIso(date, Number(deadlineDays) > 0 ? Number(deadlineDays) : DEFAULT_DEADLINE_DAYS),
      subject,
      lines: [],
      discount: null,
      totalTtc: 0,
      warnings,
      errors: [],
    },
  };
}

/**
 * Modèle final de la facture : montants recalculés depuis les lignes éditées, plus le refus
 * d'une facture à 0 €.
 * @param {object} base `preparerFactureSav().base`
 * @param {Array<object>} edits lignes éditées
 * @param {{ catalog?: Array }} [opts] catalogue des comptes Pennylane
 */
export function modeleFactureSav(base, edits, { catalog = [] } = {}) {
  const model = applyLineEdits(base, edits, { catalog });
  const totalHt = round2((model.lines || []).reduce((s, l) => s + Number(l.unitPriceHt) * Number(l.quantity) * (1 - (Number(l.discountPercent) || 0) / 100), 0));
  const errors = [...model.errors];
  if (model.lines.length > 0 && !(model.totalTtc > 0)) {
    errors.push({ code: 'montant_nul', message: 'La facture est à 0 € : renseignez le prix de l’intervention.' });
  }
  return { ...model, totalHt, errors };
}
