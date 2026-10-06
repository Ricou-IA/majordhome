/**
 * DevisConditions.jsx — bloc repliable « Remise, validité, conditions » de la modale « Nouveau devis »
 * (un seul écran, décision Eric 2026-09-29). Remplace l'ancienne étape « Récapitulatif » : les totaux
 * et la marge vivent dans le pied de la modale, ici ne restent que les réglages du devis et la
 * ventilation TVA détaillée.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { computeQuoteTotals } from '@services/devis.service';
import { FormField, TextInput, TextArea } from '../../components/FormFields';
import DevisTvaSummary from './DevisTvaSummary';
import { buildDevisConfig } from '@/lib/devisConfig.js';

/** @param {{ devisConfig?: object }} p  devisConfig = buildDevisConfig(settings) : conditions et validité par défaut de l'org */
export default function DevisConditions({ form, setField, lines, devisConfig }) {
  const [ouvert, setOuvert] = useState(false);
  const cfg = devisConfig || buildDevisConfig(null);
  const DEFAULT_CONDITIONS = cfg.document.conditions;
  const totals = computeQuoteTotals(lines, form.globalDiscountPercent);
  const resume = [
    `remise ${form.globalDiscountPercent || 0} %`,
    `validité ${form.validityDays || cfg.document.validite_jours} j`,
    form.conditions ? 'conditions personnalisées' : 'conditions par défaut',
    form.notesInternes ? 'notes internes' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="border border-secondary-200 rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}
        className="w-full flex items-center justify-between px-4 py-3 bg-secondary-50 text-left hover:bg-secondary-100">
        <span className="flex items-center gap-2 text-sm font-semibold text-secondary-700 uppercase tracking-wider">
          {ouvert ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Remise, validité, conditions
        </span>
        <span className="text-xs text-secondary-500">{resume}</span>
      </button>
      {ouvert && (
        <div className="p-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Remise globale (%)">
              <TextInput value={form.globalDiscountPercent} onChange={(v) => setField('globalDiscountPercent', v)} type="number" min="0" max="100" step="0.5" placeholder="0" />
            </FormField>
            <FormField label="Durée de validité (jours)">
              <TextInput value={form.validityDays} onChange={(v) => setField('validityDays', v)} type="number" min="1" placeholder={String(cfg.document.validite_jours)} />
            </FormField>
          </div>
          <DevisTvaSummary totals={totals} globalDiscountPercent={form.globalDiscountPercent} />
          <FormField label="Conditions de vente">
            <TextArea value={form.conditions} onChange={(v) => setField('conditions', v)} rows={5} placeholder={DEFAULT_CONDITIONS} />
            {!form.conditions && (
              <button type="button" onClick={() => setField('conditions', DEFAULT_CONDITIONS)} className="text-xs text-primary-600 hover:text-primary-700 mt-1">Utiliser les conditions par défaut</button>
            )}
          </FormField>
          <FormField label="Notes internes (non visibles sur le devis)">
            <TextArea value={form.notesInternes} onChange={(v) => setField('notesInternes', v)} rows={2} placeholder="Notes pour usage interne..." />
          </FormField>
        </div>
      )}
    </div>
  );
}
