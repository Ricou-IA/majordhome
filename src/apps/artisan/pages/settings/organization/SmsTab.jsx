// src/apps/artisan/pages/settings/organization/SmsTab.jsx
// ============================================================================
// Settings → Organisation → SMS : gabarits SMS / WhatsApp par campagne.
//
// Source de vérité : core.organizations.settings.sms via useOrgSettings().
//   - identité d'expéditeur (enabled, sms_from, whatsapp_from, short_link_base) :
//     LECTURE SEULE — posée par la plateforme à l'onboarding (le nom d'expéditeur
//     SMS doit être déclaré auprès de l'opérateur), comme la clé Twilio elle-même ;
//   - templates[campagne] = { whatsapp?, sms?, deburr? } : ÉDITABLES ici ;
//   - rappel_rdv = { mode, jour, heure } : réglage du rappel automatique des RDV
//     d'entretien (lu par l'edge `sms-rappel-rdv`, cron horaire). ÉDITABLE ici.
// Les campagnes et leurs variables viennent du registre `src/lib/smsCampaigns.js`
// (source unique partagée avec les émetteurs). Les clés présentes en base mais
// inconnues du code sont affichées et préservées, jamais supprimées en silence.
//
// ⚠ `org_update_settings` merge le JSONB au niveau 1 : on sauve TOUJOURS l'objet
// `sms` COMPLET (identité inchangée + templates), jamais un sous-objet partiel.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Wand2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import {
  listSmsCampaignsForEditor,
  normalizeSmsTemplates,
  findUnknownVariables,
  coutSmsMessage,
  buildRappelRdvConfig,
  decrireRappelRdv,
  JOURS_SEMAINE,
  RAPPEL_RDV_HEURE_MIN,
  RAPPEL_RDV_HEURE_MAX,
} from '@/lib/smsCampaigns';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const TEXTAREA_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

const emptyTemplate = () => ({ whatsapp: '', sms: '', deburr: false });

/** État de formulaire : une entrée par ligne de l'éditeur, toujours les 3 champs. */
function pickTemplates(templates, rows) {
  const out = {};
  rows.forEach((row) => {
    const tpl = templates?.[row.key] || {};
    out[row.key] = {
      whatsapp: tpl.whatsapp ?? '',
      sms: tpl.sms ?? '',
      deburr: tpl.deburr === true,
    };
  });
  return out;
}

/** État complet du formulaire : gabarits + réglage du rappel automatique. */
function pickForm(sms, rows) {
  return { templates: pickTemplates(sms.templates, rows), rappel_rdv: buildRappelRdvConfig(sms) };
}

const HEURES = Array.from(
  { length: RAPPEL_RDV_HEURE_MAX - RAPPEL_RDV_HEURE_MIN + 1 },
  (_, i) => RAPPEL_RDV_HEURE_MIN + i,
);
const SELECT_CLASS = 'px-2 py-1.5 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const MODES = [
  { value: 'off', label: 'Désactivé', hint: 'Aucun rappel automatique.' },
  { value: 'veille', label: 'La veille', hint: 'Chaque jour, pour les rendez-vous du lendemain.' },
  { value: 'hebdo', label: 'En début de semaine', hint: 'Un jour fixe, pour les rendez-vous des 7 jours suivants.' },
];

function RappelRdvSection({ value, onChange, hasTemplate }) {
  const actif = value.mode !== 'off';
  return (
    <section>
      <h3 className={SECTION_TITLE}>Rappel des rendez-vous d&apos;entretien</h3>
      <p className="text-xs text-secondary-500 mb-3">
        Un SMS par rendez-vous d&apos;entretien planifié, envoyé automatiquement avec la date, l&apos;heure
        et le technicien (gabarit « Rappel des rendez-vous d&apos;entretien » ci-dessous). Un rendez-vous
        déplacé est rappelé de nouveau ; un rendez-vous déjà rappelé ne l&apos;est jamais deux fois.
      </p>
      <div className="space-y-2">
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2 text-sm text-secondary-800 cursor-pointer">
            <input
              type="radio"
              name="rappel-rdv-mode"
              value={m.value}
              checked={value.mode === m.value}
              onChange={() => onChange({ mode: m.value })}
              className="mt-1 border-secondary-300 text-primary-600 focus:ring-primary-500"
            />
            <span>
              {m.label}
              <span className="block text-xs text-secondary-500">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {actif && (
        <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-secondary-700">
          {value.mode === 'hebdo' && (
            <label className="flex items-center gap-2">
              Le
              <select
                value={value.jour}
                onChange={(e) => onChange({ jour: Number(e.target.value) })}
                className={SELECT_CLASS}
              >
                {JOURS_SEMAINE.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2">
            à
            <select
              value={value.heure}
              onChange={(e) => onChange({ heure: Number(e.target.value) })}
              className={SELECT_CLASS}
            >
              {HEURES.map((h) => <option key={h} value={h}>{h}h</option>)}
            </select>
            <span className="text-xs text-secondary-500">heure de Paris</span>
          </label>
        </div>
      )}
      <p className="mt-3 text-sm font-medium text-secondary-900">{decrireRappelRdv(value)}</p>
      {actif && !hasTemplate && (
        <p className={ERROR_CLASS}>
          Le gabarit « Rappel des rendez-vous d&apos;entretien » est vide : rien ne partira tant qu&apos;il
          n&apos;est pas renseigné ci-dessous.
        </p>
      )}
    </section>
  );
}

/** Erreurs par campagne : variables {{…}} qui ne seraient pas substituées à l'envoi. */
function validate(form, rows) {
  const errors = {};
  rows.forEach((row) => {
    const value = form[row.key] || emptyTemplate();
    const unknown = [
      ...findUnknownVariables(value.whatsapp, row),
      ...findUnknownVariables(value.sms, row),
    ];
    if (unknown.length > 0) {
      const list = [...new Set(unknown)].map((v) => `{{${v}}}`).join(', ');
      const available = row.variables.map((v) => `{{${v.name}}}`).join(', ');
      errors[row.key] = `Variable inconnue : ${list} — elle partirait telle quelle chez le client. Disponibles : ${available}.`;
    }
  });
  return errors;
}

function ReadOnlyField({ label, value, missingHint }) {
  return (
    <div>
      <span className={LABEL_CLASS}>{label}</span>
      {value ? (
        <p className="text-sm text-secondary-900 font-mono">{value}</p>
      ) : (
        <p className="text-sm text-secondary-400 italic">{missingHint || 'Non configuré'}</p>
      )}
    </div>
  );
}

function IdentitySection({ sms }) {
  const enabled = sms.enabled === true;
  return (
    <section>
      <h3 className={SECTION_TITLE}>Identité d&apos;expéditeur</h3>
      <div className="flex items-center gap-2 mb-4">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            enabled ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {enabled ? 'Envoi activé' : 'Envoi désactivé'}
        </span>
        <span className="text-xs text-secondary-500">
          Activation et identité sont posées par la plateforme à l&apos;onboarding — le nom
          d&apos;expéditeur SMS doit être déclaré auprès de l&apos;opérateur.
        </span>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <ReadOnlyField label="Nom d'expéditeur SMS" value={sms.sms_from} />
        <ReadOnlyField
          label="Numéro WhatsApp"
          value={sms.whatsapp_from}
          missingHint="Non configuré — les gabarits WhatsApp sont ignorés, seul le SMS part"
        />
        <ReadOnlyField label="Domaine des liens courts" value={sms.short_link_base} />
      </div>
    </section>
  );
}

/**
 * « Coût de ce message : N SMS » — sur un exemple RENDU (prénom, date longue, lien
 * court sur le domaine de l'org), accents retirés si l'option l'est. Pas de
 * caractères ni de « segments » : ce que l'utilisateur veut savoir, c'est combien
 * de SMS lui coûte chaque envoi, et ce que le client lira.
 */
function CoutSmsHint({ text, deburr, row, sms }) {
  if (!text) return null;
  const { sms: nbSms, encoding, apercu } = coutSmsMessage(text, { campaign: row, sms, deburr });
  const cher = nbSms > 1;
  return (
    <div className="mt-1.5 space-y-1">
      <p className={`text-sm font-medium ${cher ? 'text-amber-700' : 'text-secondary-800'}`}>
        Coût de ce message : {nbSms} SMS
      </p>
      {cher && encoding === 'ucs2' && (
        <p className={`${HINT_CLASS} text-amber-700`}>
          Un caractère hors alphabet SMS (ê â î ô û ë, apostrophe typographique « ’ », guillemets…)
          fait passer à 70 caractères par SMS au lieu de 160.
          {!deburr && ' Cocher « Retirer les accents à l’envoi » ramène souvent à 1 SMS.'}
        </p>
      )}
      {cher && encoding === 'gsm7' && (
        <p className={`${HINT_CLASS} text-amber-700`}>
          Message long : au-delà de 160 caractères, chaque tranche de 153 caractères compte pour un SMS.
        </p>
      )}
      <p className={HINT_CLASS}>
        Aperçu (exemple) : <span className="italic text-secondary-700">« {apercu} »</span>
      </p>
    </div>
  );
}

function CampaignEditor({ row, value, error, whatsappActive, sms, onChange }) {
  const isEmpty = !value.whatsapp && !value.sms;
  const ids = { whatsapp: `sms-${row.key}-whatsapp`, sms: `sms-${row.key}-sms`, deburr: `sms-${row.key}-deburr` };

  return (
    <div className={`rounded-lg border p-4 space-y-4 ${row.unknown ? 'border-dashed border-secondary-300' : 'border-secondary-200'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-semibold text-secondary-900">
            {row.label}
            {row.unknown && <span className="ml-2 text-xs font-normal text-secondary-500">(clé inconnue du code)</span>}
          </h4>
          <p className="text-xs text-secondary-500 mt-0.5">{row.trigger}</p>
          {isEmpty && !row.unknown && (
            <p className="text-xs text-amber-700 mt-1">
              Aucun gabarit : cette campagne ne part pas tant qu&apos;un texte n&apos;est pas enregistré.
            </p>
          )}
        </div>
        {row.suggested && isEmpty && (
          <button
            type="button"
            onClick={() => onChange({
              whatsapp: row.suggested.whatsapp ?? '',
              sms: row.suggested.sms ?? '',
              deburr: row.suggested.deburr === true,
            })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 border border-primary-300 rounded-md hover:bg-primary-50"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Utiliser le texte suggéré
          </button>
        )}
      </div>

      {row.variables.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {row.variables.map((v) => (
            <span key={v.name} className="text-xs text-secondary-600">
              <code className="px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-800">{`{{${v.name}}}`}</code>
              {' '}{v.label}
            </span>
          ))}
        </div>
      )}

      <div>
        <label htmlFor={ids.whatsapp} className={LABEL_CLASS}>Message WhatsApp</label>
        <textarea
          id={ids.whatsapp}
          value={value.whatsapp}
          onChange={(e) => onChange({ whatsapp: e.target.value })}
          rows={4}
          className={TEXTAREA_CLASS}
          placeholder="Envoyé en priorité si l'organisation a un numéro WhatsApp"
        />
        {!whatsappActive && value.whatsapp && (
          <p className={HINT_CLASS}>
            Aucun numéro WhatsApp configuré : ce texte est conservé mais seul le SMS est envoyé.
          </p>
        )}
      </div>

      <div>
        <label htmlFor={ids.sms} className={LABEL_CLASS}>Message SMS</label>
        <textarea
          id={ids.sms}
          value={value.sms}
          onChange={(e) => onChange({ sms: e.target.value })}
          rows={3}
          className={TEXTAREA_CLASS}
          placeholder="Envoyé si WhatsApp est absent ou échoue"
        />
        <CoutSmsHint text={value.sms} deburr={value.deburr} row={row} sms={sms} />
      </div>

      <label htmlFor={ids.deburr} className="flex items-start gap-2 text-sm text-secondary-700 cursor-pointer">
        <input
          id={ids.deburr}
          type="checkbox"
          checked={value.deburr}
          onChange={(e) => onChange({ deburr: e.target.checked })}
          className="mt-0.5 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
        />
        <span>
          Retirer les accents à l&apos;envoi
          <span className="block text-xs text-secondary-500">
            Un message accentué peut basculer en UCS-2 (70 caractères par segment au lieu de 160). S&apos;applique au SMS comme au WhatsApp.
          </span>
        </span>
      </label>

      {error && <p className={ERROR_CLASS}>{error}</p>}
    </div>
  );
}

export default function SmsTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  // Référence stable (React Query) ou undefined : c'est elle qui pilote l'effet ci-dessous.
  const smsSettings = settings?.sms;
  const sms = smsSettings || {};
  const rows = useMemo(() => listSmsCampaignsForEditor(sms.templates), [sms.templates]);
  const [form, setForm] = useState(() => ({ templates: {}, rappel_rdv: buildRappelRdvConfig({}) }));
  const [initial, setInitial] = useState(form);

  useEffect(() => {
    const picked = pickForm(smsSettings || {}, rows);
    setForm(picked);
    setInitial(picked);
  }, [smsSettings, rows]);

  const errors = useMemo(() => validate(form.templates, rows), [form.templates, rows]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;

  const patchCampaign = (key, patch) =>
    setForm((f) => ({
      ...f,
      templates: { ...f.templates, [key]: { ...(f.templates[key] || emptyTemplate()), ...patch } },
    }));
  const patchRappel = (patch) => setForm((f) => ({ ...f, rappel_rdv: { ...f.rappel_rdv, ...patch } }));

  const rappelTemplate = form.templates.rappel_rdv || emptyTemplate();
  const hasRappelTemplate = !!(rappelTemplate.whatsapp.trim() || rappelTemplate.sms.trim());

  const handleSave = async () => {
    if (!isValid) {
      toast.error("Corrige les variables inconnues avant d'enregistrer.");
      return;
    }
    try {
      // Objet `sms` COMPLET : identité relue telle quelle, gabarits normalisés
      // (textes vides retirés → `campaign_template_missing` à l'envoi), réglage du rappel.
      await save({
        sms: { ...sms, templates: normalizeSmsTemplates(form.templates), rappel_rdv: form.rappel_rdv },
      });
      toast.success('Réglages SMS enregistrés');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'enregistrement");
    }
  };

  const handleReset = () => setForm(initial);

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-8">
      <IdentitySection sms={sms} />

      <RappelRdvSection value={form.rappel_rdv} onChange={patchRappel} hasTemplate={hasRappelTemplate} />

      <section>
        <h3 className={SECTION_TITLE}>Gabarits par campagne</h3>
        <p className="text-xs text-secondary-500 mb-4">
          Les variables entre doubles accolades sont remplacées à l&apos;envoi ; une variable absente
          est retirée et la ponctuation recollée. WhatsApp part en premier quand l&apos;organisation a un
          numéro, le SMS sert de repli.
        </p>
        <div className="space-y-4">
          {rows.map((row) => (
            <CampaignEditor
              key={row.key}
              row={row}
              value={form.templates[row.key] || emptyTemplate()}
              error={errors[row.key]}
              whatsappActive={!!sms.whatsapp_from}
              sms={sms}
              onChange={(patch) => patchCampaign(row.key, patch)}
            />
          ))}
        </div>
      </section>

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
