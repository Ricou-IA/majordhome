/**
 * TabSms.jsx — Onglet Messages (WhatsApp + SMS) sur la fiche client
 * ============================================================================
 * Affiche l'historique des messages envoyés au client.
 * Données depuis la vue majordhome_sms_logs.
 * ============================================================================
 */

import { MessageSquare, Clock, AlertCircle, Loader2, Phone, CheckCheck, MousePointerClick } from 'lucide-react';
import { useSmsLogsByClient } from '@hooks/useSmsLogs';
import { formatDateTimeFR } from '@/lib/utils';

// =============================================================================
// STATUS CONFIG
// =============================================================================

const STATUS_CONFIG = {
  pending: { label: 'En attente', color: 'bg-secondary-100 text-secondary-600' },
  sent: { label: 'Envoyé', color: 'bg-green-100 text-green-700' },
  delivered: { label: 'Délivré', color: 'bg-blue-100 text-blue-700' },
  read: { label: 'Lu', color: 'bg-purple-100 text-purple-700' },
  failed: { label: 'Échoué', color: 'bg-red-100 text-red-700' },
  undelivered: { label: 'Non délivré', color: 'bg-amber-100 text-amber-700' },
};

const CHANNEL_CONFIG = {
  whatsapp: { label: 'WhatsApp', color: 'bg-green-50 text-green-700 border border-green-200' },
  sms: { label: 'SMS', color: 'bg-sky-50 text-sky-700 border border-sky-200' },
};

// =============================================================================
// COMPOSANT
// =============================================================================

export function TabSms({ clientId }) {
  const { data: logs, isLoading, error } = useSmsLogsByClient(clientId);

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
        <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">Aucun message envoyé à ce client</p>
      </div>
    );
  }

  // Liste
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-secondary-700">
          Historique des messages ({logs.length})
        </h3>
      </div>

      {logs.map((log) => {
        const status = STATUS_CONFIG[log.status] || STATUS_CONFIG.sent;
        const channel = CHANNEL_CONFIG[log.channel] || CHANNEL_CONFIG.sms;
        return (
          <div key={log.id} className="card p-4 flex items-start gap-4">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
              log.channel === 'whatsapp' ? 'bg-green-100 text-green-600' : 'bg-teal-100 text-teal-600'
            }`}>
              <MessageSquare className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-secondary-900">
                  {log.campaign_name}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${channel.color}`}>
                  {channel.label}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                  {status.label}
                </span>
                {log.read_at && (
                  <span className="flex items-center gap-1 text-xs text-purple-600" title={`Lu le ${formatDateTimeFR(log.read_at)}`}>
                    <CheckCheck className="w-3.5 h-3.5" />
                  </span>
                )}
                {log.clicked_at && (
                  <span className="flex items-center gap-1 text-xs text-indigo-600" title={`Cliqué le ${formatDateTimeFR(log.clicked_at)}`}>
                    <MousePointerClick className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
              <p className="text-sm text-secondary-600 mt-1 line-clamp-2">
                {log.message}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-secondary-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTimeFR(log.sent_at)}
                </span>
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {log.phone_to}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TabSms;
