/**
 * CampaignRecipientsDrawer.jsx — Drill-down des stats mailing
 * ============================================================================
 * Drawer latéral listant QUI a ouvert / cliqué / bouncé / s'est désabonné pour
 * une campagne donnée. Ouvert depuis les cellules cliquables de StatsTab.
 *
 * Source : vue public.majordhome_mail_campaign_recipients (1 ligne/destinataire).
 * Les filtres (par `mode`) reproduisent EXACTEMENT le décompte affiché dans la
 * cellule → la longueur de la liste == le chiffre de la colonne.
 * ============================================================================
 */

import { Link } from 'react-router-dom';
import {
  X,
  Eye,
  MousePointerClick,
  XCircle,
  BellOff,
  Loader2,
  Mail,
  ExternalLink,
} from 'lucide-react';
import { formatDateTimeFR } from '@/lib/utils';
import { useMailCampaignRecipients } from '@hooks/useMailCampaignStats';

const MODE_CONFIG = {
  opened: {
    label: 'Ouvertures',
    icon: Eye,
    timeField: 'opened_at',
    countField: 'open_count',
    empty: 'Aucune ouverture enregistrée.',
  },
  clicked: {
    label: 'Clics',
    icon: MousePointerClick,
    timeField: 'clicked_at',
    countField: 'click_count',
    empty: 'Aucun clic enregistré.',
  },
  bounced: {
    label: 'Rebonds (bounce)',
    icon: XCircle,
    timeField: 'bounced_at',
    countField: null,
    empty: 'Aucun rebond.',
  },
  unsubscribed: {
    label: 'Désabonnements',
    icon: BellOff,
    timeField: 'unsubscribed_at',
    countField: null,
    empty: 'Aucun désabonnement lié à cette campagne.',
  },
};

const TONE = {
  opened: { text: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-100', icon: 'bg-purple-100 text-purple-600' },
  clicked: { text: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-100', icon: 'bg-indigo-100 text-indigo-600' },
  bounced: { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-100', icon: 'bg-red-100 text-red-600' },
  unsubscribed: { text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-100', icon: 'bg-orange-100 text-orange-600' },
};

export function CampaignRecipientsDrawer({ orgId, campaignName, mode, isOpen, onClose }) {
  // Hook appelé inconditionnellement (règle des hooks) ; ne fetch qu'à l'ouverture.
  const { recipients, isLoading, error } = useMailCampaignRecipients(orgId, campaignName, mode, isOpen);

  if (!isOpen) return null;

  const cfg = MODE_CONFIG[mode] || MODE_CONFIG.opened;
  const tone = TONE[mode] || TONE.opened;
  const Icon = cfg.icon;

  return (
    <div className="fixed inset-0 z-40">
      {/* Overlay */}
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className={`sticky top-0 z-10 border-b ${tone.border} ${tone.bg} px-5 py-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={`inline-flex items-center gap-2 text-sm font-semibold ${tone.text}`}>
                <span className={`w-7 h-7 rounded-full flex items-center justify-center ${tone.icon}`}>
                  <Icon className="w-4 h-4" />
                </span>
                {cfg.label}
                {!isLoading && !error && (
                  <span className="text-secondary-400 font-normal">
                    · {recipients.length.toLocaleString('fr-FR')}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-secondary-500 truncate" title={campaignName}>
                {campaignName}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-secondary-400 hover:text-secondary-600 rounded-lg hover:bg-white/60 transition-colors shrink-0"
              aria-label="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-secondary-500">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Chargement…
            </div>
          ) : error ? (
            <div className="px-5 py-16 text-center text-sm text-red-600">
              Erreur de chargement : {error.message}
            </div>
          ) : recipients.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-secondary-400">{cfg.empty}</div>
          ) : (
            <div className="divide-y divide-secondary-100">
              {recipients.map((r) => (
                <RecipientRow key={r.id} r={r} cfg={cfg} tone={tone} onNavigate={onClose} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecipientRow({ r, cfg, tone, onNavigate }) {
  const time = r[cfg.timeField] || r.last_event_at;
  const count = cfg.countField ? r[cfg.countField] || 0 : 0;
  const displayName = r.recipient_name || r.email_to;
  const hasName = !!r.recipient_name;

  return (
    <div className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-secondary-50 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {r.client_id ? (
            <Link
              to={`/clients/${r.client_id}`}
              onClick={onNavigate}
              className="font-medium text-sm text-secondary-900 hover:text-primary-600 truncate inline-flex items-center gap-1"
              title="Ouvrir la fiche client"
            >
              {displayName}
              <ExternalLink className="w-3 h-3 opacity-50 shrink-0" />
            </Link>
          ) : (
            <span className="font-medium text-sm text-secondary-900 truncate">{displayName}</span>
          )}
          {!r.client_id && r.lead_id && (
            <span className="px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-500 text-[10px] font-semibold uppercase tracking-wide shrink-0">
              Lead
            </span>
          )}
        </div>
        {hasName && (
          <div className="text-xs text-secondary-500 truncate flex items-center gap-1 mt-0.5">
            <Mail className="w-3 h-3 shrink-0" />
            {r.email_to}
          </div>
        )}
        {r.client_number && (
          <div className="text-[11px] text-secondary-400 mt-0.5">N° {r.client_number}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        {time && (
          <div className="text-xs text-secondary-500 whitespace-nowrap">{formatDateTimeFR(time)}</div>
        )}
        {count > 1 && <div className={`text-xs font-semibold ${tone.text} mt-0.5`}>{count}×</div>}
      </div>
    </div>
  );
}

export default CampaignRecipientsDrawer;
