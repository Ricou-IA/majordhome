import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePolygone, surfaceCm2, perimetreCm, segmentsDe, validePolygone, decomposeIntervalle,
  rectanglesDe, aireIntersectionRectilineaire, adjacencesNiveau, orientationDe, intervalleAxial,
  valideOuvertures }
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

// ═══════════════ Task 3 : rectanglesDe / aireIntersectionRectilineaire / adjacencesNiveau / orientationDe ═══════════════

// Fixtures : L de la Task 1 (600×400 moins un coin 200×200 en bas-droite du repère y-bas, déjà CCW) ;
// U = 500×300 moins une encoche 300×200 (x∈[100,400], y∈[0,200]) ouverte vers le haut du plan (y=0).
const L_CCW = [{ x: 0, y: 0 }, { x: 0, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 200 },
               { x: 400, y: 200 }, { x: 400, y: 0 }];
const U_CCW = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 500, y: 300 }, { x: 500, y: 0 },
               { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 0 }];

test('rectanglesDe : rectangle → un seul rectangle, aire conservée', () => {
  // Un rectangle n'a que 2 abscisses distinctes → 1 bande [0,400] ; arêtes horizontales y=0 et
  // y=300 l'enjambent → intervalle couvert [0,300] → 1 rectangle = le polygone lui-même.
  assert.deepEqual(rectanglesDe(RECT_HORAIRE), [{ x1: 0, y1: 0, x2: 400, y2: 300 }]);
});

test('rectanglesDe : L → 2 rectangles, somme des aires = surfaceCm2', () => {
  // Abscisses distinctes du L : 0, 400, 600 → 2 bandes.
  // Bande [0,400] : arêtes horizontales l'enjambant = y=0 ([0,400]) et y=400 ([0,600])
  //   → couvert [0,400] → rectangle 400×400 = 160000 cm².
  // Bande [400,600] : arêtes l'enjambant = y=200 ([400,600]) et y=400 ([0,600])
  //   → couvert [200,400] → rectangle 200×200 = 40000 cm².
  const rects = rectanglesDe(L_CCW);
  assert.deepEqual(rects, [
    { x1: 0, y1: 0, x2: 400, y2: 400 },
    { x1: 400, y1: 200, x2: 600, y2: 400 },
  ]);
  const somme = rects.reduce((s, r) => s + (r.x2 - r.x1) * (r.y2 - r.y1), 0);
  assert.equal(somme, surfaceCm2(L_CCW)); // 200000
});

test('rectanglesDe : U → 3 rectangles (montants + fond), somme des aires = surfaceCm2', () => {
  // Abscisses distinctes : 0, 100, 400, 500 → 3 bandes.
  // Bande [0,100]   : y=0 ([0,100]) et y=300 ([0,500]) → [0,300]   → montant gauche 100×300.
  // Bande [100,400] : y=200 ([100,400]) et y=300       → [200,300] → fond 300×100.
  // Bande [400,500] : y=0 ([400,500]) et y=300         → [0,300]   → montant droit 100×300.
  const rects = rectanglesDe(U_CCW);
  assert.deepEqual(rects, [
    { x1: 0, y1: 0, x2: 100, y2: 300 },
    { x1: 100, y1: 200, x2: 400, y2: 300 },
    { x1: 400, y1: 0, x2: 500, y2: 300 },
  ]);
  const somme = rects.reduce((s, r) => s + (r.x2 - r.x1) * (r.y2 - r.y1), 0);
  assert.equal(somme, surfaceCm2(U_CCW)); // 500×300 − 300×200 = 90000
});

test('rectanglesDe : polygone invalide → throw thermique (erreur de programmation)', () => {
  assert.throws(() => rectanglesDe([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 300 }]), /thermique/);
});

test('aireIntersectionRectilineaire : deux rectangles se chevauchant de 200×100 → 20000', () => {
  // A = [0,400]×[0,300] ; B = [200,600]×[200,500] → intersection x∈[200,400] (200) × y∈[200,300] (100).
  const B = [{ x: 200, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 500 }, { x: 200, y: 500 }];
  assert.equal(aireIntersectionRectilineaire(RECT_HORAIRE, B), 20000);
});

test('aireIntersectionRectilineaire : disjoints → 0 ; bord commun sans surface → 0', () => {
  const disjoint = [{ x: 500, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 300 }, { x: 500, y: 300 }];
  assert.equal(aireIntersectionRectilineaire(RECT_HORAIRE, disjoint), 0);
  // Bord commun x=400 partagé sur toute la hauteur : contact linéique, aire nulle.
  const accole = [{ x: 400, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 300 }, { x: 400, y: 300 }];
  assert.equal(aireIntersectionRectilineaire(RECT_HORAIRE, accole), 0);
});

test('aireIntersectionRectilineaire : L vs rectangle à cheval sur l’encoche → 30000', () => {
  // R = [300,500]×[100,300] (aire 40000). Le L couvre [0,600]×[0,400] MOINS l'encoche
  // [400,600]×[0,200]. R ∩ encoche = [400,500]×[100,200] = 10000 → R ∩ L = 40000 − 10000 = 30000.
  const R = [{ x: 300, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 300 }, { x: 300, y: 300 }];
  assert.equal(aireIntersectionRectilineaire(L_CCW, R), 30000);
  assert.equal(aireIntersectionRectilineaire(R, L_CCW), 30000); // symétrique
});

test('aireIntersectionRectilineaire : polygones identiques → surfaceCm2', () => {
  assert.equal(aireIntersectionRectilineaire(L_CCW, L_CCW), surfaceCm2(L_CCW)); // 200000
  assert.equal(aireIntersectionRectilineaire(U_CCW, U_CCW), surfaceCm2(U_CCW)); // 90000
});

test('adjacencesNiveau : deux rectangles accolés partiellement — mur est du séjour scindé', () => {
  // Séjour 400×300 à l'origine ; cuisine 300×200 accolée en (400,0) : mur commun sur x=400,
  // y∈[0,200] seulement (la cuisine est moins profonde) → le mur est du séjour se scinde en
  // [0,200] mitoyen cuisine + [200,300] extérieur.
  // Séjour normalisé CCW : (0,0),(0,300),(400,300),(400,0) → segments :
  //   0: ouest x=0 y∈[0,300] · 1: sud y=300 x∈[0,400] · 2: est x=400 y∈[0,300] · 3: nord y=0 x∈[0,400]
  // Cuisine normalisée CCW : (400,0),(400,200),(700,200),(700,0) → segments :
  //   0: ouest x=400 y∈[0,200] · 1: sud y=200 x∈[400,700] · 2: est x=700 y∈[0,200] · 3: nord y=0 x∈[400,700]
  // NB : les murs nord du séjour (x∈[0,400]) et de la cuisine (x∈[400,700]) sont colinéaires (y=0)
  // mais leur intersection [400,400] est de longueur nulle → aucune adjacence parasite.
  const { parPiece, erreurs } = adjacencesNiveau([
    { id: 'sejour', polygone: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] },
    { id: 'cuisine', polygone: [{ x: 400, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 200 }, { x: 400, y: 200 }] },
  ]);
  assert.deepEqual(erreurs, []);
  assert.deepEqual(parPiece.get('sejour'), [
    { segmentIndex: 0, de: 0, a: 300, longueur: 300, adjacent: null },      // ouest → extérieur
    { segmentIndex: 1, de: 0, a: 400, longueur: 400, adjacent: null },      // sud → extérieur
    { segmentIndex: 2, de: 0, a: 200, longueur: 200, adjacent: 'cuisine' }, // est, partie haute du plan
    { segmentIndex: 2, de: 200, a: 300, longueur: 100, adjacent: null },    // est, partie basse → extérieur
    { segmentIndex: 3, de: 0, a: 400, longueur: 400, adjacent: null },      // nord → extérieur
  ]);
  assert.deepEqual(parPiece.get('cuisine'), [
    { segmentIndex: 0, de: 0, a: 200, longueur: 200, adjacent: 'sejour' },  // ouest = mur commun entier
    { segmentIndex: 1, de: 400, a: 700, longueur: 300, adjacent: null },
    { segmentIndex: 2, de: 0, a: 200, longueur: 200, adjacent: null },
    { segmentIndex: 3, de: 400, a: 700, longueur: 300, adjacent: null },
  ]);
});

test('adjacencesNiveau : pièce enclavée — aucun sous-segment extérieur', () => {
  // Carré 600×600 partitionné en 3 pièces (aucun chevauchement, aucun trou) :
  //   b  = centre [200,400]×[200,400] ;
  //   p1 = L « bande nord + bande est » : [0,600]×[0,200] ∪ [400,600]×[200,600] ;
  //   p2 = L « bande ouest + bas-centre » : [0,200]×[200,600] ∪ [200,400]×[400,600].
  // b est donc entourée : nord et est par p1, ouest et sud par p2 → zéro extérieur.
  const b = [{ x: 200, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 400 }, { x: 200, y: 400 }];
  const p1 = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 400, y: 600 },
              { x: 400, y: 200 }, { x: 0, y: 200 }];
  const p2 = [{ x: 0, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 400, y: 400 },
              { x: 400, y: 600 }, { x: 0, y: 600 }];
  const { parPiece, erreurs } = adjacencesNiveau([
    { id: 'b', polygone: b }, { id: 'p1', polygone: p1 }, { id: 'p2', polygone: p2 },
  ]);
  assert.deepEqual(erreurs, []);
  // b normalisée CCW : (200,200),(200,400),(400,400),(400,200) → ouest, sud, est, nord.
  assert.deepEqual(parPiece.get('b'), [
    { segmentIndex: 0, de: 200, a: 400, longueur: 200, adjacent: 'p2' }, // ouest x=200 : bande ouest de p2
    { segmentIndex: 1, de: 200, a: 400, longueur: 200, adjacent: 'p2' }, // sud y=400 : bas-centre de p2
    { segmentIndex: 2, de: 200, a: 400, longueur: 200, adjacent: 'p1' }, // est x=400 : bande est de p1
    { segmentIndex: 3, de: 200, a: 400, longueur: 200, adjacent: 'p1' }, // nord y=200 : bande nord de p1
  ]);
  assert.equal(parPiece.get('b').filter((s) => s.adjacent === null).length, 0); // enclavée
  // p1 normalisée CCW : (0,0),(0,200),(400,200),(400,600),(600,600),(600,0) — dérivation :
  //   seg1 (y=200, x∈[0,400]) borde p2 sur [0,200] puis b sur [200,400] ;
  //   seg2 (x=400, y∈[200,600]) borde b sur [200,400] puis p2 sur [400,600] ; le reste = extérieur.
  assert.deepEqual(parPiece.get('p1'), [
    { segmentIndex: 0, de: 0, a: 200, longueur: 200, adjacent: null },
    { segmentIndex: 1, de: 0, a: 200, longueur: 200, adjacent: 'p2' },
    { segmentIndex: 1, de: 200, a: 400, longueur: 200, adjacent: 'b' },
    { segmentIndex: 2, de: 200, a: 400, longueur: 200, adjacent: 'b' },
    { segmentIndex: 2, de: 400, a: 600, longueur: 200, adjacent: 'p2' },
    { segmentIndex: 3, de: 400, a: 600, longueur: 200, adjacent: null },
    { segmentIndex: 4, de: 0, a: 600, longueur: 600, adjacent: null },
    { segmentIndex: 5, de: 0, a: 600, longueur: 600, adjacent: null },
  ]);
  // p2 normalisée CCW : (0,200),(0,600),(400,600),(400,400),(200,400),(200,200).
  assert.deepEqual(parPiece.get('p2'), [
    { segmentIndex: 0, de: 200, a: 600, longueur: 400, adjacent: null },
    { segmentIndex: 1, de: 0, a: 400, longueur: 400, adjacent: null },
    { segmentIndex: 2, de: 400, a: 600, longueur: 200, adjacent: 'p1' },
    { segmentIndex: 3, de: 200, a: 400, longueur: 200, adjacent: 'b' },
    { segmentIndex: 4, de: 200, a: 400, longueur: 200, adjacent: 'b' },
    { segmentIndex: 5, de: 0, a: 200, longueur: 200, adjacent: 'p1' },
  ]);
});

test('adjacencesNiveau : deux pièces qui se chevauchent → erreur + quarantaine, la 3e est calculée', () => {
  // a = [0,400]×[0,300] et bb = [200,600]×[0,300] se chevauchent sur [200,400]×[0,300] (60000 cm²).
  // c = [0,400]×[300,600] est accolée à a (y=300). Politique : les pièces en chevauchement sont
  // mises en quarantaine — ni calculées NI offertes comme voisines (leur géométrie n'est pas
  // fiable) → le mur nord de c ressort « extérieur » tant que le dessin n'est pas corrigé.
  const { parPiece, erreurs } = adjacencesNiveau([
    { id: 'a', polygone: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] },
    { id: 'bb', polygone: [{ x: 200, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 200, y: 300 }] },
    { id: 'c', polygone: [{ x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 600 }, { x: 0, y: 600 }] },
  ]);
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /chevauchent/);
  assert.ok(erreurs[0].includes('a') && erreurs[0].includes('bb'));
  assert.equal(parPiece.has('a'), false);
  assert.equal(parPiece.has('bb'), false);
  // c normalisée CCW : (0,300),(0,600),(400,600),(400,300) — 4 murs, tous « extérieurs »
  // (a, sa vraie voisine, est en quarantaine).
  assert.deepEqual(parPiece.get('c'), [
    { segmentIndex: 0, de: 300, a: 600, longueur: 300, adjacent: null },
    { segmentIndex: 1, de: 0, a: 400, longueur: 400, adjacent: null },
    { segmentIndex: 2, de: 300, a: 600, longueur: 300, adjacent: null },
    { segmentIndex: 3, de: 0, a: 400, longueur: 400, adjacent: null },
  ]);
});

test('adjacencesNiveau : double revendication d’un tronçon (dessin dégénéré) → rattrapée en erreur de dessin', () => {
  // q est un rectangle [0,400]×[200,300] dessiné avec un aller-retour dégénéré le long de x=400 :
  // (400,300)→(400,100) puis (400,100)→(400,200) — segments CONSÉCUTIFS colinéaires qui se
  // recouvrent, donc invisibles pour validePolygone (v1 n'examine que les paires non adjacentes).
  // Ses deux segments sur x=400 couvrent y∈[100,300] ET y∈[100,200] → le mur ouest de p
  // (x=400, y∈[0,300]) reçoit deux recouvrements qui se chevauchent → decomposeIntervalle
  // throw → converti en erreur de dessin pour p ; q, elle, se décompose sans conflit.
  // (Aucun chevauchement surfacique : l'intérieur de q est [0,400]×[200,300], accolé à p sans recouvrement.)
  const q = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 100 },
             { x: 400, y: 200 }, { x: 0, y: 200 }];
  const p = [{ x: 400, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 300 }, { x: 400, y: 300 }];
  const { parPiece, erreurs } = adjacencesNiveau([{ id: 'q', polygone: q }, { id: 'p', polygone: p }]);
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /dégénéré|revendiqué/);
  assert.ok(erreurs[0].includes('p'));
  assert.equal(parPiece.has('p'), false); // adjacences de p non calculées
  assert.equal(parPiece.get('q').length, 6); // q reste calculée (6 segments, aucun scindé)
});

test('adjacencesNiveau : polygone invalide → erreur de dessin (jamais de throw), les autres pièces calculées', () => {
  const { parPiece, erreurs } = adjacencesNiveau([
    { id: 'tri', polygone: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 300 }] }, // diagonale
    { id: 'ok', polygone: RECT_HORAIRE },
  ]);
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /polygone invalide/);
  assert.ok(erreurs[0].includes('tri'));
  assert.equal(parPiece.has('tri'), false);
  assert.equal(parPiece.get('ok').length, 4); // 4 murs, tous extérieurs
  assert.ok(parPiece.get('ok').every((s) => s.adjacent === null));
});

test('adjacencesNiveau : entrées malformées → throw thermique (erreurs de programmation)', () => {
  assert.throws(() => adjacencesNiveau('pas un tableau'), /thermique/);
  assert.throws(() => adjacencesNiveau([{ polygone: RECT_HORAIRE }]), /thermique/);            // id manquant
  assert.throws(() => adjacencesNiveau([{ id: 'x' }]), /thermique/);                           // polygone manquant
  assert.throws(() => adjacencesNiveau([
    { id: 'x', polygone: RECT_HORAIRE }, { id: 'x', polygone: RECT_HORAIRE },
  ]), /thermique/);                                                                            // id dupliqué
});

test('orientationDe : les 4 murs du rectangle normalisé, nord=0 → O/S/E/N', () => {
  // Rectangle normalisé CCW (y-bas) : (0,0),(0,300),(400,300),(400,0). Normale extérieure = (−dy, dx) :
  //   seg0 (0,0)→(0,300)     d=(0,+1) → n=(−1,0) : mur ouest, normale vers la gauche du plan → O
  //   seg1 (0,300)→(400,300) d=(+1,0) → n=(0,+1) : mur sud, normale vers le bas du plan → S
  //   seg2 (400,300)→(400,0) d=(0,−1) → n=(+1,0) : mur est → E
  //   seg3 (400,0)→(0,0)     d=(−1,0) → n=(0,−1) : mur nord, normale vers le haut du plan → N
  const segs = segmentsDe(normalisePolygone(RECT_HORAIRE));
  assert.deepEqual(segs.map((s) => orientationDe(s, 0)), ['O', 'S', 'E', 'N']);
});

test('orientationDe : nord=90 (nord à droite du plan) et nord=45 → tous les 8 secteurs atteignables', () => {
  const segs = segmentsDe(normalisePolygone(RECT_HORAIRE));
  // nord=90 : le nord pointe vers la droite du plan → le mur dont la normale pointe à droite
  // (seg2, l'ancien « est ») devient N ; rotation d'un quart de tour des 4 caps.
  assert.deepEqual(segs.map((s) => orientationDe(s, 90)), ['S', 'E', 'N', 'O']);
  // nord=45 : caps cardinaux à 45° des normales → secteurs diagonaux.
  //   seg0 (normale gauche, cap plan 270°) → 270−45 = 225 → SO ; seg1 (bas, 180°) → 135 → SE ;
  //   seg2 (droite, 90°) → 45 → NE ; seg3 (haut, 0°) → −45 ≡ 315 → NO.
  assert.deepEqual(segs.map((s) => orientationDe(s, 45)), ['SO', 'SE', 'NE', 'NO']);
  const tous = new Set([...segs.map((s) => orientationDe(s, 0)),
                        ...segs.map((s) => orientationDe(s, 45))]);
  assert.equal(tous.size, 8); // N,E,S,O + NE,SE,SO,NO
});

test('orientationDe : segments de 100 cm hors polygone + frontière de secteur (22,5°)', () => {
  // Segment horizontal 100 cm parcouru vers +x : d=(+1,0) → n=(0,+1) (bas du plan) → S à nord=0.
  assert.equal(orientationDe({ x1: 0, y1: 0, x2: 100, y2: 0 }, 0), 'S');
  // Segment vertical 100 cm parcouru vers −y : d=(0,−1) → n=(+1,0) (droite du plan) → E à nord=0.
  assert.equal(orientationDe({ x1: 0, y1: 100, x2: 0, y2: 0 }, 0), 'E');
  // Frontière exacte : normale vers le haut (cap plan 0°), nord=22,5 → cap boussole 337,5°,
  // pile entre NO (315°) et N (360°) → bascule dans le secteur suivant en sens horaire : N.
  assert.equal(orientationDe({ x1: 100, y1: 0, x2: 0, y2: 0 }, 22.5), 'N');
});

test('orientationDe : entrées malformées → throw thermique', () => {
  assert.throws(() => orientationDe({ x1: 0, y1: 0, x2: 100, y2: 100 }, 0), /thermique/); // diagonal
  assert.throws(() => orientationDe({ x1: 0, y1: 0, x2: 0, y2: 0 }, 0), /thermique/);     // longueur nulle
  assert.throws(() => orientationDe({ x1: 0, y1: 0, x2: 100, y2: 0 }, NaN), /thermique/); // nord non fini
  assert.throws(() => orientationDe({ x1: 0, y1: 0, x2: 100, y2: 0 }, '0'), /thermique/); // nord non numérique
});

// ═══════════════ Task 4 : intervalleAxial / valideOuvertures ═══════════════

// Séjour = RECT_HORAIRE normalisé CCW : (0,0),(0,300),(400,300),(400,0) → segments :
//   0: ouest x=0, y 0→300 (parcours CROISSANT) · 1: sud y=300, x 0→400 (croissant)
//   2: est x=400, y 300→0 (DÉCROISSANT)        · 3: nord y=0, x 400→0 (décroissant)
// `position` d'une ouverture compte depuis le DÉBUT du segment dans son sens de parcours :
// sur le mur est, position p ↦ point d'axe y = 300 − p (et l'ouverture occupe [300−p−l, 300−p]).
const SEJOUR = { id: 'sejour', polygone: RECT_HORAIRE };
const HAUTEUR_NIVEAU = 250; // cm
// Layout de la Task 3 : cuisine accolée à l'est du séjour sur y∈[0,200] → le mur est du séjour
// (segment 2) se scinde en coordonnées d'AXE croissantes : [0,200] mitoyen 'cuisine' + [200,300] extérieur.
const CUISINE = { id: 'cuisine', polygone: [{ x: 400, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 200 }, { x: 400, y: 200 }] };
const sousSegmentsSeuls = () => adjacencesNiveau([SEJOUR]).parPiece.get('sejour');
const sousSegmentsAccoles = () => adjacencesNiveau([SEJOUR, CUISINE]).parPiece.get('sejour');
const ouv = (id, segmentIndex, position, largeur = 120, hauteur = 135) =>
  ({ id, pieceId: 'sejour', segmentIndex, type: 'fenetre', largeur, hauteur, position });

test('intervalleAxial : parcours croissant → de = min + position ; décroissant → a = max − position', () => {
  const segs = segmentsDe(normalisePolygone(RECT_HORAIRE));
  // seg1 sud (0,300)→(400,300), x croissant : de = 0 + 40 = 40, a = 160.
  assert.deepEqual(intervalleAxial(segs[1], 40, 120), { de: 40, a: 160 });
  // seg2 est (400,300)→(400,0), y DÉCROISSANT : a = 300 − 40 = 260, de = 260 − 120 = 140.
  assert.deepEqual(intervalleAxial(segs[2], 40, 120), { de: 140, a: 260 });
  // seg3 nord (400,0)→(0,0), x décroissant : a = 400 − 100 = 300, de = 250.
  assert.deepEqual(intervalleAxial(segs[3], 100, 50), { de: 250, a: 300 });
  // seg0 ouest (0,0)→(0,300), y croissant, ouverture pleine longueur : [0, 300].
  assert.deepEqual(intervalleAxial(segs[0], 0, 300), { de: 0, a: 300 });
  assert.throws(() => intervalleAxial(segs[1], 40.5, 120), /thermique/); // position non entière
});

test('valideOuvertures : fenêtre 120×135 à 40 cm sur segment croissant de 400 → 16200 cm² au bon sous-segment', () => {
  const { erreurs, surfacesOuvertures } = valideOuvertures(
    SEJOUR, [ouv('f1', 1, 40)], sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.deepEqual(erreurs, []);
  assert.deepEqual([...surfacesOuvertures], [['1:0:400', 16200]]); // 120 × 135
});

test('valideOuvertures : dépassement du segment (et position négative) → erreur, aucune imputation', () => {
  // position 300 + largeur 120 = 420 > 400 (longueur du segment 1).
  const r = valideOuvertures(SEJOUR, [ouv('f1', 1, 300)], sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0], /dépasse/);
  assert.equal(r.surfacesOuvertures.size, 0);
  const neg = valideOuvertures(SEJOUR, [ouv('f2', 1, -10)], sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.equal(neg.erreurs.length, 1);
  assert.match(neg.erreurs[0], /dépasse/);
  assert.equal(neg.surfacesOuvertures.size, 0);
});

test('valideOuvertures : deux fenêtres qui se chevauchent → erreur sans double imputation ; bord à bord toléré', () => {
  // f1 occupe [40,160], f2 [100,200] sur le segment 1 → chevauchement [100,160] : les DEUX
  // sont exclues de l'imputation (aucune surface comptée, a fortiori pas deux fois).
  const r = valideOuvertures(SEJOUR, [ouv('f1', 1, 40), ouv('f2', 1, 100, 100)],
    sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0], /chevauchent/);
  assert.equal(r.surfacesOuvertures.size, 0);
  // f1 [40,160] et f3 [160,240] se TOUCHENT sans se chevaucher → valides, surfaces additionnées.
  const ok = valideOuvertures(SEJOUR, [ouv('f1', 1, 40), ouv('f3', 1, 160, 80)],
    sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.deepEqual(ok.erreurs, []);
  assert.deepEqual([...ok.surfacesOuvertures], [['1:0:400', 16200 + 10800]]); // + 80 × 135
});

test('valideOuvertures : à cheval ext/mitoyen sur le mur est (parcours décroissant) → erreur', () => {
  // Mur est (segment 2) parcouru de y=300 vers y=0, scindé en axe [0,200] cuisine / [200,300] ext.
  // Fenêtre position 60, largeur 80 → intervalle d'axe [300−60−80, 300−60] = [160, 240] :
  // chevauche la frontière y=200 → « à cheval » sur deux adjacences différentes.
  const r = valideOuvertures(SEJOUR, [ouv('f1', 2, 60, 80)], sousSegmentsAccoles(), HAUTEUR_NIVEAU);
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0], /cheval/);
  assert.equal(r.surfacesOuvertures.size, 0);
});

test('valideOuvertures : hauteur hors niveau, hauteur nulle, largeur nulle → erreurs ; hauteur = niveau tolérée', () => {
  const trop = valideOuvertures(SEJOUR, [ouv('f1', 1, 40, 120, 260)], sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.equal(trop.erreurs.length, 1);
  assert.match(trop.erreurs[0], /hauteur/);
  assert.equal(trop.surfacesOuvertures.size, 0);
  const l0 = valideOuvertures(SEJOUR, [ouv('f2', 1, 40, 0)], sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.ok(l0.erreurs.some((e) => /largeur/.test(e)));
  assert.equal(l0.surfacesOuvertures.size, 0);
  const h0 = valideOuvertures(SEJOUR, [ouv('f3', 1, 40, 120, 0)], sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.ok(h0.erreurs.some((e) => /hauteur/.test(e)));
  assert.equal(h0.surfacesOuvertures.size, 0);
  // hauteur exactement égale à la hauteur du niveau : ≤ → valide (porte toute hauteur).
  const lim = valideOuvertures(SEJOUR, [ouv('f4', 1, 40, 120, 250)], sousSegmentsSeuls(), HAUTEUR_NIVEAU);
  assert.deepEqual(lim.erreurs, []);
  assert.deepEqual([...lim.surfacesOuvertures], [['1:0:400', 30000]]); // 120 × 250
});

test('valideOuvertures : cas direction — fenêtre dans la portion EXTÉRIEURE du mur est → clé [200,300], pas [0,100]', () => {
  // Segment 2 parcouru en y décroissant depuis y=300 : position 10, largeur 80 → intervalle
  // d'axe [300−10−80, 300−10] = [210, 290] ⊆ [200,300] (portion extérieure). Une implémentation
  // naïve « min + position » donnerait [10, 90] ⊆ [0,200] (portion mitoyenne) — faux.
  const r = valideOuvertures(SEJOUR, [ouv('f1', 2, 10, 80)], sousSegmentsAccoles(), HAUTEUR_NIVEAU);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual([...r.surfacesOuvertures], [['2:200:300', 10800]]); // 80 × 135
  // Symétriquement : position 100, largeur 200 → axe [0,200] = exactement la portion mitoyenne.
  const m = valideOuvertures(SEJOUR, [ouv('f2', 2, 100, 200, 210)], sousSegmentsAccoles(), HAUTEUR_NIVEAU);
  assert.deepEqual(m.erreurs, []);
  assert.deepEqual([...m.surfacesOuvertures], [['2:0:200', 42000]]); // 200 × 210
});

test('valideOuvertures : entrées malformées → throw thermique (erreurs de programmation)', () => {
  const subs = sousSegmentsSeuls();
  assert.throws(() => valideOuvertures(SEJOUR, [ouv('f1', 4, 40)], subs, HAUTEUR_NIVEAU), /thermique/);   // segmentIndex hors bornes
  assert.throws(() => valideOuvertures(SEJOUR, [ouv('f1', -1, 40)], subs, HAUTEUR_NIVEAU), /thermique/);
  assert.throws(() => valideOuvertures(SEJOUR,
    [{ ...ouv('f1', 1, 40), pieceId: 'autre' }], subs, HAUTEUR_NIVEAU), /thermique/);                     // pieceId inconnu
  assert.throws(() => valideOuvertures(SEJOUR,
    [{ ...ouv('f1', 1, 40), id: undefined }], subs, HAUTEUR_NIVEAU), /thermique/);                        // ouverture sans id
  assert.throws(() => valideOuvertures(SEJOUR, 'pas un tableau', subs, HAUTEUR_NIVEAU), /thermique/);
  assert.throws(() => valideOuvertures(SEJOUR, [], subs, 0), /thermique/);                                // hauteurNiveau invalide
  assert.throws(() => valideOuvertures(SEJOUR, [ouv('f1', 1, 40)], [], HAUTEUR_NIVEAU), /thermique/);     // sous-segments absents pour le segment
});
