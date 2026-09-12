// scripts/tournee/arrets.test.mjs
// Tests de la construction des arrêts déjà posés (src/lib/tournee/arrets.js)
// et de leur effet réel sur le séquencement.
// Run : node --test scripts/tournee/arrets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireArretsExistants, arrondirHeureFigee } from '../../src/lib/tournee/arrets.js';
import { sequencerTournee } from '../../src/lib/tournee/sequence.js';

const rdv = (id, lat, lng, duree, start) => ({
  id, lat, lng, duration_minutes: duree, scheduled_start: start, appointment_type: 'maintenance',
});

test('un RDV existant reçoit une fenêtre PONCTUELLE, pas une plage', () => {
  const [a] = construireArretsExistants([rdv('j', 43.9, 1.9, 120, '08:30:00')]);
  assert.deepEqual(a.fenetre, { debut: 510, fin: 510 },
    'un RDV annonce a 8h30 est a 8h30 : il ne glisse pas');
});

test('un RDV sans heure exploitable reste sans fenêtre plutôt que d en inventer une', () => {
  const sansHeure = construireArretsExistants([rdv('x', 43.9, 1.9, 60, null)]);
  assert.equal(sansHeure[0].fenetre, undefined);
  const heureVide = construireArretsExistants([rdv('y', 43.9, 1.9, 60, '')]);
  assert.equal(heureVide[0].fenetre, undefined);
});

test('un RDV sans coordonnées est CONSERVÉ : il bloque son créneau', () => {
  // Il l'était auparavant écarté, ce qui laissait le moteur placer un entretien
  // par-dessus (cas du 04/09 : installation 8h-13h sans coordonnée client,
  // entretiens proposés à 8h05). Sans position on ne peut pas calculer son
  // trajet, mais on sait que le technicien y est.
  const arrets = construireArretsExistants([
    rdv('avec', 43.9, 1.9, 60, '09:00'),
    { id: 'sans', lat: null, lng: null, duration_minutes: 300, scheduled_start: '08:00' },
  ]);
  assert.equal(arrets.length, 2, 'les deux arrets sont conserves');
  const sans = arrets.find((a) => a.id === 'sans');
  assert.equal(sans.key, null, 'pas de cle : aucun trajet calculable');
  assert.deepEqual(sans.fenetre, { debut: 480, fin: 480 }, 'son creneau reste verrouille');
  assert.equal(sans.dureeMinutes, 300, 'et il occupe bien toute sa duree');
});

test('04 septembre — une installation sans coordonnées bloque quand même la matinée', () => {
  // 8h-13h chez HACK (300 min, sans coordonnée). Un entretien de 60 min ne peut
  // pas etre place a 8h05 : il doit passer l apres-midi, ou pas du tout.
  const trajet = (x, y) => (x === y ? 0 : 20);
  const [hack] = construireArretsExistants([
    { id: 'hack', lat: null, lng: null, duration_minutes: 300, scheduled_start: '08:00' },
  ]);
  const entretien = { id: 'entretien', key: 'E', dureeMinutes: 60 };

  const r = sequencerTournee({
    depotKey: 'D',
    arrets: [hack, entretien],
    trajet,
    amplitude: { debut: 8 * 60, fin: 18 * 60 },
    budgetMinutes: 480,
    pause: { minutes: 30, fenetre: [12 * 60, 14 * 60] },
  });

  assert.equal(r.faisable, true);
  assert.deepEqual(r.ordre, ['hack', 'entretien'], 'l entretien passe APRES l installation');
  const planEntretien = r.planning.find((p) => p.id === 'entretien');
  assert.ok(planEntretien.arriveeMinutes >= 13 * 60,
    `arrivee attendue apres 13h, obtenue a ${planEntretien.arriveeMinutes} min`);
});

// --- Cas réel remonté en production, journée du 10 septembre ---
// Ludovic a un rendez-vous humain a 8h30 (2 h). Le moteur proposait un entretien
// de 60 min a 8h07 : 8h07 + 60 min + trajet = arrivee 9h15 chez le client de
// 8h30, soit 45 min de chevauchement. La cause etait une fenetre desserree de
// 90 min en aval (la largeur de creneau des NOUVEAUX rendez-vous, appliquee a
// tort a un rendez-vous deja pris).
test('10 septembre — un entretien ne peut pas mordre sur un RDV humain déjà posé', () => {
  const MATRICE = {
    'D|A': 7, 'A|D': 7, 'D|J': 15, 'J|D': 15, 'A|J': 8, 'J|A': 8,
  };
  const trajet = (x, y) => (x === y ? 0 : MATRICE[`${x}|${y}`] ?? 999);

  const [joubert] = construireArretsExistants([rdv('joubert', 43.90, 1.90, 120, '08:30')]);
  joubert.key = 'J';
  const aloisi = { id: 'aloisi', key: 'A', dureeMinutes: 60 };

  const r = sequencerTournee({
    depotKey: 'D',
    arrets: [joubert, aloisi],
    trajet,
    amplitude: { debut: 8 * 60, fin: 18 * 60 },
    budgetMinutes: 480,
    pause: { minutes: 30, fenetre: [12 * 60, 14 * 60] },
  });

  assert.equal(r.faisable, true, 'la journee reste faisable : il suffit de passer apres');
  assert.deepEqual(r.ordre, ['joubert', 'aloisi'],
    'l entretien doit passer APRES le rendez-vous de 8h30, jamais avant');

  const planJoubert = r.planning.find((p) => p.id === 'joubert');
  assert.equal(planJoubert.arriveeMinutes, 510, 'on patiente jusqu a 8h30, on n arrive pas apres');

  const planAloisi = r.planning.find((p) => p.id === 'aloisi');
  assert.ok(planAloisi.arriveeMinutes >= planJoubert.departMinutes,
    'aucun chevauchement avec le rendez-vous humain');
});

test('10 septembre — l ordre inverse est bien rejeté, ce n est pas un hasard de tri', () => {
  // Même géographie, mais on ne laisse au moteur QUE l'ordre fautif : en plaçant
  // l'entretien sur une position d'où il ne peut plus reculer, la seule
  // permutation restante viole la fenêtre, donc la tournée doit être infaisable.
  const trajet = (x, y) => (x === y ? 0 : ({ 'D|A': 7, 'A|J': 8, 'J|D': 15 }[`${x}|${y}`] ?? 999));
  const r = sequencerTournee({
    depotKey: 'D',
    arrets: [
      { id: 'aloisi', key: 'A', dureeMinutes: 60, fenetre: { debut: 8 * 60, fin: 8 * 60 + 10 } },
      { id: 'joubert', key: 'J', dureeMinutes: 120, fenetre: { debut: 510, fin: 510 } },
    ],
    trajet,
    amplitude: { debut: 8 * 60, fin: 18 * 60 },
    budgetMinutes: 480,
    pause: { minutes: 30, fenetre: [12 * 60, 14 * 60] },
  });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'fenetre');
});

// ============================================================================
// Souplesse (spec 2026-09-12) : tolérance de déplacement par RDV
// ============================================================================
import { toleranceDe, construireArretsPourConsolidation } from '../../src/lib/tournee/arrets.js';

const AMP = { debut: 480, fin: 1080 };

test('toleranceDe : figé (hour_confirmed_at) = ponctuel quel que soit time_flex_minutes', () => {
  const t = toleranceDe({ scheduled_start: '14:00', duration_minutes: 60, time_flex_minutes: 30, hour_confirmed_at: '2026-09-12T08:00:00Z', appointment_type: 'maintenance' }, { souplesse: true, flexDefaut: 30, amplitude: AMP });
  assert.deepEqual(t, { min: 840, max: 840, flex: 0 });
});

test('toleranceDe : seuls Entretien et SAV sont adaptables — une installation ou une VT est ponctuelle', () => {
  assert.deepEqual(toleranceDe({ scheduled_start: '08:00', duration_minutes: 570, time_flex_minutes: 30, appointment_type: 'installation' }, { souplesse: true, flexDefaut: 30, amplitude: AMP }), { min: 480, max: 480, flex: 0 });
  assert.deepEqual(toleranceDe({ scheduled_start: '14:00', duration_minutes: 60, appointment_type: 'rdv_technical' }, { souplesse: true, flexDefaut: 30, amplitude: AMP }), { min: 840, max: 840, flex: 0 });
  assert.equal(toleranceDe({ scheduled_start: '14:00', duration_minutes: 60, appointment_type: 'service' }, { souplesse: true, flexDefaut: 30, amplitude: AMP }).flex, 30);
});

test('toleranceDe : NULL = défaut d org ; 0 = figé ; ±15/±30 = plage bornée par l amplitude', () => {
  const m = (o) => ({ appointment_type: 'maintenance', ...o });
  assert.deepEqual(toleranceDe(m({ scheduled_start: '14:00', duration_minutes: 60 }), { souplesse: true, flexDefaut: 30, amplitude: AMP }), { min: 810, max: 870, flex: 30 });
  assert.deepEqual(toleranceDe(m({ scheduled_start: '14:00', duration_minutes: 60, time_flex_minutes: 0 }), { souplesse: true, flexDefaut: 30, amplitude: AMP }), { min: 840, max: 840, flex: 0 });
  assert.deepEqual(toleranceDe(m({ scheduled_start: '08:10', duration_minutes: 60, time_flex_minutes: 15 }), { souplesse: true, flexDefaut: 30, amplitude: AMP }), { min: 480, max: 505, flex: 15 });
  // fin d'amplitude : le RDV doit finir avant 18:00
  assert.deepEqual(toleranceDe(m({ scheduled_start: '17:30', duration_minutes: 60, time_flex_minutes: 30 }), { souplesse: true, flexDefaut: 30, amplitude: AMP }), { min: 1020, max: 1020, flex: 30 });
});

test('toleranceDe : demi-journée = la demi-journée qui contient l heure provisoire', () => {
  assert.deepEqual(toleranceDe({ scheduled_start: '09:30', duration_minutes: 90, time_flex_minutes: 240, appointment_type: 'maintenance' }, { souplesse: true, flexDefaut: 30, amplitude: AMP }), { min: 480, max: 630, flex: 240 });
  assert.deepEqual(toleranceDe({ scheduled_start: '15:00', duration_minutes: 60, time_flex_minutes: 240, appointment_type: 'service' }, { souplesse: true, flexDefaut: 30, amplitude: AMP }), { min: 780, max: 1020, flex: 240 });
  assert.equal(toleranceDe({ scheduled_start: null }, { souplesse: true, flexDefaut: 30 }), null);
});

test('construireArretsExistants sans opts.souplesse = comportement antérieur (tolérance ponctuelle), MÊME si le RDV porte un time_flex_minutes', () => {
  const [sans] = construireArretsExistants([{ ...rdv('j', 43.9, 1.9, 60, '08:30:00'), time_flex_minutes: 30 }]);
  assert.deepEqual(sans.fenetre, { debut: 510, fin: 510 });
  assert.deepEqual(sans.tolerance, { min: 510, max: 510, flex: 0 });
  const [sansFlag] = construireArretsExistants([{ ...rdv('j', 43.9, 1.9, 60, '08:30:00'), time_flex_minutes: 30 }], null, { flexDefaut: 30, amplitude: AMP });
  assert.deepEqual(sansFlag.tolerance, { min: 510, max: 510, flex: 0 }, 'flexDefaut sans souplesse:true ne desserre rien');
  const [avec] = construireArretsExistants([rdv('j', 43.9, 1.9, 60, '08:30:00')], null, { souplesse: true, flexDefaut: 30, amplitude: AMP });
  assert.deepEqual(avec.fenetre, { debut: 510, fin: 510 });
  assert.deepEqual(avec.tolerance, { min: 480, max: 540, flex: 30 });
});

test('construireArretsPourConsolidation : la fenêtre devient la tolérance (entrée de sequencerTournee)', () => {
  const rdvs = [
    { ...rdv('a', 43.9, 1.9, 60, '08:30:00'), time_flex_minutes: 30 },
    { ...rdv('b', 43.95, 2.0, 60, '14:00:00'), hour_confirmed_at: '2026-09-12T08:00:00Z' },
  ];
  const [a, b] = construireArretsPourConsolidation(rdvs, null, { souplesse: true, flexDefaut: 30, amplitude: AMP });
  assert.deepEqual(a.fenetre, { debut: 480, fin: 540 });
  assert.deepEqual(b.fenetre, { debut: 840, fin: 840 });
});

test('un figé n est jamais borné par l amplitude : il est là où il est (07:30 avant l ouverture reste 07:30)', () => {
  const t = toleranceDe({ scheduled_start: '07:30', duration_minutes: 60, appointment_type: 'maintenance', hour_confirmed_at: 'x' }, { souplesse: true, flexDefaut: 30, amplitude: AMP });
  assert.deepEqual(t, { min: 450, max: 450, flex: 0 });
  const [a] = construireArretsPourConsolidation([{ ...rdv('a', 43.9, 1.9, 60, '07:30:00'), hour_confirmed_at: 'x' }], null, { souplesse: true, flexDefaut: 30, amplitude: AMP });
  assert.deepEqual(a.fenetre, { debut: 450, fin: 450 });
});

test('la tolérance est ancrée sur l heure ANNONCÉE : décalé à 14:20, la plage reste celle promise (13:30-14:30)', () => {
  const t = toleranceDe({ scheduled_start: '14:20', announced_start: '14:00', duration_minutes: 60, time_flex_minutes: 30, appointment_type: 'maintenance' }, { souplesse: true, flexDefaut: 30, amplitude: AMP });
  assert.deepEqual(t, { min: 810, max: 870, flex: 30 });
  // et l'heure courante est toujours dans sa plage même si un décalage l'a poussée au bord
  const t2 = toleranceDe({ scheduled_start: '14:40', announced_start: '14:00', duration_minutes: 60, time_flex_minutes: 30, appointment_type: 'maintenance' }, { souplesse: true, flexDefaut: 30, amplitude: AMP });
  assert.equal(t2.max, 880);
});

test('arrondirHeureFigee : une heure définitive s annonce au 5 min supérieur (12:31 → 12:35, 08:40 → 08:40)', () => {
  assert.equal(arrondirHeureFigee(751), 755);
  assert.equal(arrondirHeureFigee(520), 520);
  assert.equal(arrondirHeureFigee(518), 520);
});
