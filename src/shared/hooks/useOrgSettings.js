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
 *
 * AuthContext utilise useState local (pas React Query) pour l'organization,
 * on appelle donc refreshUserData() après save pour rafraîchir l'objet
 * organization de AuthContext (consommé partout via useAuth().organization.settings,
 * notamment par buildCompanyInfo dans les PDFs/emails).
 */
export function useOrgSettings() {
  const { organization, refreshUserData } = useAuth();
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
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: orgSettingsKeys.byOrg(orgId) });
      // AuthContext gère organization en useState local — refresh manuel
      // pour que useAuth().organization.settings reflète les nouvelles valeurs
      // (consommé par buildCompanyInfo, getMapDefaultCenter, etc.)
      await refreshUserData();
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

/**
 * Sélecteur : l'org courante a-t-elle l'intégration Pennylane activée ?
 *
 * Source : `core.organizations.settings.pennylane.enabled` (toggle posé via
 * la spec bridge Pennylane PR 2 — UI future via /settings/integrations).
 *
 * Consommé par QuoteCandidatesModal (PR 4) et MarkWonQuoteModal (PR 5) pour
 * brancher conditionnellement les nouvelles modales du bridge Pipeline ↔ PL.
 * Si false (ou absent) : flow MDH actuel intégral, pas de bridge.
 */
export function usePennylaneEnabled() {
  const { settings } = useOrgSettings();
  return Boolean(settings?.pennylane?.enabled);
}
