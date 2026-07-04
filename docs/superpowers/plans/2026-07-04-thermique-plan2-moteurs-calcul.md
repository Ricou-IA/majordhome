# Module Thermique — Plan 2/5 : Moteurs de calcul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les moteurs de calcul purs du module Thermique : `thermalEngine.js` (déperditions EN 12831 simplifié, pièce par pièce), `heatPumpEngine.js` (courbes PAC hplib, point de bivalence, consommation annuelle), et `refDataResolvers.js` (résolution des données de référence du plan 1), validés contre le logiciel Windows historique (±5 %).

**Architecture:** Modules JavaScript **purs** dans `src/apps/thermique/lib/` — aucun import React/Supabase **ni JSON** : les tables de données sont passées en paramètres (les tests node lisent les JSON via `fs`, l'app les branchera via `data/index.js` au plan 4). Tests `node --test` dans `scripts/thermique/`, pattern du module Solaire (`pvEngine.js`).

**Tech Stack:** Node ≥ 18 natif, aucune dépendance npm. Données : `src/apps/thermique/data/*.json` (plan 1, commits `26ba425`→`677b716`).

**Spec:** `docs/superpowers/specs/2026-07-03-module-thermique-deperditions-design.md` §4-§5

**Contraintes héritées du plan 1 (chaque tâche concernée les rappelle) :**
- hplib : `COP = p1·Tin + p2·Tout + p3 + p4·Tamb` (Tamb=Tin en air/eau) ; `P_el = pElRef·(p1..p4 linéaire)` avec **pElRef brut** (jamais pthRef/COP_fitté — ~34 % d'écart) ; `P_th = P_el·COP` ; génériques : pElRef null → dériver `pthRef / COP_fitté(−7,52)` comme hplib. Les P_th « Regulated » sont des points EN 14825 **charge partielle**, pas la capacité max.
- Année de construction inconnue → période **« avant 1974 »**.
- `climat.json` : une θe par département, **pas de règle d'altitude livrée** (calibration = Task 9) ; pas de DOM (971+ → erreur propre).
- `communes.json` : clé quasi-unique = `insee` ; DJU null ~750 communes (Var, Corse, DOM) → fallback départemental.
- `ventilation.json` : `systemes` (hygro 0.75, rendement DF 0.7) = hypothèses éditables, pas des faits réglementaires.
- Fourchettes affichées, pas de suroptimisation (les puissances PAC sont majorées ensuite).

**Convention d'erreur des moteurs :** toute fonction de calcul jette `new Error('thermique: <message>')` sur entrée invalide (jamais de NaN silencieux) ; les résolveurs retournent `null` sur donnée absente + la raison via un 2ᵉ élément si documenté. Tous les nombres retournés sont finis (les tests l'assertent).

---

### Task 1: Résolveurs de données — période de construction et U par défaut

**Files:**
- Create: `src/apps/thermique/lib/refDataResolvers.js`
- Test: `scripts/thermique/ref-data-resolvers.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/thermique/ref-data-resolvers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePeriode, uDefautPour } from '../../src/apps/thermique/lib/refDataResolvers.js';

const uDefauts = JSON.parse(readFileSync('src/apps/thermique/data/u-defauts.json', 'utf8'));

test('resolvePeriode : bornes réelles des périodes 3CL', () => {
  assert.equal(resolvePeriode(1960), 'avant 1974');
  assert.equal(resolvePeriode(1974), 'avant 1974');
  assert.equal(resolvePeriode(1975), '1975-1977');
  assert.equal(resolvePeriode(1980), '1978-1982');
  assert.equal(resolvePeriode(1995), '1989-2000');
  assert.equal(resolvePeriode(2013), 'après 2012');
  assert.equal(resolvePeriode(2024), 'après 2012');
  // année inconnue → « avant 1974 » (sémantique 3CL « avant 1974 ou inconnu »)
  assert.equal(resolvePeriode(null), 'avant 1974');
  assert.equal(resolvePeriode(undefined), 'avant 1974');
});

test('uDefautPour : lit la vraie table du plan 1', () => {
  assert.equal(uDefautPour(uDefauts, 'mur', 1960), 2.5);
  assert.equal(uDefautPour(uDefauts, 'mur', 2015), 0.23);
  assert.equal(uDefautPour(uDefauts, 'plancherBas', 1995), 0.5);
  assert.equal(uDefautPour(uDefauts, 'plafond', 2008), 0.2);
  assert.equal(uDefautPour(uDefauts, 'fenetre', 1990), null); // pas de table fenêtre (plan 1)
  assert.throws(() => uDefautPour(uDefauts, 'toiture', 1990), /thermique/); // type inconnu ≠ type sans table
});
```

- [ ] **Step 2: Run** `node --test scripts/thermique/ref-data-resolvers.test.mjs` → FAIL

- [ ] **Step 3: Implementation**

```javascript
// src/apps/thermique/lib/refDataResolvers.js
// Résolution des données de référence (data/*.json passées en paramètres — module PUR, aucun import).

// Bornes exactes des périodes de u-defauts.json (labels vérifiés plan 1 / Open3CL).
const PERIODES = [
  { max: 1974, label: 'avant 1974' },
  { max: 1977, label: '1975-1977' },
  { max: 1982, label: '1978-1982' },
  { max: 1988, label: '1983-1988' },
  { max: 2000, label: '1989-2000' },
  { max: 2005, label: '2001-2005' },
  { max: 2012, label: '2006-2012' },
  { max: Infinity, label: 'après 2012' },
];

/** Année → label de période 3CL. Année inconnue → 'avant 1974' (sémantique « ou inconnu »). */
export function resolvePeriode(annee) {
  if (!Number.isFinite(annee)) return 'avant 1974';
  return PERIODES.find((p) => annee <= p.max).label;
}

const TYPES_U_DEFAUT = ['mur', 'plancherBas', 'plafond', 'fenetre'];

/** U par défaut pour un type de paroi et une année. null si le type n'a pas de table (fenetre). */
export function uDefautPour(uDefauts, type, annee) {
  if (!TYPES_U_DEFAUT.includes(type)) throw new Error(`thermique: type de paroi inconnu « ${type} »`);
  const table = uDefauts[type];
  if (!table) return null; // fenetre : pas de table par période (plan 1)
  const periode = resolvePeriode(annee);
  const row = table.find((r) => r.periode === periode);
  if (!row) throw new Error(`thermique: période « ${periode} » absente de u-defauts (${type})`);
  return row.u;
}
```

- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `git add src/apps/thermique/lib/refDataResolvers.js scripts/thermique/ref-data-resolvers.test.mjs && git commit -m "feat(thermique): résolveurs période de construction et U par défaut"`

---

### Task 2: Résolveurs — θe de base, coefficient b, commune

**Files:**
- Modify: `src/apps/thermique/lib/refDataResolvers.js`
- Modify: `scripts/thermique/ref-data-resolvers.test.mjs`

- [ ] **Step 1: Tests (ajout au fichier existant)**

```javascript
import { thetaBasePour, coefficientBPour, chercheCommunes } from '../../src/apps/thermique/lib/refDataResolvers.js';
const climat = JSON.parse(readFileSync('src/apps/thermique/data/climat.json', 'utf8'));
const coefB = JSON.parse(readFileSync('src/apps/thermique/data/coefficients-b.json', 'utf8'));

test('thetaBasePour : valeurs plan 1, sans correction d’altitude (Task 9)', () => {
  assert.equal(thetaBasePour(climat, '81', 140).thetaE, -5);
  assert.equal(thetaBasePour(climat, '67', 150).thetaE, -15);
  assert.equal(thetaBasePour(climat, '2A', 50).thetaE, -2);
  assert.equal(thetaBasePour(climat, '81', 140).correctionAltitude, 'non-appliquée'); // avant Task 9
  assert.throws(() => thetaBasePour(climat, '971', 10), /DOM/); // pas de DOM dans climat.json
  assert.throws(() => thetaBasePour(climat, '99', 10), /thermique/);
});

test('coefficientBPour : lit les catégories réelles', () => {
  // valeurs vérifiées plan 1 : Sous-sol sans ouverture 0.5 ; Vide sanitaire 0.5 ; comble isolé 0.7
  assert.equal(coefficientBPour(coefB, 'Sous-sol', 0), 0.5);
  assert.equal(coefficientBPour(coefB, 'Espace sous toiture', 2), 0.7);
  assert.throws(() => coefficientBPour(coefB, 'Grenier', 0), /thermique/);
});

test('chercheCommunes : par nom (insensible accents/casse) + dept', () => {
  const communes = [
    { nom: 'Gaillac', insee: '810099', dept: '81', altitude: 134, dju: 1943 },
    { nom: 'Gaillac-Toulza', insee: '310000', dept: '31', altitude: 300, dju: null },
  ];
  const r = chercheCommunes(communes, 'gaillac');
  assert.equal(r.length, 2);
  assert.equal(chercheCommunes(communes, 'gaillac', '81').length, 1);
});
```

- [ ] **Step 2: Run** → FAIL sur les nouveaux tests

- [ ] **Step 3: Implementation (ajout)**

```javascript
/** θe de base pour un département. Correction d'altitude : branchée en Task 9 (calibration). */
export function thetaBasePour(climat, dept, altitude) {
  if (/^97|^98/.test(dept)) throw new Error(`thermique: départements DOM non couverts par la table climat (${dept})`);
  const tranches = climat.thetaBase[dept];
  if (!tranches) throw new Error(`thermique: département inconnu « ${dept} »`);
  const tr = tranches.find((t) => t.altMax === null || altitude <= t.altMax);
  return { thetaE: tr.thetaE, correctionAltitude: 'non-appliquée' };
}

/** Coefficient b : catégorie de coefficients-b.json + index de la valeur choisie dans l'UI. */
export function coefficientBPour(coefficientsB, categorie, indexValeur) {
  const cat = coefficientsB.categories.find((c) => c.categorie === categorie);
  if (!cat) throw new Error(`thermique: catégorie b inconnue « ${categorie} »`);
  const v = cat.valeurs[indexValeur];
  if (!v) throw new Error(`thermique: valeur b index ${indexValeur} absente (${categorie})`);
  return v.b;
}

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche de communes par préfixe de nom (insensible accents/casse), filtre dept optionnel. */
export function chercheCommunes(communes, saisie, dept = null) {
  const q = norm(saisie.trim());
  if (q.length < 2) return [];
  return communes.filter((c) => norm(c.nom).startsWith(q) && (!dept || c.dept === dept));
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): résolveurs θe, coefficient b, recherche communes"`

---

### Task 3: thermalEngine — U d'une paroi par composition

**Files:**
- Create: `src/apps/thermique/lib/thermalEngine.js`
- Test: `scripts/thermique/thermal-engine.test.mjs`

- [ ] **Step 1: Test** (valeurs calculées à la main, vérifiables : R = Σe/λ)

```javascript
// scripts/thermique/thermal-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculeUParoi, RSI_RSE } from '../../src/apps/thermique/lib/thermalEngine.js';

test('calculeUParoi : mur parpaing + laine de verre + placo', () => {
  // Rsi+Rse mur vertical = 0.13+0.04 = 0.17 (EN ISO 6946)
  // R = 0.20/1.053 (0.18994) + 0.10/0.04 (2.5) + 0.013/0.25 (0.052) = 2.74194
  // U = 1/(0.17+2.74194) = 1/2.91194 = 0.34341
  const u = calculeUParoi([
    { e: 0.20, lambda: 1.053 },
    { e: 0.10, lambda: 0.04 },
    { e: 0.013, lambda: 0.25 },
  ], 'mur');
  assert.ok(Math.abs(u - 0.3434) < 0.0005, `U=${u}`);
});

test('calculeUParoi : résistance R directe acceptée dans une couche (ex. lame d’air R=0.18)', () => {
  // R = 0.18 + 0.10/0.04 = 2.68 ; U = 1/(0.17+2.68) = 0.35088
  const u = calculeUParoi([{ r: 0.18 }, { e: 0.10, lambda: 0.04 }], 'mur');
  assert.ok(Math.abs(u - 0.3509) < 0.0005, `U=${u}`);
});

test('calculeUParoi : Rsi/Rse selon le type de paroi (plancher/plafond ≠ mur)', () => {
  assert.equal(RSI_RSE.mur, 0.17);
  assert.equal(RSI_RSE.plafond, 0.14);   // flux ascendant : 0.10 + 0.04
  assert.equal(RSI_RSE.plancher, 0.21);  // flux descendant : 0.17 + 0.04
});

test('calculeUParoi : erreurs propres', () => {
  assert.throws(() => calculeUParoi([], 'mur'), /thermique/);
  assert.throws(() => calculeUParoi([{ e: 0.2 }], 'mur'), /thermique/);          // ni lambda ni r
  assert.throws(() => calculeUParoi([{ e: 0.2, lambda: 0 }], 'mur'), /thermique/);
  assert.throws(() => calculeUParoi([{ e: 0.2, lambda: 1 }], 'toit'), /thermique/); // type inconnu
});
```

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implementation**

```javascript
// src/apps/thermique/lib/thermalEngine.js
// Moteur de déperditions EN 12831 simplifié — module PUR (aucun import).
// Unités : e en m, lambda en W/(m·K), U en W/(m²·K), surfaces en m², puissances en W, θ en °C.

/** Résistances superficielles Rsi+Rse (EN ISO 6946) par type de flux. */
export const RSI_RSE = { mur: 0.17, plafond: 0.14, plancher: 0.21 };

/**
 * U d'une paroi par composition. Couche = { e, lambda } ou { r } (résistance directe).
 * @param {Array<{e?:number, lambda?:number, r?:number}>} couches
 * @param {'mur'|'plafond'|'plancher'} type — pilote Rsi+Rse
 */
export function calculeUParoi(couches, type) {
  const rsirse = RSI_RSE[type];
  if (rsirse === undefined) throw new Error(`thermique: type de paroi « ${type} » inconnu (mur|plafond|plancher)`);
  if (!Array.isArray(couches) || couches.length === 0) throw new Error('thermique: composition vide');
  let r = rsirse;
  for (const c of couches) {
    if (Number.isFinite(c.r) && c.r > 0) { r += c.r; continue; }
    if (!Number.isFinite(c.e) || !Number.isFinite(c.lambda) || c.e <= 0 || c.lambda <= 0) {
      throw new Error(`thermique: couche invalide ${JSON.stringify(c)} (e>0 et lambda>0, ou r>0)`);
    }
    r += c.e / c.lambda;
  }
  return 1 / r;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): calcul U de paroi par composition (EN ISO 6946)"`

---

### Task 4: thermalEngine — déperditions par transmission d'une pièce

**Files:**
- Modify: `src/apps/thermique/lib/thermalEngine.js`
- Modify: `scripts/thermique/thermal-engine.test.mjs`

- [ ] **Step 1: Tests** (cas de référence calculé à la main)

```javascript
import { transmissionPiece } from '../../src/apps/thermique/lib/thermalEngine.js';

test('transmissionPiece : séjour cas de référence', () => {
  // θint 20, θe −5 → ΔT 25.
  // Mur ext : 10 m² × (0.5 + ΔUtb 0.1) × 1 × 25 = 150 W
  // Fenêtre : 2 m² × (1.3 + 0.1) × 1 × 25 = 70 W
  // Mur sur garage (b=0.5) : 8 m² × (0.5 + 0.1) × 0.5 × 25 = 60 W
  // Mitoyen pièce chauffée même θ : ignoré (0 W)
  // Total = 280 W
  const r = transmissionPiece({
    thetaInt: 20, thetaExt: -5,
    parois: [
      { type: 'mur', surface: 10, u: 0.5, b: 1, deltaUtb: 0.1, poste: 'murs' },
      { type: 'fenetre', surface: 2, u: 1.3, b: 1, deltaUtb: 0.1, poste: 'menuiseries' },
      { type: 'mur', surface: 8, u: 0.5, b: 0.5, deltaUtb: 0.1, poste: 'murs' },
      { type: 'mur', surface: 12, u: 2.0, b: 0, deltaUtb: 0, poste: 'murs' }, // mitoyen même θ : b=0
    ],
  });
  assert.equal(r.total, 280);
  assert.equal(r.parPoste.murs, 210);
  assert.equal(r.parPoste.menuiseries, 70);
});

test('transmissionPiece : ΔT interne entre pièces (consigne différente > 4 K)', () => {
  // Paroi vers pièce à 24 °C depuis pièce à 20 °C : ΔT négatif → gain, compté négatif
  // 5 m² × 2.0 × (20−24) = −40 W (b s'applique pas : θadjacente explicite)
  const r = transmissionPiece({
    thetaInt: 20, thetaExt: -5,
    parois: [{ type: 'mur', surface: 5, u: 2.0, thetaAdjacente: 24, deltaUtb: 0, poste: 'murs' }],
  });
  assert.equal(r.total, -40);
});

test('transmissionPiece : erreurs propres (surface ≤ 0, u ≤ 0, ni b ni thetaAdjacente)', () => {
  const base = { thetaInt: 20, thetaExt: -5 };
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 0, u: 1, b: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: -1, b: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
});
```

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implementation**

```javascript
export const POSTES = ['murs', 'menuiseries', 'plancherBas', 'plafondToiture', 'pontsThermiques', 'ventilation'];

/**
 * Déperditions par transmission d'une pièce : Σ A·(U+ΔUtb)·b·(θint − θréf).
 * Paroi : { surface, u, deltaUtb, poste, b } (θréf = θext) OU { ..., thetaAdjacente } (θréf explicite, b ignoré).
 * ΔUtb = majoration forfaitaire de ponts thermiques en W/(m²·K) (choix org/UI, cf. plan 4) —
 * sa contribution est isolée dans parPoste.pontsThermiques pour la transparence du rapport.
 * @returns {{ total:number, parPoste:Record<string,number> }}
 */
export function transmissionPiece({ thetaInt, thetaExt, parois }) {
  if (!Number.isFinite(thetaInt) || !Number.isFinite(thetaExt)) throw new Error('thermique: θint/θext requis');
  const parPoste = {};
  let total = 0;
  for (const p of parois) {
    if (!Number.isFinite(p.surface) || p.surface <= 0) throw new Error(`thermique: surface invalide (${p.surface})`);
    if (!Number.isFinite(p.u) || p.u <= 0) throw new Error(`thermique: U invalide (${p.u})`);
    if (!Number.isFinite(p.deltaUtb) || p.deltaUtb < 0) throw new Error('thermique: deltaUtb requis (0 accepté)');
    let deltaT;
    if (Number.isFinite(p.thetaAdjacente)) {
      deltaT = thetaInt - p.thetaAdjacente;
    } else if (Number.isFinite(p.b)) {
      deltaT = p.b * (thetaInt - thetaExt);
    } else {
      throw new Error('thermique: paroi sans b ni thetaAdjacente');
    }
    const phiU = p.surface * p.u * deltaT;
    const phiTb = p.surface * p.deltaUtb * deltaT;
    parPoste[p.poste] = (parPoste[p.poste] ?? 0) + phiU;
    if (phiTb !== 0) parPoste.pontsThermiques = (parPoste.pontsThermiques ?? 0) + phiTb;
    total += phiU + phiTb;
  }
  return { total, parPoste };
}
```

Note : le test du cas de référence ci-dessus agrège U et ΔUtb dans `parPoste.murs`/`menuiseries` — **adapter le test à la séparation `pontsThermiques`** : murs = 187.5 (150+60 dont ΔUtb 25+10 → murs porte 125+50=175… ). NON — pour éviter toute ambiguïté : le test attend `parPoste.murs = 175`, `parPoste.menuiseries = 65`, `parPoste.pontsThermiques = 40`, `total = 280`. (125+50 murs, 65 menuiseries, ΔUtb : 25+5+10 = 40.) Recalcul fenêtre : 2×1.3×25 = 65 ; ΔUtb fenêtre 2×0.1×25 = 5. Mur ext 10×0.5×25 = 125 ; ΔUtb 10×0.1×25 = 25. Garage 8×0.5×0.5×25 = 50 ; ΔUtb 8×0.1×0.5×25 = 10. Total 280 ✓.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): déperditions par transmission d'une pièce"`

---

### Task 5: thermalEngine — ventilation et relance

**Files:**
- Modify: `src/apps/thermique/lib/thermalEngine.js` (+ test)

- [ ] **Step 1: Tests**

```javascript
import { debitsParPiece, ventilationPiece, relancePiece } from '../../src/apps/thermique/lib/thermalEngine.js';

test('debitsParPiece : VMC — débit total réparti sur les pièces sèches au prorata du volume', () => {
  // T3 (3 pièces principales) → débit 75 m³/h (table plan 1), hygro facteur 0.75 → 56.25 m³/h
  // Pièces sèches : séjour 60 m³, chambre 30 m³ → séjour 37.5, chambre 18.75. Pièces humides : 0.
  const pieces = [
    { id: 'sejour', volume: 60, humide: false },
    { id: 'ch1', volume: 30, humide: false },
    { id: 'sdb', volume: 12, humide: true },
  ];
  const d = debitsParPiece({ systeme: { id: 'vmc-sf-hygro', mode: 'debits', facteurDebit: 0.75, rendement: 0 },
    debitTotal: 75, pieces });
  assert.equal(d.sejour, 37.5);
  assert.equal(d.ch1, 18.75);
  assert.equal(d.sdb, 0);
});

test('debitsParPiece : naturelle — taux × volume par pièce', () => {
  const pieces = [
    { id: 'sejour', volume: 60, humide: false },
    { id: 'sdb', volume: 12, humide: true },
  ];
  const d = debitsParPiece({ systeme: { id: 'naturelle', mode: 'taux', tauxParPiece: { defaut: 0.5, humide: 1.0 } },
    debitTotal: null, pieces });
  assert.equal(d.sejour, 30);  // 0.5 × 60
  assert.equal(d.sdb, 12);     // 1.0 × 12
});

test('ventilationPiece : ΦV = 0.34 × V̇ × ΔT × (1 − rendement DF)', () => {
  // 37.5 m³/h × 0.34 × 25 = 318.75 W ; avec DF rendement 0.7 → 95.625 W
  assert.equal(ventilationPiece({ debit: 37.5, thetaInt: 20, thetaExt: -5, rendement: 0 }), 318.75);
  assert.equal(ventilationPiece({ debit: 37.5, thetaInt: 20, thetaExt: -5, rendement: 0.7 }), 95.625);
});

test('relancePiece : fRH × surface (0 si désactivée)', () => {
  assert.equal(relancePiece({ surface: 20, fRH: 11 }), 220);
  assert.equal(relancePiece({ surface: 20, fRH: 0 }), 0);
});
```

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implementation**

```javascript
/**
 * Répartition des débits de ventilation par pièce (m³/h).
 * mode 'debits' (VMC) : l'air neuf entre par les pièces sèches → débit total × facteurDebit réparti
 *   au prorata du volume des pièces sèches ; les pièces humides (extraction, air de transfert
 *   déjà à θint) sont à 0 — approche EN 12831 simplifiée assumée (spec §4).
 * mode 'taux' (naturelle) : taux/h × volume, taux humide ≠ sec.
 */
export function debitsParPiece({ systeme, debitTotal, pieces }) {
  const d = {};
  if (systeme.mode === 'taux') {
    for (const p of pieces) d[p.id] = (p.humide ? systeme.tauxParPiece.humide ?? 1.0 : systeme.tauxParPiece.defaut) * p.volume;
    return d;
  }
  if (systeme.mode === 'debits') {
    if (!Number.isFinite(debitTotal) || debitTotal <= 0) throw new Error('thermique: debitTotal requis en mode debits');
    const seches = pieces.filter((p) => !p.humide);
    const volSec = seches.reduce((s, p) => s + p.volume, 0);
    if (volSec <= 0) throw new Error('thermique: aucune pièce sèche pour répartir la ventilation');
    const debitEffectif = debitTotal * (systeme.facteurDebit ?? 1.0);
    for (const p of pieces) d[p.id] = p.humide ? 0 : (debitEffectif * p.volume) / volSec;
    return d;
  }
  throw new Error(`thermique: mode ventilation inconnu « ${systeme.mode} »`);
}

/** ΦV (W) = 0,34 Wh/(m³·K) × V̇ × ΔT × (1 − rendement récupérateur). */
export function ventilationPiece({ debit, thetaInt, thetaExt, rendement = 0 }) {
  if (!Number.isFinite(debit) || debit < 0) throw new Error('thermique: débit invalide');
  return 0.34 * debit * (thetaInt - thetaExt) * (1 - rendement);
}

/** Surpuissance de relance ΦRH (W) = fRH (W/m²) × surface. fRH = choix org/UI (EN 12831 annexe). */
export function relancePiece({ surface, fRH }) {
  if (!Number.isFinite(surface) || surface <= 0) throw new Error('thermique: surface invalide');
  if (!Number.isFinite(fRH) || fRH < 0) throw new Error('thermique: fRH invalide');
  return fRH * surface;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): ventilation par pièce et surpuissance de relance"`

---

### Task 6: thermalEngine — bilan bâtiment complet

**Files:**
- Modify: `src/apps/thermique/lib/thermalEngine.js` (+ test)

- [ ] **Step 1: Tests** — cas maison 2 pièces intégralement calculé à la main dans le test (chiffres posés en commentaire, comme Task 4), vérifiant :

```javascript
import { calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';

test('calculeBatiment : maison 2 pièces — agrégation, postes, ratio, fourchette', () => {
  // Construire un batiment {thetaExt, systemeVentilation, debitTotal, fRH, pieces:[{id, nom, surface,
  // volume, thetaInt, humide, parois:[…]}]} dont CHAQUE composante est recalculée en commentaire.
  // Attendus (à calculer pendant l'écriture du test, PAS de valeurs approximatives) :
  const r = calculeBatiment(batiment);
  assert.equal(r.pieces.length, 2);
  assert.equal(r.pieces[0].total, /* somme transmission+ventilation+relance pièce 1 */);
  assert.equal(r.total, /* somme des pièces */);
  assert.ok(r.parPoste.ventilation > 0);
  assert.equal(Object.values(r.parPoste).reduce((a, b) => a + b, 0), r.total);
  assert.equal(r.ratioWm2, r.total / (surface1 + surface2));
  assert.deepEqual(r.fourchette, { min: Math.round(r.total * 0.95), max: Math.round(r.total * 1.1) });
  assert.equal(r.gv, /* Σ pertes / (θint_pondérée − θe) — W/K, sert au calcul de conso (Task 10) */);
});

test('calculeBatiment : alerte vraisemblance W/m² hors plage', () => {
  // ratios de vraisemblance par période (source : ordres de grandeur métier, ÉDITABLES org plan 4)
  // le moteur reçoit la plage en paramètre : { min: 40, max: 160 } par défaut dans le test
  const r = calculeBatiment({ ...batiment, plageVraisemblance: { min: 200, max: 300 } });
  assert.equal(r.alerteVraisemblance, true);
});
```

(L'implémenteur POSE les chiffres exacts dans le test en calculant chaque terme en commentaire — même discipline que Task 4. La fourchette : −5 %/+10 % assumée, asymétrique côté sécurité, documentée dans le JSDoc.)

- [ ] **Step 2-3: FAIL → Implementation**

```javascript
/**
 * Bilan complet du bâtiment. Entrée : bâtiment résolu (tous U, b, ΔUtb, débits déjà résolus —
 * les résolutions de données se font en amont via refDataResolvers, le moteur reste pur).
 * Sortie : par pièce { id, nom, transmission, ventilation, relance, total, parPoste },
 * totaux { total, parPoste, ratioWm2, gv, fourchette, alerteVraisemblance }.
 * gv (W/K) = total / (θint_moyenne_pondérée_surface − θext) — utilisé par la conso (heatPumpEngine).
 * Fourchette affichée : [−5 % ; +10 %] arrondie au W — assumée (« fiable sans suroptimisation »).
 */
export function calculeBatiment(batiment) { /* … agrégation des fonctions Tasks 4-5 … */ }
```

(Corps : boucle pièces → `transmissionPiece` + `debitsParPiece` (une fois, hors boucle) + `ventilationPiece` + `relancePiece` ; agrégation parPoste ; gv ; fourchette ; alerte si ratio hors `plageVraisemblance` fournie. ~40 lignes.)

- [ ] **Step 4: Run tous les tests thermalEngine** → PASS. **Step 5: Commit** `"feat(thermique): bilan bâtiment complet (agrégation, postes, GV, fourchette)"`

---

### Task 7: heatPumpEngine — COP et P_th d'une PAC (formule hplib exacte)

**Files:**
- Create: `src/apps/thermique/lib/heatPumpEngine.js`
- Test: `scripts/thermique/heat-pump-engine.test.mjs`

- [ ] **Step 1: Tests** — utiliser une VRAIE PAC du catalogue (lue via fs dans le test) + un générique :

```javascript
import { readFileSync } from 'node:fs';
import { copAt, pThAt, pElRefDe } from '../../src/apps/thermique/lib/heatPumpEngine.js';

const catalogue = JSON.parse(readFileSync('src/apps/thermique/data/pac-catalogue.json', 'utf8'));
const reelle = catalogue.pacs.find((p) => !p.generique && p.copRef != null);
const generique = catalogue.pacs.find((p) => p.generique && p.modele.includes('average'));

test('copAt : formule hplib — COP = p1·Tin + p2·Tout + p3 + p4·Tamb (Tamb = Tin en air/eau)', () => {
  const [p1, p2, p3, p4] = reelle.coefCop;
  const attendu = p1 * 7 + p2 * 35 + p3 + p4 * 7;
  assert.equal(copAt(reelle, 7, 35), attendu);
  assert.ok(copAt(reelle, 7, 35) > 2.5 && copAt(reelle, 7, 35) < 7);
});

test('pElRefDe : brut si présent, dérivé pthRef/COP_fitté(−7,52) pour les génériques (comme hplib)', () => {
  assert.equal(pElRefDe(reelle), reelle.pElRef);
  const copFitte = copAt(generique, -7, 52);
  assert.ok(Math.abs(pElRefDe(generique) - generique.pthRef / copFitte) < 1e-9);
});

test('pThAt = pElRef × (p1·Tin + p2·Tout + p3 + p4·Tamb) × COP ; garde-fous', () => {
  const [q1, q2, q3, q4] = reelle.coefPth; // coefPth = coefficients P_el (nommage plan 1 : coefPth ; VÉRIFIER
  // dans _meta.note du catalogue : le plan 1 stocke les p1-p4 de P_el sous coefPth — si le nom réel diffère,
  // adapter ICI et documenter)
  const pEl = reelle.pElRef * (q1 * 7 + q2 * 35 + q3 + q4 * 7);
  assert.ok(Math.abs(pThAt(reelle, 7, 35) - pEl * copAt(reelle, 7, 35)) < 1e-6);
  assert.throws(() => pThAt(reelle, 7, 70), /thermique/);  // Tout hors plage raisonnable [20, 65]
  assert.ok(pThAt(reelle, -15, 35) > 0);
});

test('COP plancher : jamais < 1 (le fit linéaire peut diverger aux extrêmes)', () => {
  assert.ok(copAt(reelle, -25, 55) >= 1);
});
```

⚠ AVANT d'écrire : lire `_meta.note` de `pac-catalogue.json` pour confirmer la sémantique de `coefPth` (le plan 1 y a documenté la formule) — les coefficients stockés sous `coefPth` sont ceux de **P_el** dans le modèle hplib (P_th = P_el × COP). Si l'inspection contredit ça, STOP et remonter au contrôleur.

- [ ] **Step 2-3: FAIL → Implementation**

```javascript
// src/apps/thermique/lib/heatPumpEngine.js
// Modèle de performance PAC (hplib, vérifié plan 1 contre hplib.py) + bivalence + conso. Module PUR.
// ⚠ P_th des modèles « Regulated » = points certifiés EN 14825 en charge partielle adaptée,
// PAS la capacité maximale — voir Task 8 pour l'usage en bivalence.

const TOUT_MIN = 20, TOUT_MAX = 65;

export function copAt(pac, tExt, tDepart) {
  verifTemp(tExt, tDepart);
  const [p1, p2, p3, p4] = pac.coefCop;
  return Math.max(1, p1 * tExt + p2 * tDepart + p3 + p4 * tExt); // Tamb = Tin (air/eau) ; plancher physique 1
}

/** pElRef brut (colonne Keymark) ; génériques (null) : pthRef / COP_fitté(−7,52) comme hplib.get_parameters(). */
export function pElRefDe(pac) {
  if (Number.isFinite(pac.pElRef)) return pac.pElRef;
  return pac.pthRef / copAt(pac, -7, 52);
}

export function pThAt(pac, tExt, tDepart) {
  verifTemp(tExt, tDepart);
  const [p1, p2, p3, p4] = pac.coefPth; // coefficients P_el (cf. _meta.note du catalogue)
  const pEl = pElRefDe(pac) * (p1 * tExt + p2 * tDepart + p3 + p4 * tExt);
  return Math.max(0, pEl * copAt(pac, tExt, tDepart));
}

function verifTemp(tExt, tDepart) {
  if (!Number.isFinite(tExt) || tExt < -30 || tExt > 45) throw new Error(`thermique: tExt hors plage (${tExt})`);
  if (!Number.isFinite(tDepart) || tDepart < TOUT_MIN || tDepart > TOUT_MAX) throw new Error(`thermique: tDépart hors plage (${tDepart})`);
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): modèle de performance PAC (formule hplib, pElRef brut)"`

---

### Task 8: heatPumpEngine — courbe de charge et point de bivalence

**Files:**
- Modify: `src/apps/thermique/lib/heatPumpEngine.js` (+ test)

- [ ] **Step 1: Tests**

```javascript
import { courbeCharge, pointBivalence } from '../../src/apps/thermique/lib/heatPumpEngine.js';

test('courbeCharge : droite entre (θbase, Φtotal) et (θnc, 0)', () => {
  const charge = courbeCharge({ phiTotal: 8000, thetaBase: -5, thetaNC: 16 });
  assert.equal(charge(-5), 8000);
  assert.equal(charge(16), 0);
  assert.ok(Math.abs(charge(5.5) - 4000) < 1e-9); // milieu
  assert.equal(charge(20), 0);                    // au-delà de θnc : 0
  assert.equal(charge(-10), 8000 * (16 - -10) / 21); // extrapolation sous θbase assumée (droite)
});

test('pointBivalence : PAC manuelle à 2 points — cas résoluble à la main', () => {
  // PAC "manuelle" : puissance donnée par points [{tExt, pTh}], interpolation linéaire.
  // Points : (−7, 4000), (7, 8000) → pTh(θ) = 6000 + (θ)·(4000/14) ≈ …
  // Charge : Φ 8000, θbase −5, θnc 16 → charge(θ) = 8000·(16−θ)/21.
  // Intersection : 6000 + θ·285.714 = 8000·(16−θ)/21 → θ ≈ −0.9155 °C (poser le calcul en commentaire).
  const pac = { type: 'manuelle', points: [{ tExt: -7, pTh: 4000 }, { tExt: 7, pTh: 8000 }] };
  const r = pointBivalence({ pac, tDepart: 35, charge: courbeCharge({ phiTotal: 8000, thetaBase: -5, thetaNC: 16 }), thetaBase: -5, thetaNC: 16 });
  assert.ok(Math.abs(r.thetaBivalence - (-0.9155)) < 0.01, `θbiv=${r.thetaBivalence}`);
  assert.ok(Math.abs(r.appointNecessaire - (8000 - (6000 - 5 * 285.7142857))) < 1);   // charge(θbase) − pTh(θbase)
  assert.equal(r.avertissementChargePartielle, false); // PAC manuelle = points constructeur, pas hplib
});

test('pointBivalence : PAC hplib → avertissement charge partielle + bornes', () => {
  const catalogue = JSON.parse(readFileSync('src/apps/thermique/data/pac-catalogue.json', 'utf8'));
  const pac = catalogue.pacs.find((p) => !p.generique && p.copRef != null);
  const charge = courbeCharge({ phiTotal: 6000, thetaBase: -5, thetaNC: 16 });
  const r = pointBivalence({ pac, tDepart: 35, charge, thetaBase: -5, thetaNC: 16 });
  assert.equal(r.avertissementChargePartielle, true); // P_th hplib = EN 14825 charge partielle, pas capacité max
  assert.ok(r.thetaBivalence >= -5 - 1e-9 && r.thetaBivalence <= 16 + 1e-9);
  assert.ok(r.tauxCouverture > 0 && r.tauxCouverture <= 1);
});

test('pointBivalence : PAC toujours au-dessus de la charge → bivalence = θbase, appoint 0', () => {
  const pac = { type: 'manuelle', points: [{ tExt: -15, pTh: 20000 }, { tExt: 15, pTh: 30000 }] };
  const charge = courbeCharge({ phiTotal: 5000, thetaBase: -5, thetaNC: 16 });
  const r = pointBivalence({ pac, tDepart: 35, charge, thetaBase: -5, thetaNC: 16 });
  assert.equal(r.thetaBivalence, -5);
  assert.equal(r.appointNecessaire, 0);
});
```

- [ ] **Step 2-3: FAIL → Implementation**

```javascript
/** Courbe de charge : droite (θbase, Φtotal)→(θnc, 0), 0 au-delà de θnc, prolongée sous θbase. */
export function courbeCharge({ phiTotal, thetaBase, thetaNC }) {
  if (thetaNC <= thetaBase) throw new Error('thermique: θnc doit être > θbase');
  return (theta) => Math.max(0, (phiTotal * (thetaNC - theta)) / (thetaNC - thetaBase));
}

/** P_th d'une PAC « manuelle » (points constructeur) par interpolation linéaire, extrapolation bornée aux extrêmes. */
function pThManuelle(points, tExt) { /* tri par tExt, interpolation, clamp aux points extrêmes — ~10 lignes */ }

/**
 * Point de bivalence : θ où P_th(θ) croise la charge (bisection sur [θbase, θnc], tolérance 1 W).
 * Retour : { thetaBivalence, appointNecessaire (W à θbase), tauxCouverture (fraction énergétique
 * couverte par la PAC — intégration trapèzes de min(charge, pTh)/charge pondérée par la charge,
 * distribution de θ UNIFORME entre θbase et θnc, simplification assumée documentée),
 * avertissementChargePartielle (true si PAC hplib : P_th = points EN 14825 charge partielle,
 * l'UI doit afficher la mention — false si points constructeur manuels) }.
 */
export function pointBivalence({ pac, tDepart, charge, thetaBase, thetaNC }) { /* … */ }
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): courbe de charge et point de bivalence"`

---

### Task 9: Correction d'altitude de θe — calibration contre le logiciel historique

La règle est codée en dur dans `Thermique.exe` (constat plan 1 : Amanzé, alt. 350 m, dép. 71 : θe −10 → corrigée −11). **Aucune valeur inventée** : la règle sera déduite de points de mesure relevés dans le logiciel, ou à défaut la correction reste débranchée.

**Files:**
- Modify: `src/apps/thermique/lib/refDataResolvers.js` (+ test)
- Create: `docs/thermique-calibration-altitude.md` (protocole + relevés)

- [ ] **Step 1: Constituer le jeu de points.** Demander au contrôleur (qui relaiera à Eric si besoin) **8-12 relevés** depuis `C:\Thermique\Thermique.exe` ou `C:\Thermique2` : pour des communes d'altitudes étagées (~0, 200, 400, 600, 800, 1000 m…) dans 2-3 départements différents, noter (commune, département, altitude affichée, θe base, θe corrigée). Le point Amanzé (350 m, −10 → −11) fait déjà partie du jeu. Consigner le tableau dans `docs/thermique-calibration-altitude.md`. **Ce step est BLOQUANT-UTILISATEUR : reporter NEEDS_CONTEXT au contrôleur avec le protocole précis, ne pas deviner.**
- [ ] **Step 2:** Déduire la règle (attendue de la forme : −1 K par tranche de N m au-delà d'un seuil, N à déterminer — vérifier l'hypothèse sur TOUS les points, l'écart max toléré est 0 K : la règle historique est exacte ou n'est pas retenue).
- [ ] **Step 3:** Test : chaque relevé devient une assertion `thetaBasePour(climat, dept, altitude).thetaE === corrigée_relevée`.
- [ ] **Step 4:** Implémenter dans `thetaBasePour` (le champ `correctionAltitude` passe de `'non-appliquée'` à `'calibrée-legacy'`), documenter la règle + provenance dans le JSDoc et le doc de calibration.
- [ ] **Step 5:** Si les relevés sont indisponibles (logiciel cassé, Eric indisponible) : laisser `'non-appliquée'`, documenter dans le doc de calibration, et **le signaler comme risque connu** dans le rapport final — la v1 affichera θe départemental brut avec l'altitude en information. Commit `"feat(thermique): correction d'altitude θe calibrée sur le logiciel historique"` (ou `docs:` si non calibrée).

---

### Task 10: heatPumpEngine — consommation annuelle et coût

**Files:**
- Modify: `src/apps/thermique/lib/heatPumpEngine.js` (+ test)
- Modify: `scripts/thermique/convert-communes.mjs`? NON — les heures de chauffage annuelles sont dans `Base de données - Coordonnées des départements.txt` (colonne « Chauf/an », constat plan 1 Task 4). Modify: le convertisseur qui produit `climat.json`… `climat.json` est écrit à la main (Task 4 plan 1). → Create: `scripts/thermique/extract-heures-chauffage.mjs` (petit script one-shot qui lit la colonne « Chauf/an » du fichier départements et REGÉNÈRE la clé `heuresChauffage` dans `climat.json` en préservant le reste du fichier), + test d'ancres (81, 67, 06 relus dans la source).

- [ ] **Step 1: Enrichir climat.json** avec `heuresChauffage` par département (script + ancres re-lues dans la source, même discipline que plan 1 Task 4). Commit séparé : `"feat(thermique): heures de chauffage annuelles par département (source base départements)"`.

- [ ] **Step 2: Tests conso**

```javascript
import { consoAnnuelle } from '../../src/apps/thermique/lib/heatPumpEngine.js';

test('consoAnnuelle : méthode DJU, cas posé à la main', () => {
  // besoin = 24 h × DJU × GV / 1000 (kWh) — GV en W/K, DJU base 18 (source communes.json).
  // GV = 320 W/K, DJU = 1943 (Gaillac) → besoin = 24 × 1943 × 320 / 1000 = 14 922.24 kWh.
  // θext_moyenne_saison = 18 − (DJU × 24 / heuresChauffage) ; heuresChauffage dép. 81 lu dans climat.json.
  // COP saisonnier estimé = copAt(pac, θext_moyenne_saison, tDepart).
  // consoElec = besoin / COP ; coût = consoElec × prixKwh.
  // PAC manuelle-like pour la déterminisme du test : utiliser un pac réel du catalogue et recalculer
  // l'attendu avec copAt exporté (pas de constante magique dans l'assertion).
  const r = consoAnnuelle({ gv: 320, dju: 1943, heuresChauffage: h81, pac, tDepart: 35, prixKwh: 0.1952, facteurAjustement: 1.0 });
  assert.ok(Math.abs(r.besoinKwh - 14922.24) < 0.01);
  assert.ok(Math.abs(r.consoElecKwh - r.besoinKwh / copAt(pac, r.thetaExtMoyenne, 35)) < 0.01);
  assert.ok(Math.abs(r.coutEuros - r.consoElecKwh * 0.1952) < 0.01);
  assert.deepEqual(Object.keys(r).sort(), ['besoinKwh', 'consoElecKwh', 'coutEuros', 'fourchette', 'thetaExtMoyenne']);
});

test('consoAnnuelle : DJU null → erreur propre demandant le fallback départemental', () => {
  assert.throws(() => consoAnnuelle({ gv: 320, dju: null, /* … */ }), /DJU/);
});

test('consoAnnuelle : facteurAjustement (apports gratuits/intermittence) multiplie le besoin', () => {
  // défaut 1.0 ; org pourra régler (plan 4). 0.85 → besoin × 0.85.
});
```

- [ ] **Step 3: Implementation**

```javascript
/**
 * Consommation annuelle — méthode degrés-jours, simplification assumée (spec : pas de suroptimisation) :
 * besoin (kWh) = 24 × DJU × GV / 1000 × facteurAjustement
 * θext_moyenne_saison = 18 − (DJU × 24 / heuresChauffage)   [base DJU 18, heures : base départements]
 * COP saisonnier ≈ COP(θext_moyenne_saison, tDépart)         [pas de SCOP EN 14825 complet en v1]
 * fourchette : ±15 % (plus large que les déperditions — l'estimation de conso cumule les hypothèses).
 * facteurAjustement (défaut 1.0) : apports gratuits/intermittence, éditable org (plan 4), à calibrer
 * contre le logiciel historique en Task 11 si celui-ci fournit une conso comparable.
 */
export function consoAnnuelle({ gv, dju, heuresChauffage, pac, tDepart, prixKwh, facteurAjustement = 1.0 }) { /* … */ }
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): consommation annuelle (méthode DJU) et coût"`

---

### Task 11: Validation croisée contre le logiciel historique

**Files:**
- Create: `docs/thermique-validation.md`
- Create: `scripts/thermique/validation-croisee.test.mjs` (cas encodés une fois validés)

- [ ] **Step 1:** Tenter de parser `C:\Thermique\Dossiers\232477 - Fichier exemple - Déperditions.dep` (+ `.Pc1`) : inspecter le format (dump texte quoté du plan 1 — chercher les lignes de résultats : puissances par pièce/totaux). Si les résultats du logiciel y sont lisibles → les extraire comme référence. Sinon :
- [ ] **Step 2:** **NEEDS_CONTEXT au contrôleur** avec la liste précise de ce qu'il faut relever dans le logiciel (Eric ouvre le fichier exemple : puissance totale, puissance par pièce, θe retenue, détail transmission/ventilation si affiché).
- [ ] **Step 3:** Ressaisir le cas exemple comme entrée `calculeBatiment` (les U/surfaces/pièces sont dans le `.dep`/`.Pc1` ou relevés), PLUS 2 cas simples construits (pièce unique tout paramétré ; maison 4 pièces type) calculés dans les deux outils.
- [ ] **Step 4:** Comparer pièce par pièce et au total ; consigner dans `docs/thermique-validation.md` : tableau écarts, hypothèses divergentes identifiées (relance, PT forfaitaires, arrondis, correction altitude), verdict ±5 %.
- [ ] **Step 5:** Encoder les cas validés en tests de non-régression (`validation-croisee.test.mjs`) avec les valeurs de référence du logiciel en dur + tolérance 5 %. Si l'écart dépasse 5 % : STOP, analyse de la divergence avec le contrôleur AVANT tout ajustement du moteur (on n'ajuste pas des constantes pour « faire passer » sans comprendre).
- [ ] **Step 6:** Commit `"test(thermique): validation croisée contre le logiciel historique (±5 %)"`.

---

## Self-review (fait à la rédaction)

- **Couverture spec §4-§5** : U composition ✅(T3) · transmission b/ΔUtb/mitoyens ✅(T4) · ventilation par système ✅(T5) · relance ✅(T5) · bilan/postes/W/m²/fourchette/GV ✅(T6) · défauts par période ✅(T1) · θe/altitude ✅(T2+T9 calibration) · COP/P_th hplib + manuelle ✅(T7-T8) · bivalence/appoint/couverture ✅(T8) · conso/coût ✅(T10) · validation ±5 % ✅(T11). **Émetteurs à 35/45/55 °C (loi d'émission, spec §4)** : reporté au plan 4 (écran résultats) — la puissance par pièce (T6) suffit comme socle ; noté comme écart assumé.
- **Placeholders** : T6/T8/T10 contiennent des corps `/* … */` avec sortie et algorithme spécifiés en JSDoc + tests complets qui contraignent l'implémentation ; les valeurs attendues des tests T6 sont à poser par l'implémenteur avec calcul en commentaire (discipline établie aux T3-T4 avec exemples complets). Assumé pour tenir la taille du plan.
- **Cohérence de types** : `pac.coefPth`/`coefCop`/`pElRef`/`copRef`/`generique` = schéma réel du plan 1 ; `charge` = fonction θ→W passée à `pointBivalence` ; `gv` produit par T6 et consommé par T10.
- **Deux points utilisateur-bloquants identifiés et assumés** : T9 (relevés altitude) et T11 (relevés logiciel) — les deux ont un protocole précis et un chemin de repli documenté.
