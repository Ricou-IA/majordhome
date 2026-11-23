/**
 * useHistoriqueClient — l'historique de la fiche client, mis en forme une seule fois
 * pour l'onglet Échanges (`TabTimeline`, liste complète) et le Résumé (`TabResume`,
 * dernières entrées). Aucune requête propre : il compose les hooks existants (journal
 * d'audit, anciennes activités, équipements et interventions du client pour nommer
 * les sujets, référentiel d'équipements, résolveurs d'ids).
 *
 * Mise en forme : `buildAuditEntry` / `mergeTimeline` (src/lib/auditTrail.js, pur).
 * Seule chose sautée : la création et la purge des lignes par équipement d'un
 * entretien (`estEcritureMecanique`), posées et retirées par la planification.
 */

import { useMemo, useCallback } from 'react';
import { useClientActivities, useClientAuditTrail, useClientEquipments } from '@hooks/useClients';
import { useAuditResolvers } from '@hooks/useAuditResolvers';
import { useProjectInterventions } from '@hooks/useInterventions';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { CLIENT_CATEGORIES, HOUSING_TYPES, LEAD_SOURCES } from '@services/clients.service';
import { CONTRACT_STATUSES, CONTRACT_FREQUENCIES, MAINTENANCE_MONTHS } from '@services/contracts.service';
import { INTERVENTION_TYPES } from '@services/interventions.service';
import { ENTRETIEN_STATUSES, SAV_STATUSES, DEVIS_STATUSES, PARTS_ORDER_STATUSES } from '@services/sav.service';
import { SAV_URGENCES } from '@/lib/savUrgency';
import { buildAuditEntry, mergeTimeline, toNameMap, estEcritureMecanique, sujetIntervention } from '@/lib/auditTrail';
import { libelleEquipement } from '@/lib/equipmentReferential';

/** Codes d'une carte Entretien / SAV qui n'ont pas de référentiel exporté ailleurs. */
const STATUTS_TECHNIQUES = new Map([
  ['scheduled', 'Planifié'], ['in_progress', 'En cours'], ['completed', 'Terminé'],
  ['cancelled', 'Annulé'], ['on_hold', 'En attente'], ['no_show', 'Absent'],
]);
const ORIGINES_SAV = new Map([['appel_client', 'Appel du client'], ['entretien', 'Suite d’entretien']]);

/**
 * @param {string} clientId
 * @param {string|null} projectId
 * @returns {{ timeline: Array<object>, truncated: boolean, isLoading: boolean, auditError: unknown, activitiesError: unknown, refresh: Function }}
 */
export function useHistoriqueClient(clientId, projectId) {
  const { activities, isLoading: loadingActivities, error: activitiesError, refresh: refreshActivities } = useClientActivities(clientId);
  const { rows, truncated, isLoading: loadingAudit, error: auditError, refresh: refreshAudit } = useClientAuditTrail(clientId);
  const { equipments } = useClientEquipments(clientId);
  const { interventions } = useProjectInterventions(projectId);
  const { categories, index: referentiel } = useEquipmentReferential();
  const baseResolvers = useAuditResolvers();

  const libellesEquipements = useMemo(() => new Map(equipments.map((e) => [
    String(e.id),
    [libelleEquipement(e, referentiel), [e.brand, e.model].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
  ])), [equipments, referentiel]);

  // Une modification ne porte que les champs changés : pour dire « SAV », « Entretien » ou
  // « Certificat · tel équipement », on lit l'intervention dans la liste du client.
  const interventionsById = useMemo(() => new Map(interventions.map((i) => [i.id, i])), [interventions]);
  const subjectOf = useCallback((row) => {
    const connue = interventionsById.get(row.record_id) || null;
    const equipementId = connue?.equipment_id ?? row.new_values?.equipment_id ?? row.old_values?.equipment_id ?? null;
    return sujetIntervention(row, connue, equipementId ? libellesEquipements.get(String(equipementId)) || null : null);
  }, [interventionsById, libellesEquipements]);

  // ids → libellés. Une clé `table.champ` prime sur `champ` : « statut » n'a pas le même
  // sens pour un RDV et pour un contrat.
  const resolvers = useMemo(() => ({
    ...baseResolvers,
    category_id: toNameMap(categories),
    equipment_id: libellesEquipements,
    'contracts.status': toNameMap(CONTRACT_STATUSES, 'value'),
    'contracts.frequency': toNameMap(CONTRACT_FREQUENCIES, 'value'),
    'contracts.maintenance_month': toNameMap(MAINTENANCE_MONTHS, 'value'),
    'clients.client_category': toNameMap(CLIENT_CATEGORIES, 'value'),
    'clients.housing_type': toNameMap(HOUSING_TYPES, 'value'),
    'clients.lead_source': toNameMap(LEAD_SOURCES, 'value'),
    'interventions.intervention_type': toNameMap(INTERVENTION_TYPES, 'value'),
    'interventions.workflow_status': toNameMap([...ENTRETIEN_STATUSES, ...SAV_STATUSES], 'value'),
    'interventions.status': STATUTS_TECHNIQUES,
    'interventions.sav_urgency': toNameMap(SAV_URGENCES, 'value'),
    'interventions.sav_origin': ORIGINES_SAV,
    'interventions.devis_status': toNameMap(DEVIS_STATUSES, 'value'),
    'interventions.parts_order_status': toNameMap(PARTS_ORDER_STATUSES, 'value'),
  }), [baseResolvers, categories, libellesEquipements]);

  const timeline = useMemo(
    () => mergeTimeline(
      activities,
      rows.filter((row) => !estEcritureMecanique(row)).map((row) => buildAuditEntry(row, { resolvers, subjectOf })),
    ),
    [activities, rows, resolvers, subjectOf],
  );

  const refresh = useCallback(() => { refreshAudit(); refreshActivities(); }, [refreshAudit, refreshActivities]);

  return {
    timeline,
    truncated,
    isLoading: loadingActivities || loadingAudit,
    auditError,
    activitiesError,
    refresh,
  };
}
