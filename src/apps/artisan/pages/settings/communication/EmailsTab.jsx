// src/apps/artisan/pages/settings/communication/EmailsTab.jsx
// ============================================================================
// Settings → Communication → Emails (/settings/emails) : identité d'envoi des
// emails de l'organisation — `from_email` (expéditeur, dont le domaine doit être
// vérifié sur Resend) et `reply_to` — puis le domaine d'envoi (ResendDomainSection).
// Sortis de Organisation → Coordonnées le 2026-09-13 (regroupement par module) :
// mêmes clés `core.organizations.settings`, même canal `useOrgSettings().save`
// (merge JSONB niveau 1 : on n'envoie que ces deux clés).
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useAuth } from '@contexts/AuthContext';
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { mailCampaignKeys } from '@hooks/cacheKeys';
import { moduleActif } from '@/lib/modules';
import { DEFAULT_INVOICE_EMAIL, INVOICE_EMAIL_TEMPLATE_KEY, INVOICE_EMAIL_PLACEHOLDERS } from '@/lib/invoiceEmailTemplate';
import ResendDomainSection from './ResendDomainSection';

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
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => pickFields({}));
  const [initial, setInitial] = useState(() => pickFields({}));
  const [creatingTemplate, setCreatingTemplate] = useState(false);

  const communicationActive = moduleActif(settings, 'communication');

  const { data: invoiceTemplate, isLoading: loadingTemplate } = useQuery({
    queryKey: mailCampaignKeys.byKey(orgId, INVOICE_EMAIL_TEMPLATE_KEY),
    queryFn: async () => {
      const { data, error } = await mailCampaignsService.getByKey(orgId, INVOICE_EMAIL_TEMPLATE_KEY);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && communicationActive,
  });

  // M5 — un gabarit ARCHIVÉ (existant mais `is_archived=true`) doit proposer une restauration,
  // jamais le bouton de création : la contrainte unique `(org_id, key)` refuserait le create.
  const { data: archivedTemplate, isLoading: loadingArchived } = useQuery({
    queryKey: mailCampaignKeys.archivedByKey(orgId, INVOICE_EMAIL_TEMPLATE_KEY),
    queryFn: async () => {
      const { data, error } = await mailCampaignsService.list(orgId, { includeArchived: true });
      if (error) throw error;
      return (data || []).find((c) => c.key === INVOICE_EMAIL_TEMPLATE_KEY && c.is_archived) || null;
    },
    enabled: !!orgId && communicationActive && !loadingTemplate && !invoiceTemplate,
  });

  const handleCreateInvoiceTemplate = async () => {
    if (!orgId || creatingTemplate) return;
    setCreatingTemplate(true);
    try {
      const { error } = await mailCampaignsService.create({ org_id: orgId, ...DEFAULT_INVOICE_EMAIL });
      if (error) throw error;
      toast.success('Gabarit « Facture d’entretien » créé');
      queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all(orgId) });
    } catch (err) {
      toast.error(err.message || 'Création du gabarit échouée');
    } finally {
      setCreatingTemplate(false);
    }
  };

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
              <label className={LABEL_CLASS}>Email expéditeur *</label>
              <input
                type="email"
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                placeholder="contact@cimaj.fr"
                className={INPUT_CLASS}
              />
              {errors.from_email && <p className={ERROR_CLASS}>{errors.from_email}</p>}
              <p className={HINT_CLASS}>Son domaine doit être vérifié ci-dessous (« Domaine d&apos;envoi »).</p>
            </div>
            <div>
              <label className={LABEL_CLASS}>Email de réponse (si différent)</label>
              <input
                type="email"
                value={form.reply_to}
                onChange={(e) => setForm({ ...form, reply_to: e.target.value })}
                placeholder="reply@cimaj.fr"
                className={INPUT_CLASS}
              />
              {errors.reply_to && <p className={ERROR_CLASS}>{errors.reply_to}</p>}
              <p className={HINT_CLASS}>Laisse vide pour utiliser l&apos;email expéditeur.</p>
            </div>
          </div>
        </section>

        {communicationActive && (
          <section>
            <h3 className={SECTION_TITLE}>Gabarits transactionnels</h3>
            <div className="border border-secondary-200 rounded-md p-3 text-sm flex items-center justify-between gap-4">
              <div>
                <p className="text-secondary-900 font-medium">Facture d&apos;entretien (envoi au client)</p>
                {invoiceTemplate && (
                  <p className="mt-1 text-xs text-secondary-500">
                    Variables : {INVOICE_EMAIL_PLACEHOLDERS.map((v) => <code key={v} className="mr-1">{v}</code>)}
                  </p>
                )}
              </div>
              {loadingTemplate || (!invoiceTemplate && loadingArchived) ? (
                <span className="text-xs text-secondary-500">Chargement…</span>
              ) : invoiceTemplate ? (
                <Link to="/mailing" className="text-sm text-primary-600 hover:underline whitespace-nowrap">
                  Modifier dans Mailing → Éditeur
                </Link>
              ) : archivedTemplate ? (
                <Link to="/mailing" className="text-sm text-amber-700 hover:underline whitespace-nowrap">
                  Gabarit archivé : restaurez-le dans Mailing → Éditeur
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateInvoiceTemplate}
                  disabled={creatingTemplate}
                  className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {creatingTemplate ? 'Création…' : 'Créer le gabarit par défaut'}
                </button>
              )}
            </div>
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
