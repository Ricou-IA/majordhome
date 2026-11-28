/**
 * useCatalogImports.js - Majord'home Artisan
 * ============================================================================
 * Hooks de l'import d'articles depuis un fichier : liste des imports, fournisseurs,
 * articles et lignes fournisseur existants (détection des doublons), aperçu et
 * exécution du retrait, envoi des lots (reprenable après un refus).
 *
 * Contrat des mutations : `mutateAsync` résout avec la donnée et REJETTE sur
 * refus (`unwrapResult`) ; l'appelant traduit l'erreur par `messageErreurImportArticles`.
 * ============================================================================
 */

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogImportsService } from '@services/catalogImports.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { catalogImportKeys, catalogItemKeys, supplierKeys } from '@hooks/cacheKeys';
import { decouperEnLots, executerLots, lireReponseRetrait } from '@/lib/importClients/lots';
import { messageErreurImportArticles } from '@/lib/importArticles/lots';

// Un import crée des articles et des lignes fournisseur (et parfois des fournisseurs).
function invaliderFamilles(queryClient, orgId) {
  queryClient.invalidateQueries({ queryKey: catalogImportKeys.all(orgId) });
  queryClient.invalidateQueries({ queryKey: catalogItemKeys.all(orgId) });
  queryClient.invalidateQueries({ queryKey: supplierKeys.all(orgId) });
}

/** Imports d'articles de l'entreprise, du plus récent au plus ancien. */
export function useCatalogImports(orgId) {
  const query = useQuery({
    queryKey: catalogImportKeys.list(orgId),
    queryFn: () => unwrapResult(catalogImportsService.listImports(orgId)),
    enabled: !!orgId,
  });
  return { imports: query.data, isLoading: query.isLoading, error: query.error };
}

/** Fournisseurs de l'entreprise (pour associer ceux du fichier). */
export function useCatalogImportSuppliers(orgId) {
  const query = useQuery({
    queryKey: catalogImportKeys.fournisseurs(orgId),
    queryFn: () => unwrapResult(catalogImportsService.getSuppliers(orgId)),
    enabled: !!orgId,
  });
  return { suppliers: query.data, isLoading: query.isLoading, error: query.error };
}

/**
 * Articles vivants et lignes fournisseur des fournisseurs donnés. `existant` reste `undefined` tant que la liste
 * est inconnue (chargement, rechargement, échec) : l'écran ferme l'import dans ces cas, jamais « aucun doublon ».
 * @param {string} orgId
 * @param {string[]} supplierIds
 */
export function useExistantArticles(orgId, supplierIds, { enabled = true } = {}) {
  const ids = [...new Set(supplierIds ?? [])].sort();
  const query = useQuery({
    queryKey: catalogImportKeys.existant(orgId, ids),
    queryFn: () => unwrapResult(catalogImportsService.getExistant(orgId, ids)),
    enabled: !!orgId && enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const existant = query.isSuccess && !query.isFetching ? query.data : undefined;
  return { existant, isLoading: query.isFetching, error: query.error, refetch: query.refetch };
}

/** Combien d'articles de l'import se retirent, combien sont conservés. */
export function useCatalogRemovalPreview(orgId, importId) {
  return useQuery({
    queryKey: catalogImportKeys.apercuRetrait(orgId, importId),
    queryFn: () => unwrapResult(catalogImportsService.removalPreview(importId)),
    enabled: !!orgId && !!importId,
    staleTime: 0,
  });
}

/**
 * Retire l'import par appels successifs (au plus TAILLE_LOT_RETRAIT articles chacun) jusqu'à `restantes === 0`.
 * Résout avec `{ retirees, conservees }` cumulés ; rejette sur refus ou si un appel n'avance plus.
 * Les caches sont invalidés aussi après un échec : des articles ont pu être retirés avant.
 */
export function useRetirerImportArticles(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (importId) => {
      let retirees = 0;
      let conservees = 0;
      for (;;) {
        const lot = lireReponseRetrait(await unwrapResult(catalogImportsService.remove(importId)));
        retirees += lot.retirees;
        conservees = lot.conservees;
        const restantes = lot.restantes;
        if (restantes === 0) return { retirees, conservees };
        if (lot.retirees === 0) {
          throw new Error(`Le retrait n'avance plus : ${restantes} articles restent à retirer.`);
        }
      }
    },
    onSettled: () => invaliderFamilles(queryClient, orgId),
  });
}

/**
 * Exécute un import : ouvre l'import, envoie les lots l'un après l'autre, le clôt avec son bilan.
 * `lancer({ import, lignes, depuis })` : `import` = `{ fileName, mapping, counts, fournisseurs }`, `lignes` = lignes
 * déjà contrôlées (clés de CLES_ROW_ARTICLE), `depuis` = premier lot à envoyer (0 par défaut).
 * Lignes et comptes sont gardés pour `reprendre()` (reprise au lot refusé, la base ignore les lignes déjà écrites).
 * Au départ, l'import reçoit le bilan PRÉVU ; seule la clôture écrit `importees` (articles réellement créés).
 * `abandonner()` quitte un import interrompu sans le reprendre (les articles créés restent, retirables).
 * `etat` ∈ 'repos' | 'en_cours' | 'interrompu' | 'termine'.
 * @param {string} orgId
 */
export function useExecuterImportArticles(orgId) {
  const queryClient = useQueryClient();
  const [etat, setEtat] = useState('repos');
  const [progression, setProgression] = useState({ faits: 0, total: 0 });
  const [bilan, setBilan] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [fournisseurs, setFournisseurs] = useState(null);
  const etatRef = useRef('repos'); // garde synchrone contre un second lancement
  const planRef = useRef(null);

  const changerEtat = (valeur) => {
    etatRef.current = valeur;
    setEtat(valeur);
  };

  // Des articles ont pu être créés avant l'arrêt : les caches se rechargent aussi.
  const interrompre = (e, plan) => {
    setErreur(messageErreurImportArticles(e));
    changerEtat('interrompu');
    invaliderFamilles(queryClient, plan.orgId);
  };

  const executer = async (plan) => {
    if (!plan.lotsEnvoyes) {
      const r = await executerLots({
        lots: plan.lots,
        depuis: plan.prochain,
        envoyer: async (lot) => {
          const rendu = await unwrapResult(catalogImportsService.batch({ importId: plan.importId, rows: lot }));
          if (!rendu) throw new Error('Réponse vide de la base pour un lot.');
          plan.created += rendu.created ?? 0;
          plan.skipped += rendu.skipped ?? 0;
          plan.lignesFournisseur += rendu.lignes_fournisseur ?? 0;
          setProgression({ faits: plan.created + plan.skipped, total: plan.total });
          // Par lot : liste des imports, articles et fournisseurs seulement (pas `existant`, relu en entier à chaque fois).
          queryClient.invalidateQueries({ queryKey: catalogImportKeys.list(plan.orgId) });
          queryClient.invalidateQueries({ queryKey: catalogItemKeys.all(plan.orgId) });
          queryClient.invalidateQueries({ queryKey: supplierKeys.all(plan.orgId) });
          return rendu;
        },
      });
      plan.prochain = r.prochain;
      if (r.erreur) return interrompre(r.erreur, plan);
      plan.lotsEnvoyes = true;
    }
    const final = {
      ...plan.counts,
      importees: plan.created + plan.skipped,
      lignes_fournisseur: plan.lignesFournisseur,
    };
    try {
      await unwrapResult(catalogImportsService.finish({ importId: plan.importId, counts: final }));
    } catch (e) {
      return interrompre(e, plan);
    }
    setBilan({ ...final, prevues: plan.total });
    changerEtat('termine');
    invaliderFamilles(queryClient, plan.orgId);
  };

  const lancer = useCallback(async ({ import: ouverture, lignes, depuis = 0 }) => {
    if (etatRef.current === 'en_cours' || etatRef.current === 'interrompu') return;
    changerEtat('en_cours');
    setErreur(null);
    setBilan(null);
    let plan = null;
    try {
      if (!lignes || lignes.length === 0) {
        setErreur('Aucun article à importer.');
        changerEtat('repos');
        return;
      }
      setProgression({ faits: 0, total: lignes.length });
      const ouvert = await unwrapResult(catalogImportsService.start({
        orgId,
        fileName: ouverture.fileName,
        mapping: ouverture.mapping,
        counts: ouverture.counts,
        fournisseurs: ouverture.fournisseurs,
      }));
      if (!ouvert?.import_id) throw new Error("La base n'a pas rendu d'identifiant d'import.");
      setFournisseurs(ouvert.fournisseurs ?? []);
      plan = {
        orgId, importId: ouvert.import_id, counts: ouverture.counts, total: lignes.length,
        lots: decouperEnLots(lignes), prochain: depuis, created: 0, skipped: 0, lignesFournisseur: 0, lotsEnvoyes: false,
      };
      planRef.current = plan;
      await executer(plan);
    } catch (e) {
      // Avant l'ouverture de l'import : rien à reprendre ; après : reprise possible.
      if (plan) interrompre(e, plan);
      else {
        setErreur(messageErreurImportArticles(e));
        changerEtat('repos');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const reprendre = useCallback(async () => {
    const plan = planRef.current;
    if (etatRef.current !== 'interrompu' || !plan) return;
    changerEtat('en_cours');
    setErreur(null);
    try {
      await executer(plan);
    } catch (e) {
      interrompre(e, plan);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrêter sans reprendre : le plan est oublié, les listes se relisent.
  const abandonner = useCallback(() => {
    const plan = planRef.current;
    if (etatRef.current !== 'interrompu') return;
    planRef.current = null;
    setErreur(null);
    changerEtat('repos');
    if (plan) invaliderFamilles(queryClient, plan.orgId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { etat, progression, bilan, erreur, fournisseurs, lancer, reprendre, abandonner };
}
