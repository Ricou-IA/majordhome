/**
 * useGoogleCalendar.js — Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la connexion Google Calendar.
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { googleCalendarService } from '@services/googleCalendar.service';
import { googleCalendarKeys } from './cacheKeys';

/**
 * Hook to check if the current user has connected Google Calendar
 */
export function useGoogleCalendarStatus(orgId) {
  const query = useQuery({
    queryKey: googleCalendarKeys.status(orgId),
    queryFn: () => googleCalendarService.getConnectionStatus(orgId),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: 1,
  });

  return {
    isConnected: query.data?.connected ?? false,
    googleEmail: query.data?.google_email ?? null,
    connectedAt: query.data?.connected_at ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to connect/disconnect Google Calendar
 */
export function useGoogleCalendarConnection(orgId) {
  const queryClient = useQueryClient();

  const connectMutation = useMutation({
    mutationFn: () => googleCalendarService.connectGoogle(orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: googleCalendarKeys.status(orgId) });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => googleCalendarService.disconnect(orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: googleCalendarKeys.status(orgId) });
    },
  });

  return {
    connect: connectMutation.mutateAsync,
    disconnect: disconnectMutation.mutateAsync,
    isConnecting: connectMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
  };
}
