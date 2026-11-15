/**
 * planningCa.service.js - Majord'home Artisan
 * ============================================================================
 * Données du CA HT programmé du Planning, pour une plage de dates : les
 * affaires qui y ont un RDV (chantiers des installations, interventions des
 * entretiens), TOUTES leurs journées posées — plage affichée ou non — et leur
 * montant HT.
 *
 * Un seul appel : RPC `planning_ca_affaires` (lecture seule, SECURITY INVOKER,
 * migration 20261115_1). Paramétrée par la plage, elle part en parallèle des
 * RDV du calendrier au lieu d'attendre leurs identifiants (trois allers-retours
 * en cascade avant le 2026-11-15). Elle rend des lignes brutes : les règles de
 * calcul restent ici — getChantierAmount et src/lib/planningCa.js.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { getChantierAmount } from '@services/chantiers.service';
import { montantHtContrat } from '@/lib/planningCa';

export const planningCaService = {
  /**
   * @param {object} p
   * @param {string} p.coreOrgId  org CORE
   * @param {string} p.startDate  ISO, incluse
   * @param {string} p.endDate  ISO, incluse (même borne que les RDV du calendrier)
   * @returns {Promise<{ data: { rdvs: object[], montants: Array<[string, number]> }|null, error: Error|null }>}
   *   `rdvs` : tous les RDV de ces affaires (pour indexerJours) ; `montants` : clé d'affaire → montant HT.
   */
  async getAffaires({ coreOrgId, startDate, endDate }) {
    return withErrorHandling(async () => {
      if (!coreOrgId) throw new Error('[planningCaService] coreOrgId est requis');
      const { data, error } = await supabase.rpc('planning_ca_affaires', {
        p_core_org_id: coreOrgId, p_from: startDate, p_to: endDate,
      });
      if (error) throw error;
      const montants = [
        ...(data?.chantiers || []).map((c) => [`chantier:${c.id}`, getChantierAmount(c)]),
        // Entretien : montant du contrat (TTC) → HT par la TVA de la catégorie de ses équipements.
        ...(data?.contrats || []).map((c) => [`entretien:${c.intervention_id}`, montantHtContrat(c.amount, c.taux || [])]),
      ];
      return { rdvs: data?.rdvs || [], montants };
    }, 'planningCa.getAffaires');
  },
};
