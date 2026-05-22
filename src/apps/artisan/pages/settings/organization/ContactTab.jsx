import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

const FIELDS = ['address', 'postal_code', 'city', 'phone', 'from_email', 'reply_to', 'website_url'];

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  if (form.phone && form.phone.replace(/\D/g, '').length !== 10) errors.phone = 'Téléphone FR à 10 chiffres';
  if (!form.from_email?.trim()) errors.from_email = 'Obligatoire';
  if (form.from_email && !EMAIL_RE.test(form.from_email)) errors.from_email = 'Email invalide';
  if (form.reply_to && !EMAIL_RE.test(form.reply_to)) errors.reply_to = 'Email invalide';
  if (form.website_url && !URL_RE.test(autoPrefixHttps(form.website_url))) {
    errors.website_url = 'URL invalide (ex: https://cimaj.fr ou cimaj.fr)';
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
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pickFields({}));
  const [initial, setInitial] = useState(() => pickFields({}));

  useEffect(() => {
    const picked = pickFields(settings);
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
      // Auto-prefix https sur website_url juste avant save
      const payload = { ...form, website_url: autoPrefixHttps(form.website_url) };
      await save(payload);
      toast.success('Coordonnées enregistrées');
      setInitial(payload);
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
      {/* Section Siège social */}
      <section>
        <h3 className={SECTION_TITLE}>Siège social</h3>
        <div>
          <label className={LABEL_CLASS}>Adresse *</label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            maxLength={200}
            placeholder="Ex: 26 Rue des Pyrénées"
            className={INPUT_CLASS}
          />
          {errors.address && <p className={ERROR_CLASS}>{errors.address}</p>}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className={LABEL_CLASS}>Code postal *</label>
            <input
              type="text"
              value={form.postal_code}
              onChange={(e) => setForm({ ...form, postal_code: e.target.value.replace(/\D/g, '').slice(0, 5) })}
              placeholder="81600"
              className={INPUT_CLASS}
            />
            {errors.postal_code && <p className={ERROR_CLASS}>{errors.postal_code}</p>}
          </div>
          <div>
            <label className={LABEL_CLASS}>Ville *</label>
            <input
              type="text"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              maxLength={80}
              placeholder="Gaillac"
              className={INPUT_CLASS}
            />
            {errors.city && <p className={ERROR_CLASS}>{errors.city}</p>}
          </div>
        </div>
      </section>

      {/* Section Contact */}
      <section>
        <h3 className={SECTION_TITLE}>Contact</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Téléphone *</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: formatPhoneFR(e.target.value) })}
              placeholder="05 63 33 23 14"
              className={INPUT_CLASS}
            />
            {errors.phone && <p className={ERROR_CLASS}>{errors.phone}</p>}
          </div>
          <div>
            <label className={LABEL_CLASS}>Email expéditeur *</label>
            <input
              type="email"
              value={form.from_email}
              onChange={(e) => setForm({ ...form, from_email: e.target.value })}
              placeholder="contact@cimaj.fr"
              className={INPUT_CLASS}
            />
            {errors.from_email && <p className={ERROR_CLASS}>{errors.from_email}</p>}
            <p className={HINT_CLASS}>Cet email doit être validé sur Resend pour l'envoi de campagnes.</p>
          </div>
        </div>
        <div className="mt-4">
          <label className={LABEL_CLASS}>Email de réponse (si différent)</label>
          <input
            type="email"
            value={form.reply_to}
            onChange={(e) => setForm({ ...form, reply_to: e.target.value })}
            placeholder="reply@cimaj.fr"
            className={INPUT_CLASS}
          />
          {errors.reply_to && <p className={ERROR_CLASS}>{errors.reply_to}</p>}
          <p className={HINT_CLASS}>Laisse vide pour utiliser l'email expéditeur.</p>
        </div>
      </section>

      {/* Section Présence web */}
      <section>
        <h3 className={SECTION_TITLE}>Présence web</h3>
        <div>
          <label className={LABEL_CLASS}>Site web</label>
          <input
            type="url"
            value={form.website_url}
            onChange={(e) => setForm({ ...form, website_url: e.target.value })}
            placeholder="https://www.cimaj.fr"
            className={INPUT_CLASS}
          />
          {errors.website_url && <p className={ERROR_CLASS}>{errors.website_url}</p>}
        </div>
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
