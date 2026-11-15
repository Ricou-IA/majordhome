/**
 * planningQueries.js - Majord'home Artisan
 * ============================================================================
 * Requêtes du Planning pour une plage de dates, en UN endroit : clé de cache,
 * lecture et fraîcheur. Les hooks qui les affichent (useAppointments,
 * usePlanningCa, useEtatsJournees) et le préchargement des semaines voisines
 * (usePlanningPrechargement) partent tous d'ici — une clé recopiée ailleurs
 * ferait un préchargement que personne ne relit.
 * ============================================================================
 */

import { appointmentsService } from '@services/appointments.service';
import { planningCaService } from '@services/planningCa.service';
import { tourneesService } from '@services/tournees.service';
import { supabase } from '@/lib/supabaseClient';
import { appointmentKeys, tourneeKeys } from '@hooks/cacheKeys';

const FRAICHEUR_RDV = 15_000;

/**
 * Ce que les RDV d'une plage font charger ensuite (requêtes dépendantes).
 * @param {Array<{ id: string, appointment_type?: string, chantier_id?: string|null, lead_id?: string|null }>|null|undefined} rdvs
 * @returns {{ appointmentIds: string[], chantierIds: string[], vtLeadIds: string[] }}
 *   `chantierIds` : chantiers des installations (pose provisoire) ; `vtLeadIds` : leads des visites techniques (devis fait).
 */
export function dependancesDesRdv(rdvs) {
  const liste = rdvs || [];
  return {
    appointmentIds: liste.map((a) => a.id),
    chantierIds: Array.from(new Set(liste
      .filter((a) => a.appointment_type === 'installation' && a.chantier_id)
      .map((a) => a.chantier_id))).sort(),
    vtLeadIds: Array.from(new Set(liste
      .filter((a) => a.appointment_type === 'rdv_technical' && a.lead_id)
      .map((a) => a.lead_id))).sort(),
  };
}

export const planningQueries = {
  /** RDV de la plage (filtrage par personne côté client). `data` = réponse du service `{ data, error }`. */
  list: (orgId, startDate, endDate, { appointmentType = null, status = null } = {}) => ({
    queryKey: appointmentKeys.list(orgId, { startDate, endDate }, { appointmentType, status }),
    queryFn: () => appointmentsService.getAppointments({ coreOrgId: orgId, startDate, endDate, appointmentType, status }),
    staleTime: FRAICHEUR_RDV,
  }),

  /** Liens technicien ↔ RDV. */
  technicians: (orgId, appointmentIds) => ({
    queryKey: appointmentKeys.technicians(orgId, appointmentIds),
    queryFn: async () => {
      if (appointmentIds.length === 0) return [];
      const { data } = await supabase
        .from('majordhome_appointment_technicians')
        .select('appointment_id, technician_id')
        .in('appointment_id', appointmentIds);
      return data || [];
    },
    staleTime: FRAICHEUR_RDV,
  }),

  /** Appros des chantiers des RDV d'installation (pose provisoire hachurée). */
  chantierOrders: (orgId, chantierIds) => ({
    queryKey: appointmentKeys.chantierOrders(orgId, chantierIds),
    queryFn: async () => {
      if (chantierIds.length === 0) return [];
      const { data, error } = await supabase
        .from('majordhome_chantiers')
        .select('id, chantier_status, equipment_order_status, materials_order_status')
        .eq('org_id', orgId)
        .in('id', chantierIds);
      if (error) throw error;
      return data || [];
    },
    staleTime: FRAICHEUR_RDV,
  }),

  /** Leads des visites techniques ayant un devis Pennylane rattaché (liseré noir « devis fait »). */
  quotedLeads: (orgId, vtLeadIds) => ({
    queryKey: appointmentKeys.quotedLeads(orgId, vtLeadIds),
    queryFn: async () => {
      if (vtLeadIds.length === 0) return [];
      const { data, error } = await supabase
        .from('majordhome_lead_pennylane_quotes')
        .select('lead_id')
        .eq('org_id', orgId)
        .is('ejected_at', null)
        .in('lead_id', vtLeadIds);
      if (error) throw error;
      return Array.from(new Set((data || []).map((r) => r.lead_id)));
    },
    staleTime: FRAICHEUR_RDV,
  }),

  /** Affaires du CA HT programmé (journées et montants). */
  caAffaires: (orgId, startDate, endDate) => ({
    queryKey: appointmentKeys.caAffaires(orgId, startDate, endDate),
    queryFn: async () => {
      const { data: affaires, error: err } = await planningCaService.getAffaires({ coreOrgId: orgId, startDate, endDate });
      if (err) throw err;
      return affaires;
    },
    staleTime: FRAICHEUR_RDV,
  }),

  /** Étiquettes de secteur et traces de figeage des journées de la plage. */
  journeesSecteur: (coreOrgId, startDate, endDate) => ({
    queryKey: tourneeKeys.journeesSecteur(coreOrgId, startDate, endDate),
    queryFn: async () => {
      const { data, error } = await tourneesService.getJourneesSecteur({ coreOrgId, from: startDate, to: endDate });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  }),
};
