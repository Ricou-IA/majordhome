/**
 * useSavProjet.js — une demande SAV reliée à un projet (devis de remplacement)
 * ============================================================================
 * Règles : src/lib/savProjet.js · I/O : savProjet.service.js.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { savProjetService } from '@services/savProjet.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { entretienSavKeys, pennylaneKeys } from '@hooks/cacheKeys';
import { useQuotesExplorerData } from '@hooks/usePennylane';
import { propositionRemplacement } from '@/lib/savProjet';

const AUCUN_PROJET = Object.freeze({ chantiers: [], cartes: [] });

/**
 * État du pipeline pour les leads reliés à des cartes SAV.
 * @param {string} orgId
 * @param {string[]} leadIds
 * @returns {{ etats: ({ chantiers: Array, cartes: Array } | undefined), isLoading: boolean, error: (Error|null) }}
 *   `etats` indéfini tant que la lecture n'a pas abouti (chargement, échec) : `etatProjet` rend alors « inconnu »
 */
export function useEtatsProjets(orgId, leadIds) {
  const ids = useMemo(() => [...new Set((leadIds || []).filter(Boolean))].sort(), [leadIds]);
  const { data, isLoading, error } = useQuery({
    queryKey: entretienSavKeys.projets(orgId, ids),
    queryFn: () => unwrapResult(savProjetService.getEtats({ orgId, leadIds: ids })),
    enabled: !!orgId && ids.length > 0,
    staleTime: 30_000,
  });
  // Aucun lead relié : rien à lire, listes vides connues (même objet à chaque rendu).
  const etats = ids.length === 0 ? AUCUN_PROJET : (data || undefined);
  return { etats, isLoading, error: error || null };
}

/**
 * Devis Pennylane du client d'une carte SAV qui ne sont rattachés à aucun lead, et projet
 * existant s'il y en a un. Lecture du miroir local, jamais de Pennylane en direct.
 * @param {{ item: object, enabled?: boolean }} params
 * @returns {{ orphelins: Array<object>, projet: (object|null), connu: boolean, isLoading: boolean, error: (Error|null) }}
 *   `connu` faux (chargement, échec) ⇒ ne rien proposer ni dire « aucun devis »
 */
export function useDevisDeRemplacement({ item, enabled = true }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const clientId = item?.client_id || null;
  const actif = enabled && !!orgId && !!clientId;

  const miroir = useQuotesExplorerData({ enabled: actif });
  const customers = useQuery({
    queryKey: pennylaneKeys.clientCustomers(orgId, clientId),
    queryFn: () => unwrapResult(savProjetService.getCustomerIds({ orgId, clientId })),
    enabled: actif,
    staleTime: 60_000,
  });

  const nomClient = item?.client_name
    || `${item?.client_last_name || ''} ${item?.client_first_name || ''}`.trim();
  const connu = actif && !!miroir.data && Array.isArray(customers.data);
  const proposition = useMemo(
    () => (connu
      ? propositionRemplacement({
        quotes: miroir.data.rows,
        linkByQuoteId: miroir.data.linkByQuoteId,
        dismissedIds: miroir.data.dismissedIds,
        customerIds: customers.data,
        nomClient,
      })
      : { orphelins: [], projet: null }),
    [connu, miroir.data, customers.data, nomClient],
  );

  return {
    ...proposition,
    connu,
    isLoading: actif && (miroir.isLoading || customers.isLoading),
    error: miroir.error || customers.error || null,
  };
}

/**
 * Relier ou délier une carte SAV et un lead. `mutateAsync` rejette sur refus.
 * @returns {{ lier: (interventionId: string, leadId: (string|null)) => Promise<object>, isPending: boolean }}
 */
export function useLierProjetSav() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;
  const mutation = useMutation({
    mutationFn: ({ interventionId, leadId }) => unwrapResult(savProjetService.lier({ interventionId, leadId })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
    },
  });
  return {
    lier: (interventionId, leadId) => mutation.mutateAsync({ interventionId, leadId }),
    isPending: mutation.isPending,
  };
}
