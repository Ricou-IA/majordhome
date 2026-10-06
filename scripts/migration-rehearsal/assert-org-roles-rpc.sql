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
