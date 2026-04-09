/**
 * useSmsLogs.js — Hook React Query pour les logs SMS
 * ============================================================================
 * Fournit l'historique des SMS envoyés par client.
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { smsKeys } from './cacheKeys';
import supabase from '@lib/supabaseClient';

/**
 * Récupère les SMS envoyés à un client
 */
export function useSmsLogsByClient(clientId) {
  return useQuery({
    queryKey: smsKeys.byClient(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('majordhome_sms_logs')
        .select('*')
        .eq('client_id', clientId)
        .order('sent_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });
}

// Re-export pour rétrocompatibilité
export { smsKeys };
