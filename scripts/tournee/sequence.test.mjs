// scripts/tournee/sequence.test.mjs
// Run : node --test scripts/tournee/sequence.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sequencerTournee, MAX_ARRETS_EXACT } from '../../src/lib/tournee/sequence.js';

// Géographie de test, en minutes de trajet. D = dépôt.
// A et B sont voisins (5 min) ; C est à l'opposé (40 min de D, 45 de A/B).
const MATRICE = {
  'D|A': 20, 'A|D': 20, 'D|B': 22, 'B|D': 22, 'D|C': 40, 'C|D': 40,
  'A|B': 5,  'B|A': 5,  'A|C': 45, 'C|A': 45, 'B|C': 44, 'C|B': 44,
};
const trajet = (a, b) => (a === b ? 0 : MATRICE[`${a}|${b}`] ?? 999);

const AMPLITUDE = { debut: 8 * 60, fin: 18 * 60 };
const PAUSE = { minutes: 30, fenetre: [12 * 60, 14 * 60] };
const ctx = { depotKey: 'D', trajet, amplitude: AMPLITUDE, budgetMinutes: 480, pause: PAUSE };

const arret = (id, key, dureeMinutes, fenetre) => ({ id, key, dureeMinutes, fenetre });

test('tournée vide — faisable, charge nulle', () => {
  const r = sequencerTournee({ ...ctx, arrets: [] });
  assert.equal(r.faisable, true);
  assert.equal(r.chargeMinutes, 0);
  assert.deepEqual(r.ordre, []);
});

test('un seul arrêt — aller-retour au dépôt compté', () => {
  const r = sequencerTournee({ ...ctx, arrets: [arret('a', 'A', 90)] });
  assert.equal(r.faisable, true);
  assert.equal(r.chargeMinutes, 20 + 90 + 20, 'trajet aller + intervention + retour');
  assert.equal(r.planning[0].rang, 1);
  assert.equal(r.planning[0].arriveeMinutes, 8 * 60 + 20);
});

test('trouve le VRAI optimum, pas un ordre d arrivée', () => {
  // Ordre fourni volontairement mauvais : A, C, B → 20+45+44+22 = 131 de trajet.
  // Optimum : A, B, C (ou C, B, A) → 20+5+44+40 = 109.
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 60), arret('c', 'C', 60), arret('b', 'B', 60)],
  });
  assert.equal(r.faisable, true);
  const trajets = r.chargeMinutes - 180;
  assert.equal(trajets, 109, `attendu 109 min de trajet, obtenu ${trajets}`);
  const ids = r.ordre.join(',');
  assert.ok(ids === 'a,b,c' || ids === 'c,b,a', `ordre inattendu : ${ids}`);
});

test('pause méridienne insérée dans sa fenêtre', () => {
  // 3 × 2h : la journée traverse forcément midi.
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 120), arret('b', 'B', 120), arret('c', 'C', 120)],
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, true);
  assert.equal(r.pauseHorsFenetre, false);
  // La pause décale les arrêts d'après : la fin dépasse la somme brute.
  const brut = 8 * 60 + r.chargeMinutes;
  assert.equal(r.finMinutes, brut + 30, 'la pause allonge la journee sans compter dans la charge');
});

test('budget dépassé — infaisable avec raison', () => {
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 150), arret('b', 'B', 150), arret('c', 'C', 150)],
    budgetMinutes: 480, // 450 d intervention + 109 de trajet = 559 > 480
  });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'budget');
});

test('amplitude dépassée — infaisable', () => {
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 240), arret('c', 'C', 240)],
    amplitude: { debut: 8 * 60, fin: 15 * 60 },
    budgetMinutes: 900,
  });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'amplitude');
});

test('fenêtre promise respectée — l ordre s y plie', () => {
  // C promis en début de matinée alors que l optimum géographique le mettrait
  // en dernier : la promesse gagne.
  const r = sequencerTournee({
    ...ctx,
    arrets: [
      arret('a', 'A', 60),
      arret('b', 'B', 60),
      arret('c', 'C', 60, { debut: 8 * 60, fin: 9 * 60 + 30 }),
    ],
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, true);
  assert.equal(r.ordre[0], 'c', 'la fenetre promise impose le premier passage');
  const planC = r.planning.find((p) => p.id === 'c');
  assert.ok(planC.arriveeMinutes <= 9 * 60 + 30);
});

test('fenêtre impossible à tenir — infaisable', () => {
  // Fenêtre à 8h30 : 40 min de trajet depuis le dépôt, départ à 8h00, arrivée
  // 8h40 — après la fermeture. La tolérance de départ anticipé ne s'applique
  // pas ici : elle ne couvre que les arrêts fixés À l'ouverture ou avant.
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('c', 'C', 60, { debut: 8 * 60 + 30, fin: 8 * 60 + 35 })],
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'fenetre');
});

test('départ anticipé — un RDV fixé à l ouverture reste atteignable', () => {
  // Un rendez-vous à 8h00 pile chez un client à 40 min : en partant à 8h00 on
  // arriverait à 8h40, et TOUTE la journée serait declaree infaisable. Le
  // technicien part evidemment plus tot pour etre a l heure. Sans cette
  // tolerance, la plupart des journees de terrain seraient rejetees.
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('c', 'C', 60, { debut: 8 * 60, fin: 8 * 60 })],
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, true);
  assert.equal(r.planning[0].arriveeMinutes, 8 * 60, 'il est chez le client a 8h00 pile');
});

test('départ anticipé — ne couvre PAS un arrêt de milieu de journée', () => {
  // Deux arrets contraints dont le second est inatteignable apres le premier :
  // la tolerance ne s applique qu au premier arret, ce conflit reste un echec.
  const r = sequencerTournee({
    ...ctx,
    arrets: [
      arret('a', 'A', 240, { debut: 8 * 60, fin: 8 * 60 }),
      arret('b', 'B', 60, { debut: 9 * 60, fin: 9 * 60 + 5 }),
    ],
    budgetMinutes: 900,
  });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'fenetre');
});

test('attente si on arrive avant l ouverture de la fenêtre', () => {
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 60, { debut: 10 * 60, fin: 11 * 60 })],
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, true);
  assert.equal(r.planning[0].arriveeMinutes, 10 * 60, 'on patiente jusqu a l ouverture');
});

test('déterminisme — même entrée, même sortie', () => {
  const arrets = [arret('a', 'A', 60), arret('b', 'B', 60), arret('c', 'C', 60)];
  const r1 = sequencerTournee({ ...ctx, arrets, budgetMinutes: 600 });
  const r2 = sequencerTournee({ ...ctx, arrets: [...arrets].reverse(), budgetMinutes: 600 });
  assert.equal(r1.chargeMinutes, r2.chargeMinutes, 'l ordre d entree ne change pas l optimum');
});

test('au-delà de MAX_ARRETS_EXACT — repli heuristique, toujours faisable', () => {
  const arrets = Array.from({ length: MAX_ARRETS_EXACT + 2 }, (_, i) =>
    arret(`x${i}`, i % 2 === 0 ? 'A' : 'B', 20));
  const r = sequencerTournee({ ...ctx, arrets, budgetMinutes: 900 });
  assert.equal(r.ordre.length, arrets.length, 'tous les arrets sont places');
  assert.equal(r.methode, 'heuristique');
});

// --- Fix round 1 (revue) ------------------------------------------------

test('tie de charge — tie-break lexicographique BRUT, pas localeCompare, stable entre runtimes', () => {
  // A et B sont symétriques dans la matrice de trajet : D→A→B→D et D→B→A→D
  // traversent exactement les 3 mêmes arêtes, donc ont la MÊME charge (47 min
  // de trajet + 120 d intervention = 167) — égalité stricte, pas un artefact
  // d arrondi. Les deux ordres sont donc à égalité, et le choix ne doit RIEN
  // devoir à l ordre dans lequel le générateur de permutations les explore.
  //
  // 'alpha' et 'Beta' sont volontairement choisis pour diverger entre
  // localeCompare (classe 'alpha' avant 'Beta', casse quasi ignorée) et la
  // comparaison brute qu utilise le moteur ('B' = U+0042 < 'a' = U+0061 en
  // UTF-16) : sur l implémentation localeCompare, ce test échoue et renvoie
  // ['alpha','Beta'] — vérifié empiriquement avant le fix.
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('alpha', 'A', 60), arret('Beta', 'B', 60)],
  });
  assert.equal(r.faisable, true);
  assert.equal(r.chargeMinutes, 167, 'égalité de charge entre les deux ordres possibles');
  assert.deepEqual(r.ordre, ['Beta', 'alpha'],
    'tie-break lexicographique brut : "B" (0x42) < "a" (0x61) en UTF-16, quel que soit l ordre d entrée');
});

// --- C2 (revue finale) — repli heuristique et fenêtres --------------------

test('repli heuristique — respecte l ordre chronologique de deux arrêts contraints, même contre la géographie', () => {
  // 7 arrêts de remplissage, tous en A (0 min de A à A) : au-delà de
  // MAX_ARRETS_EXACT, ça force le repli plus-proche-voisin.
  // 'proche' (position B, 5 min de A) porte une fenêtre TARDIVE (14h).
  // 'loin' (position C, 45 min de A) porte une fenêtre PRÉCOCE (8h).
  // Un plus-proche-voisin aveugle aux fenêtres visiterait 'proche' avant
  // 'loin' (pure géographie) — exactement l ordre chronologique inverse de
  // ce que leurs fenêtres imposent.
  const remplissage = Array.from({ length: 7 }, (_, i) => arret(`x${i}`, 'A', 10));
  const proche = arret('proche', 'B', 20, { debut: 14 * 60, fin: 16 * 60 });
  const loin = arret('loin', 'C', 20, { debut: 8 * 60, fin: 9 * 60 + 30 });

  const r = sequencerTournee({
    ...ctx,
    arrets: [...remplissage, proche, loin],
    pause: { minutes: 0, fenetre: [0, 0] },
    budgetMinutes: 900,
  });

  assert.equal(r.methode, 'heuristique', 'plus de MAX_ARRETS_EXACT arrêts');
  assert.equal(r.ordre.length, 9, 'tous les arrets sont places');
  assert.ok(
    r.ordre.indexOf('loin') < r.ordre.indexOf('proche'),
    `'loin' (fenêtre 8h) doit précéder 'proche' (fenêtre 14h) — ordre obtenu : ${r.ordre.join(',')}`,
  );
});

test('repli heuristique — un seul arrêt contraint : la géographie décide pour le reste', () => {
  const remplissage = Array.from({ length: 8 }, (_, i) => arret(`x${i}`, i % 2 === 0 ? 'A' : 'B', 10));
  const promis = arret('promis', 'C', 20, { debut: 8 * 60, fin: 9 * 60 + 30 });

  const r = sequencerTournee({
    ...ctx,
    arrets: [...remplissage, promis],
    pause: { minutes: 0, fenetre: [0, 0] },
    budgetMinutes: 900,
  });

  assert.equal(r.methode, 'heuristique');
  assert.equal(r.ordre.length, 9, 'tous les arrets sont places, y compris le seul contraint');
});

// ============================================================================
// Consolidation (spec 2026-09-12) : les fenêtres de tolérance deviennent les
// fenêtres du séquenceur ; les figés sont des points fixes.
// ============================================================================
import { construireArretsPourConsolidation } from '../../src/lib/tournee/arrets.js';

test('consolidation : ordre + heures dans les fenêtres, le figé ne bouge pas, les adaptables se resserrent', () => {
  const AMP = { debut: 480, fin: 1080 };
  // a ±30 posé 08:30 ; b figé 14:00 ; c ±30 posé 10:50 — tous à des lieux distincts, trajets 10.
  const rdvs = [
    { id: 'a', lat: 43.7, lng: 2.1, duration_minutes: 60, scheduled_start: '08:30', time_flex_minutes: 30 },
    { id: 'b', lat: 43.8, lng: 2.0, duration_minutes: 60, scheduled_start: '14:00', hour_confirmed_at: '2026-09-12T08:00:00Z' },
    { id: 'c', lat: 43.75, lng: 2.05, duration_minutes: 60, scheduled_start: '10:50', time_flex_minutes: 30 },
  ];
  const arrets = construireArretsPourConsolidation(rdvs, { lat: 43.9, lng: 1.9 }, { flexDefaut: 30, amplitude: AMP });
  const r = sequencerTournee({
    depotKey: '43.900,1.900', arrets, trajet: (x, y) => (x === y ? 0 : 10),
    amplitude: AMP, budgetMinutes: 600, pause: { minutes: 30, fenetre: [720, 840] },
  });
  assert.equal(r.faisable, true);
  const par = Object.fromEntries(r.planning.map((p) => [p.id, p]));
  assert.equal(par.b.arriveeMinutes, 840, 'le figé est un point fixe');
  assert.ok(par.a.arriveeMinutes >= 480 && par.a.arriveeMinutes <= 540, 'a reste dans ±30 de 08:30');
  assert.ok(par.c.arriveeMinutes >= 620 && par.c.arriveeMinutes <= 680, 'c reste dans ±30 de 10:50');
});
