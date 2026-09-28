/**
 * DevisStepSummary.jsx — Étape 3 du wizard : récapitulatif + options
 */

import { computeQuoteTotals } from '@services/devis.service';
import { formatEuro } from '@/lib/utils';
import { FormField, TextInput, TextArea } from '../../components/FormFields';
import DevisTvaSummary from './DevisTvaSummary';

const DEFAULT_CONDITIONS = `- Devis valable pour la durée indiquée ci-dessus.
- Acompte de 30% à la commande, solde à la réception des travaux.
- TVA applicable selon la nature des travaux (art. 278-0 bis du CGI).
- Garantie matériel selon les conditions du fabricant.`;

/**
 * Calcule la marge brute sur les lignes portant un prix d'achat (fournitures).
 * Marge brute avant remise globale (qui s'applique au total, pas ligne à ligne).
 * @param {Array<object>} lines - lignes du devis
 * @returns {{ nb: number, vente: number, achat: number, marge: number, taux: number }}
 */
function margeFournitures(lines) {
  const produits = lines.filter(
    (l) => l.line_type !== 'section_title' && l.purchase_price_ht != null && l.purchase_price_ht !== ''
  );
  const vente = produits.reduce((s, l) => s + (parseFloat(l.unit_price_ht) || 0) * (parseFloat(l.quantity) || 0), 0);
  const achat = produits.reduce((s, l) => s + (parseFloat(l.purchase_price_ht) || 0) * (parseFloat(l.quantity) || 0), 0);
  const marge = vente - achat;
  const taux = vente > 0 ? (marge / vente) * 100 : 0;
  return { nb: produits.length, vente, achat, marge, taux };
}

export default function DevisStepSummary({ form, setField, lines }) {
  const totals = computeQuoteTotals(lines, form.globalDiscountPercent);
  const marge = margeFournitures(lines);

  return (
    <div className="space-y-6">
      {/* Remise globale */}
      <FormField label="Remise globale (%)">
        <TextInput
          value={form.globalDiscountPercent}
          onChange={(v) => setField('globalDiscountPercent', v)}
          type="number"
          min="0"
          max="100"
          step="0.5"
          placeholder="0"
        />
      </FormField>

      {/* Totaux */}
      <DevisTvaSummary totals={totals} globalDiscountPercent={form.globalDiscountPercent} />

      {marge.nb > 0 && (
        <div className="rounded-lg border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm flex items-center justify-between">
          <span className="text-secondary-600">
            Marge sur fournitures ({marge.nb} ligne{marge.nb > 1 ? 's' : ''} avec prix d&apos;achat)
          </span>
          <span className="font-semibold text-secondary-900">
            {formatEuro(marge.marge)} HT · {marge.taux.toFixed(0)} %
          </span>
        </div>
      )}

      {/* Validité */}
      <FormField label="Durée de validité (jours)">
        <TextInput
          value={form.validityDays}
          onChange={(v) => setField('validityDays', v)}
          type="number"
          min="1"
          placeholder="30"
        />
      </FormField>

      {/* Conditions */}
      <FormField label="Conditions de vente">
        <TextArea
          value={form.conditions}
          onChange={(v) => setField('conditions', v)}
          rows={5}
          placeholder={DEFAULT_CONDITIONS}
        />
        {!form.conditions && (
          <button
            type="button"
            onClick={() => setField('conditions', DEFAULT_CONDITIONS)}
            className="text-xs text-primary-600 hover:text-primary-700 mt-1"
          >
            Utiliser les conditions par défaut
          </button>
        )}
      </FormField>

      {/* Notes internes */}
      <FormField label="Notes internes (non visibles sur le devis)">
        <TextArea
          value={form.notesInternes}
          onChange={(v) => setField('notesInternes', v)}
          rows={2}
          placeholder="Notes pour usage interne..."
        />
      </FormField>
    </div>
  );
}
