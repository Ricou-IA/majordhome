// scripts/tournee/auto-rdv.test.mjs — offre de l'auto-RDV (src/lib/tournee/auto-rdv.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bornesMois, demiJournees, empreinteJournee, journeesProposables, placerParSequencement, creneauxPourContrat,
} from '../../src/lib/tournee/auto-rdv.js';
import { REGLAGES_DEFAUT } from '../../src/lib/tournee/reglages.js';

const reglages = { ...REGLAGES_DEFAUT };
const trajet10 = () => 10; // 10 min entre tout point
const depot = { lat: 43.9, lng: 2.1 };

test('bornesMois : délai minimal et dernier jour du mois en cours', () => {
  assert.deepEqual(bornesMois('2026-10-01', { delaiMinJours: 2 }), { debut: '2026-10-03', fin: '2026-10-31' });
  assert.deepEqual(bornesMois('2026-10-15'), { debut: '2026-10-17', fin: '2026-10-31' });
  assert.deepEqual(bornesMois('2026-02-10', { delaiMinJours: 0 }), { debut: '2026-02-10', fin: '2026-02-28' });
  // le 24 il reste 7 jours : on ne prolonge pas encore
  assert.deepEqual(bornesMois('2026-10-24'), { debut: '2026-10-26', fin: '2026-10-31' });
});

test('bornesMois : fin de mois (moins de 7 jours restants) → prolongée au mois suivant', () => {
  assert.deepEqual(bornesMois('2026-09-29'), { debut: '2026-10-01', fin: '2026-10-31' }); // vécu : lien ouvert le 29, rien proposé
  assert.deepEqual(bornesMois('2026-10-30', { delaiMinJours: 2 }), { debut: '2026-11-01', fin: '2026-11-30' });
  assert.deepEqual(bornesMois('2026-12-28'), { debut: '2026-12-30', fin: '2027-01-31' });
  // prolongation désactivée → bornes inversées, aucune journée
  const sans = bornesMois('2026-10-30', { delaiMinJours: 2, prolongerSiResteMoins: 0 });
  assert.ok(sans.debut > sans.fin, JSON.stringify(sans));
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
  amplitude: { debut: 8 * 60, fin: 17 * 60 }, budgetMinutes: 480, rdvs, ...extra,
});
const rdv = (id, start, secteur = 'Castres', opts = {}) => ({
  id, scheduled_start: start, duration_minutes: 60, appointment_type: 'maintenance', status: 'scheduled',
  grand_secteur: secteur, lat: 43.6, lng: 2.24, time_flex_minutes: 30, hour_confirmed_at: null, announced_start: start, ...opts,
});
const contrat = { id: 'c1', dureeMinutes: 90, lat: 43.6, lng: 2.24 };
const matin = { code: 'matin', debut: 480, fin: 720 };
const aprem = { code: 'apres_midi', debut: 780, fin: 1080 };

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

test('placerParSequencement : journée vide, le contrat se pose dans la demi-journée, sans décalage', () => {
  const r = placerParSequencement({ journee: journee('2026-10-06'), contrat, demi: matin, depot, reglages, trajet: trajet10 });
  assert.equal(r.faisable, true, r.raison);
  assert.ok(r.arriveeMinutes >= 480 && r.departMinutes <= 720, `${r.arriveeMinutes}-${r.departMinutes}`);
  assert.deepEqual(r.decalages, []);
  // La demi-journée est un engagement de DÉBUT : 5 h commencées le matin finissent l'après-midi, c'est accepté…
  const long = placerParSequencement({ journee: journee('2026-10-06'), contrat: { ...contrat, dureeMinutes: 300 }, demi: matin, depot, reglages, trajet: trajet10 });
  assert.equal(long.faisable, true, long.raison);
  assert.ok(long.arriveeMinutes < 720 && long.departMinutes > 720);
  // …mais 10 h ne tiennent pas dans l'amplitude (8 h → 17 h).
  const trop = placerParSequencement({ journee: journee('2026-10-06'), contrat: { ...contrat, dureeMinutes: 600 }, demi: matin, depot, reglages, trajet: trajet10 });
  assert.equal(trop.faisable, false);
  assert.equal(trop.raison, 'demi_journee');
});

test('placerParSequencement : un voisin en souplesse demi-journée GLISSE pour faire de la place, et le décalage est renvoyé', () => {
  // Journée courte (8 h → 12 h). a posé à 10 h, souplesse demi-journée : peut aller de 8 h à 11 h.
  // Le contrat de 2 h ne tient pas après a (11h10 → 13h10 > 12 h) : il passe AVANT, et a glisse.
  const j = journee('2026-10-06', [rdv('a', '10:00', 'Castres', { time_flex_minutes: 240 })], { amplitude: { debut: 8 * 60, fin: 12 * 60 } });
  const r = placerParSequencement({ journee: j, contrat: { ...contrat, dureeMinutes: 120 }, demi: matin, depot, reglages, trajet: trajet10 });
  assert.equal(r.faisable, true, r.raison);
  assert.equal(r.decalages.length, 1, 'a est décalé');
  assert.equal(r.decalages[0].id, 'a');
  assert.equal(r.decalages[0].attendu, '10:00');
  assert.match(r.decalages[0].scheduled_start, /^\d{2}:\d{2}$/);
  assert.notEqual(r.decalages[0].scheduled_start, '10:00');
  assert.ok(r.arriveeMinutes < 600, 'le contrat passe avant a');
});

test('placerParSequencement : un voisin FIGÉ ne bouge jamais, le contrat se cale autour', () => {
  const j = journee('2026-10-06', [rdv('a', '09:00', 'Castres', { hour_confirmed_at: '2026-10-01T06:00:00Z', time_flex_minutes: 0 })]);
  const r = placerParSequencement({ journee: j, contrat, demi: matin, depot, reglages, trajet: trajet10 });
  assert.equal(r.faisable, true, r.raison);
  assert.deepEqual(r.decalages, []);
  assert.ok(r.arriveeMinutes >= 600 + 10, 'après a (9h-10h) + trajet');
});

test('placerParSequencement : deux RDV qui se chevauchent au-delà de leurs tolérances → refus « fenetre » (cas Ludovic du 26/10)', () => {
  const j = journee('2026-10-06', [
    rdv('a', '08:00', 'Castres', { duration_minutes: 90 }),
    rdv('b', '09:00', 'Castres', { duration_minutes: 90 }),
  ]);
  const r = placerParSequencement({ journee: j, contrat, demi: aprem, depot, reglages, trajet: trajet10 });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'fenetre');
});

test('placerParSequencement : trajet max sur le DÉTOUR ajouté (dépôt exempté)', () => {
  const loin = (a, b) => (a === b ? 0 : 60);
  const j = journee('2026-10-06', [rdv('a', '09:00', 'Castres', { lat: 44.5, lng: 3.0 })]);
  // a est le seul voisin (bord de journée) et il est à 60 min : tronçon brut > 45 → refus.
  const r = placerParSequencement({ journee: j, contrat, demi: aprem, depot, reglages, trajet: loin });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'trajet');
});

test('creneauxPourContrat : secteur propre d’abord (sans tenir compte de la casse), matin avant après-midi, tronqué, empreinte et décalages portés', () => {
  const proposables = [
    { journee: journee('2026-10-06', [rdv('a', '09:00', 'GAILLAC')]), secteur: 'GAILLAC', figee: false },
    { journee: journee('2026-10-05', [rdv('b', '09:00', 'Castres')]), secteur: 'Castres', figee: false },
  ];
  const { creneaux, refus } = creneauxPourContrat({
    contrat, proposables, depot, reglages, trajet: trajet10, secteurContrat: 'Gaillac', maxCreneaux: 3,
  });
  assert.equal(creneaux.length, 3);
  assert.deepEqual(creneaux.slice(0, 2).map((c) => [c.date, c.demi, c.propre]), [['2026-10-06', 'matin', true], ['2026-10-06', 'apres_midi', true]]);
  assert.equal(creneaux[2].date, '2026-10-05');
  assert.ok(creneaux.every((c) => typeof c.empreinte === 'string' && c.id.split('|').length === 3 && Array.isArray(c.decalages)));
  assert.equal(typeof refus, 'object');
  assert.equal(creneaux[0].debut.length, 5); // 'HH:MM'
});

test('bornesHorizon : délai minimal → horizon d’ouverture (agent téléphonique)', async () => {
  const { bornesHorizon } = await import('../../src/lib/tournee/auto-rdv.js');
  assert.deepEqual(bornesHorizon('2026-10-04', { delaiMinJours: 2, horizonJours: 45 }), { debut: '2026-10-06', fin: '2026-11-18' });
  assert.deepEqual(bornesHorizon('2026-12-20'), { debut: '2026-12-22', fin: '2027-02-03' });
});

test('journeesPourDate : date demandée — journée vide acceptée (ouvrir un créneau), figée exclue, hors horizon refusé', async () => {
  const { journeesPourDate } = await import('../../src/lib/tournee/auto-rdv.js');
  const bornes = { debut: '2026-10-06', fin: '2026-11-18' };
  const vide = journee('2026-10-20');
  const vide2 = journee('2026-10-20', [], { technicienId: 't2' });
  const amorcee = journee('2026-10-20', [rdv('r1', '08:00', 'Gaillac')], { technicienId: 't3' });
  const autreJour = journee('2026-10-21');
  const etiquettes = [{ date: '2026-10-20', team_member_id: 't2', grand_secteur: null, figee_at: '2026-10-19T10:00:00Z' }];
  const r = journeesPourDate({ journees: [vide, vide2, amorcee, autreJour], etiquettes, date: '2026-10-20', bornes, secteurContrat: 'Albi' });
  assert.equal(r.raison, null);
  assert.deepEqual(r.proposables.map((p) => [p.journee.technicienId, p.secteur]), [['t1', 'Albi'], ['t3', 'Gaillac']]);
  // sans secteur connu du contrat, la journée vide reste proposée, secteur null
  assert.equal(journeesPourDate({ journees: [vide], etiquettes: [], date: '2026-10-20', bornes }).proposables[0].secteur, null);
  assert.equal(journeesPourDate({ journees: [vide], etiquettes: [], date: '2026-11-30', bornes }).raison, 'date_hors_horizon');
  assert.equal(journeesPourDate({ journees: [vide], etiquettes: [], date: '2026-10-05', bornes }).raison, 'date_hors_horizon');
  assert.equal(journeesPourDate({ journees: [vide], etiquettes: [], date: 'demain', bornes }).raison, 'date_hors_horizon');
  assert.equal(journeesPourDate({ journees: [autreJour], etiquettes: [], date: '2026-10-20', bornes }).raison, 'aucune_journee');
});

test('creneauxPourContrat accepte une journée ouverte sans secteur (propre = false)', async () => {
  const r = creneauxPourContrat({
    contrat, proposables: [{ journee: journee('2026-10-20'), secteur: null }], depot, reglages, trajet: trajet10, secteurContrat: 'Albi',
  });
  assert.ok(r.creneaux.length >= 1, JSON.stringify(r.refus));
  assert.equal(r.creneaux[0].propre, false);
  assert.equal(r.creneaux[0].secteur, null);
});

// ── Agent téléphonique : journées vides en complément (Eric 2026-10-04 : « c'est un appel
//    entrant, s'il n'y a pas de créneaux on propose des jours vides ; le premier RDV fixe la zone »)
import { journeesSansSecteur } from '../../src/lib/tournee/auto-rdv.js';

test('journeesSansSecteur : journées sans étiquette ni entretien, non figées, dans les bornes', () => {
  const journees = [
    { date: '2026-10-06', technicienId: 'a', rdvs: [] },                                                    // vide → oui
    { date: '2026-10-06', technicienId: 'b', rdvs: [{ appointment_type: 'installation', status: 'scheduled' }] }, // pas d'entretien → oui
    { date: '2026-10-07', technicienId: 'a', rdvs: [{ appointment_type: 'maintenance', status: 'scheduled', grand_secteur: 'Albi' }] }, // secteur déduit → non
    { date: '2026-10-08', technicienId: 'a', rdvs: [] },                                                    // étiquetée → non (déjà proposable)
    { date: '2026-10-09', technicienId: 'a', rdvs: [] },                                                    // figée → non
    { date: '2026-10-05', technicienId: 'a', rdvs: [] },                                                    // avant les bornes → non
    { date: '2026-10-07', technicienId: 'b', rdvs: [{ appointment_type: 'maintenance', status: 'cancelled', grand_secteur: 'Albi' }] }, // entretien annulé → oui
  ];
  const etiquettes = [
    { date: '2026-10-08', team_member_id: 'a', grand_secteur: 'Lavaur', figee_at: null },
    { date: '2026-10-09', team_member_id: 'a', grand_secteur: null, figee_at: '2026-10-01T00:00:00Z' },
  ];
  const r = journeesSansSecteur({ journees, etiquettes, bornes: { debut: '2026-10-06', fin: '2026-10-31' }, secteur: 'Gaillac' });
  assert.deepEqual(r.map((p) => `${p.journee.date}|${p.journee.technicienId}`), ['2026-10-06|a', '2026-10-06|b', '2026-10-07|b']);
  assert.ok(r.every((p) => p.secteur === 'Gaillac' && p.figee === false));
  // complémentaire de journeesProposables : aucune journée dans les deux
  const prop = journeesProposables({ journees, etiquettes, bornes: { debut: '2026-10-06', fin: '2026-10-31' } });
  const cles = new Set(prop.map((p) => `${p.journee.date}|${p.journee.technicienId}`));
  assert.ok(r.every((p) => !cles.has(`${p.journee.date}|${p.journee.technicienId}`)));
});

test('journeesSansSecteur : secteur absent → null (la pose ne fixera pas de zone)', () => {
  const r = journeesSansSecteur({ journees: [{ date: '2026-10-06', technicienId: 'a', rdvs: [] }], etiquettes: [], bornes: { debut: '2026-10-01', fin: '2026-10-31' } });
  assert.equal(r[0].secteur, null);
});
