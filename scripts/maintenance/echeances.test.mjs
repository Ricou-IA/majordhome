// scripts/maintenance/echeances.test.mjs — règle d'échéance du module Maintenance
// node --test scripts/maintenance/echeances.test.mjs   (dans npm run audit:quality)
//
// Ce module est la SEULE définition de « dû / en retard » : borne, suivi, e-mail du
// soir et registre l'importent. Tout écart de règle se teste ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jourParis, ajouterJours, ajouterMois, jourIso,
  prochaineEcheance, etatDuJour, dernierLogParTache, ponctualite, decrireFrequence, tableauDuJour,
} from '../../src/lib/maintenance/echeances.js';

const semaine = (jours, start = '2026-09-21') => ({
  frequency_kind: 'weekdays', weekdays: jours, start_date: start, archived_at: null,
});
const intervalle = (n, unit, start = '2026-09-21') => ({
  frequency_kind: 'interval', interval_count: n, interval_unit: unit, start_date: start, archived_at: null,
});
// done_at à 10h Paris (08:00Z en heure d'été) : jour Paris = jour indiqué.
const log = (jour, status = 'done') => ({ status, done_at: `${jour}T08:00:00Z` });

test('jourParis : bascule de fuseau été / hiver', () => {
  assert.equal(jourParis('2026-10-24T22:30:00Z'), '2026-10-25'); // UTC+2
  assert.equal(jourParis('2026-10-25T22:30:00Z'), '2026-10-25'); // UTC+1 → 23:30
  assert.equal(jourParis('2026-10-25T23:30:00Z'), '2026-10-26');
  assert.equal(jourParis(new Date('2026-01-01T12:00:00Z')), '2026-01-01');
});

test('arithmétique de jours et de mois (ancrage fin de mois)', () => {
  assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01');
  assert.equal(ajouterJours('2026-03-01', -1), '2026-02-28');
  assert.equal(ajouterMois('2027-01-31', 1), '2027-02-28');
  assert.equal(ajouterMois('2028-01-31', 1), '2028-02-29');
  assert.equal(ajouterMois('2026-11-30', 3), '2027-02-28');
  assert.equal(ajouterMois('2026-05-15', 12), '2027-05-15');
  assert.equal(jourIso('2026-09-21'), 1); // lundi
  assert.equal(jourIso('2026-09-27'), 7); // dimanche
});

test('jours cochés sans historique : premier jour coché à partir de la date de début', () => {
  assert.equal(prochaineEcheance(semaine([1, 3, 5], '2026-09-22'), null), '2026-09-23'); // mar → mer
  assert.equal(prochaineEcheance(semaine([1, 2, 3, 4, 5, 6, 7], '2026-09-22'), null), '2026-09-22');
});

test('jours cochés : après un « fait », prochain jour coché strictement après le jour du log', () => {
  const t = semaine([1, 3, 5]);
  assert.equal(prochaineEcheance(t, log('2026-09-21')), '2026-09-23'); // lun → mer
  assert.equal(prochaineEcheance(t, log('2026-09-25')), '2026-09-28'); // ven → lun
  // Fait un mardi (en retard sur lundi) : repart au mercredi, pas d'empilement.
  assert.equal(prochaineEcheance(t, log('2026-09-22')), '2026-09-23');
});

test('retard non empilé : une seule échéance en retard, avec son nombre de jours', () => {
  const t = semaine([1, 2, 3, 4, 5, 6, 7]);
  const e = etatDuJour(t, log('2026-09-21'), '2026-09-25'); // dû le 22, on est le 25
  assert.deepEqual(e, { etat: 'en_retard', echeance: '2026-09-22', joursDeRetard: 3 });
});

test('« pas pu faire » ⇒ la tâche revient le lendemain, quelle que soit la fréquence', () => {
  assert.equal(prochaineEcheance(semaine([1]), log('2026-09-21', 'not_done')), '2026-09-22');
  assert.equal(prochaineEcheance(intervalle(2, 'week'), log('2026-09-21', 'not_done')), '2026-09-22');
  assert.equal(prochaineEcheance(intervalle(1, 'month'), log('2026-09-30', 'not_done')), '2026-10-01');
});

test('intervalles : depuis la date de réalisation effective', () => {
  assert.equal(prochaineEcheance(intervalle(3, 'day'), null), '2026-09-21');
  assert.equal(prochaineEcheance(intervalle(3, 'day'), log('2026-09-24')), '2026-09-27');
  assert.equal(prochaineEcheance(intervalle(2, 'week'), log('2026-09-24')), '2026-10-08');
  assert.equal(prochaineEcheance(intervalle(1, 'month'), log('2027-01-31')), '2027-02-28');
});

test('jamais due avant sa date de début (changement de date après des réalisations)', () => {
  const t = intervalle(1, 'day', '2026-10-15');
  assert.equal(prochaineEcheance(t, log('2026-09-24')), '2026-10-15');
  assert.deepEqual(etatDuJour(t, null, '2026-09-25'), { etat: 'a_venir', echeance: '2026-10-15', joursDeRetard: 0 });
});

test('changement de fréquence après des réalisations : nouvelle règle depuis le dernier log', () => {
  const avant = intervalle(1, 'week');
  const apres = semaine([5]);
  const dernier = log('2026-09-21');
  assert.equal(prochaineEcheance(avant, dernier), '2026-09-28');
  assert.equal(prochaineEcheance(apres, dernier), '2026-09-25');
});

test('tâche archivée : jamais due', () => {
  const t = { ...semaine([1, 2, 3, 4, 5]), archived_at: '2026-09-01T00:00:00Z' };
  assert.equal(prochaineEcheance(t, null), null);
  assert.equal(etatDuJour(t, null, '2026-09-25').etat, 'archivee');
});

test('état du jour : à faire / à venir', () => {
  const t = semaine([1, 2, 3, 4, 5]);
  assert.equal(etatDuJour(t, log('2026-09-24'), '2026-09-25').etat, 'a_faire');
  assert.equal(etatDuJour(t, log('2026-09-25'), '2026-09-25').etat, 'a_venir');
});

test('dernier log par tâche = le plus récent par done_at', () => {
  const m = dernierLogParTache([
    { task_id: 'a', status: 'done', done_at: '2026-09-20T08:00:00Z' },
    { task_id: 'a', status: 'not_done', done_at: '2026-09-22T08:00:00Z' },
    { task_id: 'b', status: 'done', done_at: '2026-09-21T08:00:00Z' },
    { task_id: 'a', status: 'done', done_at: '2026-09-21T08:00:00Z' },
  ]);
  assert.equal(m.get('a').status, 'not_done');
  assert.equal(m.get('b').done_at, '2026-09-21T08:00:00Z');
});

test('ponctualité : réalisations faites au plus tard à leur échéance', () => {
  const p = ponctualite([
    { status: 'done', due_date: '2026-09-21', done_at: '2026-09-21T08:00:00Z' },
    { status: 'done', due_date: '2026-09-21', done_at: '2026-09-23T08:00:00Z' },
    { status: 'done', due_date: '2026-09-22', done_at: '2026-09-22T21:30:00Z' }, // 23:30 Paris
    { status: 'not_done', due_date: '2026-09-22', done_at: '2026-09-22T08:00:00Z' },
  ]);
  assert.deepEqual(p, { faits: 3, aLHeure: 2, taux: 2 / 3, nonFaits: 1 });
  assert.deepEqual(ponctualite([]), { faits: 0, aLHeure: 0, taux: null, nonFaits: 0 });
});

test('tableau du jour : retards à part, à faire et faites par unité, archivés ignorés', () => {
  const units = [
    { id: 'u1', name: 'Ligne A', sort_order: 1 },
    { id: 'u2', name: 'Presse', sort_order: 2 },
    { id: 'u3', name: 'Ancienne', sort_order: 3, archived_at: '2026-01-01T00:00:00Z' },
  ];
  const tous = [1, 2, 3, 4, 5, 6, 7];
  const tasks = [
    { id: 't1', unit_id: 'u1', label: 'Nettoyage', ...semaine(tous) },
    { id: 't2', unit_id: 'u1', label: 'Graissage', ...intervalle(1, 'week') },
    { id: 't3', unit_id: 'u2', label: 'Huile', ...semaine(tous) },
    { id: 't4', unit_id: 'u3', label: 'Fantôme', ...semaine(tous) },
    { id: 't5', unit_id: 'u2', label: 'Hors service', ...semaine(tous), archived_at: '2026-01-01T00:00:00Z' },
  ];
  const faitAujourdhui = { task_id: 't3', status: 'done', done_at: '2026-09-25T07:00:00Z' };
  const derniersLogs = [
    { task_id: 't1', status: 'done', done_at: '2026-09-24T07:00:00Z' }, // dû aujourd'hui
    { task_id: 't2', status: 'done', done_at: '2026-09-15T07:00:00Z' }, // dû le 22 → 3 j de retard
    faitAujourdhui,
  ];
  const r = tableauDuJour({ units, tasks, derniersLogs, logsDuJour: [faitAujourdhui], aujourdhui: '2026-09-25' });
  assert.deepEqual(r.enRetard.map((x) => [x.tache.id, x.joursDeRetard]), [['t2', 3]]);
  assert.deepEqual(r.unites.map((g) => [g.unite.id, g.aFaire.map((x) => x.tache.id), g.faites.map((x) => x.tache.id)]), [
    ['u1', ['t1'], []],
    ['u2', [], ['t3']],
  ]);
});

test('description lisible de la fréquence', () => {
  assert.equal(decrireFrequence(semaine([1, 2, 3, 4, 5, 6, 7])), 'Tous les jours');
  assert.equal(decrireFrequence(semaine([1, 2, 3, 4, 5])), 'Du lundi au vendredi');
  assert.equal(decrireFrequence(semaine([1, 3, 5])), 'Lun, Mer, Ven');
  assert.equal(decrireFrequence(intervalle(1, 'week')), 'Toutes les semaines');
  assert.equal(decrireFrequence(intervalle(2, 'week')), 'Toutes les 2 semaines');
  assert.equal(decrireFrequence(intervalle(1, 'day')), 'Tous les jours');
  assert.equal(decrireFrequence(intervalle(10, 'day')), 'Tous les 10 jours');
  assert.equal(decrireFrequence(intervalle(3, 'month')), 'Tous les 3 mois');
});
