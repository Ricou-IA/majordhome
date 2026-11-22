// src/apps/artisan/pages/settings/pennylane/EmissionTab.jsx
// ============================================================================
// Réglages `settings.invoicing` : ce que Majord'home met sur les factures qu'il
// émet lui-même (mode « hub », spec 2026-09-22) — préfixe de numérotation,
// coordonnées bancaires, conditions de paiement, pénalités, escompte.
// `org_update_settings` merge le JSONB au niveau 1 → on renvoie TOUJOURS l'objet
// `invoicing` complet. Lecture côté métier : `invoicingSettings()` (module pur).
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { invoicingSettings, validateIban, validateBic, validateNumberPrefix, INVOICING_DEFAULTS } from '@/lib/invoiceDocumentModel';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

function pickForm(settings) {
  const s = invoicingSettings(settings);
  return {
    number_prefix: s.numberPrefix,
    iban: s.iban,
    bic: s.bic,
    payment_terms: s.paymentTerms,
    late_penalty: s.latePenalty,
    discount_note: s.discountNote,
  };
}

function validate(form) {
  const errors = {};
  if (!validateNumberPrefix(form.number_prefix).ok) errors.number_prefix = '1 à 6 caractères A-Z / 0-9, commence par une lettre';
  if (!validateIban(form.iban).ok) errors.iban = 'IBAN invalide (ex. FR76 3000 6000 0112 3456 7890 189)';
  if (!validateBic(form.bic).ok) errors.bic = 'BIC invalide (8 ou 11 caractères)';
  if (!form.payment_terms.trim()) errors.payment_terms = 'Obligatoire sur une facture';
  if (!form.late_penalty.trim()) errors.late_penalty = 'Mention légale obligatoire';
  return errors;
}

export default function EmissionTab() {
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
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async () => {
    if (!isValid) return;
    try {
      const invoicing = {
        ...(settings?.invoicing || {}),
        number_prefix: validateNumberPrefix(form.number_prefix).value,
        iban: validateIban(form.iban).value,
        bic: validateBic(form.bic).value,
        payment_terms: form.payment_terms.trim(),
        late_penalty: form.late_penalty.trim(),
        discount_note: form.discount_note.trim(),
      };
      await save({ invoicing });
      toast.success('Émission des factures enregistrée');
      setInitial(pickForm({ invoicing }));
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'enregistrement");
    }
  };

  if (isLoading) return <div className="card text-sm text-secondary-500">Chargement…</div>;

  return (
    <div className="card space-y-8">
      <section>
        <h3 className={SECTION_TITLE}>Numérotation</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Préfixe des numéros</label>
            <input type="text" value={form.number_prefix} onChange={(e) => setForm({ ...form, number_prefix: e.target.value.toUpperCase() })} className={INPUT_CLASS} maxLength={6} />
            {errors.number_prefix && <p className={ERROR_CLASS}>{errors.number_prefix}</p>}
            <p className={HINT_CLASS}>
              Numéro = préfixe-année-compteur, ex. {form.number_prefix || INVOICING_DEFAULTS.numberPrefix}-{new Date().getFullYear()}-00001. Le compteur repart à 1 chaque année,
              sans trou, attribué à l&apos;émission. Si Pennylane numérote aussi des factures (série « F »), choisissez un préfixe différent.
              Le préfixe se fige au premier numéro émis dans l&apos;année : pour en changer, attendre l&apos;année suivante.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className={SECTION_TITLE}>Coordonnées bancaires (bloc paiement du PDF)</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>IBAN</label>
            <input type="text" value={form.iban} onChange={set('iban')} onBlur={() => setForm((f) => ({ ...f, iban: validateIban(f.iban).value || f.iban }))} className={INPUT_CLASS} placeholder="FR76 …" />
            {errors.iban && <p className={ERROR_CLASS}>{errors.iban}</p>}
            <p className={HINT_CLASS}>Vide : la facture ne porte pas de bloc IBAN.</p>
          </div>
          <div>
            <label className={LABEL_CLASS}>BIC</label>
            <input type="text" value={form.bic} onChange={(e) => setForm({ ...form, bic: e.target.value.toUpperCase() })} className={INPUT_CLASS} placeholder="AGRIFRPP882" />
            {errors.bic && <p className={ERROR_CLASS}>{errors.bic}</p>}
          </div>
        </div>
      </section>

      <section>
        <h3 className={SECTION_TITLE}>Mentions de paiement</h3>
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Conditions de paiement</label>
            <input type="text" value={form.payment_terms} onChange={set('payment_terms')} className={INPUT_CLASS} />
            {errors.payment_terms && <p className={ERROR_CLASS}>{errors.payment_terms}</p>}
          </div>
          <div>
            <label className={LABEL_CLASS}>Pénalités de retard et indemnité de recouvrement</label>
            <textarea rows={2} value={form.late_penalty} onChange={set('late_penalty')} className={INPUT_CLASS} />
            {errors.late_penalty && <p className={ERROR_CLASS}>{errors.late_penalty}</p>}
            <p className={HINT_CLASS}>Mention obligatoire entre professionnels (taux des pénalités + indemnité forfaitaire de 40 €).</p>
          </div>
          <div>
            <label className={LABEL_CLASS}>Escompte</label>
            <input type="text" value={form.discount_note} onChange={set('discount_note')} className={INPUT_CLASS} />
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button type="button" onClick={() => setForm(initial)} disabled={!isDirty || isSaving} className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50">
          Annuler
        </button>
        <button type="button" onClick={handleSave} disabled={!isDirty || !isValid || isSaving} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50">
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
