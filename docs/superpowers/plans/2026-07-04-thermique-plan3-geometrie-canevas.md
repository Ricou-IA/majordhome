# Module Thermique — Plan 3/5 : Géométrie et canevas de dessin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le moteur de géométrie pur (`geometryEngine.js`) qui déduit toutes les parois déperditives d'un plan dessiné (murs extérieurs avec orientation, mitoyennetés, LNC, planchers/plafonds par superposition de niveaux, surfaces nettes), les helpers d'interaction purs (`canvasGeometry.js`), et les composants SVG présentation (`PlanCanvas.jsx`) — la partie « l'outil fait le travail d'ingénieur » de la spec §6.

**Architecture:** Toute la logique en modules **purs** node-testés (le repo n'a pas d'infra de test React) ; les composants React sont des coquilles minces contrôlées (props `dessin`/`onChange`), validées visuellement au plan 4 (câblage wizard + preview). Sortie de `deduireParois` = entrée « bâtiment résolu » de `calculeBatiment` (plan 2) après passage par les résolveurs (assemblage au plan 4).

**Tech Stack:** JavaScript pur (aucune dépendance), node:test, SVG React 18 (composants seulement, JSX léger).

**Spec:** `docs/superpowers/specs/2026-07-03-module-thermique-deperditions-design.md` §6 · Moteurs plan 2 : `src/apps/thermique/lib/{thermalEngine,refDataResolvers,heatPumpEngine}.js`

## Décisions structurantes (verrouillées — tout écart = NEEDS_CONTEXT au contrôleur)

1. **Coordonnées entières en centimètres.** Grille d'accrochage 10 cm → tout point du modèle est `{x, y}` entiers (cm). Arithmétique exacte (pas d'epsilon), aires en cm² converties en m² (`/10000`) uniquement en sortie. Le canevas convertit px↔cm à l'affichage.
2. **Polygones rectilinéaires en v1** (tous les angles droits, segments axis-aligned). C'est ce que produit le tracé rectangles-accolés + polygone à angles droits de la spec. Détection d'adjacence = arithmétique d'intervalles 1D (exacte). L'« option polygone » du canevas produit des polygones rectilinéaires (le tracé libre non rectilinéaire est explicitement hors v1, documenté).
3. **Convention d'axes** : x croissant vers la droite (est du plan), y croissant vers le bas (convention SVG). `nord` = angle en degrés (0 = nord vers le haut du plan, sens horaire). Polygones normalisés **anti-horaires** (dans le repère y-bas : shoelace signé < 0 ⇒ inverser) ; la normale extérieure d'un segment orienté CCW pointe alors à sa gauche.
4. **Murs sans épaisseur** (plan = cotes intérieures). Assumé et documenté — cohérent avec la saisie terrain rapide ; l'écart sur les surfaces vs cotes extérieures est du second ordre couvert par les fourchettes.
5. **Erreurs bloquantes vs avertissements** : le moteur retourne `{ erreurs: [], avertissements: [] }` structurés (jamais de throw pour un problème de dessin — l'UI doit pouvoir afficher un plan invalide en cours d'édition). Les throws `thermique:` restent pour les erreurs de programmation (entrées malformées).
6. **Modèle de données du dessin** (JSONB `input.dessin` du spec §3, figé ici) :

```javascript
// dessin = {
//   nord: 0,                              // degrés, 0 = haut du plan
//   plancherBasType: 'terre-plein' | 'vide-sanitaire' | 'sous-sol',   // choix RDC (spec §6)
//   toitureType: 'comble' | 'rampant',    // choix dernier niveau
//   niveaux: [{ id, nom, hauteur }],      // hauteur en cm, ordre = du bas vers le haut
//   pieces: [{ id, niveauId, nom, typePiece, chauffee, thetaInt|null, polygone: [{x,y}, …] }],
//   ouvertures: [{ id, pieceId, segmentIndex, type: 'fenetre'|'porte'|'porte-fenetre',
//                  largeur, hauteur, position }],   // cm ; position = distance du début du segment
// }
```

---

### Task 1: Primitives de polygone rectilinéaire

**Files:**
- Create: `src/apps/thermique/lib/geometryEngine.js`
- Test: `scripts/thermique/geometry-engine.test.mjs`

- [ ] **Step 1: Tests**

```javascript
// scripts/thermique/geometry-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePolygone, surfaceCm2, perimetreCm, segmentsDe, validePolygone }
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
```

- [ ] **Step 2: FAIL. Step 3: Implementation**

```javascript
// src/apps/thermique/lib/geometryEngine.js
// Moteur de géométrie du plan dessiné — module PUR (aucun import).
// Coordonnées : ENTIERS en cm (grille 10 cm), x → droite, y → bas (SVG).
// Polygones : rectilinéaires (angles droits), normalisés anti-horaires, fermeture implicite.
// Erreurs de dessin → tableaux de messages (l'UI affiche) ; erreurs de programmation → throw 'thermique:'.

export const GRILLE_CM = 10;

/** Aire signée ×2 (shoelace). Positif = horaire en repère y-bas. */
function aireSignee2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

export function surfaceCm2(poly) { return Math.abs(aireSignee2(poly)) / 2; }

export function perimetreCm(poly) {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    p += Math.abs(b.x - a.x) + Math.abs(b.y - a.y); // rectilinéaire
  }
  return p;
}

/** Normalise en anti-horaire (repère y-bas : aire signée > 0 ⇒ horaire ⇒ renverser en gardant poly[0]). */
export function normalisePolygone(poly) {
  if (!Array.isArray(poly) || poly.length < 4) throw new Error('thermique: polygone invalide (≥ 4 sommets)');
  return aireSignee2(poly) > 0 ? [poly[0], ...poly.slice(1).reverse()] : [...poly];
}

/** Segments orientés consécutifs, avec axe 'h'|'v'. Suppose le polygone rectilinéaire. */
export function segmentsDe(poly) {
  const segs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      longueur: Math.abs(b.x - a.x) + Math.abs(b.y - a.y), axe: a.x === b.x ? 'v' : 'h' });
  }
  return segs;
}

/** Erreurs de forme (tableau de messages FR, vide si valide). */
export function validePolygone(poly) {
  const err = [];
  if (!Array.isArray(poly) || poly.length < 4) return ['polygone : au moins 4 sommets requis'];
  for (const p of poly) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) { err.push('coordonnées entières (cm) requises'); break; }
    if (p.x % GRILLE_CM !== 0 || p.y % GRILLE_CM !== 0) { err.push(`sommet hors grille ${GRILLE_CM} cm`); break; }
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a.x !== b.x && a.y !== b.y) { err.push('segment non rectiligne (angles droits requis)'); break; }
    if (a.x === b.x && a.y === b.y) { err.push('segment de longueur nulle'); break; }
  }
  if (err.length === 0 && segmentsSeCroisent(poly)) err.push('le polygone s’auto-intersecte');
  if (err.length === 0 && surfaceCm2(poly) === 0) err.push('surface nulle');
  return err;
}

/** Auto-intersection rectilinéaire : paires de segments non adjacents h×v qui se croisent, ou colinéaires qui se chevauchent. */
function segmentsSeCroisent(poly) { /* O(n²) sur segments non adjacents — n petit (pièces). ~20 lignes. */ }
```

(Implémenter `segmentsSeCroisent` complètement : croisement h×v strict = `vx ∈ ]hx1,hx2[ et hy ∈ ]vy1,vy2[` ; chevauchement colinéaire = même axe, même ordonnée, intervalles ouverts qui s'intersectent. Les segments **adjacents** partagent un sommet : exclus.)

- [ ] **Step 4: PASS. Step 5: Commit** `"feat(thermique): primitives de polygone rectilinéaire (geometryEngine)"`

---

### Task 2: Décomposition d'intervalles — le cœur de l'adjacence

Un segment de mur peut être partagé sur une PARTIE de sa longueur (pièces accolées de tailles différentes). Fonction pure de décomposition d'un intervalle contre une liste d'intervalles étiquetés.

**Files:** geometryEngine.js (+test)

- [ ] **Step 1: Tests**

```javascript
import { decomposeIntervalle } from '../../src/apps/thermique/lib/geometryEngine.js';

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
```

- [ ] **Step 2-3: FAIL → Implementation** (tri des bornes, balayage, fusion des morceaux contigus de même ref ; ~35 lignes). **Step 4: PASS. Step 5: Commit** `"feat(thermique): décomposition d'intervalles pour l'adjacence des murs"`

---

### Task 3: Adjacences d'un niveau + orientations

**Files:** geometryEngine.js (+test)

- [ ] **Contract + tests**

```javascript
/**
 * Pour chaque pièce d'un niveau : décompose chaque segment de son polygone en sous-segments
 * classés { de, a, longueur, adjacent: null | pieceId } via decomposeIntervalle contre les
 * segments colinéaires opposés des autres pièces du niveau (même axe, même ordonnée,
 * orientation opposée). adjacent null = donne sur l'extérieur.
 * Erreur de dessin détectée ici : deux pièces qui SE CHEVAUCHENT en surface (aire d'intersection
 * rectilinéaire > 0) → listée dans `erreurs`, adjacences non calculées pour ces pièces.
 * @returns {{ parPiece: Map<pieceId, Array<{segmentIndex, de, a, longueur, adjacent}>>, erreurs: string[] }}
 */
export function adjacencesNiveau(pieces) { /* … */ }

/** Secteur d'orientation (8 points cardinaux) de la normale extérieure d'un segment CCW, nord en degrés. */
export function orientationDe(segment, nord) { /* normale à gauche du segment orienté ; angle → N/NE/E/SE/S/SO/O/NO */ }
```

Tests (calculés à la main) : deux rectangles accolés partiellement (mur mitoyen sur 300 cm, extérieur sur 100) ; pièce enclavée (aucun segment extérieur) ; deux pièces qui se chevauchent → erreur listée ; orientations : nord 0° → segment normal vers y− = N, vers x+ = E ; nord 45° → rotation des secteurs (poser 4 cas). Chevauchement surfacique rectilinéaire : implémenter `aireIntersectionRectilineaire(polyA, polyB)` par découpage en rectangles (balayage sur les x des sommets) — tester sur 2 rectangles se chevauchant de 200×100 cm.

- [ ] **Commit** `"feat(thermique): adjacences de niveau et orientations des murs"`

---

### Task 4: Ouvertures — validation et surfaces nettes

**Files:** geometryEngine.js (+test)

- [ ] **Contract + tests**

```javascript
/**
 * Valide les ouvertures d'une pièce et calcule la surface nette de chaque sous-segment de mur.
 * Règles : l'ouverture doit tenir dans son segment (position ≥ 0, position+largeur ≤ longueur du
 * segment) ; hauteur ≤ hauteur du niveau ; deux ouvertures du même segment ne se chevauchent pas ;
 * une ouverture À CHEVAL sur deux sous-segments d'adjacence différente = erreur de dessin
 * (fenêtre moitié sur mur ext moitié sur mitoyen n'a pas de sens).
 * @returns {{ erreurs: string[], surfacesOuvertures: Map<sousSegmentKey, cm2> }}
 */
export function valideOuvertures(piece, ouvertures, sousSegments, hauteurNiveau) { /* … */ }
```

Tests : fenêtre 120×135 posée à 40 cm sur un segment de 400 → ok ; dépassement → erreur ; chevauchement de deux fenêtres → erreur ; à cheval ext/mitoyen → erreur ; hauteur > niveau → erreur.

- [ ] **Commit** `"feat(thermique): validation des ouvertures et surfaces nettes"`

---

### Task 5: Superposition de niveaux — planchers et plafonds

**Files:** geometryEngine.js (+test)

- [ ] **Contract + tests**

```javascript
/**
 * Pour chaque pièce chauffée, fractions de sa surface au sol posées sur : pièce chauffée du
 * niveau inférieur / pièce non chauffée (LNC, ex. garage) / rien (extérieur ou terre : RDC).
 * Et symétriquement pour le plafond contre le niveau supérieur.
 * Implémentation : aireIntersectionRectilineaire entre polygones des deux niveaux (Task 3).
 * RDC (niveau 0) : fraction « rien » du sol = plancher bas de type dessin.plancherBasType.
 * Dernier niveau : fraction « rien » du plafond = comble/rampant selon dessin.toitureType.
 * Niveaux intermédiaires : chauffé↔chauffé = non déperditif (ignoré) ; chauffé↔LNC = paroi b.
 * @returns Map<pieceId, { sol: [{surfaceCm2, sur: 'chauffe'|'lnc'|'exterieur', adjacentPieceId?}],
 *                         plafond: [{surfaceCm2, sous: …}] }>
 */
export function superposeNiveaux(dessin) { /* … */ }
```

Tests à la main : maison RDC (séjour + garage non chauffé) + étage (chambre posée moitié sur séjour moitié sur garage) → chambre : sol 50 % interne-ignoré + 50 % sur LNC ; séjour : plafond 50 % sous chambre (ignoré) + 50 % sous « rien » (comble) ; garage : rien (non chauffé, pas de parois générées pour lui) ; RDC : plancher bas terre-plein plein pour le séjour.

- [ ] **Commit** `"feat(thermique): superposition de niveaux (planchers/plafonds)"`

---

### Task 6: `deduireParois` — l'intégration géométrie → parois

**Files:** geometryEngine.js (+test)

- [ ] **Contract**

```javascript
/**
 * LA fonction du module : dessin complet → liste de parois par pièce chauffée, prête pour
 * l'assemblage (plan 4 : ajout U/b/ΔUtb via refDataResolvers, puis calculeBatiment).
 * Types émis : 'mur-exterieur' (orientation), 'mur-lnc' (adjacentPieceId), 'mur-mitoyen-interne'
 * (adjacentPieceId — émis SEULEMENT si |θint des deux pièces| diffère de plus de DELTA_THETA_INTERNE
 * = 4 K, sinon omis), 'plancher-bas' (plancherBasType), 'plancher-sur-lnc', 'plafond-comble'|
 * 'toiture-rampant', 'plafond-sur-lnc' (rare), 'fenetre'|'porte'|'porte-fenetre' (rattachées à leur
 * mur porteur : surface déduite du mur).
 * Chaque paroi : { pieceId, type, surfaceM2 (net), orientation?, adjacentPieceId?, ouvertureId?, meta }.
 * Retour : { parois: [...], erreurs: [...], avertissements: [...] } — avertissements : niveau sans
 * pièce chauffée, pièce chauffée sans aucune paroi déperditive, surface de pièce < 1 m².
 * Ne résout RIEN (pas de U, pas de b) — géométrie pure.
 */
export function deduireParois(dessin) { /* orchestre Tasks 1-5 */ }
```

- [ ] **Test : maison complète calculée à la main** — RDC : séjour 500×400 (θ20), cuisine 300×400 accolée (θ20, humide), garage 300×400 accolé non chauffé ; 1 fenêtre séjour 140×120 sur mur sud, 1 porte garage↔cuisine ignorée (mitoyen LNC = mur plein v1 — les portes intérieures ne se dessinent pas), porte d'entrée 90×215 sur mur nord séjour ; étage : chambre 500×400 (θ18) posée sur le séjour, reste = comble. Nord = 0. Dérivation attendue COMPLÈTE en commentaires : chaque mur extérieur avec longueur × hauteur − ouvertures, orientation ; murs cuisine↔séjour omis (ΔT 0) ; mur séjour↔garage et cuisine↔garage en 'mur-lnc' ; planchers/plafonds par pièce. Assertions sur le nombre de parois par type et 6-8 surfaces exactes.
- [ ] **Commit** `"feat(thermique): déduction complète des parois depuis le dessin"`

---

### Task 7: Helpers d'interaction canevas (purs)

**Files:**
- Create: `src/apps/thermique/lib/canvasGeometry.js`
- Test: `scripts/thermique/canvas-geometry.test.mjs`

- [ ] Fonctions pures, chacune testée : `snapPoint({x,y})` (arrondi grille 10 cm) ; `rectDepuisDrag(p1, p2)` (rectangle normalisé ≥ 1 grille) ; `pointDansPolygone(pt, poly)` (rectilinéaire, ray-casting) ; `segmentLePlusProche(pt, poly, toleranceCm)` (pour poser une ouverture : index + position le long du segment, null si trop loin) ; `positionOuvertureSnappee(segment, positionBrute, largeur)` (clamp aux bornes + snap) ; `boiteEnglobante(pieces)` (cadrage du viewport SVG).
- [ ] **Commit** `"feat(thermique): helpers d'interaction du canevas (purs)"`

---

### Task 8: Composants SVG présentationnels

**Files:**
- Create: `src/apps/thermique/components/canvas/PlanCanvas.jsx`
- Create: `src/apps/thermique/components/canvas/PieceShape.jsx`
- Create: `src/apps/thermique/components/canvas/CotesPiece.jsx`
- Create: `src/apps/thermique/components/canvas/OuvertureMarker.jsx`
- Create: `src/apps/thermique/components/canvas/RoseNord.jsx`

- [ ] Composants **contrôlés et minces** (React 18, Tailwind pour l'UI hors-SVG, aucune logique métier — tout vient de canvasGeometry/geometryEngine via props) :
  - `PlanCanvas` : `{ dessin, niveauActifId, selection, mode ('selection'|'rectangle'|'polygone'|'ouverture'), onChange, onSelect }`. Rend le `<svg>` (viewBox via `boiteEnglobante`, grille en `<pattern>`, pièces du niveau actif + fantôme du niveau inférieur en filigrane), gère les pointer events (pointerdown/move/up — souris ET tactile) en déléguant TOUTE la géométrie aux helpers purs ; émet un `dessin` complet modifié via `onChange` (jamais de mutation).
  - `PieceShape` : polygone d'une pièce (couleur par état : chauffée/LNC/sélectionnée/erreur), nom + surface m² au centroïde.
  - `CotesPiece` : cotes des segments de la pièce sélectionnée (texte le long du segment, m avec 1 décimale).
  - `OuvertureMarker` : trait épais sur le segment porteur (fenêtre/porte, couleurs distinctes).
  - `RoseNord` : boussole cliquable (rotation du nord par pas de 45°).
- [ ] Vérification (pas d'infra de test React dans le repo — assumé) : `npm run build` passe (les composants compilent), eslint clean, et un **fichier de démo autonome** `scripts/thermique/demo-canvas.html` N'EST PAS créé (YAGNI — la validation visuelle se fait au plan 4 avec le wizard + preview). Documenter cette dette de test dans l'en-tête de PlanCanvas.
- [ ] **Commit** `"feat(thermique): composants SVG du canevas de dessin (présentation)"`

---

### Task 9: Opérations d'édition du dessin (pures) + duplication de niveau

**Files:**
- Create: `src/apps/thermique/lib/dessinOps.js`
- Test: `scripts/thermique/dessin-ops.test.mjs`

- [ ] Réducteurs purs `(dessin, action) → dessin` (consommés par le canevas/wizard, testables sans React) : `ajoutePiece`, `supprimePiece` (avec ses ouvertures), `deplacePiece` (translation snappée, pas de rotation v1), `renommePiece`, `basculeChauffee`, `ajouteOuverture`, `supprimeOuverture`, `ajouteNiveau`, **`dupliqueNiveau`** (copie pièces+ouvertures avec nouveaux ids, suffixe « (étage) » aux noms), `supprimeNiveau`, `regleNord`, `regleHauteurNiveau`. Chaque op re-valide localement (polygone valide, ouverture dans son segment) et retourne `{ dessin, erreurs }` sans jamais laisser le dessin dans un état corrompu (op refusée = dessin inchangé + erreurs).
- [ ] `valideDessin(dessin)` : validation globale (unicité des ids, niveaux ordonnés, chaque pièce sur un niveau existant, hauteurs ∈ [180, 500] cm) + agrégation des erreurs de deduireParois. C'est LA fonction que le wizard appellera avant de passer au calcul.
- [ ] Tests : chaque op sur un dessin de référence (2 niveaux, 3 pièces) — cas nominal + cas refusé ; `dupliqueNiveau` → ids tous nouveaux, geometry identique ; immutabilité vérifiée (le dessin d'entrée n'est jamais muté — `Object.freeze` profond du fixture).
- [ ] **Commit** `"feat(thermique): opérations d'édition du dessin et duplication de niveau"`

---

### Task 10: Intégration bout-en-bout — dessin → parois → bilan (le test-maison)

**Files:**
- Create: `scripts/thermique/integration-dessin-bilan.test.mjs`

- [ ] LE test qui relie les trois plans : reprendre la maison de la Task 6, l'habiller à la main (U par défaut « avant 1974 » via `uDefautPour`, b garage via `coefficientBPour('Pièce', …)` réel, ΔUtb 0.1 partout, fenêtres Uw 1.3 saisi, θe −5 via `thetaBasePour(climat, '81', …)`, VMC sf auto 90 m³/h, fRH 0), mapper les types géométrie → moteur (mur-exterieur/mur-lnc → 'murs' + b, plancher-bas → 'plancherBas' + type flux 'plancher', etc. — ce mapping D'ESSAI préfigure l'assemblage du plan 4 et vit dans le test), et dériver À LA MAIN le bilan complet attendu → `calculeBatiment` doit le reproduire exactement (1e-9 sur les sommes fermées).
- [ ] Documenter en tête du test : « ce mapping est le brouillon de l'assembleur du plan 4 — le jour où l'assembleur existe, ce test doit être réécrit pour l'utiliser ».
- [ ] **Commit** `"test(thermique): intégration dessin → parois → bilan complet"`

---

## Self-review (fait à la rédaction)

- **Couverture spec §6** : rectangles accolés + polygone (rectilinéaire) ✅ T1/T7/T9 · grille 10 cm ✅ T1/T7 · cotes live ✅ T8 · duplication niveau ✅ T9 · pièces non chauffées → b ✅ T3/T5/T6 · murs ext + orientation (rose des vents, nord réglable) ✅ T3/T8 · mitoyens ignorés/ΔT ✅ T6 · RDC/dernier niveau/superposition (chambre sur garage) ✅ T5 · surfaces nettes = périmètre×hauteur − ouvertures ✅ T4/T6 · tap sur mur → ouverture ✅ T7/T8 · garde-fous chevauchement/niveau sans pièce chauffée ✅ T3/T6/T9. **Écarts assumés** : polygones rectilinéaires only (v1) ; compositions globales+exceptions = plan 4 (UI de réglage, pas de géométrie) ; pas de rotation de pièce ; validation visuelle du canevas reportée au plan 4 (pas d'infra de test React — documenté T8).
- **Placeholders** : T3-T6 ont des corps `/* … */` avec contrats détaillés et tests exigés entièrement dérivés à la main (discipline établie aux plans 1-2, les reviewers re-dérivent tout) ; T1-T2 ont le code complet des primitives délicates.
- **Cohérence inter-plans** : sortie `deduireParois` documentée comme entrée de l'assemblage plan 4 ; le mapping d'essai vit dans le test T10 et est marqué jetable ; conventions identiques (cm entiers ici, m/m²/W côté moteur — conversion aux frontières, testée T10).
