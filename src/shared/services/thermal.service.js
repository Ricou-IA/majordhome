// src/shared/services/thermal.service.js
// CRUD études thermiques via la vue publique majordhome_thermal_studies
// (security_invoker + auto-updatable). org_id filtré explicitement
// (défense en profondeur, même si RLS s'applique via la vue).
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { escapePostgrestSearchTerm } from '@lib/postgrestUtils';

const VIEW = 'majordhome_thermal_studies';
const LIST_COLUMNS = 'id, title, status, engine_version, client_id, lead_id, results, created_at, updated_at';

export const thermalService = {
  /** Liste paginée des études (recherche par titre). */
  async list({ orgId, search = '', page = 0, pageSize = 25 }) {
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
          org_id: orgId,
          created_by: userId,
          title: title || null,
          client_id: clientId || null,
          lead_id: leadId || null,
          input,
          results: results ?? null,
          engine_version: engineVersion,
          status: status ?? 'draft',
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    }, 'thermal.create');
  },

  /** Met à jour partiellement une étude. */
  async update(orgId, id, patch) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .update({ ...patch, updated_at: new Date().toISOString() })
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
