// ============================================================================
// Coût marginal d'insertion d'un candidat dans une tournée. Module PUR.
// Testé : node --test scripts/tournee/insertion.test.mjs
//
// C'est LE critère de la spec (§3.1) : on ne demande pas « ce client est-il
// dans le bon secteur » mais « combien de minutes ajoute-t-il à la journée ».
// Comme le séquenceur est exact, la différence des deux optima est le vrai
// coût marginal — pas une estimation.
// ============================================================================

import { sequencerTournee } from './sequence.js';

/**
 * Coût marginal (en minutes) d'insertion de `candidat` dans `tourneeActuelle`.
 *
 * Précondition : `tourneeActuelle` doit déjà constituer une tournée FAISABLE
 * — c'est la référence dont on mesure l'écart. Si elle ne l'est pas, le coût
 * marginal n'a pas de sens (impossible de distinguer ce qui vient du candidat
 * de ce qui vient d'une tournée de départ déjà cassée) : la fonction le
 * signale via `raison: 'tournee_actuelle_infaisable'` plutôt que de renvoyer
 * un nombre qui absorberait silencieusement toute la charge existante.
 *
 * @param {Array} tourneeActuelle
 * @param {{ id: string, key: string, dureeMinutes: number }} candidat
 * @param {object} ctx  même forme que le paramètre de `sequencerTournee` (hors `arrets`)
 * @param {{ sequenceActuelle?: object }} [options]
 *   `sequenceActuelle` : résultat déjà calculé de
 *   `sequencerTournee({ ...ctx, arrets: tourneeActuelle })`. Permet à
 *   `classerCandidats` de calculer cette référence UNE SEULE FOIS pour tous
 *   les candidats plutôt que de la refaire à chaque appel — le solveur exact
 *   est factoriel (jusqu'à 8! = 40 320 permutations), la refaire N fois pour
 *   N candidats serait un recalcul strictement redondant puisque
 *   `tourneeActuelle` et `ctx` ne changent pas dans la boucle. Recalculée si
 *   omise : `coutInsertion` reste utilisable seule, signature inchangée.
 * @returns {{ minutes: number|null, faisable: boolean, raison: string|null, sequenceApres: object|null }}
 */
export function coutInsertion(tourneeActuelle, candidat, ctx, { sequenceActuelle } = {}) {
  const avant = sequenceActuelle ?? sequencerTournee({ ...ctx, arrets: tourneeActuelle });

  if (!avant.faisable) {
    return { minutes: null, faisable: false, raison: 'tournee_actuelle_infaisable', sequenceApres: null };
  }

  const apres = sequencerTournee({ ...ctx, arrets: [...tourneeActuelle, candidat] });

  if (!apres.faisable) {
    return { minutes: null, faisable: false, raison: apres.raison, sequenceApres: null };
  }

  return {
    minutes: apres.chargeMinutes - avant.chargeMinutes,
    faisable: true,
    raison: null,
    sequenceApres: apres,
  };
}

/**
 * Classe les candidats faisables. Le score final combine l'éligibilité
 * (maturité × saison, cf. eligibilite.js) et l'efficacité géographique :
 * un candidat très mûr mérite un détour, un candidat hors saison ne le mérite
 * pas — c'est ce qui évite de remplir une tournée avec les seuls voisins.
 *
 * La séquence de `tourneeActuelle` est calculée UNE SEULE FOIS ici puis
 * réutilisée pour chaque candidat (cf. `coutInsertion`) : `tourneeActuelle` et
 * `ctx` ne changent jamais dans cette boucle, refaire tourner le solveur
 * exact à chaque candidat serait un recalcul strictement redondant.
 *
 * @param {Array} tourneeActuelle
 * @param {Array<{ id: string, key: string, dureeMinutes: number }>} candidats
 * @param {object} ctx  même forme que le paramètre de `sequencerTournee` (hors `arrets`)
 * @param {{ scoreParId?: Record<string, number> }} [options]
 * @returns {{
 *   classement: Array<{ candidat: object, coutMinutes: number, detourMinutes: number, scoreFinal: number, sequenceApres: object }>,
 *   baseInfaisable: boolean,
 *   raisonBase: string|null,
 * }}
 *   `classement` est trié décroissant par `scoreFinal`. Le champ est nommé
 *   `classement` (pas `candidats`) précisément pour ne pas se confondre avec
 *   le paramètre d'entrée `candidats` — deux choses différentes (la liste
 *   brute en entrée vs le résultat classé en sortie).
 *
 *   `classement` est VIDE dans deux cas que le retour distingue désormais
 *   explicitement (avant, un simple commentaire JSDoc — un appelant ne lit
 *   pas la doc à l'exécution) :
 *     - `baseInfaisable: false`, `raisonBase: null` : la tournée de départ
 *       est OK, mais aucun candidat ne passe une fois essayé individuellement
 *       (chacun ferait dépasser le budget, l'amplitude ou une fenêtre promise
 *       une fois ajouté).
 *     - `baseInfaisable: true`, `raisonBase` = la raison brute renvoyée par
 *       `sequencerTournee` sur `tourneeActuelle` seule (`'budget'`,
 *       `'amplitude'` ou `'fenetre'` — PAS le tag `'tournee_actuelle_infaisable'`
 *       de `coutInsertion`, qui signale une autre chose : que le calcul de
 *       coût marginal lui-même n'a pas de sens. Ici on veut dire à l'appelant
 *       CE QUI CLOCHE, pas juste QU'IL Y A UN PROBLÈME) : la tournée de
 *       départ elle-même ne tient déjà pas ses contraintes, avant même
 *       d'essayer un candidat — aucun candidat n'a été évalué. Cas réel :
 *       une journée à 3 chaudières granulés atteint 7h30 d'intervention hors
 *       trajets, déjà hors budget. Le message à l'écran doit être « cette
 *       journée est en dépassement », pas « aucun entretien à proposer ».
 */
export function classerCandidats(tourneeActuelle, candidats, ctx, { scoreParId = {} } = {}) {
  const sequenceActuelle = sequencerTournee({ ...ctx, arrets: tourneeActuelle });

  if (!sequenceActuelle.faisable) {
    return { classement: [], baseInfaisable: true, raisonBase: sequenceActuelle.raison };
  }

  const resultats = [];

  for (const candidat of candidats || []) {
    const cout = coutInsertion(tourneeActuelle, candidat, ctx, { sequenceActuelle });
    if (!cout.faisable) continue;

    const eligibilite = scoreParId[candidat.id] ?? 1;
    // Le coût est ramené en [0,1] : 60 min de détour divise l'attrait par deux.
    const efficacite = 60 / (60 + Math.max(0, cout.minutes - candidat.dureeMinutes));

    resultats.push({
      candidat,
      coutMinutes: cout.minutes,
      detourMinutes: cout.minutes - candidat.dureeMinutes,
      scoreFinal: eligibilite * efficacite,
      sequenceApres: cout.sequenceApres,
    });
  }

  resultats.sort((a, b) => b.scoreFinal - a.scoreFinal || a.coutMinutes - b.coutMinutes);

  return { classement: resultats, baseInfaisable: false, raisonBase: null };
}
