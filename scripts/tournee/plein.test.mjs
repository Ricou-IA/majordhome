// scripts/tournee/plein.test.mjs — Run : node --test scripts/tournee/plein.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluerRemplissage, verdictJournee } from '../../src/lib/tournee/plein.js';
import { construireArretsPourConsolidation } from '../../src/lib/tournee/arrets.js';

const AMP = { debut: 480, fin: 1080 };
const DEPOT = { lat: 43.9119, lng: 1.8898 };
const M = { '43.912,1.890|43.795,1.605': 38, '43.795,1.605|43.912,1.890': 40, '43.912,1.890|43.942,1.721': 21, '43.942,1.721|43.912,1.890': 23, '43.795,1.605|43.942,1.721': 39, '43.942,1.721|43.795,1.605': 38 };
const trajet = (a, b) => (a === b ? 0 : M[`${a}|${b}`]);
const jour1509 = (dEk, dGo) => construireArretsPourConsolidation([
  { id: 'EKOUE', lat: 43.79476, lng: 1.604971, duration_minutes: dEk, scheduled_start: '08:00', appointment_type: 'maintenance' },
  { id: 'GOMES', lat: 43.941915, lng: 1.720688, duration_minutes: dGo, scheduled_start: '12:30', appointment_type: 'maintenance' },
], DEPOT, { souplesse: true, flexDefaut: 30, amplitude: AMP });

test('la journée du 15/09 au barème × 0,9 est PLEINE : 6h18 + 1h40 = 7h58, reste 32 min sous 8h30 (< 75)', () => {
  const r = evaluerRemplissage({
    arrets: jour1509(162, 216), trajet, depotKey: '43.912,1.890',
    budgetMinutes: 480, depassementMinutes: 30, resteUtileMinMinutes: 75,
  });
  assert.equal(r.travailMinutes, 378);
  assert.equal(r.trajetsMinutes, 100);
  assert.equal(r.chargeMinutes, 478);
  assert.equal(r.resteUtileMinutes, 32);
  assert.equal(r.pleine, true);
});

test('une journée à un seul RDV court n est pas pleine ; une journée vide non plus (rien à figer)', () => {
  const seule = construireArretsPourConsolidation([
    { id: 'GOMES', lat: 43.941915, lng: 1.720688, duration_minutes: 216, scheduled_start: '09:00', appointment_type: 'maintenance' },
  ], DEPOT, { souplesse: true, flexDefaut: 30, amplitude: AMP });
  const r = evaluerRemplissage({ arrets: seule, trajet, depotKey: '43.912,1.890', budgetMinutes: 480, depassementMinutes: 30, resteUtileMinMinutes: 75 });
  assert.equal(r.pleine, false);
  assert.equal(r.resteUtileMinutes, 510 - (216 + 21 + 23));
  const vide = evaluerRemplissage({ arrets: [], trajet, depotKey: '43.912,1.890', budgetMinutes: 480, depassementMinutes: 30, resteUtileMinMinutes: 75 });
  assert.equal(vide.vide, true);
  assert.equal(vide.pleine, false);
});

test('le seuil est le réglage reste_utile_min_minutes : à 0, seule une journée qui DÉBORDE est pleine', () => {
  const arrets = jour1509(162, 216);
  assert.equal(evaluerRemplissage({ arrets, trajet, depotKey: '43.912,1.890', budgetMinutes: 480, depassementMinutes: 30, resteUtileMinMinutes: 0 }).pleine, false);
  assert.equal(evaluerRemplissage({ arrets, trajet, depotKey: '43.912,1.890', budgetMinutes: 470, depassementMinutes: 0, resteUtileMinMinutes: 0 }).pleine, true, 'à 7h50 de budget sans dépassement, 7h58 déborde');
});

test('verdictJournee : sans adaptable → rien ; pleine et tenable → figeable ; pleine mais route impossible → à arbitrer', () => {
  const reglages = { souplesse_defaut_minutes: 30, reste_utile_min_minutes: 75, depassement_journee_minutes: 30, pause_minutes: 30, pause_fenetre: [12, 14], demi_journee: { matin: [8, 12], apres_midi: [13, 18] } };
  const base = { date: '2026-09-15', amplitude: AMP, budgetMinutes: 480 };
  const rdv = (id, lat, lng, duree, debut, extra = {}) => ({ id, lat, lng, duration_minutes: duree, scheduled_start: debut, appointment_type: 'maintenance', ...extra });
  const figes = { ...base, rdvs: [rdv('a', 43.79476, 1.604971, 162, '08:00', { hour_confirmed_at: 'x' }), rdv('b', 43.941915, 1.720688, 216, '12:30', { time_flex_minutes: 0 })] };
  assert.equal(verdictJournee({ journee: figes, depot: DEPOT, reglages, trajet }).verdict, 'sans_adaptable');
  // 15/09 tel que posé (EKOUE 8h00 ±30 à 38 min du dépôt ouvert à 8h00) : pleine (reste 32)
  // mais le trajet vers Bessières ne tient pas → à arbitrer (Eric, 2026-09-12).
  const pose = { ...base, rdvs: [rdv('EKOUE', 43.79476, 1.604971, 162, '08:00'), rdv('GOMES', 43.941915, 1.720688, 216, '12:30')] };
  const vp = verdictJournee({ journee: pose, depot: DEPOT, reglages, trajet });
  assert.equal(vp.verdict, 'a_arbitrer');
  assert.deepEqual(vp.sequence.diagnostic.conflits[0], { id: 'EKOUE', depuisId: null, trajetMinutes: 38, disponibleMinutes: 0 });
  // EKOUE annoncé 8h40 : pleine et tenable (EKOUE 8:40 → 11:22, GOMES 12:30) → figeable
  const ok = { ...base, rdvs: [rdv('EKOUE', 43.79476, 1.604971, 162, '08:40'), rdv('GOMES', 43.941915, 1.720688, 216, '12:30')] };
  const v = verdictJournee({ journee: ok, depot: DEPOT, reglages, trajet });
  assert.equal(v.verdict, 'figeable');
  assert.equal(v.remplissage.pleine, true);
  assert.equal(v.sequence.faisable, true);
  // GOMES figé à 11:00 alors que 8:40 + 2h42 + 39 min de route = 12:01 : un figé est un FAIT
  // (figesSontDesFaits), nos estimations ne le disqualifient pas → toujours figeable.
  const serre = { ...base, rdvs: [rdv('EKOUE', 43.79476, 1.604971, 162, '08:40'), rdv('GOMES', 43.941915, 1.720688, 216, '11:00', { hour_confirmed_at: 'x' })] };
  assert.equal(verdictJournee({ journee: serre, depot: DEPOT, reglages, trajet }).verdict, 'figeable');
  // Un 3ᵉ entretien de 3h20 chez le voisin de GOMES : 9h38 de travail pour 8h30 → aucun ordre ne tient → à arbitrer
  const kaput = { ...base, rdvs: [...ok.rdvs, rdv('VOISIN', 43.941915, 1.720688, 200, '15:00')] };
  const w = verdictJournee({ journee: kaput, depot: DEPOT, reglages, trajet });
  assert.equal(w.verdict, 'a_arbitrer');
  assert.equal(w.sequence.diagnostic.depasseBudget, true);
});
