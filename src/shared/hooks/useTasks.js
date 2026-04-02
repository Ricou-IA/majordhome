import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { tasksService } from '@services/tasks.service';
import { taskKeys } from '@hooks/cacheKeys';

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

export function useTaskMutations() {
  const queryClient = useQueryClient();

  const invalidateTasks = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: taskKeys.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data) => tasksService.createTask(data),
    onSuccess: invalidateTasks,
  });

  const updateMutation = useMutation({
    mutationFn: ({ taskId, updates }) => tasksService.updateTask(taskId, updates),
    onSuccess: invalidateTasks,
  });

  const doneMutation = useMutation({
    mutationFn: (taskId) => tasksService.markAsDone(taskId),
    onSuccess: invalidateTasks,
  });

  const archiveMutation = useMutation({
    mutationFn: (taskId) => tasksService.archiveTask(taskId),
    onSuccess: invalidateTasks,
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId) => tasksService.deleteTask(taskId),
    onSuccess: invalidateTasks,
  });

  return {
    createTask: useCallback((data) => createMutation.mutateAsync(data), [createMutation]),
    updateTask: useCallback((taskId, updates) => updateMutation.mutateAsync({ taskId, updates }), [updateMutation]),
    markAsDone: useCallback((taskId) => doneMutation.mutateAsync(taskId), [doneMutation]),
    archiveTask: useCallback((taskId) => archiveMutation.mutateAsync(taskId), [archiveMutation]),
    deleteTask: useCallback((taskId) => deleteMutation.mutateAsync(taskId), [deleteMutation]),
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    invalidate: invalidateTasks,
  };
}

export function useTaskNotes(taskId) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: taskKeys.notes(taskId),
    queryFn: async () => {
      const { data, error } = await tasksService.getNotes(taskId);
      if (error) throw error;
      return data;
    },
    enabled: !!taskId,
    staleTime: 10_000,
  });

  const invalidateNotes = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: taskKeys.notes(taskId) });
  }, [queryClient, taskId]);

  const addMutation = useMutation({
    mutationFn: (content) => tasksService.addNote(taskId, content),
    onSuccess: invalidateNotes,
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId) => tasksService.deleteNote(noteId),
    onSuccess: invalidateNotes,
  });

  return {
    notes: data || [],
    isLoading,
    refresh: refetch,
    addNote: useCallback((content) => addMutation.mutateAsync(content), [addMutation]),
    deleteNote: useCallback((noteId) => deleteMutation.mutateAsync(noteId), [deleteMutation]),
    isAdding: addMutation.isPending,
  };
}
