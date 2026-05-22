// src/shared/hooks/useOrgSettings.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { orgSettingsService } from '@services/orgSettings.service';
import { orgSettingsKeys } from './cacheKeys';

/**
 * Hook React Query pour les settings de l'org courante.
 * - settings : objet (vide {} si rien configuré)
 * - save(patch) : merge le patch côté DB, retourne le nouveau settings
 * - isDirty est calculé localement par chaque consumer (form values vs initial)
 */
export function useOrgSettings() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: orgSettingsKeys.byOrg(orgId),
    queryFn: async () => {
      const { data, error } = await orgSettingsService.getSettings(orgId);
      if (error) throw error;
      return data ?? {};
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (patch) => {
      const { data, error } = await orgSettingsService.updateSettings(orgId, patch);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgSettingsKeys.byOrg(orgId) });
      // Le organization du AuthContext porte les settings — invalider aussi
      qc.invalidateQueries({ queryKey: ['auth', 'organization'] });
    },
  });

  return {
    settings: query.data ?? {},
    isLoading: query.isLoading,
    error: query.error,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
