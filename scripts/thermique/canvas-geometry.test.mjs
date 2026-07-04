// Tests du plan 3, Task 7 : helpers d'interaction du canevas (purs).
// Chaque cas est calculé à la main — voir commentaires. Convention de coordonnées et grille
// identiques à geometryEngine.js (cm entiers, grille 10 cm, x → droite, y → bas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapPoint,
  rectDepuisDrag,
  pointDansPolygone,
  segmentLePlusProche,
  positionOuvertureSnappee,
  boiteEnglobante,
} from '../../src/apps/thermique/lib/canvasGeometry.js';
import { normalisePolygone, segmentsDe } from '../../src/apps/thermique/lib/geometryEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// snapPoint
// ─────────────────────────────────────────────────────────────────────────────

test('snapPoint : arrondit chaque coordonnée au multiple de 10 cm le plus proche', () => {
  assert.deepEqual(snapPoint({ x: 12, y: 18 }), { x: 10, y: 20 });
  assert.deepEqual(snapPoint({ x: 0, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(snapPoint({ x: 234, y: 5 }), { x: 230, y: 10 });
});

test('snapPoint : règle de la demi-mesure = arrondi Math.round (demi vers +∞, jamais loin de zéro)', () => {
  // 15 / 10 = 1.5 → Math.round(1.5) = 2 → 20 (demi vers le haut, classique)
  assert.deepEqual(snapPoint({ x: 15, y: 0 }), { x: 20, y: 0 });
  // -15 / 10 = -1.5 → Math.round(-1.5) = -1 (PAS -2 : Math.round arrondit les demis vers +∞,
  // donc « vers le haut » même en négatif, ce qui revient à arrondir vers zéro ici) → -10
  assert.deepEqual(snapPoint({ x: -15, y: 0 }), { x: -10, y: 0 });
});

test('snapPoint : throw thermique sur entrée malformée', () => {
  assert.throws(() => snapPoint(null), /thermique/);
  assert.throws(() => snapPoint({ x: '10', y: 0 }), /thermique/);
  assert.throws(() => snapPoint({ x: NaN, y: 0 }), /thermique/);
});

// ─────────────────────────────────────────────────────────────────────────────
// rectDepuisDrag
// ─────────────────────────────────────────────────────────────────────────────

test('rectDepuisDrag : rectangle CCW normalisé depuis deux points quelconques (repère y-bas)', () => {
  // Drag de (123, 47) vers (388, 302) → snap : (120,50) et (390,300)
  // Rectangle [120,390]×[50,300], normalisé anti-horaire (cf. Task 1 : 0,0→0,h→L,h→L,0)
  const poly = rectDepuisDrag({ x: 123, y: 47 }, { x: 388, y: 302 });
  assert.deepEqual(poly, [
    { x: 120, y: 50 },
    { x: 120, y: 300 },
    { x: 390, y: 300 },
    { x: 390, y: 50 },
  ]);
});

test('rectDepuisDrag : drag en sens inverse (p1 en bas-droite, p2 en haut-gauche) → même rectangle normalisé', () => {
  const poly = rectDepuisDrag({ x: 388, y: 302 }, { x: 123, y: 47 });
  assert.deepEqual(poly, [
    { x: 120, y: 50 },
    { x: 120, y: 300 },
    { x: 390, y: 300 },
    { x: 390, y: 50 },
  ]);
});

test('rectDepuisDrag : drag dégénéré (moins d’une cellule de grille dans une dimension) → null', () => {
  // Après snap, largeur ou hauteur nulle : pas de rectangle
  assert.equal(rectDepuisDrag({ x: 100, y: 100 }, { x: 104, y: 200 }), null); // x snap → 100,100 (même x)
  assert.equal(rectDepuisDrag({ x: 100, y: 100 }, { x: 100, y: 100 }), null); // point unique
});

test('rectDepuisDrag : exactement 1 cellule de grille (10 cm) dans chaque dimension → valide', () => {
  const poly = rectDepuisDrag({ x: 100, y: 100 }, { x: 110, y: 110 });
  assert.deepEqual(poly, [
    { x: 100, y: 100 },
    { x: 100, y: 110 },
    { x: 110, y: 110 },
    { x: 110, y: 100 },
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// pointDansPolygone
// ─────────────────────────────────────────────────────────────────────────────

// Rectangle 400×300 déjà normalisé CCW (cf. Task 1)
const RECT = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 0 }];

// L : rectangle 600×400 amputé d'un coin 200×200 (cf. Task 1), non normalisé ici (déjà CCW-compatible
// à valider par le test lui-même — on utilise la version du plan et on la normalise pour être sûr)
const L_BRUT = [{ x: 0, y: 0 }, { x: 0, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 200 },
  { x: 400, y: 200 }, { x: 400, y: 0 }];
const L = normalisePolygone(L_BRUT);

test('pointDansPolygone : point strictement intérieur → true', () => {
  assert.equal(pointDansPolygone({ x: 200, y: 150 }, RECT), true);
});

test('pointDansPolygone : point strictement extérieur → false', () => {
  assert.equal(pointDansPolygone({ x: 500, y: 150 }, RECT), false);
  assert.equal(pointDansPolygone({ x: -10, y: 150 }, RECT), false);
});

test('pointDansPolygone : point exactement sur un bord → true (ergonomie de sélection)', () => {
  assert.equal(pointDansPolygone({ x: 0, y: 150 }, RECT), true); // sur le mur ouest
  assert.equal(pointDansPolygone({ x: 200, y: 300 }, RECT), true); // sur le mur sud
});

test('pointDansPolygone : point exactement sur un sommet → true', () => {
  assert.equal(pointDansPolygone({ x: 0, y: 0 }, RECT), true);
  assert.equal(pointDansPolygone({ x: 400, y: 300 }, RECT), true);
});

test('pointDansPolygone : L — point dans l’encoche (le coin amputé) → false', () => {
  // Le coin amputé est x∈[400,600], y∈[0,200] : un point à (500,100) est HORS du L
  assert.equal(pointDansPolygone({ x: 500, y: 100 }, L), false);
});

test('pointDansPolygone : L — point dans la partie pleine → true', () => {
  assert.equal(pointDansPolygone({ x: 200, y: 300 }, L), true); // dans le bras bas, large
  assert.equal(pointDansPolygone({ x: 500, y: 300 }, L), true); // dans le bras droit, sous y=200
});

// ─────────────────────────────────────────────────────────────────────────────
// segmentLePlusProche
// ─────────────────────────────────────────────────────────────────────────────

// Segments du RECT normalisé (identiques au commentaire verrouillé de orientationDe) :
//  seg[0] (0,0)→(0,300)     ouest, v, CROISSANT
//  seg[1] (0,300)→(400,300) sud,   h, croissant
//  seg[2] (400,300)→(400,0) est,   v, DÉCROISSANT
//  seg[3] (400,0)→(0,0)     nord,  h, décroissant

test('segmentLePlusProche : point proche du mur ouest (segment croissant) → position depuis (0,0)', () => {
  const r = segmentLePlusProche({ x: 3, y: 120 }, RECT, 20);
  assert.equal(r.segmentIndex, 0);
  assert.equal(r.position, 120); // début du segment = (0,0), donc position = y du point
  assert.equal(r.distance, 3);
});

test('segmentLePlusProche : mur EST (segment décroissant) — position comptée depuis le DÉBUT du parcours, soit l’extrémité (400,300), pas depuis y=0', () => {
  const segs = segmentsDe(RECT);
  assert.deepEqual(segs[2], { x1: 400, y1: 300, x2: 400, y2: 0, longueur: 300, axe: 'v' });

  // Point à (398, 290) : proche du DÉBUT du parcours du mur est (y=300 = début, décroissant vers
  // y=0), mais décalé de 10 cm du coin sud-est pour ne pas être ambigu avec le mur sud (dont la
  // droite porteuse est y=300 sur toute son étendue x∈[0,400] : un point à y=300 serait à distance
  // 0 du mur sud aussi). → position attendue proche de 0 (PAS proche de 300, qui serait le cas si
  // on comptait depuis y=0).
  const proche300 = segmentLePlusProche({ x: 398, y: 290 }, RECT, 20);
  assert.equal(proche300.segmentIndex, 2);
  assert.equal(proche300.position, 10);
  assert.equal(proche300.distance, 2);

  // Point à (398, 10) : proche de la FIN du parcours (y=0), décalé du coin nord-est pour la même
  // raison → position attendue proche de la longueur (300).
  const proche0 = segmentLePlusProche({ x: 398, y: 10 }, RECT, 20);
  assert.equal(proche0.segmentIndex, 2);
  assert.equal(proche0.position, 290);
  assert.equal(proche0.distance, 2);

  // Point au milieu du mur est (y=150) → position = 150 (symétrique, mais confirme l’axe)
  const milieu = segmentLePlusProche({ x: 405, y: 150 }, RECT, 20);
  assert.equal(milieu.segmentIndex, 2);
  assert.equal(milieu.position, 150);
  assert.equal(milieu.distance, 5);
});

test('segmentLePlusProche : distance perpendiculaire pour un point à côté du segment (hors de son étendue) → clampée au segment le plus proche', () => {
  // Point (-5, -5) : hors de l'étendue de seg[0] (ouest, y∈[0,300]) côté sommet (0,0).
  // Le plus proche est en réalité le sommet (0,0), partagé par seg[0] et seg[3].
  // On vérifie juste que la distance rendue est cohérente avec une projection clampée.
  const r = segmentLePlusProche({ x: -5, y: -5 }, RECT, 20);
  assert.ok(r !== null);
  assert.ok([0, 3].includes(r.segmentIndex));
  assert.ok(Math.abs(r.distance - Math.sqrt(50)) < 1e-9);
});

test('segmentLePlusProche : au-delà de la tolérance → null', () => {
  assert.equal(segmentLePlusProche({ x: 200, y: 150 }, RECT, 20), null); // centre, loin de tout mur
});

test('segmentLePlusProche : position toujours clampée à [0, longueur] même pour un point projeté hors segment', () => {
  // Point (-5, 350) : proche du mur ouest (x=0) mais au-delà de son extrémité y=300 (segment [0,300])
  const r = segmentLePlusProche({ x: -3, y: 350 }, RECT, 60);
  assert.equal(r.segmentIndex, 0);
  assert.equal(r.position, 300); // clampé à la longueur du segment ouest
});

// ─────────────────────────────────────────────────────────────────────────────
// positionOuvertureSnappee
// ─────────────────────────────────────────────────────────────────────────────

test('positionOuvertureSnappee : snap simple, ouverture tient largement dans le segment', () => {
  // Segment de longueur 400, position brute 43 → snap 40, largeur 120 → tient dans [0,280]
  const seg = { longueur: 400 };
  assert.equal(positionOuvertureSnappee(seg, 43, 120), 40);
});

test('positionOuvertureSnappee : clamp si le snap dépasse la borne haute (longueur − largeur)', () => {
  // Segment 400, largeur 120 → position max = 280. Position brute 295 → snap 300 → clampé à 280.
  const seg = { longueur: 400 };
  assert.equal(positionOuvertureSnappee(seg, 295, 120), 280);
});

test('positionOuvertureSnappee : clamp à 0 si la position brute (ou son snap) est négative', () => {
  const seg = { longueur: 400 };
  assert.equal(positionOuvertureSnappee(seg, -12, 120), 0);
});

test('positionOuvertureSnappee : largeur > longueur du segment → null (ouverture ne peut pas tenir)', () => {
  const seg = { longueur: 100 };
  assert.equal(positionOuvertureSnappee(seg, 20, 150), null);
});

test('positionOuvertureSnappee : largeur === longueur → seule position valide est 0', () => {
  const seg = { longueur: 200 };
  assert.equal(positionOuvertureSnappee(seg, 77, 200), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// boiteEnglobante
// ─────────────────────────────────────────────────────────────────────────────

test('boiteEnglobante : couvre tous les polygones des pièces avec une marge de 100 cm', () => {
  // Deux pièces : RECT ([0,400]×[0,300]) et une pièce décalée [500,900]×[100,500]
  const pieceB = [{ x: 500, y: 100 }, { x: 500, y: 500 }, { x: 900, y: 500 }, { x: 900, y: 100 }];
  const pieces = [{ id: 'a', polygone: RECT }, { id: 'b', polygone: pieceB }];
  // Bornes brutes : x∈[0,900], y∈[0,500] → avec marge 100 : x∈[-100,1000], y∈[-100,600]
  const box = boiteEnglobante(pieces);
  assert.deepEqual(box, { x: -100, y: -100, largeur: 1100, hauteur: 700 });
});

test('boiteEnglobante : une seule pièce → boîte = son étendue + marge', () => {
  const box = boiteEnglobante([{ id: 'a', polygone: RECT }]);
  assert.deepEqual(box, { x: -100, y: -100, largeur: 600, hauteur: 500 });
});

test('boiteEnglobante : aucune pièce → boîte par défaut 1000×800 à l’origine', () => {
  assert.deepEqual(boiteEnglobante([]), { x: 0, y: 0, largeur: 1000, hauteur: 800 });
});
