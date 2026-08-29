// scripts/tournee/creneaux.test.mjs
// Insertion d'un candidat dans les créneaux libres (src/lib/tournee/creneaux.js).
// Le test qui compte est le premier : une journée réelle ne doit JAMAIS être
// déclarée impossible à remplir parce que nos estimations de trajet ne collent
// pas au planning qu'un humain a posé.
// Run : node --test scripts/tournee/creneaux.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placerCandidat, classerParCreneaux, chargeExistante, arretsPlaces,
  placerPlusieurs, finDeJournee,
} from '../../src/lib/tournee/creneaux.js';
import { construireArretsExistants } from '../../src/lib/tournee/arrets.js';
import { sequencerTournee } from '../../src/lib/tournee/sequence.js';

const DEPOT = 'd';
const AMPLITUDE = { debut: 480, fin: 1080 }; // 08:00 -> 18:00
const PAUSE = { minutes: 30, fenetre: [720, 840] };

/** Trajet uniforme : n minutes entre deux points distincts. */
const uniforme = (n) => (a, b) => (a === b ? 0 : n);

const arret = (id, debut, duree, key = id) => ({
  id, key, dureeMinutes: duree, fenetre: { debut, fin: debut },
});
const candidat = (id, duree, key = id) => ({ id, key, dureeMinutes: duree });

const ctx = (trajet, extra = {}) => ({
  trajet, depotKey: DEPOT, amplitude: AMPLITUDE, budgetMinutes: 480, pause: PAUSE, ...extra,
});

// ============================================================================
// LE CAS QUI A MOTIVÉ CE MODULE
// ============================================================================

test('31/08 réel : la journée reste remplissable là où le séquencement la condamnait', () => {
  // 3 RDV : 8h/90min, 10h/150min, 15h/90min — 2h30 encore libres a l'ecran.
  const rdvs = [
    { id: 'a', lat: 43.9, lng: 1.9, duration_minutes: 90, scheduled_start: '08:00' },
    { id: 'b', lat: 43.95, lng: 2.05, duration_minutes: 150, scheduled_start: '10:00' },
    { id: 'c', lat: 43.85, lng: 1.85, duration_minutes: 90, scheduled_start: '15:00' },
  ];
  const arrets = construireArretsExistants(rdvs, { lat: 43.9, lng: 1.9 });
  const KA = '43.900,1.900';
  const KB = '43.950,2.050';
  // Trajets realistes : c'est le saut a->b (40 min) qui casse la fenetre de 10h,
  // le reste de la journee est court. Un uniforme a 40 min ferait deborder le
  // BUDGET (160 min de route sur 480), ce qui serait un refus legitime et
  // masquerait le defaut qu'on veut montrer ici.
  const trajet = (x, y) => {
    if (x === y) return 0;
    const paire = [x, y].sort().join('|');
    if (paire === [KA, KB].sort().join('|')) return 40;
    return 15;
  };

  // Constat de depart : le sequencement d'ensemble refuse la journee entiere.
  const ancien = sequencerTournee({
    depotKey: KA, arrets, trajet, amplitude: AMPLITUDE, budgetMinutes: 480, pause: PAUSE,
  });
  assert.equal(ancien.faisable, false);
  assert.equal(ancien.raison, 'fenetre', 'c est bien la fenetre ponctuelle qui bloquait');

  // Le nouveau modele ne juge pas la journee : il cherche une place.
  const { classement } = classerParCreneaux(
    arrets, [candidat('nouveau', 60, 'nouveau')], ctx(trajet, { depotKey: KA }),
  );
  assert.equal(classement.length, 1, 'un entretien de 60 min tient entre 12h30 et 15h');
  // 13h15 et non 12h45 : le RDV de 10h finit a 12h30, le technicien dejeune
  // (12h30-13h) PUIS prend la route (15 min). Place au plus tot, il ne serait
  // reste que 15 min de battement avant 14h — pas de quoi manger.
  assert.equal(classement[0].placement.arriveeMinutes, 795, 'repas pris, puis 15 min de route');
  assert.equal(classement[0].placement.avantId, 'b');
  assert.equal(classement[0].placement.apresId, 'c');
});

// ============================================================================
// PLACEMENT
// ============================================================================

test('journée vide : le candidat part à l ouverture, le coût est l aller-retour', () => {
  const p = placerCandidat({ arrets: [], candidat: candidat('x', 60), ...ctx(uniforme(20)) });
  assert.equal(p.faisable, true);
  assert.equal(p.arriveeMinutes, 500, '8h + 20 min de route');
  assert.equal(p.departMinutes, 560);
  assert.equal(p.coutMinutes, 100, '20 aller + 60 intervention + 20 retour');
  assert.equal(p.detourMinutes, 40);
  assert.equal(p.avantId, null);
  assert.equal(p.apresId, null);
});

test('le coût marginal déduit l arc que l on évite', () => {
  // Entre A (fin 10h) et B (debut 14h), inserer X : on paie A->X et X->B mais
  // on n'a plus a payer A->B. C'est ca, « les minutes ajoutees a la journee ».
  const arrets = [arret('a', 540, 60), arret('b', 840, 60)];
  const p = placerCandidat({ arrets, candidat: candidat('x', 60), ...ctx(uniforme(30)) });
  assert.equal(p.faisable, true);
  assert.equal(p.coutMinutes, 90, '30 + 60 + 30 - 30 evite');
  assert.equal(p.avantId, 'a');
  assert.equal(p.apresId, 'b');
});

test('un candidat qui ne tient dans aucun trou est refusé pour « creneau », pas pour autre chose', () => {
  // Journee fermee de bout en bout sauf un trou de 10h a 11h ; avec 30 min de
  // route de chaque cote, 60 min d'intervention n'y rentrent pas.
  const arrets = [arret('a', 480, 120), arret('b', 660, 420)];
  const p = placerCandidat({
    arrets, candidat: candidat('x', 60), ...ctx(uniforme(30), { budgetMinutes: 2000 }),
  });
  assert.equal(p.faisable, false);
  assert.equal(p.raison, 'creneau');
});

test('le budget de la journée est opposable, et il compte les trajets existants', () => {
  const arrets = [arret('a', 540, 240)];
  const charge = chargeExistante(arrets, { trajet: uniforme(30), depotKey: DEPOT });
  assert.equal(charge, 300, '240 d intervention + 30 aller + 30 retour');
  const p = placerCandidat({
    arrets, candidat: candidat('x', 120), ...ctx(uniforme(30), { budgetMinutes: 330 }),
  });
  assert.equal(p.faisable, false);
  assert.equal(p.raison, 'budget');
});

test('la pause déjeuner ne peut pas être supprimée en silence', () => {
  // Seul trou de la journee : 12h-14h. Y caser 120 min ne laisserait pas de
  // quoi manger (l'apres-midi est plein jusqu'a la fermeture).
  const arrets = [arret('matin', 480, 240), arret('aprem', 840, 240)];
  const plein = placerCandidat({
    arrets, candidat: candidat('x', 120), ...ctx(uniforme(0), { budgetMinutes: 2000 }),
  });
  assert.equal(plein.faisable, false);
  assert.equal(plein.raison, 'pause');

  // 60 min laissent 60 min de battement : ca passe.
  const ok = placerCandidat({
    arrets, candidat: candidat('y', 60), ...ctx(uniforme(0), { budgetMinutes: 2000 }),
  });
  assert.equal(ok.faisable, true);
});

test('une pause déjà impossible avant nous ne se retourne pas contre le candidat', () => {
  // Installation de 8h a 16h : le technicien ne dejeune pas dans sa fenetre,
  // et ce n'est pas l'entretien qu'on ajoute a 16h15 qui le lui retire.
  const arrets = [arret('install', 480, 480)];
  const p = placerCandidat({
    arrets, candidat: candidat('x', 30), ...ctx(uniforme(15), { budgetMinutes: 2000 }),
  });
  assert.equal(p.faisable, true, 'punir ce client d un probleme preexistant serait le meme travers que sur les fenetres');
  assert.equal(p.arriveeMinutes, 975);
});

test('un candidat sans coordonnées est refusé explicitement, jamais placé au hasard', () => {
  const p = placerCandidat({
    arrets: [], candidat: { id: 'x', key: null, dureeMinutes: 60 }, ...ctx(uniforme(20)),
  });
  assert.equal(p.faisable, false);
  assert.equal(p.raison, 'position');
});

test('à coût égal, la place la plus tôt gagne — et le résultat est reproductible', () => {
  const arrets = [arret('a', 600, 60)];
  const p = placerCandidat({ arrets, candidat: candidat('x', 60), ...ctx(uniforme(0)) });
  assert.equal(p.faisable, true);
  assert.equal(p.arriveeMinutes, 480, 'le trou du matin plutot que celui de l apres-midi');
  const p2 = placerCandidat({ arrets, candidat: candidat('x', 60), ...ctx(uniforme(0)) });
  assert.deepEqual(p, p2);
});

test('le retour au dépôt est compté : pas de RDV qui déborde l amplitude', () => {
  // Dernier trou : de 16h a 18h, avec 45 min de route de chaque cote.
  const arrets = [arret('a', 480, 480)]; // 8h -> 16h
  const trop = placerCandidat({
    arrets, candidat: candidat('x', 60), ...ctx(uniforme(45), { budgetMinutes: 2000 }),
  });
  assert.equal(trop.faisable, false, '16h45 + 60 + 45 = 18h30 > amplitude');
  const ok = placerCandidat({
    arrets, candidat: candidat('y', 30), ...ctx(uniforme(45), { budgetMinutes: 2000 }),
  });
  assert.equal(ok.faisable, true);
  assert.ok(ok.departMinutes + 45 <= AMPLITUDE.fin);
});

// ============================================================================
// ARRÊTS SANS HEURE
// ============================================================================

test('un arrêt sans heure ne borne aucun créneau mais pèse sur le budget', () => {
  const arrets = [
    arret('place', 540, 60),
    { id: 'flou', key: 'f', dureeMinutes: 180 }, // aucune fenetre
  ];
  assert.deepEqual(arretsPlaces(arrets).map((a) => a.id), ['place'],
    'seul l arret date borne un creneau');
  assert.equal(chargeExistante(arrets, { trajet: uniforme(0), depotKey: DEPOT }), 240,
    'les 180 min sans heure sont bien comptees');
});

// ============================================================================
// CLASSEMENT
// ============================================================================

test('classerParCreneaux — trié par score, et le rejet est motivé plutôt que muet', () => {
  const arrets = [arret('a', 540, 60)];
  const { classement, raisonsRejet } = classerParCreneaux(
    arrets,
    [candidat('proche', 60, 'a'), candidat('sansPosition', 60, null)],
    ctx(uniforme(20)),
  );
  assert.deepEqual(classement.map((c) => c.candidat.id), ['proche']);
  assert.equal(raisonsRejet.position, 1, 'on sait POURQUOI il manque, pas juste qu il manque');
});

test('classerParCreneaux — le score d éligibilité pondère le détour', () => {
  const arrets = [];
  const { classement } = classerParCreneaux(
    arrets,
    [candidat('loin', 60, 'x'), candidat('pres', 60, 'y')],
    ctx((a, b) => {
      if (a === b) return 0;
      return (a === 'x' || b === 'x') ? 60 : 5;
    }),
    { scoreParId: { loin: 1, pres: 1 } },
  );
  assert.deepEqual(classement.map((c) => c.candidat.id), ['pres', 'loin'],
    'a eligibilite egale, le moins couteux passe devant');
});

test('classerParCreneaux — aucune journée n est refusée en bloc', () => {
  // Meme avec des trajets absurdes entre les RDV existants, on evalue les
  // candidats : c'est tout l'objet de ce module.
  const arrets = [arret('a', 480, 60), arret('b', 540, 60)]; // enchaines sans trajet possible
  const { classement, raisonsRejet } = classerParCreneaux(
    arrets, [candidat('x', 60, 'z')], ctx(uniforme(90), { budgetMinutes: 900 }),
  );
  assert.ok(classement.length + Object.keys(raisonsRejet).length > 0);
  assert.equal(classement.length, 1, 'le trou de l apres-midi reste utilisable');
});

// ============================================================================
// INSERTION MULTIPLE
// ============================================================================

test('placerPlusieurs — chaque candidat placé contraint le suivant', () => {
  // Sans cela, deux entretiens seraient calcules chacun comme s'il etait seul
  // et se retrouveraient au meme endroit : l'apercu mentirait.
  const { places } = placerPlusieurs(
    [], [candidat('a', 60, 'ka'), candidat('b', 60, 'kb')], ctx(uniforme(15)),
  );
  assert.equal(places.length, 2);
  const [p1, p2] = places;
  assert.ok(p2.placement.arriveeMinutes >= p1.placement.departMinutes,
    'le second ne peut pas commencer avant que le premier soit fini');
  assert.equal(p2.placement.avantId, 'a', 'il s enchaine bien apres le premier');
});

test('placerPlusieurs — un candidat qui ne rentre plus est refusé, les autres restent', () => {
  const { places, refuses } = placerPlusieurs(
    [],
    [candidat('tient', 60, 'k1'), candidat('enorme', 900, 'k2'), candidat('aussi', 60, 'k3')],
    ctx(uniforme(10)),
  );
  assert.deepEqual(places.map((p) => p.candidat.id), ['tient', 'aussi']);
  assert.deepEqual(refuses.map((r) => r.candidat.id), ['enorme'],
    'un refus est remonte, jamais avale');
});

test('finDeJournee — retour au dépôt compris, null sur une journée vide', () => {
  assert.equal(finDeJournee([], { trajet: uniforme(20), depotKey: DEPOT }), null);
  const arrets = [arret('a', 540, 60)];
  assert.equal(finDeJournee(arrets, { trajet: uniforme(20), depotKey: DEPOT }), 620,
    '10h de fin + 20 min de retour');
});

// ============================================================================
// NON-RÉGRESSION — bugs vécus en production
// ============================================================================
// Ces deux cas étaient couverts contre `sequencerTournee`, qui n'est plus le
// moteur de production. Ils sont rejoués ici contre celui qui l'est : un test
// qui protège un bug réel doit viser le code qui tourne, sinon il rassure sans
// rien garantir.

test('04 septembre — une installation sans coordonnées bloque quand même la matinée', () => {
  // 8h-13h chez HACK (300 min, sans coordonnee client). Un entretien de 60 min
  // ne peut pas etre place a 8h05 : il doit passer l'apres-midi.
  const [hack] = construireArretsExistants(
    [{ id: 'hack', lat: null, lng: null, duration_minutes: 300, scheduled_start: '08:00' }],
    { lat: 43.9, lng: 1.9 }, // repli siege
  );
  const p = placerCandidat({
    arrets: [hack],
    candidat: candidat('entretien', 60, 'E'),
    ...ctx(uniforme(20), { budgetMinutes: 900 }),
  });
  assert.equal(p.faisable, true);
  assert.ok(p.arriveeMinutes >= 13 * 60,
    `arrivee attendue apres 13h, obtenue a ${p.arriveeMinutes} min`);
  assert.equal(p.avantId, 'hack', 'il passe APRES l installation');
});

test('10 septembre — un entretien ne peut pas mordre sur un RDV humain déjà posé', () => {
  // Rendez-vous humain a 8h30 (2 h). Le moteur proposait un entretien de 60 min
  // a 8h07, soit 45 min de chevauchement.
  const MATRICE = { 'D|A': 7, 'A|D': 7, 'D|J': 15, 'J|D': 15, 'A|J': 8, 'J|A': 8 };
  const trajet = (x, y) => (x === y ? 0 : MATRICE[`${x}|${y}`] ?? 999);
  const joubert = {
    id: 'joubert', key: 'J', dureeMinutes: 120, fenetre: { debut: 510, fin: 510 },
  };

  const p = placerCandidat({
    arrets: [joubert],
    candidat: candidat('aloisi', 60, 'A'),
    trajet,
    depotKey: 'D',
    amplitude: AMPLITUDE,
    budgetMinutes: 480,
    pause: PAUSE,
  });
  assert.equal(p.faisable, true, 'la journee reste remplissable : il suffit de passer apres');
  assert.ok(p.arriveeMinutes >= 630,
    `l entretien doit commencer apres la fin du RDV de 8h30 (10h30), obtenu ${p.arriveeMinutes}`);
  assert.equal(p.avantId, 'joubert');
});

test('un créneau AVANT un RDV posé n est utilisé que si le retour laisse arriver à l heure', () => {
  // Le trou de 8h a 8h30 existe, mais 60 min d'intervention + 8 min de route
  // feraient arriver a 9h15 chez un client attendu a 8h30. Refuse.
  const MATRICE = { 'D|A': 7, 'A|D': 7, 'D|J': 15, 'J|D': 15, 'A|J': 8, 'J|A': 8 };
  const trajet = (x, y) => (x === y ? 0 : MATRICE[`${x}|${y}`] ?? 999);
  const joubert = {
    id: 'joubert', key: 'J', dureeMinutes: 120, fenetre: { debut: 510, fin: 510 },
  };
  const p = placerCandidat({
    arrets: [joubert],
    candidat: candidat('aloisi', 60, 'A'),
    trajet,
    depotKey: 'D',
    amplitude: AMPLITUDE,
    budgetMinutes: 480,
    pause: PAUSE,
  });
  assert.notEqual(p.apresId, 'joubert', 'jamais glisse dans le trou du matin');
});

test('attenteMinutes — dit quand le passage a été repoussé pour le déjeuner', () => {
  // Un client tout proche peut atterrir l'apres-midi parce qu'y aller tout de
  // suite supprimerait la pause. Sans ce chiffre, « +1 min de detour, passage a
  // 13h34 » face a « +11 min, passage a 11h52 » se lit comme une incoherence.
  const arrets = [arret('matin', 480, 240), arret('soir', 900, 120)]; // 8h-12h, 15h-17h
  // 100 min : place a 12h pile, il ne resterait que 20 min avant 14h — pas de
  // quoi manger. Il faut donc dejeuner d'abord.
  const p = placerCandidat({
    arrets, candidat: candidat('proche', 100, 'k'), ...ctx(uniforme(0), { budgetMinutes: 2000 }),
  });
  assert.equal(p.faisable, true);
  assert.equal(p.arriveeMinutes, 750, 'repas pris (12h-12h30), puis on y va');
  assert.equal(p.attenteMinutes, 30, 'et l ecran peut le dire');
});

test('attenteMinutes — vaut 0 quand rien n a repoussé le passage', () => {
  const p = placerCandidat({ arrets: [], candidat: candidat('x', 60), ...ctx(uniforme(20)) });
  assert.equal(p.attenteMinutes, 0);
});
