// Settings → Organisation → Identité : nom, mentions légales, signataire.
// Les qualifications et les documents de l'entreprise ont leur onglet (DocumentsTab).
import { useMemo } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import SignatureUpload from './components/SignatureUpload';
import { useSettingsForm } from './components/useSettingsForm';
import { Field, INPUT_CLASS, SaveBar, SettingsLoading, SettingsSection, SettingsSurface } from './components/layout';

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
  // Signataire : mandats du dossier PV (mairie + Enedis) et attestations d'entretien
  'signatory_name',
  'signatory_role',
  'signatory_signature_path',
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
    errors.siret = 'Format attendu : 14 chiffres (ex. 100 288 224 00015)';
  }
  if (form.tva_intra && !/^FR\s?\d{2}\s?\d{9}$/.test(form.tva_intra)) {
    errors.tva_intra = 'Format attendu : FR + 2 chiffres + 9 chiffres';
  }
  if (form.insurance && form.insurance.length > 200) errors.insurance = 'Maximum 200 caractères';
  if (form.signatory_name && form.signatory_name.length > 80) errors.signatory_name = 'Maximum 80 caractères';
  if (form.signatory_role && form.signatory_role.length > 60) errors.signatory_role = 'Maximum 60 caractères';
  return errors;
}

function pickIdentityFields(settings) {
  const out = {};
  FIELDS.forEach((f) => {
    out[f] = settings[f] ?? '';
  });
  return out;
}

export default function IdentityTab() {
  const { organization } = useAuth();
  const { form, setForm, initial, setInitial, isDirty, save, isSaving, isLoading } = useSettingsForm(pickIdentityFields);

  const errors = useMemo(() => validate(form), [form]);
  const isValid = Object.keys(errors).length === 0;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrigez les erreurs avant d’enregistrer.');
      return;
    }
    try {
      await save(form);
      toast.success('Identité enregistrée');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l’enregistrement');
    }
  };

  if (isLoading) return <SettingsLoading />;

  return (
    <>
      <SettingsSurface>
        <SettingsSection title="Entreprise" description="Le nom affiché sur vos documents, vos e-mails et l’espace client.">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nom commercial" required error={errors.brand_name}>
              <input
                type="text"
                value={form.brand_name}
                onChange={(e) => set('brand_name', e.target.value)}
                maxLength={80}
                placeholder="Ex. Cimaj"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Raison sociale" hint="Reprend le nom commercial si vide." error={errors.legal_name}>
              <input
                type="text"
                value={form.legal_name}
                onChange={(e) => set('legal_name', e.target.value)}
                maxLength={120}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Mentions légales" description="Imprimées en pied de page des devis, factures, certificats et attestations.">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Forme juridique">
              <select value={form.legal_form} onChange={(e) => set('legal_form', e.target.value)} className={INPUT_CLASS}>
                <option value="">Non renseignée</option>
                {LEGAL_FORMS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="Capital social (€)">
              <input
                type="text"
                inputMode="numeric"
                value={form.capital}
                onChange={(e) => set('capital', e.target.value)}
                placeholder="Ex. 6 000"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="SIRET" error={errors.siret}>
              <input
                type="text"
                inputMode="numeric"
                value={form.siret}
                onChange={(e) => set('siret', formatSiret(e.target.value))}
                placeholder="100 288 224 00015"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
            <Field label="N° TVA intracommunautaire" error={errors.tva_intra}>
              <input
                type="text"
                value={form.tva_intra}
                onChange={(e) => set('tva_intra', formatTva(e.target.value))}
                placeholder="FR 06 449776916"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
            <Field label="RCS" className="sm:col-span-2">
              <input
                type="text"
                value={form.rcs}
                onChange={(e) => set('rcs', e.target.value)}
                maxLength={80}
                placeholder="Ex. 100 288 224 R.C.S. Albi"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <Field label="Mention assurance" error={errors.insurance}>
            <textarea
              value={form.insurance}
              onChange={(e) => set('insurance', e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Ex. Couvert par une assurance responsabilité civile professionnelle"
              className={INPUT_CLASS}
            />
          </Field>
        </SettingsSection>

        <SettingsSection
          title="Signataire"
          description="La personne qui signe au nom de l’entreprise : mandats des dossiers solaires et attestations d’entretien."
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nom et prénom" error={errors.signatory_name}>
              <input
                type="text"
                value={form.signatory_name}
                onChange={(e) => set('signatory_name', e.target.value)}
                maxLength={80}
                placeholder="Ex. Jean Martin"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Fonction" error={errors.signatory_role}>
              <input
                type="text"
                value={form.signatory_role}
                onChange={(e) => set('signatory_role', e.target.value)}
                maxLength={60}
                placeholder="Ex. Président"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <Field label="Signature">
            <SignatureUpload
              orgId={organization?.id}
              path={form.signatory_signature_path}
              onChange={(path) => set('signatory_signature_path', path)}
            />
          </Field>
        </SettingsSection>
      </SettingsSurface>

      <SaveBar
        isDirty={isDirty}
        isValid={isValid}
        isSaving={isSaving}
        errorCount={Object.keys(errors).length}
        onSave={handleSave}
        onReset={() => setForm(initial)}
      />
    </>
  );
}
