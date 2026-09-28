// scripts/fumisterie/g3-g5-g6.test.mjs — géométrie et contrôles des gabarits façade (G3), raccordement seul (G5), ventouse (G6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geometrieG3, hauteurSortieMinimaleG3 } from '../../src/lib/fumisterie/gabarits/g3.js';
import { geometrieG6 } from '../../src/lib/fumisterie/gabarits/g6.js';
import { controlesG3, controlesG6 } from '../../src/lib/fumisterie/controles.js';
import { validerReleve, sortieMinimale, calculerMetre } from '../../src/lib/fumisterie/index.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';

const cfg = buildFumisterieConfig(null);
const lire = (f) => JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url), 'utf8'));
const pres = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
const R3 = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, hTraversee: 1.6, lHoriz: 0.6, epMur: 0.3, raccord: 'emaille_12', hMur: 5.5, pente: 35, dFaitage: 4, hSortie: 3.5 };

test('G3 : té à la traversée, façade de la traversée au sommet, zone 1 depuis le faîtage', () => {
  const g = geometrieG3(R3, cfg);
  pres(g.yTe, 1.6); pres(g.Lsp_v, 0.55); pres(g.Lsp_h, 0.6); pres(g.Ltrav, 0.5); pres(g.Lfac, 5.5 + 3.5 - 1.6);
  pres(g.yRidge, 5.5 + 4 * Math.tan((35 * Math.PI) / 180)); pres(g.yReq, g.yRidge + 0.4);
  assert.deepEqual(g.troncons.facade.composition.elements, { 1000: 7, 500: 0, 250: 0 });
  assert.equal(g.troncons.facade.composition.reglable.n, 1); // 7,4 m = 7 × 1000 + réglable 400
  assert.ok(g.topAct > g.yTe);
});
test('G3 : contrôles zone 1 ok / trop bas, ajustement au minimum, haubanage au-delà de 3 m', () => {
  assert.equal(controlesG3(geometrieG3(R3, cfg), R3, cfg).find((a) => a.code === 'zone1').niveau, 'ok');
  const bas = { ...R3, hSortie: 1 };
  assert.equal(controlesG3(geometrieG3(bas, cfg), bas, cfg).find((a) => a.code === 'zone1').niveau, 'warn');
  const h = hauteurSortieMinimaleG3(bas, cfg);
  assert.equal(Math.round(h * 20) / 20, h);
  const ok = { ...bas, hSortie: h };
  assert.equal(controlesG3(geometrieG3(ok, cfg), ok, cfg).find((a) => a.code === 'zone1').niveau, 'ok');
  assert.equal(sortieMinimale({ gabarit: lire('gabarit-g3.json'), reglages: cfg, releve: bas }), h);
  assert.ok(controlesG3(geometrieG3(R3, cfg), R3, cfg).some((a) => a.code === 'haubanage'));
});
test('G3 : toit plat (pente 10°) → +1,20 m au-dessus de l\'égout ; relevé complet exigé', () => {
  const r = { ...R3, pente: 10 };
  const g = geometrieG3(r, cfg);
  assert.equal(g.flat, true); pres(g.yReq, 5.5 + 1.2);
  assert.equal(validerReleve(lire('gabarit-g3.json'), R3).ok, true);
  assert.equal(validerReleve(lire('gabarit-g3.json'), { ...R3, hMur: '' }).ok, false);
  assert.equal(validerReleve(lire('gabarit-g3p.json'), { ...R3, raccord: undefined }).ok, true);
});
test('G6 : vertical buse → axe de sortie, horizontal jusqu\'au mur, contrôles zone 3 et mur mince', () => {
  const r = { diametre: 80, finition: 'noir', hBuse: 0.9, hSortie: 1.8, lHoriz: 0.6, epMur: 0.3 };
  const g = geometrieG6(r, cfg);
  pres(g.Lv, 0.9); pres(g.Lh, 0.6); pres(g.Ltrav, 0.3);
  assert.deepEqual(g.troncons.vertical.composition.elements, { 1000: 1, 500: 0, 250: 0 });
  assert.deepEqual(g.troncons.horizontal.composition.elements, { 1000: 0, 500: 1, 250: 1 });
  const a = controlesG6(g, r);
  assert.ok(a.some((x) => x.code === 'zone3_non_verifiee' && x.niveau === 'warn'));
  assert.ok(controlesG6(geometrieG6({ ...r, epMur: 0.1 }, cfg), { ...r, epMur: 0.1 }).some((x) => x.code === 'mur_mince'));
  assert.equal(validerReleve(lire('gabarit-g6.json'), r).ok, true);
});
test('G5 : raccordement seul — pas de conduit, info « conduit non métré », composants du plafond ou du mur seulement', () => {
  const gabarit = lire('gabarit-g5.json'); const composants = lire('cfg45-composants.json');
  const base = { configuration: { code: 'CFG-45', gabarit_code: 'G5' }, gabarit, composants, mapping: [], articles: [], reglages: cfg };
  const plafond = calculerMetre({ ...base, releve: { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'plafond', hsp1: 2.5, raccord: 'emaille_12', kit_air: 0 } });
  assert.ok(plafond.alertes.some((a) => a.code === 'conduit_non_metre'));
  assert.deepEqual(plafond.lignes.map((l) => l.composant_code), ['tuyau_emaille_12', 'tuyau_emaille_12', 'rosace_plafond']);
  const mur = calculerMetre({ ...base, releve: { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'mur', hsp1: 2.5, hEntree: 1.5, lHoriz: 0.4, raccord: 'acier_peint', kit_air: 1 } });
  assert.deepEqual(mur.lignes.map((l) => l.composant_code), ['coude_90_raccord', 'tuyau_acier_peint', 'rosace_sceller', 'kit_entree_air']);
  assert.equal(plafond.geometrie.troncons.conduit_existant.ml, 0.5); // 0 m de conduit + débord : jamais consommé (pas de composant)
});
test('G4P : le bas de conduit pilote l\'entrée (mur → hEntree exigé) et le foyer supprime le tuyau', () => {
  const gabarit = lire('gabarit-g4p.json');
  const r = { diametre: 150, finition: 'noir', hBuse: 1.05, bas: 'mur', hsp1: 2.5, raccord: 'emaille_12', hConduit: 6, boisseau: 3, chapeau: 'standard' };
  assert.equal(validerReleve(gabarit, r).ok, false);
  assert.equal(validerReleve(gabarit, { ...r, hEntree: 1.5, lHoriz: 0.4 }).ok, true);
  const foyer = calculerMetre({ configuration: { code: 'CFG-37', gabarit_code: 'G4P' }, gabarit, composants: lire('cfg37-composants.json'), mapping: [], articles: [], reglages: cfg, releve: { ...r, bas: 'foyer' } });
  assert.equal(foyer.geometrie.Lsp, 0);
  assert.ok(!foyer.lignes.some((l) => l.composant_code.startsWith('tuyau_')));
  assert.ok(!foyer.alertes.some((a) => a.code === 'buse'));
});
