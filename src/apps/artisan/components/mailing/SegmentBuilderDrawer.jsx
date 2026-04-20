import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { X, Loader2, Users, Filter, History, Eye, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@components/ui/button';
import { useAuth } from '@contexts/AuthContext';
import { useMailSegments, useSegmentCount, useSegmentPreview } from '@hooks/useMailSegments';
import { useMailCampaigns } from '@hooks/useMailCampaigns';
import { useLeadStatuses, useLeadSources, useLeadCommercials } from '@hooks/useLeads';
import { useDebounce } from '@hooks/useDebounce';
import {
  AUDIENCES,
  CLIENT_BASE_KINDS,
  CONTRACT_STATUSES,
  HOUSING_TYPES,
  DPE_RATINGS,
  LEAD_SOURCES,
  ORDER_BY_OPTIONS,
  buildEmptyFilters,
  parseCsvList,
  arrayToCsv,
  updateFilters,
} from './segmentBuilder.constants';

/**
 * SegmentBuilderDrawer — builder à facettes (4 blocs) pour composer un segment
 * de ciblage mailing et le sauvegarder dans majordhome.mail_segments.
 */
export default function SegmentBuilderDrawer({ initial = null, onClose, onSaved }) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { createSegment, updateSegment, isMutating } = useMailSegments(orgId);

  // ------------------------------------------------------------------
  // État du formulaire
  // ------------------------------------------------------------------
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [filters, setFilters] = useState(() => initial?.filters || buildEmptyFilters('clients'));

  const audience = filters.audience || 'clients';

  const setAudience = useCallback((aud) => {
    setFilters(buildEmptyFilters(aud));
  }, []);

  const set = useCallback((path, value) => {
    setFilters((f) => updateFilters(f, path, value));
  }, []);

  // ------------------------------------------------------------------
  // Données de référence
  // ------------------------------------------------------------------
  const { statuses: leadStatuses } = useLeadStatuses();
  const { sources: leadSources } = useLeadSources();
  const { commercials: leadCommercials } = useLeadCommercials(orgId);
  const { campaigns } = useMailCampaigns(orgId);

  // ------------------------------------------------------------------
  // Compteur + preview (debounced)
  // ------------------------------------------------------------------
  const debouncedFilters = useDebounce(filters, 400);

  const { data: recipientCount, isLoading: countLoading } = useSegmentCount({
    filters: debouncedFilters,
    orgId,
    enabled: !!orgId,
  });

  const [showPreview, setShowPreview] = useState(false);
  const { data: previewRows, isLoading: previewLoading } = useSegmentPreview({
    filters: debouncedFilters,
    orgId,
    limit: 20,
    enabled: !!orgId && showPreview,
  });

  // ------------------------------------------------------------------
  // Sauvegarde
  // ------------------------------------------------------------------
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Donne un nom au segment');
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      audience,
      filters,
    };
    try {
      if (initial?.id) {
        await updateSegment({ id: initial.id, patch: payload });
      } else {
        await createSegment(payload);
      }
      onSaved?.();
      onClose();
    } catch {
      // toast déjà affiché par le hook
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-end">
      <div className="bg-white shadow-xl w-full max-w-3xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-primary-50 to-white">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-secondary-900 flex items-center gap-2">
              <Filter className="w-5 h-5 text-primary-600" />
              {initial ? 'Éditer le segment' : 'Nouveau segment'}
            </h2>
            <p className="text-xs text-secondary-500 mt-1">
              Builder de ciblage — le segment sera enregistré dans le catalogue et réutilisable en envoi manuel ou campagne automatique.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Identité du segment */}
          <Section title="Identité" icon={<Users className="w-4 h-4" />} defaultOpen>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">Nom du segment *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Clients DPE E/F chauffage gaz"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Note libre pour retrouver ce segment plus tard…"
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <RadioGroup
                label="Audience"
                options={AUDIENCES}
                value={audience}
                onChange={setAudience}
                disabled={!!initial?.is_preset}
              />
            </div>
          </Section>

          {/* BLOC 1 — Population */}
          <Section title="1. Population" icon={<Users className="w-4 h-4" />} defaultOpen>
            {audience === 'clients' ? (
              <ClientsBaseFields filters={filters} set={set} />
            ) : (
              <LeadsBaseFields filters={filters} set={set} leadStatuses={leadStatuses} />
            )}
          </Section>

          {/* BLOC 2 — Attributs */}
          <Section title="2. Attributs (filtres additionnels, tous optionnels)" icon={<Filter className="w-4 h-4" />}>
            <AttributesFields
              filters={filters}
              set={set}
              audience={audience}
              leadSources={leadSources}
              leadCommercials={leadCommercials}
            />
          </Section>

          {/* BLOC 3 — Historique mailing */}
          <Section title="3. Historique mailing" icon={<History className="w-4 h-4" />}>
            <MailingHistoryFields filters={filters} set={set} campaigns={campaigns} />
          </Section>

          {/* BLOC 4 — Preview + tri/limite */}
          <Section title="4. Preview" icon={<Eye className="w-4 h-4" />} defaultOpen>
            <PreviewFields
              filters={filters}
              set={set}
              count={recipientCount}
              countLoading={countLoading}
              previewRows={previewRows || []}
              previewLoading={previewLoading}
              showPreview={showPreview}
              setShowPreview={setShowPreview}
            />
          </Section>
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t bg-gray-50 flex items-center justify-between gap-3">
          <div className="text-sm text-secondary-600">
            {countLoading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-4 h-4 animate-spin" />
                Calcul…
              </span>
            ) : recipientCount !== undefined && recipientCount !== null ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 font-semibold">
                {recipientCount} destinataire{recipientCount > 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isMutating}>Annuler</Button>
            <Button onClick={handleSave} disabled={isMutating || !name.trim()}>
              {isMutating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {initial ? 'Enregistrer' : 'Créer le segment'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Section({ title, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-secondary-800">
          {icon}
          {title}
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-secondary-400" /> : <ChevronRight className="w-4 h-4 text-secondary-400" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

function RadioGroup({ label, options, value, onChange, disabled = false }) {
  return (
    <div>
      <label className="block text-sm font-medium text-secondary-700 mb-1">{label}</label>
      <div className="flex gap-3">
        {options.map((opt) => (
          <label key={opt.value} className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg cursor-pointer text-sm ${value === opt.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-300 hover:bg-gray-50'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <input
              type="radio"
              checked={value === opt.value}
              onChange={() => !disabled && onChange(opt.value)}
              className="sr-only"
              disabled={disabled}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function CheckboxList({ label, options, values, onChange }) {
  const toggle = (v) => {
    const set = new Set(values || []);
    if (set.has(v)) set.delete(v); else set.add(v);
    onChange(Array.from(set));
  };
  return (
    <div>
      {label && <label className="block text-sm font-medium text-secondary-700 mb-1">{label}</label>}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const l = typeof opt === 'string' ? opt : opt.label;
          const checked = (values || []).includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${checked ? 'bg-primary-100 border-primary-400 text-primary-700' : 'bg-white border-gray-300 text-secondary-700 hover:bg-gray-50'}`}
            >
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-secondary-600 mb-1">{label}</label>}
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
      />
    </div>
  );
}

function TextInputRow({ label, value, onChange, placeholder }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-secondary-600 mb-1">{label}</label>}
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// BLOC 1 — Population
// ----------------------------------------------------------------------------
function ClientsBaseFields({ filters, set }) {
  const base = filters.base || {};
  return (
    <div className="space-y-3">
      <RadioGroup
        label="Population"
        options={CLIENT_BASE_KINDS}
        value={base.kind || 'all'}
        onChange={(v) => {
          // reset contract_statuses if changing kind
          if (v === 'has_contract') {
            set(['base'], { kind: 'has_contract', contract_statuses: base.contract_statuses || ['active'] });
          } else {
            set(['base'], { kind: v });
          }
        }}
      />
      {base.kind === 'has_contract' && (
        <>
          <CheckboxList
            label="Statuts de contrat"
            options={CONTRACT_STATUSES}
            values={base.contract_statuses || []}
            onChange={(v) => set(['base', 'contract_statuses'], v)}
          />
          <label className="flex items-center gap-2 text-sm text-secondary-700">
            <input
              type="checkbox"
              checked={!!base.exclude_with_active}
              onChange={(e) => set(['base', 'exclude_with_active'], e.target.checked || null)}
              className="rounded border-gray-300"
            />
            Exclure les clients ayant aussi un contrat actif
          </label>
        </>
      )}
    </div>
  );
}

function LeadsBaseFields({ filters, set, leadStatuses }) {
  const base = filters.base || {};
  const statusIds = base.status_ids || [];
  const selectedStatuses = leadStatuses.filter((s) => statusIds.includes(s.id));
  const hasDevis = selectedStatuses.some((s) => s.label === 'Devis envoyé');
  const hasRdv = selectedStatuses.some((s) => s.label === 'RDV planifié');
  return (
    <div className="space-y-3">
      <CheckboxList
        label="Statuts leads"
        options={leadStatuses.map((s) => ({ value: s.id, label: s.label }))}
        values={statusIds}
        onChange={(v) => set(['base', 'status_ids'], v)}
      />
      <div>
        <p className="text-xs text-secondary-500 mb-1">
          Depuis combien de jours le lead est-il <em>actuellement</em> à ce statut (reset à chaque changement de statut)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Depuis au moins (jours)"
            value={base.days_in_status_min}
            onChange={(v) => set(['base', 'days_in_status_min'], v)}
            placeholder="Ex: 7"
          />
          <NumberInput
            label="Depuis au plus (jours)"
            value={base.days_in_status_max}
            onChange={(v) => set(['base', 'days_in_status_max'], v)}
            placeholder="Ex: 14"
          />
        </div>
      </div>
      {hasDevis && (
        <div>
          <p className="text-xs text-secondary-500 mb-1">Filtre basé sur la date d'envoi du devis (colonne dédiée)</p>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
              label="Devis envoyé il y a au moins (jours)"
              value={base.days_since_quote_min}
              onChange={(v) => set(['base', 'days_since_quote_min'], v)}
            />
            <NumberInput
              label="Devis envoyé il y a au plus (jours)"
              value={base.days_since_quote_max}
              onChange={(v) => set(['base', 'days_since_quote_max'], v)}
            />
          </div>
        </div>
      )}
      {hasRdv && (
        <div>
          <p className="text-xs text-secondary-500 mb-1">Filtre basé sur la date du RDV</p>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
              label="RDV il y a au moins (jours)"
              value={base.days_since_appointment_min}
              onChange={(v) => set(['base', 'days_since_appointment_min'], v)}
            />
            <NumberInput
              label="RDV il y a au plus (jours)"
              value={base.days_since_appointment_max}
              onChange={(v) => set(['base', 'days_since_appointment_max'], v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// BLOC 2 — Attributes
// ----------------------------------------------------------------------------
function AttributesFields({ filters, set, audience, leadSources, leadCommercials }) {
  const a = filters.attributes || {};
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <TextInputRow
          label="Villes (séparées par virgule)"
          value={arrayToCsv(a.cities)}
          onChange={(v) => set(['attributes', 'cities'], parseCsvList(v))}
          placeholder="Gaillac, Albi, Castres"
        />
        <TextInputRow
          label="Codes postaux (séparés par virgule)"
          value={arrayToCsv(a.postal_codes)}
          onChange={(v) => set(['attributes', 'postal_codes'], parseCsvList(v))}
          placeholder="81000, 81100"
        />
      </div>
      {audience === 'leads' && (
        <TextInputRow
          label="Zones (séparées par virgule)"
          value={arrayToCsv(a.zones)}
          onChange={(v) => set(['attributes', 'zones'], parseCsvList(v))}
          placeholder="zone_1, zone_2"
        />
      )}
      {audience === 'clients' && (
        <>
          <CheckboxList
            label="Types de logement"
            options={HOUSING_TYPES}
            values={a.housing_types || []}
            onChange={(v) => set(['attributes', 'housing_types'], v)}
          />
          <CheckboxList
            label="Classe DPE"
            options={DPE_RATINGS}
            values={a.dpe_ratings || []}
            onChange={(v) => set(['attributes', 'dpe_ratings'], v)}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <NumberInput label="Surface min (m²)" value={a.surface_min} onChange={(v) => set(['attributes', 'surface_min'], v)} />
            <NumberInput label="Année de construction ≤" value={a.construction_year_max} onChange={(v) => set(['attributes', 'construction_year_max'], v)} />
          </div>
          <CheckboxList
            label="Source de lead"
            options={LEAD_SOURCES}
            values={a.lead_sources || []}
            onChange={(v) => set(['attributes', 'lead_sources'], v)}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <TextInputRow
              label="Tags — au moins un"
              value={arrayToCsv(a.tags_any)}
              onChange={(v) => set(['attributes', 'tags_any'], parseCsvList(v))}
              placeholder="vip, senior"
            />
            <TextInputRow
              label="Tags — tous requis"
              value={arrayToCsv(a.tags_all)}
              onChange={(v) => set(['attributes', 'tags_all'], parseCsvList(v))}
              placeholder="a_relancer"
            />
          </div>
        </>
      )}
      {audience === 'leads' && (
        <>
          {leadSources?.length > 0 && (
            <CheckboxList
              label="Source (leads)"
              options={leadSources.map((s) => ({ value: s.id, label: s.label || s.name || s.id }))}
              values={a.source_ids || []}
              onChange={(v) => set(['attributes', 'source_ids'], v)}
            />
          )}
          <div className="grid sm:grid-cols-3 gap-3">
            <TextInputRow
              label="Meta campaign_id"
              value={arrayToCsv(a.meta_campaign_ids)}
              onChange={(v) => set(['attributes', 'meta_campaign_ids'], parseCsvList(v))}
            />
            <TextInputRow
              label="Meta adset_id"
              value={arrayToCsv(a.meta_adset_ids)}
              onChange={(v) => set(['attributes', 'meta_adset_ids'], parseCsvList(v))}
            />
            <TextInputRow
              label="Meta ad_id"
              value={arrayToCsv(a.meta_ad_ids)}
              onChange={(v) => set(['attributes', 'meta_ad_ids'], parseCsvList(v))}
            />
          </div>
          {leadCommercials?.length > 0 && (
            <CheckboxList
              label="Commercial assigné"
              options={leadCommercials.map((c) => ({ value: c.id, label: c.full_name || c.email || c.id }))}
              values={a.assigned_user_ids || []}
              onChange={(v) => set(['attributes', 'assigned_user_ids'], v)}
            />
          )}
          <NumberInput
            label="Revenue estimé minimum (€)"
            value={a.estimated_revenue_min}
            onChange={(v) => set(['attributes', 'estimated_revenue_min'], v)}
          />
        </>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">Créé depuis</label>
          <input
            type="date"
            value={a.created_between?.from || ''}
            onChange={(e) => set(['attributes', 'created_between', 'from'], e.target.value || null)}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">Créé jusqu'au</label>
          <input
            type="date"
            value={a.created_between?.to || ''}
            onChange={(e) => set(['attributes', 'created_between', 'to'], e.target.value || null)}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// BLOC 3 — Mailing history
// ----------------------------------------------------------------------------
function MailingHistoryFields({ filters, set, campaigns }) {
  const h = filters.mailing_history || {};
  const campaignOptions = useMemo(
    () => (campaigns || []).map((c) => ({ value: c.label, label: c.label })),
    [campaigns]
  );
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-secondary-700">
        <input
          type="checkbox"
          checked={h.exclude_current_campaign !== false}
          onChange={(e) => set(['mailing_history', 'exclude_current_campaign'], e.target.checked)}
          className="rounded border-gray-300"
        />
        Exclure les destinataires ayant déjà reçu la <strong>campagne courante</strong>
      </label>
      <CheckboxList
        label="Exclure ceux ayant reçu une de ces campagnes"
        options={campaignOptions}
        values={h.exclude_campaigns || []}
        onChange={(v) => set(['mailing_history', 'exclude_campaigns'], v)}
      />
      {(h.exclude_campaigns?.length || 0) > 0 && (
        <NumberInput
          label="…dans les N derniers jours (optionnel, sinon exclusion totale)"
          value={h.exclude_within_days}
          onChange={(v) => set(['mailing_history', 'exclude_within_days'], v)}
          placeholder="Ex: 30"
        />
      )}
      <NumberInput
        label="Cooldown toute campagne confondue (N jours sans aucun mail)"
        value={h.cooldown_any_campaign_days}
        onChange={(v) => set(['mailing_history', 'cooldown_any_campaign_days'], v)}
      />
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">A ouvert la campagne</label>
          <select
            value={h.include_opened_campaign || ''}
            onChange={(e) => set(['mailing_history', 'include_opened_campaign'], e.target.value || null)}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">—</option>
            {campaignOptions.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">A cliqué sur la campagne</label>
          <select
            value={h.include_clicked_campaign || ''}
            onChange={(e) => set(['mailing_history', 'include_clicked_campaign'], e.target.value || null)}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">—</option>
            {campaignOptions.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// BLOC 4 — Preview
// ----------------------------------------------------------------------------
function PreviewFields({ filters, set, count, countLoading, previewRows, previewLoading, showPreview, setShowPreview }) {
  const limits = filters.limits || {};
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">Trier par</label>
          <select
            value={limits.order_by || 'recency_desc'}
            onChange={(e) => set(['limits', 'order_by'], e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          >
            {ORDER_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <NumberInput
          label="Limite destinataires (vide = tous)"
          value={limits.max}
          onChange={(v) => set(['limits', 'max'], v)}
          placeholder="Ex: 500"
        />
      </div>

      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-sm text-secondary-700">
          {countLoading ? (
            <span className="inline-flex items-center gap-1"><Loader2 className="w-4 h-4 animate-spin" /> Calcul…</span>
          ) : (
            <span>
              <strong>{count ?? '—'}</strong> destinataire{(count ?? 0) > 1 ? 's' : ''} correspondant
            </span>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowPreview(!showPreview)}>
          <Eye className="w-4 h-4 mr-1" />
          {showPreview ? 'Masquer' : 'Aperçu'}
        </Button>
      </div>

      {showPreview && (
        <div className="border rounded-lg overflow-hidden">
          {previewLoading ? (
            <div className="p-4 text-center text-sm text-secondary-500">
              <Loader2 className="w-4 h-4 inline mr-2 animate-spin" /> Chargement preview…
            </div>
          ) : previewRows.length === 0 ? (
            <div className="p-4 text-center text-sm text-secondary-500">Aucun destinataire</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-secondary-600 uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Nom</th>
                  <th className="text-left px-3 py-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 20).map((r) => (
                  <tr key={r.recipient_id} className="border-t">
                    <td className="px-3 py-1.5">{r.display_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—'}</td>
                    <td className="px-3 py-1.5 text-secondary-600">{r.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
