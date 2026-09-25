// scripts/maintenance/digest-model.test.mjs — contenu de l'e-mail du soir (module pur)
// node --test scripts/maintenance/digest-model.test.mjs   (dans npm run audit:quality)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireDigest, digestHtml } from '../../src/lib/maintenance/digestModel.js';

const units = [
  { id: 'u2', name: 'Presse 2', sort_order: 2 },
  { id: 'u1', name: 'Ligne A', sort_order: 1 },
];
const tous = [1, 2, 3, 4, 5, 6, 7];
const tache = (id, unit_id, label, extra = {}) => ({
  id, unit_id, label, frequency_kind: 'weekdays', weekdays: tous, start_date: '2026-09-01', archived_at: null, ...extra,
});
const operators = [
  { id: 'o1', first_name: 'Kevin', locked_until: null },
  { id: 'o2', first_name: 'Léa', locked_until: '2026-09-25T17:00:00Z' },
];
const aujourdhui = '2026-09-25';
const maintenant = '2026-09-25T16:30:00Z'; // 18h30 Paris

test('tout à jour : aucune tâche en attente ni « pas pu faire »', () => {
  const tasks = [tache('t1', 'u1', 'Nettoyage')];
  const logs = [{ task_id: 't1', operator_id: 'o1', status: 'done', comment: null, due_date: aujourdhui, done_at: '2026-09-25T07:40:00Z' }];
  const d = construireDigest({ units, tasks, logs, operators: [operators[0]], aujourdhui, maintenant, orgName: 'Usine' });
  assert.equal(d.toutAJour, true);
  assert.match(d.sujet, /Tout est à jour/);
  assert.deepEqual(d.faitsParUnite, [{ unite: 'Ligne A', n: 1 }]);
  assert.deepEqual(d.enAttente, []);
});

test('tâches en attente triées du plus ancien retard, « pas pu faire » du jour, opérateurs bloqués', () => {
  const tasks = [
    tache('t1', 'u1', 'Nettoyage'),
    tache('t2', 'u2', 'Graissage', { frequency_kind: 'interval', interval_unit: 'week', interval_count: 1 }),
    tache('t3', 'u2', 'Contrôle huile'),
    tache('t4', 'u1', 'Archivée', { archived_at: '2026-09-02T00:00:00Z' }),
  ];
  const logs = [
    // t1 fait hier → dû aujourd'hui, pas fait
    { task_id: 't1', operator_id: 'o1', status: 'done', comment: null, due_date: '2026-09-24', done_at: '2026-09-24T07:00:00Z' },
    // t2 fait il y a 10 jours → dû il y a 3 jours
    { task_id: 't2', operator_id: 'o1', status: 'done', comment: null, due_date: '2026-09-15', done_at: '2026-09-15T07:00:00Z' },
    // t3 pas pu faire aujourd'hui
    { task_id: 't3', operator_id: 'o2', status: 'not_done', comment: 'Pas de bidon', due_date: aujourdhui, done_at: '2026-09-25T09:00:00Z' },
  ];
  const d = construireDigest({ units, tasks, logs, operators, aujourdhui, maintenant, orgName: 'Usine' });
  assert.equal(d.toutAJour, false);
  assert.match(d.sujet, /2 tâches en attente/);
  assert.deepEqual(d.enAttente.map((r) => [r.unite, r.tache, r.joursDeRetard]), [
    ['Presse 2', 'Graissage', 3],
    ['Ligne A', 'Nettoyage', 0],
  ]);
  assert.deepEqual(d.nonFaits, [{ unite: 'Presse 2', tache: 'Contrôle huile', operateur: 'Léa', commentaire: 'Pas de bidon' }]);
  assert.deepEqual(d.bloques, [{ prenom: 'Léa', jusqua: '19:00' }]);
  assert.deepEqual(d.faitsParUnite, []);
});

test('le HTML échappe les saisies des opérateurs', () => {
  const tasks = [tache('t1', 'u1', 'Nettoyage')];
  const logs = [{ task_id: 't1', operator_id: 'o1', status: 'not_done', comment: '<script>x</script>', due_date: aujourdhui, done_at: '2026-09-25T09:00:00Z' }];
  const html = digestHtml(construireDigest({ units, tasks, logs, operators, aujourdhui, maintenant, orgName: 'A & B' }));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('A &amp; B'));
});
