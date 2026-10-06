# Profils maison par organisation — Tranche 1 (base) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser en base tout ce qu'il faut pour qu'un membre porte un profil « maison » (libellé + modèle standard) et que `role_can` le voie, sans rien changer à l'écran tant qu'aucun profil n'existe.

**Architecture:** Deux tables `majordhome.org_roles` / `majordhome.member_org_roles` (schéma Majord'home, jamais `core`), des vues publiques `security_invoker`, quatre RPC SECURITY DEFINER org_admin, et UNE fonction de sécurité modifiée (`majordhome.role_can`) qui consulte d'abord la surcharge du code maison puis déroule la chaîne existante. `user_effective_role` ne change pas : tout le code en dur continue de voir le modèle. Côté front, seul le module pur `resolvePermission` apprend la même chaîne (sans UI) pour que le test de cohérence compare les deux verdicts.

**Tech Stack:** PostgreSQL (plpgsql, RLS, triggers), harnais `scripts/migration-rehearsal/` (cluster local + impersonation `request.jwt.claim.sub`), Node `node --test`, MCP Supabase `apply_migration` pour la prod.

**Spec:** `docs/superpowers/specs/2026-10-06-profils-maison-par-org-design.md` (§ 3 modèle de données, § 4 résolution + RPC, § 6 désactivation, § 8 sécurité)

## Global Constraints

- Org CORE partout (`core.organizations.id`, ex. Mayer `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`), comme `leads` et `role_permissions`.
- Toute RPC SECURITY DEFINER : `REVOKE ALL … FROM PUBLIC; REVOKE ALL … FROM anon;` puis `GRANT EXECUTE … TO authenticated` ; garde positive `IF (…) IS NOT TRUE THEN RAISE` ; `auth.uid()` NULL ⇒ refus ; `p_org_id` recoupé avec la membership de l'appelant.
- Toute table `majordhome.*` : RLS activée à la création, SELECT membre de l'org, aucune policy d'écriture (RPC seulement), `GRANT SELECT … TO service_role`.
- Toute vue `public.majordhome_*` : `WITH (security_invoker = true)`, `GRANT SELECT … TO authenticated, service_role`.
- Codes standard = `org_admin | team_leader | commercial | technicien` ; modèles autorisés = `team_leader | commercial | technicien`.
- Un `code` de profil maison : `^[a-z0-9_]+$`, immuable, jamais un code standard, unique par org.
- Toute migration est répétée sur le harnais (`run.mjs --migration … --assert …`) AVANT `apply_migration` en prod ; l'effet des REVOKE se vérifie par `has_function_privilege`, jamais en relisant le SQL.
- Fichiers à backslashes : Write/Edit, pas de heredoc Bash. Fichiers existants : conserver leurs fins de ligne (CRLF).
- Commits par pathspec (d'autres sessions travaillent sur `main`), message en français, terminé par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20261006_1_org_roles.sql` (créer) | tables, vues, trigger `role_permissions_check_role`, `user_org_role_code`, `role_can` modifiée |
| `supabase/migrations/20261006_2_org_roles_rpc.sql` (créer) | `org_role_create` / `org_role_update` / `org_role_delete` / `member_set_org_role` |
| `scripts/migration-rehearsal/snapshot.mjs` (modifier) | fonctions appelées par les RPC ajoutées à `FUNCTIONS` |
| `scripts/migration-rehearsal/assert-org-roles.sql` (créer) | assertions migration 1 (structure, trigger, chaîne de résolution par impersonation) |
| `scripts/migration-rehearsal/assert-org-roles-rpc.sql` (créer) | assertions migration 2 (gardes, création, assignation, suppression) |
| `src/lib/permissionsRegistry.js` (modifier, `resolvePermission`) | même chaîne côté front, paramètre optionnel |
| `scripts/permissions-resolve.test.mjs` (créer) | test node de la chaîne front |
| `scripts/permissions-coherence.mjs` (modifier) | section 4 : intégrité des profils maison + `role_can` les consulte |
| `package.json` (modifier) | nouveau test dans `audit:quality` |

---

### Task 0 : Harnais — fonctions appelées par les nouvelles RPC

**Files:**
- Modify: `scripts/migration-rehearsal/snapshot.mjs:70-103` (liste `FUNCTIONS`)

**Interfaces:**
- Produces: un cluster de répétition où `core.update_member_role`, `public.team_member_sync_role_for_user`, `majordhome.planning_role_for`, `public.org_upsert_role_permission` existent (les RPC de la Task 2 les appellent ; `plpgsql` ne résout qu'à l'exécution, donc sans elles les assertions échouent en « function does not exist »).

- [x] **Step 1 : Ajouter les fonctions à `FUNCTIONS`**

Après la ligne `'majordhome.role_can(uuid, text, text)',` insérer :

```js
  // 20261006_1..2 (profils maison) : appelées par member_set_org_role / org_role_delete,
  // et org_upsert_role_permission doit traverser le trigger role_permissions_check_role.
  'core.update_member_role(uuid, uuid, text, text, text)',
  'public.update_member_role(uuid, uuid, text, text, text)',
  'public.team_member_sync_role_for_user(uuid, uuid)',
  'majordhome.planning_role_for(text, text, text)',
  'public.org_upsert_role_permission(uuid, text, text, text, boolean)',
```

- [x] **Step 2 : Re-photographier la prod et contrôler le cluster**

Run :
```bash
node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local && node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-baseline.sql
```
Expected : `[rehearsal] OK`. Si `core.update_member_role` fait échouer le chargement (dépendance absente du sous-ensemble), lire `scratch/postgres.log`, ajouter la dépendance à `FUNCTIONS`/`TABLES`, ne pas contourner.

- [x] **Step 3 : Commit**

```bash
git add scripts/migration-rehearsal/snapshot.mjs
git commit -m "chore(rehearsal): fonctions appelées par les RPC des profils maison

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1 : Migration 1 — tables, vues, trigger, `user_org_role_code`, `role_can`

**Files:**
- Create: `supabase/migrations/20261006_1_org_roles.sql`
- Create: `scripts/migration-rehearsal/assert-org-roles.sql`

**Interfaces:**
- Produces :
  - `majordhome.org_roles(id uuid, org_id uuid, code text, label text, base_role text, is_active boolean, created_at, updated_at)`
  - `majordhome.member_org_roles(org_id uuid, user_id uuid, org_role_id uuid)` PK `(org_id, user_id)`
  - `public.majordhome_org_roles`, `public.majordhome_member_org_roles` (vues)
  - `majordhome.user_org_role_code(p_org_id uuid) RETURNS text` — code maison ACTIF de `auth.uid()` dans l'org, sinon NULL
  - trigger `role_permissions_check_role` sur `majordhome.role_permissions` (remplace le CHECK `role_permissions_role_check`)
  - `majordhome.role_can` : consulte `role_permissions(org, code maison)` avant la chaîne existante

- [x] **Step 1 : Écrire les assertions (elles échouent tant que la migration n'est pas jouée)**

Fichier `scripts/migration-rehearsal/assert-org-roles.sql` :

```sql
-- assert-org-roles.sql — vérifie 20261006_1_org_roles.sql sur le cluster de répétition.
-- A. structure (tables, RLS, vues security_invoker, ACL)
-- B. trigger role_permissions_check_role (standard ok, code maison de l'org ok, autre org / inconnu refusé)
-- C. chaîne de résolution par impersonation : surcharge maison > surcharge modèle > défaut modèle
-- D. profil inactif ⇒ user_org_role_code NULL ⇒ verdict du modèle ; user_effective_role inchangé
CREATE OR REPLACE FUNCTION pg_temp.expect_err(p_label text, p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION '% : aucune erreur levée', p_label;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_code THEN
    RAISE EXCEPTION '% : SQLSTATE % attendu, % reçu (%)', p_label, p_code, SQLSTATE, SQLERRM;
  END IF;
END;
$f$;

-- ── A. Structure ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('majordhome.org_roles') IS NULL THEN RAISE EXCEPTION '(A) majordhome.org_roles absente'; END IF;
  IF to_regclass('majordhome.member_org_roles') IS NULL THEN RAISE EXCEPTION '(A) majordhome.member_org_roles absente'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.org_roles'::regclass) THEN RAISE EXCEPTION '(A) RLS org_roles'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.member_org_roles'::regclass) THEN RAISE EXCEPTION '(A) RLS member_org_roles'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename IN ('org_roles', 'member_org_roles') AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '(A) policy d''écriture interdite sur org_roles / member_org_roles';
  END IF;
  IF to_regclass('public.majordhome_org_roles') IS NULL OR to_regclass('public.majordhome_member_org_roles') IS NULL THEN
    RAISE EXCEPTION '(A) vues publiques absentes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.majordhome_org_roles'::regclass, 'public.majordhome_member_org_roles'::regclass)
             AND NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions)), false)) THEN
    RAISE EXCEPTION '(A) vue sans security_invoker';
  END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.org_roles', 'SELECT') THEN RAISE EXCEPTION '(A) service_role sans SELECT org_roles'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.member_org_roles', 'SELECT') THEN RAISE EXCEPTION '(A) service_role sans SELECT member_org_roles'; END IF;
  IF has_function_privilege('anon', 'majordhome.user_org_role_code(uuid)', 'EXECUTE') THEN RAISE EXCEPTION '(A) anon exécute user_org_role_code'; END IF;
  IF NOT has_function_privilege('authenticated', 'majordhome.user_org_role_code(uuid)', 'EXECUTE') THEN RAISE EXCEPTION '(A) authenticated sans user_org_role_code'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'majordhome.role_permissions'::regclass AND conname = 'role_permissions_role_check') THEN
    RAISE EXCEPTION '(A) CHECK role_permissions_role_check toujours présent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'majordhome.role_permissions'::regclass AND tgname = 'role_permissions_check_role') THEN
    RAISE EXCEPTION '(A) trigger role_permissions_check_role absent';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'majordhome.role_can(uuid, text, text)'::regprocedure) NOT ILIKE '%user_org_role_code%' THEN
    RAISE EXCEPTION '(A) role_can ne consulte pas user_org_role_code';
  END IF;
END $$;

-- ── B. Trigger + C. Chaîne de résolution + D. Inactif ───────────────────────
-- Sous transaction ANNULÉE : la fixture (profil, surcharges) ne survit pas, les
-- assertions suivantes (assert-org-roles-rpc.sql) partent d'une org sans profil.
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_cimaj uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
  v_tech  uuid := '3fb86975-5f01-4162-ad68-bc2e7eb52343';   -- Mayer : user + Technicien (Mohammed)
  v_role  uuid;
BEGIN
  -- Fixture : profil « Secrétaire » bâti sur technicien (insert direct : les RPC arrivent en 20261006_2)
  INSERT INTO majordhome.org_roles (org_id, code, label, base_role)
  VALUES (v_mayer, 'secretaire', 'Secrétaire', 'technicien') RETURNING id INTO v_role;

  -- B. trigger
  INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed) VALUES (v_mayer, 'secretaire', 'pipeline', 'view', true);
  PERFORM pg_temp.expect_err('(B) code d''une autre org',
    format('INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed) VALUES (%L, %L, %L, %L, true)', v_cimaj, 'secretaire', 'pipeline', 'view'),
    '23514');
  PERFORM pg_temp.expect_err('(B) code inconnu',
    format('INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed) VALUES (%L, %L, %L, %L, true)', v_mayer, 'inconnu', 'pipeline', 'view'),
    '23514');
  PERFORM pg_temp.expect_err('(B) code standard interdit comme profil maison',
    format('INSERT INTO majordhome.org_roles (org_id, code, label, base_role) VALUES (%L, %L, %L, %L)', v_mayer, 'commercial', 'Commercial bis', 'commercial'),
    '23514');
  PERFORM pg_temp.expect_err('(B) modèle org_admin interdit',
    format('INSERT INTO majordhome.org_roles (org_id, code, label, base_role) VALUES (%L, %L, %L, %L)', v_mayer, 'patron', 'Patron', 'org_admin'),
    '23514');

  -- C. Mohammed porte « Secrétaire »
  INSERT INTO majordhome.member_org_roles (org_id, user_id, org_role_id) VALUES (v_mayer, v_tech, v_role);
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  SET LOCAL ROLE authenticated;
  IF majordhome.user_effective_role(v_mayer) <> 'technicien' THEN RAISE EXCEPTION '(C) user_effective_role doit rester technicien'; END IF;
  IF majordhome.user_org_role_code(v_mayer) <> 'secretaire' THEN RAISE EXCEPTION '(C) user_org_role_code = secretaire attendu'; END IF;
  -- surcharge maison (pipeline.view = true) l'emporte sur le défaut technicien (false)
  IF NOT majordhome.role_can(v_mayer, 'pipeline', 'view') THEN RAISE EXCEPTION '(C) surcharge maison ignorée'; END IF;
  -- sans surcharge maison : défaut du modèle technicien (clients.create = false, clients.edit = true)
  IF majordhome.role_can(v_mayer, 'clients', 'create') THEN RAISE EXCEPTION '(C) clients.create doit suivre le modèle (false)'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'clients', 'edit') THEN RAISE EXCEPTION '(C) clients.edit doit suivre le modèle (true)'; END IF;
  RESET ROLE;

  -- surcharge du MODÈLE dans l'org : héritée par le profil maison
  INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed) VALUES (v_mayer, 'technicien', 'clients', 'create', true)
  ON CONFLICT (org_id, role, resource, action) DO UPDATE SET allowed = true;
  SET LOCAL ROLE authenticated;
  IF NOT majordhome.role_can(v_mayer, 'clients', 'create') THEN RAISE EXCEPTION '(C) surcharge du modèle non héritée'; END IF;
  RESET ROLE;

  -- D. profil désactivé ⇒ code NULL ⇒ verdict du modèle (pipeline.view technicien = false)
  UPDATE majordhome.org_roles SET is_active = false WHERE id = v_role;
  SET LOCAL ROLE authenticated;
  IF majordhome.user_org_role_code(v_mayer) IS NOT NULL THEN RAISE EXCEPTION '(D) profil inactif doit donner NULL'; END IF;
  IF majordhome.role_can(v_mayer, 'pipeline', 'view') THEN RAISE EXCEPTION '(D) profil inactif : verdict du modèle attendu (false)'; END IF;
  RESET ROLE;

  -- anonyme : rien
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE authenticated;
  IF majordhome.user_org_role_code(v_mayer) IS NOT NULL THEN RAISE EXCEPTION '(D) anonyme : NULL attendu'; END IF;
  RESET ROLE;

  RAISE NOTICE 'assert-org-roles OK';
END $$;
ROLLBACK;
```

- [x] **Step 2 : Vérifier que les assertions échouent sans la migration**

Run :
```bash
node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-org-roles.sql
```
Expected : ECHEC avec `(A) majordhome.org_roles absente`.

- [x] **Step 3 : Écrire la migration**

Fichier `supabase/migrations/20261006_1_org_roles.sql` :

```sql
-- =============================================================================
-- 20261006_1_org_roles — profils « maison » par organisation (tranche 1, base)
-- =============================================================================
-- Spec : docs/superpowers/specs/2026-10-06-profils-maison-par-org-design.md
-- Un profil maison = libellé propre à l'org + MODÈLE standard (team_leader |
-- commercial | technicien). Partout où le code teste un rôle en dur, c'est le
-- modèle qui est vu (user_effective_role ne change pas). Seule la grille Droits
-- d'accès distingue le profil : role_can consulte d'abord la surcharge du code
-- maison, puis déroule la chaîne existante (surcharge modèle → défaut modèle →
-- refus). Écritures par RPC uniquement (20261006_2).
-- =============================================================================

-- ── 1. Tables ─────────────────────────────────────────────────────────────────
CREATE TABLE majordhome.org_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  code        text NOT NULL,
  label       text NOT NULL,
  base_role   text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_roles_code_format CHECK (code ~ '^[a-z0-9_]+$'),
  CONSTRAINT org_roles_code_not_standard CHECK (code NOT IN ('org_admin', 'team_leader', 'commercial', 'technicien')),
  CONSTRAINT org_roles_base_role CHECK (base_role IN ('team_leader', 'commercial', 'technicien')),
  CONSTRAINT org_roles_label_not_blank CHECK (length(trim(label)) > 0),
  CONSTRAINT org_roles_org_code_uniq UNIQUE (org_id, code),
  CONSTRAINT org_roles_id_org_uniq UNIQUE (id, org_id)   -- cible de la FK composite ci-dessous
);
COMMENT ON TABLE majordhome.org_roles IS
  'Profils « maison » d''une org : libellé + modèle standard. Le code est immuable et n''est jamais un code standard. Écritures par RPC org_role_* (org_admin).';

CREATE TABLE majordhome.member_org_roles (
  org_id       uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  org_role_id  uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  -- même org que le profil, et CASCADE à la suppression du profil
  FOREIGN KEY (org_role_id, org_id) REFERENCES majordhome.org_roles(id, org_id) ON DELETE CASCADE
);
CREATE INDEX member_org_roles_role_idx ON majordhome.member_org_roles (org_role_id);
COMMENT ON TABLE majordhome.member_org_roles IS
  'Qui porte quel profil maison (au plus un par membre et par org). Pas de ligne = rôle standard. Écriture par member_set_org_role (org_admin).';

-- ── 2. RLS : lecture membre de l''org, aucune écriture directe ───────────────
ALTER TABLE majordhome.org_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.member_org_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_roles_select_org_members ON majordhome.org_roles
  FOR SELECT USING (org_id IN (
    SELECT om.org_id FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.status = 'active'));

CREATE POLICY member_org_roles_select_org_members ON majordhome.member_org_roles
  FOR SELECT USING (org_id IN (
    SELECT om.org_id FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.status = 'active'));

-- ACL par défaut du schéma majordhome : anon/authenticated reçoivent arwd — on retire
-- tout, puis on rend SELECT seul (les écritures passent par les RPC SECURITY DEFINER).
REVOKE ALL ON majordhome.org_roles, majordhome.member_org_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.org_roles, majordhome.member_org_roles TO authenticated;
GRANT SELECT ON majordhome.org_roles, majordhome.member_org_roles TO service_role;

-- ── 3. Vues publiques (security_invoker) ─────────────────────────────────────
CREATE VIEW public.majordhome_org_roles WITH (security_invoker = true) AS
  SELECT id, org_id, code, label, base_role, is_active, created_at, updated_at
  FROM majordhome.org_roles;
GRANT SELECT ON public.majordhome_org_roles TO authenticated, service_role;

CREATE VIEW public.majordhome_member_org_roles WITH (security_invoker = true) AS
  SELECT m.org_id, m.user_id, m.org_role_id, r.code, r.label, r.base_role, r.is_active
  FROM majordhome.member_org_roles m
  JOIN majordhome.org_roles r ON r.id = m.org_role_id;
GRANT SELECT ON public.majordhome_member_org_roles TO authenticated, service_role;

-- ── 4. role_permissions accepte les codes maison DE L''ORG ───────────────────
-- Un CHECK ne peut pas lire une autre table, un FK ne peut pas être conditionnel :
-- trigger. Un code maison d''une AUTRE org est refusé (23514, comme l''ancien CHECK).
ALTER TABLE majordhome.role_permissions DROP CONSTRAINT role_permissions_role_check;

CREATE OR REPLACE FUNCTION majordhome.role_permissions_check_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'majordhome', 'public'
AS $function$
BEGIN
  IF NEW.role IN ('org_admin', 'team_leader', 'commercial', 'technicien') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.org_roles r WHERE r.org_id = NEW.org_id AND r.code = NEW.role) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'role_permissions.role invalide : % (ni standard, ni profil maison de l''org %)', NEW.role, NEW.org_id
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER role_permissions_check_role
  BEFORE INSERT OR UPDATE OF role, org_id ON majordhome.role_permissions
  FOR EACH ROW EXECUTE FUNCTION majordhome.role_permissions_check_role();

-- ── 5. Code maison de l''appelant ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.user_org_role_code(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
  SELECT r.code
  FROM majordhome.member_org_roles m
  JOIN majordhome.org_roles r ON r.id = m.org_role_id
  WHERE m.org_id = p_org_id
    AND m.user_id = auth.uid()
    AND r.is_active
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION majordhome.user_org_role_code(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION majordhome.user_org_role_code(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION majordhome.user_org_role_code(uuid) TO authenticated;
COMMENT ON FUNCTION majordhome.user_org_role_code(uuid) IS
  'Code du profil maison ACTIF porté par auth.uid() dans l''org, sinon NULL. Lu par role_can — jamais passé en paramètre.';

-- ── 6. role_can : surcharge maison d''abord, puis chaîne existante ───────────
CREATE OR REPLACE FUNCTION majordhome.role_can(p_org_id uuid, p_resource text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_role text;
  v_code text;
  v_allowed boolean;
BEGIN
  v_role := majordhome.user_effective_role(p_org_id);
  IF v_role IS NULL THEN RETURN false; END IF;       -- pas membre de l'org
  IF v_role = 'org_admin' THEN RETURN true; END IF;  -- bypass admin

  -- 0) surcharge du profil maison (20261006_1) — le modèle reste v_role
  v_code := majordhome.user_org_role_code(p_org_id);
  IF v_code IS NOT NULL THEN
    SELECT allowed INTO v_allowed
    FROM majordhome.role_permissions
    WHERE org_id = p_org_id AND role = v_code AND resource = p_resource AND action = p_action;
    IF FOUND THEN RETURN v_allowed; END IF;
  END IF;

  -- 1) override per-org du modèle
  SELECT allowed INTO v_allowed
  FROM majordhome.role_permissions
  WHERE org_id = p_org_id AND role = v_role AND resource = p_resource AND action = p_action;
  IF FOUND THEN RETURN v_allowed; END IF;

  -- 2) défaut app-level du modèle
  SELECT allowed INTO v_allowed
  FROM majordhome.app_role_permissions
  WHERE role = v_role AND resource = p_resource AND action = p_action;
  IF FOUND THEN RETURN v_allowed; END IF;

  RETURN false;  -- fail-closed
END;
$function$;
-- ACL de role_can inchangées (REVOKE anon posé par 20260930_13) : CREATE OR REPLACE conserve les privilèges.
```

- [x] **Step 4 : Répéter la migration avec les assertions**

Run :
```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261006_1_org_roles.sql --assert scripts/migration-rehearsal/assert-org-roles.sql --assert scripts/migration-rehearsal/assert-permissions.sql
```
Expected : `NOTICE: assert-org-roles OK` puis `[rehearsal] OK`. `assert-permissions.sql` (droits app-level de septembre) doit rester vert : la chaîne existante n'a pas bougé pour un membre sans profil maison. Si `assert-permissions.sql` section (B) échoue sur « anon a EXECUTE sur role_can » : le harnais ne photographie pas les ACL des fonctions — relancer avec `--migration supabase/migrations/20260930_13_permissions_rls_role_can_leads_contracts_quotes_tasks.sql` en premier, comme le note l'en-tête de ce fichier.

- [x] **Step 5 : Commit**

```bash
git add supabase/migrations/20261006_1_org_roles.sql scripts/migration-rehearsal/assert-org-roles.sql
git commit -m "feat(droits): profils maison — tables org_roles / member_org_roles, role_can consulte le code maison

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : Migration 2 — RPC `org_role_create` / `org_role_update` / `org_role_delete` / `member_set_org_role`

**Files:**
- Create: `supabase/migrations/20261006_2_org_roles_rpc.sql`
- Create: `scripts/migration-rehearsal/assert-org-roles-rpc.sql`

**Interfaces:**
- Consumes : tables et `user_org_role_code` de la Task 1 ; `core.update_member_role(p_org_id uuid, p_user_id uuid, p_app_role text, p_business_role text, p_membership_role text)` (existante) ; `public.team_member_sync_role_for_user(uuid, uuid)` (existante).
- Produces (toutes `SECURITY DEFINER`, org_admin de `p_org_id` requis, `42501` sinon) :
  - `public.org_role_create(p_org_id uuid, p_label text, p_base_role text) RETURNS majordhome.org_roles` — code dérivé du libellé (`secretaire`, puis `secretaire_2`…), `22023` si libellé vide ou modèle invalide
  - `public.org_role_update(p_org_role_id uuid, p_label text DEFAULT NULL, p_is_active boolean DEFAULT NULL) RETURNS majordhome.org_roles` — NULL = inchangé ; `P0002` si profil inconnu
  - `public.org_role_delete(p_org_role_id uuid) RETURNS jsonb` — `{ "members_reset": n, "overrides_deleted": n }` ; purge `role_permissions` du code, CASCADE `member_org_roles`
  - `public.member_set_org_role(p_org_id uuid, p_user_id uuid, p_org_role_id uuid) RETURNS text` — pose/retire (NULL) le profil ET réaligne les champs `core` sur le modèle, puis resynchronise le rôle planning ; retourne le code posé ou NULL ; `42501` si `p_user_id` n'est pas membre, `P0002` si profil d'une autre org

- [x] **Step 1 : Écrire les assertions**

Fichier `scripts/migration-rehearsal/assert-org-roles-rpc.sql` :

```sql
-- assert-org-roles-rpc.sql — vérifie 20261006_2_org_roles_rpc.sql (à lancer APRÈS 20261006_1).
-- A. ACL des 4 RPC (anon non, authenticated oui)
-- B. gardes : anonyme / non-admin / membre inconnu / profil d'une autre org / modèle invalide
-- C. création (code dérivé + suffixe), assignation (champs core alignés sur le modèle, rôle planning),
--    retour au standard, désactivation, suppression (purge + reset)
CREATE OR REPLACE FUNCTION pg_temp.expect_err(p_label text, p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION '% : aucune erreur levée', p_label;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_code THEN
    RAISE EXCEPTION '% : SQLSTATE % attendu, % reçu (%)', p_label, p_code, SQLSTATE, SQLERRM;
  END IF;
END;
$f$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'public.org_role_create(uuid, text, text)',
    'public.org_role_update(uuid, text, boolean)',
    'public.org_role_delete(uuid)',
    'public.member_set_org_role(uuid, uuid, uuid)']) AS f LOOP
    IF has_function_privilege('anon', r.f, 'EXECUTE') THEN RAISE EXCEPTION '(A) anon exécute %', r.f; END IF;
    IF NOT has_function_privilege('authenticated', r.f, 'EXECUTE') THEN RAISE EXCEPTION '(A) authenticated sans %', r.f; END IF;
  END LOOP;
END $$;

-- Sous transaction ANNULÉE : réécrit core.profiles / organization_members / team_members
-- de Mohammed et Philippe pendant le test, rien ne doit rester.
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_cimaj uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';   -- Mayer org_admin (Eric)
  v_tech  uuid := '3fb86975-5f01-4162-ad68-bc2e7eb52343';   -- Mayer user + Technicien (Mohammed)
  v_tl    uuid := '69e365ef-b0a0-48b2-bd58-9c6c4f415c3f';   -- Mayer team_leader (Philippe)
  v_cimaj_admin uuid;
  v_r1    majordhome.org_roles;
  v_r2    majordhome.org_roles;
  v_r3    majordhome.org_roles;
  v_code  text;
  v_json  jsonb;
  n       int;
BEGIN
  SELECT user_id INTO v_cimaj_admin FROM core.organization_members WHERE org_id = v_cimaj AND role = 'org_admin' LIMIT 1;

  -- B. anonyme
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.expect_err('(B) create anonyme', format('SELECT public.org_role_create(%L, %L, %L)', v_mayer, 'Secrétaire', 'team_leader'), '42501');
  -- B. non-admin
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  PERFORM pg_temp.expect_err('(B) create non-admin', format('SELECT public.org_role_create(%L, %L, %L)', v_mayer, 'Secrétaire', 'team_leader'), '42501');
  -- B. admin d'une autre org
  IF v_cimaj_admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_cimaj_admin::text, true);
    PERFORM pg_temp.expect_err('(B) create admin autre org', format('SELECT public.org_role_create(%L, %L, %L)', v_mayer, 'Secrétaire', 'team_leader'), '42501');
  END IF;

  -- C. admin Mayer
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.expect_err('(B) modèle invalide', format('SELECT public.org_role_create(%L, %L, %L)', v_mayer, 'Patron', 'org_admin'), '22023');
  PERFORM pg_temp.expect_err('(B) libellé vide', format('SELECT public.org_role_create(%L, %L, %L)', v_mayer, '   ', 'commercial'), '22023');

  v_r1 := public.org_role_create(v_mayer, 'Secrétaire', 'team_leader');
  IF v_r1.code <> 'secretaire' THEN RAISE EXCEPTION '(C) code dérivé : secretaire attendu, % reçu', v_r1.code; END IF;
  IF v_r1.base_role <> 'team_leader' OR NOT v_r1.is_active THEN RAISE EXCEPTION '(C) profil créé incohérent'; END IF;
  v_r2 := public.org_role_create(v_mayer, 'Secrétaire', 'commercial');
  IF v_r2.code <> 'secretaire_2' THEN RAISE EXCEPTION '(C) suffixe : secretaire_2 attendu, % reçu', v_r2.code; END IF;
  v_r3 := public.org_role_create(v_mayer, 'Assistant·e commercial(e) !', 'commercial');
  IF v_r3.code <> 'assistant_e_commercial_e' THEN RAISE EXCEPTION '(C) translittération : assistant_e_commercial_e attendu, % reçu', v_r3.code; END IF;

  -- assignation : Mohammed (technicien) devient Secrétaire bâtie sur Responsable
  PERFORM pg_temp.expect_err('(B) membre inconnu', format('SELECT public.member_set_org_role(%L, %L, %L)', v_mayer, gen_random_uuid(), v_r1.id), '42501');
  v_code := public.member_set_org_role(v_mayer, v_tech, v_r1.id);
  IF v_code <> 'secretaire' THEN RAISE EXCEPTION '(C) member_set_org_role : secretaire attendu, % reçu', v_code; END IF;
  SELECT count(*) INTO n FROM majordhome.member_org_roles WHERE org_id = v_mayer AND user_id = v_tech AND org_role_id = v_r1.id;
  IF n <> 1 THEN RAISE EXCEPTION '(C) assignation absente'; END IF;
  -- champs core alignés sur le modèle team_leader
  IF (SELECT app_role FROM core.profiles WHERE id = v_tech) <> 'team_leader' THEN RAISE EXCEPTION '(C) app_role doit valoir team_leader'; END IF;
  IF (SELECT business_role FROM core.profiles WHERE id = v_tech) IS NOT NULL THEN RAISE EXCEPTION '(C) business_role doit être NULL'; END IF;
  IF (SELECT role FROM core.organization_members WHERE org_id = v_mayer AND user_id = v_tech) <> 'team_leader' THEN RAISE EXCEPTION '(C) membership role doit valoir team_leader'; END IF;
  -- rôle planning resynchronisé (team_leader → commercial)
  IF (SELECT role FROM majordhome.team_members WHERE user_id = v_tech) IS DISTINCT FROM 'commercial' THEN RAISE EXCEPTION '(C) team_members.role doit valoir commercial'; END IF;
  -- vu par la chaîne : rôle effectif = modèle, code = maison
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  IF majordhome.user_effective_role(v_mayer) <> 'team_leader' THEN RAISE EXCEPTION '(C) user_effective_role = team_leader attendu'; END IF;
  IF majordhome.user_org_role_code(v_mayer) <> 'secretaire' THEN RAISE EXCEPTION '(C) user_org_role_code = secretaire attendu'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- ré-assigner sur un autre profil remplace (au plus un par membre)
  v_code := public.member_set_org_role(v_mayer, v_tech, v_r2.id);
  SELECT count(*) INTO n FROM majordhome.member_org_roles WHERE org_id = v_mayer AND user_id = v_tech;
  IF n <> 1 OR v_code <> 'secretaire_2' THEN RAISE EXCEPTION '(C) ré-assignation : 1 ligne secretaire_2 attendue'; END IF;
  IF (SELECT business_role FROM core.profiles WHERE id = v_tech) <> 'Commercial' THEN RAISE EXCEPTION '(C) modèle commercial : business_role Commercial attendu'; END IF;

  -- profil d'une autre org : refusé
  IF v_cimaj_admin IS NOT NULL THEN
    PERFORM pg_temp.expect_err('(B) profil autre org', format('SELECT public.member_set_org_role(%L, %L, %L)', v_cimaj, v_cimaj_admin, v_r1.id), '42501');
  END IF;

  -- retour au standard : la ligne disparaît, les champs core ne sont PAS touchés (l'appelant pose le standard ensuite)
  v_code := public.member_set_org_role(v_mayer, v_tech, NULL);
  IF v_code IS NOT NULL THEN RAISE EXCEPTION '(C) retour standard : NULL attendu'; END IF;
  SELECT count(*) INTO n FROM majordhome.member_org_roles WHERE org_id = v_mayer AND user_id = v_tech;
  IF n <> 0 THEN RAISE EXCEPTION '(C) retour standard : ligne restante'; END IF;

  -- update : libellé + désactivation, code immuable
  v_r1 := public.org_role_update(v_r1.id, 'Secrétariat', NULL);
  IF v_r1.label <> 'Secrétariat' OR v_r1.code <> 'secretaire' THEN RAISE EXCEPTION '(C) update libellé'; END IF;
  v_r1 := public.org_role_update(v_r1.id, NULL, false);
  IF v_r1.is_active THEN RAISE EXCEPTION '(C) update désactivation'; END IF;
  PERFORM pg_temp.expect_err('(B) update profil inconnu', format('SELECT public.org_role_update(%L, %L, NULL)', gen_random_uuid(), 'X'), 'P0002');

  -- delete : surcharges purgées, membres remis sur le modèle
  PERFORM public.member_set_org_role(v_mayer, v_tech, v_r2.id);
  PERFORM public.member_set_org_role(v_mayer, v_tl, v_r2.id);
  PERFORM public.org_upsert_role_permission(v_mayer, 'secretaire_2', 'pipeline', 'edit', true);
  PERFORM public.org_upsert_role_permission(v_mayer, 'secretaire_2', 'clients', 'create', false);
  v_json := public.org_role_delete(v_r2.id);
  IF (v_json->>'members_reset')::int <> 2 THEN RAISE EXCEPTION '(C) delete : members_reset=2 attendu, %', v_json; END IF;
  IF (v_json->>'overrides_deleted')::int <> 2 THEN RAISE EXCEPTION '(C) delete : overrides_deleted=2 attendu, %', v_json; END IF;
  SELECT count(*) INTO n FROM majordhome.role_permissions WHERE org_id = v_mayer AND role = 'secretaire_2';
  IF n <> 0 THEN RAISE EXCEPTION '(C) delete : surcharges restantes'; END IF;
  SELECT count(*) INTO n FROM majordhome.member_org_roles WHERE org_role_id = v_r2.id;
  IF n <> 0 THEN RAISE EXCEPTION '(C) delete : assignations restantes'; END IF;
  PERFORM pg_temp.expect_err('(B) delete profil inconnu', format('SELECT public.org_role_delete(%L)', v_r2.id), 'P0002');

  RAISE NOTICE 'assert-org-roles-rpc OK';
END $$;
ROLLBACK;
```

- [x] **Step 2 : Vérifier l'échec sans la migration 2**

Run :
```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261006_1_org_roles.sql --assert scripts/migration-rehearsal/assert-org-roles-rpc.sql
```
Expected : ECHEC sur `(A)` — `function public.org_role_create(uuid, text, text) does not exist`.

- [x] **Step 3 : Écrire la migration**

Fichier `supabase/migrations/20261006_2_org_roles_rpc.sql` :

```sql
-- =============================================================================
-- 20261006_2_org_roles_rpc — profils maison : les 4 RPC d'écriture (org_admin)
-- =============================================================================
-- Spec § 4.2. Seuls écrivains de majordhome.org_roles / member_org_roles.
-- member_set_org_role pose le profil ET réaligne les champs core sur le MODÈLE
-- (invariant § 3.2 : tout le code en dur voit le modèle), puis resynchronise le
-- rôle planning comme le fait permissions.service.updateMemberRole.
-- =============================================================================

-- ── garde commune ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.org_roles_require_admin(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'core', 'public'
AS $function$
DECLARE v_role text;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_role
  FROM core.organization_members
  WHERE user_id = auth.uid() AND org_id = p_org_id;
  IF (v_role = 'org_admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required (role=%)', v_role USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION majordhome.org_roles_require_admin(uuid) FROM PUBLIC, anon;

-- ── org_role_create ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_role_create(p_org_id uuid, p_label text, p_base_role text)
RETURNS majordhome.org_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_label text := NULLIF(trim(p_label), '');
  v_base  text;
  v_code  text;
  v_i     int := 1;
  v_row   majordhome.org_roles;
BEGIN
  PERFORM majordhome.org_roles_require_admin(p_org_id);
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'label_required' USING ERRCODE = '22023';
  END IF;
  IF p_base_role NOT IN ('team_leader', 'commercial', 'technicien') THEN
    RAISE EXCEPTION 'invalid_base_role (%)', p_base_role USING ERRCODE = '22023';
  END IF;

  -- code : translittération (unaccent) → minuscules → [a-z0-9_] → bornes nettoyées
  v_base := trim(both '_' from regexp_replace(lower(public.unaccent(v_label)), '[^a-z0-9]+', '_', 'g'));
  IF v_base = '' OR v_base IN ('org_admin', 'team_leader', 'commercial', 'technicien') THEN
    v_base := 'profil_' || v_base;
  END IF;
  v_code := v_base;
  WHILE EXISTS (SELECT 1 FROM majordhome.org_roles WHERE org_id = p_org_id AND code = v_code) LOOP
    v_i := v_i + 1;
    v_code := v_base || '_' || v_i;
  END LOOP;

  INSERT INTO majordhome.org_roles (org_id, code, label, base_role)
  VALUES (p_org_id, v_code, v_label, p_base_role)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.org_role_create(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_role_create(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_role_create(uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.org_role_create(uuid, text, text) IS
  'Crée un profil maison (libellé + modèle standard). org_admin only. Code dérivé du libellé, suffixé si pris, jamais un code standard.';

-- ── org_role_update ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_role_update(p_org_role_id uuid, p_label text DEFAULT NULL, p_is_active boolean DEFAULT NULL)
RETURNS majordhome.org_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_row majordhome.org_roles;
BEGIN
  SELECT * INTO v_row FROM majordhome.org_roles WHERE id = p_org_role_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_role_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM majordhome.org_roles_require_admin(v_row.org_id);
  IF p_label IS NOT NULL AND NULLIF(trim(p_label), '') IS NULL THEN
    RAISE EXCEPTION 'label_required' USING ERRCODE = '22023';
  END IF;

  UPDATE majordhome.org_roles
     SET label      = COALESCE(NULLIF(trim(p_label), ''), label),
         is_active  = COALESCE(p_is_active, is_active),
         updated_at = now()
   WHERE id = p_org_role_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.org_role_update(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_role_update(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_role_update(uuid, text, boolean) TO authenticated;
COMMENT ON FUNCTION public.org_role_update(uuid, text, boolean) IS
  'Renomme / (dés)active un profil maison (NULL = inchangé). org_admin only. Le code et le modèle sont immuables (spec § 7).';

-- ── org_role_delete ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_role_delete(p_org_role_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_row       majordhome.org_roles;
  v_members   int;
  v_overrides int;
BEGIN
  SELECT * INTO v_row FROM majordhome.org_roles WHERE id = p_org_role_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_role_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM majordhome.org_roles_require_admin(v_row.org_id);

  SELECT count(*) INTO v_members FROM majordhome.member_org_roles WHERE org_role_id = v_row.id;
  -- surcharges : pas de FK possible sur un code texte → purge explicite
  DELETE FROM majordhome.role_permissions WHERE org_id = v_row.org_id AND role = v_row.code;
  GET DIAGNOSTICS v_overrides = ROW_COUNT;
  -- assignations : CASCADE de la FK ; les champs core des membres portent déjà le modèle
  DELETE FROM majordhome.org_roles WHERE id = v_row.id;

  RETURN jsonb_build_object('members_reset', v_members, 'overrides_deleted', v_overrides);
END;
$function$;
REVOKE ALL ON FUNCTION public.org_role_delete(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_role_delete(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_role_delete(uuid) TO authenticated;
COMMENT ON FUNCTION public.org_role_delete(uuid) IS
  'Supprime un profil maison : purge ses surcharges role_permissions, ses porteurs retombent sur le modèle. org_admin only. Irréversible.';

-- ── member_set_org_role ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_set_org_role(p_org_id uuid, p_user_id uuid, p_org_role_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_row       majordhome.org_roles;
  v_is_member boolean;
BEGIN
  PERFORM majordhome.org_roles_require_admin(p_org_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM core.organization_members WHERE org_id = p_org_id AND user_id = p_user_id
  ) INTO v_is_member;
  IF v_is_member IS NOT TRUE THEN
    RAISE EXCEPTION 'not_an_org_member' USING ERRCODE = '42501';
  END IF;

  -- retour à un rôle standard : on retire la ligne, l'appelant pose le standard (update_member_role)
  IF p_org_role_id IS NULL THEN
    DELETE FROM majordhome.member_org_roles WHERE org_id = p_org_id AND user_id = p_user_id;
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM majordhome.org_roles WHERE id = p_org_role_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_role_not_found' USING ERRCODE = '42501'; -- profil inconnu OU d'une autre org : même refus
  END IF;

  INSERT INTO majordhome.member_org_roles (org_id, user_id, org_role_id)
  VALUES (p_org_id, p_user_id, v_row.id)
  ON CONFLICT (org_id, user_id) DO UPDATE SET org_role_id = EXCLUDED.org_role_id;

  -- invariant § 3.2 : les champs core portent le MODÈLE (= ROLE_DB_MAPPING de src/lib/permissions.js)
  CASE v_row.base_role
    WHEN 'team_leader' THEN PERFORM core.update_member_role(p_org_id, p_user_id, 'team_leader', NULL, 'team_leader');
    WHEN 'commercial'  THEN PERFORM core.update_member_role(p_org_id, p_user_id, 'user', 'Commercial', 'member');
    WHEN 'technicien'  THEN PERFORM core.update_member_role(p_org_id, p_user_id, 'user', 'Technicien', 'member');
  END CASE;
  -- rôle planning (team_members.role) suit le modèle ; no-op sans ressource planning
  PERFORM public.team_member_sync_role_for_user(p_org_id, p_user_id);

  RETURN v_row.code;
END;
$function$;
REVOKE ALL ON FUNCTION public.member_set_org_role(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_set_org_role(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.member_set_org_role(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.member_set_org_role(uuid, uuid, uuid) IS
  'Pose (ou retire si NULL) le profil maison d''un membre et aligne ses champs core sur le modèle + rôle planning. org_admin only.';
```

Notes pour l'exécutant :
- `public.unaccent` : l'extension `unaccent` est installée en prod (vérifié 2026-10-06) ; sur le harnais, si `unaccent` manque, l'ajouter à `bootstrap-pre.sql` (`CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;`) — ne pas remplacer par un `translate` maison.
- `core.update_member_role` est SECURITY DEFINER côté `core` ; elle est appelée ici depuis une fonction déjà gardée org_admin. Si elle refuse (son propre check), lire son code (`pg_get_functiondef`) et adapter — ne pas la contourner par un UPDATE direct sur `core.profiles`.

- [x] **Step 4 : Répéter les deux migrations avec toutes les assertions**

Run :
```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261006_1_org_roles.sql --migration supabase/migrations/20261006_2_org_roles_rpc.sql --assert scripts/migration-rehearsal/assert-org-roles.sql --assert scripts/migration-rehearsal/assert-org-roles-rpc.sql
```
Expected : `assert-org-roles OK`, `assert-org-roles-rpc OK`, `[rehearsal] OK`. Les deux fichiers d'assertions tournent chacun sous `BEGIN … ROLLBACK` : le second part d'une org sans profil maison (d'où `secretaire` puis `secretaire_2` attendus). Si `run.mjs` exécute les assertions avec `ON_ERROR_STOP` et `--single-transaction`, retirer `BEGIN;`/`ROLLBACK;` des fichiers serait une erreur : vérifier d'abord dans `run.mjs` comment `psql` est appelé pour les `--assert` (sans `--single-transaction` : les `BEGIN`/`ROLLBACK` explicites sont corrects).

- [x] **Step 5 : Commit**

```bash
git add supabase/migrations/20261006_2_org_roles_rpc.sql scripts/migration-rehearsal/assert-org-roles-rpc.sql
git commit -m "feat(droits): profils maison — RPC org_role_create/update/delete et member_set_org_role

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : `resolvePermission` — même chaîne côté front (module pur, sans UI)

**Files:**
- Modify: `src/lib/permissionsRegistry.js:124-131` (`resolvePermission`)
- Create: `scripts/permissions-resolve.test.mjs`
- Modify: `package.json` (`audit:quality` : ajouter `scripts/permissions-resolve.test.mjs` après `scripts/working-hours.test.mjs`)

**Interfaces:**
- Produces : `resolvePermission(orgOverrideMap, role, resource, action, orgRoleCode = null)` — `orgRoleCode` = code maison ACTIF du membre (ou `null`) ; `role` reste le rôle standard (modèle). Signature rétro-compatible : tous les appelants actuels (`hasPermission`, `getResourcePermissions` dans `src/lib/permissions.js`) passent 4 arguments et ne changent pas. La tranche 2 branchera `AuthContext.orgRole.code` sur ce 5ᵉ paramètre.

- [x] **Step 1 : Écrire le test (échoue : le 5ᵉ paramètre est ignoré)**

Fichier `scripts/permissions-resolve.test.mjs` :

```js
// scripts/permissions-resolve.test.mjs — chaîne de résolution front = chaîne de role_can (spec profils maison § 4.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePermission, appDefault } from '../src/lib/permissionsRegistry.js';

// Défauts du registre utilisés comme repères (si le registre change, adapter ici, pas la chaîne)
assert.equal(appDefault('technicien', 'pipeline', 'view'), false);
assert.equal(appDefault('technicien', 'clients', 'edit'), true);
assert.equal(appDefault('technicien', 'clients', 'create'), false);

test('sans profil maison : surcharge du rôle puis défaut (comportement inchangé)', () => {
  assert.equal(resolvePermission(null, 'technicien', 'pipeline', 'view'), false);
  assert.equal(resolvePermission({ 'technicien:pipeline:view': true }, 'technicien', 'pipeline', 'view'), true);
  assert.equal(resolvePermission({}, 'org_admin', 'pipeline', 'delete'), true);
});

test('surcharge du profil maison > surcharge du modèle > défaut du modèle', () => {
  const map = { 'secretaire:pipeline:view': true, 'technicien:pipeline:view': false };
  assert.equal(resolvePermission(map, 'technicien', 'pipeline', 'view', 'secretaire'), true);
  // pas de surcharge maison sur clients.create → surcharge du modèle
  assert.equal(resolvePermission({ 'technicien:clients:create': true }, 'technicien', 'clients', 'create', 'secretaire'), true);
  // ni maison ni modèle → défaut du modèle
  assert.equal(resolvePermission({}, 'technicien', 'clients', 'edit', 'secretaire'), true);
  assert.equal(resolvePermission({}, 'technicien', 'clients', 'create', 'secretaire'), false);
});

test('surcharge maison à false l’emporte même si le modèle dit true', () => {
  const map = { 'secretaire:clients:edit': false };
  assert.equal(resolvePermission(map, 'technicien', 'clients', 'edit', 'secretaire'), false);
});

test('org_admin reste bypass quel que soit le code', () => {
  assert.equal(resolvePermission({ 'secretaire:clients:delete': false }, 'org_admin', 'clients', 'delete', 'secretaire'), true);
});

test('code maison null / vide = pas de profil', () => {
  assert.equal(resolvePermission({ 'secretaire:pipeline:view': true }, 'technicien', 'pipeline', 'view', null), false);
  assert.equal(resolvePermission({ 'secretaire:pipeline:view': true }, 'technicien', 'pipeline', 'view', ''), false);
});
```

- [x] **Step 2 : Lancer le test, vérifier l'échec**

Run : `node --test scripts/permissions-resolve.test.mjs`
Expected : FAIL sur « surcharge du profil maison > … » (`false !== true`).

- [x] **Step 3 : Implémenter**

Dans `src/lib/permissionsRegistry.js`, remplacer `resolvePermission` par :

```js
/**
 * Résolution canonique — même chaîne que majordhome.role_can (20261006_1) :
 *   surcharge du profil maison (orgRoleCode) → surcharge per-org du modèle (role)
 *   → défaut app du modèle → false.
 * `role` est TOUJOURS le rôle standard (modèle) ; `orgRoleCode` = code du profil maison
 * actif du membre, ou null/'' s'il n'en porte pas.
 * @param {Object|null} orgOverrideMap - map "role:resource:action" -> boolean (lignes role_permissions)
 * @param {string} role - 'org_admin' | 'team_leader' | 'commercial' | 'technicien'
 * @param {string} resource
 * @param {string} action
 * @param {string|null} [orgRoleCode]
 */
export function resolvePermission(orgOverrideMap, role, resource, action, orgRoleCode = null) {
  if (role === 'org_admin') return true;
  const has = (key) => !!orgOverrideMap && Object.prototype.hasOwnProperty.call(orgOverrideMap, key);
  if (orgRoleCode) {
    const ownKey = `${orgRoleCode}:${resource}:${action}`;
    if (has(ownKey)) return orgOverrideMap[ownKey] === true;
  }
  const key = `${role}:${resource}:${action}`;
  if (has(key)) return orgOverrideMap[key] === true;
  return appDefault(role, resource, action);
}
```

- [x] **Step 4 : Tests verts + ajout à `audit:quality`**

Dans `package.json`, dans la chaîne `audit:quality`, remplacer `scripts/working-hours.test.mjs && npm run audit:dead-code` par `scripts/working-hours.test.mjs scripts/permissions-resolve.test.mjs && npm run audit:dead-code`.

Run : `node --test scripts/permissions-resolve.test.mjs && npm run audit:quality`
Expected : tous les tests passent, `✅ Registre OK`.

- [x] **Step 5 : Commit**

```bash
git add src/lib/permissionsRegistry.js scripts/permissions-resolve.test.mjs package.json
git commit -m "feat(droits): resolvePermission apprend la chaîne du profil maison (5e paramètre, rétro-compatible)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : `permissions-coherence.mjs` — section 4, intégrité des profils maison

**Files:**
- Modify: `scripts/permissions-coherence.mjs:80-139` (fonction `main`, avant l'affichage final)

**Interfaces:**
- Consumes : tables de la Task 1 (`majordhome.org_roles`, `majordhome.role_permissions`), `majordhome.role_can` modifiée.
- Produces : erreurs supplémentaires — profil maison au modèle hors liste ou au code standard ; surcharge `role_permissions` dont le `role` n'est ni standard ni un code maison de la même org ; `role_can` qui ne cite pas `user_org_role_code` ; `anon` avec EXECUTE sur `user_org_role_code` ou l'une des 4 RPC.

- [x] **Step 1 : Ajouter la section 4**

Juste avant `for (const a of avertissements) console.log('⚠️ ', a);` insérer :

```js
  // 4. Profils maison (20261006_1..2) : intégrité + role_can les consulte + ACL
  const orgRoles = await sql(`SELECT org_id, code, base_role FROM majordhome.org_roles`);
  for (const r of orgRoles) {
    if (!['team_leader', 'commercial', 'technicien'].includes(r.base_role)) erreurs.push(`profil maison ${r.code} (${r.org_id}) : modèle invalide ${r.base_role}`);
    if (['org_admin', 'team_leader', 'commercial', 'technicien'].includes(r.code)) erreurs.push(`profil maison au code standard : ${r.code} (${r.org_id})`);
  }
  const codesParOrg = new Map();
  for (const r of orgRoles) { if (!codesParOrg.has(r.org_id)) codesParOrg.set(r.org_id, new Set()); codesParOrg.get(r.org_id).add(r.code); }
  const overrides = await sql(`SELECT org_id, role FROM majordhome.role_permissions
    WHERE role NOT IN ('org_admin', 'team_leader', 'commercial', 'technicien')`);
  for (const o of overrides) {
    if (!codesParOrg.get(o.org_id)?.has(o.role)) erreurs.push(`surcharge orpheline : role=${o.role} org=${o.org_id} (aucun profil maison de cette org)`);
  }
  const roleCanSrc = await sql(`SELECT prosrc FROM pg_proc WHERE oid = 'majordhome.role_can(uuid, text, text)'::regprocedure`);
  if (!/user_org_role_code/.test(roleCanSrc[0]?.prosrc || '')) erreurs.push('majordhome.role_can ne consulte pas user_org_role_code (profils maison ignorés en base)');
  const fnsMaison = ['majordhome.user_org_role_code(uuid)', 'public.org_role_create(uuid, text, text)', 'public.org_role_update(uuid, text, boolean)',
    'public.org_role_delete(uuid)', 'public.member_set_org_role(uuid, uuid, uuid)'];
  for (const f of fnsMaison) {
    const p = await sql(`SELECT has_function_privilege('anon', '${f}', 'EXECUTE') AS anon`);
    if (p[0]?.anon) erreurs.push(`anon a EXECUTE sur ${f}`);
  }
  console.log(`${orgRoles.length} profil(s) maison, ${overrides.length} surcharge(s) sur profil maison`);
```

- [x] **Step 2 : Vérifier sur le cluster de répétition (migrations jouées, cluster gardé)**

Run :
```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261006_1_org_roles.sql --migration supabase/migrations/20261006_2_org_roles_rpc.sql --assert scripts/migration-rehearsal/assert-org-roles-rpc.sql --keep && node scripts/permissions-coherence.mjs --port 55432
```
Expected : la ligne `0 profil(s) maison, 0 surcharge(s) sur profil maison` s'affiche (les assertions sont annulées par ROLLBACK) ; aucune erreur de la section 4 (les avertissements « pas encore sur role_can » existants restent des avertissements). Arrêter ensuite le cluster gardé (`run.mjs` sans `--keep` le remplace au prochain lancement).

- [x] **Step 3 : Commit**

```bash
git add scripts/permissions-coherence.mjs
git commit -m "chore(droits): permissions-coherence vérifie l'intégrité des profils maison et l'ACL de leurs RPC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : Application en prod et vérification de l'effet réel

**Files:**
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (après application : ajouter `{ schema: 'majordhome', table: 'org_roles', columns: null }` et `{ schema: 'majordhome', table: 'member_org_roles', columns: null }` à `TABLES`, `'public.majordhome_org_roles'`, `'public.majordhome_member_org_roles'` à `VIEWS`, `'majordhome.role_permissions'` à `TRIGGER_TABLES`, et `'majordhome.user_org_role_code(uuid)'`, `'majordhome.role_permissions_check_role()'`, `'majordhome.org_roles_require_admin(uuid)'` + les 4 RPC à `FUNCTIONS` — pour que les futures répétitions partent d'une photo fidèle)

**Pré-requis** : accord explicite d'Eric pour appliquer en prod (ce plan ne le présume pas).

- [ ] **Step 1 : Appliquer les deux migrations** via le MCP Supabase `apply_migration` (projet `ejqqqwudmizqisdkxohw`), noms `20261006_1_org_roles` puis `20261006_2_org_roles_rpc`, contenu = les fichiers tels que commités.

- [ ] **Step 2 : Vérifier l'effet réel (jamais en relisant le SQL)**

Via `execute_sql` :

```sql
SELECT 'anon_user_org_role_code' k, has_function_privilege('anon', 'majordhome.user_org_role_code(uuid)', 'EXECUTE')::text v
UNION ALL SELECT 'anon_create', has_function_privilege('anon', 'public.org_role_create(uuid, text, text)', 'EXECUTE')::text
UNION ALL SELECT 'anon_set', has_function_privilege('anon', 'public.member_set_org_role(uuid, uuid, uuid)', 'EXECUTE')::text
UNION ALL SELECT 'auth_insert_org_roles', has_table_privilege('authenticated', 'majordhome.org_roles', 'INSERT')::text
UNION ALL SELECT 'service_select', has_table_privilege('service_role', 'majordhome.org_roles', 'SELECT')::text
UNION ALL SELECT 'check_dropped', (NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_role_check'))::text
UNION ALL SELECT 'trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_permissions_check_role')::text
UNION ALL SELECT 'migrations', (SELECT count(*)::text FROM supabase_migrations.schema_migrations WHERE version LIKE '20261006%');
```
Expected : `anon_*` = false, `auth_insert_org_roles` = false, `service_select` = true, `check_dropped` = true, `trigger` = true, `migrations` = 2.

Puis : `node scripts/permissions-coherence.mjs --env C:/Dev/Frontend-Majordhome/.env.local` → sortie 0, `0 profil(s) maison`.

- [ ] **Step 3 : Contrôle de non-régression à l'écran** — se connecter (Eric) : Droits d'accès et Gestion de l'équipe s'affichent comme avant ; aucune ligne d'erreur `role_permissions` dans les `postgres_logs`.

- [ ] **Step 4 : Mettre à jour le harnais et commiter**

```bash
git add scripts/migration-rehearsal/snapshot.mjs
git commit -m "chore(rehearsal): photographier org_roles / member_org_roles et les fonctions des profils maison

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5 : Proposer l'entrée CLAUDE.md** (ne pas l'intégrer sans accord) — à ajouter dans `.claude/proposed-updates.md` (statut PENDING), section « Rôles & Permissions » :

> **Profils maison (2026-10-06, tranche 1)** : `majordhome.org_roles` (libellé + `base_role` ∈ team_leader|commercial|technicien) et `member_org_roles` (au plus un par membre). **Le modèle est le rôle vu par tout le code en dur** (`user_effective_role`, edges `requiredRole`, `effectiveRole` front, rôle planning) ; seule la grille Droits d'accès distingue le profil : `role_can` consulte `role_permissions(org, code maison)` avant la chaîne modèle → défaut. `resolvePermission(…, orgRoleCode)` reproduit la chaîne côté front (`scripts/permissions-resolve.test.mjs`). Écritures par RPC `org_role_create/update/delete`, `member_set_org_role` (org_admin) — cette dernière réaligne les champs `core` sur le modèle ; `role_permissions.role` validé par trigger (standard ou code maison de la même org). Invariant mesuré par `permissions-coherence.mjs` section 4. UI (colonne + bouton (+), menu Équipe) = tranche 2.

---

## Auto-revue

**Couverture spec** — § 3.1 tables + contraintes : Task 1 · § 3.2 invariant champs `core` = modèle : Task 2 (`member_set_org_role`) · § 3.3 CHECK → trigger, purge à la suppression : Task 1 + Task 2 (`org_role_delete`) · § 4.1 chaîne DB : Task 1, chaîne front : Task 3, cohérence des deux : Task 4 · § 4.2 les 4 RPC + `org_upsert_role_permission` inchangée (traverse le trigger, testé dans `assert-org-roles-rpc.sql`) : Task 2 · § 6 désactivation ⇒ code NULL : Task 1 (D) · § 7 pas de changement de modèle : `org_role_update` n'expose pas `base_role` · § 8 RLS/ACL/gardes positives/impersonation : Tasks 1-2, vérif prod Task 5 · § 9 tranche 1 seule, « rien ne change à l'écran » : Task 5 step 3. Hors plan (tranche 2) : `AuthContext.orgRole`, écrans, service/hook, modale d'invitation.

**Placeholders** — aucun : chaque étape porte son code ou sa commande et son résultat attendu.

**Cohérence des noms** — `org_roles` / `member_org_roles` / `user_org_role_code(uuid)` / `role_permissions_check_role` / `org_roles_require_admin(uuid)` / `org_role_create(uuid, text, text)` / `org_role_update(uuid, text, boolean)` / `org_role_delete(uuid)` / `member_set_org_role(uuid, uuid, uuid)` / `resolvePermission(map, role, resource, action, orgRoleCode)` — identiques dans les migrations, les assertions, le script de cohérence et le test node.
