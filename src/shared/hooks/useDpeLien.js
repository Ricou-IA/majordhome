import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dpeLienService } from '@services/dpeLien.service';
import { unwrapResult } from '@lib/serviceHelpers';
import { numeroDpeValide } from '@lib/dpeLien';
import { clientKeys, dpeLienKeys } from './cacheKeys';

/**
 * Logement MonsieurDPE d'un client : la ligne `client_dpe` (DPE rattaché + carte), l'accès au rapport, et les gestes.
 *
 * Toute mutation qui rend une ligne met à jour le cache de la ligne ET `clients.dpe_number` dans le cache de la
 * fiche (l'edge l'a écrit en base dans la même transaction) : sans ça, la fiche verrait un écart entre son numéro
 * et la ligne et redemanderait une actualisation inutile. Les mutations REJETTENT avec le code d'erreur de l'edge
 * en `message` (contrat unwrapResult).
 *
 * @param {{ orgId?: string, clientId?: string, actif?: boolean }} p
 */
export function useDpeLien({ orgId, clientId, actif = true }) {
  const queryClient = useQueryClient();
  const enabled = !!orgId && !!clientId && actif;

  const ligneQuery = useQuery({
    queryKey: dpeLienKeys.client(orgId, clientId),
    queryFn: () => unwrapResult(dpeLienService.getClientDpe(orgId, clientId)),
    enabled,
    staleTime: 60_000,
  });
  const ligne = ligneQuery.data ?? null;
  const numero = (ligne?.dpe_number || '').trim();

  const accesQuery = useQuery({
    queryKey: dpeLienKeys.acces(orgId, numero),
    queryFn: () => unwrapResult(dpeLienService.getAcces(orgId, numero)),
    enabled: enabled && numeroDpeValide(numero),
    staleTime: 5 * 60_000,
  });

  const appliquerLigne = (nouvelle) => {
    if (!nouvelle || typeof nouvelle !== 'object' || !('client_id' in nouvelle)) return;
    queryClient.setQueryData(dpeLienKeys.client(orgId, clientId), nouvelle);
    queryClient.setQueryData(clientKeys.detail(orgId, clientId), (old) =>
      old?.data ? { ...old, data: { ...old.data, dpe_number: nouvelle.dpe_number ?? null } } : old);
    queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
  };

  const rattacher = useMutation({
    mutationFn: () => unwrapResult(dpeLienService.rattacher(orgId, clientId)),
    onSuccess: appliquerLigne,
  });
  const choisir = useMutation({
    mutationFn: ({ numero, voisinage = false }) => unwrapResult(dpeLienService.choisir(orgId, clientId, { numero, voisinage })),
    onSuccess: appliquerLigne,
  });
  const detacher = useMutation({
    mutationFn: () => unwrapResult(dpeLienService.detacher(orgId, clientId)),
    onSuccess: appliquerLigne,
  });
  const actualiser = useMutation({
    mutationFn: () => unwrapResult(dpeLienService.actualiser(orgId, clientId)),
    onSuccess: appliquerLigne,
  });

  const ouvrir = useMutation({
    mutationFn: (extra) => unwrapResult(dpeLienService.ouvrir(orgId, clientId, extra)),
    onSuccess: (data) => {
      if (data?.numero) queryClient.invalidateQueries({ queryKey: dpeLienKeys.acces(orgId, data.numero) });
    },
  });
  const envoyer = useMutation({
    mutationFn: () => unwrapResult(dpeLienService.envoyer(orgId, clientId)),
    onSuccess: (data) => {
      if (data?.numero) queryClient.invalidateQueries({ queryKey: dpeLienKeys.acces(orgId, data.numero) });
    },
  });

  return {
    ligne,
    ligneChargee: ligneQuery.isSuccess,
    ligneErreur: ligneQuery.isError,
    acces: accesQuery.data ?? null,
    rattacher: rattacher.mutateAsync,
    choisir: choisir.mutateAsync,
    detacher: detacher.mutateAsync,
    actualiser: actualiser.mutateAsync,
    ouvrir: ouvrir.mutateAsync,
    envoyer: envoyer.mutateAsync,
    enCours: rattacher.isPending || choisir.isPending || detacher.isPending || actualiser.isPending,
    isOpening: ouvrir.isPending,
    isSending: envoyer.isPending,
  };
}
