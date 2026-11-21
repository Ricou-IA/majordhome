// src/apps/artisan/pages/settings/communication/EmailsTab.jsx
// ============================================================================
// Paramètres → E-mails & SMS (/settings/emails) : identité d'envoi des
// emails de l'organisation — `from_email` (expéditeur, dont le domaine doit être
// vérifié sur Resend) et `reply_to` — puis le domaine d'envoi (ResendDomainSection).
// Sortis de Organisation → Coordonnées le 2026-09-13 (regroupement par module) :
// mêmes clés `core.organizations.settings`, même canal `useOrgSettings().save`
// (merge JSONB niveau 1 : on n'envoie que ces deux clés).
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useAuth } from '@contexts/AuthContext';
import { moduleActif } from '@/lib/modules';
import { emailsAffiches } from '@/lib/emailsAutomatiques';
import { phraseEtatEnvoi } from '@/lib/expediteur';
import ResendDomainSection from './ResendDomainSection';
import EmailAutoLigne from './EmailAutoLigne';
import AccueilLeadMetaSection from './AccueilLeadMetaSection';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

const FIELDS = ['from_email', 'reply_to'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(form) {
  const errors = {};
  if (!form.from_email?.trim()) errors.from_email = 'Obligatoire';
  if (form.from_email && !EMAIL_RE.test(form.from_email)) errors.from_email = 'Email invalide';
  if (form.reply_to && !EMAIL_RE.test(form.reply_to)) errors.reply_to = 'Email invalide';
  return errors;
}

function pickFields(settings) {
  const out = {};
  FIELDS.forEach((f) => { out[f] = settings[f] ?? ''; });
  return out;
}

export default function EmailsTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const { organization } = useAuth();
  const orgId = organization?.id;
  const [form, setForm] = useState(() => pickFields({}));
  const [initial, setInitial] = useState(() => pickFields({}));

  const communicationActive = moduleActif(settings, 'communication');
  // D'où partent les e-mails, d'après ce qui est ENREGISTRÉ (pas la saisie en cours).
  const etatEnvoi = phraseEtatEnvoi(settings);

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
      await save(form);
      toast.success('Emails enregistrés');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    }
  };

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <>
      <div className="card space-y-8">
        <section>
          <h3 className={SECTION_TITLE}>Identité d&apos;envoi</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLASS}>Votre adresse e-mail *</label>
              <input
                type="email"
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                placeholder="contact@votre-entreprise.fr"
                className={INPUT_CLASS}
              />
              {errors.from_email && <p className={ERROR_CLASS}>{errors.from_email}</p>}
              <p className={HINT_CLASS}>Les réponses de vos clients y arrivent.</p>
            </div>
            <div>
              <label className={LABEL_CLASS}>Email de réponse (si différent)</label>
              <input
                type="email"
                value={form.reply_to}
                onChange={(e) => setForm({ ...form, reply_to: e.target.value })}
                placeholder="bureau@votre-entreprise.fr"
                className={INPUT_CLASS}
              />
              {errors.reply_to && <p className={ERROR_CLASS}>{errors.reply_to}</p>}
              <p className={HINT_CLASS}>Laissez vide pour recevoir les réponses à votre adresse.</p>
            </div>
          </div>
          {etatEnvoi && <p className="mt-3 text-sm text-secondary-700">{etatEnvoi}</p>}
        </section>

        {communicationActive && (
          <section>
            <h3 className={SECTION_TITLE}>E-mails envoyés automatiquement</h3>
            <p className={HINT_CLASS}>
              Chaque e-mail part avec un texte par défaut tant que vous ne l&apos;avez pas modifié. Un essai arrive à
              l&apos;adresse enregistrée ci-dessus, celle qui reçoit les réponses.
            </p>
            {emailsAffiches((cle) => moduleActif(settings, cle)).map((email) => (
              email.interrupteur === 'lead_welcome_email'
                ? <AccueilLeadMetaSection key={email.gabarit.key} orgId={orgId} />
                : (
                  <EmailAutoLigne
                    key={email.gabarit.key}
                    orgId={orgId}
                    gabarit={email.gabarit}
                    titre={email.titre}
                    description={email.description}
                  />
                )
            ))}
          </section>
        )}

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
      <ResendDomainSection />
    </>
  );
}
