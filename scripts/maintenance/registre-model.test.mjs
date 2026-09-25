// scripts/maintenance/registre-model.test.mjs — mise en forme du registre PDF (module pur)
// node --test scripts/maintenance/registre-model.test.mjs   (dans npm run audit:quality)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireRegistre } from '../../src/lib/maintenance/registreModel.js';

const units = [
  { id: 'u2', name: 'Presse 2', sort_order: 2 },
  { id: 'u1', name: 'Ligne A', sort_order: 1 },
];
const tasks = [
  { id: 't1', unit_id: 'u1', label: 'Nettoyage' },
  { id: 't2', unit_id: 'u2', label: 'Graissage' },
];
const operators = [{ id: 'o1', first_name: 'Kevin' }];

test('groupé par unité (ordre des unités), lignes chronologiques, heure de Paris', () => {
  const logs = [
    { task_id: 't1', unit_id: 'u1', operator_id: 'o1', status: 'done', comment: null, due_date: '2026-09-22', done_at: '2026-09-22T12:05:00Z' },
    { task_id: 't1', unit_id: 'u1', operator_id: 'o1', status: 'not_done', comment: 'Panne', due_date: '2026-09-21', done_at: '2026-09-21T07:40:00Z' },
    { task_id: 't2', unit_id: 'u2', operator_id: 'o9', status: 'done', comment: '', due_date: '2026-09-20', done_at: '2026-09-21T06:00:00Z' },
  ];
  const r = construireRegistre({ units, tasks, logs, operators, du: '2026-09-01', au: '2026-09-30' });
  assert.equal(r.total, 3);
  assert.equal(r.periode, 'du 01/09/2026 au 30/09/2026');
  assert.deepEqual(r.sections.map((s) => s.unite), ['Ligne A', 'Presse 2']);
  assert.deepEqual(r.sections[0].lignes, [
    { date: '21/09/2026', heure: '09:40', tache: 'Nettoyage', statut: 'Pas pu faire', operateur: 'Kevin', commentaire: 'Panne', echeance: '21/09/2026' },
    { date: '22/09/2026', heure: '14:05', tache: 'Nettoyage', statut: 'Fait', operateur: 'Kevin', commentaire: '', echeance: '22/09/2026' },
  ]);
  // Opérateur supprimé depuis : on n'invente rien, on le signale.
  assert.equal(r.sections[1].lignes[0].operateur, 'Opérateur inconnu');
});

test('registre vide : aucune section, total 0', () => {
  const r = construireRegistre({ units, tasks, logs: [], operators, du: '2026-09-01', au: '2026-09-30' });
  assert.deepEqual(r.sections, []);
  assert.equal(r.total, 0);
});
