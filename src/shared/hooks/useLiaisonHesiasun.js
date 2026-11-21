// src/shared/hooks/useLiaisonHesiasun.js
// Liaison Majord'home → HésiaSun : état lu dans les réglages de l'organisation (settings.hesiasun, écrit par
// l'edge seulement), gestes par l'edge `hesiasun-identite`. Règles : @/lib/organisation/liaisonHesiasun.
import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { hesiasunLiaisonService } from '@services/hesiasunLiaison.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { lireEtatLiaison, messageLiaison, ruptureConnue } from '@/lib/organisation/liaisonHesiasun';
import { useOrgSettings } from './useOrgSettings';
import { orgSettingsKeys } from './cacheKeys';

export function useLiaisonHesiasun() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();
  const { settings } = useOrgSettings();

  const etat = useMemo(() => lireEtatLiaison(settings), [settings]);
  const rompueLe = useMemo(() => ruptureConnue(settings), [settings]);

  // L'edge écrit l'état en base, succès ou refus : les réglages se relisent dans les deux cas.
  const onSettled = () => qc.invalidateQueries({ queryKey: orgSettingsKeys.byOrg(orgId) });
  const relier = useMutation({ mutationFn: async (cle) => unwrapResult(await hesiasunLiaisonService.relier(orgId, cle)), onSettled });
  const comparer = useMutation({ mutationFn: async () => unwrapResult(await hesiasunLiaisonService.comparer(orgId)) });
  const pousser = useMutation({ mutationFn: async () => unwrapResult(await hesiasunLiaisonService.pousser(orgId)), onSettled });
  const delier = useMutation({ mutationFn: async () => unwrapResult(await hesiasunLiaisonService.delier(orgId)), onSettled });

  /**
   * À appeler après un enregistrement réussi de l'identité ou des coordonnées : envoie à HésiaSun si la liaison
   * est ouverte. L'enregistrement dans Majord'home n'échoue jamais à cause de HésiaSun : un refus se dit.
   */
  const pousserAsync = pousser.mutateAsync;
  const ouverte = etat?.ouverte === true;
  const envoyerApresEnregistrement = useCallback(async () => {
    if (!ouverte) return;
    try {
      await pousserAsync();
    } catch (err) {
      toast.warning(`Enregistré dans Majord’home ; HésiaSun n’a pas reçu la mise à jour. ${messageLiaison(err.message, err.champs)}`);
    }
  }, [ouverte, pousserAsync]);

  return {
    etat,
    rompueLe,
    relier: relier.mutateAsync,
    comparer: comparer.mutateAsync,
    pousser: pousserAsync,
    delier: delier.mutateAsync,
    enCours: relier.isPending || comparer.isPending || pousser.isPending || delier.isPending,
    envoyerApresEnregistrement,
  };
}
