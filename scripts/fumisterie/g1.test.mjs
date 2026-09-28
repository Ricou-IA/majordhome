import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geometrieG1, hauteurSortieMinimale } from '../../src/lib/fumisterie/gabarits/g1.js';
import { controlesG1 } from '../../src/lib/fumisterie/controles.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';

const cfg = buildFumisterieConfig(null);
const RELEVE = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5,
  hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };
const pres = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} ≠ ${b}`);

test('géométrie de la maquette', () => {
  const g = geometrieG1(RELEVE, cfg);
  assert.equal(g.planchers, 2); pres(g.yC, 5.5); pres(g.yRoofTop, 7.2); pres(g.yRidge, 8.3203); pres(g.yReq, 8.7203);
  assert.equal(g.flat, false); pres(g.vg, 0.6928); pres(g.obl, 0.8); assert.equal(g.devOK, true);
  pres(g.Lsp, 1.45); pres(g.Lint, 4.8072);
  assert.equal(g.troncons.conduit_interieur.longueur_mm, 4807);
  assert.deepEqual(g.troncons.conduit_interieur.composition.elements, { 1000: 5, 500: 0, 250: 0 });
  assert.equal(g.troncons.sortie_toit.composition.nb, 3);
  assert.equal(g.troncons.raccordement_sp.composition.surlongueur, 50);
  pres(g.topAct, 9.143); pres(g.hAct, 1.943); pres(g.minSortie, 1.5203);
});
test('contrôles : conforme + infos surlongueur', () => {
  const g = geometrieG1(RELEVE, cfg);
  const a = controlesG1(g, RELEVE, cfg);
  assert.equal(a.find((x) => x.code === 'zone1').niveau, 'ok');
  assert.ok(a.some((x) => x.code === 'surlongueur_interieure'));
  assert.ok(!a.some((x) => x.niveau === 'warn'));
});
test('sortie trop basse → warn zone1 ; ajustement au minimum la rend conforme', () => {
  const bas = { ...RELEVE, hSortie: 0.5 };
  assert.equal(controlesG1(geometrieG1(bas, cfg), bas, cfg).find((x) => x.code === 'zone1').niveau, 'warn');
  const h = hauteurSortieMinimale(bas, cfg);
  assert.equal(Math.round(h * 20) / 20, h); // arrondi aux 5 cm
  const ok = { ...bas, hSortie: h };
  assert.equal(controlesG1(geometrieG1(ok, cfg), ok, cfg).find((x) => x.code === 'zone1').niveau, 'ok');
});
test('pente 12° → toit plat (+1,20 m) et info', () => {
  const r = { ...RELEVE, pente: 12 };
  const g = geometrieG1(r, cfg);
  assert.equal(g.flat, true); pres(g.yReq, g.yRoofTop + 1.2);
  assert.ok(controlesG1(g, r, cfg).some((x) => x.code === 'toit_plat'));
});
test('dévoiement trop grand pour les combles → warn', () => {
  const r = { ...RELEVE, angle: 15, decal: 0.6 };
  assert.ok(controlesG1(geometrieG1(r, cfg), r, cfg).some((x) => x.code === 'devoiement' && x.niveau === 'warn'));
});
test('buse au plafond → warn ; > 3 m au-dessus du toit → warn haubanage', () => {
  const r1 = { ...RELEVE, hBuse: 2.5 };
  assert.ok(controlesG1(geometrieG1(r1, cfg), r1, cfg).some((x) => x.code === 'buse'));
  const r2 = { ...RELEVE, hSortie: 3.5 };
  assert.ok(controlesG1(geometrieG1(r2, cfg), r2, cfg).some((x) => x.code === 'haubanage'));
});
test('sans dévoiement ni étage', () => {
  const r = { ...RELEVE, angle: 0, decal: 0, nbEtages: 0 };
  const g = geometrieG1(r, cfg);
  assert.equal(g.planchers, 1); pres(g.yC, 2.75); assert.equal(g.vg, 0); assert.equal(g.devOK, true);
});
