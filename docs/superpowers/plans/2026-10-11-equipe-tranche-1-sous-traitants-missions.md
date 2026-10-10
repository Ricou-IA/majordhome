# Équipe — Tranche 1 : sous-traitants et missions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un sous-traitant (Mohammed) n'apparaît dans les choix de personne (planning, assistant de créneaux, assignation, certificat) que pendant ses missions datées, activables en deux clics depuis le Planning ou sa fiche ; ses RDV restent toujours visibles et colorés.

**Architecture:** Une colonne `team_members.is_subcontractor` + une table `team_member_missions` écrite uniquement par RPC SECURITY DEFINER. `getTeamMembers` rend tout le monde avec ses missions mergées en mémoire ; une règle PURE unique (`src/lib/teamVisibility.js`) décide qui est choisissable un jour donné, appliquée aux quatre seuls points où l'on choisit une personne (SchedulingAssistant, SectionAssignee, CertificatWizard, puces du Planning). Un composant `MissionsEditor` partagé sert le panneau « Sous-traitants » du Planning et l'onglet « Disponibilité » de la fiche membre.

**Tech Stack:** PostgreSQL (Supabase, RLS, SECURITY DEFINER), React 18 + TanStack Query v5, Tailwind, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-equipe-sous-traitants-depart-compte-design.md` (§ 3 ; les tranches 2 et 3 ont leur propre plan).

## Global Constraints

- Vocabulaire UI : **« sous-traitant »**, jamais « renfort » (Eric, 2026-10-11).
- Toute RPC SECURITY DEFINER : `REVOKE EXECUTE … FROM PUBLIC, anon` puis `GRANT … TO authenticated` ; garde **positive** (`IF auth.uid() IS NULL THEN refuser` en 1ʳᵉ instruction, `IF (autorisé) IS NOT TRUE THEN RAISE '42501'`).
- Toute nouvelle table `majordhome.*` : RLS activée + policy SELECT org-scopée dès la création ; vue publique `WITH (security_invoker=true)` ; `GRANT SELECT ON majordhome.<table> TO service_role`.
- `org_id` de `team_members` / `team_member_missions` = org **majordhome** (≠ org core) ; bridge `majordhome.organizations.core_org_id`.
- Écrire missions / statut sous-traitant : `org_admin` **ou** `team_leader` pour les missions ; `org_admin` seul pour la case sous-traitant.
- Hooks : `mutationFn` déballe via `unwrapResult()` ; cache keys de `cacheKeys.js`, `orgId` en 1ᵉʳ ; `enabled: !!orgId`.
- Dates = chaînes calendaires `YYYY-MM-DD` (Europe/Paris), jamais un `Date` UTC comparé.
- **Ne pas** étendre `team_member_set_routing_settings` : la contraction M2 non jouée (`20260920_1`) la redéfinit ; une surcharge de plus casserait PostgREST le jour où M2 passe.
- Pas de nouveau warning ESLint (pre-commit). Pas de `console.*` : `logger`.

## Review Focus

1. **Sous-traitant avec un RDV existant hors mission** → il reste visible et sélectionné sur ce RDV (édition), sa couleur reste la sienne. Testé Task 2 (`garder`) et Task 4 (SectionAssignee garde les ids sélectionnés).
2. **Mission d'un seul jour / bornes incluses** (`date_from = date_to`, le dernier jour compte) → testé Task 2.
3. **Missions qui se chevauchent** → refusées par la RPC (`22023`), message FR à l'écran. Testé Task 1 (assertion) et Task 5 (traduction d'erreur).
4. **Membre non sous-traitant à qui on tente d'ajouter une mission** → refus `22023`. Testé Task 1.
5. **Passer quelqu'un sous-traitant alors qu'il est « par la machine »** → `include_in_routing` passe à faux dans la même transaction (sinon le moteur le proposerait hors mission). Testé Task 1.

---

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20261011_1_team_member_missions.sql` (créer) | colonne, table, RLS, vue, vue `majordhome_team_members` étendue, 3 RPC |
| `scripts/migration-rehearsal/assert-team-member-missions.sql` (créer) | assertions de la migration |
| `scripts/migration-rehearsal/snapshot.mjs` (modifier) | rien à ajouter : `team_members`, `organizations`, `core.*` et la vue y sont déjà |
| `src/lib/teamVisibility.js` (créer) | règle pure unique |
| `scripts/team-visibility.test.mjs` (créer) | tests de la règle |
| `package.json` (modifier) | test ajouté à `audit:quality` |
| `src/shared/services/teamMissions.service.js` (créer) | RPC missions + sous-traitant |
| `src/shared/services/appointments.service.js` (modifier) | `getTeamMembers` : plus de filtre `is_active`, missions mergées |
| `src/shared/hooks/useTeamMissions.js` (créer) | mutations missions + sous-traitant |
| `src/apps/artisan/components/planning/scheduling/SchedulingAssistant.jsx` (modifier) | colonnes filtrées au jour sélectionné |
| `src/apps/artisan/components/planning/EventFormSections.jsx` (modifier) | `SectionAssignee` filtré à la date du RDV |
| `src/apps/artisan/components/certificat/CertificatWizard.jsx` (modifier) | sélecteur technicien filtré |
| `src/shared/hooks/useAppointments.js` (modifier) | `teamList` des puces filtré sur la plage affichée |
| `src/apps/artisan/components/team/MissionsEditor.jsx` (créer) | liste + ajout/édition/suppression de missions d'UN sous-traitant |
| `src/apps/artisan/components/team/SubcontractorsPanel.jsx` (créer) | panneau du Planning : tous les sous-traitants |
| `src/apps/artisan/pages/Planning.jsx` (modifier) | bouton « Sous-traitants » |
| `src/apps/artisan/pages/settings/team/MemberModal.jsx` (modifier) | case sous-traitant, onglet Disponibilité |
| `src/apps/artisan/pages/settings/team/memberPresentation.js` (modifier) | libellé « À la main », état mission |
| `src/apps/artisan/pages/settings/TeamManagement.jsx` (modifier) | handler sous-traitant, tag + état dans la synthèse |

---

### Task 1: Migration — colonne, table, vue, RPC (+ répétition)

**Files:**
- Create: `supabase/migrations/20261011_1_team_member_missions.sql`
- Create: `scripts/migration-rehearsal/assert-team-member-missions.sql`

**Interfaces:**
- Produces (SQL) :
  - `majordhome.team_members.is_subcontractor boolean NOT NULL DEFAULT false`, exposée en **fin** de `public.majordhome_team_members`.
  - `public.majordhome_team_member_missions(id, org_id, team_member_id, date_from, date_to, note, created_by, created_at, updated_at)`.
  - `public.team_member_set_subcontractor(p_team_member_id uuid, p_is_subcontractor boolean) RETURNS TABLE(is_subcontractor boolean, include_in_routing boolean)` — org_admin.
  - `public.team_member_mission_upsert(p_mission_id uuid, p_team_member_id uuid, p_date_from date, p_date_to date, p_note text) RETURNS uuid` — org_admin | team_leader. `p_mission_id` NULL = création.
  - `public.team_member_mission_delete(p_mission_id uuid) RETURNS void` — org_admin | team_leader.
  - Codes d'erreur : `42501` (droits / anonyme), `P0002` (introuvable), `22023` (dates inversées, non sous-traitant, chevauchement).

- [ ] **Step 1: Écrire les assertions (elles échouent tant que la migration n'existe pas)**

`scripts/migration-rehearsal/assert-team-member-missions.sql` :

```sql
-- assert-team-member-missions.sql — vérifie 20261011_1_team_member_missions.sql sur le cluster de répétition.
-- Couvre : colonne + vue, RLS + grants, privilèges effectifs des 3 RPC, gardes (anonyme, technicien,
-- responsable autorisé sur les missions mais pas sur la case), règles (non sous-traitant, dates, chevauchement),
-- sous-traitant ⇒ include_in_routing faux. Tout est annulé en fin (ROLLBACK implicite du DO via exception finale).
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
DECLARE
  v_mayer   uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_moh_uid uuid := '3fb86975-5f01-4162-ad68-bc2e7eb52343';  -- Mohammed (technicien)
  v_moh     uuid;
  v_admin   uuid;
  v_leader  uuid;
  v_tech    uuid;
  v_m1      uuid;
  v_row     record;
  n         int;
BEGIN
  -- 1. Structure ---------------------------------------------------------------
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_team_members' AND column_name = 'is_subcontractor';
  IF NOT FOUND THEN RAISE EXCEPTION 'vue majordhome_team_members sans is_subcontractor'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.team_member_missions'::regclass) THEN
    RAISE EXCEPTION 'RLS non activée sur team_member_missions';
  END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.team_member_missions', 'SELECT') THEN
    RAISE EXCEPTION 'service_role sans SELECT sur team_member_missions';
  END IF;
  IF (SELECT reloptions FROM pg_class WHERE oid = 'public.majordhome_team_member_missions'::regclass)::text NOT LIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION 'vue missions sans security_invoker';
  END IF;

  -- 2. Privilèges effectifs (jamais le texte de la migration) --------------------
  IF has_function_privilege('anon', 'public.team_member_set_subcontractor(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.team_member_mission_upsert(uuid, uuid, date, date, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.team_member_mission_delete(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'une RPC missions est exécutable par anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.team_member_mission_upsert(uuid, uuid, date, date, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ne peut pas exécuter team_member_mission_upsert';
  END IF;

  -- 3. Fixtures -----------------------------------------------------------------
  SELECT tm.id INTO v_moh FROM majordhome.team_members tm WHERE tm.user_id = v_moh_uid;
  SELECT user_id INTO v_admin  FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_leader FROM core.organization_members WHERE org_id = v_mayer AND role = 'team_leader' LIMIT 1;
  SELECT user_id INTO v_tech   FROM core.organization_members WHERE org_id = v_mayer AND role = 'member' AND user_id <> v_moh_uid LIMIT 1;
  IF v_moh IS NULL OR v_admin IS NULL OR v_leader IS NULL OR v_tech IS NULL THEN
    RAISE EXCEPTION 'fixture incomplète (moh %, admin %, leader %, tech %)', v_moh, v_admin, v_leader, v_tech;
  END IF;

  -- 4. Gardes -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.expect_err('anonyme / sous-traitant',
    format('SELECT * FROM public.team_member_set_subcontractor(%L, true)', v_moh), '42501');
  PERFORM set_config('request.jwt.claim.sub', v_leader::text, true);
  PERFORM pg_temp.expect_err('responsable / case sous-traitant',
    format('SELECT * FROM public.team_member_set_subcontractor(%L, true)', v_moh), '42501');
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  PERFORM pg_temp.expect_err('technicien / mission',
    format('SELECT public.team_member_mission_upsert(NULL, %L, %L, %L, NULL)', v_moh, '2026-10-14', '2026-10-18'), '42501');

  -- 5. Mission sur un non sous-traitant : refusée ---------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  UPDATE majordhome.team_members SET is_subcontractor = false WHERE id = v_moh;
  PERFORM pg_temp.expect_err('mission sur salarié',
    format('SELECT public.team_member_mission_upsert(NULL, %L, %L, %L, NULL)', v_moh, '2026-10-14', '2026-10-18'), '22023');

  -- 6. Case sous-traitant ⇒ include_in_routing faux ------------------------------
  UPDATE majordhome.team_members SET include_in_routing = true WHERE id = v_moh;
  SELECT * INTO v_row FROM public.team_member_set_subcontractor(v_moh, true);
  IF v_row.is_subcontractor IS NOT TRUE OR v_row.include_in_routing IS NOT FALSE THEN
    RAISE EXCEPTION 'sous-traitant : attendu (true,false), reçu (%,%)', v_row.is_subcontractor, v_row.include_in_routing;
  END IF;

  -- 7. Missions : le responsable peut, règles de dates ----------------------------
  PERFORM set_config('request.jwt.claim.sub', v_leader::text, true);
  v_m1 := public.team_member_mission_upsert(NULL, v_moh, '2026-10-14', '2026-10-18', 'chantier PAC');
  SELECT count(*) INTO n FROM majordhome.team_member_missions
   WHERE id = v_m1 AND org_id = (SELECT org_id FROM majordhome.team_members WHERE id = v_moh) AND created_by = v_leader;
  IF n <> 1 THEN RAISE EXCEPTION 'mission créée sans org_id / created_by corrects'; END IF;
  PERFORM pg_temp.expect_err('dates inversées',
    format('SELECT public.team_member_mission_upsert(NULL, %L, %L, %L, NULL)', v_moh, '2026-10-20', '2026-10-19'), '22023');
  PERFORM pg_temp.expect_err('chevauchement (bord inclus)',
    format('SELECT public.team_member_mission_upsert(NULL, %L, %L, %L, NULL)', v_moh, '2026-10-18', '2026-10-20'), '22023');
  -- Une mission d'un jour accolée (lendemain) est permise
  PERFORM public.team_member_mission_upsert(NULL, v_moh, '2026-10-19', '2026-10-19', NULL);
  -- Modifier une mission ne se chevauche pas avec elle-même
  PERFORM public.team_member_mission_upsert(v_m1, v_moh, '2026-10-13', '2026-10-18', 'chantier PAC');
  PERFORM public.team_member_mission_delete(v_m1);
  SELECT count(*) INTO n FROM majordhome.team_member_missions WHERE id = v_m1;
  IF n <> 0 THEN RAISE EXCEPTION 'mission non supprimée'; END IF;
  PERFORM pg_temp.expect_err('suppression inconnue',
    format('SELECT public.team_member_mission_delete(%L)', gen_random_uuid()), 'P0002');

  -- 8. Lecture RLS : un membre de l'org voit, un inconnu non -----------------------
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.majordhome_team_member_missions;
  RESET ROLE;
  IF n < 1 THEN RAISE EXCEPTION 'un membre de l''org ne voit pas les missions'; END IF;
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.majordhome_team_member_missions;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'un inconnu voit % missions', n; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-team-member-missions : OK';
END;
$$;
```

- [ ] **Step 2: Lancer la répétition sans migration pour voir l'échec**

Run: `node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local` puis
`node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-team-member-missions.sql`
Expected: FAIL `vue majordhome_team_members sans is_subcontractor`.

- [ ] **Step 3: Écrire la migration**

`supabase/migrations/20261011_1_team_member_missions.sql` :

```sql
-- 20261011_1_team_member_missions.sql
-- Sous-traitants à missions datées (spec 2026-10-11-equipe-sous-traitants-depart-compte-design.md § 3).
-- Un sous-traitant n'est choisissable dans l'app que pendant ses missions ; la règle d'affichage vit
-- côté front (src/lib/teamVisibility.js), la base ne porte que les faits.
--
-- Pourquoi une RPC dédiée pour la case « sous-traitant » plutôt que d'étendre
-- team_member_set_routing_settings : la contraction M2 (20260920_1, non jouée) redéfinit cette RPC ;
-- une signature de plus laisserait deux surcharges que PostgREST ne départage pas.

-- 1. Colonne -------------------------------------------------------------------
ALTER TABLE majordhome.team_members
  ADD COLUMN IF NOT EXISTS is_subcontractor boolean NOT NULL DEFAULT false;

-- Vue : colonne ajoutée EN FIN de liste (CREATE OR REPLACE VIEW n'accepte que ça).
CREATE OR REPLACE VIEW public.majordhome_team_members WITH (security_invoker = true) AS
SELECT id, org_id, first_name, last_name, display_name, email, phone, role, specialties,
       calendar_color, google_calendar_id, google_calendar_email, default_availability,
       default_zone, slack_user_id, is_active, created_at, updated_at, user_id,
       daily_work_minutes, include_in_routing, is_subcontractor
  FROM majordhome.team_members;

-- 2. Table des missions -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.team_member_missions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES majordhome.organizations(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES majordhome.team_members(id) ON DELETE CASCADE,
  date_from      date NOT NULL,
  date_to        date NOT NULL,
  note           text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_member_missions_dates CHECK (date_to >= date_from)
);
-- org_id est TOUJOURS celui du team_member : seul écrivain = les RPC ci-dessous, qui le dérivent.
CREATE INDEX IF NOT EXISTS team_member_missions_member_idx
  ON majordhome.team_member_missions (team_member_id, date_from);

ALTER TABLE majordhome.team_member_missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_member_missions_select_org_member ON majordhome.team_member_missions;
CREATE POLICY team_member_missions_select_org_member ON majordhome.team_member_missions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM majordhome.organizations mo
      JOIN core.organization_members om ON om.org_id = mo.core_org_id
     WHERE mo.id = team_member_missions.org_id AND om.user_id = auth.uid()
  ));
-- Aucune policy d'écriture : on retire aussi les droits hérités des ACL par défaut du schéma.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON majordhome.team_member_missions FROM anon, authenticated;
GRANT SELECT ON majordhome.team_member_missions TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_team_member_missions WITH (security_invoker = true) AS
SELECT id, org_id, team_member_id, date_from, date_to, note, created_by, created_at, updated_at
  FROM majordhome.team_member_missions;
GRANT SELECT ON public.majordhome_team_member_missions TO authenticated, service_role;

-- 3. Helper d'autorisation (interne, non exposé) -----------------------------------
-- Rôle d'adhésion de l'appelant dans l'org core du team_member, ou NULL.
CREATE OR REPLACE FUNCTION majordhome.caller_role_for_team_member(p_team_member_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $$
  SELECT om.role
    FROM majordhome.team_members tm
    JOIN majordhome.organizations o ON o.id = tm.org_id
    JOIN core.organization_members om ON om.org_id = o.core_org_id AND om.user_id = auth.uid()
   WHERE tm.id = p_team_member_id;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.caller_role_for_team_member(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Case « sous-traitant » (org_admin) --------------------------------------------
CREATE OR REPLACE FUNCTION public.team_member_set_subcontractor(p_team_member_id uuid, p_is_subcontractor boolean)
RETURNS TABLE (is_subcontractor boolean, include_in_routing boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.team_members WHERE id = p_team_member_id) THEN
    RAISE EXCEPTION 'Membre % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;
  IF (majordhome.caller_role_for_team_member(p_team_member_id) = 'org_admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Seul un administrateur peut changer le statut sous-traitant' USING ERRCODE = '42501';
  END IF;

  -- Un sous-traitant n'est jamais proposé par la machine : on le sort des tournées dans la même
  -- transaction. Redevenir salarié ne l'y remet PAS (geste explicite dans la fiche).
  RETURN QUERY
  UPDATE majordhome.team_members tm
     SET is_subcontractor   = COALESCE(p_is_subcontractor, false),
         include_in_routing = CASE WHEN COALESCE(p_is_subcontractor, false) THEN false ELSE tm.include_in_routing END,
         updated_at         = now()
   WHERE tm.id = p_team_member_id
  RETURNING tm.is_subcontractor, tm.include_in_routing;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.team_member_set_subcontractor(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_subcontractor(uuid, boolean) TO authenticated;

-- 5. Missions (org_admin | team_leader) ---------------------------------------------
CREATE OR REPLACE FUNCTION public.team_member_mission_upsert(
  p_mission_id uuid, p_team_member_id uuid, p_date_from date, p_date_to date, p_note text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_sub   boolean;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  SELECT org_id, is_subcontractor INTO v_org, v_sub FROM majordhome.team_members WHERE id = p_team_member_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Membre % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;
  IF (majordhome.caller_role_for_team_member(p_team_member_id) IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Réservé aux administrateurs et responsables' USING ERRCODE = '42501';
  END IF;
  IF v_sub IS NOT TRUE THEN
    RAISE EXCEPTION 'Ce membre n''est pas sous-traitant' USING ERRCODE = '22023';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
    RAISE EXCEPTION 'Dates de mission invalides (% → %)', p_date_from, p_date_to USING ERRCODE = '22023';
  END IF;
  IF p_mission_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM majordhome.team_member_missions WHERE id = p_mission_id AND team_member_id = p_team_member_id
  ) THEN
    RAISE EXCEPTION 'Mission % introuvable pour ce membre', p_mission_id USING ERRCODE = 'P0002';
  END IF;
  -- Bornes incluses : [a,b] et [c,d] se chevauchent si a <= d ET c <= b.
  IF EXISTS (
    SELECT 1 FROM majordhome.team_member_missions m
     WHERE m.team_member_id = p_team_member_id
       AND m.id IS DISTINCT FROM p_mission_id
       AND m.date_from <= p_date_to AND p_date_from <= m.date_to
  ) THEN
    RAISE EXCEPTION 'Cette période chevauche une mission existante' USING ERRCODE = '22023';
  END IF;

  IF p_mission_id IS NULL THEN
    INSERT INTO majordhome.team_member_missions (org_id, team_member_id, date_from, date_to, note, created_by)
    VALUES (v_org, p_team_member_id, p_date_from, p_date_to, NULLIF(btrim(p_note), ''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE majordhome.team_member_missions
       SET date_from = p_date_from, date_to = p_date_to, note = NULLIF(btrim(p_note), ''), updated_at = now()
     WHERE id = p_mission_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.team_member_mission_upsert(uuid, uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_mission_upsert(uuid, uuid, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_member_mission_delete(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_member uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  SELECT team_member_id INTO v_member FROM majordhome.team_member_missions WHERE id = p_mission_id;
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'Mission % introuvable', p_mission_id USING ERRCODE = 'P0002';
  END IF;
  IF (majordhome.caller_role_for_team_member(v_member) IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Réservé aux administrateurs et responsables' USING ERRCODE = '42501';
  END IF;
  DELETE FROM majordhome.team_member_missions WHERE id = p_mission_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.team_member_mission_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_mission_delete(uuid) TO authenticated;
```

- [ ] **Step 4: Répéter la migration et vérifier**

Run: `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261011_1_team_member_missions.sql --assert scripts/migration-rehearsal/assert-team-member-missions.sql`
Expected: `assert-team-member-missions : OK`. Puis `--assert scripts/migration-rehearsal/assert-baseline.sql` avec la même migration : OK (8 membres d'équipe inchangés).

- [ ] **Step 5: Appliquer en prod et vérifier l'effet réel**

`apply_migration` (connecteur Supabase, projet `ejqqqwudmizqisdkxohw`, nom `20261011_1_team_member_missions`). Puis en lecture :

```sql
SELECT has_function_privilege('anon', 'public.team_member_mission_upsert(uuid, uuid, date, date, text)', 'EXECUTE') AS anon_upsert,
       has_function_privilege('anon', 'public.team_member_set_subcontractor(uuid, boolean)', 'EXECUTE') AS anon_sub,
       has_table_privilege('service_role', 'majordhome.team_member_missions', 'SELECT') AS sr_select,
       (SELECT count(*) FROM majordhome.team_members WHERE is_subcontractor) AS nb_sous_traitants;
```
Expected: `false, false, true, 0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261011_1_team_member_missions.sql scripts/migration-rehearsal/assert-team-member-missions.sql
git commit -m "feat(equipe): sous-traitants — colonne, table des missions, RPC (tranche 1)"
```

---

### Task 2: Règle pure de visibilité

**Files:**
- Create: `src/lib/teamVisibility.js`
- Create: `scripts/team-visibility.test.mjs`
- Modify: `package.json` (`audit:quality`)

**Interfaces:**
- Consumes: membre `{ id, is_subcontractor?, is_active?, left_on?, missions?: [{ id, date_from, date_to, note }] }` (forme rendue par `getTeamMembers` en Task 3).
- Produces:
  - `missionCouvrant(membre, dateISO) → mission|null`
  - `membreChoisissableLe(membre, dateISO) → boolean`
  - `filtrerChoisissables(membres, dateISO, { garder = [] } = {}) → membres` (ids de `garder` toujours conservés, ordre d'entrée préservé)
  - `filtrerVisiblesSurPlage(membres, debutISO, finISO, { idsAvecRdv = new Set() } = {}) → membres`
  - `etatSousTraitant(membre, aujourdhuiISO) → { etat: 'salarie'|'en_mission'|'a_venir'|'en_reserve', mission: object|null }`
  - `chevauchement(missions, { date_from, date_to }, exceptId = null) → mission|null`
  - `aujourdhuiISO(now = new Date()) → 'YYYY-MM-DD'` (Europe/Paris)

- [ ] **Step 1: Écrire les tests**

`scripts/team-visibility.test.mjs` :

```js
// scripts/team-visibility.test.mjs — règle de visibilité des membres (src/lib/teamVisibility.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  missionCouvrant, membreChoisissableLe, filtrerChoisissables, filtrerVisiblesSurPlage,
  etatSousTraitant, chevauchement, aujourdhuiISO,
} from '../src/lib/teamVisibility.js';

const antoine = { id: 'a', display_name: 'Antoine' };
const moh = {
  id: 'm', display_name: 'Mohammed', is_subcontractor: true,
  missions: [
    { id: 'x1', date_from: '2026-10-14', date_to: '2026-10-18' },
    { id: 'x2', date_from: '2026-11-03', date_to: '2026-11-03' },
  ],
};
const mohSansMission = { id: 'm2', is_subcontractor: true, missions: [] };

test('un salarié est toujours choisissable', () => {
  assert.equal(membreChoisissableLe(antoine, '2026-10-01'), true);
});

test('un sous-traitant ne l’est que pendant une mission, bornes incluses', () => {
  assert.equal(membreChoisissableLe(moh, '2026-10-13'), false);
  assert.equal(membreChoisissableLe(moh, '2026-10-14'), true, 'premier jour');
  assert.equal(membreChoisissableLe(moh, '2026-10-18'), true, 'dernier jour');
  assert.equal(membreChoisissableLe(moh, '2026-10-19'), false);
  assert.equal(membreChoisissableLe(moh, '2026-11-03'), true, 'mission d’un jour');
  assert.equal(membreChoisissableLe(mohSansMission, '2026-10-14'), false);
  assert.equal(missionCouvrant(moh, '2026-10-16').id, 'x1');
  assert.equal(missionCouvrant(moh, '2026-10-20'), null);
});

test('inactif ou parti : jamais choisissable (préparation tranche 2)', () => {
  assert.equal(membreChoisissableLe({ ...antoine, is_active: false }, '2026-10-14'), false);
  assert.equal(membreChoisissableLe({ ...antoine, left_on: '2026-10-10' }, '2026-10-10'), true, 'dernier jour travaillé');
  assert.equal(membreChoisissableLe({ ...antoine, left_on: '2026-10-10' }, '2026-10-11'), false);
});

test('date absente ou invalide : on ne cache personne (on ne devine pas)', () => {
  assert.equal(membreChoisissableLe(moh, null), true);
  assert.equal(membreChoisissableLe(moh, 'pas-une-date'), true);
});

test('filtrerChoisissables garde les personnes déjà assignées, dans l’ordre', () => {
  const r = filtrerChoisissables([antoine, moh, mohSansMission], '2026-10-01', { garder: ['m2'] });
  assert.deepEqual(r.map((m) => m.id), ['a', 'm2']);
  assert.deepEqual(filtrerChoisissables(null, '2026-10-01'), []);
});

test('filtrerVisiblesSurPlage : mission qui recoupe la plage, ou RDV dans la plage', () => {
  const semaine = ['2026-10-12', '2026-10-18'];
  assert.deepEqual(filtrerVisiblesSurPlage([antoine, moh, mohSansMission], ...semaine).map((m) => m.id), ['a', 'm']);
  assert.deepEqual(filtrerVisiblesSurPlage([moh], '2026-10-19', '2026-10-25').map((m) => m.id), []);
  assert.deepEqual(
    filtrerVisiblesSurPlage([mohSansMission], ...semaine, { idsAvecRdv: new Set(['m2']) }).map((m) => m.id),
    ['m2'],
    'un RDV existant rend sa personne visible',
  );
});

test('etatSousTraitant pour la synthèse', () => {
  assert.deepEqual(etatSousTraitant(antoine, '2026-10-15'), { etat: 'salarie', mission: null });
  assert.equal(etatSousTraitant(moh, '2026-10-15').etat, 'en_mission');
  assert.equal(etatSousTraitant(moh, '2026-10-15').mission.id, 'x1');
  assert.equal(etatSousTraitant(moh, '2026-10-01').etat, 'a_venir');
  assert.equal(etatSousTraitant(moh, '2026-10-01').mission.id, 'x1', 'la plus proche');
  assert.equal(etatSousTraitant(moh, '2026-12-01').etat, 'en_reserve');
  assert.equal(etatSousTraitant(mohSansMission, '2026-10-01').etat, 'en_reserve');
});

test('chevauchement : bornes incluses, sans se comparer à soi-même', () => {
  assert.equal(chevauchement(moh.missions, { date_from: '2026-10-18', date_to: '2026-10-20' }).id, 'x1');
  assert.equal(chevauchement(moh.missions, { date_from: '2026-10-19', date_to: '2026-10-20' }), null);
  assert.equal(chevauchement(moh.missions, { date_from: '2026-10-13', date_to: '2026-10-18' }, 'x1'), null);
});

test('aujourdhuiISO suit le fuseau de Paris', () => {
  // 2026-10-10 23:30 UTC = 2026-10-11 01:30 à Paris
  assert.equal(aujourdhuiISO(new Date('2026-10-10T23:30:00Z')), '2026-10-11');
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node --test scripts/team-visibility.test.mjs`
Expected: FAIL `Cannot find module '…/src/lib/teamVisibility.js'`.

- [ ] **Step 3: Implémenter**

`src/lib/teamVisibility.js` :

```js
/**
 * teamVisibility.js — qui peut-on choisir, et qui voit-on, un jour donné.
 * ============================================================================
 * Module PUR (aucun import React / Supabase). Source UNIQUE de la règle :
 * SchedulingAssistant, SectionAssignee, CertificatWizard et les puces du Planning
 * l'appliquent ; aucun écran ne la recopie.
 *
 *   - salarié                → choisissable
 *   - sous-traitant          → seulement pendant une mission (bornes incluses)
 *   - inactif / parti        → jamais (left_on = dernier jour travaillé)
 *   - un RDV existant rend toujours sa personne VISIBLE (historique), cf. `garder`
 *     et `idsAvecRdv`.
 *
 * Dates = chaînes 'YYYY-MM-DD' (Europe/Paris) : la comparaison lexicale suffit.
 * Spec : docs/superpowers/specs/2026-10-11-equipe-sous-traitants-depart-compte-design.md § 3.2
 * Testé : node --test scripts/team-visibility.test.mjs
 * ============================================================================
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const estISO = (d) => typeof d === 'string' && ISO.test(d);

/** Mission de `membre` qui couvre `dateISO`, sinon null. */
export function missionCouvrant(membre, dateISO) {
  if (!estISO(dateISO)) return null;
  return (membre?.missions || []).find((m) => m.date_from <= dateISO && dateISO <= m.date_to) || null;
}

/**
 * Le membre peut-il recevoir un RDV ce jour-là ?
 * Date absente ou invalide → true : on ne cache personne sur une donnée qu'on ne sait pas lire.
 */
export function membreChoisissableLe(membre, dateISO) {
  if (!membre) return false;
  if (membre.is_active === false) return false;
  if (!estISO(dateISO)) return true;
  if (membre.left_on && dateISO > membre.left_on) return false;
  if (!membre.is_subcontractor) return true;
  return missionCouvrant(membre, dateISO) !== null;
}

/** Membres choisissables ce jour-là ; les ids de `garder` (déjà assignés) restent toujours. */
export function filtrerChoisissables(membres, dateISO, { garder = [] } = {}) {
  const keep = new Set(garder || []);
  return (membres || []).filter((m) => keep.has(m.id) || membreChoisissableLe(m, dateISO));
}

/**
 * Membres à montrer sur une plage [debutISO, finISO] (puces du Planning) :
 * choisissables au moins un jour de la plage, ou ayant un RDV dans la plage.
 */
export function filtrerVisiblesSurPlage(membres, debutISO, finISO, { idsAvecRdv = new Set() } = {}) {
  return (membres || []).filter((m) => {
    if (idsAvecRdv.has(m.id)) return true;
    if (m.is_active === false) return false;
    if (!estISO(debutISO) || !estISO(finISO)) return true;
    if (m.left_on && debutISO > m.left_on) return false;
    if (!m.is_subcontractor) return true;
    return (m.missions || []).some((x) => x.date_from <= finISO && debutISO <= x.date_to);
  });
}

/** État affiché dans la synthèse Équipe. */
export function etatSousTraitant(membre, aujourdhui) {
  if (!membre?.is_subcontractor) return { etat: 'salarie', mission: null };
  const enCours = missionCouvrant(membre, aujourdhui);
  if (enCours) return { etat: 'en_mission', mission: enCours };
  const aVenir = (membre.missions || [])
    .filter((m) => m.date_from > aujourdhui)
    .sort((a, b) => a.date_from.localeCompare(b.date_from))[0];
  return aVenir ? { etat: 'a_venir', mission: aVenir } : { etat: 'en_reserve', mission: null };
}

/** Mission existante qui chevauche [date_from, date_to] (bornes incluses), hors `exceptId`. */
export function chevauchement(missions, { date_from, date_to }, exceptId = null) {
  return (missions || []).find(
    (m) => m.id !== exceptId && m.date_from <= date_to && date_from <= m.date_to,
  ) || null;
}

/** Date du jour à Paris, 'YYYY-MM-DD'. */
export function aujourdhuiISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
```

- [ ] **Step 4: Vérifier le passage**

Run: `node --test scripts/team-visibility.test.mjs`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Brancher dans `audit:quality` et committer**

Dans `package.json`, remplacer `scripts/planning-palette.test.mjs &&` par `scripts/planning-palette.test.mjs scripts/team-visibility.test.mjs &&`.

```bash
git add src/lib/teamVisibility.js scripts/team-visibility.test.mjs package.json
git commit -m "feat(equipe): règle pure de visibilité des membres (sous-traitants, départs)"
```

---

### Task 3: Service, hooks, chargement des membres avec leurs missions

**Files:**
- Create: `src/shared/services/teamMissions.service.js`
- Create: `src/shared/hooks/useTeamMissions.js`
- Modify: `src/shared/services/appointments.service.js` (`getTeamMembers`, ~l. 698-720)

**Interfaces:**
- Consumes: RPC de Task 1.
- Produces:
  - `teamMissionsService.setSubcontractor(teamMemberId, isSubcontractor) → { data: { is_subcontractor, include_in_routing }, error }`
  - `teamMissionsService.upsertMission({ missionId, teamMemberId, dateFrom, dateTo, note }) → { data: uuid, error }`
  - `teamMissionsService.deleteMission(missionId) → { data: null, error }`
  - `missionErrorMessage(err) → string` (exporté du service, FR)
  - `useSetSubcontractor(orgId) → { setSubcontractor({ teamMemberId, isSubcontractor }), isSaving }`
  - `useTeamMissionMutations(orgId) → { upsertMission(args), deleteMission(missionId), isSaving }`
  - `getTeamMembers` rend chaque membre avec `missions: [{ id, date_from, date_to, note }]` triées, **sans** filtre `is_active`. `orgId` des hooks = org **core** (comme `useTeamMembers`).

- [ ] **Step 1: Service**

`src/shared/services/teamMissions.service.js` :

```js
/**
 * teamMissions.service.js — sous-traitants et missions datées.
 * Écritures UNIQUEMENT par RPC (schéma majordhome non exposé) ; lecture des missions
 * mergée par appointmentsService.getTeamMembers.
 * Spec : docs/superpowers/specs/2026-10-11-equipe-sous-traitants-depart-compte-design.md § 3
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/** Message FR d'une erreur RPC missions (jamais le texte Postgres brut, sauf 22023 qui est rédigé en FR). */
export function missionErrorMessage(err) {
  if (err?.code === '42501') return 'Réservé aux administrateurs et responsables.';
  if (err?.code === 'P0002') return 'Cette mission ou ce membre n’existe plus.';
  if (err?.code === '22023') return err.message || 'Période invalide.';
  return 'Erreur lors de l’enregistrement de la mission.';
}

export const teamMissionsService = {
  setSubcontractor: (teamMemberId, isSubcontractor) => withErrorHandling(async () => {
    const { data, error } = await supabase.rpc('team_member_set_subcontractor', {
      p_team_member_id: teamMemberId,
      p_is_subcontractor: !!isSubcontractor,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }, 'teamMissions.setSubcontractor'),

  upsertMission: ({ missionId = null, teamMemberId, dateFrom, dateTo, note = null }) => withErrorHandling(async () => {
    const { data, error } = await supabase.rpc('team_member_mission_upsert', {
      p_mission_id: missionId,
      p_team_member_id: teamMemberId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_note: note,
    });
    if (error) throw error;
    return data;
  }, 'teamMissions.upsertMission'),

  deleteMission: (missionId) => withErrorHandling(async () => {
    const { error } = await supabase.rpc('team_member_mission_delete', { p_mission_id: missionId });
    if (error) throw error;
    return null;
  }, 'teamMissions.deleteMission'),
};

export default teamMissionsService;
```

Vérifier la signature de `withErrorHandling` dans `src/lib/serviceHelpers.js` avant d'écrire (`withErrorHandling(fn, context)` qui rend `{ data, error }` et préserve `error.code`). Si elle diffère, adapter les appels en gardant `error.code` intact (le message FR en dépend).

- [ ] **Step 2: `getTeamMembers` rend tout le monde + missions**

Dans `src/shared/services/appointments.service.js`, remplacer le corps de `getTeamMembers` :

```js
  /**
   * Membres de l'organisation (techniciens, commerciaux, admins, sous-traitants, inactifs)
   * avec leurs missions de sous-traitance (2ᵉ requête mergée en mémoire).
   * PAS de filtre is_active : l'historique (couleur / nom des anciens RDV) a besoin de
   * tout le monde. Les écrans qui PROPOSENT une personne filtrent via src/lib/teamVisibility.js.
   */
  async getTeamMembers(coreOrgId) {
    try {
      const orgId = await getMajordhomeOrgId(coreOrgId);

      const [{ data, error }, { data: missions, error: missionsError }] = await Promise.all([
        supabase.from('majordhome_team_members').select('*').eq('org_id', orgId)
          .order('display_name', { ascending: true }),
        supabase.from('majordhome_team_member_missions').select('id, team_member_id, date_from, date_to, note')
          .eq('org_id', orgId).order('date_from', { ascending: true }),
      ]);

      if (error) {
        logger.error('[appointments] getTeamMembers error:', error);
        return { data: null, error };
      }
      // Missions illisibles : on NE renvoie PAS des sous-traitants « sans mission » (ils
      // disparaîtraient en silence) — l'erreur remonte.
      if (missionsError) {
        logger.error('[appointments] getTeamMembers missions error:', missionsError);
        return { data: null, error: missionsError };
      }

      const byMember = new Map();
      (missions || []).forEach((m) => {
        if (!byMember.has(m.team_member_id)) byMember.set(m.team_member_id, []);
        byMember.get(m.team_member_id).push({ id: m.id, date_from: m.date_from, date_to: m.date_to, note: m.note });
      });
      return { data: (data || []).map((tm) => ({ ...tm, missions: byMember.get(tm.id) || [] })), error: null };
    } catch (err) {
      logger.error('[appointments] getTeamMembers error:', err);
      return { data: null, error: err };
    }
  },
```

(`logger` est-il déjà importé dans ce fichier ? `grep -n "logger" src/shared/services/appointments.service.js` — l'importer depuis `@lib/logger` sinon.)

- [ ] **Step 3: Hooks**

`src/shared/hooks/useTeamMissions.js` :

```js
/**
 * useTeamMissions.js — mutations sous-traitant / missions. Lecture : useTeamMembers
 * (les missions sont mergées sur chaque membre). Après succès on RELIT (invalidate),
 * jamais de cache optimiste.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrapResult } from '@/lib/serviceHelpers';
import { teamMissionsService } from '@services/teamMissions.service';
import { appointmentKeys } from './cacheKeys';

export function useSetSubcontractor(orgId) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ teamMemberId, isSubcontractor }) =>
      unwrapResult(teamMissionsService.setSubcontractor(teamMemberId, isSubcontractor)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appointmentKeys.teamMembers(orgId) }),
  });
  return { setSubcontractor: mutation.mutateAsync, isSaving: mutation.isPending };
}

export function useTeamMissionMutations(orgId) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: appointmentKeys.teamMembers(orgId) });
  const upsert = useMutation({
    mutationFn: (args) => unwrapResult(teamMissionsService.upsertMission(args)),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (missionId) => unwrapResult(teamMissionsService.deleteMission(missionId)),
    onSuccess: invalidate,
  });
  return {
    upsertMission: upsert.mutateAsync,
    deleteMission: remove.mutateAsync,
    isSaving: upsert.isPending || remove.isPending,
  };
}
```

- [ ] **Step 4: Vérifier**

Run: `npx eslint --ext .js src/shared/services/teamMissions.service.js src/shared/hooks/useTeamMissions.js src/shared/services/appointments.service.js` puis `npx vite build`.
Expected: 0 erreur, 0 nouveau warning, build OK.
Puis la mesure de régression du contrat des mutations (CLAUDE.md) :
`grep -rnE "mutationFn: .*=> *[a-zA-Z]+Service\.[a-zA-Z]+\(" src/shared/hooks | grep -v "unwrap("` → ne remonte que `useGoogleCalendar`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/services/teamMissions.service.js src/shared/hooks/useTeamMissions.js src/shared/services/appointments.service.js
git commit -m "feat(equipe): service et hooks des missions ; les membres chargent leurs missions, inactifs compris"
```

---

### Task 4: Appliquer la règle aux quatre points de choix

**Files:**
- Modify: `src/apps/artisan/components/planning/scheduling/SchedulingAssistant.jsx` (~l. 136-156, `columnMembers`)
- Modify: `src/apps/artisan/components/planning/EventFormSections.jsx` (~l. 532-555, `SectionAssignee`)
- Modify: `src/apps/artisan/components/certificat/CertificatWizard.jsx` (~l. 95 et 512)
- Modify: `src/shared/hooks/useAppointments.js` (~l. 155-159, `teamList`)

**Interfaces:**
- Consumes: `filtrerChoisissables`, `filtrerVisiblesSurPlage`, `aujourdhuiISO` (Task 2) ; membres avec `missions` (Task 3).
- Produces: aucun nouveau symbole.

- [ ] **Step 1: SchedulingAssistant — colonnes du jour sélectionné**

Importer `import { filtrerChoisissables } from '@/lib/teamVisibility';`. `columnMembers` est déclaré avant `selectedDate` / `dayAppointments` (l. 171, 185) : déplacer le `useMemo` `columnMembers` **après** la ligne `const { dayAppointments } = useTeamDayAvailability(orgId, selectedDate);`, puis remplacer sa branche technicien / tous :

```js
    // Sous-traitants : colonne seulement pendant une mission, ou s'ils ont déjà un RDV ce jour.
    const avecRdvCeJour = new Set((dayAppointments || []).flatMap((a) => a.technician_ids || []));
    const base = assigneeType === 'technician'
      ? (members || []).filter((m) => !m.role || m.role === 'technician')
      : (members || []);
    return filtrerChoisissables(base, selectedDate, { garder: [...avecRdvCeJour] });
  }, [commercialMode, assigneeType, commercials, members, fixedAssigneeId, selectedDate, dayAppointments]);
```

`selectedDate` est-il une chaîne `YYYY-MM-DD` ? Vérifier `defaultStartDate()` dans le même fichier ; si c'est un `Date`, passer `formatDateForInput(selectedDate)` (`src/lib/utils.js`). Vérifier aussi qu'aucun usage de `columnMembers` ne précède sa nouvelle position (`grep -n columnMembers`).

- [ ] **Step 2: SectionAssignee — date du RDV, personnes déjà assignées gardées**

Dans `EventFormSections.jsx`, importer `filtrerChoisissables` et, en tête de `SectionAssignee` :

```js
  // Sous-traitant hors mission : pas proposé, sauf s'il est déjà sur ce RDV (historique, édition).
  const dejaAssignes = [...(formData.technicianIds || []), commercialMemberId].filter(Boolean);
  const choisissables = filtrerChoisissables(allTeamMembers, formData.scheduled_date || null, { garder: dejaAssignes });
```

et remplacer les trois `(allTeamMembers || [])` / `allTeamMembers || []` des branches par `choisissables`.

- [ ] **Step 3: CertificatWizard — technicien du certificat**

Importer `filtrerChoisissables, aujourdhuiISO` ; remplacer `technicians={teamMembers}` par :

```js
            technicians={filtrerChoisissables(teamMembers, formData.date_intervention || aujourdhuiISO(), {
              garder: [formData.technicien_id, assignedTechnician].filter(Boolean),
            })}
```

Avant d'écrire, lire les noms réels des champs date / technicien du certificat (`grep -n "technicien\|date_intervention\|date_visite" src/apps/artisan/components/certificat/CertificatWizard.jsx | head`) et utiliser ceux-là ; le principe ne change pas (date de la visite, sinon aujourd'hui ; la personne déjà inscrite est gardée).

- [ ] **Step 4: Puces du Planning — plage affichée**

Dans `useAppointments.js` (hook de la page Planning), importer `filtrerVisiblesSurPlage` et remplacer la ligne `teamList` :

```js
  // Puces équipe : un sous-traitant n'y figure que s'il a une mission sur la plage affichée
  // ou un RDV dedans. Les couleurs (colorMaps) restent calculées sur TOUT le monde (historique).
  const idsAvecRdv = useMemo(
    () => new Set((appointments || []).flatMap((a) => [...(a.technician_ids || []), a.assigned_commercial_id].filter(Boolean))),
    [appointments],
  );
  const visibleMembers = useMemo(
    () => filtrerVisiblesSurPlage(members, startDate, endDate, { idsAvecRdv }),
    [members, startDate, endDate, idsAvecRdv],
  );
  const teamList = useMemo(() => buildTeamList({ members: visibleMembers, commercials }), [visibleMembers, commercials]);
```

Vérifier que `startDate` / `endDate` sont bien les paramètres du hook sous ces noms et au format `YYYY-MM-DD` (`grep -n "startDate\|endDate" src/shared/hooks/useAppointments.js | head`) ; sinon les formater. `colorMaps` garde `members` (liste complète) : ne pas le changer.

- [ ] **Step 5: Vérifier**

Run: `npx eslint --ext .js,.jsx` sur les 4 fichiers, `node --test scripts/team-visibility.test.mjs scripts/planning-events.test.mjs`, `npx vite build`.
Expected: verts. Contrôle manuel en lecture : aucun écran autre que ces quatre ne filtre la liste des membres (`grep -rn "filtrerChoisissables\|filtrerVisiblesSurPlage" src`).

- [ ] **Step 6: Commit**

```bash
git add src/apps/artisan/components/planning/scheduling/SchedulingAssistant.jsx src/apps/artisan/components/planning/EventFormSections.jsx src/apps/artisan/components/certificat/CertificatWizard.jsx src/shared/hooks/useAppointments.js
git commit -m "feat(planning): un sous-traitant n'est proposé que pendant ses missions ; ses RDV restent visibles"
```

---

### Task 5: Éditeur de missions + panneau « Sous-traitants » du Planning

**Files:**
- Create: `src/apps/artisan/components/team/MissionsEditor.jsx`
- Create: `src/apps/artisan/components/team/SubcontractorsPanel.jsx`
- Modify: `src/apps/artisan/pages/Planning.jsx` (barre d'outils + montage du panneau)

**Interfaces:**
- Consumes: `useTeamMissionMutations`, `missionErrorMessage`, `chevauchement`, `etatSousTraitant`, `aujourdhuiISO`, `useTeamMembers`, `formatDateShortFR` (`src/lib/utils.js`).
- Produces:
  - `<MissionsEditor orgId teamMember canEdit defaultFrom? defaultTo? />`
  - `<SubcontractorsPanel orgId canEdit defaultFrom defaultTo onClose />`

- [ ] **Step 1: MissionsEditor**

`src/apps/artisan/components/team/MissionsEditor.jsx` :

```jsx
// MissionsEditor.jsx — missions datées d'UN sous-traitant (liste + ajout / édition / suppression).
// Partagé : panneau « Sous-traitants » du Planning et onglet Disponibilité de la fiche membre.
// Pré-contrôle du chevauchement côté écran (message immédiat) ; la RPC reste l'arbitre.
import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTeamMissionMutations } from '@hooks/useTeamMissions';
import { missionErrorMessage } from '@services/teamMissions.service';
import { chevauchement, aujourdhuiISO } from '@/lib/teamVisibility';
import { formatDateShortFR } from '@/lib/utils';

const inputCls = 'px-2 py-1 text-sm border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function periode(m) {
  return m.date_from === m.date_to
    ? `le ${formatDateShortFR(m.date_from)}`
    : `du ${formatDateShortFR(m.date_from)} au ${formatDateShortFR(m.date_to)}`;
}

export function MissionsEditor({ orgId, teamMember, canEdit, defaultFrom, defaultTo }) {
  const { upsertMission, deleteMission, isSaving } = useTeamMissionMutations(orgId);
  const today = aujourdhuiISO();
  const missions = teamMember.missions || [];
  const passees = missions.filter((m) => m.date_to < today);
  const actives = missions.filter((m) => m.date_to >= today);
  const [draft, setDraft] = useState(null); // { id|null, date_from, date_to, note }

  const conflit = useMemo(() => (draft && draft.date_from && draft.date_to
    ? chevauchement(missions, draft, draft.id) : null), [draft, missions]);
  const datesKo = draft && (!draft.date_from || !draft.date_to || draft.date_to < draft.date_from);

  const ouvrirAjout = () => setDraft({ id: null, date_from: defaultFrom || today, date_to: defaultTo || defaultFrom || today, note: '' });

  const enregistrer = async () => {
    if (!draft || datesKo || conflit) return;
    try {
      await upsertMission({
        missionId: draft.id, teamMemberId: teamMember.id,
        dateFrom: draft.date_from, dateTo: draft.date_to, note: draft.note || null,
      });
      toast.success(`Mission de ${teamMember.display_name} enregistrée`);
      setDraft(null);
    } catch (err) {
      toast.error(missionErrorMessage(err));
    }
  };

  const supprimer = async (m) => {
    try {
      await deleteMission(m.id);
      toast.success('Mission supprimée');
    } catch (err) {
      toast.error(missionErrorMessage(err));
    }
  };

  return (
    <div className="space-y-2">
      {actives.length === 0 && !draft && (
        <p className="text-sm text-secondary-500">Aucune mission prévue : {teamMember.display_name} n&apos;est proposé nulle part.</p>
      )}
      <ul className="space-y-1.5">
        {actives.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-secondary-200 px-3 py-1.5 text-sm">
            <span className="text-secondary-800">
              {periode(m)}
              {m.date_from <= today && <span className="ml-2 text-xs font-medium text-emerald-700">en cours</span>}
              {m.note && <span className="block text-xs text-secondary-500">{m.note}</span>}
            </span>
            {canEdit && (
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => setDraft({ id: m.id, date_from: m.date_from, date_to: m.date_to, note: m.note || '' })}
                  className="p-1 rounded hover:bg-secondary-100" aria-label="Modifier la mission"><Pencil className="w-4 h-4 text-secondary-500" /></button>
                <button type="button" onClick={() => supprimer(m)} disabled={isSaving}
                  className="p-1 rounded hover:bg-red-50 disabled:opacity-50" aria-label="Supprimer la mission"><Trash2 className="w-4 h-4 text-red-500" /></button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {draft && (
        <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">Du
              <input type="date" value={draft.date_from} className={inputCls}
                onChange={(e) => setDraft((d) => ({ ...d, date_from: e.target.value, date_to: d.date_to < e.target.value ? e.target.value : d.date_to }))} />
            </label>
            <label className="flex items-center gap-1.5">au
              <input type="date" value={draft.date_to} min={draft.date_from} className={inputCls}
                onChange={(e) => setDraft((d) => ({ ...d, date_to: e.target.value }))} />
            </label>
          </div>
          <input type="text" value={draft.note} placeholder="Note (facultatif) : chantier, client…" className={`w-full ${inputCls}`}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
          {datesKo && <p className="text-xs text-red-600">La date de fin doit suivre la date de début.</p>}
          {conflit && <p className="text-xs text-red-600">Chevauche la mission {periode(conflit)}.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-secondary-300 text-secondary-700 hover:bg-secondary-50">
              <X className="w-3.5 h-3.5" /> Annuler
            </button>
            <button type="button" onClick={enregistrer} disabled={isSaving || datesKo || !!conflit}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Enregistrer
            </button>
          </div>
        </div>
      )}

      {canEdit && !draft && (
        <button type="button" onClick={ouvrirAjout}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-secondary-300 text-secondary-700 hover:border-primary-400 hover:text-primary-700">
          <Plus className="w-3.5 h-3.5" /> Mission
        </button>
      )}

      {passees.length > 0 && (
        <details className="text-xs text-secondary-500">
          <summary className="cursor-pointer">{passees.length} mission(s) passée(s)</summary>
          <ul className="mt-1 space-y-0.5">{passees.slice().reverse().map((m) => <li key={m.id}>{periode(m)}{m.note ? ` · ${m.note}` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

export default MissionsEditor;
```

Vérifier que `formatDateShortFR` accepte une chaîne `YYYY-MM-DD` sans décalage de fuseau (lire sa définition dans `src/lib/utils.js`) ; sinon formater localement `d.split('-').reverse().join('/')`.

- [ ] **Step 2: SubcontractorsPanel**

`src/apps/artisan/components/team/SubcontractorsPanel.jsx` :

```jsx
// SubcontractorsPanel.jsx — bouton « Sous-traitants » du Planning : tous les sous-traitants et
// leurs missions, ajout en deux clics (dates par défaut = plage affichée).
import { useEffect } from 'react';
import { X, HardHat } from 'lucide-react';
import { useTeamMembers } from '@hooks/useAppointments';
import { etatSousTraitant, aujourdhuiISO } from '@/lib/teamVisibility';
import { MissionsEditor } from './MissionsEditor';

export function SubcontractorsPanel({ orgId, canEdit, defaultFrom, defaultTo, onClose }) {
  const { members, isLoading } = useTeamMembers(orgId);
  const sousTraitants = (members || []).filter((m) => m.is_subcontractor && m.is_active !== false);
  const today = aujourdhuiISO();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Sous-traitants">
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-secondary-200">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2"><HardHat className="w-5 h-5 text-primary-600" /> Sous-traitants</h2>
            <p className="text-sm text-secondary-500">Un sous-traitant n&apos;apparaît dans le planning que pendant ses missions.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary-100" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {isLoading && <p className="text-sm text-secondary-500">Chargement…</p>}
          {!isLoading && sousTraitants.length === 0 && (
            <p className="text-sm text-secondary-500">
              Aucun sous-traitant. Cochez « Sous-traitant » dans la fiche du membre (Paramètres → Équipe).
            </p>
          )}
          {sousTraitants.map((m) => {
            const { etat, mission } = etatSousTraitant(m, today);
            return (
              <section key={m.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: m.calendar_color || '#94A3B8' }} />
                  <h3 className="text-sm font-semibold text-secondary-900">{m.display_name}</h3>
                  <span className="text-xs text-secondary-500">
                    {etat === 'en_mission' && `en mission jusqu’au ${mission.date_to.split('-').reverse().join('/')}`}
                    {etat === 'a_venir' && `prochaine mission le ${mission.date_from.split('-').reverse().join('/')}`}
                    {etat === 'en_reserve' && 'en réserve'}
                  </span>
                </div>
                <MissionsEditor orgId={orgId} teamMember={m} canEdit={canEdit} defaultFrom={defaultFrom} defaultTo={defaultTo} />
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SubcontractorsPanel;
```

- [ ] **Step 3: Bouton dans la barre du Planning**

Dans `Planning.jsx` : importer `SubcontractorsPanel` et l'icône `HardHat` ; ajouter un état `const [showSubcontractors, setShowSubcontractors] = useState(false);` ; récupérer `isTeamLeaderOrAbove` de `useAuth()` (déjà utilisé ? `grep -n "useAuth()" src/apps/artisan/pages/Planning.jsx`). Dans la barre d'outils, à côté du bouton d'impression (repérer `printHint` / le bouton Imprimer, `grep -n "Imprimer" src/apps/artisan/pages/Planning.jsx`) :

```jsx
          {isTeamLeaderOrAbove && (
            <button
              type="button"
              onClick={() => setShowSubcontractors(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              title="Activer un sous-traitant sur une période"
            >
              <HardHat className="w-4 h-4" /> Sous-traitants
            </button>
          )}
```

et à côté des autres modales :

```jsx
      {showSubcontractors && (
        <SubcontractorsPanel
          orgId={orgId}
          canEdit={isTeamLeaderOrAbove}
          defaultFrom={dateRange.startDate}
          defaultTo={dateRange.endDate}
          onClose={() => setShowSubcontractors(false)}
        />
      )}
```

`dateRange.endDate` est-il inclusif ? FullCalendar rend une fin **exclusive** ; lire `getDateRange` dans `Planning.jsx`. Si exclusive, passer la veille comme `defaultTo`.

- [ ] **Step 4: Vérifier**

Run: `npx eslint --ext .jsx` sur les 3 fichiers, `npx vite build`, `npm run audit:dead-code` (les deux composants doivent être importés).
Expected: verts.

- [ ] **Step 5: Commit**

```bash
git add src/apps/artisan/components/team src/apps/artisan/pages/Planning.jsx
git commit -m "feat(planning): bouton Sous-traitants — missions datées en deux clics"
```

---

### Task 6: Fiche membre et synthèse Équipe

**Files:**
- Modify: `src/apps/artisan/pages/settings/team/memberPresentation.js`
- Modify: `src/apps/artisan/pages/settings/team/MemberModal.jsx`
- Modify: `src/apps/artisan/pages/settings/TeamManagement.jsx`

**Interfaces:**
- Consumes: `useSetSubcontractor`, `MissionsEditor`, `etatSousTraitant`, `aujourdhuiISO`.
- Produces: props de `MemberModal` : `onSubcontractorChange(teamMemberId, bool)`, `isSubcontractorSaving`, `canManageMissions`, `orgId`.

- [ ] **Step 1: Vocabulaire**

Dans `memberPresentation.js` : option `main` → libellé `'À la main'` ; aide `main` → `'Jamais proposé par la machine ; assignable à la main dans le Planning.'`. Ajouter :

```js
/** Libellé de l'état d'un sous-traitant pour la synthèse (cf. teamVisibility.etatSousTraitant). */
export const libelleEtatSousTraitant = ({ etat, mission }) => {
  const fr = (d) => d.split('-').reverse().join('/');
  if (etat === 'en_mission') return `En mission jusqu’au ${fr(mission.date_to)}`;
  if (etat === 'a_venir') return `Prochaine mission le ${fr(mission.date_from)}`;
  if (etat === 'en_reserve') return 'En réserve';
  return null;
};
```

- [ ] **Step 2: Fiche — case et onglet Disponibilité**

Dans `MemberModal.jsx` :
- nouvelles props `orgId`, `onSubcontractorChange`, `isSubcontractorSaving`, `canManageMissions` ;
- dans l'onglet Profil, juste après la section « Commercial » :

```jsx
              <Section title="Sous-traitant" help="Un sous-traitant n’apparaît dans le planning que pendant ses missions (onglet Disponibilité) et n’est jamais proposé par la machine.">
                {!teamMember ? <PlanningPending /> : (
                  <label className="inline-flex items-center gap-2 text-sm text-secondary-800">
                    <input
                      type="checkbox"
                      checked={!!teamMember.is_subcontractor}
                      onChange={(e) => onSubcontractorChange(teamMember.id, e.target.checked)}
                      disabled={!canEdit || isSubcontractorSaving}
                      className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                    />
                    Sous-traitant
                    {isSubcontractorSaving && <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />}
                  </label>
                )}
              </Section>
```

- un onglet `disponibilite` (« Disponibilité »), visible quand `teamMember?.is_subcontractor`, placé après « Horaires », contenu :

```jsx
            {teamMember?.is_subcontractor && (
              <TabsContent value="disponibilite" className="mt-0 space-y-3">
                <p className="text-sm text-secondary-500">
                  {name} n&apos;est proposé dans le planning, l&apos;assistant de créneaux et les assignations que pendant ces périodes. Ses rendez-vous restent toujours visibles.
                </p>
                <MissionsEditor orgId={orgId} teamMember={teamMember} canEdit={canManageMissions} />
              </TabsContent>
            )}
```

- étendre le `useEffect` de repli d'onglet : `if ((tab === 'competences' && !isTechnician) || (tab === 'disponibilite' && !teamMember?.is_subcontractor)) setTab('profil');`
- pied : texte « Chaque modification est enregistrée aussitôt. » vaut aussi pour Disponibilité (rien à changer).

- [ ] **Step 3: Page Équipe — handler, tag, état**

Dans `TeamManagement.jsx` :
- `const { setSubcontractor } = useSetSubcontractor(orgId);` + état `savingSubcontractorId` ;
- handler :

```js
  const handleSubcontractorChange = async (teamMemberId, value) => {
    setSavingSubcontractorId(teamMemberId);
    try {
      await setSubcontractor({ teamMemberId, isSubcontractor: value });
      toast.success(value ? 'Sous-traitant : visible seulement pendant ses missions' : 'N’est plus sous-traitant');
    } catch (err) {
      toast.error(err?.code === '42501' ? 'Réservé à l’administrateur' : 'Erreur lors du changement de statut');
    } finally {
      setSavingSubcontractorId(null);
    }
  };
```

- passer à `MemberModal` : `orgId={orgId}`, `onSubcontractorChange={handleSubcontractorChange}`, `isSubcontractorSaving={!!editingTeamMember && savingSubcontractorId === editingTeamMember.id}`, `canManageMissions={isTeamLeaderOrAbove}` (le récupérer de `useAuth()`) ;
- `MemberRow` : sous le badge de rôle, si `teamMember?.is_subcontractor`, un tag `Sous-traitant` (même style que « Assignable aux leads ») ; dans la colonne Planification, remplacer le libellé par `libelleEtatSousTraitant(etatSousTraitant(teamMember, aujourdhuiISO()))` quand c'est un sous-traitant (le budget reste affiché dessous).

- [ ] **Step 4: Vérifier**

Run: `npx eslint --ext .js,.jsx src/apps/artisan/pages/settings`, `npx vite build`, `npm run audit:quality`.
Expected: verts.

- [ ] **Step 5: Commit**

```bash
git add src/apps/artisan/pages/settings
git commit -m "feat(settings): fiche membre — case Sous-traitant, onglet Disponibilité ; état de mission dans la synthèse"
```

---

### Task 7: Recette et passage de relais

- [ ] **Step 1: Contrôles finaux**

Run: `npm run audit:quality` et `npx vite build`. Expected: verts.
En prod (lecture) : `SELECT jobname FROM cron.job` n'est pas concerné (aucun cron en tranche 1).

- [ ] **Step 2: Pousser**

```bash
git pull --rebase --autostash
git push origin main
```

- [ ] **Step 3: Recette à demander à Eric (message de fin)**

1. Paramètres → Équipe → Mohammed → cocher « Sous-traitant ».
2. Planning : Mohammed disparaît des puces et de l'assistant ; ses anciens RDV gardent sa couleur.
3. Bouton « Sous-traitants » → + Mission du 14 au 18 → il réapparaît ces jours-là seulement.
4. Un RDV déjà posé sur lui hors mission reste visible et modifiable avec lui.

- [ ] **Step 4: Proposition CLAUDE.md**

Ajouter une entrée PENDING dans `.claude/proposed-updates.md` (pas d'édition directe du CLAUDE.md) : « Sous-traitants à missions — règle unique `src/lib/teamVisibility.js`, `getTeamMembers` rend tout le monde (historique), écritures par `team_member_mission_upsert` / `_delete` (org_admin | team_leader) et `team_member_set_subcontractor` (org_admin, force `include_in_routing=false`) ; ne jamais filtrer `is_active` dans `getTeamMembers`. »
