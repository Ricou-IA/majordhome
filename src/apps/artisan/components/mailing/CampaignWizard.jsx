import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Copy, Eye, Loader2, X, Sparkles, Zap, Filter } from 'lucide-react';
import { Button } from '@components/ui/button';
import { useAuth } from '@contexts/AuthContext';
import { useMailSegments } from '@hooks/useMailSegments';
import { formatResourcesForPrompt } from './resources';

// Palette de tons éditoriaux (volontairement courte et tranchée)
const TONE_OPTIONS = [
  'Informatif',
  'Rassurant, chaleureux',
  'Commercial, incitatif',
  'Pédagogique, expert',
  'Remerciement, bienveillant',
];

// Slugify simple — utilisé pour dériver la clé technique depuis le label
function slugifyKey(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'campagne';
}

/**
 * Wizard de création/édition de campagne mailing.
 * 4 étapes : Identité → Intro/Objet → Blocs → Génération + Sauvegarde.
 *
 * En Vdef, l'étape 4 pourrait appeler une API IA (OpenAI/Anthropic) directement.
 * En V1, le wizard produit un prompt système que l'utilisateur copie vers
 * Claude, récupère le HTML, et colle dans le textarea avant de sauvegarder.
 */
export default function CampaignWizard({ initial, onClose, onSave, isSaving }) {
  const { organization } = useAuth();
  const { segments } = useMailSegments(organization?.id);

  // État du formulaire
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => buildInitialForm(initial));

  const update = useCallback((patch) => setForm((f) => ({ ...f, ...patch })), []);

  const promptText = useMemo(() => buildPrompt(form), [form]);
  const jsonText = useMemo(() => JSON.stringify(buildJsonPayload(form), null, 2), [form]);

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copié`);
    } catch {
      toast.error('Copie impossible');
    }
  };

  const canGoNext = useMemo(() => validateStep(step, form), [step, form]);

  const handleSave = async () => {
    if (!form.html_body || !form.html_body.trim()) {
      toast.error('Colle le HTML généré par Claude avant de sauvegarder');
      return;
    }
    if (!form.subject?.trim()) {
      toast.error("Renseigne l'objet du mail à l'étape 2 — sinon le mail sera rejeté à l'envoi");
      return;
    }
    // Clé technique et tag tracking dérivés du label (ou conservés si édition)
    const key = form.key.trim() || slugifyKey(form.label);
    const tracking = form.tracking_type_value.trim() || key;
    const payload = {
      key,
      label: form.label.trim(),
      subject: form.subject.trim(),
      preheader: form.preheader.trim() || null,
      html_body: form.html_body,
      tracking_type_value: tracking,
      default_segment: null,       // legacy, remplacé par auto_segment_id
      allowed_segments: null,      // legacy, remplacé par auto_segment_id
      purpose: form.purpose.trim() || null,
      audience: form.audience.trim() || null,
      tone: form.tone.trim() || null,
      trigger_description: form.trigger_description.trim() || null,
      notes: form.notes.trim() || null,
      blocks: { brief: form.brief },
      is_automated: !!form.is_automated,
      auto_segment_id: form.auto_segment_id || null,
      auto_cadence_days: form.auto_cadence_days ? Number(form.auto_cadence_days) : null,
      auto_cadence_minutes: form.auto_cadence_minutes ? Number(form.auto_cadence_minutes) : null,
      auto_time_of_day: form.auto_time_of_day || '09:00',
      // Si activation fraîche de l'automatisation, on déclenche tout de suite à la prochaine tick du cron
      next_run_at: form.is_automated && !initial?.is_automated ? new Date().toISOString() : initial?.next_run_at || null,
    };
    await onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-auto max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-xl font-bold text-secondary-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary-600" />
              {initial ? 'Éditer la campagne' : 'Nouvelle campagne'}
            </h2>
            <p className="text-xs text-secondary-500 mt-1">Étape {step} / 3</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex border-b bg-gray-50">
          {['Identité', 'Brief', 'Génération'].map((label, idx) => {
            const stepNum = idx + 1;
            const isActive = stepNum === step;
            const isDone = stepNum < step;
            return (
              <button
                key={label}
                onClick={() => setStep(stepNum)}
                className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary-600 text-primary-700 bg-white'
                    : isDone
                      ? 'border-primary-300 text-primary-600'
                      : 'border-transparent text-secondary-500'
                }`}
              >
                {isDone && <Check className="w-3 h-3 inline mr-1" />}
                {stepNum}. {label}
              </button>
            );
          })}
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-auto p-6">
          {step === 1 && <StepIdentity form={form} update={update} segments={segments} />}
          {step === 2 && <StepBrief form={form} update={update} />}
          {step === 3 && (
            <StepGenerate
              form={form}
              update={update}
              promptText={promptText}
              jsonText={jsonText}
              copyToClipboard={copyToClipboard}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <Button variant="secondary" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Précédent
          </Button>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            {step < 3 ? (
              <Button onClick={() => setStep((s) => Math.min(3, s + 1))} disabled={!canGoNext}>
                Suivant
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={isSaving || !form.html_body?.trim()}>
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Sauvegarder
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// STEP 1 — Identité
// =============================================================================

function StepIdentity({ form, update, segments }) {
  const clientSegments = segments.filter((s) => s.audience === 'clients');
  const leadSegments = segments.filter((s) => s.audience === 'leads');
  return (
    <div className="space-y-6">
      {/* Libellé en en-tête */}
      <Field label="Libellé de la campagne" required hint="Visible dans le sélecteur d'envoi — la clé technique est générée automatiquement">
        <input
          type="text"
          value={form.label}
          onChange={(e) => update({ label: e.target.value })}
          className={inputClass}
          placeholder="Ex : Newsletter Avril 2026, Promo climatisation, Reprise Econhome…"
        />
      </Field>

      {/* Section Contexte */}
      <Section title="Contexte">
        <Field label="Objectif" required hint="Pourquoi cette campagne existe">
          <textarea
            value={form.purpose}
            onChange={(e) => update({ purpose: e.target.value })}
            rows={2}
            className={inputClass}
            placeholder="Ex : Rassurer les clients contrat actif sur la continuité de service…"
          />
        </Field>

        <Field label="Cible souhaitée" required hint="Profil narratif pour l'IA — le ciblage technique est défini par le segment ci-dessous">
          <textarea
            value={form.audience}
            onChange={(e) => update({ audience: e.target.value })}
            rows={2}
            className={inputClass}
            placeholder="Ex : Clients avec contrat d'entretien actif, historiquement sous Econhome."
          />
        </Field>

        <Field label="Notes internes" hint="Contexte supplémentaire envoyé à l'IA (historique, pièges, ton à éviter…)">
          <textarea
            value={form.notes}
            onChange={(e) => update({ notes: e.target.value })}
            rows={2}
            className={inputClass}
            placeholder="Ex : Ne pas citer les techniciens s'ils ne sont pas encore à bord."
          />
        </Field>
      </Section>

      {/* Section Ton */}
      <Section title="Ton éditorial">
        <SelectWithCustom
          value={form.tone}
          onChange={(v) => update({ tone: v })}
          options={TONE_OPTIONS}
          placeholder="Décris le ton en quelques mots…"
        />
      </Section>

      {/* Section Automatisation */}
      <Section title="Automatisation">
        <p className="text-xs text-secondary-500 -mt-1">
          Active pour laisser le scheduler N8n envoyer cette campagne automatiquement à cadence régulière. Sinon, envoi manuel depuis l'onglet "Envoi".
        </p>
        <label className="flex items-center gap-2 text-sm text-secondary-700">
          <input
            type="checkbox"
            checked={!!form.is_automated}
            onChange={(e) => update({ is_automated: e.target.checked })}
            className="rounded border-gray-300"
          />
          <Zap className="w-4 h-4 text-amber-500" />
          Activer l'envoi automatique
        </label>

        <Field label={form.is_automated ? 'Segment ciblé (obligatoire en auto)' : 'Segment par défaut (utilisé à l\'ouverture de l\'onglet Envoi)'} hint="Choisis un segment du catalogue">
          <select
            value={form.auto_segment_id || ''}
            onChange={(e) => update({ auto_segment_id: e.target.value || null })}
            className={inputClass}
          >
            <option value="">— Aucun —</option>
            {clientSegments.length > 0 && (
              <optgroup label="Clients">
                {clientSegments.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            )}
            {leadSegments.length > 0 && (
              <optgroup label="Leads">
                {leadSegments.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        {form.is_automated && (
          <div className="space-y-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Cadence (jours)" hint="Ex: 7 = une fois par semaine">
                <input
                  type="number"
                  min={1}
                  value={form.auto_cadence_days || ''}
                  onChange={(e) => update({
                    auto_cadence_days: e.target.value,
                    auto_cadence_minutes: e.target.value ? null : form.auto_cadence_minutes,
                  })}
                  className={inputClass}
                  placeholder="7"
                />
              </Field>
              <Field label="Heure d'envoi">
                <input
                  type="time"
                  value={form.auto_time_of_day || '09:00'}
                  onChange={(e) => update({ auto_time_of_day: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
            <details className="text-xs text-secondary-600">
              <summary className="cursor-pointer font-medium">Cadence sub-jour (avancé)</summary>
              <div className="mt-2">
                <Field label="Cadence (minutes)" hint="Surcharge la cadence en jours. Ex: 10 = toutes les 10 minutes (pour lead_bienvenue).">
                  <input
                    type="number"
                    min={1}
                    value={form.auto_cadence_minutes || ''}
                    onChange={(e) => update({
                      auto_cadence_minutes: e.target.value,
                      auto_cadence_days: e.target.value ? null : form.auto_cadence_days,
                    })}
                    className={inputClass}
                    placeholder="Ex: 10"
                  />
                </Field>
              </div>
            </details>
            <p className="text-xs text-amber-800">
              <Filter className="w-3 h-3 inline mr-1" />
              Le scheduler N8n lit les campagnes dont <code className="text-[10px]">next_run_at ≤ NOW()</code> toutes les 10 min et déclenche l'envoi.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, required, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-primary-700 uppercase tracking-wide border-b border-primary-200 pb-1.5">
        {title}
        {required && <span className="text-red-500 ml-1">*</span>}
      </h3>
      {children}
    </div>
  );
}

// =============================================================================
// STEP 2 — Brief (ligne éditoriale + objet/preheader facultatifs)
// =============================================================================

function StepBrief({ form, update }) {
  return (
    <div className="space-y-4">
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 text-sm text-primary-900">
        Décris en langage naturel ce que tu veux dire dans ce mail.
        L'IA structurera toute seule en blocs pertinents
        (offre, news, conseil, contact) selon ce qui fait sens.
      </div>

      <Field label="Ligne éditoriale" required hint="Message, angle, contenus à intégrer — sois libre, l'IA s'occupe de la mise en forme">
        <textarea
          value={form.brief}
          onChange={(e) => update({ brief: e.target.value })}
          rows={10}
          className={inputClass}
          placeholder={`Ex : Ce mois-ci on pousse la pompe à chaleur — le plan gouv pour 1M de PAC + les aides MaPrimeRénov' (jusqu'à 70%). Rappeler aussi l'entretien annuel (obligation légale, tarif inchangé). Présenter Antoine, nouveau technicien arrivé en mars. Conseil saisonnier : préparer sa clim pour l'été (nettoyage filtres).`}
        />
      </Field>

      <div className="pt-2 border-t">
        <p className="text-xs font-medium text-secondary-500 uppercase tracking-wide mb-2">Facultatif — l'IA propose sinon</p>
        <div className="space-y-3">
          <Field label="Objet du mail" hint="Si vide, l'IA proposera un objet dans le HTML généré">
            <input
              type="text"
              value={form.subject}
              onChange={(e) => update({ subject: e.target.value })}
              className={inputClass}
              placeholder="Ex : Vos nouveautés Mayer Énergie de mai"
            />
          </Field>
          <Field label="Preheader" hint="Texte de preview affiché dans l'inbox (~100 caractères)">
            <input
              type="text"
              value={form.preheader}
              onChange={(e) => update({ preheader: e.target.value })}
              maxLength={150}
              className={inputClass}
              placeholder="Ex : L'offre du mois, une nouveauté et un conseil pour votre confort"
            />
            <div className="text-xs text-secondary-500 mt-1">{form.preheader.length}/150 caractères</div>
          </Field>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// STEP 3 — Génération
// =============================================================================

function StepGenerate({ form, update, promptText, jsonText, copyToClipboard }) {
  const [showPreview, setShowPreview] = useState(false);
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!showPreview || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write((form.html_body || '').replace(/\{\{SALUTATION\}\}/g, 'Bonjour Jean Dupont,'));
    doc.close();
  }, [showPreview, form.html_body]);

  // Auto-extraction OBJET / PREHEADER depuis les commentaires HTML collés
  const handleHtmlChange = (newHtml) => {
    const patch = { html_body: newHtml };
    if (!form.subject?.trim()) {
      const m = newHtml.match(/(?:OBJET|SUBJECT)\s*[:：]\s*(.+?)(?=\r?\n|-->)/i);
      if (m && m[1].trim()) patch.subject = m[1].trim();
    }
    if (!form.preheader?.trim()) {
      const m = newHtml.match(/PREHEADER\s*[:：]\s*(.+?)(?=\r?\n|-->)/i);
      if (m && m[1].trim()) patch.preheader = m[1].trim();
    }
    update(patch);
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
        <p className="font-medium">Workflow V1 (copier-coller)</p>
        <ol className="list-decimal ml-5 mt-1 space-y-0.5 text-xs">
          <li>Copie le <strong>prompt</strong> ci-dessous</li>
          <li>Colle-le dans une conversation Claude, demande la génération du HTML</li>
          <li>Colle le HTML reçu dans la zone « HTML final » en bas</li>
          <li>Clique <strong>Sauvegarder</strong> → la campagne apparaît dans la liste</li>
        </ol>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-secondary-700">Prompt Claude</label>
          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(promptText, 'Prompt')}>
            <Copy className="w-3.5 h-3.5 mr-1" />
            Copier
          </Button>
        </div>
        <pre className="bg-gray-50 border rounded-lg p-3 text-xs font-mono max-h-64 overflow-auto whitespace-pre-wrap">{promptText}</pre>
      </div>

      <details className="group">
        <summary className="text-sm font-medium text-secondary-700 cursor-pointer">
          JSON structuré (context brut)
        </summary>
        <div className="mt-2">
          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(jsonText, 'JSON')}>
            <Copy className="w-3.5 h-3.5 mr-1" />
            Copier JSON
          </Button>
          <pre className="mt-2 bg-gray-900 text-green-400 rounded-lg p-3 text-xs font-mono max-h-48 overflow-auto">{jsonText}</pre>
        </div>
      </details>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-secondary-700">
            HTML final <span className="text-red-500">*</span>
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(true)}
            disabled={!form.html_body?.trim()}
          >
            <Eye className="w-3.5 h-3.5 mr-1" />
            Prévisualiser
          </Button>
        </div>
        <p className="text-xs text-secondary-500 mb-1">Colle ici le HTML complet renvoyé par Claude. L'objet et le preheader seront extraits automatiquement du commentaire en tête.</p>
        <textarea
          value={form.html_body}
          onChange={(e) => handleHtmlChange(e.target.value)}
          rows={10}
          className={`${inputClass} font-mono text-xs`}
          placeholder="<!DOCTYPE html>..."
        />
        <div className="text-xs text-secondary-500 mt-1">{form.html_body.length} caractères</div>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b bg-gray-50">
              <h3 className="font-semibold text-secondary-900 flex items-center gap-2">
                <Eye className="w-4 h-4 text-primary-600" />
                Prévisualisation du mail
              </h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-gray-200 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <iframe
              ref={iframeRef}
              title="Preview HTML"
              className="flex-1 w-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';

function Row({ children }) {
  return <div className="grid sm:grid-cols-2 gap-4">{children}</div>;
}

function SelectWithCustom({ value, onChange, options, placeholder }) {
  const isPreset = options.includes(value);
  const [showCustom, setShowCustom] = useState(!isPreset && !!value);

  const handleSelect = (e) => {
    const v = e.target.value;
    if (v === '__custom') {
      setShowCustom(true);
      onChange('');
    } else {
      setShowCustom(false);
      onChange(v);
    }
  };

  return (
    <>
      <select
        value={isPreset ? value : showCustom ? '__custom' : ''}
        onChange={handleSelect}
        className={inputClass}
      >
        <option value="">— Choisir —</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value="__custom">Autre (préciser)…</option>
      </select>
      {showCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} mt-2`}
          placeholder={placeholder}
          autoFocus
        />
      )}
    </>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-secondary-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && <div className="text-xs text-secondary-500 mt-1">{hint}</div>}
    </div>
  );
}

function buildInitialForm(initial) {
  return {
    key: initial?.key || '',
    label: initial?.label || '',
    subject: initial?.subject || '',
    preheader: initial?.preheader || '',
    html_body: initial?.html_body || '',
    tracking_type_value: initial?.tracking_type_value || 'newsletter',
    purpose: initial?.purpose || '',
    audience: initial?.audience || '',
    tone: initial?.tone || '',
    trigger_description: initial?.trigger_description || '',
    notes: initial?.notes || '',
    brief: initial?.blocks?.brief || '',
    // Automatisation
    is_automated: !!initial?.is_automated,
    auto_segment_id: initial?.auto_segment_id || null,
    auto_cadence_days: initial?.auto_cadence_days || '',
    auto_cadence_minutes: initial?.auto_cadence_minutes || '',
    auto_time_of_day: initial?.auto_time_of_day || '09:00',
  };
}

function validateStep(step, form) {
  if (step === 1) {
    // Clé auto-générée au save → pas besoin de la valider ici
    if (!form.label || !form.purpose || !form.audience) return false;
    // Si campagne automatique, le segment est obligatoire
    if (form.is_automated && !form.auto_segment_id) return false;
    if (form.is_automated && !form.auto_cadence_days && !form.auto_cadence_minutes) return false;
    return true;
  }
  if (step === 2) {
    return !!form.brief?.trim();
  }
  return true;
}

function buildJsonPayload(form) {
  return { brief: form.brief };
}

function buildPrompt(form) {
  const campaignKey = form.key || slugifyKey(form.label);
  const lines = [];
  lines.push(`Tu es un générateur d'emails HTML pour Mayer Énergie.`);
  lines.push(`Génère un email HTML complet (de <!DOCTYPE html> à </html>) suivant le template "Mail I — Base réutilisable" de Mayer Énergie.`);
  lines.push('');
  lines.push('## Carte d\'identité de la campagne');
  lines.push(`- Clé technique : ${campaignKey}`);
  lines.push(`- Libellé : ${form.label}`);
  lines.push(`- Objectif : ${form.purpose}`);
  lines.push(`- Cible : ${form.audience}`);
  if (form.tone) lines.push(`- Ton éditorial : ${form.tone}`);
  if (form.trigger_description) lines.push(`- Déclencheur / cadence : ${form.trigger_description}`);
  if (form.notes) lines.push(`- Notes internes : ${form.notes}`);
  lines.push('');
  lines.push('## Ligne éditoriale (brief de l\'utilisateur)');
  lines.push('');
  lines.push(form.brief.trim());
  lines.push('');
  lines.push('## Ta mission');
  lines.push('');
  lines.push('1. **Décide toi-même** quels blocs structurer parmi les 4 types disponibles, selon ce que dit le brief.');
  lines.push(`   Tu peux en inclure de 1 à 4, dans l'ordre qui fait sens. Si le brief ne couvre pas un type, ne l'inclus pas.`);
  lines.push('2. **Rédige les contenus** (titres, descriptions, puces, CTA) à partir du brief — il est ton seul input contenu, interprète-le.');
  lines.push('3. **Garde un ton cohérent** avec la carte d\'identité ci-dessus (ton éditorial + objectif + cible).');
  lines.push(`4. **Objet du mail** : ${form.subject ? `utilise exactement « ${form.subject} »` : 'propose-en un qui colle au brief (max 70 caractères)'}.`);
  lines.push(`5. **Preheader** : ${form.preheader ? `utilise exactement « ${form.preheader} »` : 'propose-en un (max 100 caractères) qui complète l\'objet sans le répéter'}.`);
  lines.push('6. **Intro** (après {{SALUTATION}}) : 1-2 phrases qui posent le sujet du mail.');
  lines.push('');
  lines.push(formatResourcesForPrompt().replace(/\{CAMPAIGN_KEY\}/g, campaignKey));
  lines.push('');
  lines.push('## Types de blocs disponibles');
  lines.push('');
  lines.push('- **Offre du mois** : carte orange #fff7ed (bordure #fed7aa). Titre avec 🎁, description, CTA bouton orange #ea580c. À utiliser quand le brief parle d\'une offre commerciale, promo, remise, partenariat tarifaire.');
  lines.push('- **News / Nouveauté** : carte grise #f8f9fa (bordure #e9ecef). Titre avec 🆕, description, lien optionnel. À utiliser pour annonce (nouveau service, recrutement, partenariat, événement).');
  lines.push('- **Conseil** : liseré bleu 4px #1E4D8C à gauche. Titre avec 💡, intro contexte, 2-4 points à puces, conclusion. À utiliser pour conseil pratique, info réglementaire, astuce saisonnière.');
  lines.push(`- **CTA contact** : carte bleue #eff6ff (bordure #bfdbfe). Titre "🏠 Un projet en cours ?", accroche, bouton bleu #1E4D8C "👉 Je contacte Mayer Énergie" → \`https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=${campaignKey}&utm_medium=email\` + téléphone 05 63 33 23 14 sous le bouton. À utiliser presque systématiquement en dernier bloc pour inviter au contact.`);
  lines.push('');
  lines.push('## Contraintes techniques (obligatoires)');
  lines.push('- Inline CSS uniquement (compatibilité Gmail / Outlook)');
  lines.push('- Header identique à Mail I : logo Mayer centré (220px) + bande bleue #1E4D8C avec "Votre confort, toute l\'année"');
  lines.push('- Footer identique à Mail I : téléphone 05 63 33 23 14, email contact@mayer-energie.fr, site www.mayer-energie.fr, adresse 26 Route des Pyrénées – 81600 Gaillac, mention RGE QualiPAC · QualiBois · QualiPV, lien désabonnement');
  lines.push('- Largeur max 600px, fond #f4f4f4, carte blanche border-radius 8px');
  lines.push('- Police : Arial, sans-serif');
  lines.push('- Ne touche pas au placeholder {{SALUTATION}} (remplacé côté N8N par "Bonjour Prénom Nom,")');
  lines.push(`- UTM du bouton contact : utm_campaign=${campaignKey}`);
  lines.push('- Le preheader va dans un <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;"> juste après <body>');
  lines.push('');
  lines.push('Réponds uniquement avec le HTML complet, sans explication ni balises markdown.');

  return lines.join('\n');
}
