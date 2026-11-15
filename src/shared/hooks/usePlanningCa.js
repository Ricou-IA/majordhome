/**
 * usePlanningCa.js - Majord'home Artisan
 * ============================================================================
 * CA HT programmé du Planning : un chiffre par jour et la part de chaque
 * technicien (règles : src/lib/planningCa.js). Rien n'est stocké — la requête
 * vit sous `appointmentKeys.all`, donc toute écriture d'un RDV (déplacement,
 * ajout d'un jour, annulation) recalcule la répartition.
 *
 * La requête ne dépend que de la plage affichée : elle part en même temps que
 * les RDV du calendrier, le chiffre arrive avec les blocs.
 *
 * Chiffre inconnu (chargement ou erreur) ⇒ `ca` vaut null : l'écran n'affiche
 * rien plutôt qu'un 0 qui se lirait « journée sans chiffre ».
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { planningCaService } from '@services/planningCa.service';
import { appointmentKeys } from '@hooks/cacheKeys';
import { caProgramme, indexerJours } from '@/lib/planningCa';

/**
 * @param {object} p
 * @param {string} p.orgId  org CORE
 * @param {string} p.startDate  plage affichée (ISO), mêmes bornes que useAppointments
 * @param {string} p.endDate
 * @param {Array<object>} p.appointments  RDV de la plage, avec `technician_ids` (useAppointments)
 * @param {Set<string>|null} [p.technicienIds]  filtre équipe ; null = toute l'équipe
 * @param {boolean} [p.enabled]  faux ⇒ aucune requête (rôle sans accès au chiffre)
 * @returns {{ ca: ReturnType<typeof caProgramme>|null, isLoading: boolean, error: Error|null }}
 */
export function usePlanningCa({ orgId, startDate, endDate, appointments, technicienIds = null, enabled = true }) {
  const { data, isLoading, error } = useQuery({
    queryKey: appointmentKeys.caAffaires(orgId, startDate, endDate),
    queryFn: async () => {
      const { data: affaires, error: err } = await planningCaService.getAffaires({ coreOrgId: orgId, startDate, endDate });
      if (err) throw err;
      return affaires;
    },
    enabled: !!orgId && !!startDate && !!endDate && enabled,
    staleTime: 15_000,
  });

  const ca = useMemo(() => {
    if (!enabled || !data) return null;
    return caProgramme({
      rdvs: appointments,
      joursParAffaire: indexerJours(data.rdvs),
      montantParAffaire: new Map(data.montants),
      technicienIds,
    });
  }, [enabled, data, appointments, technicienIds]);

  return { ca: error ? null : ca, isLoading, error: error || null };
}
