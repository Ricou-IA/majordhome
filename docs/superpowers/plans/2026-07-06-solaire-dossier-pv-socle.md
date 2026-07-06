# Dossier PV — Socle données (Tranche 1 · Plan 1/4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser l'entité `majordhome.pv_dossiers` (accumulateur write-once du parcours PV) avec sa machine à états forward-only, exposée au frontend via service + hook, sans encore aucun générateur de document ni appel externe.

**Architecture:** Table `majordhome.pv_dossiers` (miroir de `pv_simulations` : RLS owner-or-admin, vue publique `security_invoker` auto-updatable, GRANT service_role). Le `status` n'est muté que par la RPC SECURITY DEFINER `pv_dossier_advance` (forward-only), doublée d'un trigger DB backstop qui interdit toute régression de statut. Service/hook calqués sur `pv.service.js` / `usePvSimulations.js`. Une lib pure `pvDossierStatus.js` (testée `node --test`) porte l'ordre des états pour le gating UI.

**Tech Stack:** Supabase (PostgreSQL + RLS + RPC plpgsql), PostgREST via vue publique, React Query v5, JSX. Migration appliquée via MCP Supabase (prod partagée — **checkpoint Eric obligatoire**).

**Spec source:** `docs/superpowers/specs/2026-07-06-solaire-chainage-dossier-pv-tranche1-design.md` (§4 modèle de données, §8 sécurité).

---

## File Structure

| Fichier | Responsabilité | Action |
|---|---|---|
| `src/apps/solaire/lib/pvDossierStatus.js` | Ordre des états + `canAdvance()` (pur, testable, miroir client de la règle forward-only) | Create |
| `scripts/pv-dossier-status.test.mjs` | Tests `node --test` de la lib pure | Create |
| `sql/migration_pv_dossiers.sql` | Copie versionnée : table + indexes + RLS + vue + RPC + trigger | Create |
| `src/shared/hooks/cacheKeys.js` | Ajout famille `pvDossierKeys` | Modify |
| `src/shared/services/pvDossier.service.js` | CRUD via vue publique (`org_id` explicite) + `advance` via RPC | Create |
| `src/shared/hooks/usePvDossier.js` | React Query : lecture par simulation + mutations upsert/patch/advance | Create |

**Hors de ce plan** (plans 2-4) : `google-solar-proxy`, `google_solar_cache`, `googleSolar.js`, `cadastre.js`, composants UI (`DossierTab`, `CadastrePicker`, `ValidateDossierModal`), `fillCerfa.js`, `NoticePDF.jsx`, la conversion azimut dans `pvEngine.js`.

---

## Task 1 : Lib pure `pvDossierStatus.js` (ordre des états, forward-only)

**Files:**
- Create: `src/apps/solaire/lib/pvDossierStatus.js`
- Test: `scripts/pv-dossier-status.test.mjs`

- [ ] **Step 1 : Écrire le test qui échoue**

Create `scripts/pv-dossier-status.test.mjs` :
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PV_DOSSIER_STATUSES,
  statusRank,
  canAdvance,
} from '../src/apps/solaire/lib/pvDossierStatus.js';

test('les 7 états sont ordonnés, offre en premier', () => {
  assert.equal(PV_DOSSIER_STATUSES[0], 'offre');
  assert.equal(PV_DOSSIER_STATUSES.length, 7);
  assert.equal(PV_DOSSIER_STATUSES.at(-1), 'projet_en_service');
});

test('statusRank : rang croissant, null si inconnu', () => {
  assert.equal(statusRank('offre'), 0);
  assert.equal(statusRank('dossier_valide'), 1);
  assert.equal(statusRank('inconnu'), null);
});

test('canAdvance : autorise strictement vers l’avant', () => {
  assert.equal(canAdvance('offre', 'dossier_valide'), true);
  assert.equal(canAdvance('offre', 'projet_en_service'), true);
});

test('canAdvance : refuse la régression et le sur-place', () => {
  assert.equal(canAdvance('dossier_valide', 'offre'), false); // jamais redescendre
  assert.equal(canAdvance('offre', 'offre'), false);          // pas de no-op autorisé
});

test('canAdvance : refuse un état inconnu des deux côtés', () => {
  assert.equal(canAdvance('offre', 'inconnu'), false);
  assert.equal(canAdvance('inconnu', 'offre'), false);
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu’il échoue**

Run: `node --test scripts/pv-dossier-status.test.mjs`
Expected: FAIL — `Cannot find module '.../pvDossierStatus.js'`.

- [ ] **Step 3 : Écrire l’implémentation minimale**

Create `src/apps/solaire/lib/pvDossierStatus.js` :
```js
// src/apps/solaire/lib/pvDossierStatus.js
// Ordre canonique des états d'un dossier PV (miroir client de la règle forward-only
// appliquée en DB par la RPC pv_dossier_advance + le trigger backstop).
// PUR : aucun import React/Supabase — testé via node --test.
export const PV_DOSSIER_STATUSES = [
  'offre',
  'dossier_valide',
  'urbanisme_depose',
  'urbanisme_valide',
  'raccordement_enedis',
  'consuel_demande',
  'projet_en_service',
];

/** Rang de l'état dans l'ordre canonique, ou null si inconnu. */
export function statusRank(status) {
  const i = PV_DOSSIER_STATUSES.indexOf(status);
  return i === -1 ? null : i;
}

/** true si `to` est strictement en aval de `from` (jamais redescendre, jamais no-op). */
export function canAdvance(from, to) {
  const a = statusRank(from);
  const b = statusRank(to);
  if (a === null || b === null) return false;
  return b > a;
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu’il passe**

Run: `node --test scripts/pv-dossier-status.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/apps/solaire/lib/pvDossierStatus.js scripts/pv-dossier-status.test.mjs
git commit -m "feat(solaire): lib pure états dossier PV (forward-only) + tests"
```

---

## Task 2 : Migration `pv_dossiers` (table + RLS + vue + RPC + trigger)

**Files:**
- Create: `sql/migration_pv_dossiers.sql`

> **Pattern de référence** : `sql/migration_thermal_studies.sql` (table `majordhome.*` + RLS owner-or-admin + vue `security_invoker` auto-updatable + GRANT service_role). Ce plan ajoute la RPC forward-only + le trigger backstop, absents de thermal_studies.

- [ ] **Step 1 : Écrire le fichier de migration**

Create `sql/migration_pv_dossiers.sql` :
```sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Dossier PV (tranche 1, plan 1/4) — table majordhome.pv_dossiers + vue publique + RPC forward-only.
-- Pattern : miroir de majordhome.pv_simulations / thermal_studies (RLS owner-or-admin, vue
-- security_invoker auto-updatable, GRANT service_role — charte multi-tenant CLAUDE.md).
-- Le status n'est muté QUE par public.pv_dossier_advance (forward-only) ; trigger backstop DB.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Migration 1 : pv_dossiers_create ───────────────────────────────────────────────────────────
CREATE TABLE majordhome.pv_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),

  pv_simulation_id uuid UNIQUE REFERENCES majordhome.pv_simulations(id) ON DELETE SET NULL,
  lead_id          uuid REFERENCES majordhome.leads(id)                 ON DELETE SET NULL,
  client_id        uuid REFERENCES majordhome.clients(id)              ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'offre',

  cadastre      jsonb,   -- { commune_insee, parcelles:[{section,numero,superficie_m2}], geojson }
  roof_geometry jsonb,   -- { source, imagery_quality, segments, pitch_deg, azimuth_google_deg, aspect_pvgis, area_m2, flux_image_path }
  abf           jsonb,   -- { secteur_protege, source, checked_at }
  material      jsonb,   -- { module_marque, module_modele, module_aspect }
  declarant     jsonb,   -- { civilite, date_naissance, naissance_commune, naissance_departement }
  documents     jsonb,   -- { cerfa_pdf_path, notice_pdf_path, generated_at }

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- pv_simulation_id est UNIQUE (idempotence de la création lazy = 1 simulation → au plus 1 dossier).
CREATE INDEX idx_pv_dossiers_org_created ON majordhome.pv_dossiers(org_id, created_at DESC);
CREATE INDEX idx_pv_dossiers_lead   ON majordhome.pv_dossiers(lead_id)   WHERE lead_id   IS NOT NULL;
CREATE INDEX idx_pv_dossiers_client ON majordhome.pv_dossiers(client_id) WHERE client_id IS NOT NULL;

ALTER TABLE majordhome.pv_dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY pv_dossiers_select ON majordhome.pv_dossiers
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = pv_dossiers.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY pv_dossiers_insert ON majordhome.pv_dossiers
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY pv_dossiers_update ON majordhome.pv_dossiers
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = pv_dossiers.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY pv_dossiers_delete ON majordhome.pv_dossiers
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = pv_dossiers.org_id AND m.role = 'org_admin'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.pv_dossiers TO authenticated;
GRANT SELECT ON majordhome.pv_dossiers TO service_role;   -- charte (vue security_invoker)

-- ── Migration 2 : pv_dossiers_forward_only_trigger ─────────────────────────────────────────────
-- Backstop DB : la vue publique est updatable (front écrit les blocs jsonb), mais un UPDATE direct
-- ne doit JAMAIS faire régresser status. La RPC reste l'unique writer canonique de status.
CREATE OR REPLACE FUNCTION majordhome.pv_dossiers_forward_only_status()
  RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_arr constant text[] := ARRAY[
    'offre','dossier_valide','urbanisme_depose','urbanisme_valide',
    'raccordement_enedis','consuel_demande','projet_en_service'];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF array_position(order_arr, NEW.status) IS NULL THEN
      RAISE EXCEPTION 'invalid_status: %', NEW.status;
    END IF;
    IF array_position(order_arr, NEW.status) < array_position(order_arr, OLD.status) THEN
      RAISE EXCEPTION 'status_forward_only: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pv_dossiers_forward_only
  BEFORE UPDATE ON majordhome.pv_dossiers
  FOR EACH ROW EXECUTE FUNCTION majordhome.pv_dossiers_forward_only_status();

-- ── Migration 3 : pv_dossiers_public_view ──────────────────────────────────────────────────────
-- Miroir simple mono-table, sans JOIN ni colonne calculée → auto-updatable (règle Bloc B).
CREATE VIEW public.majordhome_pv_dossiers
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.pv_dossiers;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_pv_dossiers TO authenticated;
GRANT SELECT ON public.majordhome_pv_dossiers TO service_role;

-- ── Migration 4 : pv_dossier_advance_rpc ───────────────────────────────────────────────────────
-- Unique writer canonique de status, forward-only, membership-checked. SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.pv_dossier_advance(p_dossier_id uuid, p_target_status text)
  RETURNS majordhome.pv_dossiers
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = majordhome, public
AS $$
DECLARE
  v_dossier majordhome.pv_dossiers;
  order_arr constant text[] := ARRAY[
    'offre','dossier_valide','urbanisme_depose','urbanisme_valide',
    'raccordement_enedis','consuel_demande','projet_en_service'];
  v_cur int;
  v_tgt int;
BEGIN
  SELECT * INTO v_dossier FROM majordhome.pv_dossiers WHERE id = p_dossier_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'dossier_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.org_id = v_dossier.org_id
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_tgt := array_position(order_arr, p_target_status);
  IF v_tgt IS NULL THEN RAISE EXCEPTION 'invalid_status: %', p_target_status; END IF;
  v_cur := array_position(order_arr, v_dossier.status);

  IF v_tgt <= v_cur THEN
    RETURN v_dossier;   -- idempotent : ne redescend jamais, ne fait rien si déjà >= cible
  END IF;

  UPDATE majordhome.pv_dossiers
    SET status = p_target_status, updated_at = now()
    WHERE id = p_dossier_id
    RETURNING * INTO v_dossier;
  RETURN v_dossier;
END;
$$;

REVOKE ALL ON FUNCTION public.pv_dossier_advance(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pv_dossier_advance(uuid, text) TO authenticated;
```

- [ ] **Step 2 : CHECKPOINT Eric — appliquer la migration (prod Supabase partagée)**

⚠️ **Prod partagée avec d'autres apps** (cf. charte). NE PAS appliquer sans le feu vert d'Eric. Une fois validé, appliquer via MCP Supabase `apply_migration` en 4 migrations nommées : `pv_dossiers_create`, `pv_dossiers_forward_only_trigger`, `pv_dossiers_public_view`, `pv_dossier_advance_rpc` (contenu = les 4 blocs ci-dessus).

- [ ] **Step 3 : Vérifier l'application (requêtes de contrôle via MCP `execute_sql`)**

```sql
SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.pv_dossiers'::regclass;                 -- → true
SELECT count(*) FROM pg_policies WHERE schemaname='majordhome' AND tablename='pv_dossiers';         -- → 4
SELECT has_table_privilege('service_role','majordhome.pv_dossiers','SELECT');                       -- → true
SELECT is_insertable_into FROM information_schema.tables
  WHERE table_schema='public' AND table_name='majordhome_pv_dossiers';                              -- → YES
SELECT proname FROM pg_proc WHERE proname='pv_dossier_advance';                                     -- → 1 ligne
SELECT has_function_privilege('anon','public.pv_dossier_advance(uuid,text)','EXECUTE');             -- → false
```
Expected: toutes les valeurs attendues ci-dessus.

- [ ] **Step 4 : Commit la copie versionnée**

```bash
git add sql/migration_pv_dossiers.sql
git commit -m "feat(solaire): migration pv_dossiers (RLS + vue security_invoker + RPC advance forward-only)"
```

---

## Task 3 : Cache keys `pvDossierKeys`

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js` (après le bloc `pvKeys`, l. ~338)

- [ ] **Step 1 : Ajouter la famille de clés**

Dans `src/shared/hooks/cacheKeys.js`, juste après la définition de `pvKeys` (avant `// --- Thermique`), insérer :
```js
// --- Dossiers PV (chaînage administratif) ---
export const pvDossierKeys = {
  all: (orgId) => ['pvDossier', orgId],
  bySimulation: (orgId, simulationId) => [...pvDossierKeys.all(orgId), 'bySimulation', simulationId],
  detail: (orgId, id) => [...pvDossierKeys.all(orgId), 'detail', id],
};
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build`
Expected: build OK (pas d'erreur d'import — la clé est seulement déclarée).

- [ ] **Step 3 : Commit**

```bash
git add src/shared/hooks/cacheKeys.js
git commit -m "feat(solaire): cache keys pvDossierKeys (orgId 1er param)"
```

---

## Task 4 : Service `pvDossier.service.js`

**Files:**
- Create: `src/shared/services/pvDossier.service.js`

> **Pattern de référence** : `src/shared/services/pv.service.js` (VIEW constant, `withErrorHandling`, `.eq('org_id')` explicite, retour `{ data, error }`).

- [ ] **Step 1 : Écrire le service**

Create `src/shared/services/pvDossier.service.js` :
```js
// src/shared/services/pvDossier.service.js
// CRUD dossier PV via la vue publique majordhome_pv_dossiers (security_invoker, auto-updatable).
// Création LAZY : upsertForSimulation garantit 1 simulation → au plus 1 dossier (pv_simulation_id UNIQUE).
// status muté UNIQUEMENT via la RPC pv_dossier_advance (forward-only). org_id filtré explicitement.
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const VIEW = 'majordhome_pv_dossiers';

export const pvDossierService = {
  /** Dossier attaché à une simulation, ou null. */
  async getBySimulation(orgId, simulationId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .select('*')
        .eq('org_id', orgId)
        .eq('pv_simulation_id', simulationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'pvDossier.getBySimulation');
  },

  /** Création LAZY idempotente : renvoie le dossier existant ou en crée un (status 'offre'). */
  async upsertForSimulation({ orgId, userId, simulationId, leadId = null, clientId = null }) {
    return withErrorHandling(async () => {
      const existing = await pvDossierService.getBySimulation(orgId, simulationId);
      if (existing?.data) return existing.data;
      const { data, error } = await supabase
        .from(VIEW)
        .insert({
          org_id: orgId,
          created_by: userId,
          pv_simulation_id: simulationId,
          lead_id: leadId,
          client_id: clientId,
          status: 'offre',
        })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }, 'pvDossier.upsertForSimulation');
  },

  /** Écrit un bloc jsonb (cadastre/roof_geometry/abf/material/declarant/documents). status EXCLU. */
  async patchBlock({ orgId, id, patch }) {
    return withErrorHandling(async () => {
      const { status, ...safe } = patch ?? {}; // garde-fou : status ne passe jamais par la vue
      void status;
      const { data, error } = await supabase
        .from(VIEW)
        .update({ ...safe, updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }, 'pvDossier.patchBlock');
  },

  /** Fait avancer le status (forward-only, membership-checked) via la RPC canonique. */
  async advance({ id, targetStatus }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('pv_dossier_advance', {
        p_dossier_id: id,
        p_target_status: targetStatus,
      });
      if (error) throw error;
      return data;
    }, 'pvDossier.advance');
  },
};
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build`
Expected: build OK.

- [ ] **Step 3 : Commit**

```bash
git add src/shared/services/pvDossier.service.js
git commit -m "feat(solaire): service pvDossier (CRUD vue publique + advance via RPC)"
```

---

## Task 5 : Hook `usePvDossier.js`

**Files:**
- Create: `src/shared/hooks/usePvDossier.js`

> **Pattern de référence** : `src/shared/hooks/usePvSimulations.js` (useQuery + mutations, `enabled: !!orgId`, invalidation `all(orgId)`).

- [ ] **Step 1 : Écrire le hook**

Create `src/shared/hooks/usePvDossier.js` :
```js
// src/shared/hooks/usePvDossier.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { pvDossierService } from '@services/pvDossier.service';
import { pvDossierKeys } from './cacheKeys';

export { pvDossierKeys } from './cacheKeys';

/** Dossier attaché à une simulation (null tant qu'aucun n'existe). */
export function usePvDossier(simulationId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: pvDossierKeys.bySimulation(orgId, simulationId),
    queryFn: async () => {
      const { data, error } = await pvDossierService.getBySimulation(orgId, simulationId);
      if (error) throw error;
      return data; // peut être null
    },
    enabled: !!orgId && !!simulationId,
    staleTime: 30_000,
  });
}

export function usePvDossierMutations() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: pvDossierKeys.all(orgId) });

  const ensureDossier = useMutation({
    mutationFn: async ({ simulationId, leadId, clientId }) => {
      const { data, error } = await pvDossierService.upsertForSimulation({
        orgId, userId: user?.id, simulationId, leadId, clientId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const patchBlock = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await pvDossierService.patchBlock({ orgId, id, patch });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const advance = useMutation({
    mutationFn: async ({ id, targetStatus }) => {
      const { data, error } = await pvDossierService.advance({ id, targetStatus });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  return { ensureDossier, patchBlock, advance };
}
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build`
Expected: build OK.

- [ ] **Step 3 : Commit**

```bash
git add src/shared/hooks/usePvDossier.js
git commit -m "feat(solaire): hook usePvDossier (query par simulation + mutations)"
```

---

## Task 6 : Vérification finale du socle

- [ ] **Step 1 : Tests unitaires purs verts**

Run: `node --test scripts/pv-dossier-status.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 2 : Build production propre**

Run: `npx vite build`
Expected: build OK, aucun nouvel import cassé.

- [ ] **Step 3 : Lint sans nouvelle erreur**

Run: `npm run lint:errors`
Expected: 0 erreur (le pre-commit l'exige déjà).

- [ ] **Step 4 : Contrôle DB (rappel — déjà fait en Task 2 Step 3)**

Confirmer que les 6 requêtes de contrôle de Task 2 Step 3 renvoient les valeurs attendues (RLS true, 4 policies, service_role SELECT true, vue insertable YES, RPC présente, anon EXECUTE false).

---

## Critères de succès du socle (vérifiables)

- `node --test scripts/pv-dossier-status.test.mjs` → 5 tests verts.
- `npx vite build` → OK ; `npm run lint:errors` → 0 erreur.
- Migration appliquée + 6 requêtes de contrôle conformes.
- Depuis un client React authentifié (test manuel léger en dev, hors CI) : `ensureDossier({simulationId})` crée une ligne `offre` idempotente ; `patchBlock` écrit un bloc jsonb ; `advance({targetStatus:'dossier_valide'})` avance ; un 2ᵉ `advance` vers `offre` est un **no-op** (forward-only) ; un UPDATE direct de `status` en arrière via la vue **échoue** (`status_forward_only`).
- Aucune fuite cross-org : toutes les requêtes filtrent `.eq('org_id', orgId)` ; RPC membership-checked ; `anon` sans EXECUTE.

## Self-review (fait)

- **Couverture spec** : §4.1 table (Task 2) ✓ ; §4.2 machine à états + RPC forward-only + trigger (Task 1 lib + Task 2 RPC/trigger) ✓ ; §8 sécurité RLS/vue/GRANT/REVOKE/status-non-mutable-via-vue (Task 2 + Task 4 garde-fou `patchBlock`) ✓. Hors socle (plans 2-4) : géoloc, PDFs, UI — non couverts ici par design.
- **Placeholders** : aucun — tout le code SQL/JS est complet.
- **Cohérence de types** : `pv_dossier_advance(p_dossier_id, p_target_status)` (RPC) ↔ `advance({id, targetStatus})` (service) ↔ mapping `{ p_dossier_id: id, p_target_status: targetStatus }` ✓ ; `PV_DOSSIER_STATUSES` (lib) = `order_arr` (SQL RPC + trigger), même ordre 7 états ✓ ; `pvDossierKeys.all/bySimulation/detail` utilisés dans le hook ✓.
