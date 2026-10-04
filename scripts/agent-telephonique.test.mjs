// scripts/agent-telephonique.test.mjs — règle de reconnaissance de l'outil verifier_client.
// node --test scripts/agent-telephonique.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliserTelephone, correspondNom, correspondCommune, analyserAdresse, correspondAdresse, verifierCandidats,
} from '../src/lib/agentTelephonique.js';

test('téléphone : formats rencontrés en base Mayer', () => {
  assert.equal(normaliserTelephone('06 86 26 98 09'), '0686269809');
  assert.equal(normaliserTelephone('+33 6 86 26 98 09'), '0686269809');
  assert.equal(normaliserTelephone('0033686269809'), '0686269809');
  assert.equal(normaliserTelephone('686269809'), '0686269809'); // zéro perdu à l'import
  assert.equal(normaliserTelephone('zéro six, 86'), null);
  assert.equal(normaliserTelephone(''), null);
});

test('nom : accents, casse, une lettre de tolérance au-delà de 4 lettres', () => {
  assert.equal(correspondNom('Pudebat', 'PUDEBAT'), true);
  assert.equal(correspondNom('Pudebatt', 'Pudebat'), true);
  assert.equal(correspondNom('Gérard', 'GERARD'), true);
  assert.equal(correspondNom('Martin', 'Martinez'), false);
  assert.equal(correspondNom('Roy', 'Ray'), false); // nom court : pas de tolérance
  assert.equal(correspondNom('', 'Pudebat'), false);
});

test('commune : variantes saisies en base', () => {
  assert.equal(correspondCommune('Lisle-sur-Tarn', 'Lisle Sur Tarn'), true);
  assert.equal(correspondCommune('Saint-Sulpice-la-Pointe', 'St Sulpice La Pointe'), true);
  assert.equal(correspondCommune('Saint-Juéry', 'Saint Juery'), true);
  assert.equal(correspondCommune('Gaillac', 'Graulhet'), false);
});

test('adresse : numéro, bis, abréviations', () => {
  assert.deepEqual(analyserAdresse('7 bis, Rte des Bardys'), { numero: '7', suffixe: 'bis', voie: 'route des bardys' });
  assert.deepEqual(analyserAdresse('7bis route des Bardys'), { numero: '7', suffixe: 'bis', voie: 'route des bardys' });
  assert.deepEqual(analyserAdresse('Lieu-dit La Borie'), { numero: null, suffixe: null, voie: 'lieu dit la borie' });
  assert.equal(correspondAdresse('7 bis route des Bardis', '7 bis Rte des Bardys'), true); // vécu en test
  assert.equal(correspondAdresse('7 route des Bardis', '7 bis route des Bardys'), true); // bis omis à l'oral
  assert.equal(correspondAdresse('7 ter route des Bardys', '7 bis route des Bardys'), false);
  assert.equal(correspondAdresse('8 route des Bardys', '7 route des Bardys'), false);
  assert.equal(correspondAdresse('Lieu dit la Borie', 'Lieu-dit La Borie'), true);
  assert.equal(correspondAdresse('12 rue de Lille', '12 avenue Jean Jaurès'), false);
  assert.equal(correspondAdresse('12 rue de Lille', ''), false);
});

const FICHE = { client_id: 'c1', last_name: 'PUDEBAT', address: '7 bis Rte des Bardys', city: 'Gaillac' };
const DIT = { nom: 'Pudebat', commune: 'Gaillac', adresse: '7 bis route des Bardis', telephone: '06 86 26 98 09' };

test('verdict : un seul candidat qui passe tout → vérifié', () => {
  const r = verifierCandidats(DIT, [FICHE]);
  assert.equal(r.verifie, true);
  assert.equal(r.candidat.client_id, 'c1');
});

test('verdict : motifs internes', () => {
  assert.equal(verifierCandidats({ ...DIT, telephone: '12' }, [FICHE]).motif, 'telephone_invalide');
  assert.equal(verifierCandidats(DIT, []).motif, 'telephone_inconnu');
  assert.equal(verifierCandidats({ ...DIT, nom: 'Durand' }, [FICHE]).motif, 'nom');
  assert.equal(verifierCandidats({ ...DIT, commune: 'Albi' }, [FICHE]).motif, 'commune');
  assert.equal(verifierCandidats({ ...DIT, adresse: '3 rue Neuve' }, [FICHE]).motif, 'adresse');
});

test('verdict : numéro partagé par un couple → le nom départage', () => {
  const conjoint = { ...FICHE, client_id: 'c2', last_name: 'MARTIN' };
  const r = verifierCandidats(DIT, [conjoint, FICHE]);
  assert.equal(r.verifie, true);
  assert.equal(r.candidat.client_id, 'c1');
});

test('verdict : fiche en double → jamais de choix au hasard', () => {
  const r = verifierCandidats(DIT, [FICHE, { ...FICHE, client_id: 'c3' }]);
  assert.equal(r.verifie, false);
  assert.equal(r.motif, 'doublon');
});

test('créneau parlé : jour, demi-journée et plage, jamais l’heure calculée', async () => {
  const { jourParle, creneauParle } = await import('../src/lib/agentTelephonique.js');
  assert.equal(jourParle('2026-10-15'), 'jeudi 15 octobre');
  assert.equal(jourParle('2026-11-01'), 'dimanche 1er novembre');
  assert.equal(jourParle(''), '');
  const demis = [{ code: 'matin', debut: 480, fin: 720 }, { code: 'apres_midi', debut: 810, fin: 1080 }];
  assert.deepEqual(creneauParle({ date: '2026-10-16', demi: 'matin' }, demis),
    { jour: 'vendredi 16 octobre', demi: 'le matin', plage: 'entre 8 h et 12 h' });
  assert.deepEqual(creneauParle({ date: '2026-10-16', demi: 'apres_midi' }, demis),
    { jour: 'vendredi 16 octobre', demi: "l'après-midi", plage: 'entre 13 h 30 et 18 h' });
});

import { choisirCreneauxAgent } from '../src/lib/agentTelephonique.js';

const cr = (date, demi, tech = 't1') => ({ date, demi, technicienId: tech });

test('choisirCreneauxAgent : journées du secteur d\'abord, journées vides en complément, ordre chronologique', () => {
  const dansSecteur = [cr('2026-10-27', 'matin', 'a'), cr('2026-10-27', 'matin', 'b')]; // même demi-journée → 1 seule
  const vides = [cr('2026-10-06', 'matin'), cr('2026-10-06', 'apres_midi'), cr('2026-10-07', 'matin')];
  const r = choisirCreneauxAgent({ dansSecteur, vides });
  assert.deepEqual(r.map((c) => `${c.date} ${c.demi}`), ['2026-10-06 matin', '2026-10-07 matin', '2026-10-27 matin']); // journées vides : une par date
  assert.equal(r.find((c) => c.date === '2026-10-27').technicienId, 'a'); // le meilleur du moteur, pas le doublon
});

test('choisirCreneauxAgent : assez de créneaux dans le secteur → aucune journée vide', () => {
  const dansSecteur = [cr('2026-10-20', 'matin'), cr('2026-10-12', 'apres_midi'), cr('2026-10-15', 'matin'), cr('2026-10-16', 'matin')];
  const r = choisirCreneauxAgent({ dansSecteur, vides: [cr('2026-10-06', 'matin')] });
  assert.deepEqual(r.map((c) => c.date), ['2026-10-12', '2026-10-15', '2026-10-20']); // les 3 meilleurs, puis chrono
});

test('choisirCreneauxAgent : période demandée et nombre', () => {
  const vides = [cr('2026-10-06', 'matin'), cr('2026-10-06', 'apres_midi'), cr('2026-10-07', 'apres_midi')];
  assert.deepEqual(choisirCreneauxAgent({ dansSecteur: [], vides, periode: 'apres_midi' }).map((c) => c.date), ['2026-10-06', '2026-10-07']);
  assert.deepEqual(choisirCreneauxAgent({ dansSecteur: [], vides }).map((c) => `${c.date} ${c.demi}`), ['2026-10-06 matin', '2026-10-07 apres_midi']);
  assert.equal(choisirCreneauxAgent({ dansSecteur: [], vides, nombre: 1 }).length, 1);
  assert.deepEqual(choisirCreneauxAgent({ dansSecteur: [], vides: [] }), []);
});
