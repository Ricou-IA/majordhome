// scripts/tournee/etat.test.mjs — état d'une journée et secteur déduit (src/lib/tournee/etat.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deduireSecteur, etatJournee, LIBELLES_ETAT } from '../../src/lib/tournee/etat.js';

const rdv = (type, secteur, status = 'scheduled') => ({ appointment_type: type, grand_secteur: secteur, status });

test('deduireSecteur : secteur majoritaire des entretiens/SAV, null sans entretien', () => {
  assert.equal(deduireSecteur([]), null);
  assert.equal(deduireSecteur(null), null);
  assert.equal(deduireSecteur([rdv('installation', 'Castres')]), null);
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres')]), 'Castres');
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres'), rdv('service', 'Gaillac'), rdv('maintenance', 'Castres')]), 'Castres');
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres', 'cancelled')]), null);
  assert.equal(deduireSecteur([rdv('maintenance', null)]), null);
  assert.equal(deduireSecteur([rdv('maintenance', '  ')]), null);
});

test('deduireSecteur : égalité → ordre alphabétique (déterministe)', () => {
  assert.equal(deduireSecteur([rdv('maintenance', 'Gaillac'), rdv('maintenance', 'Castres')]), 'Castres');
});

test('etatJournee : figée prime sur tout', () => {
  assert.equal(etatJournee({ rdvs: [rdv('maintenance', 'C')], verdict: 'non_pleine', figeeAt: '2026-09-28T06:20:00Z', etiquette: null }), 'figee');
  assert.equal(etatJournee({ rdvs: [], verdict: null, figeeAt: '2026-09-28T06:20:00Z', etiquette: null }), 'figee');
});

test('etatJournee : sans RDV ni étiquette = vide ; étiquetée sans RDV = ouverte', () => {
  assert.equal(etatJournee({ rdvs: [], verdict: 'sans_adaptable', figeeAt: null, etiquette: null }), 'vide');
  assert.equal(etatJournee({ rdvs: [rdv('maintenance', 'C', 'cancelled')], verdict: 'sans_adaptable', figeeAt: null, etiquette: null }), 'vide');
  assert.equal(etatJournee({ rdvs: [], verdict: 'sans_adaptable', figeeAt: null, etiquette: 'Castres' }), 'ouverte');
});

test('etatJournee : verdicts du moteur', () => {
  const rdvs = [rdv('maintenance', 'C')];
  assert.equal(etatJournee({ rdvs, verdict: 'non_pleine', figeeAt: null, etiquette: null }), 'ouverte');
  assert.equal(etatJournee({ rdvs, verdict: 'figeable', figeeAt: null, etiquette: null }), 'pleine');
  assert.equal(etatJournee({ rdvs, verdict: 'a_arbitrer', figeeAt: null, etiquette: null }), 'a_arbitrer');
  // une journée d'installations seules (aucun adaptable) reste « ouverte » : on peut y glisser un entretien
  assert.equal(etatJournee({ rdvs: [rdv('installation', null)], verdict: 'sans_adaptable', figeeAt: null, etiquette: null }), 'ouverte');
  // verdict inconnu (dépôt non configuré) → ouverte, jamais un état alarmant deviné
  assert.equal(etatJournee({ rdvs, verdict: null, figeeAt: null, etiquette: null }), 'ouverte');
});

test('LIBELLES_ETAT couvre exactement les cinq états', () => {
  assert.deepEqual(Object.keys(LIBELLES_ETAT).sort(), ['a_arbitrer', 'figee', 'ouverte', 'pleine', 'vide']);
});
