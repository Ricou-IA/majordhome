// Settings → Organisation → Identité : nom, mentions légales, signataire.
// Les qualifications et les documents de l'entreprise ont leur onglet (DocumentsTab).
// Règles (champs, formats, contrôles) : src/lib/organisation/identite.js. Raison sociale, SIRET et forme
// juridique viennent de l'annuaire des entreprises, la TVA se calcule du SIRET (Eric 2026-11-21, comme
// HésiaSun) ; la saisie à la main ne s'ouvre que si l'entreprise est introuvable.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { CLES_IDENTITE, LEGAL_FORMS, formatSiret, formatTva, tvaDepuisSiret, validerSaisie } from '@/lib/organisation/identite';
import { appliquerEntreprise, identiteEnregistree } from '@/lib/organisation/annuaire';
import EntrepriseSearch from './components/EntrepriseSearch';
import SignatureUpload from './components/SignatureUpload';
import { useSettingsForm } from './components/useSettingsForm';
import { Field, INPUT_CLASS, SaveBar, SettingsLoading, SettingsSection, SettingsSurface } from './components/layout';

// Signataire : mandats du dossier PV (mairie + Enedis) et attestations d'entretien
const FIELDS = [...CLES_IDENTITE, 'signatory_signature_path'];
const VERROUILLE = 'bg-secondary-50 text-secondary-700 cursor-default';

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

  // Entreprise choisie dans l'annuaire, pas encore enregistrée : message et adresse du siège à joindre.
  const [annuaire, setAnnuaire] = useState(null);
  const [changer, setChanger] = useState(false);
  const [saisieLibre, setSaisieLibre] = useState(false);

  // Enregistré ou annulé : le préremplissage est consommé.
  useEffect(() => {
    if (!isDirty) setAnnuaire(null);
  }, [isDirty]);

  // La TVA suit le SIRET dès qu'il est complet ; sans SIRET complet elle reste ce qui est enregistré.
  const tvaCalculee = formatTva(tvaDepuisSiret(form.siret));
  const tva = tvaCalculee || form.tva_intra;
  const errors = useMemo(() => validerSaisie({ ...form, tva_intra: tva }, CLES_IDENTITE), [form, tva]);
  const isValid = Object.keys(errors).length === 0;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const replie = identiteEnregistree(initial) && !changer;
  // La forme juridique vient de l'annuaire ; elle se choisit à la main quand il n'a pas su la traduire
  // (ou qu'aucune n'est enregistrée), et le reste tant que l'onglet n'est pas enregistré.
  const formeAChoisir = annuaire ? !annuaire.form.legal_form : !initial.legal_form;
  const formes = form.legal_form && !LEGAL_FORMS.includes(form.legal_form) ? [...LEGAL_FORMS, form.legal_form] : LEGAL_FORMS;

  const choisirEntreprise = (entreprise) => {
    const report = appliquerEntreprise(form, entreprise);
    setForm(report.form);
    setAnnuaire(report);
    setSaisieLibre(false);
  };

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrigez les erreurs avant d’enregistrer.');
      return;
    }
    const identite = { ...form, tva_intra: tva };
    try {
      // L'adresse du siège trouvée dans l'annuaire part avec l'identité (onglet Coordonnées).
      await save({ ...identite, ...(annuaire?.siege || {}) });
      toast.success(annuaire?.siege ? 'Identité et adresse du siège enregistrées' : 'Identité enregistrée');
      setInitial(identite);
      setForm(identite);
      setChanger(false);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l’enregistrement');
    }
  };

  if (isLoading) return <SettingsLoading />;

  return (
    <>
      <SettingsSurface>
        <SettingsSection title="Entreprise">
          <div className="grid lg:grid-cols-3 gap-x-4 gap-y-3 items-start">
          {replie ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-sm">
              <Building2 className="w-4 h-4 shrink-0 text-secondary-500" />
              <span className="min-w-0 text-secondary-900">
                <span className="font-medium">{initial.legal_name?.trim() || initial.brand_name?.trim()}</span>
                <span className="tabular-nums text-secondary-600"> · SIRET {formatSiret(initial.siret)}</span>
              </span>
              <button type="button" onClick={() => setChanger(true)} className="ml-auto text-sm font-medium text-primary-700 hover:underline">
                Changer d’entreprise
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Field
                label="Retrouver votre entreprise"
                hint="Par son nom ou son SIRET. Remplit les mentions légales et l’adresse du siège."
              >
                <EntrepriseSearch onSelect={choisirEntreprise} autoFocus={changer} />
              </Field>
              {!saisieLibre && (
                <button type="button" onClick={() => setSaisieLibre(true)} className="text-xs text-secondary-600 hover:text-secondary-900 underline">
                  Entreprise introuvable dans l’annuaire ? Saisir à la main
                </button>
              )}
            </div>
          )}

          {annuaire && isDirty && (
            <div role="status" className="lg:col-span-3 lg:order-last rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-secondary-900 space-y-1">
              <p className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-primary-700" />
                <span>{annuaire.detail}</span>
              </p>
              {annuaire.avertissement && <p className="pl-6 font-medium">{annuaire.avertissement}</p>}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 lg:col-span-2">
            <Field label="Nom commercial" required error={errors.brand_name}>
              <input
                type="text"
                value={form.brand_name}
                onChange={(e) => set('brand_name', e.target.value)}
                maxLength={80}
                placeholder="Ex. Atelier du Chauffage"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Raison sociale"
              hint={saisieLibre ? 'Reprend le nom commercial si vide.' : undefined}
              error={errors.legal_name}
            >
              <input
                type="text"
                value={form.legal_name}
                onChange={(e) => set('legal_name', e.target.value)}
                readOnly={!saisieLibre}
                maxLength={120}
                className={`${INPUT_CLASS} ${saisieLibre ? '' : VERROUILLE}`}
              />
            </Field>
          </div>
          </div>
        </SettingsSection>

        <SettingsSection title="Mentions légales" description="Imprimées en pied de page de vos documents.">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
            <Field label="SIRET" error={errors.siret}>
              <input
                type="text"
                inputMode="numeric"
                value={form.siret}
                onChange={(e) => set('siret', formatSiret(e.target.value))}
                readOnly={!saisieLibre}
                placeholder={saisieLibre ? '123 456 789 00012' : ''}
                className={`${INPUT_CLASS} tabular-nums ${saisieLibre ? '' : VERROUILLE}`}
              />
            </Field>
            <Field
              label="N° TVA intracommunautaire"
              hint={tvaCalculee ? 'Calculé à partir du SIRET.' : undefined}
              error={errors.tva_intra}
            >
              <input
                type="text"
                value={tva}
                onChange={(e) => set('tva_intra', formatTva(e.target.value))}
                readOnly={!!tvaCalculee || !saisieLibre}
                className={`${INPUT_CLASS} tabular-nums ${tvaCalculee || !saisieLibre ? VERROUILLE : ''}`}
              />
            </Field>
            <Field
              label="Forme juridique"
              hint={!saisieLibre && formeAChoisir && form.siret ? 'L’annuaire ne la précise pas : choisissez-la.' : undefined}
            >
              <select
                value={form.legal_form}
                onChange={(e) => set('legal_form', e.target.value)}
                // Reprise de l'annuaire ; elle ne se choisit à la main que s'il n'a pas su la traduire.
                disabled={!saisieLibre && !formeAChoisir}
                className={INPUT_CLASS}
              >
                <option value="">Non renseignée</option>
                {formes.map((f) => (
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
            <Field label="RCS" className="sm:col-span-2" hint="Tel qu’il figure sur votre Kbis.">
              <input
                type="text"
                value={form.rcs}
                onChange={(e) => set('rcs', e.target.value)}
                maxLength={80}
                placeholder="Ex. 123 456 789 R.C.S. Albi"
                className={INPUT_CLASS}
              />
            </Field>
          <Field label="Mention assurance" error={errors.insurance} className="sm:col-span-2">
            <textarea
              value={form.insurance}
              onChange={(e) => set('insurance', e.target.value)}
              maxLength={200}
              rows={1}
              placeholder="Ex. Couvert par une assurance responsabilité civile professionnelle"
              className={INPUT_CLASS}
            />
          </Field>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Signataire"
          description="Signe au nom de l’entreprise les mandats et les attestations."
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
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
          <Field label="Signature" className="sm:col-span-2">
            <SignatureUpload
              orgId={organization?.id}
              path={form.signatory_signature_path}
              onChange={(path) => set('signatory_signature_path', path)}
            />
          </Field>
          </div>
        </SettingsSection>
      </SettingsSurface>

      <SaveBar
        isDirty={isDirty}
        isValid={isValid}
        isSaving={isSaving}
        errorCount={Object.keys(errors).length}
        onSave={handleSave}
        onReset={() => {
          setForm(initial);
          setChanger(false);
          setSaisieLibre(false);
        }}
      />
    </>
  );
}
