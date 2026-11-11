// scripts/souplesse.test.mjs — Run : node --test scripts/souplesse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libelleSouplesse, souplesseEffective, phraseAnnonce, souplessesProposees, optionSouplesse, erreurSouplesses, erreurDemiJournee } from '../src/lib/souplesse.js';

test('libellés et souplesse effective', () => {
  assert.equal(libelleSouplesse(0), 'figé');
  assert.equal(libelleSouplesse(30), '±30 min');
  assert.equal(libelleSouplesse(240), 'demi-journée');
  assert.equal(souplesseEffective({ appointment_type: 'maintenance', time_flex_minutes: 30, hour_confirmed_at: '2026-09-12' }), 0);
  assert.equal(souplesseEffective({ appointment_type: 'maintenance', time_flex_minutes: null }, 30), 30);
  assert.equal(souplesseEffective({ appointment_type: 'service', time_flex_minutes: 15 }, 30), 15);
  // Seuls Entretien et SAV sont adaptables : installation / VT / commercial = 0
  assert.equal(souplesseEffective({ appointment_type: 'installation', time_flex_minutes: 30 }, 30), 0);
  assert.equal(souplesseEffective({ appointment_type: 'rdv_technical' }, 30), 0);
});

test('phrase d annonce au client', () => {
  assert.equal(phraseAnnonce({ startTime: '08:15' }, 30, 'mar. 14 oct.'), 'mar. 14 oct. vers 08:15 (entre 07:45 et 08:45)');
  assert.equal(phraseAnnonce({ startTime: '14:00' }, 0, 'mar. 14 oct.'), 'mar. 14 oct. à 14:00 — heure ferme');
  assert.equal(phraseAnnonce({ startTime: '09:30' }, 240, 'mar. 14 oct.'), 'mar. 14 oct., dans la matinée (heure précisée la veille)');
});

test('phraseAnnonce demi-journée : la frontière matin/après-midi est celle de l org, pas midi en dur', () => {
  const demiJournee = { matin: [8, 13], apres_midi: [14, 18] };
  assert.equal(phraseAnnonce({ startTime: '12:30' }, 240, 'mar. 14 oct.', { demiJournee }), 'mar. 14 oct., dans la matinée (heure précisée la veille)');
  assert.equal(phraseAnnonce({ startTime: '12:30' }, 240, 'mar. 14 oct.'), 'mar. 14 oct., dans l’après-midi (heure précisée la veille)');
});

test('souplesses proposées par l org : catalogue fermé, figé toujours, défaut parmi les choix', () => {
  assert.deepEqual(souplessesProposees(null).map((o) => o.value), [0, 15, 30, 240]);
  assert.deepEqual(souplessesProposees({ souplesses_proposees: [60, 30, 17, 240] }).map((o) => o.value), [0, 30, 60, 240]);
  assert.equal(optionSouplesse(90).label, '±1 h 30');
  assert.equal(optionSouplesse(60).label, '±1 h');
  assert.equal(optionSouplesse(10).label, '±10 min');
  assert.equal(erreurSouplesses([0, 30, 240], 30), null);
  assert.match(erreurSouplesses([0, 30], 240), /défaut/);
  assert.match(erreurSouplesses([0], 0), /au moins/);
  assert.match(erreurSouplesses([0, 17], 17), /catalogue/);
});

test('bornes de la demi-journée', () => {
  assert.equal(erreurDemiJournee({ matin: [8, 12], apres_midi: [13, 18] }), null);
  assert.equal(erreurDemiJournee({ matin: [7.5, 12.5], apres_midi: [12.5, 17.5] }), null);
  assert.match(erreurDemiJournee({ matin: [8, 13], apres_midi: [12, 18] }), /après la fin du matin/);
  assert.match(erreurDemiJournee({ matin: [8, 12.25], apres_midi: [13, 18] }), /demi-heure/);
});
