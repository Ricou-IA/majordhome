import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resumeDetachement, commandeSuitParDefaut, resumeGroupement, STATUT_ORDRE,
} from '../src/lib/chantierSplit.js';

// Cas GOUIN : borne facturée (q1), PAC acceptée (q2), variante refusée (q3) ; 1 RDV de septembre, 3 de novembre.
const quotes = [
  { id: 'q1', is_validated: true, quote_amount_ht: '1260.76' },
  { id: 'q2', is_validated: true, quote_amount_ht: 11540 },
  { id: 'q3', is_validated: false, quote_amount_ht: 10240.34 },
];
const appointments = [
  { id: 'a1', scheduled_date: '2026-09-18' },
  { id: 'a2', scheduled_date: '2026-11-03' },
  { id: 'a3', scheduled_date: '2026-11-04' },
  { id: 'a4', scheduled_date: '2026-11-05' },
];
const plannedOrder = { teamSize: 2, days: 3 };

test('resumeDetachement : PAC + 3 jours → deux colonnes justes, ok', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q2'], appointmentIds: ['a2', 'a3', 'a4'], movePlannedOrder: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.nouveau, { montant: 11540, jours: 3, devis: 1 });
  assert.deepEqual(r.origine, { montant: 1260.76, jours: 1, devis: 2 });
});

test('resumeDetachement : le devis refusé peut accompagner sans compter dans le montant', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q2', 'q3'], appointmentIds: [], movePlannedOrder: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.nouveau, { montant: 11540, jours: 0, devis: 2 });
  assert.deepEqual(r.origine, { montant: 1260.76, jours: 4, devis: 1 });
});

test('resumeDetachement : sélection vide', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: [], appointmentIds: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Choisissez au moins un devis validé à détacher.']);
});

test('resumeDetachement : aucun devis validé sélectionné', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q3'], appointmentIds: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Choisissez au moins un devis validé à détacher.']);
});

test(`resumeDetachement : l'origine doit garder un devis validé`, () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q1', 'q2'], appointmentIds: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, [`Le chantier d'origine doit garder au moins un devis validé.`]);
});

test('resumeDetachement : devis ou RDV inconnus du chantier', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q2', 'zz'], appointmentIds: ['a2', 'nope'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, [`Un devis sélectionné n'appartient pas à ce chantier.`, `Un jour sélectionné n'appartient pas à ce chantier.`]);
});

test('resumeDetachement : deux RDV le même jour comptent pour un jour', () => {
  const r = resumeDetachement(
    { quotes, appointments: [...appointments, { id: 'a5', scheduled_date: '2026-11-03' }], plannedOrder },
    { quoteIds: ['q2'], appointmentIds: ['a2', 'a5'] },
  );
  assert.equal(r.nouveau.jours, 1);
});

test('commandeSuitParDefaut : vrai quand les jours sélectionnés valent planned_days', () => {
  assert.equal(commandeSuitParDefaut({ teamSize: 2, days: 3 }, 3), true);
  assert.equal(commandeSuitParDefaut({ teamSize: 2, days: 3 }, 1), false);
  assert.equal(commandeSuitParDefaut({ teamSize: null, days: null }, 3), false);
  assert.equal(commandeSuitParDefaut(null, 0), false);
});

test('resumeGroupement : montants et devis additionnés, statut le plus avancé', () => {
  const cible = { linked_quotes_amount_ht: '1260.76', quotes_count: 1, validated_quotes_count: 1, chantier_status: 'facture' };
  const s1 = { linked_quotes_amount_ht: 11540, quotes_count: 2, validated_quotes_count: 1, chantier_status: 'planification' };
  const s2 = { linked_quotes_amount_ht: 0, quotes_count: 0, validated_quotes_count: 0, chantier_status: 'gagne' };
  assert.deepEqual(resumeGroupement(cible, [s1, s2]), { montant: 12800.76, devis: 3, devisValides: 2, statut: 'facture' });
  assert.deepEqual(resumeGroupement(s2, [s1]), { montant: 11540, devis: 2, devisValides: 1, statut: 'planification' });
});

test('STATUT_ORDRE : gagne < … < facture', () => {
  assert.deepEqual(STATUT_ORDRE, ['gagne', 'commande_a_faire', 'commande_recue', 'planification', 'realise', 'facture']);
});
