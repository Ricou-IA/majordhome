// src/shared/hooks/useMaintenance.js
// ============================================================================
// Module Maintenance — hooks React Query (spec 2026-09-25-module-maintenance-taches-recurrentes-design.md).
// Contrat des mutations : unwrapResult → mutateAsync résout avec `data` et REJETTE
// sur `{ error }`. Exception assumée : recordCompletion résout avec la réponse métier
// de la RPC ({ ok:false, error:'pin_invalid' } n'est pas une erreur technique).
// ============================================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { maintenanceService } from '@services/maintenance.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { maintenanceKeys } from './cacheKeys';

export { maintenanceKeys } from './cacheKeys';

/**
 * Unités, tâches, opérateurs + dernière réalisation de chaque tâche + journal de la
 * période demandée. `refetchInterval` pour la borne (60 s).
 * @param {string} orgId
 * @param {{ refetchInterval?: number|false }} [opts]
 */
export function useMaintenanceReferentiel(orgId, { refetchInterval = false } = {}) {
  return useQuery({
    queryKey: maintenanceKeys.referentiel(orgId),
    queryFn: () => unwrapResult(maintenanceService.getReferentiel(orgId)),
    enabled: !!orgId,
    staleTime: 30_000,
    refetchInterval,
  });
}

/** @param {string} orgId @param {{ refetchInterval?: number|false }} [opts] */
export function useMaintenanceDerniersLogs(orgId, { refetchInterval = false } = {}) {
  return useQuery({
    queryKey: maintenanceKeys.derniersLogs(orgId),
    queryFn: () => unwrapResult(maintenanceService.getDerniersLogs(orgId)),
    enabled: !!orgId,
    staleTime: 15_000,
    refetchInterval,
  });
}

/**
 * Journal filtré (suivi, historique, registre).
 * @param {string} orgId
 * @param {{ depuis?: string, jusqua?: string, unitId?: string, taskId?: string, operatorId?: string, status?: string }} filtres
 * @param {{ refetchInterval?: number|false }} [opts]
 */
export function useMaintenanceLogs(orgId, filtres, { refetchInterval = false } = {}) {
  return useQuery({
    queryKey: maintenanceKeys.logs(orgId, filtres),
    queryFn: () => unwrapResult(maintenanceService.getLogs(orgId, filtres)),
    enabled: !!orgId,
    staleTime: 15_000,
    refetchInterval,
  });
}

/** @param {string} orgId */
export function useMaintenanceClientsCount(orgId) {
  return useQuery({
    queryKey: maintenanceKeys.clientsCount(orgId),
    queryFn: () => unwrapResult(maintenanceService.countClients(orgId)),
    enabled: !!orgId,
  });
}

/** Mutations de paramétrage et de réalisation — invalident tout le cache maintenance de l'org. */
export function useMaintenanceMutations(orgId) {
  const qc = useQueryClient();
  const invalider = () => qc.invalidateQueries({ queryKey: maintenanceKeys.all(orgId) });
  const opts = { onSuccess: invalider };

  const saveUnit = useMutation({ mutationFn: (unit) => unwrapResult(maintenanceService.saveUnit(orgId, unit)), ...opts });
  const setUnitArchived = useMutation({
    mutationFn: ({ id, archived }) => unwrapResult(maintenanceService.setUnitArchived(orgId, id, archived)), ...opts,
  });
  const saveTask = useMutation({ mutationFn: (task) => unwrapResult(maintenanceService.saveTask(orgId, task)), ...opts });
  const setTaskArchived = useMutation({
    mutationFn: ({ id, archived }) => unwrapResult(maintenanceService.setTaskArchived(orgId, id, archived)), ...opts,
  });
  const saveOperator = useMutation({ mutationFn: (op) => unwrapResult(maintenanceService.saveOperator(orgId, op)), ...opts });
  const setOperatorPin = useMutation({
    mutationFn: ({ id, pin }) => unwrapResult(maintenanceService.setOperatorPin(id, pin)), ...opts,
  });
  const unlockOperator = useMutation({ mutationFn: (id) => unwrapResult(maintenanceService.unlockOperator(id)), ...opts });
  const recordCompletion = useMutation({
    mutationFn: (payload) => unwrapResult(maintenanceService.recordCompletion(payload)), ...opts,
  });

  return { saveUnit, setUnitArchived, saveTask, setTaskArchived, saveOperator, setOperatorPin, unlockOperator, recordCompletion };
}
