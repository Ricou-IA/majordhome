// scripts/entretien-visit-status.test.mjs
// Tests de la dérivation du badge "Visite {année}" du modal entretien.
// Run : node --test scripts/entretien-visit-status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVisitBadgeStatus } from '../src/lib/entretienVisitStatus.js';

const YEAR = 2026;

test('visite année courante completed → realise', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'completed' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'realise');
});

test('visite année courante cancelled (refus) → non_realise (tâche close)', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'cancelled' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'non_realise');
});

test('visite année courante skipped → non_realise', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'skipped' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'non_realise');
});

test('aucune visite courante + carte planifie → planifie', () => {
  const r = deriveVisitBadgeStatus({ visits: [], activeCard: { workflow_status: 'planifie' }, currentYear: YEAR });
  assert.equal(r, 'planifie');
});

test('aucune visite courante + aucune carte → a_planifier', () => {
  const r = deriveVisitBadgeStatus({ visits: [], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'a_planifier');
});

test('aucune visite courante + carte a_planifier → a_planifier', () => {
  const r = deriveVisitBadgeStatus({ visits: [], activeCard: { workflow_status: 'a_planifier' }, currentYear: YEAR });
  assert.equal(r, 'a_planifier');
});

test('seulement une visite d\'une année passée → a_planifier (on ne regarde que l\'année courante)', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2025, status: 'completed' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'a_planifier');
});

test('valeurs par défaut robustes (args vides)', () => {
  const r = deriveVisitBadgeStatus({ currentYear: YEAR });
  assert.equal(r, 'a_planifier');
});
