// Scène de la coupe cotée (src/lib/fumisterie/scene.js) : seule définition du dessin, partagée par
// l'écran et le plan annexé au devis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireScene } from '../../src/lib/fumisterie/scene.js';
import { geometrieG1 } from '../../src/lib/fumisterie/gabarits/g1.js';
import { geometrieG3 } from '../../src/lib/fumisterie/gabarits/g3.js';
import { geometrieG4 } from '../../src/lib/fumisterie/gabarits/g4.js';
import { geometrieG6 } from '../../src/lib/fumisterie/gabarits/g6.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';

const cfg = buildFumisterieConfig(null);
const G1 = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5, hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };
const G3 = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, hTraversee: 1.6, lHoriz: 0.6, epMur: 0.3, hMur: 5.5, pente: 35, dFaitage: 4, hSortie: 3.5 };
const G4 = { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'plafond', hsp1: 2.5, hEntree: 1.5, lHoriz: 0.5, hConduit: 6, boisseau: 1 };
const G6 = { diametre: 80, finition: 'noir', hBuse: 1.05, hSortie: 1.8, lHoriz: 0.6, epMur: 0.3 };

const finis = (scene) => {
  const nombres = JSON.stringify(scene).match(/-?\d+(\.\d+)?(e-?\d+)?/g) || [];
  assert.ok(!JSON.stringify(scene).includes('NaN') && !JSON.stringify(scene).includes('null,'), 'coordonnée non finie');
  assert.ok(nombres.length > 20);
  assert.ok(scene.largeur > 0 && scene.hauteur > 0 && Number.isFinite(scene.largeur) && Number.isFinite(scene.hauteur));
};
const reperes = (s) => s.reperes.map((r) => r.n);
const cles = (s) => s.cotes.map((c) => c.cle);

test('G1 : repères 1 à 6, cotes du relevé, étage et dévoiement', () => {
  const s = construireScene('G1', geometrieG1(G1, cfg), G1);
  finis(s);
  assert.deepEqual(reperes(s), [1, 2, 3, 4, 5, 6]);
  for (const c of ['hBuse', 'hsp1', 'hsp2', 'hCombles', 'hSortie', 'decal', 'dFaitage']) assert.ok(cles(s).includes(c), c);
  const sans = { ...G1, nbEtages: 0, angle: 0 };
  const s2 = construireScene('G1', geometrieG1(sans, cfg), sans);
  assert.ok(!cles(s2).includes('hsp2') && !cles(s2).includes('decal'));
});

test('G3, G4 (et variantes), G6 : repères propres à chaque coupe', () => {
  assert.deepEqual(reperes(construireScene('G3', geometrieG3(G3, cfg), G3)), [1, 2, 5, 7, 8]);
  assert.deepEqual(reperes(construireScene('G3P', geometrieG3(G3, cfg), G3)), [1, 2, 5, 7, 8]);
  for (const code of ['G4', 'G4R', 'G4P', 'G4K', 'G4F', 'G5']) {
    const r = code === 'G5' ? { ...G4, hConduit: 0 } : G4;
    const s = construireScene(code, geometrieG4({ ...r, rigide: code === 'G4R' }, cfg), r);
    finis(s);
    assert.deepEqual(reperes(s), [1, 2, 3, 4, 5], code);
  }
  const s6 = construireScene('G6', geometrieG6(G6, cfg), G6);
  finis(s6);
  assert.deepEqual(reperes(s6), [1, 2, 3, 4]);
});

test('G5 (conduit non métré) : mention dessinée après les cotes, pas de cote de conduit', () => {
  const r = { ...G4, hConduit: 0 };
  const s = construireScene('G5', geometrieG4({ ...r, rigide: false }, cfg), r);
  assert.ok(!cles(s).includes('hConduit'));
  assert.ok(s.formes.some((f) => f.texte === 'non métré' && f.apresCotes));
});

test('gabarit inconnu ou données absentes : pas de scène', () => {
  assert.equal(construireScene('GX', {}, {}), null);
  assert.equal(construireScene('G1', null, G1), null);
});

test('ligne de zone : état ok sur la maquette, ko avec une sortie trop basse', () => {
  const zone = (r) => construireScene('G1', geometrieG1(r, cfg), r).formes.find((f) => f.ton === 'zoneTexte');
  assert.equal(zone(G1).etat, 'ok');
  assert.equal(zone({ ...G1, hSortie: 0.5 }).etat, 'ko');
  assert.ok(!zone(G1).texte.includes('✓'), 'le symbole est posé par le rendu, pas par la scène');
});

test('police : repères et boîtes de cote suivent la taille du texte', () => {
  const g = geometrieG1(G1, cfg);
  const a = construireScene('G1', g, G1);
  const b = construireScene('G1', g, G1, { police: 26 });
  assert.equal(b.reperes[0].r, a.reperes[0].r * 2);
  assert.ok(Math.abs(b.cotes[0].boite.h - a.cotes[0].boite.h * 2) < 1e-9);
  assert.equal(a.reperes[0].r, 12);
});
