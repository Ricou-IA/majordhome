// scripts/thermique/assemble-batiment-parametrique.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empriseDerives } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';

const rect = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

test('empriseDerives : rectangle 500×400 cm → 20 m² / 18 m', () => {
  const d = empriseDerives({ polygone: rect(0, 0, 500, 400) });
  assert.equal(d.surfaceSol, 20);   // 5 m × 4 m
  assert.equal(d.perimetre, 18);    // 2×(5+4)
});

test('empriseDerives : polygone vide → { surfaceSol: 0, perimetre: 0 }', () => {
  const d = empriseDerives({ polygone: [] });
  assert.equal(d.surfaceSol, 0);
  assert.equal(d.perimetre, 0);
});

test('empriseDerives : emprise absente → { 0, 0 } (jamais throw)', () => {
  assert.deepEqual(empriseDerives(undefined), { surfaceSol: 0, perimetre: 0 });
});

import { resoudUFamille } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';
import { readFileSync } from 'node:fs';
const U_DEFAUTS = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));

const compos = {
  familles: {
    murs: { mode: 'valeur', u: 0.5 }, plancherBas: { mode: 'defaut', u: null },
    plafondToiture: { mode: 'defaut', u: null },
    fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 },
  },
  exceptions: { parois: { 'sej:murs': { u: 0.25 } }, ouvertures: {} },
};

test('resoudUFamille : valeur famille murs = 0.5', () => {
  assert.equal(resoudUFamille(compos, 'murs', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), 0.5);
});
test('resoudUFamille : exception pièce×famille prioritaire', () => {
  assert.equal(resoudUFamille(compos, 'murs', 'sej', { uDefauts: U_DEFAUTS, annee: 2010 }), 0.25);
});
test('resoudUFamille : mode défaut plancherBas résout via u-defauts par année', () => {
  const u = resoudUFamille(compos, 'plancherBas', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 });
  assert.ok(Number.isFinite(u) && u > 0);
});
test('resoudUFamille : menuiserie fenetre = 1.3', () => {
  assert.equal(resoudUFamille(compos, 'fenetre', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), 1.3);
});
test('resoudUFamille : U absent → null', () => {
  const c = { familles: { murs: { mode: 'valeur', u: null } }, exceptions: { parois: {}, ouvertures: {} } };
  assert.equal(resoudUFamille(c, 'murs', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), null);
});

import { paroisPieceParametrique } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';

const ctxBase = {
  compositions: {
    familles: {
      murs: { mode: 'valeur', u: 0.4 }, plancherBas: { mode: 'valeur', u: 0.3 },
      plafondToiture: { mode: 'valeur', u: 0.2 }, fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 },
    },
    exceptions: { parois: {}, ouvertures: {} },
  },
  uDefauts: U_DEFAUTS, annee: 2010, deltaUtb: 0.1, bPlancherBas: 1, bComble: 0.9,
  estRez: true, estDernier: true,
};
// Pièce 5×4×2.5 m, 9 m de mur ext, 3 m² d'ouverture (fenêtre), pas de LNC.
const pieceRef = {
  id: 'sej', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
  longueur: 500, largeur: 400, hauteur: 250,
  mlMurExterieur: 900, mlMurLocalNonChauffe: 0, bLocalNonChauffe: 0.6,
  surfaceOuverture: 3, typeMenuiserie: 'fenetre',
};

test('parois : mur ext = 9×2.5 − 3 = 19.5 m², b=1, poste murs', () => {
  const { parois, erreurs } = paroisPieceParametrique(pieceRef, ctxBase);
  assert.deepEqual(erreurs, []);
  const murExt = parois.find((p) => p.type === 'mur-exterieur');
  assert.equal(murExt.surface, 19.5);
  assert.equal(murExt.u, 0.4);
  assert.equal(murExt.b, 1);
  assert.equal(murExt.poste, 'murs');
  assert.equal(murExt.deltaUtb, 0.1);
});
test('parois : menuiserie = 3 m² × U 1.3, poste menuiseries', () => {
  const { parois } = paroisPieceParametrique(pieceRef, ctxBase);
  const men = parois.find((p) => p.poste === 'menuiseries');
  assert.equal(men.surface, 3);
  assert.equal(men.u, 1.3);
  assert.equal(men.b, 1);
});
test('parois : plancher bas + plafond présents au rez+dernier (surface 20 m²)', () => {
  const { parois } = paroisPieceParametrique(pieceRef, ctxBase);
  assert.equal(parois.find((p) => p.type === 'plancher-bas').surface, 20);
  assert.equal(parois.find((p) => p.type === 'plancher-bas').b, 1);
  assert.equal(parois.find((p) => p.type === 'plafond-comble').surface, 20);
  assert.equal(parois.find((p) => p.type === 'plafond-comble').b, 0.9);
});
test('parois : niveau intermédiaire (ni rez ni dernier) → ni plancher ni plafond', () => {
  const { parois } = paroisPieceParametrique(pieceRef, { ...ctxBase, estRez: false, estDernier: false });
  assert.equal(parois.some((p) => p.poste === 'plancherBas'), false);
  assert.equal(parois.some((p) => p.poste === 'plafondToiture'), false);
});
test('parois : mur sur LNC = ml × H, b = bLocalNonChauffe', () => {
  const { parois } = paroisPieceParametrique({ ...pieceRef, mlMurLocalNonChauffe: 400, bLocalNonChauffe: 0.6 }, ctxBase);
  const lnc = parois.find((p) => p.type === 'mur-lnc');
  assert.equal(lnc.surface, 10);   // 4 m × 2.5 m
  assert.equal(lnc.b, 0.6);
});
test('parois : ouverture > mur ext → erreur pièce', () => {
  const { parois, erreurs } = paroisPieceParametrique({ ...pieceRef, surfaceOuverture: 100 }, ctxBase);
  assert.equal(parois.length, 0);
  assert.ok(erreurs[0].includes('ouverture'));
});
test('parois : U manquant (famille murs null) → erreur', () => {
  const ctx = { ...ctxBase, compositions: { familles: { ...ctxBase.compositions.familles, murs: { mode: 'valeur', u: null } }, exceptions: { parois: {}, ouvertures: {} } } };
  const { erreurs } = paroisPieceParametrique(pieceRef, ctx);
  assert.ok(erreurs.some((e) => e.includes('murs')));
});

import { assembleBatimentParametrique } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';
import { calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';
const CLIMAT = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/climat.json', import.meta.url), 'utf8'));
const COEFF_B = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/coefficients-b.json', import.meta.url), 'utf8'));
const VENTIL = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/ventilation.json', import.meta.url), 'utf8'));

const saisieRef = {
  modeSaisie: 'parametrique', plancherBasType: 'terre-plein', toitureType: 'comble',
  niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, hauteur: 250, emprise: { polygone: rect(0, 0, 500, 400) } }],
  pieces: [{
    id: 'sej', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
    longueur: 500, largeur: 400, hauteur: 250, mlMurExterieur: 900, mlMurLocalNonChauffe: 0,
    bLocalNonChauffe: 0.6, surfaceOuverture: 3, typeMenuiserie: 'fenetre',
  }],
};
const optionsRef = {
  data: { climat: CLIMAT, uDefauts: U_DEFAUTS, coefficientsB: COEFF_B, ventilation: VENTIL },
  contexte: { dept: '81', altitude: 200, annee: 2010, typeVentilation: 'vmc-sf-auto', isolation: 'iti', combleIsolation: 'isole', sousSolAvecOuvertures: false, relance: false },
  compositions: { familles: { murs: { mode: 'valeur', u: 0.4 }, plancherBas: { mode: 'valeur', u: 0.3 }, plafondToiture: { mode: 'valeur', u: 0.2 }, fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 } }, exceptions: { parois: {}, ouvertures: {} } },
  reglages: { deltaUtb: { 'non-isole': 0.15, iti: 0.10, ite: 0.05 }, fRH: 0 },
};

test('assembleBatimentParametrique : batiment consommable par calculeBatiment', () => {
  const { batiment, thetaE, erreurs } = assembleBatimentParametrique(saisieRef, optionsRef);
  assert.deepEqual(erreurs, []);
  assert.ok(Number.isFinite(thetaE));
  const bilan = calculeBatiment(batiment);
  assert.ok(bilan.total > 0);
  assert.equal(bilan.pieces.length, 1);
  assert.ok(bilan.pieces[0].parPoste.murs > 0);
  assert.ok(bilan.pieces[0].parPoste.menuiseries > 0);
});

test('assembleBatimentParametrique : aucune pièce chauffée → erreur', () => {
  const s = { ...saisieRef, pieces: [{ ...saisieRef.pieces[0], chauffee: false }] };
  const { batiment, erreurs } = assembleBatimentParametrique(s, optionsRef);
  assert.equal(batiment, null);
  assert.ok(erreurs.some((e) => e.includes('chauffée')));
});

test('assembleBatimentParametrique : θint manquante sur pièce chauffée → erreur', () => {
  const s = { ...saisieRef, pieces: [{ ...saisieRef.pieces[0], thetaInt: null }] };
  const { erreurs } = assembleBatimentParametrique(s, optionsRef);
  assert.ok(erreurs.some((e) => e.includes('consigne')));
});

// --- Régressions revue finale (2026-07-09) ---

test('#3 plancher bas : niveau le plus bas EXISTANT (rang non nul) porte le plancher — pas de rang 0 en dur', () => {
  // Un seul niveau restant à rang 3 (ex. après suppression du rez) → il doit être estRez ET estDernier.
  const s = {
    ...saisieRef,
    niveaux: [{ id: 'n3', nom: 'Niveau', rang: 3, hauteur: 250, emprise: { polygone: rect(0, 0, 500, 400) } }],
    pieces: [{ ...saisieRef.pieces[0], niveauId: 'n3' }],
  };
  const { batiment, erreurs } = assembleBatimentParametrique(s, optionsRef);
  assert.deepEqual(erreurs, []);
  const types = batiment.pieces[0].parois.map((p) => p.type);
  assert.ok(types.includes('plancher-bas'), 'plancher bas absent alors que niveau le plus bas');
  assert.ok(types.includes('plafond-comble'), 'plafond absent alors que dernier niveau');
});

test('#4 toiture rampant : plafond en type toiture-rampant, b=1 (pas de tampon comble)', () => {
  const s = { ...saisieRef, toitureType: 'rampant' };
  const { batiment, erreurs } = assembleBatimentParametrique(s, optionsRef);
  assert.deepEqual(erreurs, []);
  const plafond = batiment.pieces[0].parois.find((p) => p.poste === 'plafondToiture');
  assert.equal(plafond.type, 'toiture-rampant');
  assert.equal(plafond.b, 1);
});

test('#4 toiture comble (défaut) : plafond-comble avec b = bComble (< 1)', () => {
  const { batiment } = assembleBatimentParametrique(saisieRef, optionsRef);
  const plafond = batiment.pieces[0].parois.find((p) => p.poste === 'plafondToiture');
  assert.equal(plafond.type, 'plafond-comble');
  assert.ok(plafond.b > 0 && plafond.b < 1);
});
