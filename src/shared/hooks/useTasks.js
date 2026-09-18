import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { tasksService } from '@services/tasks.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { taskKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

export { taskKeys };

export function useTasks(orgId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: taskKeys.list(orgId),
    queryFn: async () => {
      const { data, error } = await tasksService.getTasks({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 15_000,
  });

  return {
    tasks: data || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

export function useArchivedTasks(orgId, enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: taskKeys.archived(orgId),
    queryFn: async () => {
      const { data, error } = await tasksService.getArchivedTasks({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && enabled,
    staleTime: 30_000,
  });

  return {
    tasks: data || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// Contrat unique des mutations : `mutateAsync` résout avec la donnée et REJETTE
// sur refus (unwrapResult) — l'appelant fait try/catch + toast, jamais de
// lecture de { error }.

export function useTaskMutations() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const invalidateTasks = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: taskKeys.all(orgId) });
  }, [queryClient, orgId]);

  const createMutation = useMutation({
    mutationFn: (data) => unwrapResult(tasksService.createTask(data)),
    onSuccess: invalidateTasks,
  });

  const updateMutation = useMutation({
    mutationFn: ({ taskId, updates }) => unwrapResult(tasksService.updateTask(taskId, updates)),
    onSuccess: invalidateTasks,
  });

  const doneMutation = useMutation({
    mutationFn: (taskId) => unwrapResult(tasksService.markAsDone(taskId)),
    onSuccess: invalidateTasks,
  });

  const archiveMutation = useMutation({
    mutationFn: (taskId) => unwrapResult(tasksService.archiveTask(taskId)),
    onSuccess: invalidateTasks,
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId) => unwrapResult(tasksService.deleteTask(taskId)),
    onSuccess: invalidateTasks,
  });

  return {
    createTask: createMutation.mutateAsync,
    updateTask: useCallback((taskId, updates) => updateMutation.mutateAsync({ taskId, updates }), [updateMutation]),
    markAsDone: doneMutation.mutateAsync,
    archiveTask: archiveMutation.mutateAsync,
    deleteTask: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    invalidate: invalidateTasks,
  };
}

export function useTaskNotes(taskId) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { data, isLoading, refetch } = useQuery({
    queryKey: taskKeys.notes(orgId, taskId),
    queryFn: async () => {
      const { data, error } = await tasksService.getNotes(taskId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!taskId,
    staleTime: 10_000,
  });

  const invalidateNotes = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: taskKeys.notes(orgId, taskId) });
  }, [queryClient, taskId, orgId]);

  const addMutation = useMutation({
    mutationFn: (content) => unwrapResult(tasksService.addNote(taskId, content)),
    onSuccess: invalidateNotes,
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId) => unwrapResult(tasksService.deleteNote(noteId)),
    onSuccess: invalidateNotes,
  });

  return {
    notes: data || [],
    isLoading,
    refresh: refetch,
    addNote: addMutation.mutateAsync,
    deleteNote: deleteMutation.mutateAsync,
    isAdding: addMutation.isPending,
  };
}
