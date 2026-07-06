# Thermique Plan 5 — Fluidité du Dessin & couche « saisie à la main » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'étape Dessin du wizard thermique utilisable pour de vrais relevés (dimensions exactes, lisibilité de l'enveloppe, zoom, repositionnement) et poser la couche d'**override « saisie à la main »** qui transforme la table dérivée du dessin en source de vérité validée par l'humain — sans jamais réécrire le dessin.

**Architecture :** Le moteur (`calculeBatiment`) mange déjà une **table résolue** (pièces × parois `{surface, U, b, orientation, poste}`) produite par `assembleBatiment` depuis le dessin. Ce plan (a) fluidifie le générateur (dessin) et (b) insère une **couche d'override** entre la table dérivée et le moteur : chaque valeur reste dérivée du dessin **sauf** si l'humain l'écrase (override prime, badgé « manuel », dessin intact). C'est la généralisation du mécanisme `compositions.exceptions` existant (override U par paroi/ouverture). Logique métier en **modules purs testés `node:test`** ; UI React validée visuellement (le repo n'a pas de harness de test React — cf. JSDoc `PlanCanvas.jsx`).

**Tech Stack :** React 18, SVG (canevas), modules purs ES (`src/apps/thermique/lib/*`), tests `node --test scripts/thermique/*.test.mjs`, Tailwind, wizard `useReducer` (`wizardState.js`).

**Commande de test du module :** `node --test scripts/thermique/*.test.mjs` (état actuel : 245 tests verts — ne jamais régresser).

**Palette (règle R12, déficience-couleur) :** accents **ambre**, neutres **slate**. JAMAIS rouge/vert porteurs de sens (rouge = réservé à l'état « pièce en erreur »).

---

## Décisions verrouillées (Dn = ce plan)

- **D1 — Le dessin reste la SOURCE de géométrie ; il n'est jamais réécrit par un override.** L'override vit dans une structure d'état séparée (`compositions.overrides`), consommée en aval de la dérivation.
- **D2 — Le calcul lit la table dérivée PUIS les overrides.** Ordre de priorité d'une valeur : `override manuel > valeur dérivée du dessin`. Pour le U (déjà existant) : `override manuel > exception ouverture > exception pièce×famille > composition famille > U défaut année`.
- **D3 — Rectangle only pour le redimensionnement (v1).** En v1 chaque pièce est un rectangle (l'outil produit un rectangle, le mode polygone n'existe pas). `redimensionnePiece` refuse une pièce non-rectangulaire plutôt que de deviner.
- **D4 — Granularité d'override v1 = la LIGNE de la table** (une paroi émise : mur/menuiserie/plancher/plafond), identifiée par une clé stable `${pieceId}:${type}:${meta.segmentIndex ?? poste}`. Pas d'override sous-segment arbitraire (jusqu'au-boutisme exclu). Overrides globaux : `thetaE`, `debitTotal`.
- **D5 — Orphelins surfacés, jamais silencieux.** Un override dont la paroi cible a disparu (dessin ré-édité) est retiré à la persistance (comme `toStudyInput` purge déjà les exceptions U orphelines) ET signalé à l'écran tant qu'il est en mémoire. Réutilise le pattern « exceptions orphelines » du plan 4.
- **D6 — Zoom = facteur multiplicatif sur la boîte d'auto-cadrage, recentré sur le contenu.** `viewBox = zoomBoite(boiteEnglobante, facteur)`. `facteur=1` ⇒ comportement actuel (fit). Pas de pan libre en v1.
- **D7 — Décalage/ancrage passent par `deplacePiece` existant** (translation multiple de `GRILLE_CM`, les ouvertures suivent). Aucun nouveau chemin de mutation du polygone hors `redimensionnePiece`.

## Ordre d'exécution (par valeur pour la validation A/B)

**Phase A** (dé-risque l'A/B, quick wins) → **Phase B** (confort ancrage) → **Phase C** (backbone override).
Phase C est la plus lourde : elle est **spécifiée ici mais se détaille en son propre plan** après validation de A/B (décision de granularité fine + UX table à brainstormer — cf. §Phase C).

---

## Structure des fichiers

**Créés :**
- `src/apps/thermique/components/canvas/MursOverlay.jsx` — surlignage coloré des murs (extérieur/mitoyen) du niveau actif.
- `src/apps/thermique/components/canvas/ZoomControls.jsx` — boutons `−` / `+` / `Ajuster`.
- `scripts/thermique/dessin-ops.test.mjs` — **existe déjà** : y ajouter les tests `redimensionnePiece`.
- `scripts/thermique/canvas-geometry.test.mjs` — **existe déjà** : y ajouter `segmentsMursNiveau`, `zoomBoite`, `decalageAncrage`.

**Modifiés :**
- `src/apps/thermique/lib/dessinOps.js` — ajout `redimensionnePiece`.
- `src/apps/thermique/lib/canvasGeometry.js` — ajout `segmentsMursNiveau`, `zoomBoite`, `decalageAncrage`.
- `src/apps/thermique/components/canvas/PlanCanvas.jsx` — cotes live du drag, montage `MursOverlay`, câblage zoom.
- `src/apps/thermique/components/wizard/PieceInspector.jsx` — champs L×l, champs Décaler, bouton Ancrer.
- `src/apps/thermique/components/wizard/Step2Dessin.jsx` — légende enveloppe, contrôles zoom.

**Phase C (fichiers pressentis, à confirmer au sous-plan) :**
- `src/apps/thermique/lib/overrides.js` (pur) — application des overrides sur la table dérivée + détection orphelins.
- `src/apps/thermique/components/wizard/RecapAjustements.jsx` — table récap éditable (en tête de `Step4Resultats.jsx`).
- `src/apps/thermique/lib/wizardState.js` — actions `SET_OVERRIDE` / `CLEAR_OVERRIDE`, purge orphelins dans `toStudyInput`.

---

## PHASE A — Lisibilité & saisie exacte du Dessin

### Task A1 : Coloration des murs extérieurs (pur + overlay)

**Files:**
- Modify: `src/apps/thermique/lib/canvasGeometry.js`
- Test: `scripts/thermique/canvas-geometry.test.mjs`
- Create: `src/apps/thermique/components/canvas/MursOverlay.jsx`
- Modify: `src/apps/thermique/components/canvas/PlanCanvas.jsx`, `src/apps/thermique/components/wizard/Step2Dessin.jsx`

- [ ] **Step 1 : Écrire le test qui échoue** (`canvas-geometry.test.mjs`)

```js
import { segmentsMursNiveau } from '../../src/apps/thermique/lib/canvasGeometry.js';

test('segmentsMursNiveau : rectangle isolé → 4 murs extérieurs', () => {
  const pieces = [{ id: 'p1', polygone: [
    { x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 0 },
  ] }];
  const murs = segmentsMursNiveau(pieces);
  assert.equal(murs.length, 4);
  assert.ok(murs.every((m) => m.exterieur === true));
});

test('segmentsMursNiveau : deux pièces accolées → tronçon partagé mitoyen', () => {
  // p1 = [0..400]x[0..300] ; p2 collée à droite = [400..700]x[0..300].
  // Le mur x=400 (de y0 à y300) est mitoyen des deux côtés, le reste extérieur.
  const pieces = [
    { id: 'p1', polygone: [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 0 }] },
    { id: 'p2', polygone: [{ x: 400, y: 0 }, { x: 400, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 0 }] },
  ];
  const murs = segmentsMursNiveau(pieces);
  const mitoyens = murs.filter((m) => !m.exterieur);
  // Un tronçon mitoyen pour p1 (x=400) et un pour p2 (x=400).
  assert.equal(mitoyens.length, 2);
  assert.ok(mitoyens.every((m) => m.x1 === 400 && m.x2 === 400));
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**
Run: `node --test scripts/thermique/canvas-geometry.test.mjs`
Expected: FAIL — `segmentsMursNiveau is not a function`.

- [ ] **Step 3 : Implémenter `segmentsMursNiveau`** (`canvasGeometry.js`)

```js
import { GRILLE_CM, normalisePolygone, segmentsDe, adjacencesNiveau } from './geometryEngine.js';

/**
 * Segments de murs dessinables du niveau, classés extérieur/mitoyen. S'appuie sur
 * adjacencesNiveau (adjacent === null ⇒ donne sur l'extérieur). Chaque sous-segment est reprojeté
 * en coordonnées écran (x1,y1)-(x2,y2) depuis ses bornes d'axe (de/a). Pièces invalides / en
 * quarantaine : absentes de la sortie d'adjacencesNiveau ⇒ non tracées (elles ont déjà leur teinte
 * d'erreur). Module PUR.
 * @param {{id:*, polygone:{x:number,y:number}[]}[]} piecesNiveau pièces d'UN niveau
 * @returns {{pieceId:*, segmentIndex:number, x1:number, y1:number, x2:number, y2:number,
 *   exterieur:boolean}[]}
 */
export function segmentsMursNiveau(piecesNiveau) {
  if (!Array.isArray(piecesNiveau)) {
    throw new Error('thermique: segmentsMursNiveau : piecesNiveau doit être un tableau');
  }
  const { parPiece } = adjacencesNiveau(piecesNiveau);
  const out = [];
  for (const piece of piecesNiveau) {
    const sous = parPiece.get(piece.id);
    if (!sous) continue; // pièce écartée (invalide / quarantaine)
    const segs = segmentsDe(normalisePolygone(piece.polygone));
    for (const ss of sous) {
      const seg = segs[ss.segmentIndex];
      const coords = seg.axe === 'v'
        ? { x1: seg.x1, y1: ss.de, x2: seg.x1, y2: ss.a }
        : { x1: ss.de, y1: seg.y1, x2: ss.a, y2: seg.y1 };
      out.push({ pieceId: piece.id, segmentIndex: ss.segmentIndex, ...coords, exterieur: ss.adjacent === null });
    }
  }
  return out;
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**
Run: `node --test scripts/thermique/canvas-geometry.test.mjs`
Expected: PASS (les 2 nouveaux + tous les existants).

- [ ] **Step 5 : Créer `MursOverlay.jsx`**

```jsx
// src/apps/thermique/components/canvas/MursOverlay.jsx
// Surlignage des murs du niveau actif : extérieur (ambre épais) vs mitoyen (slate fin).
// Présentation pure — toute la géométrie vient de segmentsMursNiveau (canvasGeometry.js).
import { segmentsMursNiveau } from '../../lib/canvasGeometry.js';

export function MursOverlay({ piecesNiveauActif, echelle = 1 }) {
  let murs;
  try {
    murs = segmentsMursNiveau(piecesNiveauActif);
  } catch {
    return null; // dessin transitoire non indexable : on ne surligne pas (jamais de crash)
  }
  return (
    <g pointerEvents="none">
      {murs.map((m) => (
        <line
          key={`${m.pieceId}-${m.segmentIndex}-${m.x1}-${m.y1}-${m.x2}-${m.y2}`}
          x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2}
          className={m.exterieur ? 'stroke-amber-500' : 'stroke-slate-400'}
          strokeWidth={(m.exterieur ? 7 : 3) * echelle}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

export default MursOverlay;
```

- [ ] **Step 6 : Monter `MursOverlay` dans `PlanCanvas.jsx`**
Dans `PlanCanvas`, importer `MursOverlay` et l'insérer APRÈS les `PieceShape` du niveau actif et AVANT les `OuvertureMarker` (les ouvertures restent au-dessus) :

```jsx
{/* Surlignage enveloppe : murs extérieurs (ambre) vs mitoyens (slate). */}
<MursOverlay piecesNiveauActif={piecesNiveauActif} echelle={echelle} />
```

- [ ] **Step 7 : Ajouter la légende dans `Step2Dessin.jsx`**
Sous la barre d'outils du canevas (après le `<p>` d'aide), ajouter une légende à 2 pastilles :

```jsx
<div className="flex items-center gap-4 px-2 pb-2 text-xs text-secondary-500">
  <span className="flex items-center gap-1.5">
    <span className="inline-block w-4 h-1.5 rounded bg-amber-500" /> Mur extérieur
  </span>
  <span className="flex items-center gap-1.5">
    <span className="inline-block w-4 h-1 rounded bg-slate-400" /> Mur mitoyen
  </span>
</div>
```

- [ ] **Step 8 : Vérifier le build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation (dev server d'Eric) : dessiner 2 pièces accolées → le mur commun apparaît slate, le pourtour ambre ; décoller les pièces de 10 cm → le tronçon redevient ambre des deux côtés (démontre la « continuité »).

- [ ] **Step 9 : Commit**

```bash
git add src/apps/thermique/lib/canvasGeometry.js scripts/thermique/canvas-geometry.test.mjs \
  src/apps/thermique/components/canvas/MursOverlay.jsx \
  src/apps/thermique/components/canvas/PlanCanvas.jsx \
  src/apps/thermique/components/wizard/Step2Dessin.jsx
git commit -m "feat(thermique): coloration murs extérieurs/mitoyens (validation enveloppe)"
```

---

### Task A2 : Édition numérique L × l (reducer + inspecteur)

**Files:**
- Modify: `src/apps/thermique/lib/dessinOps.js`
- Test: `scripts/thermique/dessin-ops.test.mjs`
- Modify: `src/apps/thermique/components/wizard/PieceInspector.jsx`

- [ ] **Step 1 : Écrire les tests qui échouent** (`dessin-ops.test.mjs`)

```js
import { redimensionnePiece } from '../../src/apps/thermique/lib/dessinOps.js';

const dessinAvec = (polygone) => ({
  niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }],
  pieces: [{ id: 'p1', niveauId: 'rdc', nom: 'P', typePiece: 'autre', chauffee: true, thetaInt: 19, polygone }],
  ouvertures: [], nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
});
const RECT_400x300 = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 0 }];

test('redimensionnePiece : redimensionne, ancré au coin haut-gauche', () => {
  const { dessin, erreurs } = redimensionnePiece(dessinAvec(RECT_400x300), 'p1', { largeur: 500, hauteur: 250 });
  assert.deepEqual(erreurs, []);
  const poly = dessin.pieces[0].polygone;
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  assert.equal(Math.min(...xs), 0); // coin haut-gauche fixe
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...xs), 500);
  assert.equal(Math.max(...ys), 250);
});

test('redimensionnePiece : refuse une dimension hors grille', () => {
  const { erreurs } = redimensionnePiece(dessinAvec(RECT_400x300), 'p1', { largeur: 505, hauteur: 250 });
  assert.equal(erreurs.length, 1);
});

test('redimensionnePiece : refuse une dimension ≤ 0', () => {
  const { erreurs } = redimensionnePiece(dessinAvec(RECT_400x300), 'p1', { largeur: 0, hauteur: 250 });
  assert.equal(erreurs.length, 1);
});

test('redimensionnePiece : refuse une pièce non rectangulaire (forme en L)', () => {
  const L = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 200, y: 300 }, { x: 200, y: 150 },
    { x: 400, y: 150 }, { x: 400, y: 0 }];
  const { erreurs } = redimensionnePiece(dessinAvec(L), 'p1', { largeur: 500, hauteur: 300 });
  assert.equal(erreurs.length, 1);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**
Run: `node --test scripts/thermique/dessin-ops.test.mjs`
Expected: FAIL — `redimensionnePiece is not a function`.

- [ ] **Step 3 : Implémenter `redimensionnePiece`** (`dessinOps.js`, après `deplacePiece`)

```js
/**
 * Redimensionne une pièce RECTANGULAIRE à `largeur` × `hauteur` (cm), ancrée à son coin haut-gauche
 * (xMin, yMin inchangés). Refus : pieceId inconnu, pièce non rectangulaire (D3), largeur/hauteur non
 * multiples entiers de GRILLE_CM ou ≤ 0. Les ouvertures conservent segmentIndex/position ; une
 * ouverture qui déborderait du nouveau mur est signalée en aval par valideDessin (pas ici).
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} pieceId id de la pièce
 * @param {{largeur:number, hauteur:number}} dims dimensions cibles (cm)
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function redimensionnePiece(dessin, pieceId, { largeur, hauteur } = {}) {
  exigeDessin(dessin, 'redimensionnePiece');
  const piece = dessin.pieces.find((p) => p.id === pieceId);
  if (!piece) return refuse(dessin, `pièce « ${pieceId} » : introuvable`);
  if (!Number.isInteger(largeur) || !Number.isInteger(hauteur)
    || largeur <= 0 || hauteur <= 0 || largeur % GRILLE_CM !== 0 || hauteur % GRILLE_CM !== 0) {
    return refuse(dessin, `dimensions de « ${pieceId} » : largeur/hauteur doivent être des multiples entiers > 0 de ${GRILLE_CM} cm`);
  }
  const xs = piece.polygone.map((p) => p.x), ys = piece.polygone.map((p) => p.y);
  const xMin = Math.min(...xs), yMin = Math.min(...ys), xMax = Math.max(...xs), yMax = Math.max(...ys);
  const estRectangle = piece.polygone.length === 4
    && surfaceCm2(piece.polygone) === (xMax - xMin) * (yMax - yMin);
  if (!estRectangle) {
    return refuse(dessin, `pièce « ${pieceId} » : redimensionnement disponible uniquement sur une pièce rectangulaire`);
  }
  const nouveau = [
    { x: xMin, y: yMin }, { x: xMin, y: yMin + hauteur },
    { x: xMin + largeur, y: yMin + hauteur }, { x: xMin + largeur, y: yMin },
  ];
  return accepte({ ...dessin, pieces: dessin.pieces.map((p) => (p.id === pieceId ? { ...p, polygone: nouveau } : p)) });
}
```

Ajouter `surfaceCm2` à l'import existant depuis `./geometryEngine.js` en tête de `dessinOps.js`.

- [ ] **Step 4 : Lancer, vérifier le succès**
Run: `node --test scripts/thermique/dessin-ops.test.mjs`
Expected: PASS (4 nouveaux + existants).

- [ ] **Step 5 : Champs L×l dans `PieceInspector.jsx`**
Importer `redimensionnePiece` et `perimetreCm`/`surfaceCm2` déjà présents. Calculer les dimensions courantes (bbox) et détecter le rectangle ; afficher 2 champs `Largeur (cm)` / `Longueur (cm)` avec draft + commit au blur, désactivés (avec note) si la pièce n'est pas rectangulaire :

```jsx
const xs = piece.polygone.map((p) => p.x), ys = piece.polygone.map((p) => p.y);
const largeurCm = Math.max(...xs) - Math.min(...xs);
const hauteurCm = Math.max(...ys) - Math.min(...ys);
const estRectangle = piece.polygone.length === 4
  && surfaceCm2(piece.polygone) === largeurCm * hauteurCm;
// drafts largeurDraft/hauteurDraft (useState), resync sur [piece.id, largeurCm, hauteurCm]
const commitDims = () => {
  const L = Number(largeurDraft), l = Number(hauteurDraft);
  if (L === largeurCm && l === hauteurCm) return;
  if (!applique(redimensionnePiece(dessin, piece.id, { largeur: L, hauteur: l }))) {
    setLargeurDraft(String(largeurCm)); setHauteurDraft(String(hauteurCm));
  }
};
```
Rendu : bloc « Dimensions » à 2 `TextInput type=number` côte à côte (blur/Enter → `commitDims`) ; si `!estRectangle`, remplacer par une note `text-xs text-secondary-500` « Édition dimensionnelle disponible sur pièces rectangulaires ».

- [ ] **Step 6 : Build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation : sélectionner une pièce, taper `400` × `500`, blur → la pièce fait exactement 4 × 5 m (cotes + surface cohérentes).

- [ ] **Step 7 : Commit**

```bash
git add src/apps/thermique/lib/dessinOps.js scripts/thermique/dessin-ops.test.mjs \
  src/apps/thermique/components/wizard/PieceInspector.jsx
git commit -m "feat(thermique): édition numérique des dimensions de pièce (L×l exact)"
```

---

### Task A3 : Cotes live pendant le tracé

**Files:**
- Modify: `src/apps/thermique/components/canvas/PlanCanvas.jsx`

- [ ] **Step 1 : Afficher les dimensions du rectangle fantôme**
Dans `PlanCanvas`, `rectFantome` (déjà calculé) donne les 4 sommets snappés. Ajouter, sous le `<polygon>` fantôme, un libellé `L × l` centré :

```jsx
{rectFantome && (() => {
  const xs = rectFantome.map((p) => p.x), ys = rectFantome.map((p) => p.y);
  const L = (Math.max(...xs) - Math.min(...xs)) / 100;
  const l = (Math.max(...ys) - Math.min(...ys)) / 100;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return (
    <text x={cx} y={cy} textAnchor="middle" className="fill-blue-700 font-medium select-none"
      style={{ fontSize: 20 * echelle }}>
      {L.toFixed(1)} × {l.toFixed(1)} m
    </text>
  );
})()}
```

- [ ] **Step 2 : Build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation : en mode Rectangle, pendant le drag, un libellé `x.x × y.y m` suit le rectangle et se met à jour en temps réel.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/thermique/components/canvas/PlanCanvas.jsx
git commit -m "feat(thermique): cotes live pendant le tracé d'une pièce"
```

---

### Task A4 : Zoom −/+/Ajuster

**Files:**
- Modify: `src/apps/thermique/lib/canvasGeometry.js`
- Test: `scripts/thermique/canvas-geometry.test.mjs`
- Create: `src/apps/thermique/components/canvas/ZoomControls.jsx`
- Modify: `src/apps/thermique/components/canvas/PlanCanvas.jsx`

- [ ] **Step 1 : Écrire le test qui échoue** (`canvas-geometry.test.mjs`)

```js
import { zoomBoite } from '../../src/apps/thermique/lib/canvasGeometry.js';

test('zoomBoite : facteur 1 = identité', () => {
  const b = { x: 0, y: 0, largeur: 1000, hauteur: 800 };
  assert.deepEqual(zoomBoite(b, 1), b);
});

test('zoomBoite : facteur 0.5 = double la vue, même centre', () => {
  const b = { x: 0, y: 0, largeur: 1000, hauteur: 800 }; // centre (500, 400)
  const z = zoomBoite(b, 0.5);
  assert.equal(z.largeur, 2000);
  assert.equal(z.hauteur, 1600);
  assert.equal(z.x + z.largeur / 2, 500); // centre préservé
  assert.equal(z.y + z.hauteur / 2, 400);
});

test('zoomBoite : facteur 2 = moitié de la vue, même centre', () => {
  const b = { x: 0, y: 0, largeur: 1000, hauteur: 800 };
  const z = zoomBoite(b, 2);
  assert.equal(z.largeur, 500);
  assert.equal(z.hauteur, 400);
  assert.equal(z.x + z.largeur / 2, 500);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**
Run: `node --test scripts/thermique/canvas-geometry.test.mjs`
Expected: FAIL — `zoomBoite is not a function`.

- [ ] **Step 3 : Implémenter `zoomBoite`** (`canvasGeometry.js`)

```js
/**
 * Applique un facteur de zoom à une boîte de cadrage (viewBox), recentré sur son centre.
 * facteur > 1 = zoom avant (viewBox plus petit), facteur < 1 = zoom arrière (viewBox plus grand).
 * Le centre de la boîte est invariant. Module PUR.
 * @param {{x:number, y:number, largeur:number, hauteur:number}} boite
 * @param {number} facteur > 0
 * @returns {{x:number, y:number, largeur:number, hauteur:number}}
 */
export function zoomBoite(boite, facteur) {
  if (!Number.isFinite(facteur) || facteur <= 0) {
    throw new Error('thermique: zoomBoite : facteur numérique > 0 requis');
  }
  const cx = boite.x + boite.largeur / 2;
  const cy = boite.y + boite.hauteur / 2;
  const largeur = boite.largeur / facteur;
  const hauteur = boite.hauteur / facteur;
  return { x: cx - largeur / 2, y: cy - hauteur / 2, largeur, hauteur };
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**
Run: `node --test scripts/thermique/canvas-geometry.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Créer `ZoomControls.jsx`**

```jsx
// src/apps/thermique/components/canvas/ZoomControls.jsx
import { Minus, Plus, Maximize2 } from 'lucide-react';

export function ZoomControls({ onZoomIn, onZoomOut, onReset }) {
  const btn = 'p-1.5 bg-white/90 hover:bg-secondary-100 border border-secondary-200 rounded-lg text-secondary-600';
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={btn} onClick={onZoomIn} title="Zoom avant"><Plus className="w-4 h-4" /></button>
      <button type="button" className={btn} onClick={onZoomOut} title="Zoom arrière"><Minus className="w-4 h-4" /></button>
      <button type="button" className={btn} onClick={onReset} title="Ajuster à la maison"><Maximize2 className="w-4 h-4" /></button>
    </div>
  );
}

export default ZoomControls;
```

- [ ] **Step 6 : Câbler dans `PlanCanvas.jsx`**
Ajouter `const [zoom, setZoom] = useState(1);`. Remplacer le calcul du viewBox :

```jsx
const boiteFit = boiteEnglobante([...piecesNiveauActif, ...piecesNiveauInferieur]);
const boite = zoomBoite(boiteFit, zoom);
const viewBox = `${boite.x} ${boite.y} ${boite.largeur} ${boite.hauteur}`;
```
Importer `zoomBoite` et `ZoomControls`. Poser les contrôles en overlay bas-gauche du canevas (à côté de la `RoseNord` déjà en haut-droite) :

```jsx
<div className="absolute bottom-2 left-2">
  <ZoomControls
    onZoomIn={() => setZoom((z) => Math.min(5, z * 1.25))}
    onZoomOut={() => setZoom((z) => Math.max(0.2, z / 1.25))}
    onReset={() => setZoom(1)}
  />
</div>
```
Note : `echelle` reste calculée sur `boiteFit` (taille de police stable) — ne pas la recalculer sur `boite` zoomée.

- [ ] **Step 7 : Build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation : `−` dézoome (grille vide autour, on peut tracer une grande façade) ; `Ajuster` recadre sur la maison.

- [ ] **Step 8 : Commit**

```bash
git add src/apps/thermique/lib/canvasGeometry.js scripts/thermique/canvas-geometry.test.mjs \
  src/apps/thermique/components/canvas/ZoomControls.jsx \
  src/apps/thermique/components/canvas/PlanCanvas.jsx
git commit -m "feat(thermique): zoom −/+/ajuster du canevas de dessin"
```

---

### Task A5 : Décaler une pièce (offset numérique)

**Files:**
- Modify: `src/apps/thermique/components/wizard/PieceInspector.jsx` (réutilise `deplacePiece` existant — aucun nouveau reducer)

- [ ] **Step 1 : Champs Décaler dans l'inspecteur**
Importer `deplacePiece`. Ajouter un bloc « Décaler » avec 2 champs signés explicites (pas de convention à mémoriser) et un bouton Appliquer :

```jsx
// state : const [dxDraft, setDxDraft] = useState('0'); const [dyDraft, setDyDraft] = useState('0');
const applyDecalage = () => {
  const dx = Number(dxDraft) || 0, dy = Number(dyDraft) || 0;
  if (dx === 0 && dy === 0) return;
  if (applique(deplacePiece(dessin, piece.id, { dx, dy }))) { setDxDraft('0'); setDyDraft('0'); }
};
```
Rendu : deux `TextInput type=number` étiquetés `Horizontal (→ droite, cm)` et `Vertical (↓ bas, cm)`, pas de 10 cm (`step={10}`), + bouton `Décaler`. `deplacePiece` refuse déjà les non-multiples de `GRILLE_CM` (toast). Les ouvertures suivent automatiquement (cf. JSDoc `deplacePiece`).

- [ ] **Step 2 : Build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation : `Horizontal = 100`, `Décaler` → la pièce se déplace de 1 m à droite, ses ouvertures suivent.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/thermique/components/wizard/PieceInspector.jsx
git commit -m "feat(thermique): décalage numérique d'une pièce (offset H/V)"
```

---

## PHASE B — Ancrage sur une ligne

### Task B1 : Ancrage à la pièce voisine (pur + bouton)

**Files:**
- Modify: `src/apps/thermique/lib/canvasGeometry.js`
- Test: `scripts/thermique/canvas-geometry.test.mjs`
- Modify: `src/apps/thermique/components/wizard/PieceInspector.jsx`

- [ ] **Step 1 : Écrire le test qui échoue** (`canvas-geometry.test.mjs`)

```js
import { decalageAncrage } from '../../src/apps/thermique/lib/canvasGeometry.js';

test('decalageAncrage : colle une pièce séparée de 30 cm à sa voisine', () => {
  // p1 = [0..400]x[0..300]. p2 = [430..730]x[0..300] : bord gauche de p2 (x=430) vs bord droit
  // de p1 (x=400), écart 30 cm ≤ seuil → dx = -30 pour coller p2 sur p1.
  const p2 = [{ x: 430, y: 0 }, { x: 430, y: 300 }, { x: 730, y: 300 }, { x: 730, y: 0 }];
  const p1 = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 0 }];
  const d = decalageAncrage({ id: 'p2', polygone: p2 }, [{ id: 'p1', polygone: p1 }], 50);
  assert.deepEqual(d, { dx: -30, dy: 0 });
});

test('decalageAncrage : rien à porter si aucun bord aligné dans le seuil', () => {
  const p2 = [{ x: 900, y: 0 }, { x: 900, y: 300 }, { x: 1200, y: 300 }, { x: 1200, y: 0 }];
  const p1 = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 0 }];
  assert.equal(decalageAncrage({ id: 'p2', polygone: p2 }, [{ id: 'p1', polygone: p1 }], 50), null);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**
Run: `node --test scripts/thermique/canvas-geometry.test.mjs`
Expected: FAIL — `decalageAncrage is not a function`.

- [ ] **Step 3 : Implémenter `decalageAncrage`** (`canvasGeometry.js`)

```js
/**
 * Plus petit décalage mono-axe (multiple de GRILLE_CM) qui aligne un bord de `piece` sur un bord
 * parallèle COLINÉAIRE-COMPATIBLE d'une autre pièce, dans la limite `seuilCm`. Ne considère que les
 * bords dont les étendues se recouvrent sur l'axe transverse (sinon « aligner » n'a pas de sens
 * visuel). Retourne { dx, dy } (un seul non nul) ou null si aucun bord candidat. Module PUR — la
 * translation est appliquée par le caller via deplacePiece (qui re-valide).
 * @param {{id:*, polygone:{x:number,y:number}[]}} piece pièce à ancrer
 * @param {{id:*, polygone:{x:number,y:number}[]}[]} autres autres pièces du niveau
 * @param {number} seuilCm écart maximal toléré (cm)
 * @returns {{dx:number, dy:number}|null}
 */
export function decalageAncrage(piece, autres, seuilCm) {
  const bords = (poly) => {
    const s = segmentsDe(normalisePolygone(poly));
    return s.map((seg) => (seg.axe === 'v'
      ? { axe: 'v', pos: seg.x1, lo: Math.min(seg.y1, seg.y2), hi: Math.max(seg.y1, seg.y2) }
      : { axe: 'h', pos: seg.y1, lo: Math.min(seg.x1, seg.x2), hi: Math.max(seg.x1, seg.x2) }));
  };
  const mesBords = bords(piece.polygone);
  let meilleur = null; // { delta, axe }
  for (const autre of autres) {
    if (autre.id === piece.id) continue;
    for (const b of bords(autre.polygone)) {
      for (const m of mesBords) {
        if (m.axe !== b.axe) continue;
        if (Math.max(m.lo, b.lo) >= Math.min(m.hi, b.hi)) continue; // pas de recouvrement transverse
        const delta = b.pos - m.pos; // translation pour amener le bord de piece sur celui d'autre
        if (delta === 0 || Math.abs(delta) > seuilCm || delta % GRILLE_CM !== 0) continue;
        if (!meilleur || Math.abs(delta) < Math.abs(meilleur.delta)) meilleur = { delta, axe: m.axe };
      }
    }
  }
  if (!meilleur) return null;
  return meilleur.axe === 'v' ? { dx: meilleur.delta, dy: 0 } : { dx: 0, dy: meilleur.delta };
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**
Run: `node --test scripts/thermique/canvas-geometry.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Bouton « Ancrer » dans `PieceInspector.jsx`**
Importer `decalageAncrage` (+ `deplacePiece` déjà importé en A5). Bouton actif seulement si un ancrage est trouvé :

```jsx
const SEUIL_ANCRAGE_CM = 50;
const autresDuNiveau = dessin.pieces.filter((p) => p.id !== piece.id && p.niveauId === piece.niveauId);
const ancrage = (() => { try { return decalageAncrage(piece, autresDuNiveau, SEUIL_ANCRAGE_CM); } catch { return null; } })();
const applyAncrage = () => { if (ancrage) applique(deplacePiece(dessin, piece.id, ancrage)); };
```
Rendu : bouton `Ancrer à la pièce voisine`, `disabled={!ancrage}`, avec sous-texte `text-xs` « aucun bord proche à aligner » quand `!ancrage`.

- [ ] **Step 6 : Build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation : deux pièces séparées de 30 cm, sélectionner l'une, `Ancrer` → elles se collent, le mur commun devient slate (mitoyen) dans l'overlay A1.

- [ ] **Step 7 : Commit**

```bash
git add src/apps/thermique/lib/canvasGeometry.js scripts/thermique/canvas-geometry.test.mjs \
  src/apps/thermique/components/wizard/PieceInspector.jsx
git commit -m "feat(thermique): ancrage d'une pièce sur le bord d'une voisine"
```

---

## PHASE C — Table récapitulative & couche « saisie à la main » (BACKBONE)

> **⚠ Scope :** Phase C est un sous-système à part entière (nouvelle structure d'état persistée + nouvel écran + résolution d'override + gestion orphelins). Le shape `input` jsonb de `majordhome.thermal_studies` est **VERROUILLÉ** (`wizardState.js` en-tête) : l'ajout de `compositions.overrides` doit être rétro-compatible (défauts dans `LOAD_STUDY`, purge dans `toStudyInput`, comme les exceptions U). **Recommandation : détailler Phase C en son propre plan** (`2026-07-…-thermique-plan6-override-table.md`) après validation de A/B sur A+B, avec un court brainstorm sur (i) la granularité exacte de la clé d'override et (ii) l'UX de la table. Ci-dessous : l'architecture cible et le découpage de tâches, suffisant pour décider, pas encore pour coder ligne à ligne.

**Objectif :** Entre la table dérivée du dessin et le moteur, insérer une couche d'override éditable à la main. Le dessin reste intact (D1) ; l'override prime (D2) ; granularité = la ligne de table (D4) ; orphelins surfacés (D5).

**Architecture cible :**
1. **État** — `compositions.overrides = { parois: { [cle]: { surface?, u?, b?, orientation? } }, globaux: { thetaE?, debitTotal? } }`, où `cle = ${pieceId}:${type}:${meta.segmentIndex ?? poste}` (D4). Actions `SET_OVERRIDE` / `CLEAR_OVERRIDE` calquées sur `SET_EXCEPTION_PAROI`. `toStudyInput` purge les clés dont le `pieceId` n'existe plus (généralise le filtre orphelins existant).
2. **Résolution** — nouveau module pur `overrides.js` : `appliqueOverrides(batiment, overrides) → { batiment, orphelins }`. Reçoit le bâtiment résolu par `assembleBatiment`, remplace champ par champ les parois dont la clé matche, applique `globaux` (thetaE, debitTotal), et retourne la liste des clés d'override sans cible (orphelins). Le moteur `calculeBatiment` reste **inchangé** (il consomme le bâtiment post-override).
3. **UI** — `RecapAjustements.jsx` en tête de `Step4Resultats.jsx` : une table (1 ligne/paroi) colonnes `Pièce · Type · Orientation · Surface · U · b · Φ (W)`. Cellules surface/U/b/orientation éditables ; une cellule éditée est badgée `✎ manuel` + bouton reset. Bandeau d'alerte si `orphelins.length > 0` (« N valeurs saisies à la main ne correspondent plus au dessin — [Purger] »).

**Découpage de tâches (à détailler au sous-plan) :**
- [ ] **C1** — Pur : `appliqueOverrides(batiment, overrides)` + tests node (override surface/U/b, override global thetaE/debitTotal, détection orphelin, bâtiment sans override = identité). TDD complet.
- [ ] **C2** — État : actions `SET_OVERRIDE`/`CLEAR_OVERRIDE` dans `wizardReducer`, défauts `overrides` dans `initialWizardState` + `LOAD_STUDY`, purge orphelins dans `toStudyInput` + tests `wizard-state.test.mjs`.
- [ ] **C3** — Câblage calcul : brancher `appliqueOverrides` entre `assembleBatiment` et `calculeBatiment` dans le chemin de `buildEtudeModel` (`etudeModel.js`) — la table dérivée exposée à l'UI porte les valeurs post-override + un flag `manuel` par ligne. Tests d'intégration.
- [ ] **C4** — UI : `RecapAjustements.jsx` (table éditable, badges manuel, reset, bandeau orphelins) monté dans `Step4Resultats.jsx`. Build + acceptation visuelle + A/B réel contre `Thermique.exe`.

---

## Self-Review

**Couverture backlog (6 items + backbone) :**
- #1 Cotes live → Task A3 ✓
- #2 Édition L×l → Task A2 ✓
- #3 Décaler → Task A5 ✓
- #4 Ancrer → Task B1 ✓
- #5 Coloration murs extérieurs → Task A1 ✓
- #6 Zoom → Task A4 ✓
- #7 Table récap + override « saisie main » → Phase C (C1-C4) ✓

**Cohérence des types/signatures :** `segmentsMursNiveau(piecesNiveau)`, `redimensionnePiece(dessin, pieceId, {largeur, hauteur})`, `zoomBoite(boite, facteur)`, `decalageAncrage(piece, autres, seuilCm)`, `appliqueOverrides(batiment, overrides)` — noms constants entre définition (tests) et consommation (UI). `deplacePiece({dx, dy})` réutilisé tel quel (signature existante). `GRILLE_CM`, `surfaceCm2`, `normalisePolygone`, `segmentsDe`, `adjacencesNiveau` importés depuis `geometryEngine.js` (exports vérifiés).

**Placeholders :** Phases A & B contiennent le code complet à chaque step. Phase C est volontairement au niveau architecture+découpage (flag explicite : sous-plan requis avant code) — ce n'est pas un placeholder masqué mais une décision de scope assumée (le shape jsonb verrouillé impose un brainstorm granularité).

**Garde-fous non régressifs :** chaque tâche pure lance `node --test scripts/thermique/*.test.mjs` (245 verts à préserver) ; chaque tâche UI lance `npx vite build`. Palette R12 respectée (ambre/slate, jamais rouge/vert). Aucun `useAuth().organization.settings` introduit. Aucune mutation du dessin par la couche override (D1).
