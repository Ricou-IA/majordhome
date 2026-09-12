// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/tournee/sequence.js — ne pas éditer.
// ============================================================================
// Séquencement d'une journée de tournée. Module PUR.
// Testé : node --test scripts/tournee/sequence.test.mjs
//
// ⚠️ HORS CHEMIN DE PRODUCTION depuis le passage au modèle « créneaux »
// (creneaux.js) : plus aucun code applicatif ne l'appelle. Il réordonne une
// journée entière, ce qui n'a plus de sens depuis que chaque RDV posé porte
// une fenêtre ponctuelle — il n'y a plus d'ordre à chercher. Conservé parce
// qu'il reste la seule implémentation d'optimisation d'ordre du projet (la
// spec envisage de réordonner les entretiens que le module a lui-même posés),
// et parce que le test-témoin de creneaux.test.mjs s'en sert pour démontrer la
// régression corrigée. À supprimer si cette piste est abandonnée.
//
// Avec 4-5 entretiens par jour, l'espace des ordres possibles est minuscule
// (5 arrêts = 120 ordres, 8 = 40 320) : on les énumère TOUS et on retourne le
// vrai optimum. Pas d'heuristique, pas d'approximation — le repli
// plus-proche-voisin n'existe que comme garde-fou au-delà de 8 arrêts.
//
// Le temps est en minutes depuis minuit, partout. Aucune `Date` ici : c'est ce
// qui rend le module testable et réutilisable côté Deno.
//
// Vocabulaire :
//   charge = trajets + interventions (ce que borne `budgetMinutes`)
//   fin    = heure de retour au dépôt, pause incluse (ce que borne l'amplitude)
// La pause n'est pas du travail : elle allonge la journée sans consommer le
// budget.
// ============================================================================

export const MAX_ARRETS_EXACT = 8;

function* permutations(items) {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i += 1) {
    const reste = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(reste)) yield [items[i], ...p];
  }
}

/**
 * Déroule une journée dans un ordre donné et retourne son coût, ou `null` si
 * une contrainte est violée (avec la raison).
 */
function simuler(ordre, { depotKey, trajet, amplitude, budgetMinutes, pause }) {
  let t = amplitude.debut;
  let charge = 0;

  // Départ anticipé du dépôt. Un rendez-vous fixé à l'heure d'ouverture (8 h)
  // serait sinon inatteignable dès que le trajet depuis le dépôt n'est pas nul :
  // en partant à 8 h on arriverait à 8 h 20, après sa fenêtre ponctuelle, et
  // TOUTE la journée serait déclarée infaisable. Or le technicien part
  // évidemment plus tôt pour être chez le client à l'heure dite.
  // La tolérance est volontairement étroite : elle ne s'applique qu'au PREMIER
  // arrêt, et seulement si son heure tombe à l'ouverture ou avant. Un rendez-vous
  // de milieu de journée qu'on ne peut plus atteindre reste un vrai conflit.
  const premier = ordre[0];
  if (premier?.fenetre && premier.fenetre.debut <= amplitude.debut) {
    const trajetInitial = trajet(depotKey, premier.key);
    if (t + trajetInitial > premier.fenetre.fin) t = premier.fenetre.debut - trajetInitial;
  }
  let pausePrise = false;
  let pauseHorsFenetre = false;
  const planning = [];
  let position = depotKey;

  const [pauseDebut, pauseFin] = pause?.fenetre ?? [0, 0];
  const pauseMinutes = pause?.minutes ?? 0;

  for (let i = 0; i < ordre.length; i += 1) {
    const arret = ordre[i];

    const dureeTrajet = trajet(position, arret.key);
    t += dureeTrajet;
    charge += dureeTrajet;

    // La pause se prend à la première opportunité après l'ouverture de sa
    // fenêtre — c'est-à-dire entre deux arrêts, jamais au milieu d'un.
    if (!pausePrise && pauseMinutes > 0 && t >= pauseDebut) {
      t += pauseMinutes;
      pausePrise = true;
      if (t - pauseMinutes > pauseFin) pauseHorsFenetre = true;
    }

    if (arret.fenetre) {
      if (t < arret.fenetre.debut) t = arret.fenetre.debut; // on patiente
      if (t > arret.fenetre.fin) return { echec: 'fenetre' };
    }

    const arriveeMinutes = t;
    t += arret.dureeMinutes;
    charge += arret.dureeMinutes;
    planning.push({ id: arret.id, arriveeMinutes, departMinutes: t, rang: i + 1 });

    position = arret.key;
  }

  if (ordre.length > 0) {
    const retour = trajet(position, depotKey);
    t += retour;
    charge += retour;
  }

  // Journée trop courte pour que la pause soit tombée dans sa fenêtre : on la
  // prend quand même (le technicien mange plus tard), sans invalider la tournée.
  if (!pausePrise && pauseMinutes > 0 && ordre.length > 0 && t > pauseDebut) {
    t += pauseMinutes;
    pauseHorsFenetre = true;
  }

  if (charge > budgetMinutes) return { echec: 'budget' };
  if (t > amplitude.fin) return { echec: 'amplitude' };

  return { charge, finMinutes: t, planning, pauseHorsFenetre };
}

/**
 * Repli au-delà de MAX_ARRETS_EXACT : plus proche voisin, sans garantie
 * d'optimalité — mais qui respecte au moins l'ORDRE CHRONOLOGIQUE des arrêts
 * CONTRAINTS entre eux (C2, revue finale). Théorique tant qu'aucun arrêt ne
 * portait de `fenetre` ; un rendez-vous déjà pris peut désormais en porter
 * une (cf. arrets.js), et un plus-proche-voisin aveugle aux fenêtres pourrait
 * doubler un arrêt promis à 16h avec un arrêt promis à 9h. Les arrêts SANS
 * fenêtre restent choisis par pure proximité, y compris entre deux arrêts
 * contraints. Ne vérifie PAS que la fenêtre est effectivement tenue une fois
 * les trajets simulés (c'est le rôle de `simuler`, appelé juste après par
 * `sequencerTournee` sur l'ordre produit ici) — seulement que l'ordre proposé
 * ne les présente jamais à rebours.
 */
function plusProcheVoisin(arrets, depotKey, trajet) {
  const restants = [...arrets];
  const ordre = [];
  let position = depotKey;
  while (restants.length > 0) {
    // Parmi les arrêts contraints restants, seul celui à la fenêtre la plus
    // précoce (`fenetre.debut` le plus petit) est éligible ce tour-ci :
    // empêche le plus-proche-voisin de doubler un arrêt contraint plus
    // tardif avant un arrêt contraint plus précoce.
    let prochainContraintIdx = -1;
    for (let i = 0; i < restants.length; i += 1) {
      if (!restants[i].fenetre) continue;
      if (prochainContraintIdx === -1
        || restants[i].fenetre.debut < restants[prochainContraintIdx].fenetre.debut) {
        prochainContraintIdx = i;
      }
    }

    let meilleurIdx = -1;
    let meilleur = Infinity;
    for (let i = 0; i < restants.length; i += 1) {
      const contraintEcarte = restants[i].fenetre && i !== prochainContraintIdx;
      if (contraintEcarte) continue;
      const d = trajet(position, restants[i].key);
      if (d < meilleur) { meilleur = d; meilleurIdx = i; }
    }

    const [choisi] = restants.splice(meilleurIdx, 1);
    ordre.push(choisi);
    position = choisi.key;
  }
  return ordre;
}

/**
 * Départage deux séquences de même charge minimale par ordre lexicographique
 * BRUT (pas `localeCompare`, cf. commentaire sur le tri d'entrée) de leurs
 * ids. Sans ce tie-break explicite, la séquence retenue à égalité de charge
 * dépendrait de l'ordre dans lequel `permutations()` les explore — un détail
 * d'implémentation du générateur, pas une propriété du problème posé.
 * Retourne `true` si (`sim`, `ordre`) doit remplacer `meilleurActuel` comme
 * meilleure séquence connue.
 */
function estMeilleur(sim, ordre, meilleurActuel) {
  if (sim.charge !== meilleurActuel.charge) return sim.charge < meilleurActuel.charge;
  for (let i = 0; i < ordre.length; i += 1) {
    const idA = String(ordre[i].id);
    const idB = String(meilleurActuel.ordre[i].id);
    if (idA !== idB) return idA < idB;
  }
  return false; // séquences strictement identiques : rien à remplacer
}

export function sequencerTournee({
  depotKey,
  arrets = [],
  trajet,
  amplitude,
  budgetMinutes,
  pause = { minutes: 0, fenetre: [0, 0] },
}) {
  const ctx = { depotKey, trajet, amplitude, budgetMinutes, pause };

  if (arrets.length === 0) {
    return {
      faisable: true, raison: null, ordre: [], planning: [],
      chargeMinutes: 0, finMinutes: amplitude.debut, pauseHorsFenetre: false,
      methode: 'exact',
    };
  }

  if (arrets.length > MAX_ARRETS_EXACT) {
    const ordre = plusProcheVoisin(arrets, depotKey, trajet);
    const sim = simuler(ordre, ctx);
    if (sim.echec) {
      return {
        faisable: false, raison: sim.echec, ordre: ordre.map((a) => a.id),
        planning: [], chargeMinutes: null, finMinutes: null,
        pauseHorsFenetre: false, methode: 'heuristique',
      };
    }
    return {
      faisable: true, raison: null, ordre: ordre.map((a) => a.id),
      planning: sim.planning, chargeMinutes: sim.charge, finMinutes: sim.finMinutes,
      pauseHorsFenetre: sim.pauseHorsFenetre, methode: 'heuristique',
    };
  }

  // Comparaison lexicographique BRUTE (unités de code UTF-16 via `<`/`>`), pas
  // `localeCompare()` : `sort` est stable, et `localeCompare()` sans locale
  // fixée peut renvoyer 0 pour deux ids DIFFÉRENTS (équivalence Unicode,
  // quirks ICU) — auquel cas le tri stable les laisse dans leur ordre
  // d'entrée initial, brisant le canonique visé — et peut diverger d'un
  // runtime à l'autre (Node vs Deno). La comparaison brute n'a ni l'un ni
  // l'autre défaut : elle est spécifiée par ECMAScript, identique partout.
  // Ce tri met l'énumération dans un ordre stable ; le vrai garant du
  // déterminisme (y compris à charge égale) est le tie-break explicite
  // `estMeilleur` ci-dessous, pas ce tri seul.
  const tries = [...arrets].sort((a, b) => {
    const idA = String(a.id);
    const idB = String(b.id);
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });

  let meilleur = null;
  let dernierEchec = null;

  for (const ordre of permutations(tries)) {
    const sim = simuler(ordre, ctx);
    if (sim.echec) { dernierEchec = sim.echec; continue; }
    if (!meilleur || estMeilleur(sim, ordre, meilleur)) {
      meilleur = { ...sim, ordre };
    }
  }

  if (!meilleur) {
    return {
      faisable: false, raison: dernierEchec, ordre: [], planning: [],
      chargeMinutes: null, finMinutes: null, pauseHorsFenetre: false,
      methode: 'exact',
    };
  }

  return {
    faisable: true,
    raison: null,
    ordre: meilleur.ordre.map((a) => a.id),
    planning: meilleur.planning,
    chargeMinutes: meilleur.charge,
    finMinutes: meilleur.finMinutes,
    pauseHorsFenetre: meilleur.pauseHorsFenetre,
    methode: 'exact',
  };
}
