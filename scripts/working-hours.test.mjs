import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURS_SEMAINE, versFormulaire, erreursHoraires, versPayload, resumeHoraires,
} from '../src/lib/workingHours.js';

// Valeur stockée en prod pour Antoine / Ludovic / Lucas (relue le 2026-10-04).
const TOURNEE = {
  monday: { start: '08:00', end: '17:00', active: true },
  tuesday: { start: '08:00', end: '17:00', active: true },
  wednesday: { start: '08:00', end: '17:00', active: true },
  thursday: { start: '08:00', end: '17:00', active: true },
  friday: { start: '08:00', end: '16:00', active: true },
  saturday: { active: false },
  sunday: { active: false },
};

test('JOURS_SEMAINE : 7 jours, lundi d\'abord', () => {
  assert.equal(JOURS_SEMAINE.length, 7);
  assert.equal(JOURS_SEMAINE[0].key, 'monday');
  assert.equal(JOURS_SEMAINE[6].key, 'sunday');
});

test('versFormulaire : jour chômé garde des heures éditables', () => {
  const f = versFormulaire(TOURNEE);
  assert.deepEqual(f.saturday, { active: false, start: '08:00', end: '17:00' });
  assert.deepEqual(f.friday, { active: true, start: '08:00', end: '16:00' });
});

test('versFormulaire : même lecture que les consommateurs (absent = chômé, sans active = travaillé)', () => {
  const f = versFormulaire({ monday: { start: '07:00', end: '12:00' } });
  assert.equal(f.monday.active, true);
  assert.equal(f.tuesday.active, false);
  assert.equal(versFormulaire(null).monday.active, false);
});

test('aller-retour : stocké → formulaire → payload = identique', () => {
  assert.deepEqual(versPayload(versFormulaire(TOURNEE)), TOURNEE);
});

test('erreursHoraires : valide = objet vide', () => {
  assert.deepEqual(erreursHoraires(versFormulaire(TOURNEE)), {});
});

test('erreursHoraires : début >= fin et format', () => {
  const f = versFormulaire(TOURNEE);
  f.monday.start = '17:00';
  f.tuesday.end = '8:00';
  f.wednesday.end = '24:00';
  const e = erreursHoraires(f);
  assert.equal(e.monday, 'Le début doit précéder la fin');
  assert.equal(e.tuesday, 'Heure au format HH:MM');
  assert.equal(e.wednesday, 'Heure au format HH:MM');
  assert.equal(e.thursday, undefined);
});

test('erreursHoraires : un jour chômé n\'est pas contrôlé', () => {
  const f = versFormulaire(TOURNEE);
  f.saturday = { active: false, start: '', end: '' };
  assert.deepEqual(erreursHoraires(f), {});
});

test('versPayload : jour chômé sans heures', () => {
  const f = versFormulaire(TOURNEE);
  f.saturday.start = '09:00';
  assert.deepEqual(versPayload(f).saturday, { active: false });
});

test('resumeHoraires : regroupe les jours consécutifs', () => {
  assert.equal(resumeHoraires(TOURNEE), 'Lun–Jeu 08:00–17:00 · Ven 08:00–16:00');
});

test('resumeHoraires : ne regroupe pas des jours non consécutifs', () => {
  assert.equal(
    resumeHoraires({ monday: TOURNEE.monday, wednesday: TOURNEE.monday }),
    'Lun 08:00–17:00 · Mer 08:00–17:00',
  );
});

test('resumeHoraires : aucun jour', () => {
  assert.equal(resumeHoraires({}), 'Aucun jour travaillé');
});
