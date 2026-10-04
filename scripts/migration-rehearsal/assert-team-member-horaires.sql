-- assert-team-member-horaires.sql — vérifie 20261004_5_team_member_horaires.sql sur le cluster de répétition.
-- Couvre : Lucas aligné sur Antoine/Ludovic (et eux inchangés), nouveau DEFAULT (samedi inactif),
-- privilèges effectifs de la RPC, gardes (anonyme, non-admin, membre inconnu), validation et normalisation.
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
  v_lucas   uuid := '1dc2dbab-ca31-4d01-a05f-0dae97443a33';
  v_cible   jsonb := '{"monday": {"start": "08:00", "end": "17:00", "active": true}, "tuesday": {"start": "08:00", "end": "17:00", "active": true}, "wednesday": {"start": "08:00", "end": "17:00", "active": true}, "thursday": {"start": "08:00", "end": "17:00", "active": true}, "friday": {"start": "08:00", "end": "16:00", "active": true}, "saturday": {"active": false}, "sunday": {"active": false}}'::jsonb;
  v_admin   uuid;
  v_nonadm  uuid;
  v_def     text;
  v_res     jsonb;
  v_ok      jsonb;
  n         int;
BEGIN
  -- 1. Données ------------------------------------------------------------------
  SELECT count(*) INTO n FROM majordhome.team_members WHERE id = v_lucas;
  IF n <> 1 THEN RAISE EXCEPTION 'fixture : Lucas absent du snapshot'; END IF;
  SELECT count(*) INTO n FROM majordhome.team_members
   WHERE display_name IN ('Antoine Verloo', 'Ludovic Robert', 'Lucas Taugourdeau') AND default_availability = v_cible;
  IF n <> 3 THEN RAISE EXCEPTION 'Lucas / Antoine / Ludovic pas tous sur les horaires cibles (% / 3)', n; END IF;

  -- 2. DEFAULT --------------------------------------------------------------------
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'majordhome.team_members'::regclass AND a.attname = 'default_availability';
  EXECUTE format('SELECT %s', v_def) INTO v_res;
  IF v_res IS DISTINCT FROM v_cible THEN RAISE EXCEPTION 'DEFAULT inattendu : %', v_res; END IF;

  -- 3. Privilèges effectifs -----------------------------------------------------------
  IF has_function_privilege('anon', 'public.team_member_set_availability(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon exécute team_member_set_availability';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.team_member_set_availability(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ne peut pas exécuter team_member_set_availability';
  END IF;

  -- 4. Gardes ---------------------------------------------------------------------------
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_nonadm FROM core.organization_members WHERE org_id = v_mayer AND role IS DISTINCT FROM 'org_admin' LIMIT 1;
  IF v_admin IS NULL OR v_nonadm IS NULL THEN RAISE EXCEPTION 'fixture : admin ou non-admin Mayer absent'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.expect_err('anonyme', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible), '42501');
  PERFORM set_config('request.jwt.claim.sub', v_nonadm::text, true);
  PERFORM pg_temp.expect_err('non-admin', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible), '42501');
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.expect_err('membre inconnu', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', gen_random_uuid(), v_cible), 'P0002');

  -- 5. Validation (en admin) -------------------------------------------------------------
  PERFORM pg_temp.expect_err('null', format('SELECT public.team_member_set_availability(%L, NULL)', v_lucas), '22023');
  PERFORM pg_temp.expect_err('tableau', format('SELECT public.team_member_set_availability(%L, ''[]''::jsonb)', v_lucas), '22023');
  PERFORM pg_temp.expect_err('jour manquant', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible - 'sunday'), '22023');
  PERFORM pg_temp.expect_err('jour inconnu', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible || '{"lundi": {"active": false}}'), '22023');
  PERFORM pg_temp.expect_err('active non booléen', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible || '{"sunday": {"active": "false"}}'), '22023');
  PERFORM pg_temp.expect_err('heure invalide', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible || '{"monday": {"start": "8:00", "end": "17:00", "active": true}}'), '22023');
  PERFORM pg_temp.expect_err('24:00', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible || '{"monday": {"start": "08:00", "end": "24:00", "active": true}}'), '22023');
  PERFORM pg_temp.expect_err('début = fin', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible || '{"monday": {"start": "17:00", "end": "17:00", "active": true}}'), '22023');
  PERFORM pg_temp.expect_err('début > fin', format('SELECT public.team_member_set_availability(%L, %L::jsonb)', v_lucas, v_cible || '{"monday": {"start": "18:00", "end": "08:00", "active": true}}'), '22023');
  SELECT default_availability INTO v_res FROM majordhome.team_members WHERE id = v_lucas;
  IF v_res IS DISTINCT FROM v_cible THEN RAISE EXCEPTION 'une saisie refusée a modifié la ligne'; END IF;

  -- 6. Écriture + normalisation ------------------------------------------------------------
  -- Samedi travaillé, dimanche inactif avec heures parasites (doivent disparaître).
  v_ok := v_cible || '{"saturday": {"start": "09:00", "end": "12:00", "active": true}, "sunday": {"start": "10:00", "end": "11:00", "active": false}}'::jsonb;
  v_res := public.team_member_set_availability(v_lucas, v_ok);
  IF v_res -> 'sunday' IS DISTINCT FROM '{"active": false}'::jsonb THEN RAISE EXCEPTION 'jour inactif non normalisé : %', v_res -> 'sunday'; END IF;
  IF v_res -> 'saturday' IS DISTINCT FROM '{"start": "09:00", "end": "12:00", "active": true}'::jsonb THEN RAISE EXCEPTION 'samedi mal écrit : %', v_res -> 'saturday'; END IF;
  SELECT default_availability INTO v_res FROM majordhome.team_members WHERE id = v_lucas;
  IF v_res -> 'saturday' ->> 'active' <> 'true' THEN RAISE EXCEPTION 'écriture non persistée'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'team_member_set_availability + horaires : OK';
END;
$$;
