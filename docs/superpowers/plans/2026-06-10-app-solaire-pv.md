# App Solaire — Calculateur de rentabilité PV — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer l'app interne `/solaire` : simulation de rentabilité photovoltaïque en 3 étapes (localisation → consommation → résultats), moteur de calcul conservateur (surplus = 0 €), optimiseur de puissance, module VE, financement, historique, page admin `/settings/solaire`.

**Architecture:** App `src/apps/solaire/` (pattern prospection/voice) montée dans les routes artisan derrière la permission `pv_calculator`. Moteur de calcul **pur** (`pvEngine.js`, zéro import React/Supabase, testé via `node --test`). 1 seul appel PVGIS par simulation (1 kWc, linéarité) via edge function `pvgis-proxy`. Données : table `majordhome.pv_simulations` + vue publique `security_invoker` ; paramètres admin dans `core.organizations.settings.pv` via `useOrgSettings()`.

**Tech Stack:** React 18 + Vite (JSX), TanStack Query v5, Recharts, Tailwind, Supabase (MCP pour migrations + deploy edge). **Pas de framework de test installé** → moteur testé avec le runner natif Node (`node --test scripts/pv-engine.test.mjs`, zéro dépendance) ; UI vérifiée par `npx vite build` + `npm run lint:errors` + validation manuelle Eric (**jamais de preview tools**).

**Spec source:** [docs/superpowers/specs/2026-06-10-app-solaire-pv-design.md](../specs/2026-06-10-app-solaire-pv-design.md)

**Décisions actées :**
- Permission : resource `pv_calculator`, action **`view`** (et non `use`) — le filtre sidebar `AppLayout` et le `RouteGuard` utilisent `can(resource, 'view')` par défaut ; une action custom imposerait du code spécial sans bénéfice. Seed copié sur les rôles existants de `voice_recorder` (commercial ✅, team_leader ✅, technicien ❌).
- Palette deutan (spec §10.1) : jaunes `#F5C542`/`#FFD166` **réservés aux remplissages de graphiques** ; le texte porteur de sens utilise bleus `#0D47A1`/`#1565C0`/`#2196F3` + neutres. Toujours icône + libellé en plus de la couleur.
- `settings.pv` est sauvé **en bloc** (`save({ pv: fullObject })`) : la RPC `org_update_settings` fait un shallow merge niveau 1 — envoyer un sous-objet partiel écraserait le reste de `pv`.
- Tests moteur dans `scripts/pv-engine.test.mjs` (hors `src/` → invisible pour `audit:dead-code`).

**⚠️ Checkpoints (validation Eric avant exécution) :**
- **Stage A** : migrations sur l'instance Supabase partagée (table neuve + vue neuve + seed permission — aucun objet existant modifié, risque bas mais annoncé).
- **Stage C** : déploiement edge function `pvgis-proxy` (nouvelle, n'affecte rien d'existant).

---

## Stage A — Fondation DB (table, vue, permission)

### Task A1 : Table `majordhome.pv_simulations` + RLS + index

**Files:** Migration MCP `apply_migration`, name: `pv_simulations_create`

- [ ] **Step 1 : Appliquer la migration**

```sql
CREATE TABLE majordhome.pv_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  client_name text,
  client_address text,
  lat double precision,
  lon double precision,
  lead_id uuid REFERENCES majordhome.leads(id) ON DELETE SET NULL,
  client_id uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  inputs jsonb NOT NULL,
  pvgis_monthly jsonb NOT NULL,
  results jsonb NOT NULL,
  comment text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pv_simulations_org_created
  ON majordhome.pv_simulations(org_id, created_at DESC);
CREATE INDEX idx_pv_simulations_created_by
  ON majordhome.pv_simulations(created_by);

ALTER TABLE majordhome.pv_simulations ENABLE ROW LEVEL SECURITY;

-- SELECT : membre de l'org ET (owner OU org_admin de cette org)
CREATE POLICY pv_simulations_select ON majordhome.pv_simulations
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM core.organization_members m
        WHERE m.user_id = auth.uid() AND m.org_id = pv_simulations.org_id AND m.role = 'org_admin'
      )
    )
  );

-- INSERT : membre de l'org, owner forcé
CREATE POLICY pv_simulations_insert ON majordhome.pv_simulations
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND created_by = auth.uid()
  );

-- UPDATE / DELETE : owner ou org_admin
CREATE POLICY pv_simulations_update ON majordhome.pv_simulations
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = pv_simulations.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY pv_simulations_delete ON majordhome.pv_simulations
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = pv_simulations.org_id AND m.role = 'org_admin'))
  );

-- security_invoker : le rôle appelant doit avoir les privilèges sur la table de base
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.pv_simulations TO authenticated;
-- Charte multi-tenant (régression 2026-05-27) : service_role lit via la vue publique
GRANT SELECT ON majordhome.pv_simulations TO service_role;
```

- [ ] **Step 2 : Vérifier** (MCP `execute_sql`)

```sql
SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.pv_simulations'::regclass;       -- true
SELECT count(*) FROM pg_policies WHERE schemaname='majordhome' AND tablename='pv_simulations'; -- 4
SELECT has_table_privilege('service_role', 'majordhome.pv_simulations', 'SELECT');            -- true
```

### Task A2 : Vue publique `majordhome_pv_simulations` (security_invoker, auto-updatable)

**Files:** Migration MCP, name: `pv_simulations_public_view`

- [ ] **Step 1 : Appliquer la migration**

```sql
-- Mono-table, sans JOIN ni colonne calculée → auto-updatable (lectures ET écritures front)
CREATE VIEW public.majordhome_pv_simulations
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.pv_simulations;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_pv_simulations TO authenticated;
GRANT SELECT ON public.majordhome_pv_simulations TO service_role;
```

- [ ] **Step 2 : Vérifier**

```sql
SELECT viewname FROM pg_views WHERE viewname = 'majordhome_pv_simulations';                   -- 1 ligne
SELECT is_insertable_into FROM information_schema.tables
WHERE table_schema='public' AND table_name='majordhome_pv_simulations';                       -- YES
```

### Task A3 : Seed permission `pv_calculator`

**Files:** Migration MCP, name: `pv_calculator_permission_seed`

- [ ] **Step 1 : Inspecter le modèle existant** (MCP `execute_sql`)

```sql
SELECT org_id, role, resource, action, allowed
FROM majordhome.role_permissions WHERE resource = 'voice_recorder';
-- Sert de référence pour les noms de rôles réels (commercial / team_leader / technicien)
```

- [ ] **Step 2 : Seed en copiant le set org × rôle de `voice_recorder`**

```sql
INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed)
SELECT org_id, role, 'pv_calculator', 'view',
       CASE WHEN role IN ('commercial', 'team_leader') THEN true ELSE false END
FROM majordhome.role_permissions
WHERE resource = 'voice_recorder' AND action = 'use'
ON CONFLICT DO NOTHING;
```

(Si le `ON CONFLICT DO NOTHING` échoue faute de contrainte UNIQUE, retirer la clause et vérifier l'absence de doublon au préalable avec un `SELECT count(*)`.)

- [ ] **Step 3 : Vérifier**

```sql
SELECT role, allowed FROM majordhome.role_permissions WHERE resource = 'pv_calculator';
-- Attendu : commercial=true, team_leader=true, technicien=false (org Mayer 3c68193e-…)
```

---

## Stage B — Moteur de calcul pur (`pvEngine.js`, TDD via node --test)

### Task B1 : Config par défaut + conversions + helpers de saisie

**Files:**
- Create: `src/apps/solaire/lib/pvConfig.js`
- Create: `src/apps/solaire/lib/pvEngine.js`
- Create: `scripts/pv-engine.test.mjs`

- [ ] **Step 1 : Écrire les tests (échec attendu)**

```js
// scripts/pv-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentToDegrees, orientationToAspect, maxPowerKwc, panelsCount,
  spreadAnnualToMonthly, evMonthlyConsumption, simultaneityCoeff, costFromGrid,
} from '../src/apps/solaire/lib/pvEngine.js';
import { buildPvConfig, PV_DEFAULTS } from '../src/apps/solaire/lib/pvConfig.js';

test('percentToDegrees', () => {
  assert.ok(Math.abs(percentToDegrees(18) - 10.204) < 0.01);
  assert.equal(percentToDegrees(100), 45);
});

test('orientationToAspect — 8 directions + passthrough numérique', () => {
  const map = { S: 0, SE: -45, E: -90, NE: -135, N: 180, NO: 135, O: 90, SO: 45 };
  for (const [dir, aspect] of Object.entries(map)) assert.equal(orientationToAspect(dir), aspect);
  assert.equal(orientationToAspect(12), 12);
});

test('maxPowerKwc / panelsCount', () => {
  // 40 m², panneau 2,26 m² / 500 Wc → floor(17,69)=17 panneaux → 8,5 kWc
  assert.equal(maxPowerKwc(40, 2.26, 500), 8.5);
  assert.equal(panelsCount(8.5, 500), 17);
});

test('spreadAnnualToMonthly — profil résidentiel, somme exacte', () => {
  const months = spreadAnnualToMonthly(12000);
  assert.equal(months.length, 12);
  assert.equal(months[0], 1440); // janvier 12 %
  assert.equal(months[5], 720);  // juin 6 %
  assert.ok(Math.abs(months.reduce((a, b) => a + b, 0) - 12000) < 0.001);
});

test('evMonthlyConsumption', () => {
  // 20 000 km × 20 kWh/100 km × 95 % = 3 800 kWh/an → 316,67 kWh/mois
  const m = evMonthlyConsumption({ kmPerYear: 20000, kwhPer100km: 20, homeChargeShare: 0.95 });
  assert.ok(Math.abs(m - 316.667) < 0.01);
});

test('simultaneityCoeff — presets, bonus, plafond', () => {
  const profiles = PV_DEFAULTS.simultaneity;
  assert.equal(simultaneityCoeff({ preset: 'absent_journee', ecsBonus: false, evBonus: false }, profiles), 0.45);
  assert.equal(simultaneityCoeff({ preset: 'presence_partielle', ecsBonus: true, evBonus: false }, profiles), 0.65);
  // 0,70 + 0,10 + 0,10 = 0,90 → plafonné 0,85
  assert.equal(simultaneityCoeff({ preset: 'presence_journee', ecsBonus: true, evBonus: true }, profiles), 0.85);
});

test('costFromGrid — exact, interpolation, hors bornes, vide', () => {
  const grid = [{ kwc: 6, prix_ttc: 14000 }, { kwc: 3, prix_ttc: 9000 }]; // volontairement non trié
  assert.equal(costFromGrid(grid, 3), 9000);
  assert.equal(costFromGrid(grid, 4.5), 11500); // 9000 + 5000 × (1,5/3)
  assert.equal(costFromGrid(grid, 6), 14000);
  assert.equal(costFromGrid(grid, 2), null);   // sous le min → saisie manuelle
  assert.equal(costFromGrid(grid, 7), null);   // au-dessus du max → saisie manuelle
  assert.equal(costFromGrid([], 4), null);
});

test('buildPvConfig — merge profond settings.pv sur les défauts', () => {
  const cfg = buildPvConfig({ pv: { default_price_kwh: 0.25, ev: { charger_price: 1500 } } });
  assert.equal(cfg.default_price_kwh, 0.25);          // overridé
  assert.equal(cfg.inflation_rate, 0.03);             // défaut conservé
  assert.equal(cfg.ev.charger_price, 1500);           // override imbriqué
  assert.equal(cfg.ev.home_charge_share, 0.95);       // défaut imbriqué conservé
  assert.deepEqual(buildPvConfig(undefined).cost_grid, []);
});
```

- [ ] **Step 2 : Vérifier l'échec** — Run : `node --test scripts/pv-engine.test.mjs` → Expected : FAIL (modules inexistants).

- [ ] **Step 3 : Implémenter `pvConfig.js`**

```js
// src/apps/solaire/lib/pvConfig.js
// Défauts du calculateur PV. Surchargés par core.organizations.settings.pv
// (édités via /settings/solaire). PUR : aucun import React/Supabase.

export const PV_DEFAULTS = {
  default_price_kwh: 0.20,      // €/kWh TTC — ⚠️ à ajuster au TRV en vigueur
  inflation_rate: 0.03,
  degradation_rate: 0.005,
  horizon_years: 25,
  system_loss: 14,              // % pertes système (défaut PVGIS)
  panel_power_wc: 500,
  panel_area_m2: 2.26,
  default_tilt_percent: 18,
  autoconso_threshold: 0.85,
  simultaneity: {
    presence_journee: 0.70,
    presence_partielle: 0.55,
    absent_journee: 0.45,
    bonus_ecs: 0.10,
    bonus_ve: 0.10,
    cap: 0.85,
  },
  cost_grid: [],                // [{ kwc, prix_ttc }] — 1 à 9 kWc, rempli par l'admin
  default_loan_rate: 0.045,
  default_loan_years: 12,
  vat_rate: 0.055,              // informatif (grille en TTC)
  ev: {
    charger_price: null,        // € TTC borne posée — à remplir par l'admin
    home_charge_share: 0.95,
    default_km: 20000,
    default_kwh_100km: 20,
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Config effective = settings.pv (org) mergé en profondeur sur PV_DEFAULTS. */
export function buildPvConfig(settings) {
  return deepMerge(PV_DEFAULTS, settings?.pv);
}
```

- [ ] **Step 4 : Implémenter la 1ʳᵉ moitié de `pvEngine.js`**

```js
// src/apps/solaire/lib/pvEngine.js
// Moteur de calcul PV — PUR : aucun import (testable via node --test).
// Formules : spec docs/superpowers/specs/2026-06-10-app-solaire-pv-design.md §8-§9.
// RÈGLE ABSOLUE : le surplus n'est JAMAIS valorisé en € (spec §1).

/** Profil de répartition mensuelle résidentiel standard (% du total annuel, janv→déc, Σ=100). */
export const MONTHLY_PROFILE = [12, 11, 10, 8, 7, 6, 6, 6, 7, 8, 9, 10];

/** Pente toiture % (langage BTP) → degrés PVGIS. */
export function percentToDegrees(percent) {
  return (Math.atan(percent / 100) * 180) / Math.PI;
}

const ASPECT_BY_DIRECTION = { S: 0, SE: -45, E: -90, NE: -135, N: 180, NO: 135, O: 90, SO: 45 };

/** Orientation (8 directions ou degrés) → aspect PVGIS (S=0, E=-90, O=+90, N=±180). */
export function orientationToAspect(orientation) {
  if (typeof orientation === 'number') return orientation;
  return ASPECT_BY_DIRECTION[orientation] ?? 0;
}

/** Puissance max toiture (kWc) : floor(surface / surface_panneau) × puissance_panneau. */
export function maxPowerKwc(surfaceM2, panelAreaM2, panelPowerWc) {
  return Math.floor(surfaceM2 / panelAreaM2) * (panelPowerWc / 1000);
}

/** Nombre de panneaux pour une puissance donnée. */
export function panelsCount(kwc, panelPowerWc) {
  return Math.round(kwc / (panelPowerWc / 1000));
}

/** Répartit un total annuel kWh sur 12 mois selon MONTHLY_PROFILE. */
export function spreadAnnualToMonthly(totalKwh) {
  return MONTHLY_PROFILE.map((pct) => (totalKwh * pct) / 100);
}

/** Surconsommation VE mensuelle (kWh/mois), linéarisée (spec §8.6). */
export function evMonthlyConsumption({ kmPerYear, kwhPer100km, homeChargeShare }) {
  return (kmPerYear * kwhPer100km / 100 * homeChargeShare) / 12;
}

/** Coefficient de simultanéité : preset + bonus ECS + bonus VE, plafonné (spec §8.2). */
export function simultaneityCoeff({ preset, ecsBonus, evBonus }, profiles) {
  let coeff = profiles[preset] ?? profiles.presence_partielle;
  if (ecsBonus) coeff += profiles.bonus_ecs;
  if (evBonus) coeff += profiles.bonus_ve;
  return Math.min(coeff, profiles.cap);
}

/**
 * Coût installation pour P kWc depuis la grille admin [{ kwc, prix_ttc }].
 * Ligne exacte → prix ; entre 2 lignes → interpolation linéaire ;
 * hors bornes ou grille vide → null (saisie manuelle par le commercial).
 */
export function costFromGrid(grid, powerKwc) {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  const sorted = [...grid].sort((a, b) => a.kwc - b.kwc);
  const exact = sorted.find((r) => Math.abs(r.kwc - powerKwc) < 1e-9);
  if (exact) return exact.prix_ttc;
  if (powerKwc < sorted[0].kwc || powerKwc > sorted[sorted.length - 1].kwc) return null;
  const upperIdx = sorted.findIndex((r) => r.kwc > powerKwc);
  const lo = sorted[upperIdx - 1];
  const hi = sorted[upperIdx];
  const t = (powerKwc - lo.kwc) / (hi.kwc - lo.kwc);
  return lo.prix_ttc + (hi.prix_ttc - lo.prix_ttc) * t;
}
```

- [ ] **Step 5 : Vérifier** — Run : `node --test scripts/pv-engine.test.mjs` → Expected : tous PASS.

- [ ] **Step 6 : Commit**

```powershell
git add src/apps/solaire/lib/pvConfig.js src/apps/solaire/lib/pvEngine.js scripts/pv-engine.test.mjs
git commit -m "feat(solaire): moteur PV - config defaults, conversions, grille de couts (TDD node --test)" -- src/apps/solaire/lib scripts/pv-engine.test.mjs
```

### Task B2 : Cœur du calcul — autoconso, économies, financement

**Files:**
- Modify: `src/apps/solaire/lib/pvEngine.js` (append)
- Modify: `scripts/pv-engine.test.mjs` (append)

- [ ] **Step 1 : Ajouter les tests (échec attendu)**

```js
// append à scripts/pv-engine.test.mjs — ajouter aux imports : computeMonthly, yearlyEconomy, monthlyPayment
test('computeMonthly — autoconso, surplus, taux', () => {
  const eM1kwc = Array(12).fill(100);              // 1200 kWh/kWc/an (flat synthétique)
  const consoMonthly = Array(12).fill(250);        // 3000 kWh/an
  const r = computeMonthly({ eM1kwc, powerKwc: 2, consoMonthly, coeff: 0.7 });
  assert.equal(r.prod[0], 200);
  assert.equal(r.autoconso[0], 140);               // min(200,250) × 0,7
  assert.equal(r.surplus[0], 60);
  assert.equal(r.totals.prod, 2400);
  assert.equal(r.totals.autoconso, 1680);
  assert.ok(Math.abs(r.totals.tauxAutoconso - 0.7) < 1e-9);
  assert.ok(Math.abs(r.totals.tauxAutoproduction - 0.56) < 1e-9);  // 1680 / 3000
});

test('yearlyEconomy — inflation + dégradation', () => {
  const base = { autoconsoAnnual: 3000, priceKwh: 0.20, inflationRate: 0.03, degradationRate: 0.005 };
  assert.ok(Math.abs(yearlyEconomy({ ...base, yearN: 1 }) - 600) < 0.01);
  assert.ok(Math.abs(yearlyEconomy({ ...base, yearN: 2 }) - 614.91) < 0.01); // 3000×0,995×0,206
});

test('monthlyPayment — annuités constantes', () => {
  assert.ok(Math.abs(monthlyPayment({ capital: 12000, annualRate: 0.06, years: 10 }) - 133.22) < 0.05);
  assert.equal(monthlyPayment({ capital: 12000, annualRate: 0, years: 10 }), 100); // taux 0
  assert.equal(monthlyPayment({ capital: 0, annualRate: 0.06, years: 10 }), 0);
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node --test scripts/pv-engine.test.mjs` → FAIL (exports manquants).

- [ ] **Step 3 : Implémenter**

```js
// append à src/apps/solaire/lib/pvEngine.js

/**
 * Production / autoconsommation / surplus mensuels pour P kWc (spec §8.1, §8.3).
 * Le surplus est affiché « perdu » et valorisé 0 € — AUCUNE valorisation ailleurs.
 */
export function computeMonthly({ eM1kwc, powerKwc, consoMonthly, coeff }) {
  const prod = eM1kwc.map((e) => e * powerKwc);
  const autoconso = prod.map((p, m) => Math.min(p, consoMonthly[m]) * coeff);
  const surplus = prod.map((p, m) => p - autoconso[m]);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const totals = {
    prod: sum(prod),
    conso: sum(consoMonthly),
    autoconso: sum(autoconso),
    surplus: sum(surplus),
  };
  totals.tauxAutoconso = totals.prod > 0 ? totals.autoconso / totals.prod : 0;
  totals.tauxAutoproduction = totals.conso > 0 ? totals.autoconso / totals.conso : 0;
  return { prod, autoconso, surplus, totals };
}

/** Économie de l'année N (spec §8.4) : autoconso × dégradation^(N-1) × prix × inflation^(N-1). */
export function yearlyEconomy({ autoconsoAnnual, priceKwh, inflationRate, degradationRate, yearN }) {
  const price = priceKwh * Math.pow(1 + inflationRate, yearN - 1);
  const prodFactor = Math.pow(1 - degradationRate, yearN - 1);
  return autoconsoAnnual * prodFactor * price;
}

/** Mensualité crédit annuités constantes (spec §8.5). Taux 0 → division simple. */
export function monthlyPayment({ capital, annualRate, years }) {
  if (capital <= 0 || years <= 0) return 0;
  if (annualRate === 0) return capital / (12 * years);
  const r = annualRate / 12;
  return (capital * r) / (1 - Math.pow(1 + r, -12 * years));
}
```

- [ ] **Step 4 : Vérifier** — `node --test scripts/pv-engine.test.mjs` → tous PASS.

- [ ] **Step 5 : Commit** — `git commit -m "feat(solaire): moteur PV - autoconso, economies, annuites" -- src/apps/solaire/lib scripts/pv-engine.test.mjs` (après `git add` des 2 fichiers).

### Task B3 : Tableau annuel + optimiseur + scénarios

**Files:**
- Modify: `src/apps/solaire/lib/pvEngine.js` (append)
- Modify: `scripts/pv-engine.test.mjs` (append)

- [ ] **Step 1 : Ajouter les tests (échec attendu)**

```js
// append — ajouter aux imports : buildYearlyTable, optimize, buildScenarios
test('buildYearlyTable — invariants + indicateurs', () => {
  const t = buildYearlyTable({
    autoconsoAnnual: 3000, priceKwh: 0.20, inflationRate: 0.03, degradationRate: 0.005,
    horizonYears: 25, capital: 12000, annualRate: 0.06, loanYears: 10,
  });
  assert.equal(t.rows.length, 25);
  const annuity = monthlyPayment({ capital: 12000, annualRate: 0.06, years: 10 }) * 12;
  // Année 1 : économie 600, effort net = annuité − économie
  assert.ok(Math.abs(t.rows[0].economy - 600) < 0.01);
  assert.ok(Math.abs(t.rows[0].effortNet - (annuity - 600)) < 0.01);
  // Après la fin du crédit : annuité 0, effort net négatif (= gain)
  assert.equal(t.rows[10].annuity, 0);
  assert.ok(t.rows[10].effortNet < 0);
  // Cumul cohérent : cumul[N] − cumul[N−1] = économie[N] − annuité[N]
  for (let i = 1; i < 25; i++) {
    const delta = t.rows[i].cumul - t.rows[i - 1].cumul;
    assert.ok(Math.abs(delta - (t.rows[i].economy - t.rows[i].annuity)) < 0.01);
  }
  // Indicateurs
  assert.equal(t.indicators.neutralityYear, 11); // économie an 10 ≈ 748 € < annuité 1599 € → bascule an 11
  assert.ok(Math.abs(t.indicators.totalGainAtHorizon - t.rows[24].cumul) < 0.001);
  assert.ok(Math.abs(t.indicators.cumulAtLoanEnd - t.rows[9].cumul) < 0.001);
  const expectedAvg = t.rows.slice(0, 10).reduce((a, r) => a + r.effortNet, 0) / 120;
  assert.ok(Math.abs(t.indicators.avgMonthlyEffortDuringLoan - expectedAvg) < 0.001);
});

test('optimize — plus grande puissance avec taux ≥ seuil', () => {
  const eM1kwc = Array(12).fill(100);
  const consoMonthly = Array(12).fill(250);
  // P ≤ 2,5 : prod ≤ conso → taux = coeff = 0,85 ≥ seuil ; P = 3 : taux 0,708 < seuil
  const r = optimize({ eM1kwc, consoMonthly, coeff: 0.85, threshold: 0.85, maxKwc: 6.5, stepKwc: 0.5 });
  assert.equal(r.recommendedKwc, 2.5);
});

test('optimize — cas limites', () => {
  const eM1kwc = Array(12).fill(100);
  // Conso énorme : même le max toiture reste ≥ seuil → recommander le max
  let r = optimize({ eM1kwc, consoMonthly: Array(12).fill(10000), coeff: 0.85, threshold: 0.85, maxKwc: 4, stepKwc: 0.5 });
  assert.equal(r.recommendedKwc, 4);
  // Conso minuscule : aucun palier ne passe → recommander le plus petit (0,5)
  r = optimize({ eM1kwc, consoMonthly: Array(12).fill(10), coeff: 0.85, threshold: 0.85, maxKwc: 4, stepKwc: 0.5 });
  assert.equal(r.recommendedKwc, 0.5);
});

test('buildScenarios — recommandé / sobre / confort, clampés', () => {
  const s = buildScenarios({ recommendedKwc: 2.5, stepKwc: 0.5, maxKwc: 6.5 });
  assert.deepEqual(s.map((x) => x.kwc), [2, 2.5, 3]);
  assert.deepEqual(s.map((x) => x.key), ['sobre', 'recommande', 'confort']);
  // Recommandé au max toiture → pas de confort (2 scénarios)
  const s2 = buildScenarios({ recommendedKwc: 6.5, stepKwc: 0.5, maxKwc: 6.5 });
  assert.deepEqual(s2.map((x) => x.kwc), [6, 6.5]);
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node --test scripts/pv-engine.test.mjs` → FAIL.

- [ ] **Step 3 : Implémenter**

```js
// append à src/apps/solaire/lib/pvEngine.js

/** Tableau annuel type amortissement + 3 indicateurs de tête (spec §8.7). */
export function buildYearlyTable({
  autoconsoAnnual, priceKwh, inflationRate, degradationRate,
  horizonYears, capital, annualRate, loanYears,
}) {
  const annuity = monthlyPayment({ capital, annualRate, years: loanYears }) * 12;
  const rows = [];
  let cumul = 0;
  for (let n = 1; n <= horizonYears; n++) {
    const economy = yearlyEconomy({ autoconsoAnnual, priceKwh, inflationRate, degradationRate, yearN: n });
    const yearAnnuity = n <= loanYears ? annuity : 0;
    const effortNet = yearAnnuity - economy;       // négatif = le client gagne
    cumul += economy - yearAnnuity;
    rows.push({ year: n, economy, annuity: yearAnnuity, effortNet, cumul });
  }
  const neutralityRow = rows.find((r) => r.effortNet <= 0);
  const loanRows = rows.slice(0, loanYears);
  return {
    rows,
    indicators: {
      avgMonthlyEffortDuringLoan: loanYears > 0
        ? loanRows.reduce((a, r) => a + r.effortNet, 0) / (12 * loanYears)
        : 0,
      neutralityYear: neutralityRow ? neutralityRow.year : null,
      cumulAtLoanEnd: loanYears > 0 && rows[loanYears - 1] ? rows[loanYears - 1].cumul : 0,
      totalGainAtHorizon: rows.length ? rows[rows.length - 1].cumul : 0,
    },
  };
}

/**
 * Optimiseur (spec §9) : plus grande puissance (pas stepKwc, de stepKwc à maxKwc)
 * dont le taux d'autoconso annuel ≥ threshold. Aucun appel PVGIS (linéarité).
 * Cas limites : rien ne passe → plus petite puissance ; tout passe → maxKwc.
 */
export function optimize({ eM1kwc, consoMonthly, coeff, threshold, maxKwc, stepKwc }) {
  const EPS = 1e-9;
  let recommendedKwc = stepKwc;
  for (let p = stepKwc; p <= maxKwc + EPS; p += stepKwc) {
    const kwc = Math.round(p * 100) / 100; // évite la dérive float de l'accumulation
    const { totals } = computeMonthly({ eM1kwc, powerKwc: kwc, consoMonthly, coeff });
    if (totals.tauxAutoconso >= threshold - EPS) recommendedKwc = kwc;
  }
  return { recommendedKwc };
}

/** Scénarios Recommandé / −1 palier (sobre) / +1 palier (confort), clampés [stepKwc, maxKwc]. */
export function buildScenarios({ recommendedKwc, stepKwc, maxKwc }) {
  const candidates = [
    { key: 'sobre', label: 'Sobre', kwc: recommendedKwc - stepKwc },
    { key: 'recommande', label: 'Recommandé', kwc: recommendedKwc },
    { key: 'confort', label: 'Confort', kwc: recommendedKwc + stepKwc },
  ];
  return candidates.filter((c) => c.kwc >= stepKwc - 1e-9 && c.kwc <= maxKwc + 1e-9)
    .map((c) => ({ ...c, kwc: Math.round(c.kwc * 100) / 100 }));
}
```

- [ ] **Step 4 : Vérifier** — `node --test scripts/pv-engine.test.mjs` → tous PASS (≈ 14 tests).

- [ ] **Step 5 : Commit** — `feat(solaire): moteur PV - tableau annuel, optimiseur, scenarios`.

---

## Stage C — Edge function `pvgis-proxy`

### Task C1 : Valider le shape PVGIS réel, coder, déployer

**Files:**
- Create: `supabase/functions/pvgis-proxy/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1 : Vérifier le shape de la réponse PVGIS** (sanity check des hypothèses de parsing)

```powershell
curl.exe -s "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?lat=43.9&lon=1.9&peakpower=1&loss=14&angle=10&aspect=0&outputformat=json" | ConvertFrom-Json | ForEach-Object { $_.outputs.monthly.fixed.Count; $_.outputs.totals.fixed.E_y }
```
Expected : `12` puis une valeur ~`1300-1500` (kWh/kWc/an dans le Tarn). Si le shape diffère, ajuster le parsing de l'edge AVANT déploiement.

- [ ] **Step 2 : Écrire `supabase/functions/pvgis-proxy/index.ts`**

```ts
// pvgis-proxy — relais CORS vers PVGIS v5.2 PVcalc (PVGIS n'envoie pas d'en-têtes CORS).
// verify_jwt:true + requireOrgMembership : réservé aux users authentifiés d'une org.
// peakpower=1 FORCÉ côté serveur : la production est linéaire en kWc, le front
// multiplie — 1 seul appel PVGIS par simulation (spec §7.1).
import { requireOrgMembership, jsonResponse, sanitizeError, buildCorsHeaders } from "../_shared/auth.ts";

const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc";

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  try {
    const auth = await requireOrgMembership(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const lat = num(body.lat);
    const lon = num(body.lon);
    const loss = num(body.loss) ?? 14;
    const angle = num(body.angle) ?? 10;
    const aspect = num(body.aspect) ?? 0;

    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return jsonResponse({ error: "lat/lon invalides" }, 400, req);
    }
    if (loss < 0 || loss > 30 || angle < 0 || angle > 90 || aspect < -180 || aspect > 180) {
      return jsonResponse({ error: "Parametres hors bornes" }, 400, req);
    }

    const params = new URLSearchParams({
      lat: String(lat), lon: String(lon), peakpower: "1", loss: String(loss),
      angle: String(angle), aspect: String(aspect), outputformat: "json",
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${PVGIS_URL}?${params}`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return jsonResponse({ error: `PVGIS a repondu ${res.status}`, detail }, 502, req);
    }

    const data = await res.json();
    const monthly = data?.outputs?.monthly?.fixed;
    const eY = data?.outputs?.totals?.fixed?.E_y;
    if (!Array.isArray(monthly) || monthly.length !== 12 || typeof eY !== "number") {
      return jsonResponse({ error: "Reponse PVGIS inattendue" }, 502, req);
    }

    const e_m = monthly.map((m: { E_m: number }) => m.E_m);
    return jsonResponse(
      { e_m, e_y: eY, params: { lat, lon, loss, angle, aspect, peakpower: 1 } },
      200, req,
    );
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return jsonResponse(
      { error: aborted ? "PVGIS ne repond pas (timeout)" : sanitizeError(err, "pvgis-proxy error") },
      aborted ? 504 : 500, req,
    );
  }
});
```

- [ ] **Step 3 : Ajouter à `supabase/config.toml`** (section « Edges appelées par le frontend authentifié ») :

```toml
[functions.pvgis-proxy]
verify_jwt = true
```

- [ ] **Step 4 : Déployer via MCP `deploy_edge_function`** — name `pvgis-proxy`, `verify_jwt: true`, files : `index.ts` + le helper avec le name **`../_shared/auth.ts`** (gotcha bundler, cf. CLAUDE.md).

- [ ] **Step 5 : Vérifier** — appel sans JWT → 401 attendu :

```powershell
curl.exe -s -o NUL -w "%{http_code}" -X POST "https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/pvgis-proxy" -H "Content-Type: application/json" -d "{}"
```
Expected : `401`. (Le test authentifié complet se fait depuis l'app au Stage G4 + MCP `get_logs`.)

- [ ] **Step 6 : Commit** — `git add supabase/functions/pvgis-proxy/index.ts supabase/config.toml` puis `feat(solaire): edge function pvgis-proxy (PVcalc 1kWc, requireOrgMembership)`.

---

## Stage D — Couche data front (cache keys, service, hooks)

### Task D1 : `pvKeys` + `pv.service.js` + `usePvSimulations.js`

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js` (append en fin des familles)
- Create: `src/shared/services/pv.service.js`
- Create: `src/shared/hooks/usePvSimulations.js`

- [ ] **Step 1 : Ajouter la famille `pvKeys` dans `cacheKeys.js`**

```js
// --- PV / Solaire ---
export const pvKeys = {
  all: (orgId) => ['pv', orgId],
  simulations: (orgId) => [...pvKeys.all(orgId), 'simulations'],
  list: (orgId, filters) => [...pvKeys.simulations(orgId), filters],
  detail: (orgId, id) => [...pvKeys.simulations(orgId), 'detail', id],
};
```

- [ ] **Step 2 : Créer `src/shared/services/pv.service.js`**

```js
// src/shared/services/pv.service.js
// CRUD simulations PV via la vue publique majordhome_pv_simulations
// (security_invoker + auto-updatable). RLS : le commercial ne voit que les
// siennes, org_admin voit tout. org_id filtré explicitement (défense en profondeur).
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { escapePostgrestSearchTerm } from '@lib/postgrestUtils';

const VIEW = 'majordhome_pv_simulations';
const LIST_COLUMNS = 'id, client_name, client_address, lat, lon, created_by, results, created_at';

export const pvService = {
  /** Liste paginée des simulations (recherche par nom client). */
  async list({ orgId, search = '', page = 0, pageSize = 25 }) {
    return withErrorHandling(async () => {
      let query = supabase
        .from(VIEW)
        .select(LIST_COLUMNS, { count: 'exact' })
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (search.trim()) {
        const term = escapePostgrestSearchTerm(search.trim());
        query = query.ilike('client_name', `%${term}%`);
      }
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    }, 'pv.list');
  },

  /** Détail complet (inputs + pvgis_monthly + results) pour rechargement à l'identique. */
  async getById(orgId, id) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .select('*')
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'pv.getById');
  },

  /** Enregistre une simulation. */
  async create({ orgId, userId, clientName, clientAddress, lat, lon, inputs, pvgisMonthly, results, comment }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .insert({
          org_id: orgId,
          created_by: userId,
          client_name: clientName || null,
          client_address: clientAddress || null,
          lat: lat ?? null,
          lon: lon ?? null,
          inputs,
          pvgis_monthly: pvgisMonthly,
          results,
          comment: comment || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    }, 'pv.create');
  },

  /** Supprime une simulation (owner ou org_admin via RLS). */
  async remove(orgId, id) {
    return withErrorHandling(async () => {
      const { error } = await supabase
        .from(VIEW)
        .delete()
        .eq('org_id', orgId)
        .eq('id', id);
      if (error) throw error;
      return true;
    }, 'pv.remove');
  },
};
```

- [ ] **Step 3 : Créer `src/shared/hooks/usePvSimulations.js`**

```js
// src/shared/hooks/usePvSimulations.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { pvService } from '@services/pv.service';
import { pvKeys } from './cacheKeys';

export { pvKeys } from './cacheKeys';

/** Liste des simulations (RLS : les miennes, ou toutes si org_admin). */
export function usePvSimulations({ search = '', page = 0 } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: pvKeys.list(orgId, { search, page }),
    queryFn: async () => {
      const { data, error } = await pvService.list({ orgId, search, page });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

/** Détail complet pour rechargement à l'identique. */
export function usePvSimulation(id) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: pvKeys.detail(orgId, id),
    queryFn: async () => {
      const { data, error } = await pvService.getById(orgId, id);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!id,
  });
}

export function usePvSimulationMutations() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const createSimulation = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await pvService.create({ ...payload, orgId, userId: user?.id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pvKeys.all(orgId) }),
  });

  const deleteSimulation = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await pvService.remove(orgId, id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pvKeys.all(orgId) }),
  });

  return { createSimulation, deleteSimulation };
}
```

- [ ] **Step 4 : Vérifier** — `npm run lint:errors` puis `npx vite build` → 0 erreur.

- [ ] **Step 5 : Commit** — `feat(solaire): couche data simulations (pvKeys, pv.service, usePvSimulations)`.

---

## Stage E — Lib front PVGIS / géocodage / géoloc

### Task E1 : `src/apps/solaire/lib/pvgis.js`

**Files:** Create: `src/apps/solaire/lib/pvgis.js`

- [ ] **Step 1 : Écrire le module**

```js
// src/apps/solaire/lib/pvgis.js
// Accès externes de l'app Solaire : edge function pvgis-proxy (PVGIS 1 kWc),
// géocodage data.gouv (CORS OK, direct), géolocalisation device.
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';

/**
 * Production mensuelle à 1 kWc pour un lieu/toiture donnés.
 * → { data: { e_m: number[12], e_y, params }, error }
 */
export async function fetchPvgis1kwc({ lat, lon, loss, angleDeg, aspect }) {
  try {
    const { data, error } = await supabase.functions.invoke('pvgis-proxy', {
      body: { lat, lon, loss, angle: angleDeg, aspect },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return { data, error: null };
  } catch (err) {
    logger.error('[pvgis] fetchPvgis1kwc', err);
    return { data: null, error: err };
  }
}

/** Autocomplétion adresse via api-adresse.data.gouv.fr → [{ label, lat, lon, city, postcode }]. */
export async function searchAddress(query) {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`api-adresse ${res.status}`);
    const json = await res.json();
    const results = (json.features ?? []).map((f) => ({
      label: f.properties.label,
      city: f.properties.city,
      postcode: f.properties.postcode,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
    return { data: results, error: null };
  } catch (err) {
    logger.error('[pvgis] searchAddress', err);
    return { data: [], error: err };
  }
}

/** Position GPS du device → Promise<{ lat, lon, accuracy }>. Rejette si refus/indispo. */
export function getDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Géolocalisation non disponible sur cet appareil'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => reject(new Error(
        err.code === 1 ? 'Géolocalisation refusée — saisissez une adresse' : 'Position introuvable — saisissez une adresse',
      )),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
```

- [ ] **Step 2 : Vérifier** — `npm run lint:errors` → 0 erreur. (`audit:dead-code` signalera les fichiers solaire tant que les routes n'existent pas — attendu jusqu'au Stage G1.)

- [ ] **Step 3 : Commit** — `feat(solaire): lib pvgis (proxy, geocodage data.gouv, geoloc device)`.

---

## Stage F — Page admin `/settings/solaire`

### Task F1 : `SolaireSettings.jsx` + route + tile Settings

**Files:**
- Create: `src/apps/artisan/pages/settings/SolaireSettings.jsx`
- Modify: `src/apps/artisan/routes.jsx` (lazy import + route `settings/solaire`)
- Modify: `src/apps/artisan/pages/Settings.jsx` (tile)

- [ ] **Step 1 : Route + tile**

Dans `routes.jsx` : `const SolaireSettings = lazy(() => import('./pages/settings/SolaireSettings'));` + entrée (à côté de `settings/pricing`) :

```jsx
{
  path: 'settings/solaire',
  element: (
    <SuspenseWrapper>
      <RouteGuard resource="settings">
        <SolaireSettings />
      </RouteGuard>
    </SuspenseWrapper>
  ),
},
```

Dans `Settings.jsx` : ajouter `Sun` à l'import lucide + section (après « Tarification ») :

```js
{
  title: 'Solaire',
  icon: Sun,
  description: 'Paramètres du calculateur photovoltaïque et grille de coûts',
  href: '/settings/solaire',
  adminOnly: true,
},
```

- [ ] **Step 2 : Créer la page** — gabarit OrganizationSettings (guard `isOrgAdmin` in-component → `<Navigate to="/settings" replace />`), state local par onglet + `isDirty` via `JSON.stringify` diff, **save en bloc** :

```jsx
// Squelette structurel (compléter les champs selon §6 de la spec) :
import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildPvConfig } from '@apps/solaire/lib/pvConfig';

const TABS = [
  { id: 'calcul', label: 'Paramètres calcul' },
  { id: 'grille', label: 'Grille de coûts' },
  { id: 'simultaneite', label: 'Simultanéité & VE' },
];

export default function SolaireSettings() {
  const { isOrgAdmin } = useAuth();
  const { settings, isLoading, save, isSaving } = useOrgSettings();
  const [tab, setTab] = useState('calcul');
  const initial = useMemo(() => buildPvConfig(settings), [settings]);
  const [form, setForm] = useState(null); // initialisé depuis `initial` au premier render utile
  // ... isDirty = JSON.stringify(form) !== JSON.stringify(initial)
  // Save : TOUJOURS l'objet pv complet (org_update_settings merge au niveau 1) :
  const handleSave = async () => {
    try {
      await save({ pv: form });
      toast.success('Paramètres solaire enregistrés');
    } catch (err) {
      toast.error(`Échec de l'enregistrement : ${err.message}`);
    }
  };
  if (!isOrgAdmin) return <Navigate to="/settings" replace />;
  // ... rendu 3 onglets
}
```

Contenu des onglets (champs = shape `settings.pv`, spec §6) :
1. **Paramètres calcul** : `default_price_kwh`, `inflation_rate`, `degradation_rate`, `horizon_years`, `system_loss`, `panel_power_wc`, `panel_area_m2`, `default_tilt_percent`, `autoconso_threshold`, `default_loan_rate`, `default_loan_years`, `vat_rate`. Inputs numériques avec `FormField`/`TextInput` de `FormFields.jsx`, taux affichés en % (stockés en fraction : afficher `value*100`, parser `/100`).
2. **Grille de coûts** : tableau éditable `[{ kwc, prix_ttc }]` — ajout de ligne (kWc entre 1 et 9, pas 0,5), suppression (X), tri par kWc au save, validation : pas de doublon kWc, prix > 0. État vide : encart « Grille vide — le coût sera saisi manuellement par le commercial à chaque simulation ».
3. **Simultanéité & VE** : les 3 presets + `bonus_ecs` + `bonus_ve` + `cap` ; bloc VE : `ev.charger_price`, `ev.home_charge_share`, `ev.default_km`, `ev.default_kwh_100km`.

- [ ] **Step 3 : Vérifier** — `npm run lint:errors` + `npx vite build` → 0 erreur. Validation manuelle Eric : ouvrir `/settings/solaire`, modifier le prix kWh, sauver, recharger la page → valeur persistée.

- [ ] **Step 4 : Commit** — `feat(solaire): page admin /settings/solaire (parametres, grille de couts, simultaneite)`.

---

## Stage G — App Solaire (wizard + historique)

### Task G1 : Squelette app — reducer, draft, routes, sidebar

**Files:**
- Create: `src/apps/solaire/lib/wizardState.js`
- Create: `src/apps/solaire/lib/palette.js`
- Create: `src/apps/solaire/pages/Simulateur.jsx` (squelette 3 steps placeholder)
- Create: `src/apps/solaire/pages/Historique.jsx` (squelette)
- Modify: `src/apps/artisan/routes.jsx`
- Modify: `src/layouts/AppLayout.jsx`

- [ ] **Step 1 : `palette.js`** — palette deutan unique pour toute l'app :

```js
// src/apps/solaire/lib/palette.js
// Palette deutan (spec §10.1) — JAMAIS de rouge/vert, jamais de couleur seule.
export const PV_COLORS = {
  production: '#F5C542',   // jaune — remplissages graphiques uniquement
  productionLight: '#FFD166',
  conso: '#0D47A1',        // bleu foncé
  autoconso: '#2196F3',    // bleu clair
  blueMid: '#1565C0',
  surplus: '#9CA3AF',      // gris (hachuré dans les charts)
};
```

- [ ] **Step 2 : `wizardState.js`** — reducer + draft localStorage :

```js
// src/apps/solaire/lib/wizardState.js
// State machine du wizard (>10 useState interdit — convention qualité).
// Draft persisté localStorage `pv-draft:${userId}` (convention P1.9).
import { logger } from '@lib/logger';

export function initialWizardState(config) {
  return {
    step: 1,
    location: { lat: null, lon: null, address: '', accuracy: null, source: null }, // source: 'gps'|'adresse'
    roof: { tiltPercent: config.default_tilt_percent, orientation: 'S', surfaceM2: '' },
    conso: { monthly: Array(12).fill(''), priceKwh: config.default_price_kwh, preset: 'presence_partielle', ecsBonus: false },
    ev: { enabled: false, kmPerYear: config.ev.default_km, kwhPer100km: config.ev.default_kwh_100km, pilotedCharge: false, addCharger: false },
    pvgis: null,            // { e_m, e_y, params } — posé à l'entrée du step 3
    selectedKwc: null,      // scénario sélectionné (null = recommandé)
    financing: { rate: config.default_loan_rate, years: config.default_loan_years, deposit: 0, manualCost: null },
  };
}

export function wizardReducer(state, action) {
  switch (action.type) {
    case 'SET_STEP': return { ...state, step: action.step };
    case 'SET_LOCATION': return { ...state, location: { ...state.location, ...action.patch }, pvgis: null };
    case 'SET_ROOF': return { ...state, roof: { ...state.roof, ...action.patch }, pvgis: null };
    case 'SET_CONSO': return { ...state, conso: { ...state.conso, ...action.patch } };
    case 'SET_EV': return { ...state, ev: { ...state.ev, ...action.patch } };
    case 'SET_PVGIS': return { ...state, pvgis: action.pvgis };
    case 'SELECT_KWC': return { ...state, selectedKwc: action.kwc };
    case 'SET_FINANCING': return { ...state, financing: { ...state.financing, ...action.patch } };
    case 'LOAD': return { ...action.state };
    case 'RESET': return initialWizardState(action.config);
    default: return state;
  }
}
// NB : changer lieu/toiture invalide le cache PVGIS (pvgis: null) → re-fetch au step 3.

export const draftKey = (userId) => `pv-draft:${userId}`;

export function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn('[solaire] draft illisible', err);
    return null;
  }
}

export function saveDraft(userId, state) {
  try { localStorage.setItem(draftKey(userId), JSON.stringify(state)); } catch { /* quota plein : best effort */ }
}

export function clearDraft(userId) {
  try { localStorage.removeItem(draftKey(userId)); } catch { /* no-op */ }
}
```

- [ ] **Step 3 : `Simulateur.jsx` squelette** — `useReducer(wizardReducer, ...)`, config via `buildPvConfig(useOrgSettings().settings)`, draft chargé au mount (toast « Brouillon restauré » + bouton « Repartir de zéro »), `useEffect` de sauvegarde draft (debounce 1 s), stepper visuel 1-2-3 (numéro + libellé, pas seulement couleur), 3 placeholders `<Step1/2/3 …/>` câblés aux dispatch.

- [ ] **Step 4 : Routes + sidebar**

`routes.jsx` : lazy imports `Simulateur`/`Historique` depuis `@apps/solaire/pages/...` + 2 routes gardées :

```jsx
{
  path: 'solaire',
  element: (
    <SuspenseWrapper>
      <RouteGuard resource="pv_calculator">
        <Simulateur />
      </RouteGuard>
    </SuspenseWrapper>
  ),
},
{
  path: 'solaire/historique',
  element: (
    <SuspenseWrapper>
      <RouteGuard resource="pv_calculator">
        <Historique />
      </RouteGuard>
    </SuspenseWrapper>
  ),
},
```

`AppLayout.jsx` : ajouter `Sun` à l'import lucide + dans `navigation` (après Meta Ads) :

```js
{ name: 'Solaire', href: '/solaire', icon: Sun, resource: 'pv_calculator' },
```

- [ ] **Step 5 : Vérifier** — `npm run lint:errors` + `npx vite build` → 0 erreur. Validation manuelle : entrée « Solaire » visible pour org_admin/commercial, absente pour technicien ; `/solaire` affiche le stepper.

- [ ] **Step 6 : Commit** — `feat(solaire): squelette app /solaire (wizard reducer, draft, routes, sidebar)`.

### Task G2 : Step 1 — Localisation & toiture

**Files:**
- Create: `src/apps/solaire/components/Step1Localisation.jsx`
- Modify: `src/apps/solaire/pages/Simulateur.jsx` (brancher)

- [ ] **Step 1 : Implémenter le composant.** Props : `{ location, roof, config, onLocation, onRoof, onNext }`.
  - Bouton « 📍 Me localiser » → `getDevicePosition()` ; pending state ; succès → `onLocation({ lat, lon, accuracy, source: 'gps' })` + affichage « Position ±Xm » ; échec → toast erreur + focus champ adresse (fallback spec §7.3).
  - Champ adresse : autocomplétion `searchAddress` (via `useDebounce` 300 ms, min 3 caractères), liste de 5 suggestions cliquables → `onLocation({ lat, lon, address: label, source: 'adresse' })`.
  - Pente : input numérique % + conversion live `≈ X°` (`percentToDegrees`, arrondi 1 décimale).
  - Orientation : 8 boutons boussole (N/NE/E/SE/S/SO/O/NO, grid 3×3 avec centre vide) + champ degrés optionnel. Si N/NE/NO ou aspect |>135°| → encart avertissement « ⚠️ Orientation défavorable » (icône + texte, fond `bg-secondary-100`).
  - Surface : input m² + affichage live « → max N panneaux soit X kWc » (`maxPowerKwc`).
  - Bouton « Continuer » disabled tant que `lat/lon` absents ou surface vide ; clavier numérique mobile (`inputMode="decimal"`).
- [ ] **Step 2 : Vérifier** — `npm run lint:errors` + `npx vite build`. Validation manuelle Eric (GPS sur device réel + adresse).
- [ ] **Step 3 : Commit** — `feat(solaire): step 1 localisation & toiture (GPS, adresse, pente, orientation, surface)`.

### Task G3 : Step 2 — Consommation + bloc VE

**Files:**
- Create: `src/apps/solaire/components/Step2Consommation.jsx`
- Modify: `src/apps/solaire/pages/Simulateur.jsx` (brancher)

- [ ] **Step 1 : Implémenter.** Props : `{ conso, ev, config, onConso, onEv, onBack, onNext }`.
  - Grille 12 mois (Janv→Déc, 2 colonnes mobile / 4 desktop), `inputMode="numeric"`, total annuel live en pied.
  - Bouton « Répartir depuis l'annuel » : prompt inline (input total + bouton Appliquer) → `spreadAnnualToMonthly` arrondi entier → remplit les 12 champs (ajustables ensuite).
  - Prix kWh : input € (défaut `config.default_price_kwh`).
  - Profil de présence : 3 cards radio (libellés spec §8.2 : « Présence en journée », « Présence partielle », « Absent en journée ») + checkbox « Pilotage ECS / domotique (+10 %) ».
  - **Bloc repliable « Véhicule électrique »** (Radix Collapsible) : toggle `enabled` ; si actif : km/an, kWh/100 km, checkbox « Recharge pilotée en journée (+10 %) », checkbox « Ajouter la borne de recharge » (si `config.ev.charger_price` null → mention « prix borne non configuré — sera ajouté manuellement au coût »). Affichage live « dont VE : X kWh/an » (`evMonthlyConsumption × 12`).
  - « Continuer » disabled si les 12 mois ne sont pas tous renseignés (0 accepté) ou prix kWh vide.
- [ ] **Step 2 : Vérifier** — lint + build. Manuel : répartir 12 000 kWh → janvier 1440.
- [ ] **Step 3 : Commit** — `feat(solaire): step 2 consommation (12 mois, repartition annuelle, presence, bloc VE)`.

### Task G4 : Step 3 — Résultats (scénarios, graphiques, financement, tableau annuel)

**Files:**
- Create: `src/apps/solaire/components/Step3Resultats.jsx`
- Create: `src/apps/solaire/components/ScenarioCards.jsx`
- Create: `src/apps/solaire/components/MonthlyChart.jsx`
- Create: `src/apps/solaire/components/FinancingModule.jsx`
- Create: `src/apps/solaire/components/TableauAnnuel.jsx`
- Modify: `src/apps/solaire/pages/Simulateur.jsx` (brancher + fetch PVGIS)

- [ ] **Step 1 : Fetch PVGIS à l'entrée du step 3** (dans `Simulateur.jsx`) : si `state.pvgis === null` → `fetchPvgis1kwc({ lat, lon, loss: config.system_loss, angleDeg: percentToDegrees(roof.tiltPercent), aspect: orientationToAspect(roof.orientation) })`. Pending : spinner + « Interrogation PVGIS… ». Erreur : encart icône + message + bouton « Réessayer » (critère #7, jamais d'écran blanc). Succès : `dispatch SET_PVGIS`.

- [ ] **Step 2 : Pipeline de calcul** (useMemo dans `Step3Resultats`) :

```js
const consoMonthly = useMemo(() => {
  const base = conso.monthly.map(Number);
  if (!ev.enabled) return base;
  const evM = evMonthlyConsumption({ kmPerYear: +ev.kmPerYear, kwhPer100km: +ev.kwhPer100km, homeChargeShare: config.ev.home_charge_share });
  return base.map((v) => v + evM);
}, [conso.monthly, ev, config]);
const coeff = simultaneityCoeff({ preset: conso.preset, ecsBonus: conso.ecsBonus, evBonus: ev.enabled && ev.pilotedCharge }, config.simultaneity);
const maxKwc = maxPowerKwc(+roof.surfaceM2, config.panel_area_m2, config.panel_power_wc);
const stepKwc = config.panel_power_wc / 1000;
const { recommendedKwc } = optimize({ eM1kwc: pvgis.e_m, consoMonthly, coeff, threshold: config.autoconso_threshold, maxKwc, stepKwc });
const scenarios = buildScenarios({ recommendedKwc, stepKwc, maxKwc });
// Par scénario : computeMonthly + costFromGrid + buildYearlyTable → indicateurs cards
const activeKwc = selectedKwc ?? recommendedKwc;
```

- [ ] **Step 3 : `ScenarioCards.jsx`** — 3 cards (`Sobre` / `Recommandé` ★ / `Confort`), sélectionnée = ring bleu `#1565C0` + badge « Sélectionné » (jamais couleur seule). Contenu par card : kWc + nb panneaux, taux d'autoconso %, **% surplus perdu** (icône poubelle grise + « perdu » — doit visiblement grimper sur Confort, argument anti-survente), économie an 1 €, effort net mensuel moyen (▲ « effort » / ▼ « gain » / « — » si coût inconnu). Clic → `onSelect(kwc)`.

- [ ] **Step 4 : `MonthlyChart.jsx`** — Recharts `BarChart` (12 mois) : barres production (`PV_COLORS.production`), conso (`PV_COLORS.conso`), autoconsommée (`PV_COLORS.autoconso`), surplus **hachuré gris** via pattern SVG :

```jsx
<BarChart data={chartData}>
  <defs>
    <pattern id="pvHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="#E5E7EB" />
      <line x1="0" y1="0" x2="0" y2="6" stroke="#9CA3AF" strokeWidth="2" />
    </pattern>
  </defs>
  {/* ... XAxis mois, YAxis kWh, Tooltip, Legend avec libellés texte ... */}
  <Bar dataKey="production" name="Production" fill={PV_COLORS.production} />
  <Bar dataKey="conso" name="Consommation" fill={PV_COLORS.conso} />
  <Bar dataKey="autoconso" name="Autoconsommée" fill={PV_COLORS.autoconso} />
  <Bar dataKey="surplus" name="Surplus perdu" fill="url(#pvHatch)" />
</BarChart>
```

- [ ] **Step 5 : `FinancingModule.jsx`** — champs taux % / durée années / apport € + **coût installation** : pré-rempli `costFromGrid(config.cost_grid, activeKwc)` (arrondi), éditable ; si `null` → champ vide + hint « Grille de coûts non renseignée pour cette puissance — saisir le montant de l'offre ». Si VE borne cochée et `charger_price` non null → ligne « + borne : X € » incluse. Mensualité recalculée live (`monthlyPayment({ capital: coût − apport, … })`), affichée en gros + comparaison « vs économie mensuelle moyenne an 1 ».

- [ ] **Step 6 : `TableauAnnuel.jsx`** — `buildYearlyTable` → 3 indicateurs de tête (cards : Effort mensuel moyen pendant le crédit avec ▲/▼, Année de neutralité, Gain total sur 25 ans), puis table scrollable : Année / Économie / Annuité / Effort net (▲ « effort » bleu foncé ou ▼ « gain » bleu `#1565C0` + montant) / Cumul. Lignes marquées : année de neutralité (ring + badge « Neutralité »), fin de crédit (séparateur épais + badge « Crédit terminé »). Graphique cumul (Recharts `AreaChart` bleu clair + `ReferenceLine y=0` gris + dot au point de bascule). Récap conso : si VE actif, ligne « dont véhicule électrique : X kWh/an ».

- [ ] **Step 7 : Vérifier** — lint + build ; manuel Eric : simulation complète Gaillac, cohérence des chiffres avec un calcul à la main (mensualité 12 000 € / 4,5 % / 12 ans ≈ 108 €/mois), toggle VE → tout se recalcule (critère #9).

- [ ] **Step 8 : Commit** — `feat(solaire): step 3 resultats (scenarios, graphiques, financement, tableau annuel)`.

### Task G5 : Enregistrement + Historique

**Files:**
- Modify: `src/apps/solaire/components/Step3Resultats.jsx` (bouton Enregistrer + modale nom/commentaire)
- Modify: `src/apps/solaire/pages/Historique.jsx` (liste complète)
- Modify: `src/apps/solaire/pages/Simulateur.jsx` (mode rechargement)

- [ ] **Step 1 : Enregistrer.** Modale (nom client requis, commentaire optionnel) → `createSimulation` avec :

```js
{
  clientName, clientAddress: state.location.address, lat: state.location.lat, lon: state.location.lon,
  inputs: { location: state.location, roof: state.roof, conso: state.conso, ev: state.ev, financing: state.financing, selectedKwc: activeKwc },
  pvgisMonthly: state.pvgis,
  results: { recommendedKwc, selectedKwc: activeKwc, indicators, tauxAutoconso, tauxAutoproduction, economyYear1 },
  comment,
}
```
Succès → toast + `clearDraft(userId)`.

- [ ] **Step 2 : Historique.** `usePvSimulations({ search, page })` + `SearchBar` partagée (`@apps/artisan/components/shared/SearchBar`), cards : nom client, adresse, date (`formatDateShortFR`), kWc retenu + économie an 1 (depuis `results`), boutons « Recharger » + « Supprimer » (ConfirmDialog destructive). Lien croisé : bouton « Historique » dans le header du Simulateur, bouton « Nouvelle simulation » dans Historique.

- [ ] **Step 3 : Rechargement à l'identique.** « Recharger » → navigue `/solaire?sim=<id>` ; `Simulateur` lit le param, `usePvSimulation(id)` → `dispatch({ type: 'LOAD', state: { ...initialWizardState(config), ...sim.inputs, pvgis: sim.pvgis_monthly, step: 3, selectedKwc: sim.inputs.selectedKwc } })`. **Aucun nouvel appel PVGIS** (critère #8 — `pvgis_monthly` persisté fait foi).

- [ ] **Step 4 : Vérifier** — lint + build ; manuel : enregistrer, retrouver dans l'historique, recharger → mêmes chiffres à l'identique, recherche par nom OK.

- [ ] **Step 5 : Commit** — `feat(solaire): enregistrement + historique + rechargement a l'identique`.

---

## Stage H — Vérifications finales & clôture

### Task H1 : Qualité, critères d'acceptation, doc

- [ ] **Step 1 :** `node --test scripts/pv-engine.test.mjs` → tous PASS.
- [ ] **Step 2 :** `npm run audit:quality` (lint:errors + dead-code) → 0 erreur, aucun fichier solaire orphelin.
- [ ] **Step 3 :** `npx vite build` → succès.
- [ ] **Step 4 : Passer les 10 critères d'acceptation de la spec** (§12) un par un, consigner le résultat dans le message de synthèse à Eric. Les critères 1 (mobile < 5 min) et 7 (PVGIS down) = validation manuelle Eric sur device.
- [ ] **Step 5 :** Appender une entrée PENDING dans `.claude/proposed-updates.md` (section « Module Solaire » candidate pour CLAUDE.md : routes, table/vue, settings.pv, edge pvgis-proxy, permission, moteur pur + tests node). **Ne PAS éditer CLAUDE.md sans accord d'Eric.**
- [ ] **Step 6 :** `git push` après validation manuelle d'Eric (jamais avant), en rapportant la liste exacte des commits poussés.

---

## Self-review du plan (fait à la rédaction)

- **Couverture spec** : §1 (surplus 0 € → engine + UI « perdu »), §3 (parcours 3 étapes G2-G4), §4 (G1 squelette/draft), §5 (A1-A2), §6 (F1), §7 (C1 + E1), §8 (B1-B3), §9 (B3 optimize/buildScenarios + G4), §10 (palette.js + composants G2-G4), §11 (rien d'hors-scope dans le plan), §12 (H1). ✓
- **Cohérence types** : `costFromGrid(grid, powerKwc)` / `monthlyPayment({capital, annualRate, years})` / `buildYearlyTable → {rows, indicators}` utilisés à l'identique dans B et G. `pvgis_monthly = { e_m, e_y, params }` partout (edge → service → reload). ✓
- **Gotchas repo intégrés** : vue mono-table auto-updatable, GRANT service_role, `escapePostgrestSearchTerm`, `name: '../_shared/auth.ts'` au deploy, save settings.pv en bloc, clé draft suffixée userId, pas de preview tools. ✓
