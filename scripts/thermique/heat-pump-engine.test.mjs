import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  copAt, pThAt, pElRefDe, courbeCharge, pointBivalence, consoAnnuelle, pointsManuelsValides,
} from '../../src/apps/thermique/lib/heatPumpEngine.js';

const catalogue = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/pac-catalogue.json', import.meta.url), 'utf8'));
// PAC de référence épinglée par modèle (et non par 1er `find` order-dependent sur le catalogue,
// dont l'ordre n'est pas garanti stable) — voir aussi pointBivalence ci-dessous qui refait le find.
const reelle = catalogue.pacs.find((p) => p.modele === 'Acond Aconomis N');
assert.ok(reelle, 'PAC de référence absente du catalogue — mettre à jour le modèle épinglé');
const generique = catalogue.pacs.find((p) => p.generique && p.modele.includes('average'));
const climat = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/climat.json', import.meta.url), 'utf8'));

test('copAt : formule hplib — COP = p1·Tin + p2·Tout + p3 + p4·Tamb (Tamb = Tin en air/eau)', () => {
  const [p1, p2, p3, p4] = reelle.coefCop;
  const attendu = Math.max(1, p1 * 7 + p2 * 35 + p3 + p4 * 7);
  assert.equal(copAt(reelle, 7, 35), attendu);
  assert.ok(copAt(reelle, 7, 35) > 2.5 && copAt(reelle, 7, 35) < 7, `COP=${copAt(reelle, 7, 35)}`);
});

test('pElRefDe : brut si présent, dérivé pthRef/COP_fitté(−7,52) pour les génériques', () => {
  assert.equal(pElRefDe(reelle), reelle.pElRef);
  const copFitte = copAt(generique, -7, 52);
  assert.ok(Math.abs(pElRefDe(generique) - generique.pthRef / copFitte) < 1e-9);
});

test('pThAt = P_el × COP avec P_el = pElRef × (q1·Tin + q2·Tout + q3 + q4·Tamb)', () => {
  const [q1, q2, q3, q4] = reelle.coefPth; // coefficients P_el (cf. _meta.note du catalogue)
  const pEl = reelle.pElRef * (q1 * 7 + q2 * 35 + q3 + q4 * 7);
  assert.ok(Math.abs(pThAt(reelle, 7, 35) - pEl * copAt(reelle, 7, 35)) < 1e-6);
  assert.ok(pThAt(reelle, -15, 35) > 0);
  assert.ok(pThAt(generique, 7, 35) > 0); // le générique fonctionne via pElRef dérivé
});

test('garde-fous température et plancher COP', () => {
  assert.throws(() => pThAt(reelle, 7, 70), /thermique/);   // tDépart hors [20, 65]
  assert.throws(() => pThAt(reelle, 7, 15), /thermique/);
  assert.throws(() => copAt(reelle, -35, 35), /thermique/);  // tExt hors [-30, 45]
  assert.ok(copAt(reelle, -25, 55) >= 1); // plancher physique (le fit linéaire peut diverger aux extrêmes)
});

test('pac invalide → erreurs propres', () => {
  assert.throws(() => copAt({ coefCop: [1, 2, 3] }, 7, 35), /thermique/);        // 3 coefs au lieu de 4
  assert.throws(() => pThAt({ coefCop: [0,0,3,0], coefPth: [0,0,1,0], pthRef: null, pElRef: null }, 7, 35), /thermique/); // ni pElRef ni pthRef
});

test('courbeCharge : droite de charge', () => {
  const charge = courbeCharge({ phiTotal: 8000, thetaBase: -5, thetaNC: 16 });
  assert.equal(charge(-5), 8000);
  assert.equal(charge(16), 0);
  assert.ok(Math.abs(charge(5.5) - 4000) < 1e-9);
  assert.equal(charge(20), 0);
  assert.ok(Math.abs(charge(-10) - 8000 * 26 / 21) < 1e-9); // extrapolation sous θbase
  assert.throws(() => courbeCharge({ phiTotal: 0, thetaBase: -5, thetaNC: 16 }), /thermique/);
  assert.throws(() => courbeCharge({ phiTotal: 8000, thetaBase: 16, thetaNC: -5 }), /thermique/);
});

test('pointBivalence : PAC manuelle 2 points — cas résoluble à la main', () => {
  // pTh manuelle : (−7, 4000), (7, 8000) → pente 4000/14 = 285.714286 W/K → pTh(θ) = 6000 + 285.714286·θ
  // charge : 8000·(16−θ)/21 = 380.952381·(16−θ)
  // Intersection : 6000 + 285.714286·θ = 6095.238095 − 380.952381·θ
  //   → 666.666667·θ = 95.238095 → θ = 0.142857 °C
  // appoint = charge(−5) − pTh(−5) = 8000 − (6000 − 1428.571429) = 8000 − 4571.428571 = 3428.571429 W
  const pac = { type: 'manuelle', points: [{ tExt: -7, pTh: 4000 }, { tExt: 7, pTh: 8000 }] };
  const charge = courbeCharge({ phiTotal: 8000, thetaBase: -5, thetaNC: 16 });
  const r = pointBivalence({ pac, tDepart: 35, charge, thetaBase: -5, thetaNC: 16 });
  assert.ok(Math.abs(r.thetaBivalence - 0.142857) < 0.01, `θbiv=${r.thetaBivalence}`);
  assert.ok(Math.abs(r.appointNecessaire - 3428.571429) < 1, `appoint=${r.appointNecessaire}`);
  assert.equal(r.avertissementChargePartielle, false);
  assert.ok(r.tauxCouverture > 0.8 && r.tauxCouverture < 1, `couverture=${r.tauxCouverture}`);
});

// ⚠ IMPORTANT : refais ce calcul d'intersection toi-même ligne à ligne avant d'écrire le test.
// Si tu trouves un θ différent de 0.142857, corrige le COMMENTAIRE ET l'assertion avec TON calcul
// (et signale-le dans ton rapport). Le calcul ci-dessus : charge(θ) = 8000(16−θ)/21 ;
// à θ=0.142857 : charge = 8000×15.857143/21 = 6040.816 ; pTh = 6000+40.816 = 6040.816 ✓ cohérent.

test('pointBivalence : PAC hplib réelle → avertissement + bornes', () => {
  const pacReelle = catalogue.pacs.find((p) => !p.generique && p.copRef != null);
  const charge = courbeCharge({ phiTotal: 6000, thetaBase: -5, thetaNC: 16 });
  const r = pointBivalence({ pac: pacReelle, tDepart: 35, charge, thetaBase: -5, thetaNC: 16 });
  assert.equal(r.avertissementChargePartielle, true);
  assert.ok(r.thetaBivalence >= -5 - 1e-9 && r.thetaBivalence <= 16 + 1e-9);
  assert.ok(r.tauxCouverture > 0 && r.tauxCouverture <= 1);
  assert.ok(r.appointNecessaire >= 0);
});

test('pointBivalence : PAC surdimensionnée → bivalence = θbase, appoint 0, couverture 1', () => {
  const pac = { type: 'manuelle', points: [{ tExt: -15, pTh: 20000 }, { tExt: 15, pTh: 30000 }] };
  const charge = courbeCharge({ phiTotal: 5000, thetaBase: -5, thetaNC: 16 });
  const r = pointBivalence({ pac, tDepart: 35, charge, thetaBase: -5, thetaNC: 16 });
  assert.equal(r.thetaBivalence, -5);
  assert.equal(r.appointNecessaire, 0);
  assert.ok(Math.abs(r.tauxCouverture - 1) < 1e-9);
});

test('pointBivalence + PAC manuelle : erreurs propres', () => {
  const charge = courbeCharge({ phiTotal: 5000, thetaBase: -5, thetaNC: 16 });
  assert.throws(() => pointBivalence({ pac: { type: 'manuelle', points: [{ tExt: 0, pTh: 5000 }] }, tDepart: 35, charge, thetaBase: -5, thetaNC: 16 }), /thermique/); // 1 seul point
  assert.throws(() => pointBivalence({ pac: { type: 'manuelle', points: [{ tExt: 0, pTh: -1 }, { tExt: 5, pTh: 100 }] }, tDepart: 35, charge, thetaBase: -5, thetaNC: 16 }), /thermique/);
  assert.throws(() => pointBivalence({ pac: {}, tDepart: 35, charge: null, thetaBase: -5, thetaNC: 16 }), /thermique/); // charge pas une fonction
});

test('pointsManuelsValides : filtre sans throw (mêmes règles que verifPointsManuels)', () => {
  assert.deepEqual(pointsManuelsValides(null), []);
  assert.deepEqual(pointsManuelsValides([
    { tExt: -7, pTh: 5000 },      // valide
    { tExt: 7, pTh: null },        // pTh manquant (saisie en cours)
    { tExt: null, pTh: 3000 },     // tExt manquant
    { tExt: 2, pTh: 0 },           // pTh ≤ 0
    null,                          // ligne vide
  ]), [{ tExt: -7, pTh: 5000 }]);
});

test('consoAnnuelle : méthode DJU, cas Gaillac (81)', () => {
  // besoin = 24 × 1943 × 320 / 1000 = 14 922.24 kWh (facteur 1.0)
  // θext_moyenne = 18 − (1943 × 24 / h81) — h81 lu dans climat.heuresChauffage (Part A, dept 81 = 5200 h)
  const h81 = climat.heuresChauffage['81'];
  assert.equal(h81, 5200); // ancre re-vérifiée contre la source (Part A)
  const pac = reelle;
  const r = consoAnnuelle({ gv: 320, dju: 1943, heuresChauffage: h81, pac, tDepart: 35, prixKwh: 0.1952 });
  assert.ok(Math.abs(r.besoinKwh - 14922.24) < 0.01);
  const thetaAttendue = 18 - (1943 * 24 / h81);
  assert.ok(Math.abs(r.thetaExtMoyenne - thetaAttendue) < 1e-9);
  assert.ok(Math.abs(r.consoElecKwh - r.besoinKwh / copAt(pac, r.thetaExtMoyenne, 35)) < 0.01);
  assert.ok(Math.abs(r.coutEuros - r.consoElecKwh * 0.1952) < 0.01);
  assert.deepEqual(r.fourchette, { min: Math.round(r.coutEuros * 0.85), max: Math.round(r.coutEuros * 1.15) });
});

test('consoAnnuelle : DJU null → erreur mentionnant le fallback départemental', () => {
  const pac = reelle;
  assert.throws(() => consoAnnuelle({ gv: 320, dju: null, heuresChauffage: 2000, pac, tDepart: 35, prixKwh: 0.2 }), /DJU/);
});

test('consoAnnuelle : facteurAjustement multiplie le besoin', () => {
  const pac = reelle;
  const args = { gv: 320, dju: 1943, heuresChauffage: 5200, pac, tDepart: 35, prixKwh: 0.1952 };
  const r1 = consoAnnuelle(args);
  const r2 = consoAnnuelle({ ...args, facteurAjustement: 0.85 });
  assert.ok(Math.abs(r2.besoinKwh - r1.besoinKwh * 0.85) < 1e-9);
  assert.ok(Math.abs(r2.consoElecKwh - r1.consoElecKwh * 0.85) < 1e-6);
});

test('consoAnnuelle : PAC manuelle sans scopManuel → throw ; avec scopManuel → utilisé', () => {
  const args = { gv: 320, dju: 1943, heuresChauffage: 5200, tDepart: 35, prixKwh: 0.1952 };
  const pacManuelleSansScop = { type: 'manuelle', points: [{ tExt: -7, pTh: 4000 }, { tExt: 7, pTh: 8000 }] };
  assert.throws(() => consoAnnuelle({ ...args, pac: pacManuelleSansScop }), /thermique/);

  const pacManuelleAvecScop = { type: 'manuelle', scopManuel: 3.5 };
  const r = consoAnnuelle({ ...args, pac: pacManuelleAvecScop });
  const besoinAttendu = 24 * args.dju * args.gv / 1000;
  assert.ok(Math.abs(r.consoElecKwh - besoinAttendu / 3.5) < 1e-9);
});
