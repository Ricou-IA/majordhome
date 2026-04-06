/**
 * TabMailings.jsx — Onglet Mailings sur la fiche client
 * ============================================================================
 * Affiche l'historique des emails envoyés au client via les campagnes mailing.
 * Données depuis la vue majordhome_mailing_logs.
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { Mail, Send, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { mailingKeys } from '@hooks/cacheKeys';
import { formatDateTimeFR } from '@/lib/utils';
import supabase from '@lib/supabaseClient';

// =============================================================================
// STATUS CONFIG
// =============================================================================

const STATUS_CONFIG = {
  sent: { label: 'Envoyé', color: 'bg-green-100 text-green-700' },
  delivered: { label: 'Délivré', color: 'bg-blue-100 text-blue-700' },
  opened: { label: 'Ouvert', color: 'bg-purple-100 text-purple-700' },
  clicked: { label: 'Cliqué', color: 'bg-indigo-100 text-indigo-700' },
  bounced: { label: 'Rebondi', color: 'bg-red-100 text-red-700' },
  failed: { label: 'Échoué', color: 'bg-red-100 text-red-700' },
};

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
  });

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

  // Vide
  if (!logs || logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-secondary-400">
        <Mail className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">Aucun email envoyé à ce client</p>
      </div>
    );
  }

  // Liste
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-secondary-700">
          Historique des emails ({logs.length})
        </h3>
      </div>

      {logs.map((log) => {
        const status = STATUS_CONFIG[log.status] || STATUS_CONFIG.sent;
        return (
          <div key={log.id} className="card p-4 flex items-start gap-4">
            <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
              <Send className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-secondary-900 truncate">
                  {log.subject}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                  {status.label}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-secondary-500">
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TabMailings;
