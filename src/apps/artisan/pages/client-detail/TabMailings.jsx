/**
 * TabMailings.jsx — Onglet Mailings sur la fiche client
 * ============================================================================
 * Affiche l'historique des emails envoyés au client via les campagnes mailing.
 * Données depuis la vue majordhome_mailing_logs.
 *
 * Tracking enrichi (webhook Resend) :
 * - Statuts : sent → delivered → opened → clicked (progression)
 *             bounced / complained / failed (terminaux négatifs)
 * - Timestamps : delivered_at, opened_at, clicked_at, bounced_at, complained_at
 * - Compteurs : open_count, click_count
 * - Erreurs : error_message
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import {
  Mail,
  Send,
  Clock,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Eye,
  MousePointerClick,
  XCircle,
  ShieldAlert,
  BellOff,
} from 'lucide-react';
import { mailingKeys } from '@hooks/cacheKeys';
import { formatDateTimeFR } from '@/lib/utils';
import supabase from '@lib/supabaseClient';

// =============================================================================
// UNSUBSCRIBE REASONS
// =============================================================================

const UNSUB_REASON_LABELS = {
  user_request: 'Lien dans le mail',
  list_unsubscribe_header: 'Bouton natif client mail (one-click)',
  spam_complaint: 'Signalé comme spam',
  manual: 'Désabonnement manuel (admin)',
};

// =============================================================================
// STATUS CONFIG
// =============================================================================

const STATUS_CONFIG = {
  sent: {
    label: 'Envoyé',
    color: 'bg-slate-100 text-slate-700 border border-slate-200',
    icon: Send,
  },
  delivered: {
    label: 'Délivré',
    color: 'bg-blue-100 text-blue-700 border border-blue-200',
    icon: CheckCircle2,
  },
  opened: {
    label: 'Ouvert',
    color: 'bg-purple-100 text-purple-700 border border-purple-200',
    icon: Eye,
  },
  clicked: {
    label: 'Cliqué',
    color: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
    icon: MousePointerClick,
  },
  bounced: {
    label: 'Rebondi',
    color: 'bg-red-100 text-red-700 border border-red-200',
    icon: XCircle,
  },
  complained: {
    label: 'Spam',
    color: 'bg-orange-100 text-orange-700 border border-orange-200',
    icon: ShieldAlert,
  },
  failed: {
    label: 'Échoué',
    color: 'bg-red-100 text-red-700 border border-red-200',
    icon: XCircle,
  },
};

// =============================================================================
// TIMELINE
// =============================================================================

/**
 * Construit une liste d'étapes chronologiques à partir des timestamps du log.
 * Les étapes sont triées par ordre d'apparition.
 */
function buildTimeline(log) {
  const steps = [];
  if (log.sent_at) {
    steps.push({ key: 'sent', label: 'Envoyé', at: log.sent_at, tone: 'slate' });
  }
  if (log.delivered_at) {
    steps.push({ key: 'delivered', label: 'Délivré', at: log.delivered_at, tone: 'blue' });
  }
  if (log.opened_at) {
    const count = log.open_count || 1;
    steps.push({
      key: 'opened',
      label: count > 1 ? `Ouvert (${count}×)` : 'Ouvert',
      at: log.opened_at,
      tone: 'purple',
    });
  }
  if (log.clicked_at) {
    const count = log.click_count || 1;
    steps.push({
      key: 'clicked',
      label: count > 1 ? `Cliqué (${count}×)` : 'Cliqué',
      at: log.clicked_at,
      tone: 'indigo',
    });
  }
  if (log.bounced_at) {
    steps.push({ key: 'bounced', label: 'Rebondi', at: log.bounced_at, tone: 'red' });
  }
  if (log.complained_at) {
    steps.push({ key: 'complained', label: 'Marqué spam', at: log.complained_at, tone: 'orange' });
  }
  return steps;
}

const TONE_DOT = {
  slate: 'bg-slate-400',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  indigo: 'bg-indigo-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
};

function Timeline({ steps }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-secondary-100">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {steps.map((step, idx) => (
          <div key={step.key + idx} className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${TONE_DOT[step.tone] || 'bg-slate-400'}`} />
            <span className="font-medium text-secondary-700">{step.label}</span>
            <span className="text-secondary-400">· {formatDateTimeFR(step.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// COMPOSANT
// =============================================================================

export function TabMailings({ clientId }) {
  const { data: logs, isLoading, error } = useQuery({
    queryKey: mailingKeys.byClient(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('majordhome_mailing_logs')
        .select('*')
        .eq('client_id', clientId)
        .order('sent_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
    // Refetch toutes les 30s pour suivre les events webhook en quasi-temps réel
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Statut de désabonnement du client (depuis la vue clients)
  const { data: clientInfo } = useQuery({
    queryKey: ['client-unsubscribe-status', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('email_unsubscribed_at, email_unsubscribe_reason')
        .eq('id', clientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  const isUnsubscribed = !!clientInfo?.email_unsubscribed_at;

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  // Erreur
  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-red-500">
        <AlertCircle className="w-5 h-5 mr-2" />
        Erreur : {error.message}
      </div>
    );
  }

  // Bandeau désabonnement (affiché avant tout, même si pas de logs)
  const unsubscribeBanner = isUnsubscribed ? (
    <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-4 flex items-start gap-3">
      <BellOff className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-orange-900">
          Client désabonné des campagnes mailing
        </p>
        <p className="text-xs text-orange-700 mt-1">
          Désabonné le{' '}
          <span className="font-medium">
            {formatDateTimeFR(clientInfo.email_unsubscribed_at)}
          </span>
          {clientInfo.email_unsubscribe_reason && (
            <>
              {' · '}
              Raison :{' '}
              <span className="font-medium">
                {UNSUB_REASON_LABELS[clientInfo.email_unsubscribe_reason] || clientInfo.email_unsubscribe_reason}
              </span>
            </>
          )}
        </p>
        <p className="text-xs text-orange-600 mt-1">
          Ce client n'apparaît plus dans les segments de campagne et ne recevra plus d'emails commerciaux.
          Les emails transactionnels (contrat, intervention) restent possibles.
        </p>
      </div>
    </div>
  ) : null;

  // Vide
  if (!logs || logs.length === 0) {
    return (
      <div>
        {unsubscribeBanner}
        <div className="flex flex-col items-center justify-center py-16 text-secondary-400">
          <Mail className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">Aucun email envoyé à ce client</p>
        </div>
      </div>
    );
  }

  // Stats rapides
  const totalOpened = logs.filter((l) => l.opened_at).length;
  const totalClicked = logs.filter((l) => l.clicked_at).length;
  const totalBounced = logs.filter((l) => l.bounced_at || l.status === 'failed').length;

  // Liste
  return (
    <div className="space-y-3">
      {unsubscribeBanner}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-medium text-secondary-700">
          Historique des emails ({logs.length})
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-purple-700">
            <Eye className="w-3.5 h-3.5" />
            {totalOpened} ouvert{totalOpened > 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1 text-indigo-700">
            <MousePointerClick className="w-3.5 h-3.5" />
            {totalClicked} cliqué{totalClicked > 1 ? 's' : ''}
          </span>
          {totalBounced > 0 && (
            <span className="flex items-center gap-1 text-red-700">
              <XCircle className="w-3.5 h-3.5" />
              {totalBounced} échec{totalBounced > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {logs.map((log) => {
        const status = STATUS_CONFIG[log.status] || STATUS_CONFIG.sent;
        const StatusIcon = status.icon;
        const steps = buildTimeline(log);
        const isFailure = log.status === 'bounced' || log.status === 'failed' || log.status === 'complained';

        return (
          <div
            key={log.id}
            className={`card p-4 ${isFailure ? 'border-l-4 border-l-red-400' : ''}`}
          >
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                <Send className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-secondary-900 truncate">
                    {log.subject}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                  >
                    <StatusIcon className="w-3 h-3" />
                    {status.label}
                  </span>
                </div>

                <div className="flex items-center gap-4 mt-1 text-xs text-secondary-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateTimeFR(log.sent_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {log.email_to}
                  </span>
                  {log.campaign_name && (
                    <span className="px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-600">
                      {log.campaign_name}
                    </span>
                  )}
                </div>

                {/* Error message */}
                {log.error_message && (
                  <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
                    <AlertCircle className="w-3 h-3 inline mr-1" />
                    {log.error_message}
                  </div>
                )}

                {/* Timeline des events */}
                <Timeline steps={steps} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TabMailings;
