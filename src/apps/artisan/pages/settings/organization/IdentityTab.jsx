import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import RgeCertificationsInput from './components/RgeCertificationsInput';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

const LEGAL_FORMS = [
  'SAS',
  'SAS à associé unique',
  'SARL',
  'EURL',
  'SA',
  'SCI',
  'EI',
  'Autre',
];

const FIELDS = [
  'brand_name',
  'legal_name',
  'legal_form',
  'capital',
  'siret',
  'rcs',
  'tva_intra',
  'insurance',
  'rge_certifications',
];

// Formatage SIRET : groupes de 3 chiffres + 5 derniers
function formatSiret(raw) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
}

function formatTva(raw) {
  const cleaned = (raw || '').replace(/\s/g, '').toUpperCase();
  if (!cleaned) return '';
  const withoutPrefix = cleaned.startsWith('FR') ? cleaned.slice(2) : cleaned;
  const digits = withoutPrefix.replace(/\D/g, '').slice(0, 11);
  if (!digits) return 'FR';
  if (digits.length <= 2) return `FR ${digits}`;
  return `FR ${digits.slice(0, 2)} ${digits.slice(2)}`;
}

function validate(form) {
  const errors = {};
  if (!form.brand_name?.trim()) errors.brand_name = 'Obligatoire';
  if (form.brand_name && form.brand_name.length > 80) errors.brand_name = 'Maximum 80 caractères';
  if (form.legal_name && form.legal_name.length > 120) errors.legal_name = 'Maximum 120 caractères';
  if (form.siret && !/^\d{3}\s?\d{3}\s?\d{3}\s?\d{5}$/.test(form.siret)) {
    errors.siret = 'Format attendu : 14 chiffres (ex: 100 288 224 00015)';
  }
  if (form.tva_intra && !/^FR\s?\d{2}\s?\d{9}$/.test(form.tva_intra)) {
    errors.tva_intra = 'Format attendu : FR + 2 chiffres + 9 chiffres';
  }
  if (form.insurance && form.insurance.length > 200) errors.insurance = 'Maximum 200 caractères';
  return errors;
}

function pickIdentityFields(settings) {
  const out = {};
  FIELDS.forEach((f) => {
    out[f] = settings[f] ?? (f === 'rge_certifications' ? [] : '');
  });
  return out;
}

export default function IdentityTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pickIdentityFields({}));
  const [initial, setInitial] = useState(() => pickIdentityFields({}));

  useEffect(() => {
    const picked = pickIdentityFields(settings);
    setForm(picked);
    setInitial(picked);
  }, [settings]);

  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrige les erreurs avant d\'enregistrer.');
      return;
    }
    try {
      await save(form);
      toast.success('Identité enregistrée');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    }
  };

  const handleReset = () => setForm(initial);

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-8">
      {/* Section Branding */}
      <section>
        <h3 className={SECTION_TITLE}>Branding</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Nom commercial *</label>
            <input
              type="text"
              value={form.brand_name}
              onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
              maxLength={80}
              placeholder="Ex: Cimaj"
              className={INPUT_CLASS}
            />
            {errors.brand_name && <p className={ERROR_CLASS}>{errors.brand_name}</p>}
          </div>
          <div>
            <label className={LABEL_CLASS}>Raison sociale</label>
            <input
              type="text"
              value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
              maxLength={120}
              placeholder="Auto-rempli avec le nom commercial si vide"
              className={INPUT_CLASS}
            />
            {errors.legal_name && <p className={ERROR_CLASS}>{errors.legal_name}</p>}
          </div>
        </div>
      </section>

      {/* Section Mention légale */}
      <section>
        <h3 className={SECTION_TITLE}>Mention légale</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={LABEL_CLASS}>Forme juridique</label>
            <select
              value={form.legal_form}
              onChange={(e) => setForm({ ...form, legal_form: e.target.value })}
              className={INPUT_CLASS}
            >
              <option value="">—</option>
              {LEGAL_FORMS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Capital social (€)</label>
            <input
              type="text"
              value={form.capital}
              onChange={(e) => setForm({ ...form, capital: e.target.value })}
              placeholder="Ex: 6 000"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>SIRET</label>
            <input
              type="text"
              value={form.siret}
              onChange={(e) => setForm({ ...form, siret: formatSiret(e.target.value) })}
              placeholder="Ex: 100 288 224 00015"
              className={INPUT_CLASS}
            />
            {errors.siret && <p className={ERROR_CLASS}>{errors.siret}</p>}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className={LABEL_CLASS}>RCS</label>
            <input
              type="text"
              value={form.rcs}
              onChange={(e) => setForm({ ...form, rcs: e.target.value })}
              maxLength={80}
              placeholder="Ex: 100 288 224 R.C.S. Albi"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>N° TVA intracommunautaire</label>
            <input
              type="text"
              value={form.tva_intra}
              onChange={(e) => setForm({ ...form, tva_intra: formatTva(e.target.value) })}
              placeholder="Ex: FR 06 449776916"
              className={INPUT_CLASS}
            />
            {errors.tva_intra && <p className={ERROR_CLASS}>{errors.tva_intra}</p>}
          </div>
        </div>
        <div className="mt-4">
          <label className={LABEL_CLASS}>Mention assurance</label>
          <textarea
            value={form.insurance}
            onChange={(e) => setForm({ ...form, insurance: e.target.value })}
            maxLength={200}
            rows={2}
            placeholder="Ex: Couvert par une assurance responsabilité civile professionnelle"
            className={INPUT_CLASS}
          />
          {errors.insurance && <p className={ERROR_CLASS}>{errors.insurance}</p>}
        </div>
      </section>

      {/* Section Qualifications */}
      <section>
        <h3 className={SECTION_TITLE}>Qualifications RGE</h3>
        <RgeCertificationsInput
          value={form.rge_certifications}
          onChange={(newList) => setForm({ ...form, rge_certifications: newList })}
        />
      </section>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button
          type="button"
          onClick={handleReset}
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
