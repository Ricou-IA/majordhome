// src/shared/services/pv.service.js
// CRUD simulations PV via la vue publique majordhome_pv_simulations
// (security_invoker + auto-updatable). RLS : le commercial ne voit que les
// siennes, org_admin voit tout. org_id filtré explicitement (défense en profondeur).
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { escapePostgrestSearchTerm } from '@lib/postgrestUtils';

const VIEW = 'majordhome_pv_simulations';
const LIST_COLUMNS = 'id, client_name, client_address, lat, lon, created_by, results, created_at';

export const pvService = {
  /** Liste paginée des simulations (recherche par nom client). */
  async list({ orgId, search = '', page = 0, pageSize = 25 }) {
    return withErrorHandling(async () => {
      let query = supabase
        .from(VIEW)
        .select(LIST_COLUMNS, { count: 'exact' })
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (search.trim()) {
        const term = escapePostgrestSearchTerm(search.trim());
        query = query.ilike('client_name', `%${term}%`);
      }
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    }, 'pv.list');
  },

  /** Détail complet (inputs + pvgis_monthly + results) pour rechargement à l'identique. */
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
    }, 'pv.getById');
  },

  /** Enregistre une simulation. */
  async create({ orgId, userId, clientName, clientAddress, lat, lon, inputs, pvgisMonthly, results, comment }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .insert({
          org_id: orgId,
          created_by: userId,
          client_name: clientName || null,
          client_address: clientAddress || null,
          lat: lat ?? null,
          lon: lon ?? null,
          inputs,
          pvgis_monthly: pvgisMonthly,
          results,
          comment: comment || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    }, 'pv.create');
  },

  /** Supprime une simulation (owner ou org_admin via RLS). */
  async remove(orgId, id) {
    return withErrorHandling(async () => {
      const { error } = await supabase
        .from(VIEW)
        .delete()
        .eq('org_id', orgId)
        .eq('id', id);
      if (error) throw error;
      return true;
    }, 'pv.remove');
  },
};
