/**
 * teamAvailability.service.js - Majord'home Artisan
 * ============================================================================
 * Horaires de travail d'un membre (majordhome.team_members.default_availability),
 * lus par le moteur de tournées, scheduleConflicts.js et le planning.
 *
 * Lecture : avec la ressource planning (appointmentsService.getTeamMembers).
 * Écriture : RPC team_member_set_availability (SECURITY DEFINER, org_admin de
 * l'org du membre) qui valide, normalise et renvoie la valeur STOCKÉE — on ne
 * suppose jamais le succès. Codes : 42501 droits, 22023 saisie invalide,
 * P0002 membre inconnu.
 *
 * Service séparé d'appointments.service.js (seuil de taille dépassé).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

export const teamAvailabilityService = {
  /**
   * @param {string} teamMemberId
   * @param {Record<string, { start?: string, end?: string, active: boolean }>} availability  7 jours
   * @returns {Promise<{ data: object|null, error: Error|null }>}  valeur stockée après écriture
   */
  async setAvailability(teamMemberId, availability) {
    return withErrorHandling(async () => {
      if (!teamMemberId) throw new Error('[teamAvailabilityService] teamMemberId est requis');
      const { data, error } = await supabase.rpc('team_member_set_availability', {
        p_team_member_id: teamMemberId,
        p_availability: availability,
      });
      if (error) throw error;
      if (!data) throw new Error('Horaires non enregistrés : aucune valeur renvoyée');
      return data;
    }, 'teamAvailability.setAvailability');
  },
};

export default teamAvailabilityService;
