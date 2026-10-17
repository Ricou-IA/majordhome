-- assert-webshop-reglages.sql — vérifie 20261017_1_webshop_reglages.sql.
-- A : structure / droits / cron. B : réglages lus par la base, dans une transaction annulée,
-- avec des bouchons pg_net / Vault (absents du cluster local).

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'majordhome.webshop_reglages_defaut()',
    'majordhome.webshop_reglages(uuid)',
    'majordhome.webshop_should_send(uuid, timestamptz)',
    'majordhome.webshop_reglage_entier(jsonb, integer, integer, integer)',
    'majordhome.webshop_reglage_date(jsonb, text)',
    'majordhome.webshop_jsonb_fusion(jsonb, jsonb)',
    'majordhome.webshop_slot_recount(uuid)',
    'public.webshop_cycle_week(date, date)',
    'public.webshop_close_due_slots(date)',
    'public.webshop_generate_slots(uuid, integer, date)',
    'public.webshop_insert_slots(uuid, jsonb)',
    'public.webshop_apply_paid_order(uuid)',
    'public.webshop_run_daily_tours(date)',
    'public.webshop_slot_set_status(uuid, text, text)',
    'public.webshop_slot_send_now(uuid)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par anon', f; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'majordhome.webshop_reglages(uuid)', 'majordhome.webshop_should_send(uuid, timestamptz)',
    'public.webshop_close_due_slots(date)', 'public.webshop_generate_slots(uuid, integer, date)',
    'public.webshop_insert_slots(uuid, jsonb)', 'public.webshop_apply_paid_order(uuid)', 'public.webshop_run_daily_tours(date)'
  ] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par authenticated', f; END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION '% non exécutable par service_role', f; END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.webshop_slot_send_now(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'send_now non exécutable par authenticated';
  END IF;
  -- Signatures inchangées : l'horizon par défaut devient NULL (= réglage de l'org)
  IF pg_get_function_arguments('public.webshop_generate_slots(uuid, integer, date)'::regprocedure)
       <> 'p_org_id uuid, p_horizon_weeks integer DEFAULT NULL::integer, p_from date DEFAULT NULL::date' THEN
    RAISE EXCEPTION 'generate_slots : arguments %', pg_get_function_arguments('public.webshop_generate_slots(uuid, integer, date)'::regprocedure);
  END IF;
  IF (SELECT schedule FROM cron.job WHERE jobname = 'webshop-tours-daily') IS DISTINCT FROM '0 * * * *' THEN
    RAISE EXCEPTION 'cron webshop-tours-daily pas horaire';
  END IF;
  IF public.webshop_cycle_week(DATE '2026-01-12') <> 2 OR public.webshop_cycle_week(DATE '2026-01-12', DATE '2026-01-05') <> 2
     OR public.webshop_cycle_week(DATE '2026-01-05', DATE '2026-01-12') <> 4 THEN
    RAISE EXCEPTION 'webshop_cycle_week : rang de semaine faux';
  END IF;
  IF COALESCE(majordhome.webshop_reglages('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1')->>'site_url', '') <> 'https://www.mayer-energie.fr' THEN
    RAISE EXCEPTION 'backfill site_url Mayer absent : %', majordhome.webshop_reglages('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1')->>'site_url';
  END IF;
  RAISE NOTICE 'assert-webshop-reglages A (structure) : OK';
END $$;

BEGIN;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text, decrypted_secret text);
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.rehearsal_calls (id bigserial, url text, body jsonb, headers jsonb);
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int)
RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO net.rehearsal_calls (url, body, headers) VALUES (url, body, headers) RETURNING id;
$f$;

DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_d date := DATE '2030-03-04'; -- lundi
  v_sect_m uuid; v_sect_a uuid; v_sect_b uuid;
  v_s3 uuid; v_s4 uuid; v_s5 uuid; v_a2 uuid; v_a3 uuid;
  v_tl uuid; v_slot uuid; v_res text; v_n int; v_dates text;
  v_heure int := extract(hour FROM now() AT TIME ZONE 'Europe/Paris')::int;
BEGIN
  SELECT id INTO v_autre FROM core.organizations WHERE id <> v_mayer ORDER BY id LIMIT 1;
  IF v_autre IS NULL THEN RAISE EXCEPTION 'fixture : aucune autre org'; END IF;

  -- (1) Org sans settings.webshop : défauts
  UPDATE core.organizations SET settings = COALESCE(settings, '{}') - 'webshop' WHERE id = v_autre;
  IF majordhome.webshop_reglages(v_autre)->'palette'->>'delai_fermeture_jours' <> '2'
     OR (majordhome.webshop_reglages(v_autre)->'palette'->>'heure_envoi')::int <> 18
     OR (majordhome.webshop_reglages(v_autre)->'palette'->>'capacite_emplacements')::int <> 10
     OR majordhome.webshop_reglages(v_autre)->>'site_url' <> ''
     OR majordhome.webshop_reglages(v_autre)->'depots'->0->>'code' <> 'castanet' THEN
    RAISE EXCEPTION '(1) défauts : %', majordhome.webshop_reglages(v_autre);
  END IF;
  IF majordhome.webshop_reglages(gen_random_uuid())->'palette'->>'delai_fermeture_jours' <> '2' THEN
    RAISE EXCEPTION '(1) org inconnue : défauts attendus';
  END IF;

  -- (2) Coercition : invalide → défaut, valide → valeur ; fusion profonde (clé non lue conservée)
  UPDATE core.organizations SET settings = jsonb_set(COALESCE(settings, '{}'), '{webshop}',
    '{"palette":{"delai_fermeture_jours":"x","heure_envoi":24,"horizon_semaines":"3","ancre_cycle":"2026-02-30","envoi_auto":"false","capacite_emplacements":2.5},"colis":{"tva_pct":5.5},"depots":[{"code":" "},{"code":"muret"}]}')
   WHERE id = v_autre;
  IF majordhome.webshop_reglages(v_autre)->'palette'->>'delai_fermeture_jours' <> '2'
     OR (majordhome.webshop_reglages(v_autre)->'palette'->>'heure_envoi')::int <> 18
     OR (majordhome.webshop_reglages(v_autre)->'palette'->>'horizon_semaines')::int <> 3
     OR majordhome.webshop_reglages(v_autre)->'palette'->>'ancre_cycle' <> '2026-01-05'
     OR (majordhome.webshop_reglages(v_autre)->'palette'->>'envoi_auto')::boolean IS NOT FALSE
     OR (majordhome.webshop_reglages(v_autre)->'palette'->>'capacite_emplacements')::int <> 10
     OR (majordhome.webshop_reglages(v_autre)->'palette'->>'prix_emplacement_defaut_cents')::int <> 5500
     OR (majordhome.webshop_reglages(v_autre)->'colis'->>'tva_pct')::numeric <> 5.5
     OR majordhome.webshop_reglages(v_autre)->'depots' <> '[{"code":"muret","libelle":"Dépôt muret","adresse":"muret"}]'::jsonb THEN
    RAISE EXCEPTION '(2) coercition : %', majordhome.webshop_reglages(v_autre);
  END IF;
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop}', '{"palette":{"delai_fermeture_jours":3}}') WHERE id = v_autre;
  IF majordhome.webshop_reglages(v_autre)->'palette'->>'delai_fermeture_jours' <> '3' THEN RAISE EXCEPTION '(2) délai 3 non lu'; END IF;

  -- (3) Heure d'envoi = heure de Paris (18 h : 16 h UTC en CEST, 17 h UTC en CET)
  UPDATE core.organizations SET settings = jsonb_set(COALESCE(settings, '{}'), '{webshop}', '{"site_url":"https://www.mayer-energie.fr"}') WHERE id = v_mayer;
  IF majordhome.webshop_should_send(v_mayer, '2026-10-24 16:00+00') IS NOT TRUE THEN RAISE EXCEPTION '(3) 24/10 16 h UTC attendu vrai'; END IF;
  IF majordhome.webshop_should_send(v_mayer, '2026-10-24 17:00+00') IS NOT FALSE THEN RAISE EXCEPTION '(3) 24/10 17 h UTC attendu faux'; END IF;
  IF majordhome.webshop_should_send(v_mayer, '2026-10-25 17:00+00') IS NOT TRUE THEN RAISE EXCEPTION '(3) 25/10 17 h UTC attendu vrai'; END IF;
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop,palette}', '{"envoi_auto":false}') WHERE id = v_mayer;
  IF majordhome.webshop_should_send(v_mayer, '2026-10-24 16:00+00') IS NOT FALSE THEN RAISE EXCEPTION '(3) envoi_auto=false attendu faux'; END IF;

  -- (4) Fermeture par org selon son propre délai (Mayer 3, autre org 2)
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop,palette}', '{"delai_fermeture_jours":3}') WHERE id = v_mayer;
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop,palette}', '{"delai_fermeture_jours":2}') WHERE id = v_autre;
  SELECT id INTO v_sect_m FROM majordhome.webshop_sectors WHERE org_id = v_mayer ORDER BY code LIMIT 1;
  IF v_sect_m IS NULL THEN RAISE EXCEPTION 'fixture : aucun secteur Mayer'; END IF;
  INSERT INTO majordhome.webshop_delivery_slots (org_id, sector_id, delivery_date, capacity_stops) VALUES (v_mayer, v_sect_m, v_d + 3, 5) RETURNING id INTO v_s3;
  INSERT INTO majordhome.webshop_delivery_slots (org_id, sector_id, delivery_date, capacity_stops) VALUES (v_mayer, v_sect_m, v_d + 4, 5) RETURNING id INTO v_s4;
  INSERT INTO majordhome.webshop_delivery_slots (org_id, sector_id, delivery_date, capacity_stops, status, close_reason, closed_at)
    VALUES (v_mayer, v_sect_m, v_d + 5, 5, 'closed', 'manual', now() - interval '1 day') RETURNING id INTO v_s5;
  INSERT INTO majordhome.webshop_sectors (org_id, code, label, max_stops, recurrence, is_active)
    VALUES (v_autre, 'rehearsal_a', 'Répétition A', 6, '[{"week":1,"weekday":1}]', true) RETURNING id INTO v_sect_a;
  INSERT INTO majordhome.webshop_delivery_slots (org_id, sector_id, delivery_date, capacity_stops) VALUES (v_autre, v_sect_a, v_d + 2, 5) RETURNING id INTO v_a2;
  INSERT INTO majordhome.webshop_delivery_slots (org_id, sector_id, delivery_date, capacity_stops) VALUES (v_autre, v_sect_a, v_d + 3, 5) RETURNING id INTO v_a3;
  PERFORM public.webshop_close_due_slots(v_d);
  IF (SELECT status || '/' || close_reason FROM majordhome.webshop_delivery_slots WHERE id = v_s3) <> 'closed/j_minus_2' THEN RAISE EXCEPTION '(4) Mayer J+3 non fermée'; END IF;
  IF (SELECT status FROM majordhome.webshop_delivery_slots WHERE id = v_s4) <> 'open' THEN RAISE EXCEPTION '(4) Mayer J+4 fermée'; END IF;
  IF (SELECT status || '/' || close_reason FROM majordhome.webshop_delivery_slots WHERE id = v_s5) <> 'closed/manual' THEN RAISE EXCEPTION '(4) Mayer J+5 modifiée'; END IF;
  IF (SELECT status FROM majordhome.webshop_delivery_slots WHERE id = v_a2) <> 'closed' THEN RAISE EXCEPTION '(4) autre org J+2 non fermée'; END IF;
  IF (SELECT status FROM majordhome.webshop_delivery_slots WHERE id = v_a3) <> 'open' THEN RAISE EXCEPTION '(4) autre org J+3 fermée (délai de Mayer appliqué)'; END IF;

  -- (5) Génération : horizon, capacité et ancre de l'org quand l'appelant ne les donne pas
  DELETE FROM majordhome.webshop_delivery_slots WHERE org_id = v_autre;
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop,palette}',
    '{"horizon_semaines":2,"capacite_emplacements":7,"ancre_cycle":"2030-03-11"}') WHERE id = v_autre;
  INSERT INTO majordhome.webshop_sectors (org_id, code, label, max_stops, recurrence, is_active)
    VALUES (v_autre, 'rehearsal_b', 'Répétition B', 4,
            '[{"week":1,"weekday":3},{"week":2,"weekday":3},{"week":3,"weekday":3},{"week":4,"weekday":3}]', true) RETURNING id INTO v_sect_b;
  v_n := public.webshop_generate_slots(v_autre, p_from => v_d);
  SELECT string_agg(delivery_date::text, ',' ORDER BY delivery_date) INTO v_dates FROM majordhome.webshop_delivery_slots WHERE org_id = v_autre;
  -- secteur A (semaine 1 du cycle ancré au 11/03, lundi) : 11/03 seul ; secteur B (mercredis) : 06/03, 13/03 — pas le 20/03 (horizon 2)
  IF v_n <> 3 OR v_dates <> '2030-03-06,2030-03-11,2030-03-13' THEN RAISE EXCEPTION '(5) créneaux générés : % (%)', v_n, v_dates; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.webshop_delivery_slots WHERE org_id = v_autre AND capacity_slots <> 7) THEN RAISE EXCEPTION '(5) capacité de l''org non appliquée'; END IF;
  PERFORM public.webshop_insert_slots(v_autre, jsonb_build_array(jsonb_build_object('sector_id', v_sect_b, 'delivery_date', '2030-04-03', 'capacity_stops', 4)));
  IF (SELECT capacity_slots FROM majordhome.webshop_delivery_slots WHERE sector_id = v_sect_b AND delivery_date = '2030-04-03') <> 7 THEN
    RAISE EXCEPTION '(5) insert_slots : capacité par défaut de l''org non appliquée';
  END IF;

  -- (6) Envoi manuel sans site_url → site_url_missing
  SELECT user_id INTO v_tl FROM core.organization_members WHERE org_id = v_mayer AND role IN ('org_admin','team_leader') AND user_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_slot FROM majordhome.webshop_delivery_slots WHERE org_id = v_mayer AND status IN ('open','closed') ORDER BY delivery_date DESC LIMIT 1;
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop,site_url}', '""') WHERE id = v_mayer;
  PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.webshop_slot_send_now(v_slot); RAISE EXCEPTION 'KO: envoi sans site_url accepté';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'site_url_missing' THEN RAISE EXCEPTION '(6) attendu site_url_missing, reçu %', SQLERRM; END IF; END;
  RESET ROLE;

  -- (7) Cron horaire : n'envoie qu'aux orgs à l'heure, URL du réglage (sans « / » final), org_id dans le body
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop}',
    jsonb_build_object('site_url', 'https://exemple.test/', 'palette', jsonb_build_object('envoi_auto', true, 'heure_envoi', v_heure))) WHERE id = v_mayer;
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop}',
    jsonb_build_object('site_url', 'https://autre.test', 'palette', jsonb_build_object('envoi_auto', true, 'heure_envoi', (v_heure + 1) % 24))) WHERE id = v_autre;
  DELETE FROM vault.decrypted_secrets WHERE name = 'webshop_cron_secret';
  v_res := public.webshop_run_daily_tours(v_d);
  IF v_res NOT LIKE '%secret%' OR EXISTS (SELECT 1 FROM net.rehearsal_calls) THEN RAISE EXCEPTION '(7a) sans secret : %', v_res; END IF;
  INSERT INTO vault.decrypted_secrets VALUES ('webshop_cron_secret', 'rehearsal-secret');
  v_res := public.webshop_run_daily_tours(v_d);
  IF (SELECT count(*) FROM net.rehearsal_calls) <> 1 THEN RAISE EXCEPTION '(7b) % appel(s) : %', (SELECT count(*) FROM net.rehearsal_calls), v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM net.rehearsal_calls WHERE url = 'https://exemple.test/api/boutique/cron/tournees'
                   AND body->>'org_id' = v_mayer::text AND body->>'today' = v_d::text
                   AND headers->>'Authorization' = 'Bearer rehearsal-secret') THEN
    RAISE EXCEPTION '(7b) appel incorrect : %', (SELECT json_agg(c) FROM net.rehearsal_calls c);
  END IF;
  UPDATE core.organizations SET settings = jsonb_set(settings, '{webshop,site_url}', '""') WHERE id = v_mayer;
  v_res := public.webshop_run_daily_tours(v_d);
  IF v_res NOT LIKE '%site_url%' OR (SELECT count(*) FROM net.rehearsal_calls) <> 1 THEN RAISE EXCEPTION '(7c) sans site_url : %', v_res; END IF;

  RAISE NOTICE 'assert-webshop-reglages B (réglages lus) : OK';
END $$;
ROLLBACK;
