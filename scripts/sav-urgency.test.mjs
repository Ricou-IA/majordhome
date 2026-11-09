import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAV_URGENCES, SAV_URGENCE_DEFAUT, urgenceDe, libelleUrgence, estUrgentATraiter, urgenceVisible, trierCartes,
} from '../src/lib/savUrgency.js';

const sav = (extra = {}) => ({ intervention_type: 'sav', workflow_status: 'demande', created_at: '2026-11-01', ...extra });

test('trois niveaux, le défaut en fait partie', () => {
  assert.deepEqual(SAV_URGENCES.map((u) => u.value), ['urgent', 'normal', 'peut_attendre']);
  assert.ok(SAV_URGENCES.some((u) => u.value === SAV_URGENCE_DEFAUT));
});

test('urgenceDe : absent ou inconnu se lit normal, un entretien n’a pas d’urgence', () => {
  assert.equal(urgenceDe(sav()), 'normal');
  assert.equal(urgenceDe(sav({ sav_urgency: null })), 'normal');
  assert.equal(urgenceDe(sav({ sav_urgency: 'critique' })), 'normal');
  assert.equal(urgenceDe(sav({ sav_urgency: 'urgent' })), 'urgent');
  assert.equal(urgenceDe({ intervention_type: 'entretien', sav_urgency: 'urgent' }), null);
  assert.equal(urgenceDe(null), null);
});

test('libelleUrgence', () => {
  assert.equal(libelleUrgence('urgent'), 'Urgent');
  assert.equal(libelleUrgence('peut_attendre'), 'Peut attendre');
  assert.equal(libelleUrgence(null), 'Normal');
});

test('estUrgentATraiter : seulement tant que la carte n’est ni planifiée ni réalisée', () => {
  for (const statut of ['demande', 'devis_envoye', 'pieces_commandees', 'a_planifier']) {
    assert.equal(estUrgentATraiter(sav({ sav_urgency: 'urgent', workflow_status: statut })), true, statut);
  }
  for (const statut of ['planifie', 'realise', 'facture']) {
    assert.equal(estUrgentATraiter(sav({ sav_urgency: 'urgent', workflow_status: statut })), false, statut);
  }
  assert.equal(estUrgentATraiter(sav({ sav_urgency: 'normal' })), false);
});

test('urgenceVisible : jamais pour normal, plus rien une fois réalisé', () => {
  assert.equal(urgenceVisible(sav()), false);
  assert.equal(urgenceVisible(sav({ sav_urgency: 'urgent' })), true);
  assert.equal(urgenceVisible(sav({ sav_urgency: 'peut_attendre', workflow_status: 'planifie' })), true);
  assert.equal(urgenceVisible(sav({ sav_urgency: 'urgent', workflow_status: 'realise' })), false);
  assert.equal(urgenceVisible({ intervention_type: 'entretien', workflow_status: 'a_planifier' }), false);
});

test('trierCartes : urgents à traiter en tête, puis date croissante, sans muter l’entrée', () => {
  const items = [
    sav({ id: 'vieux', created_at: '2026-10-01' }),
    sav({ id: 'urgent-recent', sav_urgency: 'urgent', created_at: '2026-11-08' }),
    { id: 'entretien', intervention_type: 'entretien', workflow_status: 'a_planifier', scheduled_date: '2026-09-15' },
    sav({ id: 'urgent-ancien', sav_urgency: 'urgent', created_at: '2026-11-02' }),
    sav({ id: 'urgent-planifie', sav_urgency: 'urgent', workflow_status: 'planifie', next_rdv_date: '2026-11-20' }),
  ];
  const copie = items.map((i) => i.id);
  assert.deepEqual(trierCartes(items).map((i) => i.id), ['urgent-ancien', 'urgent-recent', 'entretien', 'vieux', 'urgent-planifie']);
  assert.deepEqual(items.map((i) => i.id), copie);
  assert.deepEqual(trierCartes(null), []);
});

test('trierCartes : la date du RDV prime sur la date prévue puis la création', () => {
  const items = [
    sav({ id: 'b', created_at: '2026-01-01', next_rdv_date: '2026-12-01' }),
    sav({ id: 'a', created_at: '2026-06-01', scheduled_date: '2026-11-15' }),
  ];
  assert.deepEqual(trierCartes(items).map((i) => i.id), ['a', 'b']);
});
