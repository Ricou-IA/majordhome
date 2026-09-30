// scripts/entretien-visit-status.test.mjs
// Tests de la dérivation du badge "Visite {année}" du modal entretien.
// Run : node --test scripts/entretien-visit-status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVisitBadgeStatus, statutVisiteAnnee, compterVisitesAnnee } from '../src/lib/entretienVisitStatus.js';

const YEAR = 2026;

test('visite année courante completed → realise', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'completed' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'realise');
});

test('visite année courante cancelled (refus du client) → refuse (tâche close, jamais « à planifier »)', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'cancelled' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'refuse');
  // Même avec une carte restée dans le Kanban : le refus fait foi.
  assert.equal(deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'cancelled' }], activeCard: { workflow_status: 'planifie' }, currentYear: YEAR }), 'refuse');
});

test('statutVisiteAnnee : réalisé, refusé par le client, sinon à faire', () => {
  assert.equal(statutVisiteAnnee({ current_year_visit_status: 'completed' }), 'realise');
  assert.equal(statutVisiteAnnee({ current_year_visit_status: 'cancelled' }), 'refuse');
  assert.equal(statutVisiteAnnee({ current_year_visit_status: null }), 'a_faire');
  assert.equal(statutVisiteAnnee({}), 'a_faire');
  assert.equal(statutVisiteAnnee(null), 'a_faire');
});

test('compterVisitesAnnee : un refus n est ni fait ni à faire, et sort du taux de réalisation', () => {
  const c = (s) => ({ current_year_visit_status: s });
  // Mayer au 30/09/2026 : 435 actifs = 181 réalisés + 13 refus + 241 sans visite.
  const mayer = [...Array(181).fill(c('completed')), ...Array(13).fill(c('cancelled')), ...Array(241).fill(c(null))];
  assert.deepEqual(compterVisitesAnnee(mayer), { total: 435, realises: 181, refuses: 13, aFaire: 241, tauxRealisation: 43 });
  // Que des refus : rien à faire, taux 0 sans division par zéro.
  assert.deepEqual(compterVisitesAnnee([c('cancelled')]), { total: 1, realises: 0, refuses: 1, aFaire: 0, tauxRealisation: 0 });
  assert.deepEqual(compterVisitesAnnee(null), { total: 0, realises: 0, refuses: 0, aFaire: 0, tauxRealisation: 0 });
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
