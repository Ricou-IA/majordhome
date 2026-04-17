/**
 * useAppointments.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la gestion du planning et des rendez-vous.
 *
 * @version 1.0.0 - Sprint 2 Planning
 * ============================================================================
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsService } from '@services/appointments.service';
import { supabase } from '@/lib/supabaseClient';
import { appointmentKeys, leadKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { appointmentKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK PRINCIPAL - useAppointments (calendrier)
// ============================================================================

/**
 * Hook pour les RDV du calendrier avec filtres
 *
 * @param {Object} options
 * @param {string} options.orgId - ID core.organizations
 * @param {string} options.startDate - Date début (YYYY-MM-DD)
 * @param {string} options.endDate - Date fin (YYYY-MM-DD)
 *
 * @returns {Object} État et méthodes
 *
 * @example
 * const { events, isLoading, createAppointment, moveAppointment } = useAppointments({
 *   orgId, startDate: '2026-02-01', endDate: '2026-02-28'
 * });
 */
export function useAppointments({ orgId, startDate, endDate } = {}) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    memberIds: [],          // IDs sélectionnés (techniciens + commerciaux)
    appointmentType: null,
    status: null,
  });

  // Query principale — récupère TOUS les RDV (filtrage membre côté client)
  const {
    data: appointments,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: appointmentKeys.list(orgId, { startDate, endDate }, { appointmentType: filters.appointmentType, status: filters.status }),
    queryFn: () =>
      appointmentsService.getAppointments({
        coreOrgId: orgId,
        startDate,
        endDate,
        appointmentType: filters.appointmentType,
        status: filters.status,
      }),
    enabled: !!orgId && !!startDate && !!endDate,
    staleTime: 15_000,
    select: (result) => result?.data || [],
  });

  // Récupérer les liens technicien ↔ RDV (pour filtrage multi-membres)
  const appointmentIds = useMemo(() => (appointments || []).map(a => a.id), [appointments]);

  const { data: techLinks } = useQuery({
    queryKey: ['appointment-technicians', appointmentIds],
    queryFn: async () => {
      if (appointmentIds.length === 0) return [];
      const { data } = await supabase
        .from('majordhome_appointment_technicians')
        .select('appointment_id, technician_id')
        .in('appointment_id', appointmentIds);
      return data || [];
    },
    enabled: appointmentIds.length > 0,
    staleTime: 15_000,
  });

  // Convertir en events FullCalendar — avec filtrage multi-membres côté client
  const events = useMemo(() => {
    if (!appointments) return [];

    // Enrichir chaque appointment avec ses technician_ids
    const techMap = new Map();
    if (techLinks) {
      techLinks.forEach(t => {
        if (!techMap.has(t.appointment_id)) techMap.set(t.appointment_id, []);
        techMap.get(t.appointment_id).push(t.technician_id);
      });
    }

    let enriched = appointments.map(a => ({
      ...a,
      technician_ids: techMap.get(a.id) || [],
    }));

    // Filtre multi-membres : techniciens (via techLinks) + commerciaux (via assigned_commercial_id)
    if (filters.memberIds.length > 0 && techLinks) {
      const memberSet = new Set(filters.memberIds);
      enriched = enriched.filter(
        a => a.technician_ids.some(id => memberSet.has(id)) || memberSet.has(a.assigned_commercial_id)
      );
    }

    return enriched.map(a => appointmentsService.toCalendarEvent(a));
  }, [appointments, filters.memberIds, techLinks]);

  // Mutation : créer un RDV
  const createMutation = useMutation({
    mutationFn: (data) => appointmentsService.createAppointment({ coreOrgId: orgId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    },
  });

  // Mutation : mettre à jour un RDV
  const updateMutation = useMutation({
    mutationFn: ({ appointmentId, updates }) =>
      appointmentsService.updateAppointment(appointmentId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });

  // Mutation : déplacer un RDV (drag & drop)
  const moveMutation = useMutation({
    mutationFn: ({ appointmentId, ...moveData }) =>
      appointmentsService.moveAppointment(appointmentId, moveData),
    // Optimistic update pour le drag & drop
    onMutate: async ({ appointmentId, scheduled_date, scheduled_start, scheduled_end }) => {
      await queryClient.cancelQueries({ queryKey: appointmentKeys.lists() });

      const previousData = queryClient.getQueriesData({ queryKey: appointmentKeys.lists() });

      // Mise à jour optimiste
      queryClient.setQueriesData({ queryKey: appointmentKeys.lists() }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map(a =>
            a.id === appointmentId
              ? { ...a, scheduled_date, scheduled_start, scheduled_end }
              : a
          ),
        };
      });

      return { previousData };
    },
    onError: (err, vars, context) => {
      // Rollback en cas d'erreur
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });

  // Mutation : annuler un RDV
  const cancelMutation = useMutation({
    mutationFn: ({ appointmentId, reason }) =>
      appointmentsService.cancelAppointment(appointmentId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    },
  });

  // Mutation : supprimer un RDV
  const deleteMutation = useMutation({
    mutationFn: (appointmentId) => appointmentsService.deleteAppointment(appointmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });

  // Helpers
  const createAppointment = useCallback(
    async (data) => {
      const result = await createMutation.mutateAsync(data);
      return result;
    },
    [createMutation]
  );

  const updateAppointment = useCallback(
    async (appointmentId, updates) => {
      const result = await updateMutation.mutateAsync({ appointmentId, updates });
      return result;
    },
    [updateMutation]
  );

  const moveAppointment = useCallback(
    async (appointmentId, moveData) => {
      const result = await moveMutation.mutateAsync({ appointmentId, ...moveData });
      return result;
    },
    [moveMutation]
  );

  const cancelAppointment = useCallback(
    async (appointmentId, reason) => {
      const result = await cancelMutation.mutateAsync({ appointmentId, reason });
      return result;
    },
    [cancelMutation]
  );

  const deleteAppointment = useCallback(
    async (appointmentId) => {
      const result = await deleteMutation.mutateAsync(appointmentId);
      return result;
    },
    [deleteMutation]
  );

  return {
    // Données
    appointments: appointments || [],
    events,
    isLoading,
    error,

    // Filtres
    filters,
    setFilters,

    // Mutations
    createAppointment,
    updateAppointment,
    moveAppointment,
    cancelAppointment,
    deleteAppointment,

    // États mutations
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isMoving: moveMutation.isPending,
    isCancelling: cancelMutation.isPending,
    isDeleting: deleteMutation.isPending,

    // Refresh
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useAppointment (détail)
// ============================================================================

/**
 * Hook pour un RDV spécifique
 */
export function useAppointment(appointmentId) {
  const {
    data: appointment,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: appointmentKeys.detail(appointmentId),
    queryFn: () => appointmentsService.getAppointmentById(appointmentId),
    enabled: !!appointmentId,
    staleTime: 30_000,
    select: (result) => result?.data || null,
  });

  return {
    appointment,
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useTeamMembers
// ============================================================================

/**
 * Hook pour les techniciens de l'organisation
 */
export function useTeamMembers(orgId) {
  const {
    data: members,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: appointmentKeys.teamMembers(orgId),
    queryFn: () => appointmentsService.getTeamMembers(orgId),
    enabled: !!orgId,
    staleTime: 60_000, // 1min — change rarement
    select: (result) => result?.data || [],
  });

  return {
    members: members || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useAppointments;
