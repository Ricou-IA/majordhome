# Scénarios d'optimisation (`scenarios.js`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou superpowers:executing-plans. Cases à cocher (`- [ ]`).

**Goal:** Module `src/apps/solaire/lib/scenarios.js` : les leviers d'optimisation (déphasage ECS/VE, absorption du surplus par la PAC piscine) + le composeur de cascade `runScenarios` + le sous-modèle `poolExtraMonths`.

**Architecture:** Fonctions pures opérant sur des tableaux horaires. Importe le moteur (`computeSelfConsumption`, `simulateBattery`, `hourToDate`) de `autoconsoEngine.js` (import de modules purs siblings — OK, testé `node --test`). Conserve l'énergie (un déphasage déplace, il ne crée ni ne détruit). **Surplus jamais valorisé en € : les leviers ne produisent que de l'import évité ou du confort.**

**Tech Stack:** JS ESM, `node:test`.

**Modèles clés :**
- `applySolarShift` : retire `fraction` de l'énergie d'un usage de ses heures actuelles, la redistribue **proportionnellement au surplus PV** disponible → si `moved ≤ Σsurplus`, tout devient autoconsommé ; sinon le surplus est saturé et l'excédent reste en import. Énergie conservée : `Σ newConso = Σ conso`.
- `absorbSurplusWithLoad` : **ajoute** une charge de confort dans les heures de surplus (fenêtre horaire donnée), plafonnée. Augmente la conso, coût marginal ≈ 0.

---

## File Structure
- **Create** `src/apps/solaire/lib/scenarios.js`
- **Create** `scripts/scenarios.test.mjs`

---

### Task 1: `applySolarShift`

**Files:**
- Create: `src/apps/solaire/lib/scenarios.js`
- Test: `scripts/scenarios.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/scenarios.test.mjs
// Tests des scénarios d'optimisation (src/apps/solaire/lib/scenarios.js).
// Run : node --test scripts/scenarios.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySolarShift } from '../src/apps/solaire/lib/scenarios.js';
import { computeSelfConsumption } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('applySolarShift — déplace l\'usage vers le surplus, énergie conservée', () => {
  // usage de 10 kWh à h2 (nuit, pas de prod) ; prod à h1 (soleil).
  const conso = [0, 0, 10];
  const prod  = [0, 10, 0];
  const usage = [0, 0, 10];
  const out = applySolarShift(conso, prod, usage, { fraction: 1 });
  // le 10 passe de h2 (nuit) à h1 (soleil)
  assert.ok(Math.abs(out[2] - 0) < 1e-9);
  assert.ok(Math.abs(out[1] - 10) < 1e-9);
  // énergie totale conservée
  assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - 10) < 1e-9);
  // autoconso : 0 avant → 10 après
  assert.equal(computeSelfConsumption({ prodHourly: prod, consoHourly: conso }).selfConsumedKwh, 0);
  assert.ok(Math.abs(computeSelfConsumption({ prodHourly: prod, consoHourly: out }).selfConsumedKwh - 10) < 1e-9);
});

test('applySolarShift — aucun surplus disponible → conso inchangée', () => {
  const conso = [5, 5];
  const prod  = [0, 0]; // pas de soleil
  const usage = [5, 0];
  const out = applySolarShift(conso, prod, usage, { fraction: 1 });
  assert.deepEqual(out, [5, 5]); // pas de déphasage bénéfique
});

test('applySolarShift — surplus insuffisant : sature le surplus, conserve l\'énergie', () => {
  // usage 10 à h1 (nuit) ; surplus dispo seulement 4 à h0.
  const conso = [0, 10];
  const prod  = [4, 0];
  const usage = [0, 10];
  const out = applySolarShift(conso, prod, usage, { fraction: 1 });
  assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - 10) < 1e-9); // énergie conservée
  // le surplus (4) est autoconsommé, le reste (6) reste en import à h0
  const r = computeSelfConsumption({ prodHourly: prod, consoHourly: out });
  assert.ok(Math.abs(r.selfConsumedKwh - 4) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/scenarios.test.mjs`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/apps/solaire/lib/scenarios.js
// Scénarios d'optimisation de l'autoconsommation (leviers de la « Cible »).
// Importe le moteur pur autoconsoEngine.js. Testé node --test.
// RÈGLE : le surplus n'est JAMAIS valorisé en € — import évité ou confort uniquement.
import { computeSelfConsumption, simulateBattery, hourToDate } from './autoconsoEngine.js';

/**
 * Déphasage : retire `fraction` de l'énergie d'un usage de ses heures actuelles et
 * la redistribue proportionnellement au SURPLUS PV disponible. Énergie conservée
 * (Σ newConso = Σ conso). Si moved ≤ Σsurplus → tout devient autoconsommé ; sinon
 * le surplus est saturé et l'excédent reste en import. Aucun surplus → conso inchangée.
 */
export function applySolarShift(consoHourly, prodHourly, usageCurve, { fraction }) {
  const n = consoHourly.length;
  const newConso = new Array(n);
  let moved = 0;
  for (let h = 0; h < n; h++) {
    newConso[h] = consoHourly[h] - fraction * usageCurve[h];
    moved += fraction * usageCurve[h];
  }
  const surplus = new Array(n);
  let totalSurplus = 0;
  for (let h = 0; h < n; h++) {
    const s = prodHourly[h] - newConso[h];
    surplus[h] = s > 0 ? s : 0;
    totalSurplus += surplus[h];
  }
  if (totalSurplus <= 0) return consoHourly.slice();
  for (let h = 0; h < n; h++) newConso[h] += (moved * surplus[h]) / totalSurplus;
  return newConso;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/scenarios.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/scenarios.js scripts/scenarios.test.mjs
git commit -m "feat(solaire): déphasage solaire (applySolarShift) — leviers comportement/piloté"
```
(Terminer par : `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

### Task 2: `absorbSurplusWithLoad`

**Files:**
- Modify: `src/apps/solaire/lib/scenarios.js`
- Test: `scripts/scenarios.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : absorbSurplusWithLoad
test('absorbSurplusWithLoad — la PAC piscine mange le surplus de midi', () => {
  const conso = [0, 1, 0];
  const prod  = [0, 5, 0];
  const hw = new Array(24).fill(0); hw[1] = 1; // charge active à l'heure-de-journée 1
  const { consoHourly: out, absorbedKwh } = absorbSurplusWithLoad(conso, prod, { hourWeights: hw, maxKwhPerHour: 10 });
  assert.ok(Math.abs(absorbedKwh - 4) < 1e-9);       // surplus dispo = 5 − 1 = 4
  assert.ok(Math.abs(out[1] - 5) < 1e-9);            // conso montée à 5
  // export converti en autoconso (confort) : 4 → 0 d'export
  assert.ok(Math.abs(computeSelfConsumption({ prodHourly: prod, consoHourly: out }).exportedKwh - 0) < 1e-9);
});

test('absorbSurplusWithLoad — plafond maxKwhPerHour respecté', () => {
  const conso = [0, 0];
  const prod  = [0, 10];
  const hw = new Array(24).fill(0); hw[1] = 1;
  const { absorbedKwh } = absorbSurplusWithLoad(conso, prod, { hourWeights: hw, maxKwhPerHour: 3 });
  assert.ok(Math.abs(absorbedKwh - 3) < 1e-9); // plafonné à 3 malgré 10 de surplus
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/scenarios.test.mjs`
Expected: FAIL — `absorbSurplusWithLoad is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Absorbe le surplus PV avec une charge de confort pilotée (ex. PAC piscine) placée
 * dans une fenêtre horaire (`hourWeights`, indexé par heure-de-journée 0-23), plafonnée
 * par `maxKwhPerHour`. Augmente la conso uniquement là où il y a du surplus (coût
 * marginal ≈ 0). Renvoie { consoHourly, absorbedKwh }. Valeur = confort, pas €.
 */
export function absorbSurplusWithLoad(consoHourly, prodHourly, { hourWeights, maxKwhPerHour = Infinity }) {
  const n = consoHourly.length;
  const newConso = consoHourly.slice();
  let absorbedKwh = 0;
  for (let h = 0; h < n; h++) {
    if (!hourWeights[h % 24]) continue;
    const surplus = prodHourly[h] - consoHourly[h];
    if (surplus <= 0) continue;
    const load = Math.min(surplus, maxKwhPerHour);
    newConso[h] += load;
    absorbedKwh += load;
  }
  return { consoHourly: newConso, absorbedKwh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/scenarios.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/scenarios.js scripts/scenarios.test.mjs
git commit -m "feat(solaire): absorption du surplus par charge de confort (PAC piscine)"
```
(Co-Author obligatoire.)

---

### Task 3: `exportByMonth` + `poolExtraMonths`

**Files:**
- Modify: `src/apps/solaire/lib/scenarios.js`
- Test: `scripts/scenarios.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : exportByMonth, poolExtraMonths
test('exportByMonth — somme le surplus injecté par mois', () => {
  const prod  = [10, 0, 0]; // 3 premières heures = janvier
  const conso = [0, 0, 0];
  const out = exportByMonth(prod, conso);
  assert.equal(out.length, 12);
  assert.equal(out[0], 10); // janvier
  assert.equal(out[6], 0);
});

test('poolExtraMonths — mois d\'épaule où le surplus couvre le besoin de chauffe', () => {
  const surplus = new Array(12).fill(0);
  const demand  = new Array(12).fill(0);
  surplus[3] = 100; demand[3] = 80; // avril : couvert
  surplus[4] = 50;  demand[4] = 80; // mai : non couvert
  surplus[8] = 90;  demand[8] = 90; // sept : couvert (égalité)
  const r = poolExtraMonths(surplus, demand);
  assert.deepEqual(r.months, [3, 8]);
  assert.equal(r.extraMonths, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/scenarios.test.mjs`
Expected: FAIL — `exportByMonth is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/** Surplus injecté (export) sommé par mois (0-11), via le calendrier du moteur. */
export function exportByMonth(prodHourly, consoHourly) {
  const out = new Array(12).fill(0);
  for (let h = 0; h < prodHourly.length; h++) {
    const exp = prodHourly[h] - consoHourly[h];
    if (exp > 0) out[hourToDate(h).month] += exp;
  }
  return out;
}

/**
 * Mois d'épaule où le surplus PV couvre le besoin de chauffe piscine → « N mois de
 * baignade en plus, alimentés par votre surplus ». shoulderMonths 0-indexés
 * (avril=3, mai=4, sept=8, oct=9). Besoin de chauffe = sous-modèle externe (v1).
 */
export function poolExtraMonths(surplusByMonth, poolHeatDemandByMonth, { shoulderMonths = [3, 4, 8, 9] } = {}) {
  const months = shoulderMonths.filter(
    (m) => poolHeatDemandByMonth[m] > 0 && surplusByMonth[m] >= poolHeatDemandByMonth[m]
  );
  return { extraMonths: months.length, months };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/scenarios.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/scenarios.js scripts/scenarios.test.mjs
git commit -m "feat(solaire): export mensuel + sous-modèle mois de baignade (poolExtraMonths)"
```
(Co-Author obligatoire.)

---

### Task 4: `runScenarios` (cascade « Cible »)

**Files:**
- Modify: `src/apps/solaire/lib/scenarios.js`
- Test: `scripts/scenarios.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : runScenarios
test('runScenarios — cascade constat → déphasage → batterie, deltas cumulés', () => {
  const baseline = [0, 0, 10]; // usage la nuit
  const prod     = [0, 10, 0]; // soleil à h1
  const usage    = [0, 0, 10];
  const results = runScenarios({
    baselineConso: baseline,
    prodHourly: prod,
    steps: [
      { type: 'shift', key: 'piloted', label: 'Déphasage piloté', usageCurve: usage, fraction: 1 },
      { type: 'battery', key: 'battery', label: 'Batterie', capacityKwh: 0 },
    ],
  });
  assert.equal(results.length, 3); // constat + 2 étapes
  assert.equal(results[0].key, 'constat');
  assert.equal(results[0].selfConsumedKwh, 0);       // rien d'autoconsommé au départ
  assert.ok(Math.abs(results[1].selfConsumedKwh - 10) < 1e-9); // après déphasage
  assert.ok(Math.abs(results[1].deltaKwh - 10) < 1e-9);        // gain du levier
  // batterie capacité 0 ne change rien de plus
  assert.ok(Math.abs(results[2].deltaKwh - 0) < 1e-9);
});

test('runScenarios — étape absorb expose absorbedKwh', () => {
  const baseline = [0, 1, 0];
  const prod     = [0, 5, 0];
  const hw = new Array(24).fill(0); hw[1] = 1;
  const results = runScenarios({
    baselineConso: baseline,
    prodHourly: prod,
    steps: [{ type: 'absorb', key: 'pool', label: 'PAC piscine', hourWeights: hw, maxKwhPerHour: 10 }],
  });
  assert.ok(Math.abs(results[1].absorbedKwh - 4) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/scenarios.test.mjs`
Expected: FAIL — `runScenarios is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Compose la cascade « Cible » : part du constat (baseline) et applique les `steps`
 * dans l'ordre, chaque étape cumulant sur la précédente. Types d'étape :
 *  - 'shift'   : { usageCurve, fraction } → applySolarShift
 *  - 'absorb'  : { hourWeights, maxKwhPerHour } → absorbSurplusWithLoad (expose absorbedKwh)
 *  - 'battery' : { capacityKwh, roundTripEfficiency? } → simulateBattery (à mettre EN DERNIER :
 *                ne modifie pas la conso pour les étapes suivantes).
 * Renvoie [{ key, label, autoconsoRate, selfConsumedKwh, deltaKwh, absorbedKwh? }].
 */
export function runScenarios({ baselineConso, prodHourly, steps }) {
  const results = [];
  let conso = baselineConso.slice();
  const base = computeSelfConsumption({ prodHourly, consoHourly: conso });
  results.push({ key: 'constat', label: 'Constat', autoconsoRate: base.autoconsoRate, selfConsumedKwh: base.selfConsumedKwh, deltaKwh: 0 });
  let prevSelf = base.selfConsumedKwh;

  for (const step of steps) {
    let metrics;
    let absorbedKwh;
    if (step.type === 'shift') {
      conso = applySolarShift(conso, prodHourly, step.usageCurve, { fraction: step.fraction });
      metrics = computeSelfConsumption({ prodHourly, consoHourly: conso });
    } else if (step.type === 'absorb') {
      const r = absorbSurplusWithLoad(conso, prodHourly, { hourWeights: step.hourWeights, maxKwhPerHour: step.maxKwhPerHour });
      conso = r.consoHourly;
      absorbedKwh = r.absorbedKwh;
      metrics = computeSelfConsumption({ prodHourly, consoHourly: conso });
    } else if (step.type === 'battery') {
      metrics = simulateBattery({ prodHourly, consoHourly: conso, capacityKwh: step.capacityKwh, roundTripEfficiency: step.roundTripEfficiency ?? 0.9 });
    } else {
      throw new Error(`runScenarios : type d'étape inconnu « ${step.type} »`);
    }
    const row = { key: step.key, label: step.label, autoconsoRate: metrics.autoconsoRate, selfConsumedKwh: metrics.selfConsumedKwh, deltaKwh: metrics.selfConsumedKwh - prevSelf };
    if (absorbedKwh !== undefined) row.absorbedKwh = absorbedKwh;
    results.push(row);
    prevSelf = metrics.selfConsumedKwh;
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/scenarios.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/scenarios.js scripts/scenarios.test.mjs
git commit -m "feat(solaire): composeur de cascade runScenarios (constat → leviers → batterie)"
```
(Co-Author obligatoire.)

---

## Definition of Done
- [ ] `node --test scripts/scenarios.test.mjs` → 9 tests PASS.
- [ ] `node --test scripts/autoconso-engine.test.mjs scripts/usage-profiles.test.mjs scripts/pvgis-hourly.test.mjs scripts/scenarios.test.mjs` → tout vert (non-régression).
- [ ] Le pre-commit hook `lint:errors` passe.
- [ ] Rester sur `main`, pas de worktree, pas de push (le contrôleur pousse).

## Suite (branchements, hors de ce plan)
Fixture Enedis RES1 (spike Phase 2), edge PVGIS `seriescalc` (sign-off prod), formulaire foyer, intégration `etudeModel` + Sankey PDF. Sous-modèle besoin de chauffe piscine (params volume/T°/bâche) pour alimenter `poolExtraMonths`.
