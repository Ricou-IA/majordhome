// scripts/tournee/auto-rdv.test.mjs — offre de l'auto-RDV (src/lib/tournee/auto-rdv.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bornesMois, demiJournees, empreinteJournee, journeesProposables, placerDansDemiJournee, creneauxPourContrat,
} from '../../src/lib/tournee/auto-rdv.js';
import { REGLAGES_DEFAUT } from '../../src/lib/tournee/reglages.js';

const reglages = { ...REGLAGES_DEFAUT };
const trajet10 = () => 10; // 10 min entre tout point

test('bornesMois : délai minimal et dernier jour du mois, jamais le mois suivant', () => {
  assert.deepEqual(bornesMois('2026-10-01', { delaiMinJours: 2 }), { debut: '2026-10-03', fin: '2026-10-31' });
  assert.deepEqual(bornesMois('2026-10-15'), { debut: '2026-10-17', fin: '2026-10-31' });
  // mois fini (le délai déborde) → bornes inversées, aucune journée
  const fin = bornesMois('2026-10-30', { delaiMinJours: 2 });
  assert.ok(fin.debut > fin.fin, JSON.stringify(fin));
  assert.deepEqual(bornesMois('2026-02-10', { delaiMinJours: 0 }), { debut: '2026-02-10', fin: '2026-02-28' });
});

test('demiJournees lit reglages.demi_journee', () => {
  assert.deepEqual(demiJournees(reglages), [
    { code: 'matin', debut: 8 * 60, fin: 12 * 60 },
    { code: 'apres_midi', debut: 13 * 60, fin: 18 * 60 },
  ]);
});

test('empreinteJournee : ids triés + heure, annulés exclus', () => {
  const rdvs = [
    { id: 'b', scheduled_start: '14:00:00', status: 'scheduled' },
    { id: 'a', scheduled_start: '09:30', status: 'scheduled' },
    { id: 'c', scheduled_start: '11:00', status: 'cancelled' },
  ];
  assert.equal(empreinteJournee(rdvs), 'a@09:30,b@14:00');
  assert.equal(empreinteJournee([]), '');
  assert.equal(empreinteJournee(null), '');
});

const journee = (date, rdvs = [], extra = {}) => ({
  date, technicienId: 't1', technicienNom: 'Lucas Martin', couleur: '#123',
  amplitude: { debut: 8 * 60, fin: 18 * 60 }, budgetMinutes: 480, rdvs, ...extra,
});
const rdv = (id, start, secteur = 'Castres', type = 'maintenance') => ({
  id, scheduled_start: start, duration_minutes: 60, appointment_type: type, status: 'scheduled',
  grand_secteur: secteur, lat: 43.6, lng: 2.24, time_flex_minutes: 30, hour_confirmed_at: null, announced_start: start,
});

test('journeesProposables : bornes du mois, figées exclues, secteur étiquette ou déduit', () => {
  const journees = [
    journee('2026-10-02', [rdv('a', '09:00')]),           // avant le délai
    journee('2026-10-05', [rdv('b', '09:00')]),           // déduite Castres
    journee('2026-10-06', []),                            // vide, étiquetée machine
    journee('2026-10-07', []),                            // vide, sans étiquette → non proposée
    journee('2026-10-08', [rdv('c', '09:00')]),           // figée
    journee('2026-11-02', [rdv('d', '09:00')]),           // mois suivant
  ];
  const etiquettes = [
    { date: '2026-10-06', team_member_id: 't1', grand_secteur: 'Gaillac', origine: 'machine', figee_at: null },
    { date: '2026-10-08', team_member_id: 't1', grand_secteur: null, origine: 'deduite', figee_at: '2026-10-01T05:20:00Z' },
  ];
  const out = journeesProposables({ journees, etiquettes, bornes: { debut: '2026-10-03', fin: '2026-10-31' } });
  assert.deepEqual(out.map((p) => [p.journee.date, p.secteur]), [['2026-10-05', 'Castres'], ['2026-10-06', 'Gaillac']]);
});

test('journeesProposables : bornes inversées → rien', () => {
  const out = journeesProposables({ journees: [journee('2026-10-31', [rdv('a', '09:00')])], etiquettes: [], bornes: { debut: '2026-11-01', fin: '2026-10-31' } });
  assert.deepEqual(out, []);
});

test('placerDansDemiJournee : arrivée et départ dans la demi-journée, sans décaler personne', () => {
  const ctx = {
    trajet: trajet10, depotKey: '43.9,2.1', amplitude: { debut: 480, fin: 1080 }, budgetMinutes: 510,
    pause: { minutes: 30, fenetre: [720, 840] }, trajetMaxMinutes: 45,
  };
  const candidat = { id: 'k', key: '43.6,2.24', dureeMinutes: 120 };
  const matin = { code: 'matin', debut: 480, fin: 720 };
  const r = placerDansDemiJournee({ arrets: [], candidat, demi: matin, ctx });
  assert.equal(r.faisable, true, r.raison);
  assert.ok(r.arriveeMinutes >= 480 && r.departMinutes <= 720, `${r.arriveeMinutes}-${r.departMinutes}`);
  // 4 h de travail ne tiennent pas dans un matin de 4 h avec 10 min de trajet
  const trop = placerDansDemiJournee({ arrets: [], candidat: { ...candidat, dureeMinutes: 240 }, demi: matin, ctx });
  assert.equal(trop.faisable, false);
  assert.ok(trop.raison, 'une raison est donnée');
});

test('creneauxPourContrat : secteur propre d’abord, matin avant après-midi, tronqué, empreinte portée', () => {
  const contrat = { id: 'c1', dureeMinutes: 60, lat: 43.6, lng: 2.24 };
  const proposables = [
    { journee: journee('2026-10-06', [rdv('a', '09:00', 'Gaillac')]), secteur: 'Gaillac', figee: false },
    { journee: journee('2026-10-05', [rdv('b', '09:00', 'Castres')]), secteur: 'Castres', figee: false },
  ];
  const { creneaux, refus } = creneauxPourContrat({
    contrat, proposables, depot: { lat: 43.9, lng: 2.1 }, reglages, trajet: trajet10, secteurContrat: 'Gaillac', maxCreneaux: 3,
  });
  assert.equal(creneaux.length, 3);
  assert.deepEqual(creneaux.slice(0, 2).map((c) => [c.date, c.demi, c.propre]), [['2026-10-06', 'matin', true], ['2026-10-06', 'apres_midi', true]]);
  assert.equal(creneaux[2].date, '2026-10-05');
  assert.ok(creneaux.every((c) => typeof c.empreinte === 'string' && c.id.split('|').length === 3));
  assert.equal(typeof refus, 'object');
  assert.equal(creneaux[0].debut.length, 5); // 'HH:MM'
});

test('creneauxPourContrat : sans secteur du contrat, tri par date puis coût', () => {
  const contrat = { id: 'c1', dureeMinutes: 60, lat: 43.6, lng: 2.24 };
  const proposables = [
    { journee: journee('2026-10-06', [rdv('a', '09:00', 'Gaillac')]), secteur: 'Gaillac', figee: false },
    { journee: journee('2026-10-05', [rdv('b', '09:00', 'Castres')]), secteur: 'Castres', figee: false },
  ];
  const { creneaux } = creneauxPourContrat({ contrat, proposables, depot: { lat: 43.9, lng: 2.1 }, reglages, trajet: trajet10 });
  assert.equal(creneaux[0].date, '2026-10-05');
  assert.ok(creneaux.every((c) => c.propre === false));
});
