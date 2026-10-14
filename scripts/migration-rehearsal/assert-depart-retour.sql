-- assert-depart-retour.sql — vérifie 20261014_2_depart_retour_technicien.sql sur le cluster de répétition.
-- Couvre : colonnes + vue (fin de liste, security_invoker, insertable), privilèges effectifs des deux RPC
-- et de la table, gardes (anonyme, non-admin / technicien, membre inconnu, valeurs invalides),
-- écriture / reset du réglage, upsert / suppression de l'exception du jour.
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
  v_mayer  uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_tm     uuid;
  v_admin  uuid;
  v_leader uuid;
  v_simple uuid;
  v_point  jsonb := '{"label": "Domicile", "address": "1 rue X 31620 Bouloc", "lat": 43.78, "lng": 1.41}';
  v_cols   text[];
  r        record;
  n        int;
BEGIN
  -- 1. Structure ---------------------------------------------------------------------
  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_team_members';
  IF v_cols[array_length(v_cols, 1) - 1:] IS DISTINCT FROM ARRAY['depart_point', 'retour_point'] THEN
    RAISE EXCEPTION 'vue team_members : colonnes de fin inattendues %', v_cols;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.majordhome_team_members'::regclass
                 AND 'security_invoker=true' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'vue team_members : security_invoker perdu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.majordhome_team_member_day_endpoints'::regclass
                 AND 'security_invoker=true' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'vue day_endpoints : security_invoker absent';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.team_member_day_endpoints'::regclass) THEN
    RAISE EXCEPTION 'RLS non activée sur team_member_day_endpoints';
  END IF;

  -- 2. Privilèges effectifs ------------------------------------------------------------
  IF has_function_privilege('anon', 'public.team_member_set_routing_settings(uuid,integer,boolean,text[],jsonb,jsonb,boolean,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon exécute team_member_set_routing_settings';
  END IF;
  IF has_function_privilege('anon', 'public.team_member_set_day_endpoints(uuid,date,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon exécute team_member_set_day_endpoints';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.team_member_set_day_endpoints(uuid,date,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ne peut pas exécuter team_member_set_day_endpoints';
  END IF;
  IF to_regprocedure('public.team_member_set_routing_settings(uuid,integer,boolean,text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'ancienne signature de team_member_set_routing_settings toujours présente';
  END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.team_member_day_endpoints', 'SELECT') THEN
    RAISE EXCEPTION 'service_role ne lit pas team_member_day_endpoints';
  END IF;
  IF has_table_privilege('anon', 'majordhome.team_member_day_endpoints', 'SELECT')
     OR has_table_privilege('authenticated', 'majordhome.team_member_day_endpoints', 'INSERT') THEN
    RAISE EXCEPTION 'privilèges trop larges sur team_member_day_endpoints';
  END IF;

  -- 3. Fixtures ----------------------------------------------------------------------------
  SELECT tm.id INTO v_tm FROM majordhome.team_members tm
    JOIN majordhome.organizations o ON o.id = tm.org_id
   WHERE o.core_org_id = v_mayer AND tm.role = 'technician' AND tm.is_active LIMIT 1;
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_leader FROM core.organization_members WHERE org_id = v_mayer AND role = 'team_leader' LIMIT 1;
  SELECT user_id INTO v_simple FROM core.organization_members WHERE org_id = v_mayer AND role NOT IN ('org_admin', 'team_leader') LIMIT 1;
  IF v_tm IS NULL OR v_admin IS NULL OR v_simple IS NULL THEN RAISE EXCEPTION 'fixtures absentes'; END IF;

  -- 4. Réglage du technicien ---------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.expect_err('routing anonyme', format('SELECT * FROM public.team_member_set_routing_settings(%L, p_depart_point => %L::jsonb)', v_tm, v_point), '42501');
  PERFORM set_config('request.jwt.claim.sub', v_simple::text, true);
  PERFORM pg_temp.expect_err('routing non-admin', format('SELECT * FROM public.team_member_set_routing_settings(%L, p_depart_point => %L::jsonb)', v_tm, v_point), '42501');
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.expect_err('routing point sans coords', format('SELECT * FROM public.team_member_set_routing_settings(%L, p_depart_point => %L::jsonb)', v_tm, '{"label":"x","lat":"43"}'), '22023');

  SELECT * INTO r FROM public.team_member_set_routing_settings(v_tm, p_depart_point => v_point, p_retour_point => v_point);
  IF r.depart_point IS DISTINCT FROM v_point OR r.retour_point IS DISTINCT FROM v_point THEN
    RAISE EXCEPTION 'points non écrits : %', r;
  END IF;
  -- Patch partiel : un autre champ seul ne touche pas aux points.
  SELECT * INTO r FROM public.team_member_set_routing_settings(v_tm, p_daily_work_minutes => 480);
  IF r.depart_point IS NULL THEN RAISE EXCEPTION 'patch partiel : depart_point effacé'; END IF;
  SELECT * INTO r FROM public.team_member_set_routing_settings(v_tm, p_reset_retour => true);
  IF r.retour_point IS NOT NULL OR r.depart_point IS NULL THEN RAISE EXCEPTION 'reset retour incorrect : %', r; END IF;

  -- 5. Exception du jour -------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.expect_err('jour anonyme', format('SELECT * FROM public.team_member_set_day_endpoints(%L, %L, %L, NULL)', v_tm, '2026-10-20', 'agence'), '42501');
  PERFORM set_config('request.jwt.claim.sub', v_simple::text, true);
  PERFORM pg_temp.expect_err('jour technicien', format('SELECT * FROM public.team_member_set_day_endpoints(%L, %L, %L, NULL)', v_tm, '2026-10-20', 'agence'), '42501');
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_leader, v_admin)::text, true);
  PERFORM pg_temp.expect_err('jour valeur invalide', format('SELECT * FROM public.team_member_set_day_endpoints(%L, %L, %L, NULL)', v_tm, '2026-10-20', 'maison'), '22023');
  PERFORM pg_temp.expect_err('jour membre inconnu', format('SELECT * FROM public.team_member_set_day_endpoints(%L, %L, %L, NULL)', gen_random_uuid(), '2026-10-20', 'agence'), 'P0002');

  PERFORM public.team_member_set_day_endpoints(v_tm, '2026-10-20', NULL, 'agence');
  PERFORM public.team_member_set_day_endpoints(v_tm, '2026-10-20', 'agence', 'agence');
  SELECT count(*) INTO n FROM majordhome.team_member_day_endpoints WHERE team_member_id = v_tm AND date = '2026-10-20' AND depart = 'agence';
  IF n <> 1 THEN RAISE EXCEPTION 'upsert exception : % ligne(s)', n; END IF;
  PERFORM public.team_member_set_day_endpoints(v_tm, '2026-10-20', NULL, NULL);
  SELECT count(*) INTO n FROM majordhome.team_member_day_endpoints WHERE team_member_id = v_tm;
  IF n <> 0 THEN RAISE EXCEPTION 'exception vide non supprimée'; END IF;

  RAISE NOTICE 'assert-depart-retour : OK';
END $$;
