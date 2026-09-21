// src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx
// ============================================================================
// Réglages `settings.pennylane` : { enabled, invoice: { deadline_days, mode } }.
// `org_update_settings` merge le JSONB au niveau 1 → on renvoie TOUJOURS l'objet
// `pennylane` complet (jamais un sous-objet partiel), cf. Module Solaire.
// Lecture côté métier : `usePennylaneEnabled()` et `pennylaneInvoiceSettings()`
// (src/shared/hooks/useOrgSettings.js).
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings, pennylaneInvoiceSettings } from '@hooks/useOrgSettings';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

function pickForm(settings) {
  const inv = pennylaneInvoiceSettings(settings);
  return {
    enabled: Boolean(settings?.pennylane?.enabled),
    deadline_days: String(inv.deadlineDays),
    mode: inv.mode,
  };
}

function validate(form) {
  const errors = {};
  const n = Number(form.deadline_days);
  if (!Number.isInteger(n) || n < 0 || n > 120) errors.deadline_days = 'Entre 0 et 120 jours';
  return errors;
}

export default function FacturationTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pickForm({}));
  const [initial, setInitial] = useState(() => pickForm({}));

  useEffect(() => {
    const picked = pickForm(settings);
    setForm(picked);
    setInitial(picked);
  }, [settings]);

  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;

  const handleSave = async () => {
    if (!isValid) return;
    try {
      // Objet `pennylane` COMPLET : on préserve les clés qu'on n'édite pas ici.
      const pennylane = {
        ...(settings?.pennylane || {}),
        enabled: form.enabled,
        invoice: {
          ...(settings?.pennylane?.invoice || {}),
          deadline_days: Number(form.deadline_days),
          mode: form.mode,
        },
      };
      await save({ pennylane });
      toast.success('Facturation Pennylane enregistrée');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'enregistrement");
    }
  };

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-8">
      <section>
        <h3 className={SECTION_TITLE}>Intégration</h3>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
          />
          <span>
            <span className="block text-sm font-medium text-secondary-900">Pennylane est activé pour cette organisation</span>
            <span className="block text-xs text-secondary-500">
              Pilote le pipeline par les devis Pennylane, l&apos;explorateur de devis et le bouton « Facturer » des cartes entretien.
            </span>
          </span>
        </label>
      </section>

      <section className={form.enabled ? '' : 'opacity-50 pointer-events-none'}>
        <h3 className={SECTION_TITLE}>Factures d&apos;entretien créées depuis les cartes</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Échéance de paiement (jours)</label>
            <input
              type="number"
              min="0"
              max="120"
              value={form.deadline_days}
              onChange={(e) => setForm({ ...form, deadline_days: e.target.value })}
              className={INPUT_CLASS}
            />
            {errors.deadline_days && <p className={ERROR_CLASS}>{errors.deadline_days}</p>}
            <p className={HINT_CLASS}>Date d&apos;échéance = date de la facture + ce délai.</p>
          </div>
          <div>
            <label className={LABEL_CLASS}>Mode de création</label>
            <select
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value })}
              className={INPUT_CLASS}
            >
              <option value="draft">Brouillon — à finaliser dans Pennylane</option>
              <option value="final">Finalisée — numérotée immédiatement</option>
            </select>
            <p className={HINT_CLASS}>
              Commencez en brouillon : vous relisez et envoyez depuis Pennylane. Une facture finalisée est un document légal, irréversible (avoir).
            </p>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button
          type="button"
          onClick={() => setForm(initial)}
          disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
