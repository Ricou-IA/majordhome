/**
 * useClientImports.js - Majord'home Artisan
 * ============================================================================
 * Hooks de l'import des clients d'un autre logiciel : liste des imports, clients
 * existants (détection des doublons), aperçu et exécution du retrait, envoi des
 * lots (reprenable après un refus).
 *
 * Contrat des mutations : `mutateAsync` résout avec la donnée et REJETTE sur
 * refus (`unwrapResult`) ; l'appelant traduit l'erreur par `messageErreurImport`.
 * ============================================================================
 */

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientImportsService } from '@services/clientImports.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { clientKeys, clientImportKeys } from '@hooks/cacheKeys';
import { bilan as bilanImport, lignesPourEcriture } from '@/lib/importClients/controles';
import { decouperEnLots, executerLots, messageErreurImport } from '@/lib/importClients/lots';

/** Imports de l'entreprise, du plus récent au plus ancien. */
export function useClientImports(orgId) {
  return useQuery({
    queryKey: clientImportKeys.list(orgId),
    queryFn: () => unwrapResult(clientImportsService.listImports(orgId)),
    enabled: !!orgId,
  });
}

/**
 * Clients non archivés pour détecter les doublons. `clients` reste `undefined` tant que la liste est inconnue,
 * y compris quand la lecture a échoué : l'écran ferme l'import dans les deux cas (jamais une liste partielle).
 */
export function useExistingClientsForImport(orgId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: clientImportKeys.existants(orgId),
    queryFn: () => unwrapResult(clientImportsService.loadExistingClients(orgId)),
    enabled: !!orgId && enabled,
    staleTime: 0,
  });
  return { clients: query.data, isLoading: query.isLoading, error: query.error };
}

/** Combien de fiches de l'import se retirent, combien sont conservées. */
export function useRemovalPreview(orgId, importId) {
  return useQuery({
    queryKey: clientImportKeys.apercuRetrait(orgId, importId),
    queryFn: () => unwrapResult(clientImportsService.previewRemoval(importId)),
    enabled: !!orgId && !!importId,
    staleTime: 0,
  });
}

/**
 * Retire l'import par appels successifs (au plus TAILLE_LOT_RETRAIT fiches chacun) jusqu'à `restantes === 0`.
 * Résout avec `{ retirees, conservees }` cumulés ; rejette sur refus ou si un appel n'avance plus.
 * Les caches sont invalidés aussi après un échec : des fiches ont pu être retirées avant.
 */
export function useRemoveClientImport(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (importId) => {
      let retirees = 0;
      let conservees = 0;
      for (;;) {
        const lot = await unwrapResult(clientImportsService.removeBatch(importId));
        retirees += lot?.retirees ?? 0;
        conservees = lot?.conservees ?? conservees;
        const restantes = lot?.restantes ?? 0;
        if (restantes === 0) return { retirees, conservees };
        if ((lot?.retirees ?? 0) === 0) {
          throw new Error(`Le retrait n'avance plus : ${restantes} fiches restent à retirer.`);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: clientImportKeys.all(orgId) });
    },
  });
}

/**
 * Exécute un import : ouvre l'import, envoie les lots l'un après l'autre, le clôt avec son bilan.
 * Lignes et comptes sont calculés UNE fois au lancement et gardés pour `reprendre()`.
 * `etat` ∈ 'repos' | 'en_cours' | 'interrompu' | 'termine'.
 * @param {string} orgId
 */
export function useClientImportRun(orgId) {
  const queryClient = useQueryClient();
  const [etat, setEtat] = useState('repos');
  const [progression, setProgression] = useState({ faits: 0, total: 0 });
  const [bilan, setBilan] = useState(null);
  const [erreur, setErreur] = useState(null);
  const etatRef = useRef('repos'); // garde synchrone contre un second lancement
  const planRef = useRef(null);

  const changerEtat = (valeur) => {
    etatRef.current = valeur;
    setEtat(valeur);
  };

  const interrompre = (e) => {
    setErreur(messageErreurImport(e));
    changerEtat('interrompu');
  };

  // Envoie les lots restants puis clôt ; reprend là où le plan s'est arrêté.
  const executer = async () => {
    const plan = planRef.current;
    if (!plan.lotsEnvoyes) {
      const r = await executerLots({
        lots: plan.lots,
        depuis: plan.prochain,
        envoyer: async (lot) => {
          const rendu = await unwrapResult(clientImportsService.sendBatch({ importId: plan.importId, rows: lot }));
          if (!rendu) throw new Error('Réponse vide de la base pour un lot.');
          plan.created += rendu.created ?? 0;
          plan.skipped += rendu.skipped ?? 0;
          setProgression({ faits: plan.created + plan.skipped, total: plan.total });
          return rendu;
        },
      });
      plan.prochain = r.prochain;
      if (r.erreur) return interrompre(r.erreur);
      plan.lotsEnvoyes = true;
    }
    const final = {
      lues: plan.counts.lues,
      importees: plan.created + plan.skipped,
      doublons_ecartes: plan.counts.doublons_ecartes,
      ecartees: plan.counts.ecartees,
    };
    try {
      await unwrapResult(clientImportsService.finishImport({ importId: plan.importId, counts: final }));
    } catch (e) {
      return interrompre(e);
    }
    setBilan({ ...final, prevues: plan.total });
    changerEtat('termine');
    queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: clientImportKeys.all(orgId) });
  };

  const lancer = useCallback(async ({ fileName, sourceLabel, mapping, classees, choix }) => {
    if (etatRef.current === 'en_cours') return;
    changerEtat('en_cours');
    setErreur(null);
    setBilan(null);
    const rows = lignesPourEcriture(classees, choix);
    const counts = bilanImport(classees, choix);
    setProgression({ faits: 0, total: rows.length });
    let importId;
    try {
      importId = await unwrapResult(clientImportsService.startImport({ orgId, fileName, sourceLabel, mapping, counts }));
      if (!importId) throw new Error('La base n\'a pas rendu d\'identifiant d\'import.');
    } catch (e) {
      setErreur(messageErreurImport(e));
      changerEtat('repos');
      return;
    }
    planRef.current = {
      importId, counts, total: rows.length, lots: decouperEnLots(rows),
      prochain: 0, created: 0, skipped: 0, lotsEnvoyes: false,
    };
    await executer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const reprendre = useCallback(async () => {
    if (etatRef.current !== 'interrompu' || !planRef.current) return;
    changerEtat('en_cours');
    setErreur(null);
    await executer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return { etat, progression, bilan, erreur, lancer, reprendre };
}
