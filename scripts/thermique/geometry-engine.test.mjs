import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePolygone, surfaceCm2, perimetreCm, segmentsDe, validePolygone, decomposeIntervalle }
  from '../../src/apps/thermique/lib/geometryEngine.js';

// Rectangle 400×300 cm (séjour 12 m²), déclaré horaire → doit être renversé en anti-horaire
const RECT_HORAIRE = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];

test('normalisePolygone : renverse en anti-horaire (shoelace signé < 0 en repère y-bas)', () => {
  const p = normalisePolygone(RECT_HORAIRE);
  // En repère y-bas, CCW visuel = ordre 0,0 → 0,300 → 400,300 → 400,0
  assert.deepEqual(p[0], { x: 0, y: 0 });
  assert.deepEqual(p[1], { x: 0, y: 300 });
  // Un polygone déjà anti-horaire ressort inchangé
  assert.deepEqual(normalisePolygone(p), p);
});

test('surfaceCm2 / perimetreCm : rectangle et L', () => {
  assert.equal(surfaceCm2(RECT_HORAIRE), 120000);        // 400×300, insensible à l'ordre
  assert.equal(perimetreCm(RECT_HORAIRE), 1400);
  // L : rectangle 600×400 amputé d'un coin 200×200 → 240000−40000 = 200000 cm² ; périmètre 2000
  const L = [{ x: 0, y: 0 }, { x: 0, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 200 },
             { x: 400, y: 200 }, { x: 400, y: 0 }];
  assert.equal(surfaceCm2(L), 200000);
  assert.equal(perimetreCm(L), 2000);
});

test('segmentsDe : segments orientés consécutifs (fermeture implicite)', () => {
  const segs = segmentsDe(normalisePolygone(RECT_HORAIRE));
  assert.equal(segs.length, 4);
  assert.deepEqual(segs[0], { x1: 0, y1: 0, x2: 0, y2: 300, longueur: 300, axe: 'v' });
  assert.equal(segs.reduce((s, x) => s + x.longueur, 0), 1400);
});

test('validePolygone : rectilinéaire, grille 10 cm, non dégénéré, non auto-intersectant', () => {
  assert.deepEqual(validePolygone(RECT_HORAIRE), []);   // valide → aucune erreur
  assert.ok(validePolygone([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 300 }])
    .some((e) => /rectiligne|angle/.test(e)));           // segment diagonal
  assert.ok(validePolygone([{ x: 0, y: 0 }, { x: 405, y: 0 }, { x: 405, y: 300 }, { x: 0, y: 300 }])
    .some((e) => /grille/.test(e)));                     // hors grille 10 cm
  assert.ok(validePolygone([{ x: 0, y: 0 }, { x: 100, y: 0 }]).some((e) => /sommets/.test(e)));
  // auto-intersection (rectilinéaire en 8) :
  const huit = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 100, y: 200 },
                { x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
  assert.ok(validePolygone(huit).some((e) => /intersect/.test(e)));
});

test('decomposeIntervalle : découpe un intervalle selon des recouvrements étiquetés', () => {
  // Intervalle [0, 500] ; recouvrements : [100,300]→'A', [300,400]→'B'
  // → [0,100] libre, [100,300] A, [300,400] B, [400,500] libre
  const r = decomposeIntervalle(0, 500, [
    { de: 100, a: 300, ref: 'A' },
    { de: 300, a: 400, ref: 'B' },
  ]);
  assert.deepEqual(r, [
    { de: 0, a: 100, ref: null },
    { de: 100, a: 300, ref: 'A' },
    { de: 300, a: 400, ref: 'B' },
    { de: 400, a: 500, ref: null },
  ]);
});

test('decomposeIntervalle : recouvrements hors bornes tronqués, contigus fusionnés si même ref', () => {
  const r = decomposeIntervalle(100, 400, [{ de: 0, a: 200, ref: 'A' }, { de: 200, a: 600, ref: 'A' }]);
  assert.deepEqual(r, [{ de: 100, a: 400, ref: 'A' }]);
});

test('decomposeIntervalle : chevauchement de deux refs → erreur (deux pièces sur le même mur au même endroit = dessin invalide, détecté en amont)', () => {
  assert.throws(() => decomposeIntervalle(0, 100, [{ de: 0, a: 60, ref: 'A' }, { de: 40, a: 100, ref: 'B' }]), /thermique/);
});

test('decomposeIntervalle : recouvrement égal à l’intervalle entier → une seule pièce couverte', () => {
  const r = decomposeIntervalle(0, 200, [{ de: 0, a: 200, ref: 'A' }]);
  assert.deepEqual(r, [{ de: 0, a: 200, ref: 'A' }]);
});

test('decomposeIntervalle : recouvrement entièrement hors bornes → ignoré (tout libre)', () => {
  const r = decomposeIntervalle(0, 100, [{ de: 200, a: 300, ref: 'A' }]);
  assert.deepEqual(r, [{ de: 0, a: 100, ref: null }]);
});

test('decomposeIntervalle : deux refs différentes qui se touchent sans se chevaucher → pas d’erreur', () => {
  const r = decomposeIntervalle(0, 100, [{ de: 0, a: 50, ref: 'A' }, { de: 50, a: 100, ref: 'B' }]);
  assert.deepEqual(r, [{ de: 0, a: 50, ref: 'A' }, { de: 50, a: 100, ref: 'B' }]);
});

test('decomposeIntervalle : chevauchement de la MÊME ref → erreur (un tronçon de mur revendiqué deux fois = géométrie amont corrompue)', () => {
  assert.throws(() => decomposeIntervalle(0, 30, [{ de: 0, a: 15, ref: 'A' }, { de: 10, a: 20, ref: 'A' }]), /thermique/);
});

test('decomposeIntervalle : même ref qui se touche sans se chevaucher → fusion sans erreur', () => {
  const r = decomposeIntervalle(0, 30, [{ de: 0, a: 15, ref: 'A' }, { de: 15, a: 30, ref: 'A' }]);
  assert.deepEqual(r, [{ de: 0, a: 30, ref: 'A' }]);
});
