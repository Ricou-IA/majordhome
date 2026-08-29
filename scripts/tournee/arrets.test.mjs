// scripts/tournee/arrets.test.mjs
// Tests de la construction des arrêts déjà posés (src/lib/tournee/arrets.js)
// et de leur effet réel sur le séquencement.
// Run : node --test scripts/tournee/arrets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireArretsExistants } from '../../src/lib/tournee/arrets.js';
import { sequencerTournee } from '../../src/lib/tournee/sequence.js';

const rdv = (id, lat, lng, duree, start) => ({
  id, lat, lng, duration_minutes: duree, scheduled_start: start,
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

test('un RDV sans coordonnées est exclu du séquencement géographique', () => {
  const arrets = construireArretsExistants([
    rdv('avec', 43.9, 1.9, 60, '09:00'),
    { id: 'sans', lat: null, lng: null, duration_minutes: 60, scheduled_start: '10:00' },
  ]);
  assert.equal(arrets.length, 1);
  assert.equal(arrets[0].id, 'avec');
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
