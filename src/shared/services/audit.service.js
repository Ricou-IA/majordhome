/**
 * audit.service.js — lecture du mouchard (journal d'audit des écritures)
 * ============================================================================
 * Vue `majordhome_audit_log` (security_invoker → RLS membres de l'org), alimentée
 * par le trigger `majordhome.audit_row_change()` sur `leads`, `appointments`, `chantiers`
 * (migration 20260916_3) et la fiche client — `clients`, `equipments`, `contracts`,
 * `contract_equipments` (20261116_5). Lecture seule : personne n'écrit dans ce journal
 * depuis le front, c'est le principe même du mouchard.
 *
 * `org_id` de la vue = org CORE (normalisé par le trigger, y compris pour les
 * RDV qui portent l'org majordhome en table) → filtrer avec `organization.id`.
 * Mise en forme : `src/lib/auditTrail.js` (pur).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const AUDIT_COLUMNS = 'id, org_id, table_name, record_id, lead_id, client_id, action, changed_fields, old_values, new_values, changed_by, changed_by_name, changed_by_role, source, changed_at';

/**
 * Tables qui font la Timeline d'une fiche client : la fiche, ses équipements, son contrat
 * (et les équipements qui y entrent ou en sortent), ses RDV. Les leads du client portent
 * aussi `client_id` au journal, mais leur histoire se lit sur la fiche lead (elle est
 * rythmée par la synchro Pennylane) : ils ne sont pas repris ici.
 */
export const CLIENT_TIMELINE_TABLES = ['clients', 'equipments', 'contracts', 'contract_equipments', 'appointments'];

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

  /**
   * Toutes les écritures rattachées à une fiche client (`audit_log.client_id`, posé par le
   * trigger — migration 20261116_5). `truncated` : la limite a été atteinte, l'écran le dit.
   */
  async getForClient(orgId, clientId, { limit = 200 } = {}) {
    if (!orgId || !clientId) return { data: { rows: [], truncated: false }, error: null };
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_audit_log')
        .select(AUDIT_COLUMNS)
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .in('table_name', CLIENT_TIMELINE_TABLES)
        .order('changed_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return { rows: data || [], truncated: (data || []).length >= limit };
    }, 'audit.getForClient');
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
