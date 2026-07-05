// scripts/thermique/integration-dessin-bilan.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Test d'intégration OFFICIEL de l'assembleur (plan 4) — la chaîne bout-en-bout « dessin → parois →
// bâtiment résolu → bilan » qui relie les trois plans : données de référence (plan 1), moteurs
// thermiques (plan 2), géométrie (plan 3), reliés par l'assembleur RÉEL `assembleBatiment` (plan 4).
//
// Historique : ce fichier était le BROUILLON d'assembleur du plan 3 (Task 10). Le plan 4 a livré le
// vrai `assembleBatiment` (src/apps/thermique/lib/assembleBatiment.js) ; ce test a été réécrit pour
// l'utiliser, comme l'exigeait la note d'en-tête d'origine. Les décisions D1-D11 vivent désormais
// dans l'assembleur (et sa suite de tests dédiée assemble-batiment.test.mjs) ; ce fichier vérifie la
// COHÉRENCE de la chaîne complète sur la maison de référence, contre des valeurs dérivées à la main.
//
// Discipline plans 1-3 : chaque valeur attendue est dérivée À LA MAIN en commentaire (un relecteur
// re-calcule tout) ; toute divergence = erreur de dérivation à corriger ICI, jamais dans le moteur.
// Tolérance 1e-9 : bruit d'arrondi IEEE 754 uniquement — l'arithmétique est fermée (produits et
// sommes de décimaux exacts), aucune approximation métier.
//
// Hypothèses de la maison (fixture partagée scripts/thermique/lib/fixtureMaison.mjs) : Gaillac (81,
// 134 m) ; VMC SF auto (2 pièces principales séjour+chambre → 60 m³/h, arrêté 24/03/1982 T2) ;
// isolation ITI → ΔUtb 0.10 (D6) ; comble isolé → b 0.7 (D9) ; terre-plein → b 1 (D5) ; Uw fenêtre
// 1.3 et Uporte 3.5 saisis (D3) ; garage LNC à 3 murs extérieurs → b 0.8 (D4, calculé par bLncParPiece).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deduireParois } from '../../src/apps/thermique/lib/geometryEngine.js';
import { calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';
import { thetaBasePour, uDefautPour, coefficientBPour } from '../../src/apps/thermique/lib/refDataResolvers.js';
import { assembleBatiment } from '../../src/apps/thermique/lib/assembleBatiment.js';
import {
  DONNEES_MAISON, dessinMaison, contexteMaison, compositionsMaison, reglagesMaison,
} from './lib/fixtureMaison.mjs';

const CLIMAT = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/climat.json', import.meta.url), 'utf8'));
const U_DEFAUTS = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));
const COEFFICIENTS_B = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/coefficients-b.json', import.meta.url), 'utf8'));
const VENTILATION = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/ventilation.json', import.meta.url), 'utf8'));

/** Égalité au bruit IEEE 754 près (cf. note de tolérance en tête de fichier). */
function proche(reel, attendu, label) {
  assert.ok(Math.abs(reel - attendu) < 1e-9, `${label}: obtenu ${reel}, attendu ${attendu}`);
}

/** Assemble la maison de référence via l'assembleur RÉEL. */
function assemble({ dessin = {}, contexte = {}, compositions = {} } = {}) {
  return assembleBatiment(dessinMaison(dessin), {
    data: DONNEES_MAISON,
    contexte: contexteMaison(contexte),
    compositions: compositionsMaison(compositions),
    reglages: reglagesMaison(),
  });
}

// ————————————————————————————————————————————————————————————————————————————————————————————
// Données réelles résolues — chaque constante du bilan est lue des JSON par les résolveurs
// (aucune valeur inventée : si un JSON change, ce test le signale AVANT les bilans).
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : données réelles résolues (θe Gaillac, U par défaut, b, débit T2)', () => {
  // climat.json : "81": [ { altMax: null, thetaE: -5 } ] — tranche unique, correction d'altitude
  // non appliquée en v1 (l'altitude 134 ne sert qu'au choix de tranche).
  assert.deepEqual(thetaBasePour(CLIMAT, '81', 134), { thetaE: -5, correctionAltitude: 'non-appliquée' });
  // u-defauts.json (Open3CL H1, non-Joule), période « avant 1974 » : mur 2.5 · plancherBas 2 · plafond 2.5.
  assert.equal(uDefautPour(U_DEFAUTS, 'mur', 1960), 2.5);
  assert.equal(uDefautPour(U_DEFAUTS, 'plancherBas', 1960), 2);
  assert.equal(uDefautPour(U_DEFAUTS, 'plafond', 1960), 2.5);
  // Période « après 2012 » (année 2015) : mur 0.23 · plancherBas 0.23 · plafond 0.14.
  assert.equal(uDefautPour(U_DEFAUTS, 'mur', 2015), 0.23);
  assert.equal(uDefautPour(U_DEFAUTS, 'plancherBas', 2015), 0.23);
  assert.equal(uDefautPour(U_DEFAUTS, 'plafond', 2015), 0.14);
  // Pas de Uw par période (cf. _meta de u-defauts.json) → Uw saisi (D3).
  assert.equal(uDefautPour(U_DEFAUTS, 'fenetre', 1960), null);
  // coefficients-b.json — libellés EXACTS relus du JSON :
  assert.equal(coefficientBPour(COEFFICIENTS_B, "Paroi donnant directement sur l'extérieur", null), 1);
  assert.equal(coefficientBPour(COEFFICIENTS_B, 'Pièce', 'Avec au moins 3 murs extérieurs (par ex. escalier extérieur)'), 0.8);
  assert.equal(coefficientBPour(COEFFICIENTS_B, 'Espace sous toiture', 'Toiture isolée'), 0.7);
  // ventilation.json : VMC SF autoréglable (mode debits, facteur 1, rendement 0) ; 2 pièces
  // principales (séjour + chambre, D1) → debitTotal 60 m³/h (arrêté du 24/03/1982, T2).
  const vmc = VENTILATION.systemes.find((s) => s.id === 'vmc-sf-auto');
  assert.equal(vmc.mode, 'debits');
  assert.equal(vmc.facteurDebit, 1);
  assert.equal(vmc.rendement, 0);
  assert.equal(VENTILATION.debitsExtraitsParTaille.find((t) => t.piecesPrincipales === 2).debitTotal, 60);
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// Pré-vol : le dessin de référence est géométriquement sain et produit exactement les 16 parois
// dérivées à la main en Task 6 (les surfaces individuelles y sont déjà épinglées — ici on ne
// re-vérifie que ce dont le bilan dépend : comptes par pièce).
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : pré-vol — deduireParois de la maison de référence est propre', () => {
  const { parois, erreurs, avertissements } = deduireParois(dessinMaison());
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []);
  assert.equal(parois.length, 16);
  // séjour 6 (murs O/S/N + fenêtre + porte + plancher) · cuisine 5 (murs S/N + lnc + plancher +
  // plafond) · chambre 5 (4 murs + plafond) · garage 0.
  assert.equal(parois.filter((p) => p.pieceId === 'sejour').length, 6);
  assert.equal(parois.filter((p) => p.pieceId === 'cuisine').length, 5);
  assert.equal(parois.filter((p) => p.pieceId === 'chambre').length, 5);
  assert.equal(parois.filter((p) => p.pieceId === 'garage').length, 0);
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// SCÉNARIO 1 — maison « avant 1974 » (année 1960), VMC SF auto, fRH 0 — BILAN COMPLET À LA MAIN.
//
// Constantes résolues : θe −5 · U mur 2.5 · U plancherBas 2.0 · U plafond 2.5 · Uw 1.3 · Uporte 3.5
// b : ext 1 · garage 0.8 (D4) · comble 0.7 (D9) · terre-plein 1 (D5) · ΔUtb 0.1 partout (D6, ITI).
// Surfaces (Task 6, dérivées et épinglées dans geometry-engine.test.mjs) :
//   séjour : murs O 10 · S 10.82 (12.5 − fenêtre 1.68) · N 10.565 (12.5 − porte 1.935) ;
//            fenêtre 1.68 · porte 1.935 · plancher 20 (pas de plafond : sous chambre chauffée)
//   cuisine : murs S 7.5 · N 7.5 · lnc garage 10 · plancher 12 · plafond-comble 12
//   chambre : murs O 10 · S 12.5 · E 10 · N 12.5 · plafond-comble 20 (pas de sol : sur séjour)
//
// ── SÉJOUR (θ20, ΔText = 25 K) — transmission = murs 1961.5625 + menuiseries 223.9125 +
//    plancherBas 1000 + ponts 137.5 = 3322.975 W ; ventilation 255 → total 3577.975 W
// ── CUISINE (θ20) — transmission = murs 1437.5 + plancherBas 600 + plafond 525 + ponts 108.5 =
//    2671 W ; ventilation 0 (humide, extraction) → total 2671 W
// ── CHAMBRE (θ18, ΔText 23 K) — transmission = murs 2587.5 + plafond 805 + ponts 135.7 = 3528.2 W ;
//    ventilation 234.6 → total 3762.8 W
// ── VENTILATION (debitTotal 60, volumes secs séjour 50 + chambre 50 = 100 → 30 m³/h chacun ;
//    cuisine humide 0) : 0.34×30×25 + 0.34×30×23 = 255 + 234.6 = 489.6 W.
// ── TOTAL bâtiment = 3577.975 + 2671 + 3762.8 = 10011.775 W
//    parPoste : murs 5986.5625 · menuiseries 223.9125 · plancherBas 1600 · plafondToiture 1330 ·
//               ponts 381.7 · ventilation 489.6 · relance 0
//    GV = 10011.775 / (1000/52 + 5) ≈ 413.1844 W/K · ratio ≈ 192.53 W/m² (∈ [60, 220] → pas d'alerte)
//    fourchette : min = round(10011.775 × 0.95) = 9511 · max = round(10011.775 × 1.10) = 11013
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : scénario 1 — maison avant 1974, dessin → assembleur → bilan complet', () => {
  const { batiment, thetaE, erreurs, avertissements } = assemble();
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []);
  assert.equal(thetaE, -5);
  assert.equal(batiment.thetaExt, -5);
  assert.equal(batiment.debitTotal, 60);
  assert.equal(batiment.systemeVentilation.id, 'vmc-sf-auto');
  assert.equal(batiment.pieces.length, 3); // chauffées seulement — le garage n'entre pas au bilan
  assert.deepEqual(batiment.pieces.map((p) => p.id), ['sejour', 'cuisine', 'chambre']);
  assert.deepEqual(batiment.pieces.map((p) => p.humide), [false, true, false]);
  assert.deepEqual(batiment.pieces.map((p) => p.volume), [50, 30, 50]);
  assert.deepEqual(batiment.pieces.map((p) => p.parois.length), [6, 5, 5]);

  const r = calculeBatiment(batiment);
  const [sejour, cuisine, chambre] = r.pieces;

  // Séjour
  proche(sejour.parPoste.murs, 1961.5625, 'séjour murs');
  proche(sejour.parPoste.menuiseries, 223.9125, 'séjour menuiseries');
  proche(sejour.parPoste.plancherBas, 1000, 'séjour plancherBas');
  proche(sejour.parPoste.pontsThermiques, 137.5, 'séjour ponts');
  assert.equal(sejour.parPoste.plafondToiture, undefined); // sous la chambre chauffée : rien
  proche(sejour.transmission, 3322.975, 'transmission séjour');
  proche(sejour.ventilation, 255, 'ventilation séjour');
  assert.equal(sejour.relance, 0);
  proche(sejour.total, 3577.975, 'total séjour');

  // Cuisine
  proche(cuisine.parPoste.murs, 1437.5, 'cuisine murs');
  proche(cuisine.parPoste.plancherBas, 600, 'cuisine plancherBas');
  proche(cuisine.parPoste.plafondToiture, 525, 'cuisine plafond');
  proche(cuisine.parPoste.pontsThermiques, 108.5, 'cuisine ponts');
  assert.equal(cuisine.parPoste.menuiseries, undefined);
  proche(cuisine.transmission, 2671, 'transmission cuisine');
  assert.equal(cuisine.ventilation, 0); // humide : extraction, pas d'air neuf direct
  proche(cuisine.total, 2671, 'total cuisine');

  // Chambre
  proche(chambre.parPoste.murs, 2587.5, 'chambre murs');
  proche(chambre.parPoste.plafondToiture, 805, 'chambre plafond');
  proche(chambre.parPoste.pontsThermiques, 135.7, 'chambre ponts');
  assert.equal(chambre.parPoste.plancherBas, undefined); // sur le séjour chauffé : rien
  proche(chambre.transmission, 3528.2, 'transmission chambre');
  proche(chambre.ventilation, 234.6, 'ventilation chambre');
  proche(chambre.total, 3762.8, 'total chambre');

  // Bâtiment
  proche(r.total, 10011.775, 'total bâtiment');
  proche(r.parPoste.murs, 5986.5625, 'murs');
  proche(r.parPoste.menuiseries, 223.9125, 'menuiseries');
  proche(r.parPoste.plancherBas, 1600, 'plancherBas');
  proche(r.parPoste.plafondToiture, 1330, 'plafondToiture');
  proche(r.parPoste.pontsThermiques, 381.7, 'pontsThermiques');
  proche(r.parPoste.ventilation, 489.6, 'ventilation');
  assert.equal(r.parPoste.relance, 0);
  proche(r.gv, 10011.775 / (1000 / 52 + 5), 'gv'); // ≈ 413.1844 W/K
  proche(r.ratioWm2, 10011.775 / 52, 'ratioWm2'); // ≈ 192.53 W/m²
  assert.deepEqual(r.fourchette, { min: 9511, max: 11013 });
  assert.equal(r.alerteVraisemblance, false); // 192.5 ∈ [60, 220] pour « avant 1974 »

  // Invariants : total === Σ parPoste (relance incluse) === Σ pieces[].total
  proche(Object.values(r.parPoste).reduce((s, v) => s + v, 0), r.total, 'Σ parPoste');
  proche(r.pieces.reduce((s, p) => s + p.total, 0), r.total, 'Σ pièces');
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// SCÉNARIO 2 — même maison, année 2015 (« après 2012 » : mur 0.23 · plancherBas 0.23 · plafond
// 0.14), cuisine à θ15. |20 − 15| = 5 > 4 K → le mur séjour↔cuisine (10 m²) est émis en
// mitoyen-interne DES DEUX CÔTÉS (θadjacente explicite, ΔUtb 0, D7/D11) et les totaux s'effondrent.
//   séjour transmission 668.37625 (+ vent 255 = 923.37625) · cuisine 259.82 (+ vent 0) ·
//   chambre 418.83 (+ vent 234.6 = 653.43) → TOTAL 1836.62625 W (≈ 18 % du scénario 1).
//   parPoste : murs 524.31375 · menuiseries 223.9125 · plancherBas 170.2 · plafondToiture 68.6 ·
//              ponts 360 · ventilation 489.6 · relance 0
//   GV = 1836.62625 / (940/52 + 5) = 79.5871375 W/K
//   ratio = 1836.62625 / 52 ≈ 35.32 W/m² (∈ [15, 80] pour « après 2012 » → pas d'alerte)
//   fourchette : min = round(1836.62625 × 0.95) = 1745 · max = round(× 1.10) = 2020
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : scénario 2 — année 2015, cuisine à 15 °C : mitoyen interne ±11.5 W, totaux effondrés', () => {
  const { batiment, erreurs, avertissements } = assemble({ dessin: { thetaCuisine: 15 }, contexte: { annee: 2015 } });
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []);
  assert.deepEqual(batiment.pieces.map((p) => p.parois.length), [7, 6, 5]); // +2 mitoyens internes (ΔT 5 > 4 K)

  // Le mitoyen est mappé en θadjacente explicite, ΔUtb 0 (D7) — le b est ignoré par le moteur.
  // (La paroi résolue porte aussi type/pieceId ; on n'assertent que les champs lus par le moteur.)
  const mitoyenSejour = batiment.pieces[0].parois.find((p) => p.thetaAdjacente !== undefined);
  assert.equal(mitoyenSejour.surface, 10);
  assert.equal(mitoyenSejour.u, 0.23);
  assert.equal(mitoyenSejour.thetaAdjacente, 15);
  assert.equal(mitoyenSejour.deltaUtb, 0);
  assert.equal(mitoyenSejour.poste, 'murs');
  assert.equal(mitoyenSejour.b, undefined);
  const mitoyenCuisine = batiment.pieces[1].parois.find((p) => p.thetaAdjacente !== undefined);
  assert.equal(mitoyenCuisine.thetaAdjacente, 20);

  const r = calculeBatiment(batiment);
  const [sejour, cuisine, chambre] = r.pieces;

  // Mécanisme mitoyen : +11.5 W côté séjour, −11.5 W côté cuisine (apport), nul à l'échelle bâtiment.
  proche(sejour.parPoste.murs, 191.96375, 'séjour murs (180.46375 ext + 11.5 mitoyen)');
  proche(cuisine.parPoste.murs, 94.3, 'cuisine murs (69 + 36.8 lnc − 11.5 mitoyen)');
  proche(sejour.transmission, 668.37625, 'transmission séjour');
  proche(cuisine.transmission, 259.82, 'transmission cuisine');
  proche(chambre.transmission, 418.83, 'transmission chambre');
  proche(sejour.total, 923.37625, 'total séjour');
  proche(cuisine.total, 259.82, 'total cuisine');
  proche(chambre.total, 653.43, 'total chambre');

  // Bâtiment : totaux effondrés vs scénario 1 (isolation récente).
  proche(r.total, 1836.62625, 'total bâtiment');
  assert.ok(r.total < 10011.775 / 5, 'total 2015 < 20 % du total avant-1974');
  proche(r.parPoste.murs, 524.31375, 'murs (±11.5 mitoyens annulés)');
  proche(r.parPoste.menuiseries, 223.9125, 'menuiseries (Uw saisis inchangés)');
  proche(r.parPoste.plancherBas, 170.2, 'plancherBas');
  proche(r.parPoste.plafondToiture, 68.6, 'plafondToiture');
  proche(r.parPoste.pontsThermiques, 360, 'pontsThermiques');
  proche(r.parPoste.ventilation, 489.6, 'ventilation');
  proche(r.gv, 1836.62625 / (940 / 52 + 5), 'gv'); // = 79.5871375 W/K
  assert.deepEqual(r.fourchette, { min: 1745, max: 2020 });
  assert.equal(r.alerteVraisemblance, false); // 35.3 ∈ [15, 80] pour « après 2012 »

  // Invariants
  proche(Object.values(r.parPoste).reduce((s, v) => s + v, 0), r.total, 'Σ parPoste');
  proche(r.pieces.reduce((s, p) => s + p.total, 0), r.total, 'Σ pièces');
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// Garde-fou perf — PAS un benchmark : la chaîne complète est de l'arithmétique pure sur ~16
// parois, elle doit se compter en fractions de ms. 50 ms = tripwire généreux qui ne détecte
// qu'une régression algorithmique grossière (boucle quadratique accidentelle, I/O parasite…).
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : garde-fou perf — chaîne complète dessin → assembleur → bilan < 50 ms', () => {
  const t0 = process.hrtime.bigint();
  const { batiment, erreurs } = assemble();
  assert.deepEqual(erreurs, []);
  const r = calculeBatiment(batiment);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(Number.isFinite(r.total) && r.total > 0);
  assert.ok(ms < 50, `chaîne complète en ${ms.toFixed(3)} ms (attendu < 50 ms)`);
});
