# Auto-RDV — Tranche 1 « Voir » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre visible l'état de chaque journée de technicien (vide · ouverte · pleine · figée · à arbitrer) dans le Planning, tracer chaque passage du cron de figeage dans un journal lisible, et faire passer le figeage manuel par la même RPC atomique que le cron.

**Architecture:** Un module PUR `src/lib/tournee/etat.js` dérive l'état d'une journée depuis le verdict existant (`verdictJournee`), la date de figeage et l'étiquette de secteur ; deux tables (`journees_secteur`, `planification_runs`) portent ce qui n'était nulle part (figeage tracé, journal des crons, étiquette de secteur) ; une fonction interne `majordhome.figer_journee` est appelée par la RPC service_role du cron ET par une nouvelle RPC authentifiée pour le bouton « Figer la journée ». Côté front, un hook `useEtatsJournees` calcule les états pour la plage visible du Planning, un `dayHeaderContent` FullCalendar affiche une puce par technicien, et le Dashboard entretiens affiche les derniers passages du cron.

**Tech Stack:** React 18, TanStack Query v5, FullCalendar 6 (timeGrid), Supabase (PostgreSQL, edge Deno), `node --test`, harnais `scripts/migration-rehearsal/`.

**Spec:** `docs/superpowers/specs/2026-09-29-auto-rdv-entretien-mensuel-design.md` (§ 3.1, § 3.3, § 4.3, § 5, § 12 tranche 1).

## Global Constraints

- Modules de `src/lib/tournee/` : aucun import React / Supabase / alias ; imports relatifs avec extension `.js` ; JSDoc sur toute signature exportée (`deno check`). Après modification : `npm run sync:tournee-engine` puis redéployer `slots-propose` **et** `tournees-figer`.
- Toute nouvelle table `majordhome.*` : RLS dès la création, `GRANT SELECT TO service_role`, vue `public.majordhome_*` en `WITH (security_invoker=true)`, `REVOKE ALL … FROM anon, authenticated` explicite puis GRANT ciblés (modèle `20260925_1_maintenance_module.sql`).
- Toute RPC SECURITY DEFINER : `REVOKE EXECUTE FROM PUBLIC, anon` ; si `org_id` dans le payload → `REVOKE FROM authenticated` aussi. Gardes positives (`IS NOT TRUE`), `IF auth.uid() IS NULL THEN refuser` en première instruction pour la posture frontend.
- Toute écriture d'edge lit `{ error }` et répond 5xx explicite.
- Cache keys : `tourneeKeys.*` avec `orgId` (= coreOrgId) en 1ᵉʳ paramètre.
- Les journées de `chargerJournees` portent l'org **majordhome** pour `team_members`/`appointments` et l'org **core** pour `contracts`/`clients` ; `journees_secteur.org_id` et `planification_runs.org_id` = org **core**.
- Vocabulaire des états (spec § 3.1) : `vide` · `ouverte` · `pleine` · `figee` · `a_arbitrer`. Libellés UI : « Vide », « Ouverte », « Pleine », « Figée », « À arbitrer ».
- Pas de preview navigateur (consigne Eric) : preuve = tests Node + `npx vite build` + `npm run lint:errors`.

---

## Fichiers

| Action | Fichier | Responsabilité |
|---|---|---|
| Créer | `src/lib/tournee/etat.js` | `deduireSecteur(rdvs)`, `etatJournee({...})`, `LIBELLES_ETAT` |
| Créer | `scripts/tournee/etat.test.mjs` | tests du module |
| Modifier | `src/lib/tournee/loaders.js:79` | ajoute `grand_secteur` au SELECT des RDV |
| Modifier | `scripts/sync-tournee-engine.mjs:18` | ajoute `'etat'` à `NOMS` |
| Créer | `supabase/migrations/20260930_1_journees_secteur_planification_runs.sql` | tables, RLS, vues, `majordhome.figer_journee`, RPC cron réécrite, RPC user |
| Créer | `scripts/migration-rehearsal/assert-journees-secteur.sql` | assertions du harnais |
| Modifier | `scripts/migration-rehearsal/snapshot.mjs` | colonnes `appointments` + table `appointment_technicians` + fonction |
| Modifier | `supabase/functions/tournees-figer/index.ts` | `technicien_id` dans le rapport, écriture `planification_runs` |
| Modifier | `src/shared/hooks/cacheKeys.js` | `tourneeKeys.journeesSecteur`, `tourneeKeys.runs` |
| Modifier | `src/shared/services/tournees.service.js` | `getJourneesSecteur`, `getPlanificationRuns`, `figerJourneeUser` |
| Modifier | `src/shared/hooks/useTournees.js` | `useEtatsJournees`, `usePlanificationRuns` |
| Modifier | `src/apps/artisan/components/tournees/useConsolidationJournee.js:98-166` | `figer` passe par la RPC atomique |
| Créer | `src/apps/artisan/components/planning/JourneeEtatChips.jsx` | puces d'état par technicien pour un jour |
| Modifier | `src/apps/artisan/pages/Planning.jsx` | `dayHeaderContent` + hook |
| Créer | `src/apps/artisan/components/tournees/PlanificationJournal.jsx` | derniers passages du cron |
| Modifier | `src/apps/artisan/components/entretiens/EntretiensDashboard.jsx`, `pages/Entretiens.jsx:525` | monte le journal |
| Modifier | `docs/MODULE_TOURNEES.md` | section « État de journée et journal » |

---

### Task 1 : module pur `etat.js`

**Files:**
- Create: `src/lib/tournee/etat.js`
- Test: `scripts/tournee/etat.test.mjs`
- Modify: `scripts/sync-tournee-engine.mjs:18` (ajout `'etat'` à `NOMS`)

**Interfaces:**
- Produces: `deduireSecteur(rdvs: Array<{appointment_type, status, grand_secteur}>) => string|null` (secteur majoritaire des RDV `maintenance`/`service` non annulés ; `null` si aucun).
- Produces: `etatJournee({ rdvs, verdict, figeeAt, etiquette }) => 'vide'|'ouverte'|'pleine'|'figee'|'a_arbitrer'` avec `verdict` ∈ sortie de `verdictJournee` (`sans_adaptable|non_pleine|figeable|a_arbitrer`), `figeeAt` string|null, `etiquette` string|null.
- Produces: `LIBELLES_ETAT` (objet état → libellé FR).

- [ ] **Step 1 : écrire les tests**

```js
// scripts/tournee/etat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deduireSecteur, etatJournee, LIBELLES_ETAT } from '../../src/lib/tournee/etat.js';

const rdv = (type, secteur, status = 'scheduled') => ({ appointment_type: type, grand_secteur: secteur, status });

test('deduireSecteur : secteur majoritaire des entretiens/SAV, null sans entretien', () => {
  assert.equal(deduireSecteur([]), null);
  assert.equal(deduireSecteur([rdv('installation', 'Castres')]), null);
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres')]), 'Castres');
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres'), rdv('service', 'Gaillac'), rdv('maintenance', 'Castres')]), 'Castres');
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres', 'cancelled')]), null);
  assert.equal(deduireSecteur([rdv('maintenance', null)]), null);
});

test('deduireSecteur : égalité → ordre alphabétique (déterministe)', () => {
  assert.equal(deduireSecteur([rdv('maintenance', 'Gaillac'), rdv('maintenance', 'Castres')]), 'Castres');
});

test('etatJournee : figée prime sur tout', () => {
  assert.equal(etatJournee({ rdvs: [rdv('maintenance', 'C')], verdict: 'non_pleine', figeeAt: '2026-09-28T06:20:00Z', etiquette: null }), 'figee');
});

test('etatJournee : sans RDV ni étiquette = vide ; étiquetée sans RDV = ouverte', () => {
  assert.equal(etatJournee({ rdvs: [], verdict: 'sans_adaptable', figeeAt: null, etiquette: null }), 'vide');
  assert.equal(etatJournee({ rdvs: [], verdict: 'sans_adaptable', figeeAt: null, etiquette: 'Castres' }), 'ouverte');
});

test('etatJournee : verdicts du moteur', () => {
  const rdvs = [rdv('maintenance', 'C')];
  assert.equal(etatJournee({ rdvs, verdict: 'non_pleine', figeeAt: null, etiquette: null }), 'ouverte');
  assert.equal(etatJournee({ rdvs, verdict: 'figeable', figeeAt: null, etiquette: null }), 'pleine');
  assert.equal(etatJournee({ rdvs, verdict: 'a_arbitrer', figeeAt: null, etiquette: null }), 'a_arbitrer');
  // une journée d'installations seules (aucun adaptable) reste « ouverte » : on peut y glisser un entretien
  assert.equal(etatJournee({ rdvs: [rdv('installation', null)], verdict: 'sans_adaptable', figeeAt: null, etiquette: null }), 'ouverte');
});

test('LIBELLES_ETAT couvre les cinq états', () => {
  assert.deepEqual(Object.keys(LIBELLES_ETAT).sort(), ['a_arbitrer', 'figee', 'ouverte', 'pleine', 'vide']);
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `node --test scripts/tournee/etat.test.mjs`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : implémenter**

```js
// src/lib/tournee/etat.js
// ============================================================================
// État d'une journée de technicien — module PUR (aucun import React / Supabase).
// Une seule définition, partagée par le Planning (bandeau), le Dashboard et,
// plus tard, l'auto-RDV. Spec 2026-09-29 § 3.1.
// ============================================================================

/** @typedef {'vide'|'ouverte'|'pleine'|'figee'|'a_arbitrer'} EtatJournee */

/** Libellés FR des états, source unique pour l'UI. */
export const LIBELLES_ETAT = Object.freeze({
  vide: 'Vide',
  ouverte: 'Ouverte',
  pleine: 'Pleine',
  figee: 'Figée',
  a_arbitrer: 'À arbitrer',
});

const TYPES_ENTRETIEN = new Set(['maintenance', 'service']);
const STATUTS_EXCLUS = new Set(['cancelled', 'no_show']);

/**
 * Secteur déduit d'une journée : le grand secteur majoritaire de ses entretiens
 * et SAV non annulés. Une journée qui porte un entretien à Castres EST une
 * journée Castres (décision Eric, 2026-09-29). Égalité → ordre alphabétique.
 *
 * @param {Array<{ appointment_type?: string, status?: string, grand_secteur?: string|null }>} rdvs
 * @returns {string|null} nom du grand secteur, ou null si aucun entretien localisé
 */
export function deduireSecteur(rdvs) {
  const comptes = new Map();
  for (const r of rdvs || []) {
    if (!TYPES_ENTRETIEN.has(r.appointment_type)) continue;
    if (STATUTS_EXCLUS.has(r.status)) continue;
    const s = typeof r.grand_secteur === 'string' ? r.grand_secteur.trim() : '';
    if (!s) continue;
    comptes.set(s, (comptes.get(s) || 0) + 1);
  }
  if (comptes.size === 0) return null;
  return [...comptes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0][0];
}

/**
 * État d'une journée à partir du verdict du moteur (`verdictJournee` de plein.js),
 * de la trace de figeage et de l'étiquette de secteur.
 *
 * - figée (trace en base) prime sur tout : les heures sont définitives ;
 * - aucun RDV et aucune étiquette → vide ; étiquetée → ouverte (la machine y attend des clients) ;
 * - `a_arbitrer` / `figeable` (= pleine) viennent du moteur ;
 * - tout le reste (`non_pleine`, `sans_adaptable` avec des RDV) → ouverte.
 *
 * @param {{ rdvs: Array<object>, verdict: string|null|undefined, figeeAt: string|null|undefined, etiquette: string|null|undefined }} p
 * @returns {EtatJournee}
 */
export function etatJournee({ rdvs, verdict, figeeAt, etiquette }) {
  if (figeeAt) return 'figee';
  const actifs = (rdvs || []).filter((r) => !STATUTS_EXCLUS.has(r.status));
  if (actifs.length === 0) return etiquette ? 'ouverte' : 'vide';
  if (verdict === 'a_arbitrer') return 'a_arbitrer';
  if (verdict === 'figeable') return 'pleine';
  return 'ouverte';
}
```

- [ ] **Step 4 : ajouter `'etat'` à `NOMS` dans `scripts/sync-tournee-engine.mjs`, lancer la sync et les tests**

Run: `npm run sync:tournee-engine && node --test scripts/tournee/etat.test.mjs scripts/tournee/purete.test.mjs scripts/tournee/sync-engine.test.mjs`
Expected: PASS (copie `supabase/functions/_shared/tournee/etat.js` créée).

- [ ] **Step 5 : commit**

```bash
git add src/lib/tournee/etat.js scripts/tournee/etat.test.mjs scripts/sync-tournee-engine.mjs supabase/functions/_shared/tournee/etat.js
git commit -m "feat(tournees): module pur d'état de journée (vide/ouverte/pleine/figée/à arbitrer) et secteur déduit"
```

---

### Task 2 : `grand_secteur` dans les journées chargées

**Files:**
- Modify: `src/lib/tournee/loaders.js:79` (SELECT des RDV)
- Test: `scripts/tournee/loaders.test.mjs` (vérifier qu'aucun test ne pinne la liste de colonnes ; sinon l'ajuster)

**Interfaces:**
- Produces: chaque `rdv` de `journee.rdvs` porte `grand_secteur: string|null`.

- [ ] **Step 1 : ajouter la colonne au SELECT** — dans la chaîne `.select('id, client_id, … announced_start')` ajouter `, grand_secteur` en fin.
- [ ] **Step 2 : `npm run sync:tournee-engine && node --test "scripts/tournee/*.test.mjs"`** → PASS.
- [ ] **Step 3 : commit** `git add src/lib/tournee/loaders.js supabase/functions/_shared/tournee/loaders.js && git commit -m "feat(tournees): les journées chargées portent le grand secteur de chaque RDV"`

---

### Task 3 : migration `20260930_1` — étiquettes, journal, figeage partagé

**Files:**
- Create: `supabase/migrations/20260930_1_journees_secteur_planification_runs.sql`
- Create: `scripts/migration-rehearsal/assert-journees-secteur.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (colonnes `appointments`, table `appointment_technicians`, table `organizations` core déjà là ; ajouter `'public.tournees_figer_journee(uuid, jsonb)'` à FUNCTIONS n'est PAS nécessaire, la migration la recrée)
- Modify: `scripts/migration-rehearsal/assert-baseline.sql` §1 si la liste FUNCTIONS change (elle ne change pas ici)

**Interfaces:**
- Produces: tables `majordhome.journees_secteur`, `majordhome.planification_runs` ; vues `public.majordhome_journees_secteur` (SELECT membres, UPDATE org_admin/team_leader sur `grand_secteur`/`team_member_id`/`origine`), `public.majordhome_planification_runs` (SELECT membres, INSERT service_role).
- Produces: `majordhome.figer_journee(p_mdh_org_id uuid, p_lignes jsonb, p_par text) returns jsonb` `{figes, refuses}` (interne, non exposée).
- Produces: `public.tournees_figer_journee(uuid, jsonb)` inchangée en signature (service_role, `p_par = 'cron'`).
- Produces: `public.tournees_figer_journee_user(p_lignes jsonb) returns jsonb` (authenticated ; org dérivée des RDV, membership `org_admin`/`team_leader` exigée ; `p_par = 'user:' || auth.uid()`).

- [ ] **Step 1 : écrire la migration**

```sql
-- ============================================================================
-- 20260930_1 — Auto-RDV tranche 1 « Voir » (spec 2026-09-29 § 3.1, § 3.3, § 4.3)
-- ============================================================================
-- 1. majordhome.journees_secteur : étiquette de secteur d'une journée de
--    technicien + trace du figeage (figee_at / figee_par). org_id = org CORE.
-- 2. majordhome.planification_runs : journal des passages des crons de
--    planification (tournees-figer aujourd'hui, auto-rdv-* demain).
-- 3. majordhome.figer_journee(...) : le figeage atomique, appelé par la RPC
--    service_role du cron ET par la RPC authentifiée du bouton « Figer ».
--    Avant : le bouton bouclait sur updateAppointment (non atomique).
-- ============================================================================

-- ── 1. journees_secteur ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS majordhome.journees_secteur (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  date            date NOT NULL,
  team_member_id  uuid NOT NULL REFERENCES majordhome.team_members(id) ON DELETE CASCADE,
  grand_secteur   text,
  origine         text NOT NULL DEFAULT 'deduite' CHECK (origine IN ('deduite', 'machine', 'humain')),
  figee_at        timestamptz,
  figee_par       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, team_member_id, date)
);
COMMENT ON TABLE majordhome.journees_secteur IS
  'Étiquette de secteur d''une journée de technicien (déduite des RDV posés, posée par la machine, ou corrigée à la main) + trace du figeage. org_id = org CORE. Une journée est disponible par nature : personne ne l''ouvre.';
COMMENT ON COLUMN majordhome.journees_secteur.figee_par IS '''cron'' ou ''user:<uuid>''.';

DROP TRIGGER IF EXISTS trg_journees_secteur_updated_at ON majordhome.journees_secteur;
CREATE TRIGGER trg_journees_secteur_updated_at BEFORE UPDATE ON majordhome.journees_secteur
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

-- ── 2. planification_runs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS majordhome.planification_runs (
  id        bigserial PRIMARY KEY,
  org_id    uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  job       text NOT NULL CHECK (job IN ('tournees-figer', 'auto-rdv-ouverture', 'auto-rdv-relances')),
  ran_at    timestamptz NOT NULL DEFAULT now(),
  dry_run   boolean NOT NULL DEFAULT false,
  rapport   jsonb NOT NULL DEFAULT '{}'::jsonb,
  duree_ms  integer,
  erreur    text
);
CREATE INDEX IF NOT EXISTS planification_runs_org_job_ran_idx
  ON majordhome.planification_runs (org_id, job, ran_at DESC);
COMMENT ON TABLE majordhome.planification_runs IS
  'Journal des passages des crons de planification (tournees-figer, auto-rdv-*). Écrit par les edges (service_role), même en échec. Lu par le Dashboard entretiens.';

-- ── 3. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE majordhome.journees_secteur   ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.planification_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journees_secteur_select ON majordhome.journees_secteur;
CREATE POLICY journees_secteur_select ON majordhome.journees_secteur FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS journees_secteur_write ON majordhome.journees_secteur;
CREATE POLICY journees_secteur_write ON majordhome.journees_secteur FOR ALL TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om
                    WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('org_admin', 'team_leader')))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om
                         WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('org_admin', 'team_leader')));

DROP POLICY IF EXISTS planification_runs_select ON majordhome.planification_runs;
CREATE POLICY planification_runs_select ON majordhome.planification_runs FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
-- planification_runs : aucune policy d'écriture (service_role seulement).

-- ── 4. Privilèges ──────────────────────────────────────────────────────────
REVOKE ALL ON majordhome.journees_secteur, majordhome.planification_runs FROM anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baikal_reader') THEN
    REVOKE ALL ON majordhome.journees_secteur, majordhome.planification_runs FROM baikal_reader;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.journees_secteur TO authenticated;
GRANT SELECT ON majordhome.planification_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.journees_secteur TO service_role;
GRANT SELECT, INSERT ON majordhome.planification_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE majordhome.planification_runs_id_seq TO service_role;

-- ── 5. Vues publiques (miroirs simples, updatable) ─────────────────────────
DROP VIEW IF EXISTS public.majordhome_journees_secteur;
CREATE VIEW public.majordhome_journees_secteur WITH (security_invoker = true) AS
  SELECT id, org_id, date, team_member_id, grand_secteur, origine, figee_at, figee_par, created_at, updated_at
  FROM majordhome.journees_secteur;
DROP VIEW IF EXISTS public.majordhome_planification_runs;
CREATE VIEW public.majordhome_planification_runs WITH (security_invoker = true) AS
  SELECT id, org_id, job, ran_at, dry_run, rapport, duree_ms, erreur
  FROM majordhome.planification_runs;

REVOKE ALL ON public.majordhome_journees_secteur, public.majordhome_planification_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_journees_secteur TO authenticated, service_role;
GRANT SELECT ON public.majordhome_planification_runs TO authenticated;
GRANT SELECT, INSERT ON public.majordhome_planification_runs TO service_role;

-- ── 6. Figeage atomique partagé ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.figer_journee(p_mdh_org_id uuid, p_lignes jsonb, p_par text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_ligne   jsonb;
  v_refuses text[] := '{}';
  v_now     timestamptz := now();
  v_count   int := 0;
  v_core    uuid;
  r         record;
BEGIN
  IF p_mdh_org_id IS NULL OR p_lignes IS NULL OR jsonb_typeof(p_lignes) <> 'array' THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;
  SELECT o.core_org_id INTO v_core FROM majordhome.organizations o WHERE o.id = p_mdh_org_id;
  IF v_core IS NULL THEN RAISE EXCEPTION 'org_not_found'; END IF;

  -- 1. Chaque RDV doit être exactement tel que l'ordonnanceur l'a vu.
  FOR v_ligne IN SELECT * FROM jsonb_array_elements(p_lignes) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM majordhome.appointments a
      WHERE a.id = (v_ligne->>'id')::uuid
        AND a.org_id = p_mdh_org_id
        AND a.scheduled_start = (v_ligne->>'attendu')::time
        AND a.hour_confirmed_at IS NULL
        AND coalesce(a.time_flex_minutes, -1) <> 0
        AND a.status NOT IN ('cancelled', 'completed', 'no_show')
        AND a.appointment_type IN ('maintenance', 'service')
    ) THEN
      v_refuses := array_append(v_refuses, v_ligne->>'id');
    END IF;
  END LOOP;
  IF coalesce(array_length(v_refuses, 1), 0) > 0 THEN
    RETURN jsonb_build_object('figes', 0, 'refuses', to_jsonb(v_refuses));
  END IF;

  -- 2. Heures définitives : le bloc suit le barème (R1), l'ancre = l'heure annoncée.
  FOR v_ligne IN SELECT * FROM jsonb_array_elements(p_lignes) LOOP
    UPDATE majordhome.appointments a SET
      scheduled_start   = (v_ligne->>'scheduled_start')::time,
      scheduled_end     = (v_ligne->>'scheduled_end')::time,
      duration_minutes  = (v_ligne->>'duration_minutes')::int,
      time_flex_minutes = 0,
      hour_confirmed_at = v_now,
      announced_start   = (v_ligne->>'scheduled_start')::time,
      updated_at        = v_now
    WHERE a.id = (v_ligne->>'id')::uuid AND a.org_id = p_mdh_org_id;
    v_count := v_count + 1;
  END LOOP;

  -- 3. Trace du figeage sur l'étiquette de chaque (date, technicien) concerné.
  FOR r IN
    SELECT DISTINCT a.scheduled_date AS d, at.technician_id AS tech
    FROM jsonb_array_elements(p_lignes) l
    JOIN majordhome.appointments a ON a.id = (l->>'id')::uuid
    JOIN majordhome.appointment_technicians at ON at.appointment_id = a.id
  LOOP
    INSERT INTO majordhome.journees_secteur (org_id, date, team_member_id, origine, figee_at, figee_par)
    VALUES (v_core, r.d, r.tech, 'deduite', v_now, p_par)
    ON CONFLICT (org_id, team_member_id, date) DO UPDATE
      SET figee_at = EXCLUDED.figee_at, figee_par = EXCLUDED.figee_par, updated_at = v_now;
  END LOOP;

  RETURN jsonb_build_object('figes', v_count, 'refuses', '[]'::jsonb);
END
$$;
REVOKE EXECUTE ON FUNCTION majordhome.figer_journee(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

-- 6a. RPC du cron (signature inchangée, service_role only).
CREATE OR REPLACE FUNCTION public.tournees_figer_journee(p_org_id uuid, p_lignes jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = majordhome, public AS $$
  SELECT majordhome.figer_journee(p_org_id, p_lignes, 'cron');
$$;
REVOKE EXECUTE ON FUNCTION public.tournees_figer_journee(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tournees_figer_journee(uuid, jsonb) TO service_role;

-- 6b. RPC du bouton « Figer la journée » : posture frontend. L'org est celle des
--     RDV (jamais du payload) ; l'appelant doit être org_admin ou team_leader de
--     l'org CORE correspondante. Garde positive (IS NOT TRUE).
CREATE OR REPLACE FUNCTION public.tournees_figer_journee_user(p_lignes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_mdh   uuid;
  v_core  uuid;
  v_ok    boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_lignes IS NULL OR jsonb_typeof(p_lignes) <> 'array' OR jsonb_array_length(p_lignes) = 0 THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;
  SELECT a.org_id INTO v_mdh FROM majordhome.appointments a
   WHERE a.id = (p_lignes->0->>'id')::uuid;
  IF v_mdh IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lignes) l
    JOIN majordhome.appointments a ON a.id = (l->>'id')::uuid
    WHERE a.org_id <> v_mdh
  ) THEN RAISE EXCEPTION 'mixed_orgs'; END IF;
  SELECT o.core_org_id INTO v_core FROM majordhome.organizations o WHERE o.id = v_mdh;
  SELECT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.user_id = v_uid AND om.org_id = v_core AND om.role IN ('org_admin', 'team_leader')
  ) INTO v_ok;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN majordhome.figer_journee(v_mdh, p_lignes, 'user:' || v_uid::text);
END
$$;
REVOKE EXECUTE ON FUNCTION public.tournees_figer_journee_user(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tournees_figer_journee_user(jsonb) TO authenticated;
COMMENT ON FUNCTION public.tournees_figer_journee_user(jsonb) IS
  'Figeage atomique d''une journée depuis le bouton « Figer la journée ». Org dérivée des RDV ; org_admin/team_leader seulement.';
```

- [ ] **Step 2 : étendre le harnais** — dans `snapshot.mjs` : `appointments` → `columns: ['id','org_id','lead_id','intervention_id','client_id','appointment_type','status','scheduled_date','scheduled_start','scheduled_end','duration_minutes','time_flex_minutes','hour_confirmed_at','announced_start','created_at','updated_at']` ; ajouter `{ schema: 'majordhome', table: 'appointment_technicians', columns: null, data: false }`. Écrire `assert-journees-secteur.sql` :

```sql
-- assert-journees-secteur.sql — vérifie 20260930_1 sur le cluster de répétition.
DO $$
DECLARE n int; r record;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relrowsecurity AND c.relname IN ('journees_secteur', 'planification_runs');
  IF n <> 2 THEN RAISE EXCEPTION 'RLS activée sur % table(s) au lieu de 2', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'planification_runs' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'planification_runs : % policy(ies) d''écriture', n; END IF;
  FOR r IN SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname IN ('majordhome_journees_secteur', 'majordhome_planification_runs') LOOP
    IF coalesce(r.reloptions::text, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue % sans security_invoker', r.relname; END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'majordhome.journees_secteur', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur journees_secteur'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.planification_runs', 'INSERT') THEN RAISE EXCEPTION 'service_role sans INSERT sur planification_runs'; END IF;
  IF has_function_privilege('anon', 'public.tournees_figer_journee(uuid, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute tournees_figer_journee'; END IF;
  IF has_function_privilege('authenticated', 'public.tournees_figer_journee(uuid, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute tournees_figer_journee'; END IF;
  IF has_function_privilege('anon', 'public.tournees_figer_journee_user(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute tournees_figer_journee_user'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.tournees_figer_journee_user(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated n''exécute pas tournees_figer_journee_user'; END IF;
  IF has_function_privilege('authenticated', 'majordhome.figer_journee(uuid, jsonb, text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute figer_journee interne'; END IF;
END $$;
-- Garde : sans session, la RPC user refuse.
DO $$ BEGIN
  BEGIN
    PERFORM public.tournees_figer_journee_user('[{"id":"00000000-0000-0000-0000-000000000000"}]'::jsonb);
    RAISE EXCEPTION 'la RPC user a accepté un appel sans auth.uid()';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'not_authenticated' THEN RAISE EXCEPTION 'attendu not_authenticated, obtenu %', SQLERRM; END IF;
  END;
END $$;
```

- [ ] **Step 3 : répéter** — `node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local` puis `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260930_1_journees_secteur_planification_runs.sql --assert scripts/migration-rehearsal/assert-journees-secteur.sql --assert scripts/migration-rehearsal/assert-baseline.sql`. Expected: OK. Si le harnais ne tourne pas sur ce poste (cluster local absent), le dire explicitement dans le rapport et ne pas appliquer en prod sans l'accord d'Eric.
- [ ] **Step 4 : appliquer en prod** via `apply_migration` (nom `20260930_1_journees_secteur_planification_runs`), puis auditer : `SELECT has_function_privilege('anon','public.tournees_figer_journee_user(jsonb)','EXECUTE'), has_function_privilege('authenticated','public.tournees_figer_journee(uuid, jsonb)','EXECUTE')` → `false, false`.
- [ ] **Step 5 : commit** `git add supabase/migrations/20260930_1_journees_secteur_planification_runs.sql scripts/migration-rehearsal/ && git commit -m "feat(tournees): étiquettes de secteur, journal des crons, figeage atomique partagé cron/bouton (migration 20260930_1)"`

---

### Task 4 : edge `tournees-figer` — rapport journalisé

**Files:**
- Modify: `supabase/functions/tournees-figer/index.ts` (interfaces `JourneeReport` L68, boucle L152-313, réponse L315)

**Interfaces:**
- Produces: `JourneeReport.technicien_id: string` ; une ligne `planification_runs` par org traitée (`job = 'tournees-figer'`, `rapport = OrgReport` sans `org_id`/`name`, `dry_run`, `duree_ms`), et une ligne avec `erreur` si le passage global échoue avant la boucle des orgs (org_id inconnu → on ne journalise pas, on répond 500 comme aujourd'hui).

- [ ] **Step 1 : ajouter `technicien_id: string` à `JourneeReport` et le renseigner** (`jr` est construit avec `technicien: j.technicienNom` → ajouter `technicien_id: j.technicienId`).
- [ ] **Step 2 : journaliser par org** — juste avant la fin de l'itération de chaque org (après la boucle des journées, y compris quand l'org est `skipped`), insérer :

```ts
const debutOrg = Date.now(); // à poser au début du traitement de l'org
// … à la fin de l'org :
const { error: runErr } = await admin.from("majordhome_planification_runs").insert({
  org_id: org.id,
  job: "tournees-figer",
  dry_run: dryRun,
  rapport: { skipped: report.skipped ?? null, sms: report.sms ?? null, journees: report.journees ?? [] },
  duree_ms: Date.now() - debutOrg,
  erreur: report.error ?? null,
});
if (runErr) {
  console.error("[tournees-figer] journal non écrit :", runErr);
  report.error = (report.error ? report.error + " ; " : "") + "journal:" + sanitizeError(runErr, "planification_runs insert failed");
}
```

  Une org sans `majordhome_organizations` (skip silencieux) n'est pas journalisée : elle n'est pas une org Majord'home.
- [ ] **Step 3 : `npm run sync:tournee-engine` (copies à jour) puis déployer** `tournees-figer` ET `slots-propose` (loaders.js a changé en Task 2) via `deploy_edge_function` avec les fichiers `_shared/` nécessaires ; vérifier `verify_jwt` conforme à `supabase/config.toml`.
- [ ] **Step 4 : preuve** — appeler l'edge en `dry_run` par `net.http_post` (secret du vault) ou attendre le prochain passage horaire, puis `SELECT job, ran_at, dry_run, duree_ms, erreur, jsonb_array_length(rapport->'journees') FROM majordhome.planification_runs ORDER BY id DESC LIMIT 3`.
- [ ] **Step 5 : commit** `git add supabase/functions/tournees-figer/index.ts && git commit -m "feat(tournees-figer): rapport journalisé dans planification_runs, technicien_id dans le rapport"`

---

### Task 5 : service, cache keys, hooks

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js:417-440` (`tourneeKeys`)
- Modify: `src/shared/services/tournees.service.js` (3 méthodes)
- Modify: `src/shared/hooks/useTournees.js` (2 hooks)

**Interfaces:**
- Produces: `tourneeKeys.journeesSecteur(orgId, from, to)`, `tourneeKeys.runs(orgId, job)`.
- Produces: `tourneesService.getJourneesSecteur({ coreOrgId, from, to })` → `{ data: Array<row>, error }` ; `getPlanificationRuns({ coreOrgId, job = 'tournees-figer', limit = 10 })` → `{ data, error }` ; `figerJourneeUser({ lignes })` → `{ data: {figes, refuses}, error }` (RPC `tournees_figer_journee_user`).
- Produces: `useEtatsJournees({ coreOrgId, startDate, endDate })` → `{ etats: Map<'YYYY-MM-DD|techId', { etat, verdict, remplissage, etiquette, figeeAt, figeePar, estime: true, technicienNom, couleur, technicienId, date }>, techniciens, isLoading, error }` ; `usePlanificationRuns(coreOrgId, job)` → query.

- [ ] **Step 1 : cache keys** — ajouter dans `tourneeKeys` :

```js
  // Étiquettes de secteur + figeage (majordhome_journees_secteur) sur une plage.
  journeesSecteur: (orgId, from, to) => [...tourneeKeys.all(orgId), 'journeesSecteur', from, to],
  // Journal des crons de planification (majordhome_planification_runs).
  runs: (orgId, job) => [...tourneeKeys.all(orgId), 'runs', job],
```

- [ ] **Step 2 : service** — ajouter à `tourneesService` :

```js
  /** Étiquettes de secteur + figeage des journées d'une plage (org CORE). */
  async getJourneesSecteur({ coreOrgId, from, to }) {
    try {
      const { data, error } = await supabase
        .from('majordhome_journees_secteur')
        .select('id, date, team_member_id, grand_secteur, origine, figee_at, figee_par')
        .eq('org_id', coreOrgId).gte('date', from).lte('date', to);
      return { data: data || [], error };
    } catch (error) {
      logger.error('[tournees] getJourneesSecteur', error);
      return { data: [], error };
    }
  },

  /** Derniers passages d'un cron de planification (org CORE), le plus récent d'abord. */
  async getPlanificationRuns({ coreOrgId, job = 'tournees-figer', limit = 10 }) {
    try {
      const { data, error } = await supabase
        .from('majordhome_planification_runs')
        .select('id, job, ran_at, dry_run, rapport, duree_ms, erreur')
        .eq('org_id', coreOrgId).eq('job', job)
        .order('ran_at', { ascending: false }).limit(limit);
      return { data: data || [], error };
    } catch (error) {
      logger.error('[tournees] getPlanificationRuns', error);
      return { data: [], error };
    }
  },

  /**
   * Figeage atomique depuis le bouton « Figer la journée » (RPC
   * tournees_figer_journee_user : org dérivée des RDV, org_admin/team_leader).
   * @param {{ lignes: Array<{ id: string, attendu: string, scheduled_start: string, scheduled_end: string, duration_minutes: number }> }} p
   * @returns {Promise<{ data: { figes: number, refuses: string[] }|null, error: Error|null }>}
   */
  async figerJourneeUser({ lignes }) {
    try {
      const { data, error } = await supabase.rpc('tournees_figer_journee_user', { p_lignes: lignes });
      return { data: data || null, error };
    } catch (error) {
      logger.error('[tournees] figerJourneeUser', error);
      return { data: null, error };
    }
  },
```

- [ ] **Step 3 : hooks** — ajouter à `useTournees.js` (imports : `useQuery` déjà là, `etatJournee`, `deduireSecteur` depuis `@/lib/tournee/etat.js`) :

```js
/** Nombre de jours entre aujourd'hui et `endDate` (exclusive FullCalendar), borné à [0, 120]. */
function joursJusqua(endDate) {
  const fin = new Date(endDate);
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  const n = Math.ceil((fin - aujourdhui) / 86400000);
  return Math.max(0, Math.min(120, n));
}

/**
 * État de chaque journée (technicien × date) d'une plage : verdict du moteur à
 * vol d'oiseau (`estime: true`, comme `useJourneesAArbitrer`) + étiquette de
 * secteur + trace de figeage lue en base. Les journées passées ne sont pas
 * chargées (`chargerJournees` part d'aujourd'hui).
 *
 * @param {{ coreOrgId: string, startDate: string, endDate: string }} p  ISO `YYYY-MM-DD`
 */
export function useEtatsJournees({ coreOrgId, startDate, endDate }) {
  const { settings } = useOrgSettings();
  const joursApres = joursJusqua(endDate);
  const { data: horizon, isLoading: hLoading, error: hError } = useJourneesHorizon(coreOrgId, joursApres);
  const { data: etiquettes, isLoading: eLoading, error: eError } = useQuery({
    queryKey: tourneeKeys.journeesSecteur(coreOrgId, startDate, endDate),
    queryFn: async () => {
      const { data, error } = await tourneesService.getJourneesSecteur({ coreOrgId, from: startDate, to: endDate });
      if (error) throw error;
      return data;
    },
    enabled: !!coreOrgId && !!startDate && !!endDate,
    staleTime: 60 * 1000,
  });
  const etats = useMemo(() => {
    const map = new Map();
    if (!horizon || !settings) return map;
    const reglages = construireReglages(settings);
    const depot = getOrgHeadquarters(settings);
    const parCle = new Map((etiquettes || []).map((e) => [`${e.date}|${e.team_member_id}`, e]));
    for (const j of horizon) {
      if (j.date < startDate || j.date >= endDate) continue;
      const cle = `${j.date}|${j.technicienId}`;
      const e = parCle.get(cle) || null;
      const v = depot ? verdictJournee({ journee: j, depot, reglages, trajet: trajetLocal }) : { verdict: null, remplissage: null };
      const etiquette = e?.grand_secteur || deduireSecteur(j.rdvs);
      map.set(cle, {
        date: j.date, technicienId: j.technicienId, technicienNom: j.technicienNom, couleur: j.couleur,
        etat: etatJournee({ rdvs: j.rdvs, verdict: v.verdict, figeeAt: e?.figee_at, etiquette }),
        verdict: v.verdict, remplissage: v.remplissage, etiquette, origine: e?.origine || (etiquette ? 'deduite' : null),
        figeeAt: e?.figee_at || null, figeePar: e?.figee_par || null, nbRdvs: (j.rdvs || []).length, estime: true,
      });
    }
    return map;
  }, [horizon, etiquettes, settings, startDate, endDate]);
  return { etats, isLoading: hLoading || eLoading, error: hError || eError || null };
}

/** Derniers passages d'un cron de planification. */
export function usePlanificationRuns(coreOrgId, job = 'tournees-figer') {
  return useQuery({
    queryKey: tourneeKeys.runs(coreOrgId, job),
    queryFn: async () => {
      const { data, error } = await tourneesService.getPlanificationRuns({ coreOrgId, job });
      if (error) throw error;
      return data;
    },
    enabled: !!coreOrgId,
    staleTime: 60 * 1000,
  });
}
```

- [ ] **Step 4 : `npm run lint:errors`** → 0 erreur.
- [ ] **Step 5 : commit** `git add src/shared/hooks/cacheKeys.js src/shared/services/tournees.service.js src/shared/hooks/useTournees.js && git commit -m "feat(tournees): hooks d'état de journée et de journal des crons"`

---

### Task 6 : le bouton « Figer la journée » passe par la RPC atomique

**Files:**
- Modify: `src/apps/artisan/components/tournees/useConsolidationJournee.js:121-139` (étape 2 de `figer`)

**Interfaces:**
- Consumes: `tourneesService.figerJourneeUser({ lignes })` (Task 5).
- Comportement conservé : pré-vérification (`perime`), SMS seulement si tout est écrit et `figer_sms`, invalidations.

- [ ] **Step 1 : remplacer la boucle `for (const l of aChanger) { updateAppointment … }`** par :

```js
      // 2. Tout ou rien : la même RPC que le cron (tournees_figer_journee_user) —
      //    un RDV changé entre la relecture et l'écriture ⇒ rien n'est écrit.
      const lignes = aChanger.map((l) => ({
        id: l.id,
        attendu: l.avant.length === 5 ? `${l.avant}:00` : l.avant,
        scheduled_start: l.apres,
        scheduled_end: minutesVersHeure(l.arriveeMinutes + l.dureeMinutes),
        duration_minutes: l.dureeMinutes,
      }));
      const { data: ecrit, error: rpcErr } = await tourneesService.figerJourneeUser({ lignes });
      if (rpcErr) { bilan.echecs.push({ label: 'journée', message: rpcErr.message || 'refusé' }); return; }
      if (!ecrit || ecrit.figes === 0) {
        bilan.perime = true;
        const refuses = new Set(ecrit?.refuses || []);
        bilan.echecs.push(...aChanger.filter((l) => refuses.has(l.id)).map((l) => ({ label: l.label, message: 'modifié depuis l’aperçu — rouvrez « Figer la journée »' })));
        return;
      }
      bilan.figes = ecrit.figes;
      const figes = aChanger;
```

  ⚠️ `l.avant` est `scheduled_start.slice(0,5)` (`HH:MM`) ; la RPC compare `attendu::time` à `scheduled_start`, donc `HH:MM` et `HH:MM:00` sont équivalents pour Postgres — la normalisation ci-dessus est une sécurité, pas une nécessité. Vérifier que `appointmentsService` reste importé s'il sert ailleurs dans le fichier, sinon retirer l'import (dead code). Importer `tourneesService`.
- [ ] **Step 2 : `npm run lint:errors`** → 0.
- [ ] **Step 3 : commit** `git add src/apps/artisan/components/tournees/useConsolidationJournee.js && git commit -m "fix(tournees): le bouton Figer la journée écrit tout ou rien via la RPC partagée avec le cron"`

---

### Task 7 : bandeau d'état dans le Planning

**Files:**
- Create: `src/apps/artisan/components/planning/JourneeEtatChips.jsx`
- Modify: `src/apps/artisan/pages/Planning.jsx` (hook + prop `dayHeaderContent`)

**Interfaces:**
- Consumes: `useEtatsJournees` (Task 5), `LIBELLES_ETAT` (Task 1).
- Produces: `<JourneeEtatChips date="YYYY-MM-DD" etats={Map} onOpen={(item) => void} />`.

- [ ] **Step 1 : composant**

```jsx
// src/apps/artisan/components/planning/JourneeEtatChips.jsx
// Puces d'état de journée (une par technicien planifié par la machine) sous
// l'en-tête d'un jour du Planning. Source unique de l'état : src/lib/tournee/etat.js.
import { Lock, AlertTriangle } from 'lucide-react';
import { LIBELLES_ETAT } from '@/lib/tournee/etat.js';

const STYLES = {
  vide: 'bg-secondary-50 text-secondary-500 border-secondary-200',
  ouverte: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pleine: 'bg-amber-50 text-amber-700 border-amber-200',
  figee: 'bg-violet-50 text-violet-700 border-violet-200',
  a_arbitrer: 'bg-red-50 text-red-700 border-red-200',
};

function formatFige(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Aide au survol : ce que la puce ne dit pas. */
function titre(item) {
  const parts = [`${item.technicienNom} — ${LIBELLES_ETAT[item.etat]}`];
  if (item.etiquette) parts.push(`Secteur ${item.etiquette}${item.origine === 'deduite' ? ' (déduit des RDV)' : ''}`);
  if (item.figeeAt) parts.push(`Figée le ${formatFige(item.figeeAt)} par ${item.figeePar === 'cron' ? 'le cron' : 'un membre'}`);
  else if (item.remplissage) parts.push(`Reste utile ≈ ${Math.round(item.remplissage.resteUtileMinutes)} min (estimé à vol d'oiseau)`);
  return parts.join('\n');
}

export function JourneeEtatChips({ date, etats, onOpen }) {
  const items = [...etats.values()].filter((i) => i.date === date).sort((a, b) => a.technicienNom.localeCompare(b.technicienNom, 'fr'));
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((item) => (
        <button
          key={item.technicienId}
          type="button"
          onClick={() => onOpen?.(item)}
          title={titre(item)}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-normal leading-tight ${STYLES[item.etat]}`}
        >
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.couleur || '#94A3B8' }} />
          <span className="max-w-[5rem] truncate">{String(item.technicienNom || '').split(' ')[0]}</span>
          {item.etat === 'figee' && <Lock className="h-3 w-3" />}
          {item.etat === 'a_arbitrer' && <AlertTriangle className="h-3 w-3" />}
          <span>{LIBELLES_ETAT[item.etat]}</span>
          {item.etiquette && item.etat !== 'vide' && <span className="opacity-70">· {item.etiquette}</span>}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2 : Planning.jsx** — importer `useNavigate` (déjà importé ? vérifier), `useEtatsJournees` depuis `@hooks/useTournees`, `JourneeEtatChips`. Après `const { appointments, events, … } = useAppointments(...)`, ajouter :

```jsx
  const navigate = useNavigate();
  const { etats: etatsJournees } = useEtatsJournees({ coreOrgId: orgId, startDate: dateRange.startDate, endDate: dateRange.endDate });
  const ouvrirJournee = useCallback((item) => {
    navigate(`/entretiens?tab=tournees&journee=${item.date}&tech=${item.technicienId}`);
  }, [navigate]);
  const dayHeaderContent = useCallback((arg) => {
    const date = arg.date.toLocaleDateString('fr-CA');
    return (
      <div className="flex flex-col items-start">
        <span>{arg.text}</span>
        {arg.view.type !== 'dayGridMonth' && <JourneeEtatChips date={date} etats={etatsJournees} onOpen={ouvrirJournee} />}
      </div>
    );
  }, [etatsJournees, ouvrirJournee]);
```

  et passer `dayHeaderContent={dayHeaderContent}` au `<FullCalendar>` (à côté de `dayHeaderFormat`). `dateRange.startDate`/`endDate` sont déjà des ISO `YYYY-MM-DD` (cf. `getDateRange`). `orgId` du Planning = org core (`organization.id`), c'est bien le `coreOrgId` attendu.
- [ ] **Step 3 : `npm run lint:errors && npx vite build`** → OK.
- [ ] **Step 4 : commit** `git add src/apps/artisan/components/planning/JourneeEtatChips.jsx src/apps/artisan/pages/Planning.jsx && git commit -m "feat(planning): état de chaque journée de technicien sous l'en-tête du jour (vide/ouverte/pleine/figée/à arbitrer)"`

---

### Task 8 : journal des crons dans le Dashboard entretiens

**Files:**
- Create: `src/apps/artisan/components/tournees/PlanificationJournal.jsx`
- Modify: `src/apps/artisan/components/entretiens/EntretiensDashboard.jsx` (prop `coreOrgId`, section), `src/apps/artisan/pages/Entretiens.jsx:525` (passer `coreOrgId={orgId}`)

**Interfaces:**
- Consumes: `usePlanificationRuns(coreOrgId, 'tournees-figer')`.
- Produces: `<PlanificationJournal coreOrgId />`.

- [ ] **Step 1 : composant**

```jsx
// src/apps/artisan/components/tournees/PlanificationJournal.jsx
// Derniers passages du cron de figeage (majordhome_planification_runs) : ce
// qu'il a figé, refusé, laissé à arbitrer. Répond à « je ne sais pas si le
// cron l'a fait » (Eric, 2026-09-29).
import { Clock } from 'lucide-react';
import { usePlanificationRuns } from '@hooks/useTournees';
import { formatDateTimeFR } from '@/lib/utils';

function compter(rapport, verdict) {
  return (rapport?.journees || []).filter((j) => j.verdict === verdict).length;
}

export function PlanificationJournal({ coreOrgId }) {
  const { data: runs, isLoading, error } = usePlanificationRuns(coreOrgId, 'tournees-figer');
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-secondary-500" />
        <h3 className="text-sm font-medium text-gray-900">Figeage automatique des journées pleines</h3>
      </div>
      {error && <p className="text-sm text-red-600">Journal illisible : {error.message}</p>}
      {!error && isLoading && <p className="text-sm text-gray-500">Chargement…</p>}
      {!error && !isLoading && (runs || []).length === 0 && (
        <p className="text-sm text-gray-500">Aucun passage enregistré. Le cron tourne toutes les heures de 7 h à 21 h ; s'il ne laisse aucune trace, il ne tourne pas.</p>
      )}
      {!error && (runs || []).length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500">
            <tr><th className="text-left py-1">Passage</th><th className="text-right">Journées vues</th><th className="text-right">Figées</th><th className="text-right">Refusées</th><th className="text-right">À arbitrer</th><th className="text-left pl-3">Remarque</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="py-1">{formatDateTimeFR(r.ran_at)}{r.dry_run ? ' (essai)' : ''}</td>
                <td className="text-right">{(r.rapport?.journees || []).length}</td>
                <td className="text-right">{compter(r.rapport, 'figee')}</td>
                <td className="text-right">{compter(r.rapport, 'refusee') + compter(r.rapport, 'erreur')}</td>
                <td className="text-right">{compter(r.rapport, 'a_arbitrer')}</td>
                <td className="pl-3 text-xs text-gray-500">{r.erreur || r.rapport?.skipped || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

  Vérifier que `formatDateTimeFR` existe dans `src/lib/utils.js` (CLAUDE.md le liste) ; sinon utiliser `new Date(r.ran_at).toLocaleString('fr-FR')`.
- [ ] **Step 2 : monter** — `EntretiensDashboard({ stats, savStats, isLoading, coreOrgId })` : après la section « Pipeline SAV », ajouter `<PlanificationJournal coreOrgId={coreOrgId} />` (hors du skeleton). Dans `Entretiens.jsx`, passer `coreOrgId={orgId}`.
- [ ] **Step 3 : `npm run lint:errors && npx vite build`** → OK.
- [ ] **Step 4 : commit** `git add src/apps/artisan/components/tournees/PlanificationJournal.jsx src/apps/artisan/components/entretiens/EntretiensDashboard.jsx src/apps/artisan/pages/Entretiens.jsx && git commit -m "feat(entretiens): journal des passages du cron de figeage dans le Dashboard"`

---

### Task 9 : documentation et audit

**Files:**
- Modify: `docs/MODULE_TOURNEES.md` (nouvelle section « État de journée, étiquettes de secteur, journal des crons »)
- Modify: `.claude/proposed-updates.md` (entrée PENDING pour CLAUDE.md § Module Tournées : 3 lignes — état unique `etat.js`, figeage = RPC partagée, journal `planification_runs`)

- [ ] **Step 1 : documenter** (tables, états, RPC user, journal, bandeau Planning, ce qui reste estimé à vol d'oiseau côté front).
- [ ] **Step 2 : `npm run audit:quality`** → vert (dead-code inclus).
- [ ] **Step 3 : commit** `git add docs/MODULE_TOURNEES.md .claude/proposed-updates.md && git commit -m "docs(tournees): état de journée, étiquettes de secteur, journal des crons"`

---

## Self-review

- **Couverture spec § 12 tranche 1** : `journees_secteur` déduites (Task 3 stockage, Task 5 déduction à la lecture — la persistance des déduites par le cron arrive en tranche 3 comme prévu § 4.1), `planification_runs` (Task 3, 4, 8), `tournees-figer` écrit `figee_at` (Task 3 via la RPC) et son rapport (Task 4), `verdictJournee` unifié (Task 1 `etatJournee` par-dessus), bandeau Planning (Task 7), journal Dashboard (Task 8). Aucun envoi.
- **Placeholders** : aucun.
- **Cohérence des noms** : `figerJourneeUser` (service) ↔ `tournees_figer_journee_user` (RPC) ↔ Task 6 ; `useEtatsJournees` ↔ Task 7 ; `usePlanificationRuns` ↔ Task 8 ; `tourneeKeys.journeesSecteur` / `runs` ↔ Task 5.
- **Écart assumé** : l'état affiché côté front est calculé à vol d'oiseau (`estime: true`), le cron à trajets réels ; la puce le dit au survol. `figee` vient de la base, donc toujours vrai.
