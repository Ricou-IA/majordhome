/**
 * quoteDismissals.service.js — écartements de devis Pennylane
 * ============================================================================
 * Écarter un devis = le sortir de l'explorateur sans le toucher dans Pennylane.
 * Réversible (restore). Fichier séparé de pennylane.service.js qui est déjà à
 * 1778 LOC (plafond conventionnel 700).
 *
 * ⚠️ orgId = org CORE (useAuth().organization.id).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const VIEW = 'majordhome_pennylane_quote_dismissals';

export const quoteDismissalsService = {
  /**
   * Écarte un ou plusieurs devis. Idempotent (upsert sur la PK composite).
   * @param {string} orgId
   * @param {Array<number>} quoteIds
   * @param {object} [opts]
   * @param {string} [opts.reason]
   * @param {string} [opts.userId]
   */
  async dismiss(orgId, quoteIds, { reason = null, userId = null } = {}) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[quoteDismissals] orgId requis');
      const ids = (quoteIds || []).map(Number).filter(Number.isFinite);
      if (ids.length === 0) return { dismissed: 0 };

      const rows = ids.map(id => ({
        org_id: orgId,
        pennylane_quote_id: id,
        reason,
        dismissed_by: userId,
      }));

      const { error } = await supabase
        .from(VIEW)
        .upsert(rows, { onConflict: 'org_id,pennylane_quote_id' });

      if (error) throw error;
      return { dismissed: ids.length };
    }, 'quoteDismissals.dismiss');
  },

  /**
   * Réintègre un devis écarté (suppression de la ligne).
   */
  async restore(orgId, quoteId) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[quoteDismissals] orgId requis');

      const { error } = await supabase
        .from(VIEW)
        .delete()
        .eq('org_id', orgId)
        .eq('pennylane_quote_id', Number(quoteId));

      if (error) throw error;
      return { restored: 1 };
    }, 'quoteDismissals.restore');
  },
};

export default quoteDismissalsService;
