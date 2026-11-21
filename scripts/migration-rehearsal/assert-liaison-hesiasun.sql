-- assert-liaison-hesiasun.sql — vérifie 20261121_6_liaison_hesiasun_etat.sql (+ 20261121_7 si pg_cron est simulé).
-- À lancer après avoir rejoué 20261121_6 (deux fois : la migration est rejouable).
DO $$
DECLARE
  v_org uuid;
  v_avant jsonb;
  v_apres jsonb;
  n int;
BEGIN
  -- 1. Droits : service_role seul, y compris PUBLIC (un REVOKE … FROM anon seul ne retire rien).
  IF has_function_privilege('anon', 'public.org_hesiasun_noter(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.org_hesiasun_noter(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.org_hesiasun_en_attente()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.org_hesiasun_en_attente()', 'EXECUTE') THEN
    RAISE EXCEPTION 'org_hesiasun_* exécutable par anon ou authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.org_hesiasun_noter(uuid, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.org_hesiasun_en_attente()', 'EXECUTE') THEN
    RAISE EXCEPTION 'org_hesiasun_* non exécutable par service_role';
  END IF;

  SELECT id, settings INTO v_org, v_avant FROM core.organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'aucune organisation dans la photographie'; END IF;

  -- 2. Noter : seule la clé hesiasun change, le reste des réglages est intact.
  PERFORM public.org_hesiasun_noter(v_org, '{"liaison_id":"11111111-1111-4111-8111-111111111111","ouverte":true,"en_attente":true}'::jsonb);
  SELECT settings INTO v_apres FROM core.organizations WHERE id = v_org;
  IF (v_apres -> 'hesiasun' ->> 'liaison_id') IS DISTINCT FROM '11111111-1111-4111-8111-111111111111' THEN RAISE EXCEPTION 'état non écrit'; END IF;
  IF (v_apres - 'hesiasun') IS DISTINCT FROM (COALESCE(v_avant, '{}'::jsonb) - 'hesiasun') THEN RAISE EXCEPTION 'd''autres réglages ont changé'; END IF;

  -- 3. En attente : l'organisation est listée, puis ne l'est plus.
  SELECT count(*) INTO n FROM public.org_hesiasun_en_attente() WHERE org_id = v_org;
  IF n <> 1 THEN RAISE EXCEPTION 'organisation en attente non listée'; END IF;
  PERFORM public.org_hesiasun_noter(v_org, '{"liaison_id":"11111111-1111-4111-8111-111111111111","ouverte":true,"en_attente":false}'::jsonb);
  SELECT count(*) INTO n FROM public.org_hesiasun_en_attente() WHERE org_id = v_org;
  IF n <> 0 THEN RAISE EXCEPTION 'organisation encore listée après un envoi réussi'; END IF;

  -- 4. NULL retire la clé ; les réglages reviennent à l'identique.
  PERFORM public.org_hesiasun_noter(v_org, NULL);
  SELECT settings INTO v_apres FROM core.organizations WHERE id = v_org;
  IF v_apres ? 'hesiasun' THEN RAISE EXCEPTION 'clé hesiasun non retirée'; END IF;
  IF v_apres IS DISTINCT FROM (COALESCE(v_avant, '{}'::jsonb) - 'hesiasun') THEN RAISE EXCEPTION 'réglages différents après retrait'; END IF;
  IF v_avant ? 'hesiasun' THEN PERFORM public.org_hesiasun_noter(v_org, v_avant -> 'hesiasun'); END IF;

  -- 5. Refus : organisation inconnue, état qui n'est pas un objet, clé d'API glissée dans l'état.
  BEGIN
    PERFORM public.org_hesiasun_noter('00000000-0000-4000-8000-000000000000', '{}'::jsonb);
    RAISE EXCEPTION 'organisation inconnue acceptée';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
  BEGIN
    PERFORM public.org_hesiasun_noter(v_org, '[1]'::jsonb);
    RAISE EXCEPTION 'état tableau accepté';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.org_hesiasun_noter(v_org, '{"cle":"bk_live_0123456789"}'::jsonb);
    RAISE EXCEPTION 'clé d''API acceptée dans l''état';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

  -- 6. Cron (si le cluster simule pg_cron et que 20261121_7 a été rejouée).
  IF to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hesiasun-identite-cron') THEN
    SELECT count(*) INTO n FROM cron.job WHERE jobname = 'hesiasun-identite-cron'
      AND schedule = '20 * * * *' AND command LIKE '%/functions/v1/hesiasun-identite-cron%'
      AND command LIKE '%mdh_cron_secret%' AND command LIKE '%WHERE EXISTS%en_attente%';
    IF n <> 1 THEN RAISE EXCEPTION 'tâche hesiasun-identite-cron absente, en double ou incomplète'; END IF;
  END IF;

  RAISE NOTICE 'assert-liaison-hesiasun : OK';
END $$;
