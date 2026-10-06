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
             AND NOT coalesce(('security_invoker=true' = ANY (reloptions)), false)) THEN
    RAISE EXCEPTION '(A) vue sans security_invoker';
  END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.org_roles', 'SELECT') THEN RAISE EXCEPTION '(A) service_role sans SELECT org_roles'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.member_org_roles', 'SELECT') THEN RAISE EXCEPTION '(A) service_role sans SELECT member_org_roles'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.org_roles', 'INSERT') THEN RAISE EXCEPTION '(A) authenticated a INSERT sur org_roles'; END IF;
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
