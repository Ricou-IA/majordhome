/**
 * useRapportSav.js — rapport d'intervention SAV (fenêtre de la fiche SAV).
 * `passages` : RDV de la carte et leurs techniciens ; `undefined` tant que la liste est inconnue
 * (chargement ou échec) — l'appelant ferme alors l'édition, il ne devine pas.
 * `envoyer` résout avec `{ to, noteManquante }` et REJETTE sur refus (l'erreur porte `code`).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { rapportSavService } from '@services/rapportSav.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { interventionKeys, entretienSavKeys } from '@hooks/cacheKeys';

export function useRapportSav(interventionId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();

  const { data: passages, isPending, error } = useQuery({
    queryKey: interventionKeys.rapportSav(orgId, interventionId),
    queryFn: () => unwrapResult(rapportSavService.getPassages(interventionId)),
    enabled: !!orgId && !!interventionId,
  });

  // La trace vit sur la carte : la liste du kanban (et la fiche ouverte, qui la suit) se recharge.
  const rafraichirCartes = () => queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });

  const envoi = useMutation({
    mutationFn: async () => {
      const { to } = await unwrapResult(rapportSavService.envoyer(orgId, interventionId));
      // L'e-mail est parti : une note qui échoue ne doit pas le faire passer pour un échec.
      const note = await rapportSavService.noterEnvoi(interventionId, { to });
      return { to, noteManquante: Boolean(note.error) };
    },
    onSettled: rafraichirCartes,
  });

  return {
    orgId,
    passages,
    passagesInconnus: isPending || Boolean(error),
    erreurPassages: error || null,
    rafraichirCartes,
    envoyer: envoi.mutateAsync,
    envoiEnCours: envoi.isPending,
  };
}
