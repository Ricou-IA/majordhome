/**
 * teamSkills.service.js - Majord'home Artisan
 * ============================================================================
 * Compétences des techniciens, cochées comme des droits : 1 ligne de
 * majordhome.team_member_skills = « ce membre couvre ce type pour ce rôle ».
 * Aucune ligne pour un rôle = rien coché = jamais proposé en tournée.
 *
 * Lecture : vue majordhome_team_member_skills (security_invoker, RLS membre).
 * Écriture : RPC team_member_set_skills (SECURITY DEFINER, org_admin only) qui
 * remplace ATOMIQUEMENT l'ensemble (membre × rôle) — cocher une case, décocher,
 * « tout cocher » passent par la même primitive. Un type hors org fait échouer
 * l'appel entier (23514), jamais un filtrage silencieux.
 *
 * Service séparé d'appointments.service.js (870 LOC, seuil dépassé).
 * Spec : docs/superpowers/specs/2026-09-12-referentiel-equipements-tarifs-competences-design.md §4.5, §4.8
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { SKILL_ROLES, competencesVides } from '@/lib/tournee/competences.js';

export { SKILL_ROLES };

export const teamSkillsService = {
  /**
   * Lignes de compétence des membres donnés.
   * @param {string[]} teamMemberIds
   * @returns {Promise<{ data: Array<{ team_member_id, equipment_type_id, role }>, error }>}
   */
  async getTeamMemberSkills(teamMemberIds) {
    return withErrorHandling(async () => {
      const ids = (teamMemberIds || []).filter(Boolean);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('majordhome_team_member_skills')
        .select('team_member_id, equipment_type_id, role')
        .in('team_member_id', ids);
      if (error) throw error;
      return data || [];
    }, 'teamSkills.getTeamMemberSkills');
  },

  /**
   * Remplace l'ensemble des types cochés d'un membre pour un rôle.
   * @param {string} teamMemberId
   * @param {'entretien'|'pose'} role
   * @param {string[]} equipmentTypeIds  liste complète après modification ([] = tout décocher)
   * @returns {Promise<{ data: string[]|null, error }>}  ids réellement écrits (lus après écriture)
   */
  async setTeamMemberSkills(teamMemberId, role, equipmentTypeIds) {
    return withErrorHandling(async () => {
      if (!teamMemberId) throw new Error('[teamSkillsService] teamMemberId est requis');
      if (!SKILL_ROLES.includes(role)) throw new Error(`[teamSkillsService] rôle inconnu : ${role}`);
      const { data, error } = await supabase.rpc('team_member_set_skills', {
        p_team_member_id: teamMemberId,
        p_role: role,
        p_equipment_type_ids: [...new Set((equipmentTypeIds || []).filter(Boolean))],
      });
      if (error) throw error;
      // RETURNS SETOF uuid → tableau de chaînes (PostgREST) ; on ne suppose pas le succès, on relit.
      return Array.isArray(data) ? data.map((x) => (typeof x === 'string' ? x : x?.team_member_set_skills ?? x)) : [];
    }, 'teamSkills.setTeamMemberSkills');
  },
};

/**
 * Regroupe les lignes par membre → { entretien: Set, pose: Set }. Un membre
 * absent des lignes reçoit des ensembles vides (rien coché), jamais undefined.
 * @param {Array<{ team_member_id, equipment_type_id, role }>} rows
 * @param {string[]} [teamMemberIds]  membres à garantir dans la sortie
 * @returns {Map<string, { entretien: Set<string>, pose: Set<string> }>}
 */
export function indexerCompetences(rows, teamMemberIds = []) {
  const out = new Map();
  const vide = () => Object.fromEntries(Object.keys(competencesVides()).map((r) => [r, new Set()]));
  for (const id of teamMemberIds) out.set(id, vide());
  for (const r of rows || []) {
    if (!SKILL_ROLES.includes(r.role)) continue;
    if (!out.has(r.team_member_id)) out.set(r.team_member_id, vide());
    out.get(r.team_member_id)[r.role].add(r.equipment_type_id);
  }
  return out;
}

export default teamSkillsService;
