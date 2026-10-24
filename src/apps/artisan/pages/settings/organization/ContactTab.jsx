// Settings → Organisation → Coordonnées : adresse du siège, téléphone, site web.
// Emails (from_email, reply_to, domaine d'envoi) : Settings → Communication → Emails (communication/EmailsTab.jsx).
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Globe, Phone } from 'lucide-react';
import { useSettingsForm } from './components/useSettingsForm';
import { Field, INPUT_CLASS, SaveBar, SettingsLoading, SettingsSection, SettingsSurface } from './components/layout';

const FIELDS = ['address', 'postal_code', 'city', 'phone', 'website_url'];

function formatPhoneFR(raw) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 10);
  const groups = [];
  for (let i = 0; i < digits.length; i += 2) {
    groups.push(digits.slice(i, i + 2));
  }
  return groups.join(' ');
}

function autoPrefixHttps(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

const URL_RE = /^https?:\/\/[^\s]+$/i;

function validate(form) {
  const errors = {};
  if (!form.address?.trim()) errors.address = 'Obligatoire';
  if (form.address && form.address.length > 200) errors.address = 'Maximum 200 caractères';
  if (!form.postal_code?.trim()) errors.postal_code = 'Obligatoire';
  if (form.postal_code && !/^\d{5}$/.test(form.postal_code)) errors.postal_code = '5 chiffres attendus';
  if (!form.city?.trim()) errors.city = 'Obligatoire';
  if (form.city && form.city.length > 80) errors.city = 'Maximum 80 caractères';
  if (!form.phone?.trim()) errors.phone = 'Obligatoire';
  if (form.phone && form.phone.replace(/\D/g, '').length !== 10) errors.phone = 'Téléphone français à 10 chiffres';
  if (form.website_url && !URL_RE.test(autoPrefixHttps(form.website_url))) {
    errors.website_url = 'Adresse invalide (ex. https://cimaj.fr ou cimaj.fr)';
  }
  return errors;
}

function pickFields(settings) {
  const out = {};
  FIELDS.forEach((f) => {
    out[f] = settings[f] ?? '';
  });
  return out;
}

export default function ContactTab() {
  const { form, setForm, initial, setInitial, isDirty, save, isSaving, isLoading } = useSettingsForm(pickFields);

  const errors = useMemo(() => validate(form), [form]);
  const isValid = Object.keys(errors).length === 0;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrigez les erreurs avant d’enregistrer.');
      return;
    }
    try {
      const payload = { ...form, website_url: autoPrefixHttps(form.website_url) };
      await save(payload);
      toast.success('Coordonnées enregistrées');
      setInitial(payload);
      setForm(payload);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l’enregistrement');
    }
  };

  if (isLoading) return <SettingsLoading />;

  return (
    <>
      <SettingsSurface>
        <SettingsSection title="Siège social" description="Adresse imprimée sur vos documents. Le point de départ des trajets se règle dans l’onglet Territoire.">
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

        <SettingsSection
          title="Contact"
          description={<>Affichés sur vos documents et vos e-mails. Les adresses d’envoi se règlent dans <Link to="/settings/emails" className="text-primary-700 hover:underline">Communication → Emails</Link>.</>}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Téléphone" required error={errors.phone}>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', formatPhoneFR(e.target.value))}
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
                  placeholder="www.cimaj.fr"
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
