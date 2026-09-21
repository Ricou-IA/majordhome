/**
 * useAppointments.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la gestion du planning et des rendez-vous.
 *
 * @version 1.0.0 - Sprint 2 Planning
 * @version 1.1.0 - Contrat unique des mutations : mutateAsync résout avec la
 *   donnée et REJETTE sur refus (unwrapResult) — l'appelant fait try/catch +
 *   toast, jamais de lecture de { error }.
 * ============================================================================
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsService } from '@services/appointments.service';
import { auditService } from '@services/audit.service';
import { supabase } from '@/lib/supabaseClient';
import { getMajordhomeOrgId, unwrapResult } from '@/lib/serviceHelpers';
import { appointmentKeys, leadKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { construireReglages } from '@/lib/tournee/reglages.js';
import { useLeadCommercials } from '@hooks/useLeads';
import {
  buildPersonColorMaps, buildTeamList, expandAppointmentBlocks, estAdaptable, fenetreDe,
  matchesKindFilter, matchesMemberFilter,
} from '@/lib/planningEvents';

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
  // Souplesse par défaut de l'org (RDV sans time_flex_minutes) et demi-journées.
  const { settings: orgSettings } = useOrgSettings();
  const reglages = useMemo(() => construireReglages(orgSettings), [orgSettings]);
  const [filters, setFilters] = useState({
    kinds: { intervention: true, commercial: true }, // 2 toggles (les 2 ON = vue globale)
    memberProfileKeys: [],                            // chips équipe (humains, dédup par profile_key)
    appointmentType: null,
    status: null,
    // Bandes de tolérance (souplesse) : sur demande — sur une semaine chargée,
    // une bande derrière chaque RDV noyait le planning (vécu 2026-09-12).
    showTolerance: false,
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
    queryKey: appointmentKeys.technicians(orgId, appointmentIds),
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

  // Membres + commerciaux (caches partagés avec Planning) → maps couleur + teamList unifié.
  const { members } = useTeamMembers(orgId);
  const { commercials } = useLeadCommercials(orgId);
  const colorMaps = useMemo(() => buildPersonColorMaps({ members, commercials }), [members, commercials]);
  const teamList = useMemo(() => buildTeamList({ members, commercials }), [members, commercials]);

  // Record ids des humains sélectionnés (union team_member + commercial).
  const selectedRecordIds = useMemo(() => {
    if (!filters.memberProfileKeys.length) return null;
    const keySet = new Set(filters.memberProfileKeys);
    const ids = new Set();
    teamList.forEach((h) => { if (keySet.has(h.profileKey)) h.recordIds.forEach((id) => ids.add(id)); });
    return ids;
  }, [filters.memberProfileKeys, teamList]);

  // Convertir en events FullCalendar. Les jours d'installation sont désormais des
  // appointments `installation` natifs (Bloc B stage 4) → plus de merge chantier-slots.
  const events = useMemo(() => {
    if (!appointments) return [];

    // Enrichir chaque appointment avec ses technician_ids
    const techMap = new Map();
    if (techLinks) {
      techLinks.forEach((t) => {
        if (!techMap.has(t.appointment_id)) techMap.set(t.appointment_id, []);
        techMap.get(t.appointment_id).push(t.technician_id);
      });
    }

    const enriched = (appointments || []).map((a) => ({
      ...a,
      technician_ids: techMap.get(a.id) || [],
    }));

    const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
    const aujourdhui = new Date().toLocaleDateString('fr-CA'); // YYYY-MM-DD, fuseau local
    return enriched
      .filter((a) => matchesKindFilter(a, filters.kinds) && matchesMemberFilter(a, selectedRecordIds))
      .flatMap((a) => {
        const adaptable = estAdaptable(a, reglages.souplesse_defaut_minutes, { aujourdhui });
        const blocs = expandAppointmentBlocks(a, colorMaps, selectedRecordIds).map((b) =>
          appointmentsService.toCalendarEvent(a, { color: b.color, idSuffix: b.idSuffix, adaptable })
        );
        if (!filters.showTolerance || !adaptable || !a.scheduled_start) return blocs;
        // Bande de tolérance : « on voit toujours des blocs » — le RDV reste à son
        // heure provisoire, la bande montre jusqu'où il peut glisser. Événement de
        // fond : ni cliquable ni déplaçable (FullCalendar), même couleur, translucide.
        const f = fenetreDe(a, { flexDefaut: reglages.souplesse_defaut_minutes, demiJournee: reglages.demi_journee });
        if (!f) return blocs;
        blocs.push({
          id: `${a.id}__band`,
          start: `${a.scheduled_date}T${hhmm(f.debutMinutes)}`,
          end: `${a.scheduled_date}T${hhmm(f.finMinutes)}`,
          display: 'background',
          backgroundColor: blocs[0]?.backgroundColor,
          classNames: ['mdh-flex-band'],
          extendedProps: { id: a.id, band: true },
        });
        return blocs;
      });
  }, [appointments, techLinks, filters.kinds, filters.showTolerance, selectedRecordIds, colorMaps, reglages]);

  // Mutation : créer un RDV
  const createMutation = useMutation({
    mutationFn: (data) => unwrapResult(appointmentsService.createAppointment({ coreOrgId: orgId, ...data })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
    },
  });

  // Mutation : mettre à jour un RDV
  const updateMutation = useMutation({
    mutationFn: ({ appointmentId, updates }) =>
      unwrapResult(appointmentsService.updateAppointment(appointmentId, updates)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
      queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    },
  });

  // Mutation : déplacer un RDV (drag & drop) — le rejet sur refus déclenche le
  // rollback optimiste d'onError (mort tant que la mutation résolvait sur { error })
  const moveMutation = useMutation({
    mutationFn: ({ appointmentId, ...moveData }) =>
      unwrapResult(appointmentsService.moveAppointment(appointmentId, moveData)),
    // Optimistic update pour le drag & drop
    onMutate: async ({ appointmentId, scheduled_date, scheduled_start, scheduled_end }) => {
      await queryClient.cancelQueries({ queryKey: appointmentKeys.lists(orgId) });

      const previousData = queryClient.getQueriesData({ queryKey: appointmentKeys.lists(orgId) });

      // Mise à jour optimiste
      queryClient.setQueriesData({ queryKey: appointmentKeys.lists(orgId) }, (old) => {
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
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
      queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    },
  });

  // Mutation : annuler un RDV
  const cancelMutation = useMutation({
    mutationFn: ({ appointmentId, reason }) =>
      unwrapResult(appointmentsService.cancelAppointment(appointmentId, reason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
    },
  });

  // Mutation : supprimer un RDV
  const deleteMutation = useMutation({
    mutationFn: (appointmentId) => unwrapResult(appointmentsService.deleteAppointment(appointmentId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
      queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    },
  });

  // Mappage d'arguments (aucun try/catch : le rejet remonte à l'appelant)
  const updateAppointment = useCallback(
    (appointmentId, updates) => updateMutation.mutateAsync({ appointmentId, updates }),
    [updateMutation]
  );

  const moveAppointment = useCallback(
    (appointmentId, moveData) => moveMutation.mutateAsync({ appointmentId, ...moveData }),
    [moveMutation]
  );

  const cancelAppointment = useCallback(
    (appointmentId, reason) => cancelMutation.mutateAsync({ appointmentId, reason }),
    [cancelMutation]
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
    teamList,

    // Mutations
    createAppointment: createMutation.mutateAsync,
    updateAppointment,
    moveAppointment,
    cancelAppointment,
    deleteAppointment: deleteMutation.mutateAsync,

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
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data: appointment,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: appointmentKeys.detail(orgId, appointmentId),
    queryFn: () => appointmentsService.getAppointmentById(appointmentId),
    enabled: !!orgId && !!appointmentId,
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
// HOOK - useAppointmentAuditTrail (mouchard : écritures sur un RDV)
// ============================================================================

/**
 * Lignes brutes du journal d'audit d'un RDV (vue `majordhome_audit_log`).
 * Mise en forme côté appelant via `buildAuditEntry` (src/lib/auditTrail.js).
 */
export function useAppointmentAuditTrail(appointmentId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: appointmentKeys.audit(orgId, appointmentId),
    queryFn: () => auditService.getForRecord(orgId, 'appointments', appointmentId),
    enabled: !!orgId && !!appointmentId,
    staleTime: 0,
    select: (result) => result?.data || [],
  });

  return { rows: data || [], isLoading, error, refresh: refetch };
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
// HOOK - useSetTeamMemberColor (édition couleur planning)
// ============================================================================

/**
 * Mutation : définir la couleur planning (calendar_color) d'un membre.
 * Invalide le cache teamMembers → la liste équipe ET le planning se recolorent.
 */
export function useSetTeamMemberColor(orgId) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ teamMemberId, color }) =>
      unwrapResult(appointmentsService.setTeamMemberColor(teamMemberId, color)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.teamMembers(orgId) });
    },
  });
  return { setColor: mutation.mutateAsync, isSaving: mutation.isPending };
}

// ============================================================================
// HOOK - useSetTeamMemberRouting (budget journalier + inclusion tournées)
// ============================================================================

/**
 * Mutation unique : réglages de l'optimisation des tournées (daily_work_minutes,
 * include_in_routing) d'un membre, via la RPC combinée `team_member_set_routing_settings`
 * (patch partiel — n'envoyer que le champ qui change). Cf. JSDoc de
 * `setTeamMemberRoutingSettings` dans appointments.service.js.
 *
 * La RPC retourne la ligne post-écriture : on l'utilise pour patcher directement
 * le cache `teamMembers` (au lieu de juste invalider/refetch) — le succès n'est
 * jamais supposé (`onSuccess` ne tourne que si le service n'a pas renvoyé
 * d'erreur), et le cache reflète la valeur réellement écrite en base, pas une
 * valeur optimiste.
 */
export function useSetTeamMemberRouting(orgId) {
  const queryClient = useQueryClient();
  const teamMembersKey = appointmentKeys.teamMembers(orgId);

  const mutation = useMutation({
    mutationFn: ({ teamMemberId, dailyWorkMinutes, includeInRouting }) =>
      unwrapResult(appointmentsService.setTeamMemberRoutingSettings(teamMemberId, { dailyWorkMinutes, includeInRouting })),
    onSuccess: (row, variables) => {
      if (!row) {
        // Filet : pas de ligne retournée alors qu'il n'y a pas d'erreur (ne devrait pas arriver)
        queryClient.invalidateQueries({ queryKey: teamMembersKey });
        return;
      }
      queryClient.setQueryData(teamMembersKey, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((tm) =>
            tm.id === variables.teamMemberId
              ? {
                ...tm,
                daily_work_minutes: row.daily_work_minutes,
                include_in_routing: row.include_in_routing,
              }
              : tm
          ),
        };
      });
    },
  });

  return { setRoutingSettings: mutation.mutateAsync, isSaving: mutation.isPending };
}

// ============================================================================
// HOOK - useEnsureTeamMember (ressource planning d'un membre)
// ============================================================================

/**
 * Mutation : garantit la ressource planning (team_member) d'un membre d'org.
 * Idempotent — appelée automatiquement quand un membre n'en a pas encore
 * (invitation récente, compte créé hors app).
 */
export function useEnsureTeamMember(orgId) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ userId, color }) =>
      unwrapResult(appointmentsService.ensureTeamMemberForUser({ coreOrgId: orgId, userId, color })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.teamMembers(orgId) });
    },
  });
  return { ensureTeamMember: mutation.mutateAsync, isEnsuring: mutation.isPending };
}

// ============================================================================
// HOOK - useTeamDayAvailability (dispo d'un jour par membre)
// ============================================================================

/**
 * RDV d'un jour (avec technician_ids) pour alimenter les colonnes par membre
 * du DayResourceGrid / SchedulingAssistant.
 */
export function useTeamDayAvailability(orgId, date) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: appointmentKeys.dayAvailability(orgId, date),
    queryFn: async () => {
      const { data, error } = await appointmentsService.getTeamDayAvailability({ coreOrgId: orgId, date });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!date,
    staleTime: 15_000,
  });
  return { dayAppointments: data || [], isLoading, error, refresh: refetch };
}

// ============================================================================
// HOOK - useChantierAppointments (jours d'installation d'un chantier)
// ============================================================================

/**
 * Appointments d'installation d'un chantier (lead_id), triés par date puis début.
 * Exclut annulés/no_show.
 */
export function useChantierAppointments(orgId, leadId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: appointmentKeys.chantier(orgId, leadId),
    queryFn: async () => {
      const mhOrg = await getMajordhomeOrgId(orgId);
      const { data, error } = await supabase
        .from('majordhome_appointments')
        .select('*')
        .eq('org_id', mhOrg)
        .eq('lead_id', leadId)
        .eq('appointment_type', 'installation')
        .not('status', 'in', '(cancelled,no_show)')
        .order('scheduled_date', { ascending: true })
        .order('scheduled_start', { ascending: true });
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) return rows;
      // Techniciens par RDV (vue miroir simple = pas d'agrégat : 2ᵉ requête + merge,
      // même pattern que getTeamDayAvailability). Sert au badge « 1/2 pers. » de la
      // commande d'installation.
      const { data: techLinks, error: techError } = await supabase
        .from('majordhome_appointment_technicians')
        .select('appointment_id, technician_id')
        .in('appointment_id', rows.map((r) => r.id));
      if (techError) throw techError;
      const byAppt = new Map();
      (techLinks || []).forEach((t) => {
        const arr = byAppt.get(t.appointment_id) || [];
        arr.push(t.technician_id);
        byAppt.set(t.appointment_id, arr);
      });
      return rows.map((r) => ({ ...r, technician_ids: byAppt.get(r.id) || [] }));
    },
    enabled: !!orgId && !!leadId,
    staleTime: 15_000,
  });
  return { appointments: data || [], isLoading, error, refresh: refetch };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useAppointments;
