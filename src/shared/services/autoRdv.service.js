/**
 * autoRdv.service.js — Majord'home Artisan
 * ============================================================================
 * Prise de rendez-vous d'entretien par le client (spec 2026-09-29 auto-RDV).
 * Côté app authentifiée, une seule opération : obtenir le lien signé d'un
 * contrat (edge `auto-rdv`, action `sign`, membership vérifiée côté edge).
 * La page publique `/rdv/:token`, elle, parle à l'edge sans session.
 * ============================================================================
 */

import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';

export const autoRdvService = {
  /**
   * Lien de prise de rendez-vous d'un contrat, signé par l'edge (HMAC, valable
   * jusqu'à la fin du mois, ou du mois suivant s'il reste moins de 7 jours).
   * @param {{ orgId: string, contractId: string }} p  org CORE
   * @returns {Promise<{ data: { url: string, expires_at: string }|null, error: Error|null }>}
   */
  async signerLien({ orgId, contractId }) {
    try {
      const { data, error } = await supabase.functions.invoke('auto-rdv', {
        body: { action: 'sign', org_id: orgId, contract_id: contractId },
      });
      if (error) return { data: null, error };
      if (!data?.url) return { data: null, error: new Error(data?.error || 'lien_indisponible') };
      return { data, error: null };
    } catch (error) {
      logger.error('[autoRdv] signerLien', error);
      return { data: null, error };
    }
  },

  /**
   * Invitations d'un mois (vue `majordhome_auto_rdv_invitations`, org CORE) :
   * mail envoyé, page ouverte, RDV pris, relance SMS, liste d'appels, expiration.
   * @param {{ orgId: string, mois: string }} p  `mois` = `YYYY-MM-01`
   * @returns {Promise<{ data: Array<object>, error: Error|null }>}
   */
  async getInvitationsDuMois({ orgId, mois }) {
    try {
      const { data, error } = await supabase
        .from('majordhome_auto_rdv_invitations')
        .select('id, contract_id, client_id, mois, raison, sent_at, opened_at, booked_at, sms_relance_at, escalade_appel_at, outcome, relances')
        .eq('org_id', orgId).eq('mois', mois);
      return { data: data || [], error };
    } catch (error) {
      logger.error('[autoRdv] getInvitationsDuMois', error);
      return { data: [], error };
    }
  },
};
