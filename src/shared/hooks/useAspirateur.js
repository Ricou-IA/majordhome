/**
 * useAspirateur.js — Aspirateur de sites fournisseurs sur la fiche fournisseur
 * ============================================================================
 * État de la recette du site, dernier travail (suivi toutes les 5 s tant qu'il est en cours), propositions à valider,
 * et gestes (lancer, confirmer / rejeter la recette, appliquer / écarter, réglages). Mutations déballées par
 * unwrapResult : mutateAsync REJETTE sur une erreur, l'appelant fait try/catch + toast.
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aspirateurService } from '@services/aspirateur.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { aspirateurKeys, supplierKeys } from './cacheKeys';

export { aspirateurKeys };

const LOT_APPLICATION = 100;

export function useAspirateur(orgId, supplier) {
  const qc = useQueryClient();
  const supplierId = supplier?.id;
  const siteUrl = supplier?.site_url || null;

  const etatQ = useQuery({
    queryKey: aspirateurKeys.etat(orgId, supplierId, siteUrl),
    queryFn: () => unwrapResult(aspirateurService.getEtat(orgId, siteUrl)),
    enabled: !!orgId && !!supplierId && !!siteUrl,
    staleTime: 30_000,
  });

  const travailQ = useQuery({
    queryKey: aspirateurKeys.travail(orgId, supplierId),
    queryFn: () => unwrapResult(aspirateurService.getDernierTravail(orgId, supplierId)),
    enabled: !!orgId && !!supplierId,
    refetchInterval: (q) => (q.state.data?.statut === 'en_cours' ? 5_000 : false),
  });

  const propositionsQ = useQuery({
    queryKey: aspirateurKeys.propositions(orgId, supplierId),
    queryFn: () => unwrapResult(aspirateurService.getPropositions(orgId, supplierId)),
    enabled: !!orgId && !!supplierId,
  });

  const rafraichir = () => qc.invalidateQueries({ queryKey: aspirateurKeys.all(orgId) });

  const lancer = useMutation({
    mutationFn: (champs) => unwrapResult(aspirateurService.lancer(orgId, supplierId, champs)),
    onSettled: rafraichir,
  });
  const confirmerRecette = useMutation({
    mutationFn: ({ aspirationId, champs }) => unwrapResult(aspirateurService.confirmerRecette(orgId, aspirationId, champs)),
    onSettled: rafraichir,
  });
  const rejeterRecette = useMutation({
    mutationFn: (aspirationId) => unwrapResult(aspirateurService.rejeterRecette(orgId, aspirationId)),
    onSettled: rafraichir,
  });
  const appliquer = useMutation({
    // Découpé par lots de 100 (plafond de l'edge) ; les échecs de chaque lot sont cumulés.
    mutationFn: async (ids) => {
      let appliquees = 0;
      const echecs = [];
      for (let i = 0; i < ids.length; i += LOT_APPLICATION) {
        const r = await unwrapResult(aspirateurService.appliquer(orgId, supplierId, ids.slice(i, i + LOT_APPLICATION)));
        appliquees += r?.appliquees ?? 0;
        echecs.push(...(r?.echecs ?? []));
      }
      return { appliquees, echecs };
    },
    onSettled: () => {
      rafraichir();
      qc.invalidateQueries({ queryKey: supplierKeys.all(orgId) });
    },
  });
  const ecarter = useMutation({
    mutationFn: (ids) => unwrapResult(aspirateurService.ecarter(orgId, ids)),
    onSettled: rafraichir,
  });
  const enregistrerReglages = useMutation({
    mutationFn: (reglages) => unwrapResult(aspirateurService.enregistrerReglages(supplier, reglages)),
    onSettled: () => qc.invalidateQueries({ queryKey: supplierKeys.all(orgId) }),
  });

  return {
    etat: etatQ.data ?? undefined,
    etatEnErreur: etatQ.isError,
    travail: travailQ.data ?? null,
    isLoadingTravail: travailQ.isLoading,
    propositions: propositionsQ.data,
    propositionsEnErreur: propositionsQ.isError,
    lancer, confirmerRecette, rejeterRecette, appliquer, ecarter, enregistrerReglages,
  };
}
