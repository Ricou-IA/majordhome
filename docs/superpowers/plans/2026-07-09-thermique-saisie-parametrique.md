# Thermique — Saisie paramétrique par pièce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le dessin géométrique par pièce par une saisie paramétrique rapide (emprise dessinée + tableau de pièces avec métrés déclarés), avec réconciliation globale/pièce, puissance émetteur par pièce (foisonnement) et zone de travail élargie — sans toucher au moteur physique.

**Architecture:** Nouvelle couche d'entrée `saisie (emprise + pièces paramétriques) → assembleBatimentParametrique → calculeBatiment`. Le moteur (`thermalEngine`, `heatPumpEngine`) reste intact. `buildEtudeModel` route par shape (`saisie` paramétrique vs `dessin` legacy). Modules purs testés via `node --test`, UI vérifiée via `npx vite build` + `npm run lint:errors`.

**Tech Stack:** React 18 + Vite, modules purs ESM (`node --test`), TanStack Query, Tailwind, `core.organizations.settings.thermique` via `useOrgSettings`.

**Spec source:** `docs/superpowers/specs/2026-07-09-thermique-saisie-parametrique-design.md`

---

## File Structure

**Modules purs (nouveaux) :**
- `src/apps/thermique/lib/assembleBatimentParametrique.js` — dérivation `saisie → batiment` (même shape de sortie qu'`assembleBatiment`). Responsabilité unique : params pièce → parois résolues.
- `src/apps/thermique/lib/reconciliationEmprise.js` — croisement emprise (global) vs somme des pièces (surfaces, métrés murs ext, transmission).

**Modules purs (modifiés) :**
- `src/apps/thermique/lib/thermiqueConfig.js` — défaut `foisonnement_emetteur`, constante app `LNC_PRESETS`, défaut `saisie`.
- `src/apps/thermique/lib/wizardState.js` — état `saisie`, action `SET_SAISIE`, `toStudyInput` inclut `saisie`, `LOAD_STUDY` hydrate `saisie`.
- `src/apps/thermique/lib/etudeModel.js` — routage par shape + foisonnement dans les résultats par pièce.

**UI (nouveaux) :**
- `src/apps/thermique/components/canvas/EmpriseCanvas.jsx` — dessin d'un contour unique par niveau.
- `src/apps/thermique/components/wizard/PiecesTable.jsx` — tableau de pièces paramétriques.
- `src/apps/thermique/components/wizard/PanneauCoherence.jsx` — panneau de réconciliation.
- `src/apps/thermique/components/wizard/Step2EmprisePieces.jsx` — étape 2 (remplace Step2Dessin + Step3 en mode paramétrique).
- `src/apps/thermique/components/wizard/ResultatsPiecesGrid.jsx` — rendu résultats paramétrique (vignettes L×l colorées + tableau + colonne émetteur).

**UI (modifiés) :**
- `src/apps/thermique/pages/ThermiqueWizard.jsx` — nouvelles étapes, largeur élargie.
- `src/apps/thermique/components/wizard/Step4Resultats.jsx` — colonne émetteur, choix rendu paramétrique vs legacy, garde « Recalculer » legacy.
- `src/apps/artisan/pages/settings/ThermiqueSettings.jsx` — champ foisonnement.

**Non touchés (garde-fou non-régression) :** `thermalEngine.js`, `heatPumpEngine.js`, `geometryEngine.js`, `assembleBatiment.js`, `dessinOps.js`, `PlanCanvas.jsx`, `PlanResultats.jsx` (conservés pour les études legacy frozen — signalés pour retrait ultérieur, pas supprimés).

---

## Phase 1 — Moteur paramétrique (modules purs, TDD)

### Task 1 : Config — foisonnement, presets LNC, défaut saisie

**Files:**
- Modify: `src/apps/thermique/lib/thermiqueConfig.js`
- Test: `scripts/thermique/thermique-config.test.mjs`

- [ ] **Step 1 : Écrire les tests (append au fichier existant)**

```js
// --- Ajouts saisie paramétrique (2026-07-09) ---
import { LNC_PRESETS, defautSaisie } from '../../src/apps/thermique/lib/thermiqueConfig.js';

test('foisonnement_emetteur défaut = 1.0', () => {
  const cfg = buildThermiqueConfig(null);
  assert.equal(cfg.foisonnement_emetteur, 1.0);
});

test('foisonnement_emetteur pris depuis settings.thermique', () => {
  const cfg = buildThermiqueConfig({ thermique: { foisonnement_emetteur: 1.2 } });
  assert.equal(cfg.foisonnement_emetteur, 1.2);
});

test('LNC_PRESETS : garage/cellier/veranda ont un b dans [0,1]', () => {
  for (const p of LNC_PRESETS) {
    assert.ok(p.b >= 0 && p.b <= 1, `${p.id} b hors [0,1]`);
    assert.ok(typeof p.label === 'string' && p.label.length > 0);
  }
});

test('defautSaisie : 1 niveau rez avec emprise vide, pièces vide', () => {
  const s = defautSaisie();
  assert.equal(s.modeSaisie, 'parametrique');
  assert.equal(s.niveaux.length, 1);
  assert.equal(s.niveaux[0].rang, 0);
  assert.deepEqual(s.niveaux[0].emprise.polygone, []);
  assert.deepEqual(s.pieces, []);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node --test scripts/thermique/thermique-config.test.mjs`
Expected: FAIL (`LNC_PRESETS`/`defautSaisie` non exportés, `foisonnement_emetteur` undefined).

- [ ] **Step 3 : Implémenter dans `thermiqueConfig.js`**

Dans `DEFAULTS_THERMIQUE`, ajouter la clé (avant `parois_bibliotheque`) :
```js
  foisonnement_emetteur: 1.0,   // coefficient de dimensionnement émetteur par pièce (R6)
```
En bas du fichier, ajouter :
```js
/** Presets de coefficient b pour un local non chauffé adjacent (valeurs coefficients-b.json,
 * catégorie « Pièce ») — éditable/override par pièce dans la saisie paramétrique. */
export const LNC_PRESETS = [
  { id: 'garage',  label: 'Garage',           b: 0.6 },
  { id: 'cellier', label: 'Cellier / réserve', b: 0.5 },
  { id: 'veranda', label: 'Véranda',          b: 0.8 },
  { id: 'combles', label: 'Combles perdus',   b: 0.6 },
];

/** État `saisie` par défaut (modèle paramétrique). Le shape fait partie du input jsonb persisté. */
export function defautSaisie() {
  return {
    modeSaisie: 'parametrique',
    plancherBasType: 'terre-plein',   // terre-plein | vide-sanitaire | sous-sol (b plancher bas, D5)
    toitureType: 'comble',
    niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, hauteur: 250, emprise: { polygone: [] } }],
    pieces: [],
  };
}
```
Dans `buildThermiqueConfig`, `foisonnement_emetteur` est déjà couvert par le spread `...org` (nombre simple) — vérifier qu'aucune coercition n'est nécessaire (défaut via `...DEFAULTS_THERMIQUE`).

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node --test scripts/thermique/thermique-config.test.mjs`
Expected: PASS (tous).

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/thermiqueConfig.js scripts/thermique/thermique-config.test.mjs
git commit -m "feat(thermique): config foisonnement + presets LNC + défaut saisie paramétrique"
```

---

### Task 2 : Dérivés de l'emprise (surface sol, périmètre)

**Files:**
- Create: `src/apps/thermique/lib/assembleBatimentParametrique.js`
- Test: `scripts/thermique/assemble-batiment-parametrique.test.mjs`

- [ ] **Step 1 : Écrire le test**

```js
// scripts/thermique/assemble-batiment-parametrique.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empriseDerives } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';

const rect = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

test('empriseDerives : rectangle 500×400 cm → 20 m² / 18 m', () => {
  const d = empriseDerives({ polygone: rect(0, 0, 500, 400) });
  assert.equal(d.surfaceSol, 20);   // 5 m × 4 m
  assert.equal(d.perimetre, 18);    // 2×(5+4)
});

test('empriseDerives : polygone vide → { surfaceSol: 0, perimetre: 0 }', () => {
  const d = empriseDerives({ polygone: [] });
  assert.equal(d.surfaceSol, 0);
  assert.equal(d.perimetre, 0);
});

test('empriseDerives : emprise absente → { 0, 0 } (jamais throw)', () => {
  assert.deepEqual(empriseDerives(undefined), { surfaceSol: 0, perimetre: 0 });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node --test scripts/thermique/assemble-batiment-parametrique.test.mjs`
Expected: FAIL (module/fonction absents).

- [ ] **Step 3 : Implémenter**

```js
// src/apps/thermique/lib/assembleBatimentParametrique.js
// Assembleur PARAMÉTRIQUE (2026-07-09) : saisie (emprise + pièces paramétriques) → batiment résolu
// pour calculeBatiment. Module PUR. Remplace la chaîne géométrique deduireParois/assembleBatiment
// pour le mode 'parametrique' — le moteur physique (thermalEngine) reste inchangé.
import { surfaceCm2, perimetreCm } from './geometryEngine.js';

/** Dérivés d'une emprise dessinée : surface au sol (m²) et périmètre extérieur (m). */
export function empriseDerives(emprise) {
  const poly = emprise?.polygone;
  if (!Array.isArray(poly) || poly.length < 3) return { surfaceSol: 0, perimetre: 0 };
  return { surfaceSol: surfaceCm2(poly) / 10000, perimetre: perimetreCm(poly) / 100 };
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node --test scripts/thermique/assemble-batiment-parametrique.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/assembleBatimentParametrique.js scripts/thermique/assemble-batiment-parametrique.test.mjs
git commit -m "feat(thermique): empriseDerives (surface sol + périmètre)"
```

---

### Task 3 : Résolution U par famille (défaut année + exceptions par pièce)

**Files:**
- Modify: `src/apps/thermique/lib/assembleBatimentParametrique.js`
- Test: `scripts/thermique/assemble-batiment-parametrique.test.mjs`

- [ ] **Step 1 : Écrire le test (append)**

```js
import { resoudUFamille } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';
import { readFileSync } from 'node:fs';
const U_DEFAUTS = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));

const compos = {
  familles: {
    murs: { mode: 'valeur', u: 0.5 }, plancherBas: { mode: 'defaut', u: null },
    plafondToiture: { mode: 'defaut', u: null },
    fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 },
  },
  exceptions: { parois: { 'sej:murs': { u: 0.25 } }, ouvertures: {} },
};

test('resoudUFamille : valeur famille murs = 0.5', () => {
  assert.equal(resoudUFamille(compos, 'murs', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), 0.5);
});
test('resoudUFamille : exception pièce×famille prioritaire', () => {
  assert.equal(resoudUFamille(compos, 'murs', 'sej', { uDefauts: U_DEFAUTS, annee: 2010 }), 0.25);
});
test('resoudUFamille : mode défaut plancherBas résout via u-defauts par année', () => {
  const u = resoudUFamille(compos, 'plancherBas', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 });
  assert.ok(Number.isFinite(u) && u > 0);
});
test('resoudUFamille : menuiserie fenetre = 1.3', () => {
  assert.equal(resoudUFamille(compos, 'fenetre', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), 1.3);
});
test('resoudUFamille : U absent → null', () => {
  const c = { familles: { murs: { mode: 'valeur', u: null } }, exceptions: { parois: {}, ouvertures: {} } };
  assert.equal(resoudUFamille(c, 'murs', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), null);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node --test scripts/thermique/assemble-batiment-parametrique.test.mjs`
Expected: FAIL (`resoudUFamille` absent).

- [ ] **Step 3 : Implémenter (append au module)**

```js
import { uDefautPour } from './refDataResolvers.js';

const TYPE_U_DEFAUT = { murs: 'mur', plancherBas: 'plancherBas', plafondToiture: 'plafond' };

/** U résolu pour une famille sur une pièce : exception (pièce×famille) > famille (défaut année | valeur). */
export function resoudUFamille(compositions, famille, pieceId, { uDefauts, annee }) {
  const excP = compositions?.exceptions?.parois?.[`${pieceId}:${famille}`];
  if (excP && Number.isFinite(excP.u)) return excP.u;
  const fam = compositions?.familles?.[famille] ?? {};
  if (fam.mode === 'defaut' && TYPE_U_DEFAUT[famille]) {
    return uDefautPour(uDefauts, TYPE_U_DEFAUT[famille], annee);
  }
  return Number.isFinite(fam.u) ? fam.u : null;
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node --test scripts/thermique/assemble-batiment-parametrique.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/assembleBatimentParametrique.js scripts/thermique/assemble-batiment-parametrique.test.mjs
git commit -m "feat(thermique): resoudUFamille (défaut année + exceptions par pièce)"
```

---

### Task 4 : Parois d'une pièce paramétrique

**Files:**
- Modify: `src/apps/thermique/lib/assembleBatimentParametrique.js`
- Test: `scripts/thermique/assemble-batiment-parametrique.test.mjs`

Contrat `paroisPieceParametrique(piece, ctx)` → `{ parois, erreurs }`. `ctx = { compositions, uDefauts, annee, deltaUtb, bPlancherBas, bComble, estRez, estDernier }`. Chaque paroi retournée est au format `transmissionPiece` : `{ surface, u, deltaUtb, poste, b|thetaAdjacente }` + `type`/`pieceId` pour la traçabilité.

- [ ] **Step 1 : Écrire le test (append)**

```js
import { paroisPieceParametrique } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';

const ctxBase = {
  compositions: {
    familles: {
      murs: { mode: 'valeur', u: 0.4 }, plancherBas: { mode: 'valeur', u: 0.3 },
      plafondToiture: { mode: 'valeur', u: 0.2 }, fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 },
    },
    exceptions: { parois: {}, ouvertures: {} },
  },
  uDefauts: U_DEFAUTS, annee: 2010, deltaUtb: 0.1, bPlancherBas: 1, bComble: 0.9,
  estRez: true, estDernier: true,
};
// Pièce 5×4×2.5 m, 9 m de mur ext, 3 m² d'ouverture (fenêtre), pas de LNC.
const pieceRef = {
  id: 'sej', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
  longueur: 500, largeur: 400, hauteur: 250,
  mlMurExterieur: 900, mlMurLocalNonChauffe: 0, bLocalNonChauffe: 0.6,
  surfaceOuverture: 3, typeMenuiserie: 'fenetre',
};

test('parois : mur ext = 9×2.5 − 3 = 19.5 m², b=1, poste murs', () => {
  const { parois, erreurs } = paroisPieceParametrique(pieceRef, ctxBase);
  assert.deepEqual(erreurs, []);
  const murExt = parois.find((p) => p.type === 'mur-exterieur');
  assert.equal(murExt.surface, 19.5);
  assert.equal(murExt.u, 0.4);
  assert.equal(murExt.b, 1);
  assert.equal(murExt.poste, 'murs');
  assert.equal(murExt.deltaUtb, 0.1);
});
test('parois : menuiserie = 3 m² × U 1.3, poste menuiseries', () => {
  const { parois } = paroisPieceParametrique(pieceRef, ctxBase);
  const men = parois.find((p) => p.poste === 'menuiseries');
  assert.equal(men.surface, 3);
  assert.equal(men.u, 1.3);
  assert.equal(men.b, 1);
});
test('parois : plancher bas + plafond présents au rez+dernier (surface 20 m²)', () => {
  const { parois } = paroisPieceParametrique(pieceRef, ctxBase);
  assert.equal(parois.find((p) => p.type === 'plancher-bas').surface, 20);
  assert.equal(parois.find((p) => p.type === 'plancher-bas').b, 1);
  assert.equal(parois.find((p) => p.type === 'plafond-comble').surface, 20);
  assert.equal(parois.find((p) => p.type === 'plafond-comble').b, 0.9);
});
test('parois : niveau intermédiaire (ni rez ni dernier) → ni plancher ni plafond', () => {
  const { parois } = paroisPieceParametrique(pieceRef, { ...ctxBase, estRez: false, estDernier: false });
  assert.equal(parois.some((p) => p.poste === 'plancherBas'), false);
  assert.equal(parois.some((p) => p.poste === 'plafondToiture'), false);
});
test('parois : mur sur LNC = ml × H, b = bLocalNonChauffe', () => {
  const { parois } = paroisPieceParametrique({ ...pieceRef, mlMurLocalNonChauffe: 400, bLocalNonChauffe: 0.6 }, ctxBase);
  const lnc = parois.find((p) => p.type === 'mur-lnc');
  assert.equal(lnc.surface, 10);   // 4 m × 2.5 m
  assert.equal(lnc.b, 0.6);
});
test('parois : ouverture > mur ext → erreur pièce', () => {
  const { parois, erreurs } = paroisPieceParametrique({ ...pieceRef, surfaceOuverture: 100 }, ctxBase);
  assert.equal(parois.length, 0);
  assert.ok(erreurs[0].includes('ouverture'));
});
test('parois : U manquant (famille murs null) → erreur', () => {
  const ctx = { ...ctxBase, compositions: { familles: { ...ctxBase.compositions.familles, murs: { mode: 'valeur', u: null } }, exceptions: { parois: {}, ouvertures: {} } } };
  const { erreurs } = paroisPieceParametrique(pieceRef, ctx);
  assert.ok(erreurs.some((e) => e.includes('murs')));
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node --test scripts/thermique/assemble-batiment-parametrique.test.mjs`
Expected: FAIL (`paroisPieceParametrique` absent).

- [ ] **Step 3 : Implémenter (append au module)**

```js
const MENU_FAMILLE = { fenetre: 'fenetre', porteFenetre: 'porteFenetre', porte: 'porte' };

/** Parois moteur d'une pièce paramétrique. ctx : voir JSDoc de assembleBatimentParametrique.
 * @returns {{ parois: object[], erreurs: string[] }} */
export function paroisPieceParametrique(piece, ctx) {
  const erreurs = [];
  const parois = [];
  const H = (piece.hauteur ?? 0) / 100;          // cm → m
  const L = (piece.longueur ?? 0) / 100;
  const l = (piece.largeur ?? 0) / 100;
  const surfaceSol = L * l;
  const nom = piece.nom ?? piece.id;

  const surfMurExt = (piece.mlMurExterieur ?? 0) / 100 * H - (piece.surfaceOuverture ?? 0);
  if (surfMurExt < 0) {
    erreurs.push(`« ${nom} » : surface d'ouverture (${piece.surfaceOuverture} m²) supérieure au mur extérieur déclaré`);
    return { parois, erreurs };
  }

  const pousse = (famille, type, surface, refTemp) => {
    if (surface <= 0) return;
    const u = resoudUFamille(ctx.compositions, famille, piece.id, { uDefauts: ctx.uDefauts, annee: ctx.annee });
    if (!Number.isFinite(u) || u <= 0) { erreurs.push(`« ${nom} » : U manquant pour « ${famille} »`); return; }
    const poste = famille === 'murs' ? 'murs'
      : famille === 'plancherBas' ? 'plancherBas'
      : famille === 'plafondToiture' ? 'plafondToiture' : 'menuiseries';
    parois.push({ surface, u, deltaUtb: ctx.deltaUtb, poste, type, pieceId: piece.id, ...refTemp });
  };

  // Mur extérieur (b=1) et menuiserie (b=1)
  pousse('murs', 'mur-exterieur', surfMurExt, { b: 1 });
  const famMenu = MENU_FAMILLE[piece.typeMenuiserie] ?? 'fenetre';
  pousse(famMenu, 'menuiserie', piece.surfaceOuverture ?? 0, { b: 1 });
  // Mur sur local non chauffé (b = bLocalNonChauffe)
  const surfLnc = (piece.mlMurLocalNonChauffe ?? 0) / 100 * H;
  pousse('murs', 'mur-lnc', surfLnc, { b: Number.isFinite(piece.bLocalNonChauffe) ? piece.bLocalNonChauffe : 1 });
  // Plancher bas (si rez) / plafond (si dernier niveau)
  if (ctx.estRez) pousse('plancherBas', 'plancher-bas', surfaceSol, { b: ctx.bPlancherBas });
  if (ctx.estDernier) pousse('plafondToiture', 'plafond-comble', surfaceSol, { b: ctx.bComble });

  return { parois, erreurs };
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node --test scripts/thermique/assemble-batiment-parametrique.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/assembleBatimentParametrique.js scripts/thermique/assemble-batiment-parametrique.test.mjs
git commit -m "feat(thermique): paroisPieceParametrique (murs ext/LNC, menuiserie, plancher/plafond)"
```

---

### Task 5 : Assembleur complet paramétrique → batiment

**Files:**
- Modify: `src/apps/thermique/lib/assembleBatimentParametrique.js`
- Test: `scripts/thermique/assemble-batiment-parametrique.test.mjs`

Contrat `assembleBatimentParametrique(saisie, options)` → `{ batiment, thetaE, parois, erreurs, avertissements }` (même shape qu'`assembleBatiment`, consommable par `calculeBatiment`). `options = { data:{ climat, uDefauts, coefficientsB, ventilation }, contexte, compositions, reglages:{ deltaUtb (table), fRH } }`.

- [ ] **Step 1 : Écrire le test (append)** — assemblage bout-en-bout + passage dans `calculeBatiment`

```js
import { assembleBatimentParametrique } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';
import { calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';
const CLIMAT = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/climat.json', import.meta.url), 'utf8'));
const VENTIL = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/ventilation.json', import.meta.url), 'utf8'));

const saisieRef = {
  modeSaisie: 'parametrique', plancherBasType: 'terre-plein', toitureType: 'comble',
  niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, hauteur: 250, emprise: { polygone: rect(0, 0, 500, 400) } }],
  pieces: [{
    id: 'sej', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
    longueur: 500, largeur: 400, hauteur: 250, mlMurExterieur: 900, mlMurLocalNonChauffe: 0,
    bLocalNonChauffe: 0.6, surfaceOuverture: 3, typeMenuiserie: 'fenetre',
  }],
};
const optionsRef = {
  data: { climat: CLIMAT, uDefauts: U_DEFAUTS, coefficientsB: COEFF_B, ventilation: VENTIL },
  contexte: { dept: '81', altitude: 200, annee: 2010, typeVentilation: 'vmc-sf-auto', isolation: 'iti', combleIsolation: 'isole', sousSolAvecOuvertures: false, relance: false },
  compositions: { familles: { murs: { mode: 'valeur', u: 0.4 }, plancherBas: { mode: 'valeur', u: 0.3 }, plafondToiture: { mode: 'valeur', u: 0.2 }, fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 } }, exceptions: { parois: {}, ouvertures: {} } },
  reglages: { deltaUtb: { 'non-isole': 0.15, iti: 0.10, ite: 0.05 }, fRH: 0 },
};

test('assembleBatimentParametrique : batiment consommable par calculeBatiment', () => {
  const { batiment, thetaE, erreurs } = assembleBatimentParametrique(saisieRef, optionsRef);
  assert.deepEqual(erreurs, []);
  assert.ok(Number.isFinite(thetaE));
  const bilan = calculeBatiment(batiment);
  assert.ok(bilan.total > 0);
  assert.equal(bilan.pieces.length, 1);
  assert.ok(bilan.pieces[0].parPoste.murs > 0);
  assert.ok(bilan.pieces[0].parPoste.menuiseries > 0);
});

test('assembleBatimentParametrique : aucune pièce chauffée → erreur', () => {
  const s = { ...saisieRef, pieces: [{ ...saisieRef.pieces[0], chauffee: false }] };
  const { batiment, erreurs } = assembleBatimentParametrique(s, optionsRef);
  assert.equal(batiment, null);
  assert.ok(erreurs.some((e) => e.includes('chauffée')));
});

test('assembleBatimentParametrique : θint manquante sur pièce chauffée → erreur', () => {
  const s = { ...saisieRef, pieces: [{ ...saisieRef.pieces[0], thetaInt: null }] };
  const { erreurs } = assembleBatimentParametrique(s, optionsRef);
  assert.ok(erreurs.some((e) => e.includes('consigne')));
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node --test scripts/thermique/assemble-batiment-parametrique.test.mjs`
Expected: FAIL (`assembleBatimentParametrique` absent).

- [ ] **Step 3 : Implémenter (append au module)**

```js
import { thetaBasePour, resolvePeriode, debitVentilationPour, coefficientBPour } from './refDataResolvers.js';
import { typePieceInfo, PLAGES_VRAISEMBLANCE } from './thermiqueConfig.js';
import { bPlancherBasPour } from './assembleBatiment.js';

const B_COMBLE = {
  isole: 'Toiture isolée',
  'non-isole': 'Autres toitures non isolée',
  'fortement-ventile': 'Espace sous toiture fortement ventilé sans feutre ni panneau en sous face',
};

/**
 * Assembleur paramétrique : saisie + données + choix → entrée de calculeBatiment.
 * Même shape de sortie qu'assembleBatiment. batiment null si erreurs bloquantes (l'UI liste, jamais throw).
 */
export function assembleBatimentParametrique(saisie, options) {
  const { data, contexte, compositions, reglages } = options;
  const erreurs = [];
  const avertissements = [];

  let thetaE = null;
  try { thetaE = thetaBasePour(data.climat, contexte.dept, contexte.altitude).thetaE; }
  catch (e) { erreurs.push(e.message); }

  const deltaUtb = reglages.deltaUtb[contexte.isolation];
  if (!Number.isFinite(deltaUtb)) erreurs.push(`type d'isolation inconnu « ${contexte.isolation} »`);
  const bComble = coefficientBPour(data.coefficientsB, 'Espace sous toiture', B_COMBLE[contexte.combleIsolation] ?? B_COMBLE.isole);
  const bPlancherBas = bPlancherBasPour(data.coefficientsB, saisie.plancherBasType, contexte.sousSolAvecOuvertures);
  const rangMax = Math.max(...saisie.niveaux.map((n) => n.rang ?? 0));

  const chauffees = saisie.pieces.filter((p) => p.chauffee);
  if (chauffees.length === 0) erreurs.push('aucune pièce chauffée — ajoutez au moins une pièce chauffée');

  const paroisResolues = [];
  const piecesBat = [];
  for (const p of chauffees) {
    if (!Number.isFinite(p.thetaInt)) { erreurs.push(`« ${p.nom ?? p.id} » : température de consigne manquante`); continue; }
    const niveau = saisie.niveaux.find((n) => n.id === p.niveauId);
    const ctx = {
      compositions, uDefauts: data.uDefauts, annee: contexte.annee, deltaUtb: deltaUtb ?? 0,
      bPlancherBas, bComble, estRez: (niveau?.rang ?? 0) === 0, estDernier: (niveau?.rang ?? 0) === rangMax,
    };
    const { parois, erreurs: errP } = paroisPieceParametrique(p, ctx);
    erreurs.push(...errP);
    paroisResolues.push(...parois);
    const surface = (p.longueur / 100) * (p.largeur / 100);
    const volume = surface * (p.hauteur / 100);
    piecesBat.push({ id: p.id, nom: p.nom, surface, volume, thetaInt: p.thetaInt, humide: typePieceInfo(p.typePiece).humide, parois });
  }

  let systemeVentilation = null; let debitTotal = null;
  try {
    const nbPrincipales = chauffees.filter((p) => typePieceInfo(p.typePiece).principale).length;
    ({ systeme: systemeVentilation, debitTotal } = debitVentilationPour(data.ventilation, contexte.typeVentilation, Math.max(1, nbPrincipales)));
  } catch (e) { erreurs.push(e.message); }

  if (erreurs.length > 0) return { batiment: null, thetaE, parois: paroisResolues, erreurs, avertissements };

  const batiment = {
    thetaExt: thetaE, systemeVentilation, debitTotal,
    fRH: contexte.relance ? reglages.fRH : 0,
    plageVraisemblance: PLAGES_VRAISEMBLANCE[resolvePeriode(contexte.annee)],
    pieces: piecesBat,
  };
  return { batiment, thetaE, parois: paroisResolues, erreurs, avertissements };
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node --test scripts/thermique/assemble-batiment-parametrique.test.mjs`
Expected: PASS (tous).

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/assembleBatimentParametrique.js scripts/thermique/assemble-batiment-parametrique.test.mjs
git commit -m "feat(thermique): assembleBatimentParametrique complet → calculeBatiment"
```

---

### Task 6 : Réconciliation emprise ↔ pièces

**Files:**
- Create: `src/apps/thermique/lib/reconciliationEmprise.js`
- Test: `scripts/thermique/reconciliation-emprise.test.mjs`

Contrat `reconcilieBatiment(saisie, { seuilPct = 0.10 })` → `{ parNiveau: [{ niveauId, nom, surfaceEmprise, surfacePieces, ecartSurfacePct, perimetreEmprise, mlExtPieces, ecartMlPct, alerte }], alerteGlobale, messages }`.

- [ ] **Step 1 : Écrire le test**

```js
// scripts/thermique/reconciliation-emprise.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilieBatiment } from '../../src/apps/thermique/lib/reconciliationEmprise.js';

const rect = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
// Emprise 20 m² / 18 m ; 2 pièces qui totalisent 20 m² et 18 m de mur ext → cohérent.
const saisieOk = {
  niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, emprise: { polygone: rect(0, 0, 500, 400) } }],
  pieces: [
    { id: 'a', niveauId: 'rdc', chauffee: true, longueur: 250, largeur: 400, mlMurExterieur: 900 },
    { id: 'b', niveauId: 'rdc', chauffee: true, longueur: 250, largeur: 400, mlMurExterieur: 900 },
  ],
};

test('réconciliation cohérente : pas d\'alerte', () => {
  const r = reconcilieBatiment(saisieOk, { seuilPct: 0.10 });
  assert.equal(r.alerteGlobale, false);
  assert.equal(r.parNiveau[0].surfaceEmprise, 20);
  assert.equal(r.parNiveau[0].surfacePieces, 20);
});

test('réconciliation surface incohérente (> seuil) : alerte', () => {
  const s = { ...saisieOk, pieces: [{ id: 'a', niveauId: 'rdc', chauffee: true, longueur: 250, largeur: 400, mlMurExterieur: 900 }] };
  const r = reconcilieBatiment(s, { seuilPct: 0.10 });
  assert.equal(r.alerteGlobale, true);          // 10 m² vs 20 m² = 50 % d'écart
  assert.ok(r.parNiveau[0].alerte);
});

test('réconciliation emprise vide : pas d\'alerte (garde-fou seulement si emprise renseignée)', () => {
  const s = { niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, emprise: { polygone: [] } }], pieces: saisieOk.pieces };
  const r = reconcilieBatiment(s, { seuilPct: 0.10 });
  assert.equal(r.alerteGlobale, false);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node --test scripts/thermique/reconciliation-emprise.test.mjs`
Expected: FAIL (module absent).

- [ ] **Step 3 : Implémenter**

```js
// src/apps/thermique/lib/reconciliationEmprise.js
// Croisement « vérification globale » (emprise dessinée) vs somme des pièces paramétriques — module PUR.
// Alerte NON bloquante au-delà du seuil. Ignore un niveau dont l'emprise n'est pas renseignée.
import { empriseDerives } from './assembleBatimentParametrique.js';

function ecartPct(ref, val) {
  if (!(ref > 0)) return 0;
  return Math.abs(val - ref) / ref;
}

export function reconcilieBatiment(saisie, { seuilPct = 0.10 } = {}) {
  const parNiveau = [];
  const messages = [];
  for (const n of saisie.niveaux) {
    const { surfaceSol, perimetre } = empriseDerives(n.emprise);
    const pieces = saisie.pieces.filter((p) => p.niveauId === n.id);
    const surfacePieces = pieces.reduce((s, p) => s + ((p.longueur ?? 0) / 100) * ((p.largeur ?? 0) / 100), 0);
    const mlExtPieces = pieces.reduce((s, p) => s + (p.mlMurExterieur ?? 0) / 100, 0);
    const empriseRenseignee = surfaceSol > 0;
    const ecartSurfacePct = empriseRenseignee ? ecartPct(surfaceSol, surfacePieces) : 0;
    const ecartMlPct = empriseRenseignee ? ecartPct(perimetre, mlExtPieces) : 0;
    const alerte = empriseRenseignee && (ecartSurfacePct > seuilPct || ecartMlPct > seuilPct);
    if (alerte) {
      if (ecartSurfacePct > seuilPct) messages.push(`${n.nom} : surface pièces ${surfacePieces.toFixed(1)} m² vs emprise ${surfaceSol.toFixed(1)} m² (${Math.round(ecartSurfacePct * 100)} % d'écart)`);
      if (ecartMlPct > seuilPct) messages.push(`${n.nom} : métré mur ext ${mlExtPieces.toFixed(1)} m vs périmètre ${perimetre.toFixed(1)} m (${Math.round(ecartMlPct * 100)} % d'écart)`);
    }
    parNiveau.push({ niveauId: n.id, nom: n.nom, surfaceEmprise: surfaceSol, surfacePieces, ecartSurfacePct, perimetreEmprise: perimetre, mlExtPieces, ecartMlPct, alerte });
  }
  return { parNiveau, alerteGlobale: parNiveau.some((x) => x.alerte), messages };
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node --test scripts/thermique/reconciliation-emprise.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/reconciliationEmprise.js scripts/thermique/reconciliation-emprise.test.mjs
git commit -m "feat(thermique): réconciliation emprise vs somme des pièces"
```

---

## Phase 2 — État & modèle d'étude

### Task 7 : État wizard — `saisie`, action SET_SAISIE, persistance

**Files:**
- Modify: `src/apps/thermique/lib/wizardState.js`
- Test: `scripts/thermique/wizard-state.test.mjs`

- [ ] **Step 1 : Écrire le test (append)**

```js
import { initialWizardState, wizardReducer, toStudyInput } from '../../src/apps/thermique/lib/wizardState.js';
import { buildThermiqueConfig } from '../../src/apps/thermique/lib/thermiqueConfig.js';
const CFG = buildThermiqueConfig(null);

test('initialWizardState : saisie paramétrique par défaut', () => {
  const s = initialWizardState(CFG);
  assert.equal(s.saisie.modeSaisie, 'parametrique');
  assert.equal(s.saisie.niveaux[0].rang, 0);
  assert.deepEqual(s.saisie.pieces, []);
});

test('SET_SAISIE remplace la saisie', () => {
  const s0 = initialWizardState(CFG);
  const saisie = { ...s0.saisie, pieces: [{ id: 'x', niveauId: 'rdc', chauffee: true }] };
  const s1 = wizardReducer(s0, { type: 'SET_SAISIE', saisie });
  assert.equal(s1.saisie.pieces.length, 1);
});

test('toStudyInput inclut saisie', () => {
  const s = initialWizardState(CFG);
  const input = toStudyInput(s);
  assert.ok(input.saisie);
  assert.equal(input.saisie.modeSaisie, 'parametrique');
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node --test scripts/thermique/wizard-state.test.mjs`
Expected: FAIL (`saisie` absent).

- [ ] **Step 3 : Implémenter dans `wizardState.js`**

1. Importer le défaut : en tête, `import { defautSaisie } from './thermiqueConfig.js';`
2. Dans `initialWizardState`, ajouter la clé `saisie: defautSaisie(),` (garder `dessin` inchangé pour la compat legacy).
3. Dans `wizardReducer`, ajouter le case :
```js
    case 'SET_SAISIE':
      return { ...state, saisie: action.saisie };
```
4. Dans `LOAD_STUDY`, hydrater `saisie` par-dessus le défaut (robuste aux anciennes études sans `saisie`) :
```js
        saisie: input.saisie ?? base.saisie,
```
   (ajouter cette ligne dans l'objet retourné, à côté de `dessin: input.dessin ?? base.dessin,`).
5. Dans `toStudyInput`, ajouter `saisie: state.saisie,` dans l'objet retourné (garder `dessin`, `compositions`, `pac`, `contexte`).

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node --test scripts/thermique/wizard-state.test.mjs`
Expected: PASS (anciens tests toujours verts + nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/wizardState.js scripts/thermique/wizard-state.test.mjs
git commit -m "feat(thermique): état wizard saisie paramétrique (SET_SAISIE + persistance)"
```

---

### Task 8 : `buildEtudeModel` — routage par shape + foisonnement par pièce

**Files:**
- Modify: `src/apps/thermique/lib/etudeModel.js`
- Test: `scripts/thermique/etude-model.test.mjs`

Le modèle live doit : router vers `assembleBatimentParametrique` quand `etude.saisie` porte des pièces (sinon fallback legacy `assembleBatiment` sur `etude.dessin`), et exposer une **puissance émetteur par pièce** = `total × foisonnement` dans `bilan.pieces[i].puissanceEmetteur`.

- [ ] **Step 1 : Écrire le test (append)** — reprend `saisieRef`/`optionsRef` ; construit `env = { config, data }`.

```js
import { buildEtudeModel } from '../../src/apps/thermique/lib/etudeModel.js';
import { buildThermiqueConfig } from '../../src/apps/thermique/lib/thermiqueConfig.js';
// (réutiliser CLIMAT/U_DEFAUTS/COEFF_B/VENTIL chargés en tête du fichier de test)

const saisieParam = {
  modeSaisie: 'parametrique', plancherBasType: 'terre-plein', toitureType: 'comble',
  niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, hauteur: 250, emprise: { polygone: [{x:0,y:0},{x:500,y:0},{x:500,y:400},{x:0,y:400}] } }],
  pieces: [{ id: 'sej', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20, longueur: 500, largeur: 400, hauteur: 250, mlMurExterieur: 900, mlMurLocalNonChauffe: 0, bLocalNonChauffe: 0.6, surfaceOuverture: 3, typeMenuiserie: 'fenetre' }],
};
const etude = {
  contexte: { dept: '81', altitude: 200, annee: 2010, dju: 2200, typeVentilation: 'vmc-sf-auto', isolation: 'iti', combleIsolation: 'isole', sousSolAvecOuvertures: false, relance: false },
  saisie: saisieParam,
  compositions: { familles: { murs: { mode: 'valeur', u: 0.4 }, plancherBas: { mode: 'valeur', u: 0.3 }, plafondToiture: { mode: 'valeur', u: 0.2 }, fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 } }, exceptions: { parois: {}, ouvertures: {} } },
  pac: { regime: 45, mode: null, pacId: null, points: [], scopManuel: null, prixKwh: 0.1952 },
};

test('buildEtudeModel : mode paramétrique → ok + puissance émetteur (foisonnement 1.2)', () => {
  const config = buildThermiqueConfig({ thermique: { foisonnement_emetteur: 1.2 } });
  const model = buildEtudeModel(etude, { config, data: { climat: CLIMAT, uDefauts: U_DEFAUTS, coefficientsB: COEFF_B, ventilation: VENTIL, pacCatalogue: null } });
  assert.equal(model.ok, true);
  const p = model.bilan.pieces[0];
  assert.ok(Math.abs(p.puissanceEmetteur - p.total * 1.2) < 1e-6);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node --test scripts/thermique/etude-model.test.mjs`
Expected: FAIL (routage/foisonnement absents).

- [ ] **Step 3 : Implémenter dans `etudeModel.js`**

1. Importer : `import { assembleBatimentParametrique } from './assembleBatimentParametrique.js';`
2. Dans `buildEtudeModel`, **remplacer les 3 lignes existantes** (destructure `const { contexte, dessin, compositions } = etude;` + `reglages` + `assemblage`) par ce routage (ne plus destructurer `dessin` — on lit `etude.dessin` / `etude.saisie`) :
```js
  const { contexte, compositions } = etude;
  const reglages = { thetaIntDefauts: config.theta_int_defauts, deltaUtb: config.delta_utb, fRH: config.f_rh };
  const modeParametrique = etude.saisie?.modeSaisie === 'parametrique'
    && (etude.saisie.pieces?.length > 0 || !etude.dessin?.pieces?.length);
  const assemblage = modeParametrique
    ? assembleBatimentParametrique(etude.saisie, { data, contexte, compositions, reglages })
    : assembleBatiment(etude.dessin, { data, contexte, compositions, reglages });
```
3. Après `const bilan = calculeBatiment(assemblage.batiment);`, injecter le foisonnement par pièce (immuable) :
```js
  const foisonnement = Number.isFinite(config.foisonnement_emetteur) ? config.foisonnement_emetteur : 1.0;
  bilan.pieces = bilan.pieces.map((p) => ({ ...p, puissanceEmetteur: p.total * foisonnement }));
```
   (placer juste après le calcul du bilan, avant la résolution PAC ; `bilan` reste l'objet consommé ensuite.)

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `node --test scripts/thermique/etude-model.test.mjs`
Expected: PASS (legacy toujours vert + paramétrique + foisonnement).

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/etudeModel.js scripts/thermique/etude-model.test.mjs
git commit -m "feat(thermique): buildEtudeModel routage paramétrique + puissance émetteur (foisonnement)"
```

---

## Phase 3 — UI de saisie

### Task 9 : EmpriseCanvas (dessin du contour au sol par niveau)

**Files:**
- Create: `src/apps/thermique/components/canvas/EmpriseCanvas.jsx`

Composant de dessin d'UN contour rectangulaire par niveau (drag pour tracer/redimensionner), réutilisant les helpers purs `snapPoint`/`rectDepuisDrag`/`boiteEnglobante` (`canvasGeometry.js`) et `GRILLE_CM`. API :
```jsx
<EmpriseCanvas polygone={emprise.polygone} onChange={(polygone) => ...} />
```
Comportement minimal (v1, agilité) : si `polygone` vide → l'utilisateur glisse pour tracer un rectangle (via `rectDepuisDrag` + `snapPoint`) ; si déjà tracé → poignées de coin pour redimensionner (ou re-glisser efface et retrace). Affichage cotes L×l au survol des arêtes (réutiliser la logique de `PlanCanvas`/`CotesPiece` si simple, sinon labels basiques). Grille de fond identique à `PlanCanvas`.

- [ ] **Step 1 : Créer le composant** (rendu SVG contrôlé, drag → `onChange(polygone)`). S'inspirer de `PlanCanvas.jsx` pour le viewBox/échelle et de `canvasGeometry` pour le snap. Contenu clé :

```jsx
// src/apps/thermique/components/canvas/EmpriseCanvas.jsx
// Dessin d'UN contour d'emprise au sol (par niveau) pour la saisie paramétrique — SVG contrôlé.
// Réutilise snapPoint/rectDepuisDrag (canvasGeometry) + GRILLE_CM. Rectangle en v1 (drag pour tracer).
import { useRef, useState } from 'react';
import { snapPoint, rectDepuisDrag } from '../../lib/canvasGeometry';

const VIEW = 1000; // cm de côté visible par défaut (ajusté au polygone existant)

export default function EmpriseCanvas({ polygone, onChange }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null); // { p1, p2 } en cm

  const toCm = (evt) => {
    const svg = ref.current; const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = vb.x + ((evt.clientX - r.left) / r.width) * vb.width;
    const y = vb.y + ((evt.clientY - r.top) / r.height) * vb.height;
    return snapPoint({ x, y });
  };

  const onDown = (e) => setDrag({ p1: toCm(e), p2: toCm(e) });
  const onMove = (e) => drag && setDrag((d) => ({ ...d, p2: toCm(e) }));
  const onUp = () => {
    if (drag) {
      const poly = rectDepuisDrag(drag.p1, drag.p2);
      if (poly) onChange(poly);
      setDrag(null);
    }
  };

  const xs = polygone.map((p) => p.x); const ys = polygone.map((p) => p.y);
  const minX = polygone.length ? Math.min(...xs) : 0;
  const minY = polygone.length ? Math.min(...ys) : 0;
  const w = polygone.length ? Math.max(...xs) - minX : VIEW;
  const h = polygone.length ? Math.max(...ys) - minY : VIEW;
  const pad = Math.max(w, h, VIEW) * 0.1;
  const vb = `${minX - pad} ${minY - pad} ${Math.max(w, VIEW) + 2 * pad} ${Math.max(h, VIEW) + 2 * pad}`;
  const preview = drag ? rectDepuisDrag(drag.p1, drag.p2) : null;

  return (
    <svg
      ref={ref} viewBox={vb} className="w-full h-full touch-none bg-secondary-50"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      role="img" aria-label="Emprise au sol du niveau"
    >
      {polygone.length >= 3 && (
        <polygon points={polygone.map((p) => `${p.x},${p.y}`).join(' ')}
          className="fill-amber-100 stroke-amber-500" strokeWidth={Math.max(w, h) / 200} />
      )}
      {preview && (
        <polygon points={preview.map((p) => `${p.x},${p.y}`).join(' ')}
          className="fill-primary-100/50 stroke-primary-400" strokeDasharray="8 6" strokeWidth={Math.max(w, h) / 200} />
      )}
    </svg>
  );
}
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build`
Expected: build OK (pas d'erreur d'import).

- [ ] **Step 3 : Commit**

```bash
git add src/apps/thermique/components/canvas/EmpriseCanvas.jsx
git commit -m "feat(thermique): EmpriseCanvas (dessin du contour au sol par niveau)"
```

---

### Task 10 : PiecesTable (tableau de pièces paramétriques)

**Files:**
- Create: `src/apps/thermique/components/wizard/PiecesTable.jsx`

Tableau éditable ligne = pièce. Colonnes : Nom · Type · Chauffée · θint · L (cm) · l (cm) · H (cm) · ml mur ext · ml mur LNC · b LNC (preset+valeur) · surface ouverture (m²) · type menuiserie · supprimer. API :
```jsx
<PiecesTable saisie={saisie} config={config} onChange={(saisie) => ...} niveauActifId={id} />
```
Chaque édition produit une **nouvelle `saisie`** (immuable) remontée via `onChange`. Défauts à l'ajout : `typePiece:'autre'`, `chauffee` selon `typePieceInfo`, `thetaInt: config.theta_int_defauts[type]`, `hauteur` = hauteur du niveau, `bLocalNonChauffe: 0.6`, `typeMenuiserie:'fenetre'`. Re-défaut θint/chauffée au changement de type (même logique que `PieceInspector`, drapeaux « touché » locaux facultatifs — en v1, re-défauter θint seulement si le champ est vide pour rester simple).

- [ ] **Step 1 : Créer le composant** (utiliser `TYPES_PIECE`/`typePieceInfo` de `thermiqueConfig`, `LNC_PRESETS`, `TextInput`/`SelectInput` de `FormFields`). Ajout de pièce = bouton « + Ajouter une pièce » (id `crypto.randomUUID()`, `niveauId = niveauActifId`). Squelette clé :

```jsx
// src/apps/thermique/components/wizard/PiecesTable.jsx
import { Plus, Trash2 } from 'lucide-react';
import { TYPES_PIECE, typePieceInfo, LNC_PRESETS } from '../../lib/thermiqueConfig';

const MENUISERIES = [
  { id: 'fenetre', label: 'Fenêtre' }, { id: 'porteFenetre', label: 'Porte-fenêtre' }, { id: 'porte', label: 'Porte' },
];
const num = (v) => (v === '' || v == null ? null : Number(v));

export default function PiecesTable({ saisie, config, onChange, niveauActifId }) {
  const niveau = saisie.niveaux.find((n) => n.id === niveauActifId);
  const pieces = saisie.pieces.filter((p) => p.niveauId === niveauActifId);

  const majPiece = (id, patch) => onChange({
    ...saisie,
    pieces: saisie.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  });
  const ajoute = () => onChange({
    ...saisie,
    pieces: [...saisie.pieces, {
      id: crypto.randomUUID(), niveauId: niveauActifId, nom: `Pièce ${saisie.pieces.length + 1}`,
      typePiece: 'autre', chauffee: typePieceInfo('autre').chauffeeParDefaut, thetaInt: config.theta_int_defauts.autre,
      longueur: 400, largeur: 300, hauteur: niveau?.hauteur ?? 250,
      mlMurExterieur: 0, mlMurLocalNonChauffe: 0, bLocalNonChauffe: 0.6, surfaceOuverture: 0, typeMenuiserie: 'fenetre',
    }],
  });
  const supprime = (id) => onChange({ ...saisie, pieces: saisie.pieces.filter((p) => p.id !== id) });
  const majType = (id, typePiece) => {
    const p = saisie.pieces.find((x) => x.id === id);
    const patch = { typePiece };
    if (p.thetaInt == null) patch.thetaInt = config.theta_int_defauts[typePiece] ?? config.theta_int_defauts.autre;
    patch.chauffee = typePieceInfo(typePiece).chauffeeParDefaut;
    majPiece(id, patch);
  };

  // ... rendu <table> : une <tr> par pièce, inputs contrôlés appelant majPiece(id, {champ: num(val)}).
  // b LNC : <select> LNC_PRESETS (majPiece bLocalNonChauffe) + input numérique override.
  // Pied : bouton "+ Ajouter une pièce".
  return (/* table + bouton ajoute (cf. conventions FormFields/inputClass) */);
}
```

Compléter le rendu `<table>` avec des `<input type="number">` (classe `inputClass` de `FormFields`) pour L/l/H/ml ext/ml LNC/surface ouverture, `<select>` pour type de pièce, menuiserie et preset LNC, une checkbox « chauffée », et l'input θint (masqué si non chauffée). Chaque `onChange` appelle `majPiece(p.id, { champ: num(e.target.value) })`.

- [ ] **Step 2 : Vérifier le build + lint**

Run: `npx vite build && npm run lint:errors`
Expected: OK (aucune erreur).

- [ ] **Step 3 : Commit**

```bash
git add src/apps/thermique/components/wizard/PiecesTable.jsx
git commit -m "feat(thermique): PiecesTable (saisie paramétrique des pièces)"
```

---

### Task 11 : PanneauCoherence (réconciliation à l'écran)

**Files:**
- Create: `src/apps/thermique/components/wizard/PanneauCoherence.jsx`

Affiche `reconcilieBatiment(saisie)` : par niveau, surface pièces vs emprise et métré mur ext vs périmètre, avec badge ambre si `alerte`. Non bloquant.

- [ ] **Step 1 : Créer le composant**

```jsx
// src/apps/thermique/components/wizard/PanneauCoherence.jsx
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { reconcilieBatiment } from '../../lib/reconciliationEmprise';

const pct = (x) => `${Math.round(x * 100)} %`;

export default function PanneauCoherence({ saisie }) {
  const r = reconcilieBatiment(saisie, { seuilPct: 0.10 });
  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-2">
        {r.alerteGlobale ? <AlertTriangle className="w-4 h-4 text-amber-600" /> : <CheckCircle2 className="w-4 h-4 text-green-600" />}
        <h3 className="font-semibold text-secondary-900 text-sm">Cohérence emprise ↔ pièces</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary-500 border-b border-secondary-100">
              <th className="py-1.5 pr-3 font-medium">Niveau</th>
              <th className="py-1.5 pr-3 font-medium text-right">Surface pièces / emprise</th>
              <th className="py-1.5 pr-3 font-medium text-right">Mur ext / périmètre</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {r.parNiveau.map((n) => (
              <tr key={n.niveauId} className={n.alerte ? 'text-amber-800' : 'text-secondary-700'}>
                <td className="py-1.5 pr-3">{n.nom}</td>
                <td className="py-1.5 pr-3 text-right">{n.surfacePieces.toFixed(1)} / {n.surfaceEmprise.toFixed(1)} m² {n.ecartSurfacePct > 0.10 && `(${pct(n.ecartSurfacePct)})`}</td>
                <td className="py-1.5 pr-3 text-right">{n.mlExtPieces.toFixed(1)} / {n.perimetreEmprise.toFixed(1)} m {n.ecartMlPct > 0.10 && `(${pct(n.ecartMlPct)})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.alerteGlobale && (
        <p className="text-xs text-amber-700">Écart {'>'} 10 % — vérifiez les métrés (non bloquant).</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build`
Expected: OK.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/thermique/components/wizard/PanneauCoherence.jsx
git commit -m "feat(thermique): PanneauCoherence (réconciliation à l'écran)"
```

---

### Task 12 : Step2EmprisePieces (assemblage de l'étape 2 paramétrique)

**Files:**
- Create: `src/apps/thermique/components/wizard/Step2EmprisePieces.jsx`

Assemble : barre de niveaux (onglets + ajout/hauteur/suppression — réutiliser la logique de `Step2Dessin`, mais opérant sur `saisie.niveaux` avec le champ `rang`), `EmpriseCanvas` du niveau actif (pleine largeur), `PiecesTable`, `PanneauCoherence`, et les compositions (réutiliser les 3 `CompositionFamille` + les 3 `InputU` menuiseries + le `<details>` exceptions par pièce déjà écrits dans `Step3OuverturesCompositions` — extraire ou dupliquer le bloc « Compositions » et « Menuiseries »). API :
```jsx
<Step2EmprisePieces saisie={saisie} compositions={compositions} config={config} annee={annee}
  onSaisieChange={...} onPatchCompositions={...} onExceptionParoi={...} />
```

Gestion des niveaux (sur `saisie`, sans `dessinOps`) : ajout `{ id: crypto.randomUUID(), nom, rang: maxRang+1, hauteur: 250, emprise:{polygone:[]} }` ; suppression interdite s'il ne reste qu'un niveau ; hauteur éditée par niveau. La suppression d'un niveau retire aussi ses pièces (`saisie.pieces.filter`).

- [ ] **Step 1 : Créer le composant** (état local `niveauActifId`, handlers immuables sur `saisie`). Structure : barre niveaux → `flex` [EmpriseCanvas `flex-1` + hauteur `h-[460px]`] puis PiecesTable pleine largeur dessous → PanneauCoherence → bloc compositions.

- [ ] **Step 2 : Vérifier le build + lint**

Run: `npx vite build && npm run lint:errors`
Expected: OK.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/thermique/components/wizard/Step2EmprisePieces.jsx
git commit -m "feat(thermique): Step2EmprisePieces (emprise + pièces + cohérence + compositions)"
```

---

### Task 13 : Câblage du wizard + élargissement (point 1)

**Files:**
- Modify: `src/apps/thermique/pages/ThermiqueWizard.jsx`
- Modify: `src/apps/thermique/components/wizard/Step1Contexte.jsx`

Le wizard passe à **3 étapes** (Contexte / Emprise & pièces / Résultats) en mode paramétrique. Remplacer `Step2Dessin` + `Step3OuverturesCompositions` par `Step2EmprisePieces`. Adapter le gating (`valideDessin` → validation légère de `saisie` : au moins une pièce chauffée avec θint, commune sélectionnée).

⚠️ `Step1Contexte` écrit aujourd'hui `toitureType`/`plancherBasType` dans **`dessin`** (via `onSetDessin`, lignes 171/189) — ces champs vivent désormais dans **`saisie`**. Il faut le re-pointer (Step 0 ci-dessous), sinon le choix « type de toiture / plancher bas » ne s'applique jamais au calcul paramétrique (`assembleBatimentParametrique` lit `saisie.plancherBasType`/`saisie.toitureType`).

- [ ] **Step 0 : Re-pointer `Step1Contexte` sur `saisie`**

Dans `Step1Contexte.jsx` : renommer les props `dessin`→`saisie` et `onSetDessin`→`onSetSaisie` ; remplacer les 2 handlers toiture/plancher :
```jsx
value={saisie.toitureType}
onChange={(v) => v && onSetSaisie({ ...saisie, toitureType: v })}
// ...
value={saisie.plancherBasType}
onChange={(v) => v && onSetSaisie({ ...saisie, plancherBasType: v })}
```
et l'unique `dessin.plancherBasType === 'sous-sol'` → `saisie.plancherBasType === 'sous-sol'`, `dessin.toitureType === 'comble'` → `saisie.toitureType === 'comble'`. (Ces champs existent dans `defautSaisie()` — Task 1.)

- [ ] **Step 1 : Modifier `STEPS` et le rendu**

```js
const STEPS = [
  { n: 1, label: 'Contexte' },
  { n: 2, label: 'Emprise & pièces' },
  { n: 3, label: 'Résultats' },
];
```
Câbler `Step1Contexte` sur `saisie` : `saisie={state.saisie}` + `onSetSaisie={(saisie) => dispatch({ type: 'SET_SAISIE', saisie })}` (retirer `dessin`/`onSetDessin`). Remplacer les blocs `state.step === 2/3/4` : étape 2 → `<Step2EmprisePieces .../>` (branché sur `state.saisie`, dispatch `SET_SAISIE`), étape 3 → `<Step4Resultats .../>`. Supprimer l'import de `Step2Dessin`/`Step3OuverturesCompositions` et `valideDessin`.

- [ ] **Step 2 : Gating**

```js
const hasPieceChauffeeValide = state.saisie.pieces.some((p) => p.chauffee && Number.isFinite(p.thetaInt));
const blockedReason = (targetStep) => {
  if (targetStep >= 2 && state.contexte.dept == null) return 'Sélectionnez une commune pour continuer';
  if (targetStep >= 3 && !hasPieceChauffeeValide) return 'Ajoutez au moins une pièce chauffée avec sa consigne';
  return null;
};
```

- [ ] **Step 3 : Élargir la zone de travail (point 1)**

Le conteneur racine passe de `max-w-4xl mx-auto` à une largeur conditionnelle : étape 2 = large (`max-w-7xl`), autres étapes = `max-w-4xl`. Exemple :
```jsx
<div className={`space-y-5 mx-auto ${state.step === 2 ? 'max-w-7xl' : 'max-w-4xl'}`}>
```

- [ ] **Step 4 : Vérifier build + lint + dead-code**

Run: `npx vite build && npm run lint:errors && npm run audit:dead-code`
Expected: build OK ; l'audit dead-code peut désormais lister `Step2Dessin`/`Step3OuverturesCompositions`/`PieceInspector`/`PlanCanvas` (attendu — à signaler pour retrait, cf. Task 16).

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/pages/ThermiqueWizard.jsx
git commit -m "feat(thermique): wizard 3 étapes paramétrique + zone de travail élargie"
```

---

## Phase 4 — Résultats

### Task 14 : ResultatsPiecesGrid + colonne émetteur, câblage Step4

**Files:**
- Create: `src/apps/thermique/components/wizard/ResultatsPiecesGrid.jsx`
- Modify: `src/apps/thermique/components/wizard/Step4Resultats.jsx`

`ResultatsPiecesGrid` : rendu paramétrique des résultats par pièce — chaque pièce = **vignette proportionnelle à L×l** (côté `√surface`), colorée par ratio W/m² (interpolation bleu→ambre, réutiliser la palette de `PlanResultats` : `#3b82f6`→`#f59e0b`, jamais rouge/vert, R12), disposées en grille flex. Tableau dessous : Pièce · Surface · Transmission · Ventilation · **Total** · **Puissance émetteur**. API `<ResultatsPiecesGrid bilan={bilan} />`.

Dans `Step4Resultats` : quand `model` est paramétrique (présence de `state.saisie?.pieces?.length`), rendre `ResultatsPiecesGrid` au lieu de `PlanResultats` ; garder `PlanResultats` pour les études legacy frozen (`savedResults` sans `saisie`). Masquer le bouton « Recalculer avec le moteur actuel » pour une étude legacy sans `saisie` (frozen-only, cf. décision compat).

- [ ] **Step 1 : Créer `ResultatsPiecesGrid.jsx`** (colonne émetteur = `p.puissanceEmetteur`, fallback `p.total` si absent). Palette et `fmtW` copiés du haut de `PlanResultats.jsx`.

- [ ] **Step 2 : Câbler dans `Step4Resultats.jsx`**

- Mode live : remplacer `<PlanResultats dessin={dessin} bilan={model.bilan} />` par :
```jsx
{state.saisie?.pieces?.length
  ? <ResultatsPiecesGrid bilan={model.bilan} />
  : <PlanResultats dessin={dessin} bilan={model.bilan} />}
```
- Mode R7 frozen : idem selon `state.saisie`. Pour une étude legacy sans `saisie`, garder `PlanResultats` + masquer « Recalculer » :
```jsx
{state.saisie?.pieces?.length && (
  <button onClick={onClearSavedResults} ...>Recalculer avec le moteur actuel</button>
)}
```
- `handleSave` : le `pacIncomplet`/`payload` restent inchangés (`toStudyInput(state)` inclut déjà `saisie`).

- [ ] **Step 3 : Vérifier build + lint**

Run: `npx vite build && npm run lint:errors`
Expected: OK.

- [ ] **Step 4 : Commit**

```bash
git add src/apps/thermique/components/wizard/ResultatsPiecesGrid.jsx src/apps/thermique/components/wizard/Step4Resultats.jsx
git commit -m "feat(thermique): résultats paramétriques (vignettes L×l + colonne puissance émetteur)"
```

---

## Phase 5 — Settings

### Task 15 : Champ foisonnement dans /settings/thermique

**Files:**
- Modify: `src/apps/artisan/pages/settings/ThermiqueSettings.jsx`

Ajouter `foisonnement_emetteur` dans l'onglet « Calcul » (section Consommation ou nouvelle section « Dimensionnement émetteurs »).

- [ ] **Step 1 : Étendre form/validation/persistance**

1. `BOUNDS` : ajouter `foisonnement_emetteur: { min: 1, max: 1.5 }`.
2. `pickThermiqueForm(config)` : ajouter `foisonnement_emetteur: config.foisonnement_emetteur,`.
3. `validateThermiqueForm(form)` : ajouter `&& inRange(form.foisonnement_emetteur, BOUNDS.foisonnement_emetteur)`.
4. `CalculTab` : ajouter un `NumberField` :
```jsx
<NumberField
  label="Foisonnement émetteur"
  value={form.foisonnement_emetteur}
  step={0.05}
  min={BOUNDS.foisonnement_emetteur.min}
  max={BOUNDS.foisonnement_emetteur.max}
  hint="Coefficient de surdimensionnement appliqué par émetteur (radiateur/plancher) à partir de la déperdition de la pièce"
  onChange={(v) => patch({ foisonnement_emetteur: v })}
/>
```
5. `handleSave` et `saveBiblio` : `form`/`pickThermiqueForm(config)` incluent déjà la clé — vérifier que `parois_bibliotheque` reste préservé (inchangé).

- [ ] **Step 2 : Vérifier build + lint**

Run: `npx vite build && npm run lint:errors`
Expected: OK.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/pages/settings/ThermiqueSettings.jsx
git commit -m "feat(thermique): réglage foisonnement émetteur dans /settings/thermique"
```

---

## Phase 6 — Nettoyage & non-régression

### Task 16 : Vérif globale + signalement code legacy

**Files:** (aucune modification — vérification + signalement)

- [ ] **Step 1 : Suite de tests purs complète**

Run: `node --test scripts/thermique/*.test.mjs`
Expected: tous PASS (moteur physique inchangé → thermal-engine / heat-pump-engine / assemble-batiment toujours verts = garde-fou de non-régression).

- [ ] **Step 2 : Build + lint + dead-code**

Run: `npx vite build && npm run lint:errors && npm run audit:dead-code`
Expected: build OK, 0 erreur lint. `audit:dead-code` liste probablement `Step2Dessin.jsx`, `Step3OuverturesCompositions.jsx`, `PieceInspector.jsx`, `PortesAFauxPanel.jsx`, `PlanCanvas.jsx` (+ satellites canvas) désormais non importés.

- [ ] **Step 3 : Signaler le retrait du modèle géométrique (pas de suppression dans ce lot — Posture #3)**

Créer un `spawn_task` (ou note de fin) : « Retirer le modèle de dessin géométrique par pièce du module Thermique une fois la saisie paramétrique validée en prod : `Step2Dessin`, `Step3OuverturesCompositions`, `PieceInspector`, `PortesAFauxPanel`, `PlanCanvas` + satellites canvas non-emprise, `dessinOps` (+ ses tests), et le champ `dessin` de wizardState. Conserver `geometryEngine` (utilisé par `EmpriseCanvas`/`empriseDerives`/`assembleBatiment` legacy) tant que des études legacy frozen existent. »

- [ ] **Step 4 : Commit (si note ajoutée quelque part) ou fin**

```bash
git commit --allow-empty -m "chore(thermique): checkpoint saisie paramétrique — legacy géométrique signalé pour retrait"
```

---

## Décisions de compatibilité (rappel)

- **Nouvelles études** : modèle `saisie` paramétrique.
- **Études legacy `dessin`** : affichées en résultats figés (R7) ; le recalcul live reste possible via le routage `buildEtudeModel` (fallback `assembleBatiment`) tant que le code géométrique est conservé. Le bouton « Recalculer » n'est exposé que pour les études paramétriques (une étude legacy sans `saisie` reste frozen-only côté UI). Volumétrie réelle quasi nulle (module livré 2026-07-06).
- **Moteur physique** : `thermalEngine`/`heatPumpEngine` **jamais retouchés** — leurs tests existants sont le garde-fou de non-régression.

## Hors périmètre (spec suivante — points 2/3/4)

Curation matériaux, régime d'eau 65/70 (+ `T_DEPART_MAX` 65→70 + avertissement fits COP), température de zone PAC pour l'appoint bois. À planifier séparément après validation de ce pivot.
