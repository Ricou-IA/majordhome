import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dpeLienService } from '@services/dpeLien.service';
import { unwrapResult } from '@lib/serviceHelpers';
import { numeroDpeValide } from '@lib/dpeLien';
import { dpeLienKeys } from './cacheKeys';

/**
 * Lien MonsieurDPE sur la fiche client.
 *
 * - `acces` : l'accès au rapport complet déjà émis pour ce numéro (lecture, tout membre) ;
 * - `verification` : le numéro est-il dans le corpus ? Interrogé seulement si `peutVerifier` (droit clients.edit)
 *   et qu'aucun accès n'existe encore — un accès émis prouve déjà que le numéro est connu ;
 * - `chercher` / `ouvrir` : mutations qui REJETTENT avec le code d'erreur de l'edge function en `message`.
 *
 * @param {{ orgId?: string, clientId?: string, dpeNumber?: string, actif?: boolean, peutVerifier?: boolean }} p
 */
export function useDpeLien({ orgId, clientId, dpeNumber, actif = true, peutVerifier = false }) {
  const queryClient = useQueryClient();
  const numero = typeof dpeNumber === 'string' ? dpeNumber.trim() : '';
  const numeroOk = numeroDpeValide(numero);

  const accesQuery = useQuery({
    queryKey: dpeLienKeys.acces(orgId, numero),
    queryFn: () => unwrapResult(dpeLienService.getAcces(orgId, numero)),
    enabled: !!orgId && actif && numeroOk,
    staleTime: 5 * 60_000,
  });

  const verificationQuery = useQuery({
    queryKey: dpeLienKeys.verification(orgId, numero),
    queryFn: () => unwrapResult(dpeLienService.verifier(orgId, numero)),
    enabled: !!orgId && actif && numeroOk && peutVerifier && accesQuery.isSuccess && !accesQuery.data,
    staleTime: 60 * 60_000,
    retry: false,
  });

  const chercherMutation = useMutation({
    mutationFn: () => unwrapResult(dpeLienService.chercher(orgId, clientId)),
  });

  const ouvrirMutation = useMutation({
    mutationFn: () => unwrapResult(dpeLienService.ouvrir(orgId, clientId)),
    onSuccess: (data) => {
      if (data?.numero) queryClient.invalidateQueries({ queryKey: dpeLienKeys.acces(orgId, data.numero) });
    },
  });

  return {
    acces: accesQuery.data ?? null,
    accesInconnu: accesQuery.isLoading || accesQuery.isError,
    verification: verificationQuery.data ?? null,
    verificationErreur: verificationQuery.error ?? null,
    isVerifying: verificationQuery.isFetching,
    chercher: chercherMutation.mutateAsync,
    isSearching: chercherMutation.isPending,
    ouvrir: ouvrirMutation.mutateAsync,
    isOpening: ouvrirMutation.isPending,
  };
}
