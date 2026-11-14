/**
 * usePlanningCa.js - Majord'home Artisan
 * ============================================================================
 * CA HT programmé du Planning : un chiffre par jour et la part de chaque
 * technicien (règles : src/lib/planningCa.js). Rien n'est stocké — la requête
 * vit sous `appointmentKeys.all`, donc toute écriture d'un RDV (déplacement,
 * ajout d'un jour, annulation) recalcule la répartition.
 *
 * Chiffre inconnu (chargement ou erreur) ⇒ `ca` vaut null : l'écran n'affiche
 * rien plutôt qu'un 0 qui se lirait « journée sans chiffre ».
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { planningCaService } from '@services/planningCa.service';
import { appointmentKeys } from '@hooks/cacheKeys';
import { caProgramme, cleAffaire, indexerJours } from '@/lib/planningCa';

/**
 * @param {object} p
 * @param {string} p.orgId  org CORE
 * @param {Array<object>} p.appointments  RDV de la plage affichée, avec `technician_ids` (useAppointments)
 * @param {Set<string>|null} [p.technicienIds]  filtre équipe ; null = toute l'équipe
 * @param {boolean} [p.enabled]  faux ⇒ aucune requête (rôle sans accès au chiffre)
 * @returns {{ ca: ReturnType<typeof caProgramme>|null, isLoading: boolean, error: Error|null }}
 */
export function usePlanningCa({ orgId, appointments, technicienIds = null, enabled = true }) {
  const { chantierIds, interventionIds } = useMemo(() => {
    const chantiers = new Set();
    const interventions = new Set();
    for (const a of appointments || []) {
      const cle = cleAffaire(a);
      if (!cle) continue;
      if (a.appointment_type === 'installation') chantiers.add(a.chantier_id);
      else interventions.add(a.intervention_id);
    }
    return { chantierIds: [...chantiers].sort(), interventionIds: [...interventions].sort() };
  }, [appointments]);

  const aucuneAffaire = chantierIds.length === 0 && interventionIds.length === 0;
  const { data, isLoading, error } = useQuery({
    queryKey: appointmentKeys.caAffaires(orgId, chantierIds, interventionIds),
    queryFn: async () => {
      const { data: affaires, error: err } = await planningCaService.getAffaires({ coreOrgId: orgId, chantierIds, interventionIds });
      if (err) throw err;
      return affaires;
    },
    enabled: !!orgId && enabled && !aucuneAffaire,
    staleTime: 15_000,
  });

  const ca = useMemo(() => {
    if (!enabled) return null;
    if (aucuneAffaire) return caProgramme({ rdvs: [], joursParAffaire: new Map(), montantParAffaire: new Map() });
    if (!data) return null;
    return caProgramme({
      rdvs: appointments,
      joursParAffaire: indexerJours(data.rdvs),
      montantParAffaire: new Map(data.montants),
      technicienIds,
    });
  }, [enabled, aucuneAffaire, data, appointments, technicienIds]);

  return { ca: error ? null : ca, isLoading, error: error || null };
}
