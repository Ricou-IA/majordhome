/**
 * SendStatus.jsx — État de la feuille de route d'une tournée.
 *
 * - envoi manuel en cours (pg_net asynchrone) : suivi toutes les 3 s jusqu'à la réponse du site ;
 * - envoi manuel en échec : code HTTP + erreur de CETTE tournée, en ambre (jamais avalé) ;
 * - sinon : « Envoyée le … » (cron de 17 h ou envoi manuel) ou « Pas encore envoyée ».
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useWebshopSendResult, webshopTourKeys } from '@hooks/useWebshopTournees';
import { formatDateTime } from './tourneesUi';

export default function SendStatus({ slot }) {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { data: result } = useWebshopSendResult(slot.id, { enabled: !!slot.route_sheet_request_id });

  // Réponse du site arrivée : relire les tournées (date d'envoi posée par le site).
  const previous = useRef(result?.state);
  useEffect(() => {
    if (previous.current === 'pending' && result?.state && result.state !== 'pending') {
      queryClient.invalidateQueries({ queryKey: webshopTourKeys.all(organization?.id) });
    }
    previous.current = result?.state;
  }, [result?.state, queryClient, organization?.id]);

  if (slot.status === 'cancelled') return null;

  if (result?.state === 'pending') {
    return (
      <p className="text-sm text-blue-700 flex items-center gap-1.5">
        <Loader2 className="w-4 h-4 animate-spin" /> Envoi au transporteur en cours…
      </p>
    );
  }
  if (result?.state === 'failed') {
    const detail = [
      result.status_code ? `HTTP ${result.status_code}` : null,
      result.timed_out ? 'délai dépassé' : null,
      ...(result.slot_errors || []),
      result.error,
    ].filter(Boolean).join(' · ');
    return (
      <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <p className="font-medium flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> L&apos;envoi du {formatDateTime(result.requested_at)} a échoué
        </p>
        {detail && <p className="mt-0.5 text-xs break-words">{detail}</p>}
      </div>
    );
  }
  if (slot.route_sheet_sent_at) {
    return (
      <p className="text-sm text-secondary-700 flex items-center gap-1.5">
        <CheckCircle2 className="w-4 h-4 text-blue-600" /> Feuille envoyée le {formatDateTime(slot.route_sheet_sent_at)}
      </p>
    );
  }
  return (
    <p className="text-sm text-secondary-500 flex items-center gap-1.5">
      <Clock className="w-4 h-4" /> Feuille pas encore envoyée
      {slot.status === 'open' ? ' — partira à la fermeture (J-2, cron de 17 h)' : ' — partira au cron de 17 h'}
    </p>
  );
}
