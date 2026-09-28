// scripts/fumisterie/g4.test.mjs — géométrie et contrôles du gabarit G4 (tubage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geometrieG4 } from '../../src/lib/fumisterie/gabarits/g4.js';
import { controlesG4 } from '../../src/lib/fumisterie/controles.js';
import { validerReleve, sortieMinimale } from '../../src/lib/fumisterie/index.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';

const cfg = buildFumisterieConfig(null);
const G4 = JSON.parse(readFileSync(new URL('./data/gabarit-g4.json', import.meta.url), 'utf8'));
const G4R = JSON.parse(readFileSync(new URL('./data/gabarit-g4r.json', import.meta.url), 'utf8'));
const PLAFOND = { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'plafond', hsp1: 2.5, raccord: 'emaille_12', hConduit: 6.2, boisseau: 3, chapeau: 'standard', kit_air: 0 };
const MUR = { ...PLAFOND, entree: 'mur', hEntree: 1.6, lHoriz: 0.45 };
const pres = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('entrée par le plafond : raccordement = plafond − buse, flexible = conduit + marge arrondi au 0,5 m', () => {
  const g = geometrieG4({ ...PLAFOND, rigide: false }, cfg);
  assert.equal(g.mur, false); pres(g.yEntree, 2.5); pres(g.ySouche, 8.7);
  pres(g.Lsp_v, 1.45); assert.equal(g.Lsp_h, 0);
  assert.deepEqual(g.troncons.raccordement_sp.composition.elements, { 1000: 1, 500: 1, 250: 0 });
  assert.equal(g.troncons.raccordement_sp.composition.surlongueur, 50);
  assert.equal(g.troncons.conduit_existant.composition, null);
  assert.equal(g.troncons.conduit_existant.ml, 7); // 6,2 + 0,5 = 6,7 → 7,0
  assert.equal(g.Lflex, 7);
});
test('entrée par le mur : raccordement vertical jusqu\'au piquage + horizontal', () => {
  const g = geometrieG4({ ...MUR, rigide: false }, cfg);
  assert.equal(g.mur, true); pres(g.yEntree, 1.6); pres(g.ySouche, 7.8);
  pres(g.Lsp_v, 0.55); pres(g.Lsp_h, 0.45); pres(g.Lsp, 1.0);
  assert.deepEqual(g.troncons.raccordement_sp.composition.elements, { 1000: 1, 500: 0, 250: 0 });
});
test('rigide PRH : conduit et raccordement composés en 1000/500/330, pas de flexible', () => {
  const g = geometrieG4({ ...PLAFOND, hConduit: 4.3, rigide: true }, cfg);
  assert.equal(g.rigide, true);
  assert.equal(g.troncons.conduit_existant.ml, null);
  assert.deepEqual(g.troncons.conduit_existant.composition.elements, { 1000: 4, 500: 0, 330: 1 });
  assert.equal(g.troncons.conduit_existant.composition.surlongueur, 30);
  assert.deepEqual(g.troncons.raccordement_sp.composition.elements, { 1000: 1, 500: 1, 330: 0 });
});
test('arrondi du flexible : 6,5 m tombe juste, 6,51 monte à 7,5 ; réglages d\'org respectés', () => {
  assert.equal(geometrieG4({ ...PLAFOND, hConduit: 6.0 }, cfg).Lflex, 6.5);
  assert.equal(geometrieG4({ ...PLAFOND, hConduit: 6.01 }, cfg).Lflex, 7);
  const c2 = buildFumisterieConfig({ fumisterie: { flexible_marge_m: 1, flexible_arrondi_m: 1 } });
  assert.equal(geometrieG4({ ...PLAFOND, hConduit: 6.2 }, c2).Lflex, 8);
});
test('contrôles : info zone 1 non vérifiée toujours ; buse au plafond → warn ; mur en Ø180 → warn piquage', () => {
  const ok = controlesG4(geometrieG4(PLAFOND, cfg), PLAFOND, cfg);
  assert.ok(ok.some((a) => a.code === 'zone1_non_verifiee' && a.niveau === 'info'));
  assert.ok(!ok.some((a) => a.niveau === 'warn'));
  const r1 = { ...PLAFOND, hBuse: 2.5 };
  assert.ok(controlesG4(geometrieG4(r1, cfg), r1, cfg).some((a) => a.code === 'buse' && a.niveau === 'warn'));
  const r2 = { ...MUR, diametre: 180 };
  assert.ok(controlesG4(geometrieG4(r2, cfg), r2, cfg).some((a) => a.code === 'piquage_diametre'));
  const r3 = { ...PLAFOND, hConduit: 0.8 };
  assert.ok(controlesG4(geometrieG4(r3, cfg), r3, cfg).some((a) => a.code === 'conduit_court'));
});
test('relevé : hEntree / lHoriz exigés seulement par le mur ; G4R n\'a ni raccord ni chapeau', () => {
  assert.equal(validerReleve(G4, PLAFOND).ok, true);
  assert.equal(validerReleve(G4, { ...PLAFOND, entree: 'mur' }).ok, false);
  assert.equal(validerReleve(G4, MUR).ok, true);
  assert.equal(validerReleve(G4, { ...PLAFOND, boisseau: 9 }).ok, false);
  const cles = G4R.troncons.flatMap((t) => t.parametres.map((p) => p.cle));
  assert.ok(!cles.includes('raccord') && !cles.includes('chapeau'));
  assert.equal(validerReleve(G4R, { diametre: 80, hBuse: 0.9, entree: 'plafond', hsp1: 2.4, hConduit: 5, boisseau: 1 }).ok, true);
});
test('pas de sortie de toit : sortieMinimale renvoie null pour G4 (le bouton « Ajuster » n\'existe pas)', () => {
  assert.equal(sortieMinimale({ gabarit: G4, reglages: cfg, releve: PLAFOND }), null);
});
