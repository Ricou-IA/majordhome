// Settings → Organisation → Coordonnées : adresse du siège, téléphone, site web.
// Règles (formats, contrôles) : src/lib/organisation/identite.js.
// Emails (from_email, reply_to, domaine d'envoi) : Paramètres → E-mails & SMS (communication/EmailsTab.jsx).
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Globe, Phone } from 'lucide-react';
import { useLiaisonHesiasun } from '@hooks/useLiaisonHesiasun';
import { useSettingsForm } from './components/useSettingsForm';
import { CLES_COORDONNEES, formatTelephone, prefixerHttps, validerSaisie } from '@/lib/organisation/identite';
import { JOURS_SEMAINE, basculerJour, lireJoursOuverture } from '@/lib/joursOuverture';
import { Field, INPUT_CLASS, SaveBar, SettingsLoading, SettingsSection, SettingsSurface } from './components/layout';

const FIELDS = CLES_COORDONNEES;

function pickFields(settings) {
  const out = {};
  FIELDS.forEach((f) => {
    out[f] = settings[f] ?? '';
  });
  // Jours d'ouverture (Eric 2026-11-24) : le Planning masque les jours fermés.
  out.jours_ouverture = lireJoursOuverture(settings);
  return out;
}

export default function ContactTab() {
  const { form, setForm, initial, setInitial, isDirty, save, isSaving, isLoading } = useSettingsForm(pickFields);

  const { envoyerApresEnregistrement } = useLiaisonHesiasun();

  const errors = useMemo(() => validerSaisie(form, CLES_COORDONNEES), [form]);
  const isValid = Object.keys(errors).length === 0;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrigez les erreurs avant d’enregistrer.');
      return;
    }
    try {
      const payload = { ...form, website_url: prefixerHttps(form.website_url) };
      await save(payload);
      toast.success('Coordonnées enregistrées');
      setInitial(payload);
      setForm(payload);
      // Entreprise reliée à HésiaSun : les coordonnées enregistrées y partent.
      envoyerApresEnregistrement();
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l’enregistrement');
    }
  };

  if (isLoading) return <SettingsLoading />;

  return (
    <>
      <SettingsSurface colonnes>
        <SettingsSection title="Siège social" description="Adresse imprimée sur vos documents.">
          <Field label="Adresse" required error={errors.address}>
            <input
              type="text"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              maxLength={200}
              placeholder="Ex. 26 rue des Pyrénées"
              autoComplete="street-address"
              className={INPUT_CLASS}
            />
          </Field>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Code postal" required error={errors.postal_code}>
              <input
                type="text"
                inputMode="numeric"
                value={form.postal_code}
                onChange={(e) => set('postal_code', e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="81600"
                autoComplete="postal-code"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
            <Field label="Ville" required error={errors.city} className="sm:col-span-2">
              <input
                type="text"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                maxLength={80}
                placeholder="Gaillac"
                autoComplete="address-level2"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection title="Jours d’ouverture" description="Le planning n’affiche que ces jours.">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Jours d’ouverture">
            {JOURS_SEMAINE.map(({ jour, libelle }) => {
              const ouvert = form.jours_ouverture.includes(jour);
              return (
                <label key={jour} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${ouvert ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-secondary-200 text-secondary-600'}`}>
                  <input
                    type="checkbox"
                    checked={ouvert}
                    onChange={() => set('jours_ouverture', basculerJour(form.jours_ouverture, jour))}
                    className="rounded border-secondary-300"
                  />
                  {libelle}
                </label>
              );
            })}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Contact"
          description={<>Affichés sur vos documents et vos e-mails. Les adresses d’envoi se règlent dans <Link to="/settings/communication" className="text-primary-700 hover:underline">E-mails &amp; SMS</Link>.</>}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Téléphone" required error={errors.phone}>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', formatTelephone(e.target.value))}
                  placeholder="05 63 33 23 14"
                  className={`${INPUT_CLASS} pl-9 tabular-nums`}
                />
              </div>
            </Field>
            <Field label="Site web" error={errors.website_url}>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
                <input
                  type="url"
                  value={form.website_url}
                  onChange={(e) => set('website_url', e.target.value)}
                  placeholder="www.votre-entreprise.fr"
                  className={`${INPUT_CLASS} pl-9`}
                />
              </div>
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
        onReset={() => setForm(initial)}
      />
    </>
  );
}
