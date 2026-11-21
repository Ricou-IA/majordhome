import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ordreDesCouloirs, placerEnCouloirs, classeDeCouloir, cssDesCouloirs, minutesDe,
} from '../src/lib/planningCouloirs.js';

const bloc = (id, personne, debut, fin, jour = '2026-11-16') => ({ id, personne, debut, fin, jour });
const ORDRE = ['antoine', 'ludovic', 'philippe'];

test('ordreDesCouloirs : techniciens d\'abord, puis les autres, ordre de la liste conservé', () => {
  const teamList = [
    { profileKey: 'antoine', kinds: { intervention: true, commercial: false } },
    { profileKey: 'eric', kinds: { intervention: false, commercial: true } },
    { profileKey: 'ludovic', kinds: { intervention: true, commercial: false } },
    { profileKey: 'philippe', kinds: { intervention: false, commercial: true } },
  ];
  assert.deepEqual(ordreDesCouloirs(teamList), ['antoine', 'ludovic', 'eric', 'philippe']);
});

test('une seule personne dans le jour : toute la largeur', () => {
  const p = placerEnCouloirs([bloc('a', 'ludovic', 480, 540)], ORDRE);
  assert.deepEqual(p.get('a'), { gauche: 0, droite: 0 });
});

test('la même personne garde le même côté, quel que soit l\'ordre d\'arrivée et l\'heure', () => {
  const p = placerEnCouloirs([
    bloc('l1', 'ludovic', 480, 540),
    bloc('a1', 'antoine', 600, 660),
    bloc('l2', 'ludovic', 840, 900),
    bloc('a2', 'antoine', 480, 540),
  ], ORDRE);
  assert.deepEqual(p.get('a1'), { gauche: 0, droite: 500 });
  assert.deepEqual(p.get('a2'), { gauche: 0, droite: 500 });
  assert.deepEqual(p.get('l1'), { gauche: 500, droite: 0 });
  assert.deepEqual(p.get('l2'), { gauche: 500, droite: 0 });
});

test('un bloc seul sur son créneau reste dans son couloir (il ne s\'étale pas)', () => {
  const p = placerEnCouloirs([
    bloc('a', 'antoine', 480, 540),
    bloc('p', 'philippe', 1020, 1080),
  ], ORDRE);
  assert.deepEqual(p.get('p'), { gauche: 500, droite: 0 });
});

test('les couloirs se comptent jour par jour : une personne absente ne prend pas de place', () => {
  const p = placerEnCouloirs([
    bloc('a', 'antoine', 480, 540, '2026-11-16'),
    bloc('l', 'ludovic', 480, 540, '2026-11-16'),
    bloc('p', 'philippe', 480, 540, '2026-11-16'),
    bloc('l2', 'ludovic', 480, 540, '2026-11-17'),
    bloc('p2', 'philippe', 480, 540, '2026-11-17'),
  ], ORDRE);
  assert.deepEqual(p.get('l'), { gauche: 333, droite: 333 });
  assert.deepEqual(p.get('p'), { gauche: 667, droite: 0 });
  assert.deepEqual(p.get('l2'), { gauche: 0, droite: 500 });
  assert.deepEqual(p.get('p2'), { gauche: 500, droite: 0 });
});

test('deux blocs de la même personne qui se chevauchent se partagent son couloir', () => {
  const p = placerEnCouloirs([
    bloc('a1', 'antoine', 810, 1020),
    bloc('a2', 'antoine', 810, 950),
    bloc('a3', 'antoine', 1030, 1080),
    bloc('l', 'ludovic', 480, 540),
  ], ORDRE);
  assert.deepEqual(p.get('a1'), { gauche: 0, droite: 750 });
  assert.deepEqual(p.get('a2'), { gauche: 250, droite: 500 });
  // Hors du chevauchement : tout le couloir.
  assert.deepEqual(p.get('a3'), { gauche: 0, droite: 500 });
});

test('des blocs qui se suivent sans se chevaucher ne se partagent rien', () => {
  const p = placerEnCouloirs([bloc('a1', 'antoine', 480, 540), bloc('a2', 'antoine', 540, 600)], ORDRE);
  assert.deepEqual(p.get('a1'), { gauche: 0, droite: 0 });
  assert.deepEqual(p.get('a2'), { gauche: 0, droite: 0 });
});

test('personne inconnue de l\'ordre après les connues, bloc sans personne tout à droite', () => {
  const p = placerEnCouloirs([
    bloc('x', null, 480, 540),
    bloc('z', 'zoe', 480, 540),
    bloc('a', 'antoine', 480, 540),
  ], ORDRE);
  assert.equal(p.get('a').gauche, 0);
  assert.equal(p.get('z').gauche, 333);
  assert.equal(p.get('x').gauche, 667);
});

test('un bloc sans durée garde une place', () => {
  const p = placerEnCouloirs([bloc('a', 'antoine', 480, 480), bloc('b', 'antoine', 480, 540)], ORDRE);
  assert.notDeepEqual(p.get('a'), p.get('b'));
});

test('cssDesCouloirs : une règle par place utilisée, sur le cadre des blocs et des bandes', () => {
  const c = classeDeCouloir({ gauche: 333, droite: 500 });
  assert.equal(c, 'mdh-c-333-500');
  const css = cssDesCouloirs([
    { classNames: ['mdh-flex', c] }, { classNames: [c] }, { classNames: ['mdh-c-0-0'] }, {},
  ]);
  assert.equal(css.split('\n').length, 2);
  assert.match(css, /\.fc-timegrid-event-harness:has\(> \.mdh-c-333-500\)/);
  assert.match(css, /\.fc-timegrid-bg-harness:has\(> \.mdh-c-333-500\)/);
  assert.match(css, /left:33\.3% !important;right:50% !important/);
});

test('minutesDe', () => {
  assert.equal(minutesDe('08:40:00'), 520);
  assert.equal(minutesDe('17:00'), 1020);
  assert.equal(minutesDe(null), null);
});
