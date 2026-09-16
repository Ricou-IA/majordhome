/**
 * pennylaneCustomerDuplicates.service.js — fiches customer Pennylane en double
 * ============================================================================
 * Projection écrite par l'edge `pennylane-sync-cron` (RPC service_role only,
 * remplacement d'un bloc à chaque passage horaire) : une fiche Pennylane qui
 * matche un client MDH DÉJÀ lié à une autre fiche. Lecture seule ici — la
 * résolution se fait dans Pennylane (fusion), la ligne disparaît au passage
 * suivant.
 *
 * ⚠️ orgId = org CORE (useAuth().organization.id).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const VIEW = 'majordhome_pennylane_customer_duplicates';

export const pennylaneCustomerDuplicatesService = {
  /**
   * Doublons de l'org, enrichis du client MDH concerné (nom, n° client) et du
   * nom de la fiche déjà liée quand le miroir customers la connaît. Deux
   * requêtes annexes mergées en mémoire : la vue reste un miroir simple.
   *
   * @param {string} orgId
   * @returns {Promise<{ data: Array<{
   *   pennylaneId: number, clientId: string, clientName: string|null, clientNumber: number|null,
   *   mappedPennylaneId: number, mappedName: string|null,
   *   plName: string|null, plEmail: string|null, plPhone: string|null,
   *   firstSeenAt: string, lastSeenAt: string
   * }>, error: Error|null }>}
   */
  async getAll(orgId) {
    return withErrorHandling(async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from(VIEW)
        .select('pennylane_id, client_id, mapped_pennylane_id, pl_name, pl_email, pl_phone, first_seen_at, last_seen_at')
        .eq('org_id', orgId)
        .order('first_seen_at', { ascending: true });
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) return [];

      const clientIds = [...new Set(rows.map((r) => r.client_id))];
      const mappedIds = [...new Set(rows.map((r) => r.mapped_pennylane_id))];

      const [clientsRes, lookupRes] = await Promise.all([
        supabase
          .from('majordhome_clients')
          .select('id, display_name, client_number')
          .eq('org_id', orgId)
          .in('id', clientIds),
        supabase
          .from('majordhome_pennylane_customer_lookup')
          .select('pennylane_id, name')
          .eq('org_id', orgId)
          .in('pennylane_id', mappedIds),
      ]);
      if (clientsRes.error) throw clientsRes.error;
      // Le miroir customers est partiel : un nom absent n'est pas une erreur.
      const clientById = new Map((clientsRes.data || []).map((c) => [c.id, c]));
      const mappedNameById = new Map((lookupRes.data || []).map((l) => [l.pennylane_id, l.name]));

      return rows.map((r) => {
        const client = clientById.get(r.client_id);
        return {
          pennylaneId: r.pennylane_id,
          clientId: r.client_id,
          clientName: client?.display_name ?? null,
          clientNumber: client?.client_number ?? null,
          mappedPennylaneId: r.mapped_pennylane_id,
          mappedName: mappedNameById.get(r.mapped_pennylane_id) ?? null,
          plName: r.pl_name,
          plEmail: r.pl_email,
          plPhone: r.pl_phone,
          firstSeenAt: r.first_seen_at,
          lastSeenAt: r.last_seen_at,
        };
      });
    });
  },
};
