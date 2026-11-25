// Tests du module pur src/lib/joursIntervention.js — `node --test scripts/jours-intervention.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joursParChantier } from '../src/lib/joursIntervention.js';

const rdv = (id, chantierId, date, extra = {}) => ({
  id, chantier_id: chantierId, scheduled_date: date, scheduled_start: '08:00:00',
  appointment_type: 'installation', status: 'scheduled', ...extra,
});
const chantiers = [{ id: 'A', label: 'Devis' }, { id: 'B', label: 'Devis' }];

test('cas CONDOM : le chantier du RDV ouvert d\'abord, l\'autre chantier ensuite', () => {
  const g = joursParChantier([rdv('r24', 'B', '2026-12-24'), rdv('r16', 'A', '2026-12-16')], chantiers, 'A');
  assert.deepEqual(g.map((x) => [x.chantierId, x.courant, x.jours.map((j) => j.id)]), [
    ['A', true, ['r16']],
    ['B', false, ['r24']],
  ]);
  assert.equal(g[1].chantier.id, 'B');
});

test('jours d\'un même chantier dans l\'ordre chronologique', () => {
  const g = joursParChantier([rdv('j3', 'A', '2026-12-18'), rdv('j1', 'A', '2026-12-16'), rdv('j2', 'A', '2026-12-17')], chantiers, 'A');
  assert.deepEqual(g[0].jours.map((j) => j.id), ['j1', 'j2', 'j3']);
});

test('RDV annulés, absences et autres types écartés', () => {
  const g = joursParChantier([
    rdv('ok', 'A', '2026-12-16'),
    rdv('annule', 'A', '2026-12-17', { status: 'cancelled' }),
    rdv('absent', 'A', '2026-12-18', { status: 'no_show' }),
    rdv('vt', null, '2026-10-09', { appointment_type: 'rdv_technical' }),
  ], chantiers, 'A');
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].jours.map((j) => j.id), ['ok']);
});

test('chantier courant sans jour : présent, vide ; autre chantier sans jour : absent', () => {
  const g = joursParChantier([], chantiers, 'A');
  assert.deepEqual(g.map((x) => [x.chantierId, x.jours.length]), [['A', 0]]);
});

test('installation sans chantier rattaché : groupe à part (chantierId null)', () => {
  const g = joursParChantier([rdv('libre', null, '2026-12-20')], chantiers, 'A');
  assert.deepEqual(g.map((x) => [x.chantierId, x.chantier]), [['A', chantiers[0]], [null, null]]);
});

test('listes absentes : aucun plantage', () => {
  assert.deepEqual(joursParChantier(undefined, undefined, null), []);
});
