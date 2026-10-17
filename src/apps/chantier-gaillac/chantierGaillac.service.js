/**
 * chantierGaillac.service.js — accès données du suivi « Chantier Gaillac » (module provisoire).
 *
 * Lecture / écriture via les vues publiques miroirs `majordhome_chantier_gaillac_*`
 * (security_invoker, auto-updatables) : le schéma majordhome n'est pas exposé à PostgREST.
 * Ce qu'un technicien peut écrire est borné en base (RLS + trigger `cg_taches_before_update`).
 * Retour `{ data, error }` via withErrorHandling — jamais de throw au caller.
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const TACHES = 'majordhome_chantier_gaillac_taches';
const PLANNING = 'majordhome_chantier_gaillac_planning';

export const chantierGaillacService = {
  /** Codes de planning (journées / demi-journées), dans l'ordre. */
  async fetchPlanning(mdhOrgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(PLANNING)
        .select('code, ordre, libelle, technicien_id, date_prevue')
        .eq('org_id', mdhOrgId)
        .order('ordre');
      if (error) throw error;
      return data || [];
    }, 'chantierGaillac.fetchPlanning');
  },

  /** Les 98 tâches. */
  async fetchTaches(mdhOrgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(TACHES)
        .select('id, numero, ordre, site, adresse, zone, action, theme, type_ligne, technicien_id, duree_min, achat_requis, planning_code, observations, fait, fait_le, fait_par, commentaire_terrain')
        .eq('org_id', mdhOrgId)
        .order('ordre');
      if (error) throw error;
      return data || [];
    }, 'chantierGaillac.fetchTaches');
  },

  /**
   * Techniciens du chantier (nom affiché + lien compte, pour « validé par … »).
   * Requête séparée : un JOIN dans la vue la rendrait non-updatable.
   */
  async fetchTeam(mdhOrgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_team_members')
        .select('id, user_id, display_name, first_name')
        .eq('org_id', mdhOrgId);
      if (error) throw error;
      return data || [];
    }, 'chantierGaillac.fetchTeam');
  },

  /** Coche / décoche. fait_le et fait_par sont posés par le trigger. */
  async setFait(mdhOrgId, id, fait) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(TACHES)
        .update({ fait })
        .eq('id', id)
        .eq('org_id', mdhOrgId)
        .select('id, fait, fait_le, fait_par')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Validation refusée : tâche introuvable ou droits insuffisants');
      return data;
    }, 'chantierGaillac.setFait');
  },

  /** Commentaire terrain (texte vide → NULL). */
  async setCommentaire(mdhOrgId, id, texte) {
    return withErrorHandling(async () => {
      const value = (texte || '').trim() || null;
      const { data, error } = await supabase
        .from(TACHES)
        .update({ commentaire_terrain: value })
        .eq('id', id)
        .eq('org_id', mdhOrgId)
        .select('id, commentaire_terrain')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Commentaire refusé : tâche introuvable ou droits insuffisants');
      return data;
    }, 'chantierGaillac.setCommentaire');
  },

  /** Admin : date prévue d'un code (null pour la retirer). RLS : refus silencieux ⇒ 0 ligne ⇒ erreur. */
  async setDatePrevue(mdhOrgId, code, date) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(PLANNING)
        .update({ date_prevue: date || null, updated_at: new Date().toISOString() })
        .eq('code', code)
        .eq('org_id', mdhOrgId)
        .select('code, date_prevue')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Date non enregistrée : réservé aux administrateurs');
      return data;
    }, 'chantierGaillac.setDatePrevue');
  },
};
