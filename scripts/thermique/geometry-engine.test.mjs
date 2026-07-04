import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePolygone, surfaceCm2, perimetreCm, segmentsDe, validePolygone, decomposeIntervalle,
  rectanglesDe, aireIntersectionRectilineaire, adjacencesNiveau, orientationDe, intervalleAxial,
  valideOuvertures, superposeNiveaux, deduireParois, DELTA_THETA_INTERNE }
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

// ═══════════════ Task 5 : superposeNiveaux ═══════════════
//
// Ordre déterministe documenté et testé : dans `sol` comme dans `plafond`, les fractions sont
// triées par catégorie — 'chauffe' puis 'lnc' puis 'exterieur' — puis, à catégorie égale, par
// `adjacentPieceId` croissant (ordre naturel de chaîne). 'exterieur' n'a pas d'adjacentPieceId
// (toujours en dernier au sein de sa catégorie, unique de toute façon : une seule fraction
// « rien » possible par pièce et par face après agrégation).

// Cas de référence du plan : RDC = séjour (chauffé) 500×400 accolé au garage (non chauffé) 300×400 ;
// étage = chambre (chauffée) 500×400 posée à cheval : moitié sur séjour, moitié sur garage.
//   séjour (RDC) : (0,0),(500,0),(500,400),(0,400)   → 500×400 = 200000 cm²
//   garage (RDC) : (500,0),(800,0),(800,400),(500,400) → 300×400 = 120000 cm², accolé à l'est du séjour
//   chambre (étage) : (250,0),(750,0),(750,400),(250,400) → 500×400 = 200000 cm²
// chambre ∩ séjour = x∈[250,500] (250) × y∈[0,400] (400) = 100000 cm²
// chambre ∩ garage = x∈[500,750] (250, ⊆ [500,800]) × y∈[0,400] (400) = 100000 cm²
// 100000 + 100000 = 200000 = surface chambre ✓ (chambre entièrement couverte, pas de porte-à-faux)
function dessinReference() {
  return {
    nord: 0,
    plancherBasType: 'terre-plein',
    toitureType: 'comble',
    niveaux: [
      { id: 'rdc', nom: 'RDC', hauteur: 250 },
      { id: 'etage', nom: 'Étage', hauteur: 250 },
    ],
    pieces: [
      { id: 'sejour', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] },
      { id: 'garage', niveauId: 'rdc', nom: 'Garage', typePiece: 'garage', chauffee: false, thetaInt: null,
        polygone: [{ x: 500, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 500, y: 400 }] },
      { id: 'chambre', niveauId: 'etage', nom: 'Chambre', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: [{ x: 250, y: 0 }, { x: 750, y: 0 }, { x: 750, y: 400 }, { x: 250, y: 400 }] },
    ],
    ouvertures: [],
  };
}

test('superposeNiveaux : cas de référence — chambre à cheval séjour/garage, garage absent (non chauffé)', () => {
  const r = superposeNiveaux(dessinReference());
  assert.equal(r.size, 2); // séjour, chambre — garage non chauffé, absent
  assert.equal(r.has('garage'), false);

  // chambre.sol : posée sur séjour (chauffé) → 'chauffe' (non déperditif) ; posée sur garage (LNC) → 'lnc'.
  assert.deepEqual(r.get('chambre').sol, [
    { surfaceCm2: 100000, sur: 'chauffe', adjacentPieceId: 'sejour' },
    { surfaceCm2: 100000, sur: 'lnc', adjacentPieceId: 'garage' },
  ]);
  // chambre.plafond : dernier niveau, rien au-dessus → 100 % extérieur (comble), surface entière groupée.
  assert.deepEqual(r.get('chambre').plafond, [{ surfaceCm2: 200000, sous: 'exterieur' }]);

  // séjour.sol : niveau 0, rien en dessous → 100 % extérieur (plancher bas, type résolu par le consommateur).
  assert.deepEqual(r.get('sejour').sol, [{ surfaceCm2: 200000, sur: 'exterieur' }]);
  // séjour.plafond : moitié (250×400=100000) sous la chambre chauffée → 'chauffe' ; moitié restante
  // (500×400 − 100000 = 100000) sous rien → 'exterieur' (comble, la chambre ne couvre que jusqu'à x=500).
  assert.deepEqual(r.get('sejour').plafond, [
    { surfaceCm2: 100000, sous: 'chauffe', adjacentPieceId: 'chambre' },
    { surfaceCm2: 100000, sous: 'exterieur' },
  ]);

  // Invariant Σ fractions === surfaceCm2(polygone) pour chaque pièce présente.
  for (const id of ['sejour', 'chambre']) {
    const piece = dessinReference().pieces.find((p) => p.id === id);
    const surface = surfaceCm2(piece.polygone);
    const { sol, plafond } = r.get(id);
    assert.equal(sol.reduce((s, f) => s + f.surfaceCm2, 0), surface);
    assert.equal(plafond.reduce((s, f) => s + f.surfaceCm2, 0), surface);
  }
});

// Extension 3 niveaux : pièce du milieu chauffée entièrement encadrée par des pièces chauffées
// (même empreinte 400×300 aux 3 niveaux) → sol ET plafond 100 % 'chauffe' des deux côtés.
function dessinTroisNiveaux() {
  const poly = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]; // 120000 cm²
  return {
    nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
    niveaux: [{ id: 'n0', nom: 'RDC', hauteur: 250 }, { id: 'n1', nom: 'R+1', hauteur: 250 },
      { id: 'n2', nom: 'R+2', hauteur: 250 }],
    pieces: [
      { id: 'a', niveauId: 'n0', nom: 'A', typePiece: 'sejour', chauffee: true, thetaInt: 20, polygone: poly },
      { id: 'b', niveauId: 'n1', nom: 'B', typePiece: 'sejour', chauffee: true, thetaInt: 20, polygone: poly },
      { id: 'c', niveauId: 'n2', nom: 'C', typePiece: 'chambre', chauffee: true, thetaInt: 18, polygone: poly },
    ],
    ouvertures: [],
  };
}

test('superposeNiveaux : 3 niveaux — pièce du milieu chauffée-chauffée des deux côtés (sol ET plafond)', () => {
  const r = superposeNiveaux(dessinTroisNiveaux());
  assert.equal(r.size, 3);
  // a (niveau 0) : sol → extérieur (RDC) ; plafond → entièrement sous b (chauffé) → 'chauffe'.
  assert.deepEqual(r.get('a').sol, [{ surfaceCm2: 120000, sur: 'exterieur' }]);
  assert.deepEqual(r.get('a').plafond, [{ surfaceCm2: 120000, sous: 'chauffe', adjacentPieceId: 'b' }]);
  // b (niveau intermédiaire) : sol sur a (chauffé) → 'chauffe' ; plafond sous c (chauffé) → 'chauffe'.
  assert.deepEqual(r.get('b').sol, [{ surfaceCm2: 120000, sur: 'chauffe', adjacentPieceId: 'a' }]);
  assert.deepEqual(r.get('b').plafond, [{ surfaceCm2: 120000, sous: 'chauffe', adjacentPieceId: 'c' }]);
  // c (dernier niveau) : sol sur b (chauffé) → 'chauffe' ; plafond → rien au-dessus → extérieur (comble).
  assert.deepEqual(r.get('c').sol, [{ surfaceCm2: 120000, sur: 'chauffe', adjacentPieceId: 'b' }]);
  assert.deepEqual(r.get('c').plafond, [{ surfaceCm2: 120000, sous: 'exterieur' }]);
});

test('superposeNiveaux : pièce d’étage entièrement en porte-à-faux (sur rien) → sol 100 % extérieur', () => {
  // RDC : petite pièce 200×300 en (0,0). Étage : pièce 200×300 décalée entièrement hors de son
  // empreinte, en (1000,0) → aucune intersection avec quoi que ce soit du RDC → sol 100 % 'exterieur'.
  const dessin = {
    nord: 0, plancherBasType: 'vide-sanitaire', toitureType: 'rampant',
    niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }, { id: 'etage', nom: 'Étage', hauteur: 250 }],
    pieces: [
      { id: 'bas', niveauId: 'rdc', nom: 'Bas', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 300 }, { x: 0, y: 300 }] },
      { id: 'porteAFaux', niveauId: 'etage', nom: 'Porte-à-faux', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: [{ x: 1000, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 300 }, { x: 1000, y: 300 }] },
    ],
    ouvertures: [],
  };
  const r = superposeNiveaux(dessin);
  assert.deepEqual(r.get('porteAFaux').sol, [{ surfaceCm2: 60000, sur: 'exterieur' }]); // 200×300
  assert.deepEqual(r.get('porteAFaux').plafond, [{ surfaceCm2: 60000, sous: 'exterieur' }]); // dernier niveau
  // 'bas' (RDC) : sol extérieur (niveau 0) ; plafond : rien au-dessus (porteAFaux ne le recouvre pas) → extérieur.
  assert.deepEqual(r.get('bas').sol, [{ surfaceCm2: 60000, sur: 'exterieur' }]);
  assert.deepEqual(r.get('bas').plafond, [{ surfaceCm2: 60000, sous: 'exterieur' }]);
});

test('superposeNiveaux : niveau sans pièce → toléré (pas d’erreur ici, l’avertissement viendra en Task 6)', () => {
  const dessin = {
    nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
    niveaux: [
      { id: 'rdc', nom: 'RDC', hauteur: 250 },
      { id: 'videe', nom: 'Vide', hauteur: 250 }, // aucune pièce sur ce niveau
    ],
    pieces: [
      { id: 'sejour', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] },
    ],
    ouvertures: [],
  };
  const r = superposeNiveaux(dessin);
  assert.equal(r.size, 1);
  // Séjour = niveau 0 ET dernier niveau AYANT une pièce, mais le dernier niveau du tableau ('videe')
  // est vide : la superposition regarde le niveau suivant réel du tableau (videe), le trouve vide,
  // donc rien au-dessus → plafond 100 % extérieur.
  assert.deepEqual(r.get('sejour').sol, [{ surfaceCm2: 120000, sur: 'exterieur' }]);
  assert.deepEqual(r.get('sejour').plafond, [{ surfaceCm2: 120000, sous: 'exterieur' }]);
});

test('superposeNiveaux : pièce référençant un niveau inconnu → throw thermique (erreur de programmation)', () => {
  const dessin = {
    nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
    niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }],
    pieces: [
      { id: 'fantome', niveauId: 'inconnu', nom: 'Fantôme', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] },
    ],
    ouvertures: [],
  };
  assert.throws(() => superposeNiveaux(dessin), /thermique/);
});

test('superposeNiveaux : dessin.niveaux vide → throw thermique', () => {
  assert.throws(() => superposeNiveaux({
    nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble', niveaux: [], pieces: [], ouvertures: [],
  }), /thermique/);
});

test('superposeNiveaux : fractions de surface nulle omises (pièce chauffée entièrement enclavée sans LNC)', () => {
  // Un seul niveau : séjour chauffé seul → sol 100% extérieur (niveau 0 = dernier niveau aussi),
  // plafond 100% extérieur (dernier niveau) — vérifie qu'aucune fraction à 0 cm² n'apparaît
  // (ex. pas de fraction 'chauffe' à 0 quand aucune pièce chauffée ne se superpose).
  const dessin = {
    nord: 0, plancherBasType: 'sous-sol', toitureType: 'comble',
    niveaux: [{ id: 'seul', nom: 'Unique', hauteur: 250 }],
    pieces: [
      { id: 'sejour', niveauId: 'seul', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] },
    ],
    ouvertures: [],
  };
  const r = superposeNiveaux(dessin);
  assert.deepEqual(r.get('sejour').sol, [{ surfaceCm2: 120000, sur: 'exterieur' }]);
  assert.deepEqual(r.get('sejour').plafond, [{ surfaceCm2: 120000, sous: 'exterieur' }]);
});

// ═══════════════ Task 6 : deduireParois ═══════════════
//
// Maison de référence du plan — TOUTES les surfaces dérivées à la main dans les tests.
// RDC (hauteur 250 cm) : séjour 500×400 (θ20, chauffé) en (0,0) ; cuisine 300×400 (θ20 par
// défaut, chauffée, « humide » sans effet ici) accolée à l'est ; garage 300×400 (non chauffé)
// accolé à l'est de la cuisine. Étage (hauteur 250) : chambre 500×400 (θ18, chauffée) posée
// EXACTEMENT sur le séjour ; le reste de l'étage = rien (comble au-dessus de cuisine et garage).
// nord = 0, plancherBasType 'terre-plein', toitureType 'comble'.
//
// Polygones normalisés CCW (repère y-bas) et indices de segments :
//   séjour  (0,0),(0,400),(500,400),(500,0)     → 0: ouest x=0 y 0→400 · 1: sud y=400 x 0→500
//     (croissant) · 2: est x=500 y 400→0 (DÉCROISSANT) · 3: nord y=0 x 500→0 (DÉCROISSANT)
//   cuisine (500,0),(500,400),(800,400),(800,0) → 0: ouest x=500 · 1: sud y=400 · 2: est x=800
//     (décroissant) · 3: nord y=0 (décroissant)
//   garage  (800,0),(800,400),(1100,400),(1100,0) ; chambre = même polygone que le séjour.
//
// Ouvertures (position = distance depuis le DÉBUT du segment, dans son sens de parcours) :
//   fen-sejour   140×120 sur le mur SUD du séjour (segment 1, croissant depuis x=0), position 180
//                → intervalle d'axe [0+180, 180+140] = [180, 320] ⊆ [0, 500]
//   porte-entree 90×215 sur le mur NORD du séjour (segment 3, décroissant depuis x=500),
//                position 200 → intervalle d'axe [500−200−90, 500−200] = [210, 300] ⊆ [0, 500]
//   porte-cuisine (optionnelle) 90×215 sur le mur EST du séjour (segment 2, décroissant depuis
//                y=400), position 100 → intervalle d'axe [400−100−90, 400−100] = [210, 300]
//   porte-garage (optionnelle) 90×200 sur le mur EST de la cuisine (segment 2, décroissant depuis
//                y=400), position 150 → intervalle d'axe [400−150−90, 400−150] = [160, 250]
// Variante chambreDecaleeSud : chambre décalée de 100 cm vers le sud (y ∈ [100, 500]) → porte-à-faux.
function maison({ thetaCuisine = 20, porteMitoyenne = false, porteGarage = false, fenetrePosition = 180,
  chambreDecaleeSud = false } = {}) {
  const ouvertures = [
    { id: 'fen-sejour', pieceId: 'sejour', segmentIndex: 1, type: 'fenetre', largeur: 140, hauteur: 120, position: fenetrePosition },
    { id: 'porte-entree', pieceId: 'sejour', segmentIndex: 3, type: 'porte', largeur: 90, hauteur: 215, position: 200 },
  ];
  if (porteMitoyenne) {
    ouvertures.push({ id: 'porte-cuisine', pieceId: 'sejour', segmentIndex: 2, type: 'porte', largeur: 90, hauteur: 215, position: 100 });
  }
  if (porteGarage) {
    ouvertures.push({ id: 'porte-garage', pieceId: 'cuisine', segmentIndex: 2, type: 'porte', largeur: 90, hauteur: 200, position: 150 });
  }
  return {
    nord: 0,
    plancherBasType: 'terre-plein',
    toitureType: 'comble',
    niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }, { id: 'etage', nom: 'Étage', hauteur: 250 }],
    pieces: [
      { id: 'sejour', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] },
      { id: 'cuisine', niveauId: 'rdc', nom: 'Cuisine', typePiece: 'cuisine', chauffee: true, thetaInt: thetaCuisine,
        polygone: [{ x: 500, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 500, y: 400 }] },
      { id: 'garage', niveauId: 'rdc', nom: 'Garage', typePiece: 'garage', chauffee: false, thetaInt: null,
        polygone: [{ x: 800, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 400 }, { x: 800, y: 400 }] },
      { id: 'chambre', niveauId: 'etage', nom: 'Chambre', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: chambreDecaleeSud
          ? [{ x: 0, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 500 }, { x: 0, y: 500 }]
          : [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] },
    ],
    ouvertures,
  };
}

const proche = (reel, attendu) => assert.ok(Math.abs(reel - attendu) < 1e-9, `${reel} ≉ ${attendu}`);
function paroiSeule(parois, filtre, description) {
  const candidates = parois.filter(filtre);
  assert.equal(candidates.length, 1, `attendu exactement 1 paroi : ${description} (trouvé ${candidates.length})`);
  return candidates[0];
}

test('deduireParois : maison complète — chaque paroi dérivée à la main', () => {
  const { parois, erreurs, avertissements } = deduireParois(maison());
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []); // tout est sain : aucun avertissement

  // ── Comptes par type ──
  // séjour : 3 murs ext (l'est est mitoyen cuisine, θ20 ↔ θ20, ΔT = 0 ≤ 4 K → NON émis)
  //          + fenêtre + porte + plancher-bas ; plafond 100 % sous la chambre chauffée → rien.
  // cuisine : 2 murs ext (sud, nord) + mur-lnc (garage) + plancher-bas + plafond-comble
  //          (rien au-dessus de la cuisine à l'étage) ; mur ouest mitoyen séjour → non émis.
  // chambre : 4 murs ext + plafond-comble (dernier niveau) ; sol 100 % sur séjour chauffé → rien.
  // garage : non chauffé → AUCUNE paroi.
  const parType = (t) => parois.filter((p) => p.type === t);
  assert.equal(parType('mur-exterieur').length, 9); // 3 séjour + 2 cuisine + 4 chambre
  assert.equal(parType('mur-lnc').length, 1);
  assert.equal(parType('mur-mitoyen-interne').length, 0);
  assert.equal(parType('plancher-bas').length, 2); // séjour + cuisine
  assert.equal(parType('plancher-sur-lnc').length, 0);
  assert.equal(parType('plafond-comble').length, 2); // cuisine + chambre
  assert.equal(parType('plafond-sur-lnc').length, 0);
  assert.equal(parType('toiture-rampant').length, 0);
  assert.equal(parType('fenetre').length, 1);
  assert.equal(parType('porte').length, 1);
  assert.equal(parType('porte-fenetre').length, 0);
  // Pas de porte-à-faux dans la maison de référence (chambre exactement sur le séjour).
  assert.equal(parType('plancher-sur-exterieur').length, 0);
  assert.ok(!avertissements.some((a) => /porte-à-faux/.test(a)));
  assert.equal(parois.length, 16);

  // ── Séjour ──
  // Mur ouest (segment 0, plein) : 400 × 250 = 100000 cm² = 10 m², normale (−1,0) → O.
  const sejOuest = paroiSeule(parois, (p) => p.pieceId === 'sejour' && p.type === 'mur-exterieur' && p.orientation === 'O', 'séjour mur ouest');
  proche(sejOuest.surfaceM2, 10);
  assert.deepEqual(sejOuest.meta, { niveauId: 'rdc', segmentIndex: 0, de: 0, a: 400 });
  // Mur sud (segment 1) : 500 × 250 = 125000 − fenêtre 140 × 120 = 16800 → 108200 cm² = 10.82 m².
  const sejSud = paroiSeule(parois, (p) => p.pieceId === 'sejour' && p.type === 'mur-exterieur' && p.orientation === 'S', 'séjour mur sud');
  proche(sejSud.surfaceM2, 10.82);
  assert.deepEqual(sejSud.meta, { niveauId: 'rdc', segmentIndex: 1, de: 0, a: 500 });
  // Fenêtre : 140 × 120 = 16800 cm² = 1.68 m² ; ni orientation ni adjacentPieceId (mur ext porteur).
  const fen = paroiSeule(parois, (p) => p.type === 'fenetre', 'fenêtre séjour');
  assert.equal(fen.pieceId, 'sejour');
  assert.equal(fen.ouvertureId, 'fen-sejour');
  proche(fen.surfaceM2, 1.68);
  assert.equal('orientation' in fen, false);
  assert.equal('adjacentPieceId' in fen, false);
  assert.deepEqual(fen.meta, { niveauId: 'rdc', segmentIndex: 1, de: 180, a: 320 });
  // Mur nord (segment 3) : 125000 − porte 90 × 215 = 19350 → 105650 cm² = 10.565 m².
  const sejNord = paroiSeule(parois, (p) => p.pieceId === 'sejour' && p.type === 'mur-exterieur' && p.orientation === 'N', 'séjour mur nord');
  proche(sejNord.surfaceM2, 10.565);
  assert.deepEqual(sejNord.meta, { niveauId: 'rdc', segmentIndex: 3, de: 0, a: 500 });
  // Porte d'entrée : 90 × 215 = 19350 cm² = 1.935 m², intervalle d'axe [210, 300] (parcours décroissant).
  const porte = paroiSeule(parois, (p) => p.type === 'porte', 'porte d’entrée');
  assert.equal(porte.pieceId, 'sejour');
  assert.equal(porte.ouvertureId, 'porte-entree');
  proche(porte.surfaceM2, 1.935);
  assert.deepEqual(porte.meta, { niveauId: 'rdc', segmentIndex: 3, de: 210, a: 300 });
  // ABSENCES séjour : mur est mitoyen NON émis (3 murs seulement) ; AUCUNE paroi de plafond.
  assert.equal(parois.filter((p) => p.pieceId === 'sejour' && p.type.startsWith('mur')).length, 3);
  assert.equal(parois.filter((p) => p.pieceId === 'sejour'
    && (p.type.startsWith('plafond') || p.type === 'toiture-rampant')).length, 0);
  // Plancher bas séjour : 500 × 400 = 200000 cm² = 20 m², type terre-plein dans meta.
  const sejPlancher = paroiSeule(parois, (p) => p.pieceId === 'sejour' && p.type === 'plancher-bas', 'plancher séjour');
  proche(sejPlancher.surfaceM2, 20);
  assert.deepEqual(sejPlancher.meta, { niveauId: 'rdc', plancherBasType: 'terre-plein' });
  // Invariant : Σ (murs ext du séjour + ses ouvertures) = périmètre EXTÉRIEUR × hauteur.
  // perimetreCm(séjour) = 2 × (500 + 400) = 1800 cm ; portion mitoyenne (mur est) = 400 cm
  // → périmètre extérieur = 1400 cm ; × 250 cm = 350000 cm² = 35 m².
  const sommeSejourVerticale = parois
    .filter((p) => p.pieceId === 'sejour' && ['mur-exterieur', 'fenetre', 'porte'].includes(p.type))
    .reduce((s, p) => s + p.surfaceM2, 0);
  const sejourPolygone = maison().pieces.find((p) => p.id === 'sejour').polygone;
  proche(sommeSejourVerticale, ((perimetreCm(sejourPolygone) - 400) * 250) / 10000); // = 35 m²

  // ── Cuisine ──
  // Murs sud et nord : 300 × 250 = 75000 cm² = 7.5 m² chacun.
  proche(paroiSeule(parois, (p) => p.pieceId === 'cuisine' && p.orientation === 'S', 'cuisine sud').surfaceM2, 7.5);
  proche(paroiSeule(parois, (p) => p.pieceId === 'cuisine' && p.orientation === 'N', 'cuisine nord').surfaceM2, 7.5);
  // Mur est → garage (LNC) : 400 × 250 = 100000 cm² = 10 m².
  const lnc = paroiSeule(parois, (p) => p.type === 'mur-lnc', 'mur cuisine → garage');
  assert.equal(lnc.pieceId, 'cuisine');
  assert.equal(lnc.adjacentPieceId, 'garage');
  proche(lnc.surfaceM2, 10);
  assert.deepEqual(lnc.meta, { niveauId: 'rdc', segmentIndex: 2, de: 0, a: 400 });
  // Plancher 300 × 400 = 12 m² ; plafond-comble 12 m² (rien au-dessus à l'étage).
  proche(paroiSeule(parois, (p) => p.pieceId === 'cuisine' && p.type === 'plancher-bas', 'plancher cuisine').surfaceM2, 12);
  proche(paroiSeule(parois, (p) => p.pieceId === 'cuisine' && p.type === 'plafond-comble', 'plafond cuisine').surfaceM2, 12);

  // ── Chambre ── 4 murs ext : O 400×250 = 10 · S 500×250 = 12.5 · E 10 · N 12.5 ; plafond 20 m².
  const chambreExt = parois.filter((p) => p.pieceId === 'chambre' && p.type === 'mur-exterieur');
  assert.equal(chambreExt.length, 4);
  proche(chambreExt.find((p) => p.orientation === 'O').surfaceM2, 10);
  proche(chambreExt.find((p) => p.orientation === 'S').surfaceM2, 12.5);
  proche(chambreExt.find((p) => p.orientation === 'E').surfaceM2, 10);
  proche(chambreExt.find((p) => p.orientation === 'N').surfaceM2, 12.5);
  assert.equal(parois.filter((p) => p.pieceId === 'chambre' && p.type.startsWith('plancher')).length, 0); // sur chauffé
  const chambrePlafond = paroiSeule(parois, (p) => p.pieceId === 'chambre' && p.type === 'plafond-comble', 'plafond chambre');
  proche(chambrePlafond.surfaceM2, 20);
  assert.deepEqual(chambrePlafond.meta, { niveauId: 'etage' });

  // ── Garage : aucune paroi. ──
  assert.equal(parois.filter((p) => p.pieceId === 'garage').length, 0);
});

test('deduireParois : porte-à-faux — sol d’étage « sur rien » → plancher-sur-exterieur (b = 1) + avertissement', () => {
  // Chambre décalée de 100 cm vers le SUD : polygone [0,500]×[100,500] (500×400 = 20 m²).
  // Dérivation du sol de la chambre :
  //   chambre ∩ séjour ([0,500]×[0,400])  = [0,500]×[100,400] = 500 × 300 = 150000 cm² 'chauffe' → rien ;
  //   chambre ∩ cuisine ([500,800]×[0,400]) : x ∈ [500,500] → longueur nulle → rien ; garage idem ;
  //   reste « sur rien » = 200000 − 150000 = 50000 cm² = 5 m² (bande [0,500]×[400,500] en
  //   porte-à-faux au-delà de la façade sud du RDC) → 'plancher-sur-exterieur' (PAS 'plancher-bas' :
  //   plancher sur air extérieur, b = 1, pas de contact terre-plein) + avertissement.
  // Effet miroir sur le séjour : plafond couvert par la chambre sur 150000 cm² ('chauffe' → rien),
  // reste 50000 cm² = 5 m² sans rien au-dessus (bande y ∈ [0,100]) → plafond-comble 5 m².
  const { parois, erreurs, avertissements } = deduireParois(maison({ chambreDecaleeSud: true }));
  assert.deepEqual(erreurs, []);
  const porteAFaux = paroiSeule(parois, (p) => p.type === 'plancher-sur-exterieur', 'porte-à-faux chambre');
  assert.equal(porteAFaux.pieceId, 'chambre');
  proche(porteAFaux.surfaceM2, 5);
  assert.deepEqual(porteAFaux.meta, { niveauId: 'etage' }); // PAS de plancherBasType
  assert.equal(avertissements.length, 1);
  assert.match(avertissements[0], /porte-à-faux/);
  assert.ok(avertissements[0].includes('chambre') && avertissements[0].includes('5 m²'));
  // Les plancher-bas du RDC (niveau le plus bas) sont INCHANGÉS : terre-plein, séjour 20 + cuisine 12.
  const planchersBas = parois.filter((p) => p.type === 'plancher-bas');
  assert.equal(planchersBas.length, 2);
  assert.ok(planchersBas.every((p) => p.meta.plancherBasType === 'terre-plein'));
  // Séjour : plafond-comble 5 m² (la chambre ne couvre plus la bande y ∈ [0,100]).
  proche(paroiSeule(parois, (p) => p.pieceId === 'sejour' && p.type === 'plafond-comble', 'plafond séjour découvert').surfaceM2, 5);
  // Chambre : murs inchangés (translation pure) et plafond-comble 20 m² (dernier niveau).
  assert.equal(parois.filter((p) => p.pieceId === 'chambre' && p.type === 'mur-exterieur').length, 4);
  proche(paroiSeule(parois, (p) => p.pieceId === 'chambre' && p.type === 'plafond-comble', 'plafond chambre').surfaceM2, 20);
  assert.equal(parois.length, 18); // les 16 de référence + plafond-comble séjour + plancher-sur-exterieur
});

test('deduireParois : quarantaine multi-niveaux — les pièces en chevauchement de l’étage sont exclues de la superposition (invariant Σ)', () => {
  // RDC : séjour 500×400 chauffé θ20. Étage : chA [0,200]×[0,400] et chB [100,300]×[0,400]
  // se chevauchent sur [100,200]×[0,400] = 40000 cm² → quarantaine des deux ;
  // chC [300,500]×[0,400] est saine (contact bord à bord avec chB en x=300, aire nulle).
  // Handoff Task 5 : deduireParois DOIT exclure chA et chB de TOUS les niveaux avant
  // superposeNiveaux. Preuve par l'invariant Σ sur le plafond du séjour :
  //   couvert par les SURVIVANTES de l'étage = chC ∩ séjour = [300,500]×[0,400] = 80000 cm²
  //   ('chauffe' → non émis) ; reste = 200000 − 80000 = 120000 cm² = 12 m² → plafond-comble.
  // Si chA et chB étaient passées : couvert = 80000 (chA) + 80000 (chB) + 80000 (chC) =
  // 240000 > 200000 (double comptage) → reste négatif → AUCUN plafond-comble émis. Le 12 m²
  // ci-dessous détecte donc toute violation de la précondition.
  const dessin = {
    nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
    niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }, { id: 'etage', nom: 'Étage', hauteur: 250 }],
    pieces: [
      { id: 'sejour', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] },
      { id: 'chA', niveauId: 'etage', nom: 'Chambre A', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 400 }, { x: 0, y: 400 }] },
      { id: 'chB', niveauId: 'etage', nom: 'Chambre B', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: [{ x: 100, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }, { x: 100, y: 400 }] },
      { id: 'chC', niveauId: 'etage', nom: 'Chambre C', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: [{ x: 300, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 300, y: 400 }] },
    ],
    ouvertures: [],
  };
  const { parois, erreurs, avertissements } = deduireParois(dessin);
  // Erreur de dessin mentionnant la paire — pas de throw (le plan reste affichable).
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /chevauchent/);
  assert.ok(erreurs[0].includes('chA') && erreurs[0].includes('chB'));
  assert.deepEqual(avertissements, []); // l'étage A des pièces chauffées (avant quarantaine)
  // chA et chB : exclues → aucune paroi.
  assert.equal(parois.filter((p) => p.pieceId === 'chA' || p.pieceId === 'chB').length, 0);
  // Séjour : plafond-comble = 12 m² EXACTEMENT (calculé contre les seules survivantes, cf. supra),
  // et c'est sa SEULE paroi haute.
  const sejPlafonds = parois.filter((p) => p.pieceId === 'sejour'
    && (p.type.startsWith('plafond') || p.type === 'toiture-rampant'));
  assert.equal(sejPlafonds.length, 1);
  assert.equal(sejPlafonds[0].type, 'plafond-comble');
  proche(sejPlafonds[0].surfaceM2, 12);
  // Séjour : 4 murs ext pleins (O 400×250 = 10 · S 500×250 = 12.5 · E 10 · N 12.5) + plancher 20.
  const sejExt = parois.filter((p) => p.pieceId === 'sejour' && p.type === 'mur-exterieur');
  assert.equal(sejExt.length, 4);
  proche(paroiSeule(sejExt, (p) => p.orientation === 'E', 'séjour est').surfaceM2, 10);
  proche(paroiSeule(parois, (p) => p.pieceId === 'sejour' && p.type === 'plancher-bas', 'plancher séjour').surfaceM2, 20);
  // chC : 4 murs ext (chB en quarantaine n'est PAS offerte comme voisine : son mur ouest x=300
  // ressort extérieur) : O 400×250 = 10 · S 200×250 = 5 · E 10 · N 5 ; sol sur séjour chauffé →
  // rien ; plafond-comble 200×400 = 80000 cm² = 8 m².
  const chCExt = parois.filter((p) => p.pieceId === 'chC' && p.type === 'mur-exterieur');
  assert.equal(chCExt.length, 4);
  proche(paroiSeule(chCExt, (p) => p.orientation === 'O', 'chC ouest').surfaceM2, 10);
  proche(paroiSeule(chCExt, (p) => p.orientation === 'S', 'chC sud').surfaceM2, 5);
  assert.equal(parois.filter((p) => p.pieceId === 'chC' && p.type.startsWith('plancher')).length, 0);
  proche(paroiSeule(parois, (p) => p.pieceId === 'chC' && p.type === 'plafond-comble', 'plafond chC').surfaceM2, 8);
  assert.equal(parois.length, 11); // séjour 4+1+1 = 6, chC 4+1 = 5
});

test('deduireParois : mitoyen interne émis si ΔT > 4 K, pour CHAQUE pièce chauffée, adjacentPieceId croisés', () => {
  assert.equal(DELTA_THETA_INTERNE, 4);
  // Cuisine à θ15 : |20 − 15| = 5 > 4 → le mur séjour↔cuisine (400 × 250 = 10 m²) est émis
  // DEUX fois : une paroi pour le séjour (vers cuisine) ET une pour la cuisine (vers séjour).
  const quinze = deduireParois(maison({ thetaCuisine: 15 }));
  assert.deepEqual(quinze.erreurs, []);
  assert.deepEqual(quinze.avertissements, []);
  const mitoyens = quinze.parois.filter((p) => p.type === 'mur-mitoyen-interne');
  assert.equal(mitoyens.length, 2);
  const coteSejour = paroiSeule(mitoyens, (p) => p.pieceId === 'sejour', 'mitoyen côté séjour');
  assert.equal(coteSejour.adjacentPieceId, 'cuisine');
  proche(coteSejour.surfaceM2, 10);
  assert.deepEqual(coteSejour.meta, { niveauId: 'rdc', segmentIndex: 2, de: 0, a: 400 });
  const coteCuisine = paroiSeule(mitoyens, (p) => p.pieceId === 'cuisine', 'mitoyen côté cuisine');
  assert.equal(coteCuisine.adjacentPieceId, 'sejour');
  proche(coteCuisine.surfaceM2, 10);
  assert.deepEqual(coteCuisine.meta, { niveauId: 'rdc', segmentIndex: 0, de: 0, a: 400 });
  assert.equal(quinze.parois.length, 18); // les 16 de la maison de référence + 2 mitoyens
  // ΔT = 4 exactement (θ16) : PAS émis (strictement supérieur requis).
  const seize = deduireParois(maison({ thetaCuisine: 16 }));
  assert.equal(seize.parois.filter((p) => p.type === 'mur-mitoyen-interne').length, 0);
  assert.equal(seize.parois.length, 16);
  // θint null d'un côté : pas d'émission non plus.
  const sansTheta = deduireParois(maison({ thetaCuisine: null }));
  assert.equal(sansTheta.parois.filter((p) => p.type === 'mur-mitoyen-interne').length, 0);
});

test('deduireParois : ouverture sur mitoyen non émis → ignorée avec avertissement ; sur mitoyen émis → émise et mur net', () => {
  // porte-cuisine 90×215 sur le mur est du séjour (mitoyen cuisine). À θ20 ↔ θ20 le mur n'est
  // pas déperditif → la porte est IGNORÉE (avertissement, aucune paroi) et rien d'autre ne change.
  const ignoree = deduireParois(maison({ porteMitoyenne: true }));
  assert.deepEqual(ignoree.erreurs, []);
  assert.equal(ignoree.avertissements.length, 1);
  assert.match(ignoree.avertissements[0], /ignorée/);
  assert.ok(ignoree.avertissements[0].includes('porte-cuisine'));
  assert.equal(ignoree.parois.filter((p) => p.ouvertureId === 'porte-cuisine').length, 0);
  assert.equal(ignoree.parois.length, 16); // identique à la maison de référence
  // Même porte avec cuisine à θ15 (mitoyen ÉMIS) : le mur côté séjour devient NET
  // (400 × 250 = 100000 − 19350 = 80650 cm² = 8.065 m²) et la porte est émise (1.935 m²,
  // adjacentPieceId du mur porteur). Côté cuisine : mur plein 10 m² (la porte appartient au
  // dessin du séjour — imputation d'un seul côté, v1).
  const emise = deduireParois(maison({ thetaCuisine: 15, porteMitoyenne: true }));
  assert.deepEqual(emise.erreurs, []);
  assert.deepEqual(emise.avertissements, []);
  const coteSejour = paroiSeule(emise.parois, (p) => p.type === 'mur-mitoyen-interne' && p.pieceId === 'sejour', 'mitoyen net côté séjour');
  proche(coteSejour.surfaceM2, 8.065);
  const porteCuisine = paroiSeule(emise.parois, (p) => p.ouvertureId === 'porte-cuisine', 'porte mitoyenne');
  assert.equal(porteCuisine.type, 'porte');
  assert.equal(porteCuisine.pieceId, 'sejour');
  assert.equal(porteCuisine.adjacentPieceId, 'cuisine');
  proche(porteCuisine.surfaceM2, 1.935);
  assert.deepEqual(porteCuisine.meta, { niveauId: 'rdc', segmentIndex: 2, de: 210, a: 300 });
  const coteCuisine = paroiSeule(emise.parois, (p) => p.type === 'mur-mitoyen-interne' && p.pieceId === 'cuisine', 'mitoyen plein côté cuisine');
  proche(coteCuisine.surfaceM2, 10);
  assert.equal(emise.parois.length, 19); // 16 + 2 mitoyens + 1 porte
});

test('deduireParois : porte sur mur LNC → émise (paroi déperditive vers le garage), mur-lnc net', () => {
  // porte-garage 90×200 = 18000 cm² = 1.8 m² sur le mur est de la cuisine (vers le garage).
  // mur-lnc net = 400 × 250 − 18000 = 82000 cm² = 8.2 m² ; invariant : 8.2 + 1.8 = 10 m² (mur plein).
  const { parois, erreurs, avertissements } = deduireParois(maison({ porteGarage: true }));
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []);
  const lnc = paroiSeule(parois, (p) => p.type === 'mur-lnc', 'mur cuisine → garage net');
  proche(lnc.surfaceM2, 8.2);
  const porteGarage = paroiSeule(parois, (p) => p.ouvertureId === 'porte-garage', 'porte vers garage');
  assert.equal(porteGarage.type, 'porte');
  assert.equal(porteGarage.pieceId, 'cuisine');
  assert.equal(porteGarage.adjacentPieceId, 'garage');
  proche(porteGarage.surfaceM2, 1.8);
  assert.deepEqual(porteGarage.meta, { niveauId: 'rdc', segmentIndex: 2, de: 160, a: 250 });
  proche(lnc.surfaceM2 + porteGarage.surfaceM2, 10);
  assert.equal(parois.length, 17); // 16 + la porte (le mur-lnc existait déjà, juste aminci)
});

test('deduireParois : pièce chauffée < 1 m² → avertissement ; toitureType rampant → toiture-rampant', () => {
  // WC 90×90 = 8100 cm² = 0.81 m² < 1 m². toitureType 'rampant', plancher 'vide-sanitaire'.
  const dessin = {
    nord: 0, plancherBasType: 'vide-sanitaire', toitureType: 'rampant',
    niveaux: [{ id: 'seul', nom: 'Unique', hauteur: 250 }],
    pieces: [
      { id: 'wc', niveauId: 'seul', nom: 'WC', typePiece: 'wc', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }, { x: 0, y: 90 }] },
    ],
    ouvertures: [],
  };
  const { parois, erreurs, avertissements } = deduireParois(dessin);
  assert.deepEqual(erreurs, []);
  assert.equal(avertissements.length, 1);
  assert.match(avertissements[0], /1 m²/);
  assert.ok(avertissements[0].includes('wc'));
  // 4 murs ext 90 × 250 = 22500 cm² = 2.25 m² ; plancher-bas 0.81 (vide-sanitaire) ; rampant 0.81.
  assert.equal(parois.filter((p) => p.type === 'mur-exterieur').length, 4);
  proche(parois.find((p) => p.type === 'mur-exterieur').surfaceM2, 2.25);
  const plancher = paroiSeule(parois, (p) => p.type === 'plancher-bas', 'plancher WC');
  proche(plancher.surfaceM2, 0.81);
  assert.deepEqual(plancher.meta, { niveauId: 'seul', plancherBasType: 'vide-sanitaire' });
  proche(paroiSeule(parois, (p) => p.type === 'toiture-rampant', 'rampant WC').surfaceM2, 0.81);
  assert.equal(parois.filter((p) => p.type === 'plafond-comble').length, 0);
});

test('deduireParois : pièce chauffée totalement enclavée entre pièces chauffées → aucune paroi + avertissement', () => {
  // Sandwich 3 niveaux d'empreinte 600×600 : n1 partitionné en b (centre [200,400]², 4 m²) +
  // p1 (bande nord + bande est) + p2 (bande ouest + bas-centre) — cf. test « pièce enclavée »
  // de la Task 3. TOUT est chauffé à θ20 : les murs de b sont mitoyens ΔT 0 → non émis ; son
  // sol repose sur socle (chauffé) et son plafond est sous toit (chauffé) → ZÉRO paroi pour b.
  const empreinte = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }];
  const dessin = {
    nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
    niveaux: [{ id: 'n0', nom: 'RDC', hauteur: 250 }, { id: 'n1', nom: 'R+1', hauteur: 250 },
      { id: 'n2', nom: 'R+2', hauteur: 250 }],
    pieces: [
      { id: 'socle', niveauId: 'n0', nom: 'Socle', typePiece: 'sejour', chauffee: true, thetaInt: 20, polygone: empreinte },
      { id: 'b', niveauId: 'n1', nom: 'Centre', typePiece: 'bureau', chauffee: true, thetaInt: 20,
        polygone: [{ x: 200, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 400 }, { x: 200, y: 400 }] },
      { id: 'p1', niveauId: 'n1', nom: 'P1', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 400, y: 600 },
                   { x: 400, y: 200 }, { x: 0, y: 200 }] },
      { id: 'p2', niveauId: 'n1', nom: 'P2', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 400, y: 400 },
                   { x: 400, y: 600 }, { x: 0, y: 600 }] },
      { id: 'toit', niveauId: 'n2', nom: 'Toit', typePiece: 'chambre', chauffee: true, thetaInt: 20, polygone: empreinte },
    ],
    ouvertures: [],
  };
  const { parois, erreurs, avertissements } = deduireParois(dessin);
  assert.deepEqual(erreurs, []);
  assert.equal(avertissements.length, 1);
  assert.match(avertissements[0], /aucune paroi déperditive/);
  assert.ok(avertissements[0].includes('« b »'));
  assert.equal(parois.filter((p) => p.pieceId === 'b').length, 0);
  // Socle : plancher-bas 36 m², AUCUNE paroi haute (plafond 100 % sous n1 chauffé : 4+20+12 = 36 m²).
  proche(paroiSeule(parois, (p) => p.pieceId === 'socle' && p.type === 'plancher-bas', 'plancher socle').surfaceM2, 36);
  assert.equal(parois.filter((p) => p.pieceId === 'socle' && p.type.startsWith('plafond')).length, 0);
  // Toit : plafond-comble 36 m², aucune paroi basse.
  proche(paroiSeule(parois, (p) => p.pieceId === 'toit' && p.type === 'plafond-comble', 'plafond toit').surfaceM2, 36);
  assert.equal(parois.filter((p) => p.pieceId === 'toit' && p.type.startsWith('plancher')).length, 0);
});

test('deduireParois : pièce chauffée entre deux niveaux LNC → plancher-sur-lnc + plafond-sur-lnc + avertissements niveaux', () => {
  // n0 garage (LNC), n1 studio chauffé, n2 grenier (LNC) — même empreinte 400×300 = 12 m².
  // studio : sol sur LNC → plancher-sur-lnc 12 m² (garage) ; plafond sous LNC → plafond-sur-lnc
  // 12 m² (grenier) ; 4 murs ext (O 300×250 = 7.5 · S 400×250 = 10 · E 7.5 · N 10).
  // Avertissements : n0 et n2 n'ont aucune pièce chauffée.
  const empreinte = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const dessin = {
    nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
    niveaux: [{ id: 'n0', nom: 'Sous-sol', hauteur: 250 }, { id: 'n1', nom: 'RDC', hauteur: 250 },
      { id: 'n2', nom: 'Combles', hauteur: 250 }],
    pieces: [
      { id: 'garage', niveauId: 'n0', nom: 'Garage', typePiece: 'garage', chauffee: false, thetaInt: null, polygone: empreinte },
      { id: 'studio', niveauId: 'n1', nom: 'Studio', typePiece: 'sejour', chauffee: true, thetaInt: 20, polygone: empreinte },
      { id: 'grenier', niveauId: 'n2', nom: 'Grenier', typePiece: 'grenier', chauffee: false, thetaInt: null, polygone: empreinte },
    ],
    ouvertures: [],
  };
  const { parois, erreurs, avertissements } = deduireParois(dessin);
  assert.deepEqual(erreurs, []);
  assert.equal(avertissements.length, 2);
  assert.match(avertissements[0], /aucune pièce chauffée/);
  assert.ok(avertissements[0].includes('n0'));
  assert.match(avertissements[1], /aucune pièce chauffée/);
  assert.ok(avertissements[1].includes('n2'));
  const sol = paroiSeule(parois, (p) => p.type === 'plancher-sur-lnc', 'sol studio');
  assert.equal(sol.pieceId, 'studio');
  assert.equal(sol.adjacentPieceId, 'garage');
  proche(sol.surfaceM2, 12);
  assert.deepEqual(sol.meta, { niveauId: 'n1' });
  const plafond = paroiSeule(parois, (p) => p.type === 'plafond-sur-lnc', 'plafond studio');
  assert.equal(plafond.adjacentPieceId, 'grenier');
  proche(plafond.surfaceM2, 12);
  assert.equal(parois.filter((p) => p.type === 'mur-exterieur').length, 4);
  assert.equal(parois.length, 6); // 4 murs + sol + plafond, rien pour garage/grenier
});

test('deduireParois : ouverture en erreur → erreur agrégée de valideOuvertures, non émise, mur PLEIN', () => {
  // Fenêtre à position 400 : 400 + 140 = 540 > 500 (longueur du mur sud) → dépasse → erreur.
  // Le mur sud reste PLEIN (12.5 m², pas de déduction d'une ouverture invalide) et la fenêtre
  // n'est pas émise. La porte d'entrée, valide, reste émise et son mur reste net.
  const { parois, erreurs, avertissements } = deduireParois(maison({ fenetrePosition: 400 }));
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /dépasse/);
  assert.ok(erreurs[0].includes('fen-sejour'));
  assert.deepEqual(avertissements, []);
  assert.equal(parois.filter((p) => p.type === 'fenetre').length, 0);
  proche(paroiSeule(parois, (p) => p.pieceId === 'sejour' && p.orientation === 'S', 'mur sud plein').surfaceM2, 12.5);
  proche(paroiSeule(parois, (p) => p.pieceId === 'sejour' && p.orientation === 'N', 'mur nord net').surfaceM2, 10.565);
  assert.equal(parois.length, 15); // 16 − la fenêtre
});

test('deduireParois : dessin malformé → throw thermique (seul cas de throw)', () => {
  assert.throws(() => deduireParois(null), /thermique/);
  assert.throws(() => deduireParois({ ...maison(), niveaux: [] }), /thermique/);
  const dupNiveau = maison();
  dupNiveau.niveaux = [{ id: 'rdc', nom: 'A', hauteur: 250 }, { id: 'rdc', nom: 'B', hauteur: 250 }];
  assert.throws(() => deduireParois(dupNiveau), /thermique/);
  const hauteurDecimale = maison();
  hauteurDecimale.niveaux[0].hauteur = 250.5;
  assert.throws(() => deduireParois(hauteurDecimale), /thermique/);
  const sansNiveau = maison();
  sansNiveau.pieces[0].niveauId = 'inconnu'; // pièce sans niveau
  assert.throws(() => deduireParois(sansNiveau), /thermique/);
  const dupPiece = maison();
  dupPiece.pieces[3].id = 'sejour'; // id dupliqué inter-niveaux
  assert.throws(() => deduireParois(dupPiece), /thermique/);
  const ouvertureOrpheline = maison();
  ouvertureOrpheline.ouvertures[0].pieceId = 'inconnue';
  assert.throws(() => deduireParois(ouvertureOrpheline), /thermique/);
  const typeInconnu = maison();
  typeInconnu.ouvertures[0].type = 'velux';
  assert.throws(() => deduireParois(typeInconnu), /thermique/);
  const dupOuverture = maison();
  dupOuverture.ouvertures[1].id = 'fen-sejour';
  assert.throws(() => deduireParois(dupOuverture), /thermique/);
  assert.throws(() => deduireParois({ ...maison(), nord: NaN }), /thermique/);
  assert.throws(() => deduireParois({ ...maison(), plancherBasType: 'parquet' }), /thermique/);
  assert.throws(() => deduireParois({ ...maison(), toitureType: 'plat' }), /thermique/);
});
