/**
 * dayEndpoints.service.js — Exception « Départ / Retour » d'une journée de technicien
 * ============================================================================
 * Par défaut, un technicien part et rentre au point de ses réglages (Settings →
 * Équipe, l'agence si rien n'est saisi). Pour une journée donnée on peut imposer
 * l'agence (charger du matériel, retour nécessaire) : c'est cette exception, lue
 * par la feuille de route ET par le moteur de tournées (loaders.js).
 * Lecture : vue `majordhome_team_member_day_endpoints` (security_invoker).
 * Écriture : RPC `team_member_set_day_endpoints` (team_leader+, les deux valeurs
 * NULL suppriment l'exception).
 * Spec : docs/superpowers/specs/2026-10-14-depart-retour-technicien-design.md
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { getMajordhomeOrgId, withErrorHandling } from '@/lib/serviceHelpers';

export const dayEndpointsService = {
  /**
   * @param {{ coreOrgId: string, teamMemberId: string, date: string }} p
   * @returns {Promise<{ data: { depart: string|null, retour: string|null }|null, error: Error|null }>}
   */
  async get({ coreOrgId, teamMemberId, date }) {
    return withErrorHandling(async () => {
      const orgId = await getMajordhomeOrgId(coreOrgId);
      const { data, error } = await supabase
        .from('majordhome_team_member_day_endpoints')
        .select('depart, retour')
        .eq('org_id', orgId)
        .eq('team_member_id', teamMemberId)
        .eq('date', date)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    }, 'dayEndpoints.get');
  },

  /**
   * @param {{ teamMemberId: string, date: string, depart: 'agence'|'perso'|null, retour: 'agence'|'perso'|null }} p
   * @returns {Promise<{ data: { depart: string|null, retour: string|null }|null, error: Error|null }>}
   *   `data` null quand l'exception a été retirée (les deux valeurs NULL).
   */
  async set({ teamMemberId, date, depart = null, retour = null }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('team_member_set_day_endpoints', {
        p_team_member_id: teamMemberId, p_date: date, p_depart: depart, p_retour: retour,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row ? { depart: row.depart ?? null, retour: row.retour ?? null } : null;
    }, 'dayEndpoints.set');
  },
};
