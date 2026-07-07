# Bibliothèque de sous-profils d'usage (`usageProfiles.js`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans. Steps en cases à cocher (`- [ ]`).

**Goal:** Module pur `src/apps/solaire/lib/usageProfiles.js` produisant des `device` normalisés ({name, annualKwh, hourOfDayWeights[24], monthWeights[12]}) pour chaque usage (ECS, VE, piscine, PAC), consommables par `distributeDeviceLoad`/`buildLoadCurve` du moteur.

**Architecture:** Fonctions pures dérivant énergie + forme depuis les paramètres foyer. ECS dérivé de la physique de chauffe (nb personnes). VE du kilométrage. Piscine de la pompe × saison. PAC via helper de budget saisi (v1, pas de couplage Module Thermique). Défauts validés Eric (spec `docs/superpowers/specs/2026-07-07-solaire-sous-profils-usages-design.md`). Aucun import.

**Tech Stack:** JS ESM pur, `node:test`. Tests d'intégration important : vérifier via `distributeDeviceLoad` (importé de `autoconsoEngine.js`) que `monthWeights` reproduit bien la répartition mensuelle voulue.

**Invariant clé (à tester) :** pour un device, `distributeDeviceLoad(device)` doit donner, sur chaque mois, l'énergie prévue par la formule — car `monthWeights` porte l'**énergie/jour** du mois (et non l'énergie/mois), sinon les mois longs seraient sur-pondérés.

---

## File Structure
- **Create** `src/apps/solaire/lib/usageProfiles.js` — builders de devices + constantes de défauts.
- **Create** `scripts/usage-profiles.test.mjs` — tests (dont intégration avec `distributeDeviceLoad`).

---

### Task 1: Constantes, `hoursMask`, `ecsDevice`

**Files:**
- Create: `src/apps/solaire/lib/usageProfiles.js`
- Test: `scripts/usage-profiles.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/usage-profiles.test.mjs
// Tests de la bibliothèque de sous-profils d'usage (src/apps/solaire/lib/usageProfiles.js).
// Run : node --test scripts/usage-profiles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursMask, ecsDevice, COLD_WATER_TEMP_BY_MONTH, ECS_NIGHT_HOURS } from '../src/apps/solaire/lib/usageProfiles.js';
import { distributeDeviceLoad, hourToDate } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('hoursMask — 1 sur les heures listées, 0 sinon', () => {
  const m = hoursMask([22, 23, 0, 1]);
  assert.equal(m.length, 24);
  assert.equal(m[0], 1); assert.equal(m[1], 1); assert.equal(m[22], 1); assert.equal(m[23], 1);
  assert.equal(m[12], 0);
});

test('ecsDevice — énergie physique dérivée du nb de personnes', () => {
  const dev = ecsDevice({ persons: 4 }); // défauts : 40 L, 55°C, η 0.9
  assert.equal(dev.name, 'ecs');
  // E_jour(janv) = 4 × 40 × (55 − 10) × 1.163 / 1000 / 0.9
  const eJan = 4 * 40 * (55 - COLD_WATER_TEMP_BY_MONTH[0]) * 1.163 / 1000 / 0.9;
  assert.ok(Math.abs(dev.monthWeights[0] - eJan) < 1e-9);
  // baseline = ballon nuit HC
  assert.deepEqual(dev.hourOfDayWeights, hoursMask(ECS_NIGHT_HOURS));
  // énergie annuelle = Σ E_jour(m) × jours(m) ; l'hiver > l'été
  assert.ok(dev.annualKwh > 0);
  assert.ok(dev.monthWeights[0] > dev.monthWeights[6]); // janvier (eau à 10°C) > juillet (18°C)
});

test('ecsDevice — distributeDeviceLoad reproduit l\'énergie mensuelle de la formule', () => {
  const dev = ecsDevice({ persons: 4 });
  const curve = distributeDeviceLoad(dev);
  // énergie de janvier via la courbe = E_jour(janv) × 31 jours
  let janSum = 0;
  for (let h = 0; h < curve.length; h++) if (hourToDate(h).month === 0) janSum += curve[h];
  const eJanMonth = dev.monthWeights[0] * 31;
  assert.ok(Math.abs(janSum - eJanMonth) < 1e-6);
  // total = annualKwh
  assert.ok(Math.abs(curve.reduce((a, b) => a + b, 0) - dev.annualKwh) < 1e-6);
});

test('ecsDevice — mode solar = fenêtre midi', () => {
  const dev = ecsDevice({ persons: 3, mode: 'solar' });
  assert.equal(dev.hourOfDayWeights[12], 1); // midi actif
  assert.equal(dev.hourOfDayWeights[3], 0);  // nuit inactif
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/usage-profiles.test.mjs`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/apps/solaire/lib/usageProfiles.js
// Bibliothèque de sous-profils d'usage — PUR : aucun import.
// Produit des `device` { name, annualKwh, hourOfDayWeights[24], monthWeights[12] }
// consommés par distributeDeviceLoad (autoconsoEngine.js).
// Défauts validés Eric 2026-07-07 — spec :
//   docs/superpowers/specs/2026-07-07-solaire-sous-profils-usages-design.md
// RÈGLE : le surplus n'est JAMAIS valorisé en €.
// NB : monthWeights porte l'ÉNERGIE/JOUR du mois (pas /mois) → distributeDeviceLoad
//      reproduit la répartition mensuelle exacte (× jours du mois, cf. tests).

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Tableau de 24 poids horaires : 1 sur les heures listées, 0 sinon. */
export function hoursMask(hours) {
  const w = new Array(24).fill(0);
  for (const h of hours) w[((h % 24) + 24) % 24] = 1;
  return w;
}

export const ECS_NIGHT_HOURS = [22, 23, 0, 1, 2, 3, 4, 5];
export const ECS_SOLAR_HOURS = [11, 12, 13, 14, 15];
export const VE_NIGHT_HOURS = [23, 0, 1, 2, 3, 4, 5];
export const POOL_HOURS = [11, 12, 13, 14, 15, 16, 17];
export const PAC_HEATING_HOURS = [6, 7, 8, 9, 18, 19, 20, 21, 22];

/** Eau froide réseau par mois (°C), saisonnière. Défaut FR (validé Eric). */
export const COLD_WATER_TEMP_BY_MONTH = [10, 10, 11, 13, 15, 17, 18, 18, 17, 15, 12, 10];

/**
 * Device ECS dérivé du nombre de personnes (physique de chauffe de l'eau) :
 * E_jour(m) = persons × litersPerPersonPerDay × (tankTempC − coldWaterTempByMonth[m])
 *             × 1.163 / 1000 / tankEfficiency  (kWh/jour ; 1.163 = chaleur massique eau).
 * monthWeights[m] = E_jour(m). annualKwh = Σ E_jour(m) × jours(m).
 * mode 'night' = ballon nuit HC (baseline) ; 'solar' = cible délestage midi.
 */
export function ecsDevice({
  persons,
  litersPerPersonPerDay = 40,
  tankTempC = 55,
  coldWaterTempByMonth = COLD_WATER_TEMP_BY_MONTH,
  tankEfficiency = 0.9,
  mode = 'night',
}) {
  const dailyByMonth = coldWaterTempByMonth.map(
    (cold) => (persons * litersPerPersonPerDay * (tankTempC - cold) * 1.163) / 1000 / tankEfficiency
  );
  const annualKwh = dailyByMonth.reduce((sum, e, m) => sum + e * DAYS_IN_MONTH[m], 0);
  return {
    name: 'ecs',
    annualKwh,
    hourOfDayWeights: hoursMask(mode === 'solar' ? ECS_SOLAR_HOURS : ECS_NIGHT_HOURS),
    monthWeights: dailyByMonth,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/usage-profiles.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/usageProfiles.js scripts/usage-profiles.test.mjs
git commit -m "feat(solaire): sous-profil ECS dérivé du nb de personnes (physique de chauffe)"
```
(Terminer le message par : `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

### Task 2: `veDevice`

**Files:**
- Modify: `src/apps/solaire/lib/usageProfiles.js`
- Test: `scripts/usage-profiles.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : veDevice, VE_NIGHT_HOURS
test('veDevice — énergie depuis le kilométrage, charge nuit', () => {
  const dev = veDevice({ kmPerYear: 15000 }); // défauts 18 kWh/100km, 90% maison
  assert.equal(dev.name, 've');
  assert.ok(Math.abs(dev.annualKwh - (15000 * 18 / 100) * 0.9) < 1e-9); // 2430
  assert.deepEqual(dev.hourOfDayWeights, hoursMask(VE_NIGHT_HOURS));
  assert.deepEqual(dev.monthWeights, new Array(12).fill(1)); // uniforme
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/usage-profiles.test.mjs`
Expected: FAIL — `veDevice is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/** Device VE : énergie annuelle depuis le kilométrage, charge nuit par défaut. */
export function veDevice({ kmPerYear, kwhPer100km = 18, homeChargeShare = 0.9 }) {
  const annualKwh = ((kmPerYear * kwhPer100km) / 100) * homeChargeShare;
  return {
    name: 've',
    annualKwh,
    hourOfDayWeights: hoursMask(VE_NIGHT_HOURS),
    monthWeights: new Array(12).fill(1),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/usage-profiles.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/usageProfiles.js scripts/usage-profiles.test.mjs
git commit -m "feat(solaire): sous-profil VE (énergie depuis kilométrage, charge nuit)"
```
(Co-Author obligatoire.)

---

### Task 3: `poolDevice`

**Files:**
- Modify: `src/apps/solaire/lib/usageProfiles.js`
- Test: `scripts/usage-profiles.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : poolDevice, POOL_HOURS, POOL_SEASON_WEIGHTS
test('poolDevice — pompe midi, saisonnier, énergie conservée', () => {
  const dev = poolDevice({}); // défauts 0.8 kW × 8 h
  assert.equal(dev.name, 'piscine');
  assert.deepEqual(dev.hourOfDayWeights, hoursMask(POOL_HOURS));
  // juin (index 5, saison=1) : E_jour = 0.8 × 8 × 1 = 6.4 kWh/jour
  assert.ok(Math.abs(dev.monthWeights[5] - 6.4) < 1e-9);
  // janvier hors saison = 0
  assert.equal(dev.monthWeights[0], 0);
  // annualKwh = Σ E_jour(m) × jours(m)
  const expected = POOL_SEASON_WEIGHTS.reduce((s, w, m) => s + (0.8 * 8 * w) * DAYS_IN_MONTH[m], 0);
  assert.ok(Math.abs(dev.annualKwh - expected) < 1e-6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/usage-profiles.test.mjs`
Expected: FAIL — `poolDevice is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/** Saison piscine par défaut (poids relatifs/jour, avril→oct, pic été). Validé Eric. */
export const POOL_SEASON_WEIGHTS = [0, 0, 0, 0.2, 0.5, 1, 1, 1, 0.6, 0.2, 0, 0];

/**
 * Device piscine : pompe de filtration, fenêtre midi, saisonnier.
 * monthWeights[m] = pumpKw × hoursPerDay × seasonWeights[m] (énergie/jour) ;
 * annualKwh = Σ (pumpKw × hoursPerDay × seasonWeights[m]) × jours(m).
 */
export function poolDevice({ pumpKw = 0.8, hoursPerDay = 8, seasonWeights = POOL_SEASON_WEIGHTS }) {
  const dailyByMonth = seasonWeights.map((s) => pumpKw * hoursPerDay * s);
  const annualKwh = dailyByMonth.reduce((sum, e, m) => sum + e * DAYS_IN_MONTH[m], 0);
  return {
    name: 'piscine',
    annualKwh,
    hourOfDayWeights: hoursMask(POOL_HOURS),
    monthWeights: dailyByMonth,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/usage-profiles.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/usageProfiles.js scripts/usage-profiles.test.mjs
git commit -m "feat(solaire): sous-profil piscine (pompe midi, saisonnier)"
```
(Co-Author obligatoire.)

---

### Task 4: `fromAnnualBudget` + constantes PAC (budget saisi v1)

**Files:**
- Modify: `src/apps/solaire/lib/usageProfiles.js`
- Test: `scripts/usage-profiles.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Ajouter à l'import : fromAnnualBudget, PAC_HEATING_HOURS, PAC_HEATING_MONTH_WEIGHTS
test('fromAnnualBudget — PAC chauffage : budget saisi, forme matin/soir + hiver', () => {
  const dev = fromAnnualBudget({
    name: 'pac',
    annualKwh: 4000,
    hourOfDayWeights: hoursMask(PAC_HEATING_HOURS),
    monthWeights: PAC_HEATING_MONTH_WEIGHTS,
  });
  assert.equal(dev.name, 'pac');
  assert.equal(dev.annualKwh, 4000); // budget imposé tel quel
  assert.equal(dev.hourOfDayWeights[7], 1);  // matin actif
  assert.equal(dev.hourOfDayWeights[13], 0); // midi inactif (chauffage)
  assert.ok(dev.monthWeights[0] > dev.monthWeights[6]); // janvier > juillet (degrés-jours)
  // copies défensives (pas la même référence que l'entrée)
  const mw = PAC_HEATING_MONTH_WEIGHTS;
  assert.notEqual(dev.monthWeights, mw);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/usage-profiles.test.mjs`
Expected: FAIL — `fromAnnualBudget is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
/** Répartition mensuelle chauffage PAC par défaut (∝ degrés-jours). Validé Eric. */
export const PAC_HEATING_MONTH_WEIGHTS = [1, 0.9, 0.7, 0.4, 0.1, 0, 0, 0, 0.1, 0.4, 0.7, 1];

/**
 * Device générique depuis un budget annuel saisi (PAC chauffage v1, autres usages).
 * L'énergie annuelle est imposée telle quelle ; forme journalière + mensuelle fournies.
 * Copies défensives des tableaux (l'appelant peut passer une constante partagée).
 */
export function fromAnnualBudget({ name, annualKwh, hourOfDayWeights, monthWeights }) {
  return { name, annualKwh, hourOfDayWeights: [...hourOfDayWeights], monthWeights: [...monthWeights] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/usage-profiles.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apps/solaire/lib/usageProfiles.js scripts/usage-profiles.test.mjs
git commit -m "feat(solaire): helper de budget saisi + défauts PAC chauffage (v1)"
```
(Co-Author obligatoire.)

---

## Definition of Done
- [ ] `node --test scripts/usage-profiles.test.mjs` → 7 tests PASS.
- [ ] `grep -n "^import" src/apps/solaire/lib/usageProfiles.js` → vide (pureté).
- [ ] Le pre-commit hook `lint:errors` passe sur chaque commit.
- [ ] Rester sur `main`, pas de worktree, pas de push (le contrôleur pousse).

## Suite (plan dédié)
`scenarios.js` : `applySolarShift`, `absorbSurplusWithLoad`, `runScenarios` (cascade), `poolExtraMonths` (sous-modèle « mois de baignade »).
