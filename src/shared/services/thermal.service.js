// src/shared/services/thermal.service.js
// CRUD études thermiques via la vue publique majordhome_thermal_studies
// (security_invoker + auto-updatable). org_id filtré explicitement
// (défense en profondeur, même si RLS s'applique via la vue).
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { escapePostgrestSearchTerm } from '@lib/postgrestUtils';
import { DEFAULT_PAGE_SIZE } from '@lib/constants';

const VIEW = 'majordhome_thermal_studies';
const LIST_COLUMNS = 'id, title, status, engine_version, client_id, lead_id, results, created_at, updated_at';

/**
 * Payload étude (camelCase wizard) → colonnes DB (snake_case).
 * Champs absents (undefined) omis → update partiel OK, create inchangé.
 * Allowlist implicite : org_id / created_by / id ne transitent jamais par un patch.
 */
function toRow({ title, clientId, leadId, input, results, engineVersion, status } = {}) {
  const row = {
    title: title === undefined ? undefined : (title || null),
    client_id: clientId === undefined ? undefined : (clientId || null),
    lead_id: leadId === undefined ? undefined : (leadId || null),
    input,
    results,
    engine_version: engineVersion,
    status,
  };
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

export const thermalService = {
  /** Liste paginée des études (recherche par titre). */
  async list({ orgId, search = '', page = 0, pageSize = DEFAULT_PAGE_SIZE }) {
    return withErrorHandling(async () => {
      let query = supabase
        .from(VIEW)
        .select(LIST_COLUMNS, { count: 'exact' })
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (search.trim()) {
        const term = escapePostgrestSearchTerm(search.trim());
        query = query.ilike('title', `%${term}%`);
      }
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    }, 'thermal.list');
  },

  /** Détail complet (input + results) pour rechargement à l'identique. */
  async getById(orgId, id) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .select('*')
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'thermal.getById');
  },

  /** Enregistre une étude. */
  async create({ orgId, userId, title, clientId, leadId, input, results, engineVersion, status }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .insert({
          ...toRow({
            title: title || null,
            clientId: clientId || null,
            leadId: leadId || null,
            input,
            results: results ?? null,
            engineVersion,
            status: status ?? 'draft',
          }),
          org_id: orgId,
          created_by: userId,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    }, 'thermal.create');
  },

  /**
   * Met à jour partiellement une étude.
   * `patch` = payload camelCase, mêmes clés que create (title, clientId, leadId,
   * input, results, engineVersion, status) — les champs absents ne sont pas touchés.
   */
  async update(orgId, id, patch) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .update({ ...toRow(patch), updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    }, 'thermal.update');
  },

  /** Supprime une étude (owner ou org_admin via RLS). */
  async remove(orgId, id) {
    return withErrorHandling(async () => {
      const { error } = await supabase
        .from(VIEW)
        .delete()
        .eq('org_id', orgId)
        .eq('id', id);
      if (error) throw error;
      return true;
    }, 'thermal.remove');
  },
};
