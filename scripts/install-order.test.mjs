import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chevauche, fusionnerCreneau, basculerJournee, etatCommande, libelleCommande, joursDepuisRdv,
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

// ── basculerJournee ───────────────────────────────────────────────────────
const journeeLudovic = { id: 'l', date: '2026-09-23', startTime: '08:00', endTime: '17:00', duration: 540, technicianIds: ['ludovic'] };

test('bascule : journée vide → la personne est posée sur sa journée', () => {
  const out = basculerJournee([], journeeLudovic);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].technicianIds, ['ludovic']);
  assert.equal(out[0].endTime, '17:00');
});

test('bascule : deuxième personne le même jour → réunie sur le RDV existant (horaire du premier)', () => {
  const antoine = { id: 'a', date: '2026-09-23', startTime: '08:00', endTime: '16:00', duration: 480, technicianIds: ['antoine'] };
  const out = basculerJournee([antoine], journeeLudovic);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].technicianIds, ['antoine', 'ludovic']);
  assert.equal(out[0].endTime, '16:00');
});

test('bascule : re-cliquer une personne déjà posée la retire ; le brouillon reste pour l’autre', () => {
  const deux = { ...jourA, technicianIds: ['antoine', 'ludovic'] };
  const out = basculerJournee([deux], journeeLudovic);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].technicianIds, ['antoine']);
});

test('bascule : retirer la dernière personne supprime le brouillon du jour, les autres jours restent', () => {
  const autreJour = { id: 'x', date: '2026-09-24', startTime: '08:00', endTime: '17:00', technicianIds: ['ludovic'] };
  const out = basculerJournee([journeeLudovic, autreJour], { ...journeeLudovic, id: 'n' });
  assert.deepEqual(out.map((s) => s.id), ['x']);
});

test('bascule : la personne posée sur une demi-journée est retirée par un clic (pas de second brouillon)', () => {
  const matin = { id: 'm', date: '2026-09-23', startTime: '08:00', endTime: '12:00', technicianIds: ['ludovic'] };
  const out = basculerJournee([matin], journeeLudovic);
  assert.equal(out.length, 0);
});

test('bascule : sans personne → inchangé', () => {
  const out = basculerJournee([jourA], { ...journeeLudovic, technicianIds: [] });
  assert.deepEqual(out, [jourA]);
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

// ── joursDepuisRdv (RDV persistés → jours de commande) ────────────────────
// Cas GOUIN BATISTE (prod, 2026-09-30) : commande 2 pers. × 3 j, 4 jours posés à
// 2 techniciens, et pourtant « Il manque 3 jours » — les RDV bruts (scheduled_date,
// technician_ids) étaient passés tels quels à etatCommande, qui lit date/technicianIds.
const rdvGouin = [
  { id: 'r1', scheduled_date: '2026-09-15', scheduled_start: '08:00', technician_ids: ['antoine', 'ludovic'] },
  { id: 'r2', scheduled_date: '2026-09-16', scheduled_start: '08:00', technician_ids: ['antoine', 'ludovic'] },
  { id: 'r3', scheduled_date: '2026-09-17', scheduled_start: '08:00', technician_ids: ['antoine', 'ludovic'] },
  { id: 'r4', scheduled_date: '2026-09-18', scheduled_start: '08:00', technician_ids: ['antoine', 'ludovic'] },
];

test('joursDepuisRdv : mappe scheduled_date / technician_ids vers date / technicianIds', () => {
  assert.deepEqual(joursDepuisRdv(rdvGouin.slice(0, 1)), [
    { date: '2026-09-15', technicianIds: ['antoine', 'ludovic'] },
  ]);
});

test('joursDepuisRdv : RDV sans technicien → technicianIds vide, jamais undefined', () => {
  assert.deepEqual(joursDepuisRdv([{ scheduled_date: '2026-09-15' }]), [
    { date: '2026-09-15', technicianIds: [] },
  ]);
  assert.deepEqual(joursDepuisRdv(null), []);
});

test('etatCommande sur des RDV persistés : commande 2 pers. × 3 j, 4 jours posés = complète (GOUIN)', () => {
  const e = etatCommande({ teamSize: 2, days: 3 }, joursDepuisRdv(rdvGouin));
  assert.equal(e.joursPoses, 4);
  assert.equal(e.complete, true);
  assert.equal(e.message, null);
});

test('etatCommande sur des RDV persistés : un jour en sous-effectif est signalé', () => {
  const rdv = rdvGouin.map((r) => (r.id === 'r4' ? { ...r, technician_ids: ['antoine'] } : r));
  const e = etatCommande({ teamSize: 2, days: 3 }, joursDepuisRdv(rdv));
  assert.equal(e.complete, false);
  assert.equal(e.message, 'Il manque 1 personne le 18/09');
});

// ── libelleCommande ───────────────────────────────────────────────────────
test('libelleCommande', () => {
  assert.equal(libelleCommande({ teamSize: 2, days: 3 }), '2 pers. × 3 j');
  assert.equal(libelleCommande({ teamSize: 1, days: 1 }), '1 pers. × 1 j');
  assert.equal(libelleCommande({ teamSize: null, days: 2 }), '2 j');
  assert.equal(libelleCommande({ teamSize: 2, days: null }), '2 pers.');
  assert.equal(libelleCommande({ teamSize: null, days: null }), null);
});
