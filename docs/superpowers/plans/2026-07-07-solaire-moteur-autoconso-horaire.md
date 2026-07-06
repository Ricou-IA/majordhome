# Moteur horaire d'autoconsommation + dimensionnement batterie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire un moteur PUR (testable `node --test`) qui reconstruit la courbe de charge horaire d'un foyer (talon Enedis + usages déclarés, calée sur 12 conso mensuelles), calcule l'autoconsommation au pas horaire contre une production PVGIS horaire, et dimensionne une batterie tampon par simulation 8760 h.

**Architecture :** Nouveau module pur `src/apps/solaire/lib/autoconsoEngine.js` (aucun import React/Supabase, comme `pvEngine.js`). Il opère sur des tableaux horaires (8760). La conso est modélisée en **décomposition d'usages** : un talon (forme Enedis normalisée) réconcilié sur 12 ancres mensuelles + N « devices » pilotables déclarés (VE, piscine…) répartis sur une forme heure-de-journée × mois. L'autoconso instantanée = `Σ min(prod(t), conso(t))` ; la batterie ajoute la part de surplus stockée puis restituée. **Règle absolue héritée : le surplus n'est JAMAIS valorisé en €** — on ne valorise que l'import évité.

**Tech Stack :** JavaScript ESM pur, `node:test` + `node:assert/strict` (harnais identique à `scripts/pv-engine.test.mjs`). Données externes (spike) : Enedis Open Data `conso-inf36` (API Explore v2.1) + PVGIS v5.2 `seriescalc`.

**Hors périmètre (plans dédiés ultérieurs) :**
- Edge `pvgis-proxy` étendue à `seriescalc` (série horaire) + client `pvgis.js`.
- Formulaire foyer (usages, budgets kWh, fenêtres VE/piscine) dans le wizard solaire.
- Portage du Sankey de bilan en primitives `@react-pdf/renderer` (d3-sankey = calcul only).
- Branchement dans `etudeModel.js` (source de calcul unique UI ↔ PDF).

---

## File Structure

- **Create** `src/apps/solaire/lib/autoconsoEngine.js` — moteur horaire pur (calendrier, autoconso, reconstruction de charge, batterie). Une seule responsabilité : les calculs 8760. Ne touche pas `pvEngine.js` (mensuel, inchangé).
- **Create** `scripts/autoconso-engine.test.mjs` — tests natifs Node du module ci-dessus.
- **Create** `docs/superpowers/spikes/2026-07-07-enedis-pvgis-hourly.md` — restitution du spike données (colonnes exactes, shape, URLs figées).
- **Create** `scripts/fixtures/enedis-res-base-normalized.json` — profil talon Enedis normalisé (8760 valeurs, Σ=1), produit par le spike. Fixture d'intégration (les tests unitaires n'en dépendent PAS).

> Découplage volontaire : les tests unitaires du moteur utilisent des tableaux jouets (valeurs calculées à la main) et ne dépendent pas des fixtures réelles. La Phase 1 peut donc avancer même si le spike (Phase 0) est différé.

---

## Phase 0 — De-risquer les données (spike)

### Task 1: Spike données Enedis + PVGIS horaires

**Files:**
- Create: `docs/superpowers/spikes/2026-07-07-enedis-pvgis-hourly.md`
- Create: `scripts/fixtures/enedis-res-base-normalized.json`

> Tâche exploratoire (pas de TDD). Objectif : figer la forme exacte des deux sources avant de câbler quoi que ce soit, et produire une fixture réelle réutilisable.

- [ ] **Step 1: Interroger l'API Enedis `conso-inf36` et documenter les colonnes**

Run:
```bash
curl -s "https://data.enedis.fr/api/explore/v2.1/catalog/datasets/conso-inf36/records?limit=5" | head -c 4000
```
À consigner dans le `.md` du spike : nom exact des champs (profil, plage de puissance souscrite, horodatage 1/2 h, valeur de conso), la ou les valeurs du champ « profil » réellement présentes (RES1 / RES2 / …), la maille (nationale/régionale), et si l'agrégat est en énergie (kWh) ou en puissance moyenne. Noter si un filtre `where=profil='...'` est supporté.

- [ ] **Step 2: Récupérer une courbe de charge segmentée et la normaliser en profil talon 8760**

Depuis les enregistrements demi-horaires du profil résidentiel de base sur une année pleine, agréger en 8760 pas horaires (2 pas ½ h → 1 h), puis diviser par la somme annuelle pour obtenir une forme normalisée (Σ=1). Écrire le résultat dans `scripts/fixtures/enedis-res-base-normalized.json` sous la forme `{ "source": "...", "profil": "...", "annee": 2024, "hourly": [ ...8760 nombres... ] }`. Consigner dans le `.md` la méthode d'agrégation ½ h→h et la période retenue.

- [ ] **Step 3: Valider l'endpoint PVGIS `seriescalc` et documenter sa réponse**

Run:
```bash
curl -s "https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?lat=43.90&lon=1.90&startyear=2020&endyear=2020&pvcalculation=1&peakpower=1&loss=14&angle=30&aspect=0&outputformat=json" | head -c 3000
```
Consigner : chemin exact de la série horaire dans le JSON (`outputs.hourly[]`), le nom du champ puissance (`P`, en W pour `peakpower=1` kWc), l'horodatage (`time` format `YYYYMMDD:HHMM`), le nombre de pas (8760 attendu pour une année), et la correspondance avec le calendrier non bissextile utilisé par le moteur.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/spikes/2026-07-07-enedis-pvgis-hourly.md scripts/fixtures/enedis-res-base-normalized.json
git commit -m "spike(solaire): shape Enedis conso-inf36 + PVGIS seriescalc + fixture talon normalisé"
```

---

## Phase 1 — Moteur horaire pur (TDD)

### Task 2: Calendrier horaire + constantes

**Files:**
- Create: `src/apps/solaire/lib/autoconsoEngine.js`
- Test: `scripts/autoconso-engine.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/autoconso-engine.test.mjs
// Tests du moteur horaire d'autoconsommation (src/apps/solaire/lib/autoconsoEngine.js).
// Run : node --test scripts/autoconso-engine.test.mjs
// RÈGLE : le surplus n'est JAMAIS valorisé en € (comme pvEngine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOURS_PER_YEAR, hourToDate } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('hourToDate — bornes mois / heure de journée (année 365 j)', () => {
  assert.equal(HOURS_PER_YEAR, 8760);
  assert.deepEqual(hourToDate(0), { month: 0, hourOfDay: 0, dayOfYear: 0 });
  assert.deepEqual(hourToDate(23), { month: 0, hourOfDay: 23, dayOfYear: 0 });
  assert.deepEqual(hourToDate(744), { month: 1, hourOfDay: 0, dayOfYear: 31 }); // 1er févr. (31×24)
  assert.deepEqual(hourToDate(8759), { month: 11, hourOfDay: 23, dayOfYear: 364 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: FAIL — `Cannot find module '.../autoconsoEngine.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/apps/solaire/lib/autoconsoEngine.js
// Moteur horaire d'autoconsommation — PUR : aucun import (testable via node --test).
// Modèle : talon (forme Enedis) réconcilié sur 12 ancres mensuelles + usages
// déclarés (VE, piscine…). Autoconso instantanée = Σ min(prod, conso).
// RÈGLE ABSOLUE : le surplus n'est JAMAIS valorisé en € — on valorise l'import évité.

/** Nombre d'heures dans l'année de référence (non bissextile, 365 j). */
export const HOURS_PER_YEAR = 8760;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 365 j
const MONTH_START_HOUR = (() => {
  const starts = [];
  let acc = 0;
  for (let m = 0; m < 12; m++) { starts.push(acc); acc += DAYS_IN_MONTH[m] * 24; }
  return starts;
})();

/** Heure de l'année [0, 8759] → { month:0-11, hourOfDay:0-23, dayOfYear:0-364 }. */
export function hourToDate(h) {
  const hourOfDay = ((h % 24) + 24) % 24;
  const dayOfYear = Math.floor(h / 24);
  let month = 11;
  for (let m = 0; m < 12; m++) {
    if (h < MONTH_START_HOUR[m] + DAYS_IN_MONTH[m] * 24) { month = m; break; }
  }
  return { month, hourOfDay, dayOfYear };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/autoconsoEngine.js scripts/autoconso-engine.test.mjs
git commit -m "feat(solaire): calendrier horaire du moteur d'autoconsommation"
```

---

### Task 3: Autoconsommation instantanée (sans batterie)

**Files:**
- Modify: `src/apps/solaire/lib/autoconsoEngine.js`
- Test: `scripts/autoconso-engine.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import en tête de fichier : computeSelfConsumption
import { HOURS_PER_YEAR, hourToDate, computeSelfConsumption } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('computeSelfConsumption — Σ min(prod, conso), export, import', () => {
  const prod  = [0, 2, 4, 0];
  const conso = [1, 1, 1, 3];
  const r = computeSelfConsumption({ prodHourly: prod, consoHourly: conso });
  assert.equal(r.prodKwh, 6);
  assert.equal(r.consoKwh, 6);
  assert.equal(r.selfConsumedKwh, 2);   // 0 + 1 + 1 + 0
  assert.equal(r.exportedKwh, 4);       // (2-1) + (4-1)
  assert.equal(r.importedKwh, 4);       // (1-0) + (3-0)
  assert.ok(Math.abs(r.autoconsoRate - 2 / 6) < 1e-9);
  assert.ok(Math.abs(r.autoproductionRate - 2 / 6) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: FAIL — `computeSelfConsumption is not a function` / import non résolu

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Autoconsommation instantanée d'une production contre une consommation, au même
 * pas de temps. selfConsumed = Σ min(prod, conso) ; export = Σ max(prod-conso, 0) ;
 * import = Σ max(conso-prod, 0). Le surplus (export) n'est jamais valorisé en €.
 */
export function computeSelfConsumption({ prodHourly, consoHourly }) {
  if (prodHourly.length !== consoHourly.length) {
    throw new Error('computeSelfConsumption : longueurs prod/conso différentes');
  }
  let selfC = 0, exp = 0, imp = 0, prod = 0, conso = 0;
  for (let i = 0; i < prodHourly.length; i++) {
    const p = prodHourly[i];
    const c = consoHourly[i];
    prod += p; conso += c;
    selfC += Math.min(p, c);
    if (p > c) exp += p - c; else imp += c - p;
  }
  return {
    prodKwh: prod,
    consoKwh: conso,
    selfConsumedKwh: selfC,
    exportedKwh: exp,
    importedKwh: imp,
    autoconsoRate: prod > 0 ? selfC / prod : 0,
    autoproductionRate: conso > 0 ? selfC / conso : 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/autoconsoEngine.js scripts/autoconso-engine.test.mjs
git commit -m "feat(solaire): autoconsommation instantanée horaire (sans batterie)"
```

---

### Task 4: Répartition d'un usage pilotable (device)

**Files:**
- Modify: `src/apps/solaire/lib/autoconsoEngine.js`
- Test: `scripts/autoconso-engine.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : distributeDeviceLoad
test('distributeDeviceLoad — VE nuit : énergie annuelle conservée, jour à zéro', () => {
  const hourOfDayWeights = Array.from({ length: 24 }, (_, h) => (h < 6 ? 1 : 0)); // 0h-5h
  const monthWeights = Array(12).fill(1);
  const curve = distributeDeviceLoad({ annualKwh: 3650, hourOfDayWeights, monthWeights });
  assert.equal(curve.length, 8760);
  const sum = curve.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 3650) < 1e-6);            // énergie conservée
  // une heure de nuit (h=2) est chargée, une heure de jour (h=12) est nulle
  assert.ok(curve[2] > 0);
  assert.equal(curve[12], 0);
  // poids nuls → tableau de zéros
  const zero = distributeDeviceLoad({ annualKwh: 1000, hourOfDayWeights: Array(24).fill(0), monthWeights });
  assert.equal(zero.reduce((a, b) => a + b, 0), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: FAIL — `distributeDeviceLoad is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Répartit l'énergie annuelle d'un usage pilotable (VE, piscine…) sur 8760 h
 * selon une forme déclarée : poids par heure-de-journée (24) × poids par mois (12).
 * Les poids n'ont pas à être normalisés — la fonction renormalise pour que
 * Σ = annualKwh. Aucun poids actif (Σ = 0) ou annualKwh ≤ 0 → tableau de zéros.
 */
export function distributeDeviceLoad({ annualKwh, hourOfDayWeights, monthWeights }) {
  const out = new Array(HOURS_PER_YEAR).fill(0);
  let totalWeight = 0;
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const { month, hourOfDay } = hourToDate(h);
    totalWeight += hourOfDayWeights[hourOfDay] * monthWeights[month];
  }
  if (totalWeight <= 0 || annualKwh <= 0) return out;
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const { month, hourOfDay } = hourToDate(h);
    const w = hourOfDayWeights[hourOfDay] * monthWeights[month];
    out[h] = annualKwh * (w / totalWeight);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/autoconsoEngine.js scripts/autoconso-engine.test.mjs
git commit -m "feat(solaire): répartition horaire d'un usage pilotable déclaré (VE/piscine)"
```

---

### Task 5: Réconciliation sur 12 ancres mensuelles

**Files:**
- Modify: `src/apps/solaire/lib/autoconsoEngine.js`
- Test: `scripts/autoconso-engine.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : reconcileMonthly
test('reconcileMonthly — chaque mois calé sur sa cible', () => {
  const shape = new Array(8760).fill(1); // forme plate
  // cible = 2 kWh par heure du mois → target[m] = heures_du_mois × 2
  const HOURS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((d) => d * 24);
  const targets = HOURS_IN_MONTH.map((h) => h * 2);
  const out = reconcileMonthly({ hourlyShape: shape, monthlyTargets: targets });
  assert.ok(Math.abs(out[0] - 2) < 1e-9);      // janvier : plat → 2/h
  assert.ok(Math.abs(out[8000] - 2) < 1e-9);   // décembre : idem
  // somme du mois de janvier = cible de janvier
  const janSum = out.slice(0, HOURS_IN_MONTH[0]).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(janSum - targets[0]) < 1e-6);
});

test('reconcileMonthly — mois de forme nulle mais cible > 0 → répartition uniforme', () => {
  const shape = new Array(8760).fill(0);
  const targets = Array(12).fill(0);
  targets[0] = 744; // janvier = 744 h → 1/h attendu
  const out = reconcileMonthly({ hourlyShape: shape, monthlyTargets: targets });
  assert.ok(Math.abs(out[0] - 1) < 1e-9);
  assert.equal(out[8000], 0); // décembre cible 0 → 0
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: FAIL — `reconcileMonthly is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Cale une forme horaire sur 12 cibles mensuelles : chaque mois est mis à
 * l'échelle pour que la somme de ses heures = monthlyTargets[m]. Un mois dont la
 * forme somme 0 mais dont la cible > 0 → répartition uniforme sur ses heures
 * (évite de perdre l'énergie du mois quand la forme est muette).
 */
export function reconcileMonthly({ hourlyShape, monthlyTargets }) {
  const out = new Array(hourlyShape.length).fill(0);
  const sumByMonth = new Array(12).fill(0);
  const countByMonth = new Array(12).fill(0);
  for (let h = 0; h < hourlyShape.length; h++) {
    const { month } = hourToDate(h);
    sumByMonth[month] += hourlyShape[h];
    countByMonth[month] += 1;
  }
  for (let h = 0; h < hourlyShape.length; h++) {
    const { month } = hourToDate(h);
    const target = monthlyTargets[month] ?? 0;
    if (sumByMonth[month] > 0) out[h] = hourlyShape[h] * (target / sumByMonth[month]);
    else if (countByMonth[month] > 0) out[h] = target / countByMonth[month];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/autoconsoEngine.js scripts/autoconso-engine.test.mjs
git commit -m "feat(solaire): réconciliation de la forme horaire sur 12 ancres mensuelles"
```

---

### Task 6: Reconstruction complète de la courbe de charge

**Files:**
- Modify: `src/apps/solaire/lib/autoconsoEngine.js`
- Test: `scripts/autoconso-engine.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : buildLoadCurve
test('buildLoadCurve — talon + device, énergie totale et ancres mensuelles respectées', () => {
  const monthlyConsoTotals = Array(12).fill(1000);          // 12 000 kWh/an
  const baseShape = new Array(8760).fill(1);                // talon plat
  const hourOfDayWeights = Array.from({ length: 24 }, (_, h) => (h < 6 ? 1 : 0));
  const devices = [{ name: 've', annualKwh: 2400, hourOfDayWeights, monthWeights: Array(12).fill(1) }];
  const { hourly, byDevice, residualMonthly, warnings } = buildLoadCurve({ monthlyConsoTotals, baseShape, devices });

  assert.equal(hourly.length, 8760);
  assert.equal(warnings.length, 0);
  const total = hourly.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 12000) < 1e-3);                // conso totale conservée
  // somme de janvier ≈ ancre de janvier (1000)
  const janSum = hourly.slice(0, 31 * 24).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(janSum - 1000) < 1e-3);
  // le device VE représente 2400 kWh, exposé séparément
  assert.ok(Math.abs(byDevice.ve.reduce((a, b) => a + b, 0) - 2400) < 1e-6);
  // résidu mensuel = total − énergie VE du mois. Le VE est réparti à l'heure sur
  // les heures de nuit : janvier (31 j × 6 h = 186 h actives sur 2190 h/an)
  // porte 2400 × 186/2190 kWh, PAS 200 (les mois n'ont pas le même nb de jours).
  const janVE = 2400 * (31 * 6) / (365 * 6);
  assert.ok(Math.abs(residualMonthly[0] - (1000 - janVE)) < 1e-6);
  // résidu annuel total = conso totale − VE total
  assert.ok(Math.abs(residualMonthly.reduce((a, b) => a + b, 0) - (12000 - 2400)) < 1e-6);
});

test('buildLoadCurve — usages > conso du mois → warning + talon ramené à 0', () => {
  const monthlyConsoTotals = Array(12).fill(100);
  const baseShape = new Array(8760).fill(1);
  const devices = [{ name: 've', annualKwh: 6000, hourOfDayWeights: Array(24).fill(1), monthWeights: Array(12).fill(1) }];
  const { residualMonthly, warnings } = buildLoadCurve({ monthlyConsoTotals, baseShape, devices });
  assert.ok(warnings.length >= 1);
  assert.equal(residualMonthly[0], 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: FAIL — `buildLoadCurve is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Reconstruit la courbe de charge horaire (8760) du foyer :
 * budget par usage (devices) réparti sur sa forme déclarée, puis RÉSIDU (talon) =
 * conso mensuelle − usages du mois, distribué par la forme Enedis normalisée et
 * calé sur les 12 ancres. On soustrait les usages AVANT de caler le talon pour
 * éviter le double comptage (l'archétype Enedis contient déjà un « foyer moyen »).
 * - monthlyConsoTotals[12] : conso totale du foyer par mois (les 12 ancres).
 * - baseShape[8760] : forme normalisée du talon (profil Enedis, poids relatifs).
 * - devices[] : [{ name, annualKwh, hourOfDayWeights[24], monthWeights[12] }].
 * Renvoie { hourly, byDevice, residualMonthly, warnings }.
 */
export function buildLoadCurve({ monthlyConsoTotals, baseShape, devices = [] }) {
  const warnings = [];
  const deviceCurves = devices.map((d) => ({ name: d.name, curve: distributeDeviceLoad(d) }));

  // énergie des usages par mois
  const deviceByMonth = new Array(12).fill(0);
  for (const { curve } of deviceCurves) {
    for (let h = 0; h < curve.length; h++) deviceByMonth[hourToDate(h).month] += curve[h];
  }

  // cible résiduelle mensuelle = conso totale du mois − usages du mois (bornée ≥ 0)
  const residualMonthly = monthlyConsoTotals.map((total, m) => {
    const r = total - deviceByMonth[m];
    if (r < 0) {
      warnings.push(
        `Mois ${m + 1} : usages déclarés (${deviceByMonth[m].toFixed(0)} kWh) dépassent la conso totale (${total.toFixed(0)} kWh) — talon ramené à 0.`
      );
      return 0;
    }
    return r;
  });

  const residualCurve = reconcileMonthly({ hourlyShape: baseShape, monthlyTargets: residualMonthly });

  const hourly = new Array(baseShape.length).fill(0);
  for (let h = 0; h < hourly.length; h++) {
    let v = residualCurve[h];
    for (const { curve } of deviceCurves) v += curve[h];
    hourly[h] = v;
  }

  const byDevice = Object.fromEntries(deviceCurves.map(({ name, curve }) => [name, curve]));
  return { hourly, byDevice, residualMonthly, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/autoconsoEngine.js scripts/autoconso-engine.test.mjs
git commit -m "feat(solaire): reconstruction de la courbe de charge (talon Enedis + usages, ancres mensuelles)"
```

---

### Task 7: Simulation batterie tampon (8760 h)

**Files:**
- Modify: `src/apps/solaire/lib/autoconsoEngine.js`
- Test: `scripts/autoconso-engine.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : simulateBattery
test('simulateBattery — capacité 0 ≡ autoconso directe', () => {
  const prod  = [0, 2, 4, 0];
  const conso = [1, 1, 1, 3];
  const r = simulateBattery({ prodHourly: prod, consoHourly: conso, capacityKwh: 0 });
  assert.equal(r.selfConsumedKwh, 2);
  assert.equal(r.exportedKwh, 4);
  assert.equal(r.importedKwh, 4);
  assert.equal(r.selfConsumedFromBatteryKwh, 0);
});

test('simulateBattery — rendement 100 % : le tampon récupère tout le surplus utile', () => {
  // Surplus PLACÉ AVANT les déficits : la simulation est linéaire (pas de report
  // cyclique fin d'année→début), donc un déficit initial sur batterie vide (soc=0)
  // est irrécupérable. Fixture réordonné vs 1re rédaction (bug arithmétique corrigé).
  const prod  = [4, 0, 0, 0];
  const conso = [0, 1, 2, 1];
  const r = simulateBattery({ prodHourly: prod, consoHourly: conso, capacityKwh: 10, roundTripEfficiency: 1 });
  assert.ok(Math.abs(r.selfConsumedFromBatteryKwh - 4) < 1e-9); // 1 + 2 + 1 restitués
  assert.ok(Math.abs(r.selfConsumedKwh - 4) < 1e-9);
  assert.ok(Math.abs(r.exportedKwh - 0) < 1e-9);
  assert.ok(Math.abs(r.importedKwh - 0) < 1e-9);
  assert.ok(Math.abs(r.autoconsoRate - 1) < 1e-9);
});

test('simulateBattery — rendement 90 % : pertes reportées sur l\'import', () => {
  const prod  = [10, 0];
  const conso = [0, 10];
  const r = simulateBattery({ prodHourly: prod, consoHourly: conso, capacityKwh: 10, roundTripEfficiency: 0.9 });
  // charge 10 → décharge tirée 10, restitué 9 ; besoin 10 → import 1
  assert.ok(Math.abs(r.selfConsumedFromBatteryKwh - 9) < 1e-9);
  assert.ok(Math.abs(r.importedKwh - 1) < 1e-9);
  assert.ok(Math.abs(r.exportedKwh - 0) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: FAIL — `simulateBattery is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Simulation horaire d'une batterie tampon (pas de temps = 1 h, donc kWh ≡ kW×1h).
 * À chaque heure : l'autoconso directe min(prod, conso) est toujours comptée ;
 *  - surplus (prod>conso) → charge la batterie (borné par capacité libre et maxChargeKw),
 *    le reste est exporté ;
 *  - déficit (conso>prod) → décharge (borné par SOC et maxDischargeKw), le manque
 *    résiduel est importé.
 * `roundTripEfficiency` (η) s'applique à la restitution : pour couvrir un besoin B,
 * on tire B/η de la batterie et on restitue B (limité par le SOC). Surplus jamais
 * valorisé en € : la batterie ne crée que de l'import évité.
 */
export function simulateBattery({
  prodHourly, consoHourly, capacityKwh,
  roundTripEfficiency = 0.9, maxChargeKw = Infinity, maxDischargeKw = Infinity, initialSoc = 0,
}) {
  if (prodHourly.length !== consoHourly.length) {
    throw new Error('simulateBattery : longueurs prod/conso différentes');
  }
  const eta = roundTripEfficiency;
  let soc = Math.min(initialSoc, capacityKwh);
  let direct = 0, fromBattery = 0, exported = 0, imported = 0, prod = 0, conso = 0, charged = 0, discharged = 0;

  for (let i = 0; i < prodHourly.length; i++) {
    const p = prodHourly[i];
    const c = consoHourly[i];
    prod += p; conso += c;
    direct += Math.min(p, c);
    const net = p - c;
    if (net > 0) {
      const accepted = Math.min(net, capacityKwh - soc, maxChargeKw);
      soc += accepted; charged += accepted;
      exported += net - accepted;
    } else if (net < 0) {
      const need = -net;
      const drawn = Math.min(need / eta, soc, maxDischargeKw); // énergie retirée de la batterie
      const delivered = drawn * eta;                           // énergie rendue à la maison
      soc -= drawn; discharged += drawn;
      fromBattery += delivered;
      imported += need - delivered;
    }
  }

  const selfC = direct + fromBattery;
  return {
    capacityKwh,
    prodKwh: prod,
    consoKwh: conso,
    selfConsumedDirectKwh: direct,
    selfConsumedFromBatteryKwh: fromBattery,
    selfConsumedKwh: selfC,
    exportedKwh: exported,
    importedKwh: imported,
    chargedKwh: charged,
    dischargedKwh: discharged,
    autoconsoRate: prod > 0 ? selfC / prod : 0,
    autoproductionRate: conso > 0 ? selfC / conso : 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/autoconsoEngine.js scripts/autoconso-engine.test.mjs
git commit -m "feat(solaire): simulation batterie tampon horaire (rendement, bornes charge/décharge)"
```

---

### Task 8: Dimensionnement batterie (courbe + genou)

**Files:**
- Modify: `src/apps/solaire/lib/autoconsoEngine.js`
- Test: `scripts/autoconso-engine.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : sizeBattery
test('sizeBattery — courbe croissante + capacité recommandée au genou', () => {
  // profil qui récompense la batterie puis sature : gros surplus jour, gros déficit nuit
  const prod  = [];
  const conso = [];
  for (let d = 0; d < 10; d++) {
    for (let h = 0; h < 24; h++) {
      prod.push(h >= 10 && h < 16 ? 4 : 0);   // 24 kWh/j le jour
      conso.push(h >= 18 || h < 6 ? 2 : 0);    // 24 kWh/j le soir/nuit
    }
  }
  const { curve, recommendedCapacityKwh } = sizeBattery({
    prodHourly: prod, consoHourly: conso,
    capacities: [0, 4, 8, 12, 16, 20], roundTripEfficiency: 1, marginalThresholdKwhPerKwh: 5,
  });
  assert.equal(curve.length, 6);
  // autoconso non décroissante avec la capacité
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].selfConsumedKwh >= curve[i - 1].selfConsumedKwh - 1e-9);
  }
  // capacité 0 = aucune autoconso ici (jour et soir jamais simultanés)
  assert.equal(curve[0].selfConsumedKwh, 0);
  // recommandation dans la liste, > 0 (le tampon apporte quelque chose)
  assert.ok(recommendedCapacityKwh > 0);
  assert.ok(curve.some((pt) => pt.capacityKwh === recommendedCapacityKwh));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: FAIL — `sizeBattery is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Balaye une liste de capacités → courbe autoconso = f(capacité), et détecte le
 * « genou » (rendements décroissants) : la plus grande capacité tant que le gain
 * marginal (kWh d'autoconso récupérés par kWh de capacité ajoutée) reste ≥
 * marginalThresholdKwhPerKwh. Au-delà, chaque kWh de batterie rapporte trop peu.
 * Sert de capacité recommandée par défaut (le commercial peut choisir un autre point).
 */
export function sizeBattery({
  prodHourly, consoHourly, capacities,
  roundTripEfficiency = 0.9, marginalThresholdKwhPerKwh = 50,
}) {
  const sorted = [...capacities].sort((a, b) => a - b);
  const curve = sorted.map((cap) => {
    const r = simulateBattery({ prodHourly, consoHourly, capacityKwh: cap, roundTripEfficiency });
    return {
      capacityKwh: cap,
      autoconsoRate: r.autoconsoRate,
      autoproductionRate: r.autoproductionRate,
      selfConsumedKwh: r.selfConsumedKwh,
      importedKwh: r.importedKwh,
      exportedKwh: r.exportedKwh,
    };
  });

  let recommendedCapacityKwh = curve.length ? curve[0].capacityKwh : 0;
  for (let i = 1; i < curve.length; i++) {
    const dCap = curve[i].capacityKwh - curve[i - 1].capacityKwh;
    const dSelf = curve[i].selfConsumedKwh - curve[i - 1].selfConsumedKwh;
    const marginal = dCap > 0 ? dSelf / dCap : 0;
    if (marginal >= marginalThresholdKwhPerKwh) recommendedCapacityKwh = curve[i].capacityKwh;
    else break;
  }

  return { curve, recommendedCapacityKwh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/autoconso-engine.test.mjs`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/autoconsoEngine.js scripts/autoconso-engine.test.mjs
git commit -m "feat(solaire): dimensionnement batterie par balayage de capacités (genou de courbe)"
```

---

## Definition of Done (Phase 1)

- [ ] `node --test scripts/autoconso-engine.test.mjs` → 11 tests PASS.
- [ ] `npx vite build` OK (le module pur ne casse pas le build ; vérification bundling, cf. préférence Eric — pas de preview tools).
- [ ] `npm run lint:errors` sans nouvelle erreur.
- [ ] Le module n'importe rien (grep `^import` dans `autoconsoEngine.js` → vide) — pureté vérifiée.
- [ ] Spike consigné dans `docs/superpowers/spikes/2026-07-07-enedis-pvgis-hourly.md` avec URLs et colonnes figées.

## Suites (plans dédiés à écrire ensuite)

1. **PVGIS `seriescalc`** : étendre l'edge `pvgis-proxy` + `pvgis.js` pour ramener la série horaire (peakpower=1, le front multiplie par kWc). Brancher sur `computeSelfConsumption` / `sizeBattery`.
2. **Formulaire foyer** : saisie usages + budgets kWh + fenêtres VE/piscine → construit les `devices` et les 12 ancres mensuelles. Charge la fixture Enedis comme `baseShape`.
3. **Sankey PDF** : porter la maquette Sankey en primitives `@react-pdf/renderer` (d3-sankey = calcul de géométrie only), alimentée par les sorties du moteur.
4. **Intégration `etudeModel.js`** : exposer autoconso Cible + courbe batterie dans la source de calcul unique (UI étape 3 ↔ PDF).
