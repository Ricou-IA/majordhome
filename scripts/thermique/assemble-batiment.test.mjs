// scripts/thermique/assemble-batiment.test.mjs
// Tests de l'assembleur (plan 4) : dessin (plan 3) + données (plan 1) + choix wizard → bâtiment
// résolu pour calculeBatiment (plan 2). Formalise D1-D11 de docs/thermique-plan4-handoff.md.
// Discipline plans 1-3 : chaque b/U attendu est résolu contre les VRAIS JSON (aucune valeur inventée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bLncParPiece, resoudParoi, bPlancherBasPour,
} from '../../src/apps/thermique/lib/assembleBatiment.js';

const U_DEFAUTS = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));
const COEFF_B = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/coefficients-b.json', import.meta.url), 'utf8'));

const rect = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

// ── bLncParPiece : b d'un LNC déduit du nombre de murs extérieurs de la pièce (D4) ──

test('bLncParPiece : garage à 3 murs extérieurs (1 mur mitoyen) → 0.8', () => {
  const dessin = {
    niveaux: [{ id: 'rdc', hauteur: 250 }],
    ouvertures: [],
    pieces: [
      { id: 'sej', niveauId: 'rdc', chauffee: true, polygone: rect(0, 0, 500, 400) },
      { id: 'gar', niveauId: 'rdc', chauffee: false, polygone: rect(500, 0, 800, 400) },
    ],
  };
  const { bParPiece, avertissements } = bLncParPiece(dessin, COEFF_B);
  assert.equal(bParPiece.get('gar'), 0.8); // « Avec au moins 3 murs extérieurs »
  assert.deepEqual(avertissements, []);
});

test('bLncParPiece : placard enclavé (0 mur extérieur) → 0.4 + avertissement', () => {
  const dessin = {
    niveaux: [{ id: 'rdc', hauteur: 250 }],
    ouvertures: [],
    pieces: [
      { id: 'placard', niveauId: 'rdc', chauffee: false, polygone: rect(200, 200, 300, 300) },
      { id: 'n', niveauId: 'rdc', chauffee: true, polygone: rect(200, 100, 300, 200) },
      { id: 's', niveauId: 'rdc', chauffee: true, polygone: rect(200, 300, 300, 400) },
      { id: 'o', niveauId: 'rdc', chauffee: true, polygone: rect(100, 200, 200, 300) },
      { id: 'e', niveauId: 'rdc', chauffee: true, polygone: rect(300, 200, 400, 300) },
    ],
  };
  const { bParPiece, avertissements } = bLncParPiece(dessin, COEFF_B);
  assert.equal(bParPiece.get('placard'), 0.4); // 0 mur ext → assimilé 1 mur (b mini 0.4)
  assert.equal(avertissements.length, 1);
  assert.match(avertissements[0], /placard/);
});

test('bLncParPiece : garage 2 murs extérieurs — sans porte → 0.5, avec porte → 0.6', () => {
  const base = {
    niveaux: [{ id: 'rdc', hauteur: 250 }],
    pieces: [
      { id: 'gar', niveauId: 'rdc', chauffee: false, polygone: rect(0, 0, 300, 300) },
      { id: 'e', niveauId: 'rdc', chauffee: true, polygone: rect(300, 0, 600, 300) },
      { id: 's', niveauId: 'rdc', chauffee: true, polygone: rect(0, 300, 300, 600) },
    ],
  };
  // gar : ouest (x=0) + nord (y=0) extérieurs ; est + sud mitoyens → 2 murs ext.
  assert.equal(bLncParPiece({ ...base, ouvertures: [] }, COEFF_B).bParPiece.get('gar'), 0.5);
  const avecPorte = {
    ...base,
    ouvertures: [{ id: 'p1', pieceId: 'gar', segmentIndex: 0, type: 'porte', largeur: 90, hauteur: 200, position: 100 }],
  };
  assert.equal(bLncParPiece(avecPorte, COEFF_B).bParPiece.get('gar'), 0.6);
});

// ── bPlancherBasPour : b du plancher bas selon le type de sol (D5) ──

test('bPlancherBasPour : terre-plein 1, vide-sanitaire 0.5, sous-sol 0.5/0.8', () => {
  assert.equal(bPlancherBasPour(COEFF_B, 'terre-plein'), 1);
  assert.equal(bPlancherBasPour(COEFF_B, 'vide-sanitaire'), 0.5);
  assert.equal(bPlancherBasPour(COEFF_B, 'sous-sol', false), 0.5);
  assert.equal(bPlancherBasPour(COEFF_B, 'sous-sol', true), 0.8);
});

// ── resoudParoi : chaque type de paroi → paroi moteur (D3-D11) ──

function ctxBase(overrides = {}) {
  return {
    annee: 1960, uDefauts: U_DEFAUTS, coefficientsB: COEFF_B,
    compositions: {
      familles: {
        murs: { mode: 'defaut', u: null },
        plancherBas: { mode: 'defaut', u: null },
        plafondToiture: { mode: 'defaut', u: null },
        fenetre: { u: 2.8 }, porteFenetre: { u: 2.8 }, porte: { u: 3.5 },
      },
      exceptions: { parois: {}, ouvertures: {} },
    },
    deltaUtb: 0.1,
    bParPieceLnc: new Map([['garage', 0.8]]),
    thetaIntParPiece: new Map([['chambre', 18]]),
    combleIsolation: 'isole',
    bPlancherBas: 1,
    ...overrides,
  };
}

const champs = (p, cles) => Object.fromEntries(cles.map((k) => [k, p[k]]));

test('resoudParoi : mur-exterieur → U défaut 1960 (2.5), b 1, ΔUtb 0.1', () => {
  const { paroi, erreur } = resoudParoi(
    { type: 'mur-exterieur', surfaceM2: 10, orientation: 'S', pieceId: 'x' }, ctxBase());
  assert.equal(erreur, null);
  assert.deepEqual(champs(paroi, ['surface', 'u', 'b', 'deltaUtb', 'poste']),
    { surface: 10, u: 2.5, b: 1, deltaUtb: 0.1, poste: 'murs' });
  assert.equal(paroi.orientation, 'S'); // conservée (D10)
});

test('resoudParoi : mur-lnc garage → b 0.8', () => {
  const { paroi } = resoudParoi(
    { type: 'mur-lnc', surfaceM2: 10, adjacentPieceId: 'garage', pieceId: 'cuisine' }, ctxBase());
  assert.deepEqual(champs(paroi, ['u', 'b', 'deltaUtb', 'poste']), { u: 2.5, b: 0.8, deltaUtb: 0.1, poste: 'murs' });
});

test('resoudParoi : mur-mitoyen-interne → thetaAdjacente, ΔUtb 0 (D7)', () => {
  const { paroi } = resoudParoi(
    { type: 'mur-mitoyen-interne', surfaceM2: 5, adjacentPieceId: 'chambre', pieceId: 'sejour' }, ctxBase());
  assert.deepEqual(champs(paroi, ['u', 'thetaAdjacente', 'deltaUtb', 'poste']),
    { u: 2.5, thetaAdjacente: 18, deltaUtb: 0, poste: 'murs' });
  assert.equal(paroi.b, undefined);
});

test('resoudParoi : fenêtre extérieure → u saisi 2.8, b 1, poste menuiseries', () => {
  const { paroi } = resoudParoi({ type: 'fenetre', surfaceM2: 1.5, pieceId: 'sejour' }, ctxBase());
  assert.deepEqual(champs(paroi, ['u', 'b', 'deltaUtb', 'poste']), { u: 2.8, b: 1, deltaUtb: 0.1, poste: 'menuiseries' });
});

test('resoudParoi : fenêtre sur LNC → b du LNC (D11)', () => {
  const { paroi } = resoudParoi(
    { type: 'fenetre', surfaceM2: 1.5, adjacentPieceId: 'garage', pieceId: 'cuisine' }, ctxBase());
  assert.deepEqual(champs(paroi, ['u', 'b', 'deltaUtb', 'poste']), { u: 2.8, b: 0.8, deltaUtb: 0.1, poste: 'menuiseries' });
});

test('resoudParoi : fenêtre sur mitoyen chauffé émis → thetaAdjacente, ΔUtb 0 (D11)', () => {
  const { paroi } = resoudParoi(
    { type: 'fenetre', surfaceM2: 1.5, adjacentPieceId: 'chambre', pieceId: 'sejour' }, ctxBase());
  assert.deepEqual(champs(paroi, ['u', 'thetaAdjacente', 'deltaUtb', 'poste']),
    { u: 2.8, thetaAdjacente: 18, deltaUtb: 0, poste: 'menuiseries' });
});

test('resoudParoi : porte avec exception par ouverture → U forcé', () => {
  const ctx = ctxBase();
  ctx.compositions.exceptions.ouvertures = { 'o-1': { u: 2.0 } };
  const { paroi } = resoudParoi(
    { type: 'porte', surfaceM2: 1.9, ouvertureId: 'o-1', pieceId: 'sejour' }, ctx);
  assert.equal(paroi.u, 2.0); // exception ouverture > famille porte (3.5)
});

test('resoudParoi : planchers — bas terre-plein b 1, sur-exterieur b 1, sur-lnc b 0.8', () => {
  const ctx = ctxBase();
  assert.equal(resoudParoi({ type: 'plancher-bas', surfaceM2: 20, pieceId: 'sejour' }, ctx).paroi.b, 1);
  assert.equal(resoudParoi({ type: 'plancher-bas', surfaceM2: 20, pieceId: 'sejour' }, ctx).paroi.poste, 'plancherBas');
  assert.equal(resoudParoi({ type: 'plancher-sur-exterieur', surfaceM2: 5, pieceId: 'ch' }, ctx).paroi.b, 1);
  assert.equal(resoudParoi({ type: 'plancher-sur-lnc', surfaceM2: 5, adjacentPieceId: 'garage', pieceId: 'ch' }, ctx).paroi.b, 0.8);
  assert.equal(resoudParoi({ type: 'plancher-bas', surfaceM2: 20, pieceId: 'sejour' }, ctx).paroi.u, 2); // U plancherBas défaut 1960
});

test('resoudParoi : plafond-comble selon isolation (0.7 / 0.9 / 1) ; rampant b 1', () => {
  const p = (comble) => resoudParoi({ type: 'plafond-comble', surfaceM2: 20, pieceId: 'ch' },
    ctxBase({ combleIsolation: comble })).paroi;
  assert.equal(p('isole').b, 0.7);
  assert.equal(p('non-isole').b, 0.9);
  assert.equal(p('fortement-ventile').b, 1);
  assert.equal(p('isole').poste, 'plafondToiture');
  assert.equal(p('isole').u, 2.5); // U plafond défaut 1960
  const rampant = resoudParoi({ type: 'toiture-rampant', surfaceM2: 20, pieceId: 'ch' }, ctxBase()).paroi;
  assert.equal(rampant.b, 1);
  assert.equal(rampant.poste, 'plafondToiture');
});

test('resoudParoi : exception par (pièce × famille) → U forcé sur les murs de cette pièce', () => {
  const ctx = ctxBase();
  ctx.compositions.exceptions.parois = { 'sejour:murs': { u: 0.5 } };
  assert.equal(resoudParoi({ type: 'mur-exterieur', surfaceM2: 10, pieceId: 'sejour' }, ctx).paroi.u, 0.5);
  assert.equal(resoudParoi({ type: 'mur-exterieur', surfaceM2: 10, pieceId: 'chambre' }, ctx).paroi.u, 2.5); // autre pièce inchangée
});

test('resoudParoi : U de menuiserie manquant → erreur listée, pas de throw', () => {
  const ctx = ctxBase();
  ctx.compositions.familles.fenetre = { u: null };
  const { paroi, erreur } = resoudParoi({ type: 'fenetre', surfaceM2: 1.5, pieceId: 'sejour' }, ctx);
  assert.equal(paroi, null);
  assert.match(erreur, /U manquant/);
});
