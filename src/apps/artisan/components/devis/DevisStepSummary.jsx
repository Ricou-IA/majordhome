/**
 * DevisStepSummary.jsx — Étape 3 du wizard : récapitulatif + options
 */

import { computeQuoteTotals } from '@services/devis.service';
import { FormField, TextInput, TextArea } from '../../components/FormFields';
import DevisTvaSummary from './DevisTvaSummary';

const DEFAULT_CONDITIONS = `- Devis valable pour la durée indiquée ci-dessus.
- Acompte de 30% à la commande, solde à la réception des travaux.
- TVA applicable selon la nature des travaux (art. 278-0 bis du CGI).
- Garantie matériel selon les conditions du fabricant.`;

export default function DevisStepSummary({ form, setField, lines }) {
  const totals = computeQuoteTotals(lines, form.globalDiscountPercent);

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
