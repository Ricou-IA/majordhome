/**
 * useOffresFournisseur.js — Offre de prix fournisseur (PDF) : lecture IA, rapprochement, écriture au catalogue
 * ============================================================================
 * Contrat unique des mutations : `mutateAsync` résout avec la donnée et REJETTE sur refus (unwrapResult) —
 * l'appelant fait try/catch + toast. L'écriture au catalogue invalide les familles articles et fournisseurs.
 * ============================================================================
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offresFournisseurService } from '@services/offresFournisseur.service';
import { rapprocherLigne } from '@/lib/catalogue/offreRapprochement.js';
import { unwrapResult } from '@/lib/serviceHelpers';
import { catalogItemKeys, supplierKeys } from '@hooks/cacheKeys';

/** Lecture du PDF, écriture au catalogue, articles par ids. */
export function useOffreFournisseurMutations(orgId) {
  const queryClient = useQueryClient();
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: catalogItemKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: supplierKeys.all(orgId) });
  }, [queryClient, orgId]);

  const extraire = useMutation({ mutationFn: (file) => unwrapResult(offresFournisseurService.extraire(orgId, file)) });
  const appliquer = useMutation({
    mutationFn: ({ supplierId, offre, lignes }) => unwrapResult(offresFournisseurService.appliquer(orgId, supplierId, offre, lignes)),
    onSuccess: invalidate,
  });
  return {
    extraire: (file) => extraire.mutateAsync(file),
    isExtracting: extraire.isPending,
    appliquer: (supplierId, offre, lignes) => appliquer.mutateAsync({ supplierId, offre, lignes }),
    isApplying: appliquer.isPending,
    articles: (ids) => unwrapResult(offresFournisseurService.articles(orgId, ids)),
  };
}

/**
 * Rapprochement de chaque ligne de l'offre (offreRapprochement.rapprocherLigne) pour le fournisseur choisi.
 * @returns {{ rapprochements: Array<ReturnType<typeof rapprocherLigne>>|null, isLoading: boolean, error: unknown }}
 */
export function useOffreRapprochement(orgId, supplierId, lignes) {
  const refsKey = useMemo(() => (lignes || []).map((l) => `${l.code || ''}|${l.ref_fabricant || ''}|${l.designation}`).join('¤'), [lignes]);
  const { data, isLoading, error } = useQuery({
    queryKey: catalogItemKeys.offre(orgId, supplierId, refsKey),
    queryFn: () => unwrapResult(offresFournisseurService.rapprochement(orgId, supplierId, lignes)),
    enabled: !!orgId && (lignes || []).length > 0,
    staleTime: 30_000,
  });
  const rapprochements = useMemo(() => (data ? (lignes || []).map((l) => rapprocherLigne(l, data)) : null), [data, lignes]);
  return { rapprochements, isLoading, error };
}
