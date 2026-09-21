import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chevauche, fusionnerCreneau, etatCommande, libelleCommande,
} from '../src/lib/installOrder.js';

// ── chevauche ─────────────────────────────────────────────────────────────
test('chevauche : deux journées entières se chevauchent', () => {
  assert.equal(chevauche({ startTime: '08:00', endTime: '17:00' }, { startTime: '08:00', endTime: '17:00' }), true);
});

test('chevauche : 9h-10h et 14h-15h ne se chevauchent pas', () => {
  assert.equal(chevauche({ startTime: '09:00', endTime: '10:00' }, { startTime: '14:00', endTime: '15:00' }), false);
});

test('chevauche : bornes jointives (10h-12h / 12h-14h) = pas de chevauchement', () => {
  assert.equal(chevauche({ startTime: '10:00', endTime: '12:00' }, { startTime: '12:00', endTime: '14:00' }), false);
});

test('chevauche : endTime absent ⇒ instant, inclus s’il tombe dans l’autre', () => {
  assert.equal(chevauche({ startTime: '09:30', endTime: null }, { startTime: '09:00', endTime: '10:00' }), true);
  assert.equal(chevauche({ startTime: '11:00', endTime: null }, { startTime: '09:00', endTime: '10:00' }), false);
});

// ── fusionnerCreneau ──────────────────────────────────────────────────────
const jourA = { id: 'a', date: '2026-09-23', startTime: '08:00', endTime: '17:00', duration: 540, technicianIds: ['antoine'] };

test('fusion : même jour, horaire qui chevauche → union des personnes, horaire existant gardé', () => {
  const out = fusionnerCreneau([jourA], { id: 'b', date: '2026-09-23', startTime: '08:30', endTime: '17:30', duration: 540, technicianIds: ['ludovic'] });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].technicianIds, ['antoine', 'ludovic']);
  assert.equal(out[0].startTime, '08:00');
  assert.equal(out[0].endTime, '17:00');
  assert.equal(out[0].id, 'a');
});

test('fusion : la même personne deux fois ne se duplique pas', () => {
  const out = fusionnerCreneau([jourA], { id: 'b', date: '2026-09-23', startTime: '08:00', endTime: '17:00', technicianIds: ['antoine'] });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].technicianIds, ['antoine']);
});

test('fusion : même jour sans chevauchement → deux créneaux (SAV 9h puis 14h)', () => {
  const sav9 = { id: 's1', date: '2026-09-23', startTime: '09:00', endTime: '10:00', technicianIds: ['antoine'] };
  const out = fusionnerCreneau([sav9], { id: 's2', date: '2026-09-23', startTime: '14:00', endTime: '15:00', technicianIds: ['ludovic'] });
  assert.equal(out.length, 2);
});

test('fusion : date différente → ajouté', () => {
  const out = fusionnerCreneau([jourA], { id: 'b', date: '2026-09-24', startTime: '08:00', endTime: '17:00', technicianIds: ['antoine'] });
  assert.equal(out.length, 2);
});

test('fusion : créneau sans personne → ajouté tel quel (le filet « Qui prend ce RDV ? » s’en charge)', () => {
  const out = fusionnerCreneau([jourA], { id: 'b', date: '2026-09-23', startTime: '08:00', endTime: '17:00', technicianIds: [] });
  assert.equal(out.length, 2);
});

test('fusion : ne mute pas l’entrée', () => {
  const entree = [{ ...jourA, technicianIds: ['antoine'] }];
  fusionnerCreneau(entree, { id: 'b', date: '2026-09-23', startTime: '08:00', endTime: '17:00', technicianIds: ['ludovic'] });
  assert.deepEqual(entree[0].technicianIds, ['antoine']);
});

// ── etatCommande ──────────────────────────────────────────────────────────
test('etatCommande : commande non renseignée → jamais incomplet, jours attendus = jours posés', () => {
  const e = etatCommande({ teamSize: null, days: null }, [{ date: '2026-09-23', technicianIds: ['a'] }]);
  assert.equal(e.complete, true);
  assert.equal(e.joursAttendus, 1);
  assert.equal(e.joursPoses, 1);
  assert.equal(e.message, null);
});

test('etatCommande : 2 × 2 complète', () => {
  const e = etatCommande({ teamSize: 2, days: 2 }, [
    { date: '2026-09-23', technicianIds: ['a', 'b'] },
    { date: '2026-09-24', technicianIds: ['a', 'b'] },
  ]);
  assert.equal(e.complete, true);
  assert.deepEqual(e.joursIncomplets, []);
  assert.equal(e.message, null);
});

test('etatCommande : il manque un jour', () => {
  const e = etatCommande({ teamSize: 1, days: 3 }, [
    { date: '2026-09-23', technicianIds: ['a'] },
    { date: '2026-09-24', technicianIds: ['a'] },
  ]);
  assert.equal(e.complete, false);
  assert.equal(e.joursPoses, 2);
  assert.equal(e.message, 'Il manque 1 jour');
});

test('etatCommande : il manque une personne un jour donné', () => {
  const e = etatCommande({ teamSize: 2, days: 1 }, [{ date: '2026-09-23', technicianIds: ['a'] }]);
  assert.equal(e.complete, false);
  assert.deepEqual(e.joursIncomplets, [{ date: '2026-09-23', personnes: 1, attendues: 2 }]);
  assert.equal(e.message, 'Il manque 1 personne le 23/09');
});

test('etatCommande : jours ET personnes manquants, pluriels', () => {
  const e = etatCommande({ teamSize: 3, days: 4 }, [
    { date: '2026-09-23', technicianIds: ['a'] },
    { date: '2026-09-24', technicianIds: ['a', 'b', 'c'] },
  ]);
  assert.equal(e.message, 'Il manque 2 jours et 2 personnes le 23/09');
});

test('etatCommande : deux passages le même jour comptent pour un jour posé', () => {
  const e = etatCommande({ teamSize: 1, days: 1 }, [
    { date: '2026-09-23', technicianIds: ['a'] },
    { date: '2026-09-23', technicianIds: ['b'] },
  ]);
  assert.equal(e.joursPoses, 1);
  assert.equal(e.complete, true);
});

test('etatCommande : trop de jours posés n’est pas une erreur', () => {
  const e = etatCommande({ teamSize: 1, days: 1 }, [
    { date: '2026-09-23', technicianIds: ['a'] },
    { date: '2026-09-24', technicianIds: ['a'] },
  ]);
  assert.equal(e.complete, true);
  assert.equal(e.joursPoses, 2);
});

// ── libelleCommande ───────────────────────────────────────────────────────
test('libelleCommande', () => {
  assert.equal(libelleCommande({ teamSize: 2, days: 3 }), '2 pers. × 3 j');
  assert.equal(libelleCommande({ teamSize: 1, days: 1 }), '1 pers. × 1 j');
  assert.equal(libelleCommande({ teamSize: null, days: 2 }), '2 j');
  assert.equal(libelleCommande({ teamSize: 2, days: null }), '2 pers.');
  assert.equal(libelleCommande({ teamSize: null, days: null }), null);
});
