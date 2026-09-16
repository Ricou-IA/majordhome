/**
 * audit.service.js — lecture du mouchard (journal d'audit des écritures)
 * ============================================================================
 * Vue `majordhome_audit_log` (security_invoker → RLS membres de l'org), alimentée
 * par le trigger `majordhome.audit_row_change()` sur `leads` et `appointments`
 * (migration 20260916_3). Lecture seule : personne n'écrit dans ce journal
 * depuis le front, c'est le principe même du mouchard.
 *
 * `org_id` de la vue = org CORE (normalisé par le trigger, y compris pour les
 * RDV qui portent l'org majordhome en table) → filtrer avec `organization.id`.
 * Mise en forme : `src/lib/auditTrail.js` (pur).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const AUDIT_COLUMNS = 'id, org_id, table_name, record_id, lead_id, action, changed_fields, old_values, new_values, changed_by, changed_by_name, changed_by_role, source, changed_at';

export const auditService = {
  /**
   * Toutes les écritures rattachées à un lead : la fiche elle-même ET ses RDV
   * (le trigger pose `lead_id` sur les lignes `appointments`).
   */
  async getForLead(orgId, leadId, { limit = 200 } = {}) {
    if (!orgId || !leadId) return { data: [], error: null };
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_audit_log')
        .select(AUDIT_COLUMNS)
        .eq('org_id', orgId)
        .eq('lead_id', leadId)
        .order('changed_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    }, 'audit.getForLead');
  },

  /** Écritures d'une entité précise (ex. un RDV depuis la modale planning). */
  async getForRecord(orgId, tableName, recordId, { limit = 200 } = {}) {
    if (!orgId || !tableName || !recordId) return { data: [], error: null };
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_audit_log')
        .select(AUDIT_COLUMNS)
        .eq('org_id', orgId)
        .eq('table_name', tableName)
        .eq('record_id', recordId)
        .order('changed_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    }, 'audit.getForRecord');
  },
};

export default auditService;
