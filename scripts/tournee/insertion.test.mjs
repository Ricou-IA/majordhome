// scripts/tournee/insertion.test.mjs
// Run : node --test scripts/tournee/insertion.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coutInsertion, classerCandidats } from '../../src/lib/tournee/insertion.js';
import { sequencerTournee } from '../../src/lib/tournee/sequence.js';

const MATRICE = {
  'D|A': 20, 'A|D': 20, 'D|B': 22, 'B|D': 22, 'D|C': 40, 'C|D': 40,
  'A|B': 5,  'B|A': 5,  'A|C': 45, 'C|A': 45, 'B|C': 44, 'C|B': 44,
};
const trajet = (a, b) => (a === b ? 0 : MATRICE[`${a}|${b}`] ?? 999);
const ctx = {
  depotKey: 'D', trajet,
  amplitude: { debut: 8 * 60, fin: 18 * 60 },
  budgetMinutes: 480,
  pause: { minutes: 30, fenetre: [12 * 60, 14 * 60] },
};
const arret = (id, key, dureeMinutes) => ({ id, key, dureeMinutes });

test('insertion dans une journée vide = aller-retour + intervention', () => {
  const r = coutInsertion([], arret('a', 'A', 60), ctx);
  assert.equal(r.faisable, true);
  assert.equal(r.minutes, 20 + 60 + 20);
});

test('un voisin de la tournée coûte moins qu un client isolé', () => {
  const tournee = [arret('a', 'A', 60)];
  const voisin = coutInsertion(tournee, arret('b', 'B', 60), ctx);   // B est à 5 min de A
  const isole = coutInsertion(tournee, arret('c', 'C', 60), ctx);    // C est à l opposé
  assert.ok(voisin.minutes < isole.minutes,
    `voisin ${voisin.minutes} devrait couter moins que isole ${isole.minutes}`);
});

test('le coût exclut la durée d intervention identique — c est bien le DÉTOUR qui départage', () => {
  const tournee = [arret('a', 'A', 60)];
  const b = coutInsertion(tournee, arret('b', 'B', 60), ctx);
  // Avant : 20 + 60 + 20 = 100. Après (A puis B) : 20+60+5+60+22 = 167.
  assert.equal(b.minutes, 67, 'soit 60 d intervention + 7 de detour reel');
});

test('candidat qui ne rentre pas dans le budget → non faisable', () => {
  const tournee = [arret('a', 'A', 240), arret('b', 'B', 180)];
  const r = coutInsertion(tournee, arret('c', 'C', 120), ctx);
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'budget');
  assert.equal(r.minutes, null);
});

test('classerCandidats — trie par score, écarte les infaisables', () => {
  const tournee = [arret('a', 'A', 60)];
  const candidats = [arret('c', 'C', 60), arret('b', 'B', 60)];
  const resultat = classerCandidats(tournee, candidats, ctx, { scoreParId: { b: 1, c: 1 } });
  assert.equal(resultat.baseInfaisable, false);
  assert.equal(resultat.classement.length, 2);
  assert.equal(resultat.classement[0].candidat.id, 'b', 'a score egal, le moins couteux passe devant');
});

test('classerCandidats — un score d éligibilité élevé peut compenser un détour', () => {
  const tournee = [arret('a', 'A', 60)];
  const candidats = [arret('c', 'C', 60), arret('b', 'B', 60)];
  // C est loin mais très mûr, B est proche mais hors saison.
  const resultat = classerCandidats(tournee, candidats, ctx, { scoreParId: { b: 0.1, c: 1 } });
  assert.equal(resultat.classement[0].candidat.id, 'c');
});

test('classerCandidats — candidat infaisable absent du classement', () => {
  const tournee = [arret('a', 'A', 400)];
  const resultat = classerCandidats(tournee, [arret('c', 'C', 120)], ctx, { scoreParId: { c: 1 } });
  assert.equal(resultat.baseInfaisable, false, 'la tournee de depart (juste a) est faisable ; seul le candidat ne rentre pas');
  assert.equal(resultat.classement.length, 0);
});

// --- Fix round 1 (revue) ------------------------------------------------

test('tournée de départ déjà infaisable — signalé explicitement, pas de coût trompeur', () => {
  // 300 + 300 = 600 min d intervention à elles seules, largement au-dessus du
  // budget de 480 : la tournée de DÉPART est déjà infaisable, avant même de
  // songer à y insérer qui que ce soit. Avant le fix, `base` retombait
  // silencieusement à 0 et le candidat se voyait attribuer TOUTE la charge de
  // la tournée cassée comme si c était son propre cout — faisable: true en
  // prime.
  const tourneeCassee = [arret('a', 'A', 300), arret('b', 'B', 300)];
  const r = coutInsertion(tourneeCassee, arret('c', 'C', 60), ctx);
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'tournee_actuelle_infaisable');
  assert.equal(r.minutes, null, 'pas de nombre trompeur qui absorberait la charge de la tournee cassee');
  assert.equal(r.sequenceApres, null);
});

test('coutInsertion — sequenceActuelle explicite donne le même résultat que le calcul implicite', () => {
  // Vérifie le contrat du paramètre optionnel ajouté pour que classerCandidats
  // n appelle sequencerTournee qu UNE fois pour N candidats (au lieu de N
  // fois le même calcul factoriel) : passer la séquence déjà calculée ne doit
  // rien changer au résultat par rapport à la laisser se recalculer seule.
  const tournee = [arret('a', 'A', 60)];
  const sequenceActuelle = sequencerTournee({ ...ctx, arrets: tournee });
  const avecParam = coutInsertion(tournee, arret('b', 'B', 60), ctx, { sequenceActuelle });
  const sansParam = coutInsertion(tournee, arret('b', 'B', 60), ctx);
  assert.deepEqual(avecParam, sansParam);
});

// --- Fix round 2 (revue) ------------------------------------------------

test('classerCandidats — tournée de départ infaisable vs aucun candidat ne convient : deux cas distincts', () => {
  // Cas A — la tournée de DÉPART dépasse déjà le budget à elle seule (deux
  // chaudières granulés à 300 min chacune, hors trajets, même fixture que le
  // test coutInsertion ci-dessus) : aucun candidat n est même essayé, ce n
  // est pas un probleme de candidat.
  const tourneeCassee = [arret('a', 'A', 300), arret('b', 'B', 300)];
  const casBaseInfaisable = classerCandidats(tourneeCassee, [arret('c', 'C', 60)], ctx, { scoreParId: { c: 1 } });
  assert.equal(casBaseInfaisable.baseInfaisable, true);
  assert.equal(casBaseInfaisable.raisonBase, 'budget');
  assert.deepEqual(casBaseInfaisable.classement, []);

  // Cas B — la tournée de départ (juste A, 400 min) est parfaitement
  // faisable ; c est LE CANDIDAT (120 min de plus) qui ne rentre pas une
  // fois ajouté. Même fixture que le test « candidat infaisable absent du
  // classement » ci-dessus.
  const tourneeOk = [arret('a', 'A', 400)];
  const casAucunCandidat = classerCandidats(tourneeOk, [arret('c', 'C', 120)], ctx, { scoreParId: { c: 1 } });
  assert.equal(casAucunCandidat.baseInfaisable, false);
  assert.equal(casAucunCandidat.raisonBase, null);
  assert.deepEqual(casAucunCandidat.classement, []);

  // Les deux `classement` sont vides à l identique — c est bien
  // baseInfaisable/raisonBase, et EUX SEULS, qui permettent à l appelant de
  // distinguer les deux cas sans se tromper de diagnostic.
  assert.notEqual(casBaseInfaisable.baseInfaisable, casAucunCandidat.baseInfaisable);
});
