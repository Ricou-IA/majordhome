// src/lib/tournee/creneaux.js
// ============================================================================
// Insertion d'un candidat dans les CRÉNEAUX LIBRES d'une journée. Module PUR.
// Testé : node --test scripts/tournee/creneaux.test.mjs
//
// ----------------------------------------------------------------------------
// POURQUOI CE MODULE REMPLACE LE SÉQUENCEMENT D'ENSEMBLE
// ----------------------------------------------------------------------------
// `sequencerTournee` énumère les ordres possibles et vérifie que TOUTE la
// journée tient. C'était juste tant que le moteur pouvait réordonner les
// arrêts. Depuis que chaque RDV posé porte une fenêtre PONCTUELLE (arrets.js —
// « un rendez-vous annoncé à 8 h 30 est à 8 h 30 »), il n'y a plus d'ordre à
// chercher : les RDV existants sont cloués à leur heure. Ce qui restait du
// séquencement d'ensemble ne servait plus qu'à une chose — vérifier que le
// planning déjà posé respecte NOS estimations de trajet.
//
// Or ce planning a lieu. Il est un FAIT, pas une hypothèse à valider.
//
// Mesuré sur le cas réel du 31/08 (3 RDV : 8 h/90 min, 10 h/150 min, 15 h/90 min,
// 2 h 30 encore libres) : au-delà de 30 min de trajet estimé entre les deux
// premiers, la journée entière était déclarée « déjà en dépassement » et AUCUN
// candidat n'était évalué. Avec le coût par défaut d'une paire absente de la
// matrice (60 min, matrice.js), une seule paire manquante suffisait. L'écran
// annonçait 2 h 30 de libre et refusait tout — sans rien offrir pour en sortir.
//
// Le modèle ici ne juge plus la journée. Il répond à la seule question qui nous
// regarde : entre ces deux rendez-vous, ce client tient-il, trajets compris ?
//
// ⚠️ Corollaire assumé : on ne réordonne plus rien. Un candidat ne peut être
// placé QUE dans un trou existant. C'est exactement ce que la barre horaire
// montre à l'écran — et donc ce qu'un humain peut vérifier d'un coup d'œil.
// ============================================================================

/**
 * Priorité des motifs de rejet, du plus banal au plus parlant. Un candidat
 * essayé dans plusieurs créneaux échoue souvent pour « pas de trou » quelque
 * part ; ce n'est pas ça qu'il faut retenir si, ailleurs, il ne manquait que
 * la pause ou le budget.
 */
const RANG_RAISON = { creneau: 0, pause: 1, budget: 2 };

/** Ce que coûte un trajet manquant : jamais 0 (cf. matrice.js). */
const trajetOu = (trajet, a, b) => {
  if (a == null || b == null) return 60;
  return trajet(a, b);
};

/**
 * Arrêts fixes exploitables, triés : ceux qui portent une heure (`fenetre`).
 * Un arrêt SANS heure occupe le technicien mais on ignore quand — il ne borne
 * donc aucun créneau. Il n'est pas oublié pour autant : sa durée est comptée
 * dans la charge (cf. `chargeExistante`), il pèse sur le budget.
 */
export function arretsPlaces(arrets) {
  return (arrets || [])
    .filter((a) => a?.fenetre && Number.isFinite(a.fenetre.debut))
    .map((a) => ({
      id: a.id,
      key: a.key,
      debutMinutes: a.fenetre.debut,
      finMinutes: a.fenetre.debut + (a.dureeMinutes || 0),
      dureeMinutes: a.dureeMinutes || 0,
    }))
    .sort((a, b) => a.debutMinutes - b.debutMinutes);
}

/**
 * Charge déjà consommée : durées de TOUS les arrêts (placés ou non) + trajets
 * de la chaîne des arrêts placés, dépôt compris aux deux bouts.
 */
export function chargeExistante(arrets, { trajet, depotKey }) {
  const places = arretsPlaces(arrets);
  let total = (arrets || []).reduce((s, a) => s + (a.dureeMinutes || 0), 0);
  if (places.length === 0) return total;

  total += trajetOu(trajet, depotKey, places[0].key);
  for (let i = 1; i < places.length; i += 1) {
    total += trajetOu(trajet, places[i - 1].key, places[i].key);
  }
  total += trajetOu(trajet, places[places.length - 1].key, depotKey);
  return total;
}

/**
 * Les intervalles où un candidat pourrait se glisser, bornés par ses voisins
 * immédiats (ou le dépôt aux extrémités).
 * @returns {Array<{indexApres: number, keyAvant, dispoDepuis: number, keyApres, dispoJusqua: number}>}
 */
function intervalles(places, { depotKey, amplitude }) {
  const liste = [];
  for (let i = 0; i <= places.length; i += 1) {
    const avant = places[i - 1];
    const apres = places[i];
    liste.push({
      indexApres: i,
      keyAvant: avant ? avant.key : depotKey,
      dispoDepuis: avant ? avant.finMinutes : amplitude.debut,
      keyApres: apres ? apres.key : depotKey,
      dispoJusqua: apres ? apres.debutMinutes : amplitude.fin,
      apresId: apres ? apres.id : null,
      avantId: avant ? avant.id : null,
    });
  }
  return liste;
}

/**
 * Reste-t-il de quoi déjeuner ? On n'impose pas QUAND la pause est prise (le
 * moteur n'a pas à découper la journée d'un technicien), seulement qu'un trou
 * d'au moins `minutes` subsiste dans sa fenêtre.
 */
function pausePossible(places, pause) {
  if (!pause?.minutes) return true;
  const [debut, fin] = pause.fenetre || [0, 0];
  if (fin - debut < pause.minutes) return true; // fenêtre trop étroite : rien à garantir

  let curseur = debut;
  for (const p of places) {
    if (p.finMinutes <= debut || p.debutMinutes >= fin) continue;
    if (p.debutMinutes - curseur >= pause.minutes) return true;
    curseur = Math.max(curseur, p.finMinutes);
  }
  return fin - curseur >= pause.minutes;
}

/**
 * Meilleure place d'un candidat dans la journée, ou l'échec et sa raison.
 *
 * Coût marginal = trajet(avant→candidat) + durée + trajet(candidat→après)
 *               − trajet(avant→après)
 * soit exactement les minutes ajoutées à la journée — le critère du module.
 *
 * @param {object} params
 * @param {Array} params.arrets        arrêts existants (cf. construireArretsExistants)
 * @param {{id, key, dureeMinutes}} params.candidat
 * @param {Function} params.trajet     (fromKey, toKey) => minutes
 * @param {string} params.depotKey
 * @param {{debut: number, fin: number}} params.amplitude
 * @param {number} params.budgetMinutes
 * @param {{minutes: number, fenetre: [number, number]}} [params.pause]
 * @param {number} [params.chargeDeja]  charge existante déjà calculée (évite de
 *   la refaire pour chaque candidat : elle ne dépend pas du candidat)
 * @param {{min?: number, max?: number}} [params.fenetreArrivee]  borne l'heure
 *   d'ARRIVÉE (minutes depuis minuit) — « plutôt le matin » = { max: 719 },
 *   « l'après-midi » = { min: 720 }. Absent : comportement inchangé.
 * @returns {{
 *   faisable: boolean, raison: ('budget'|'creneau'|'pause'|'position'|null),
 *   arriveeMinutes: number|null, departMinutes: number|null,
 *   coutMinutes: number|null, detourMinutes: number|null,
 *   apresId: string|null, avantId: string|null, attenteMinutes: number,
 * }}
 *   `attenteMinutes` — écart entre l'heure retenue et la première où l'on
 *   aurait pu arriver. Presque toujours 0 ; non nul quand le passage a dû être
 *   repoussé pour laisser le technicien déjeuner. Sans ce chiffre, un client
 *   « à +1 min de détour » placé à 13 h 34 alors qu'un autre « à +11 min » passe
 *   à 11 h 52 est incompréhensible à l'écran — le détour et l'heure de passage
 *   ne mesurent pas la même chose, et rien ne le disait.
 */
export function placerCandidat({
  arrets, candidat, trajet, depotKey, amplitude, budgetMinutes, pause, chargeDeja, fenetreArrivee,
}) {
  const echec = (raison) => ({
    faisable: false,
    raison,
    arriveeMinutes: null,
    departMinutes: null,
    coutMinutes: null,
    detourMinutes: null,
    apresId: null,
    avantId: null,
    attenteMinutes: 0,
  });

  // Sans position, aucun trajet n'est calculable : le placer produirait des
  // horaires faux. On le dit plutôt que de le glisser au hasard.
  if (!candidat?.key) return echec('position');

  const places = arretsPlaces(arrets);
  const charge = chargeDeja ?? chargeExistante(arrets, { trajet, depotKey });
  const duree = candidat.dureeMinutes || 0;
  const pauseAvant = pausePossible(places, pause);

  let meilleur = null;
  let raisonVue = null;
  // On remonte la raison la PLUS informative, pas la première venue : « ça
  // rentrerait mais tu ne déjeunerais plus » et « la journée est pleine »
  // appellent une réaction, « pas de trou assez grand » est le refus banal.
  const noterRaison = (r) => {
    if (RANG_RAISON[r] > (RANG_RAISON[raisonVue] ?? -1)) raisonVue = r;
  };

  for (const iv of intervalles(places, { depotKey, amplitude })) {
    const allee = trajetOu(trajet, iv.keyAvant, candidat.key);
    const retour = trajetOu(trajet, candidat.key, iv.keyApres);
    const evite = places.length === 0 && iv.indexApres === 0
      // Journée vide : il n'y a pas d'arc dépôt→dépôt à économiser.
      ? 0
      : trajetOu(trajet, iv.keyAvant, iv.keyApres);

    const cout = allee + duree + retour - evite;
    const auPlusTot = iv.dispoDepuis + allee;

    // Trois arrivées essayées : au plus tôt, puis les deux qui laissent le
    // technicien déjeuner d'abord (dès l'ouverture de sa fenêtre de pause, ou
    // à la fin de celle-ci). Ne chercher qu'au plus tôt rejetait des clients
    // pour rien : sur le cas du 31/08, l'entretien de 60 min placé à 12 h 45
    // ne laissait plus de quoi manger et partait en fin de journée, alors
    // qu'à 13 h — repas pris — il tenait très bien avant le RDV de 15 h.
    const [pauseDebut, pauseFin] = pause?.fenetre || [];
    const arrivees = [auPlusTot];
    if (pause?.minutes) {
      // « Je mange dès que je peux, puis j'y vais » — la position la plus
      // proche du comportement réel, donc essayée avant le repli sur la fin
      // de fenêtre.
      arrivees.push(Math.max(iv.dispoDepuis, pauseDebut) + pause.minutes + allee);
      arrivees.push(pauseFin + allee);
    }
    // Fenêtre d'arrivée (contrainte « plutôt le matin / l'après-midi ») : on
    // essaie aussi le bord de la fenêtre, et on ne retient que les arrivées
    // qui y tiennent. Sans fenêtre : strictement le comportement d'avant.
    if (fenetreArrivee?.min != null) arrivees.push(Math.max(auPlusTot, fenetreArrivee.min));
    const dansFenetre = (a) => (fenetreArrivee?.min == null || a >= fenetreArrivee.min)
      && (fenetreArrivee?.max == null || a <= fenetreArrivee.max);
    // Jamais arriver avant d'être parti, et pas deux fois la même position.
    const departsPossibles = [...new Set(arrivees.filter((a) => a >= auPlusTot && dansFenetre(a)))];
    if (departsPossibles.length === 0) noterRaison('creneau');

    for (const arrivee of departsPossibles) {
      const depart = arrivee + duree;
      if (depart + retour > iv.dispoJusqua) { noterRaison('creneau'); continue; }
      if (charge + cout > budgetMinutes) { noterRaison('budget'); continue; }

      // Pause : test DIFFÉRENTIEL. Si le technicien ne pouvait déjà pas
      // déjeuner (une installation qui couvre 12 h–14 h), ce n'est pas le
      // candidat qui le lui retire — le refuser pour ça punirait un client
      // d'un problème préexistant, exactement le travers que ce module
      // corrige sur les fenêtres. On ne bloque que si NOTRE insertion est ce
      // qui supprime la pause.
      if (pauseAvant) {
        const apresInsertion = [...places, {
          id: candidat.id, key: candidat.key, debutMinutes: arrivee, finMinutes: depart, dureeMinutes: duree,
        }].sort((a, b) => a.debutMinutes - b.debutMinutes);
        if (!pausePossible(apresInsertion, pause)) { noterRaison('pause'); continue; }
      }

      // À coût égal, la place la plus tôt : un technicien préfère enchaîner
      // plutôt que d'attendre, et c'est reproductible (pas d'ordre d'itération
      // qui déciderait à notre place).
      if (!meilleur || cout < meilleur.coutMinutes
        || (cout === meilleur.coutMinutes && arrivee < meilleur.arriveeMinutes)) {
        meilleur = {
          faisable: true,
          raison: null,
          arriveeMinutes: arrivee,
          departMinutes: depart,
          coutMinutes: cout,
          detourMinutes: cout - duree,
          apresId: iv.apresId,
          avantId: iv.avantId,
          attenteMinutes: arrivee - auPlusTot,
        };
      }
    }
  }

  return meilleur || echec(raisonVue || 'creneau');
}

/**
 * Classe les candidats qui trouvent une place. Remplace `classerCandidats`
 * (insertion.js) — même critère (minutes ajoutées), même score, mais sans
 * jamais refuser en bloc au motif que le planning déjà posé ne tiendrait pas
 * nos estimations de trajet.
 *
 * ⚠️ Ne renvoie plus de `baseInfaisable` : une journée déjà posée n'est pas
 * « infaisable », elle est. Ce que l'écran doit distinguer, c'est « aucun
 * candidat ne rentre » (et pourquoi : plus de place, ou plus de budget) —
 * porté par `raisonsRejet`.
 *
 * @returns {{
 *   classement: Array<object>,
 *   chargeMinutes: number,
 *   raisonsRejet: Record<string, number>,
 * }}
 */
export function classerParCreneaux(arrets, candidats, ctx, { scoreParId = {} } = {}) {
  const {
    trajet, depotKey, amplitude, budgetMinutes, pause,
  } = ctx;
  const chargeDeja = chargeExistante(arrets, { trajet, depotKey });

  const classement = [];
  const raisonsRejet = {};

  for (const candidat of candidats || []) {
    const place = placerCandidat({
      arrets, candidat, trajet, depotKey, amplitude, budgetMinutes, pause, chargeDeja,
    });
    if (!place.faisable) {
      raisonsRejet[place.raison] = (raisonsRejet[place.raison] || 0) + 1;
      continue;
    }

    const eligibilite = scoreParId[candidat.id] ?? 1;
    // Le détour est ramené en [0,1] : 60 min de détour divise l'attrait par deux.
    const efficacite = 60 / (60 + Math.max(0, place.detourMinutes));

    classement.push({
      candidat,
      coutMinutes: place.coutMinutes,
      detourMinutes: place.detourMinutes,
      scoreFinal: eligibilite * efficacite,
      placement: place,
    });
  }

  classement.sort((a, b) => b.scoreFinal - a.scoreFinal || a.coutMinutes - b.coutMinutes);
  return { classement, chargeMinutes: chargeDeja, raisonsRejet };
}

/**
 * Insère PLUSIEURS candidats, l'un après l'autre : chaque candidat placé
 * devient un arrêt fixe pour les suivants. C'est ce qui rend l'aperçu d'une
 * sélection multiple honnête — sans cela, chaque candidat serait calculé comme
 * s'il était seul, et deux entretiens se retrouveraient placés au même endroit.
 *
 * L'ordre d'insertion est celui reçu (le classement) : le candidat le mieux
 * placé prend sa place en premier. Déterministe, et cohérent avec ce que
 * l'écran a montré au moment de cocher.
 *
 * @returns {{
 *   places: Array<{candidat, placement}>,
 *   refuses: Array<{candidat, raison}>,
 *   arretsFinaux: Array,
 * }}
 */
export function placerPlusieurs(arrets, candidats, ctx) {
  const {
    trajet, depotKey, amplitude, budgetMinutes, pause,
  } = ctx;

  let courants = [...(arrets || [])];
  const places = [];
  const refuses = [];

  for (const candidat of candidats || []) {
    const placement = placerCandidat({
      arrets: courants, candidat, trajet, depotKey, amplitude, budgetMinutes, pause,
    });
    if (!placement.faisable) {
      refuses.push({ candidat, raison: placement.raison });
      continue;
    }
    places.push({ candidat, placement });
    // Le candidat placé devient une contrainte pour les suivants, avec la même
    // forme qu'un RDV déjà posé (fenêtre ponctuelle à son heure d'arrivée).
    courants = [...courants, {
      id: candidat.id,
      key: candidat.key,
      dureeMinutes: candidat.dureeMinutes || 0,
      fenetre: { debut: placement.arriveeMinutes, fin: placement.arriveeMinutes },
    }];
  }

  return { places, refuses, arretsFinaux: courants };
}

/**
 * Heure de fin de journée (retour au dépôt) pour un jeu d'arrêts placés.
 * `null` si la journée est vide — il n'y a pas de « fin » à annoncer.
 */
export function finDeJournee(arrets, { trajet, depotKey }) {
  const places = arretsPlaces(arrets);
  if (places.length === 0) return null;
  const dernier = places[places.length - 1];
  return dernier.finMinutes + trajetOu(trajet, dernier.key, depotKey);
}
