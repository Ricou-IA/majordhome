-- assert-webshop-listes-ecriture-admin.sql — vérifie 20261018_1_webshop_listes_ecriture_admin.sql.
-- Prérequis du run : 20261013_2, 20261017_1, 20261017_2 puis 20261018_1.
-- A : privilèges et policies. B : un membre lit mais n'écrit plus en direct (table ET vue publique).
-- C : les RPC org_admin de 20261017_2 et un geste de tournée (20261013_2) écrivent toujours.
-- B et C tournent dans une transaction annulée.

-- ── A. Structure ─────────────────────────────────────────────────────────────
DO $$
DECLARE t text; r text; n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['webshop_sectors', 'webshop_sector_postcodes', 'webshop_shipping_rates',
                           'webshop_pickup_points', 'webshop_delivery_slots'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(r, 'majordhome.' || t, 'INSERT') OR has_table_privilege(r, 'majordhome.' || t, 'UPDATE')
         OR has_table_privilege(r, 'majordhome.' || t, 'DELETE') THEN
        RAISE EXCEPTION '% garde un droit d''écriture sur majordhome.%', r, t;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', 'majordhome.' || t, 'SELECT') THEN RAISE EXCEPTION 'authenticated ne lit plus majordhome.%', t; END IF;
    -- DELETE non contrôlé : bootstrap-post.sql n'accorde à service_role que SELECT/INSERT/UPDATE
    -- (prod : arwd). La migration ne nomme jamais service_role.
    IF NOT (has_table_privilege('service_role', 'majordhome.' || t, 'SELECT') AND has_table_privilege('service_role', 'majordhome.' || t, 'INSERT')
            AND has_table_privilege('service_role', 'majordhome.' || t, 'UPDATE')) THEN
      RAISE EXCEPTION 'service_role a perdu un droit sur majordhome.% (le site écrit avec)', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('majordhome.' || t)::regclass) THEN RAISE EXCEPTION 'RLS désactivée sur %', t; END IF;
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = t AND cmd <> 'SELECT';
    IF n <> 0 THEN RAISE EXCEPTION '% policy(ies) d''écriture restante(s) sur %', n, t; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = t
                    AND policyname = t || '_select_org_members' AND cmd = 'SELECT' AND roles = '{authenticated}') THEN
      RAISE EXCEPTION 'policy SELECT membres absente sur %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'assert-webshop-listes-ecriture-admin A (structure) : OK';
END $$;

BEGIN;

-- Appelle p_sql sous l'identité p_uid avec le rôle authenticated ; NULL si OK, sinon 'SQLSTATE|message'.
CREATE OR REPLACE FUNCTION pg_temp.wl_try(p_uid uuid, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RESET ROLE;
    RETURN v_state || '|' || v_msg;
  END;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.wl_count(p_uid uuid, p_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
END $$;

DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_member uuid; v_admin uuid; v_tl uuid;
  v_sector uuid; v_rate uuid; v_slot uuid; v_point uuid; v_new uuid;
  r text; t text; v_sql text; v_label text; v_n int;
BEGIN
  SELECT user_id INTO v_member FROM core.organization_members
   WHERE org_id = v_org AND role NOT IN ('org_admin', 'team_leader') AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_org AND role = 'org_admin' AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_tl FROM core.organization_members WHERE org_id = v_org AND role IN ('org_admin', 'team_leader') AND user_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_sector FROM majordhome.webshop_sectors WHERE org_id = v_org ORDER BY code LIMIT 1;
  SELECT id INTO v_rate FROM majordhome.webshop_shipping_rates WHERE org_id = v_org LIMIT 1;
  SELECT id INTO v_slot FROM majordhome.webshop_delivery_slots WHERE org_id = v_org AND status = 'open' ORDER BY delivery_date DESC LIMIT 1;
  -- Points de retrait : non photographiés (data: false) → un point posé par le propriétaire.
  INSERT INTO majordhome.webshop_pickup_points (org_id, slug, name, address)
    VALUES (v_org, 'rehearsal-wl', 'Point répétition', '1 rue du Test') RETURNING id INTO v_point;
  IF v_member IS NULL OR v_admin IS NULL OR v_sector IS NULL OR v_rate IS NULL OR v_slot IS NULL THEN
    RAISE EXCEPTION 'fixture incomplète (membre %, admin %, secteur %, tarif %, créneau %)', v_member, v_admin, v_sector, v_rate, v_slot;
  END IF;

  -- ── B. Membre non admin : lecture OK, écriture directe refusée (42501) ──────
  FOREACH t IN ARRAY ARRAY['webshop_sectors', 'webshop_sector_postcodes', 'webshop_shipping_rates',
                           'webshop_pickup_points', 'webshop_delivery_slots'] LOOP
    IF pg_temp.wl_count(v_member, format('SELECT count(*) FROM public.majordhome_%s WHERE org_id = %L', t, v_org)) = 0 THEN
      RAISE EXCEPTION '(B) le membre ne lit plus la vue majordhome_%', t;
    END IF;
    IF pg_temp.wl_count(v_member, format('SELECT count(*) FROM majordhome.%I WHERE org_id = %L', t, v_org)) = 0 THEN
      RAISE EXCEPTION '(B) le membre ne lit plus majordhome.%', t;
    END IF;
    FOREACH v_sql IN ARRAY ARRAY[
      format('UPDATE public.majordhome_%s SET org_id = org_id WHERE org_id = %L', t, v_org),
      format('UPDATE majordhome.%I SET org_id = org_id WHERE org_id = %L', t, v_org),
      format('DELETE FROM public.majordhome_%s WHERE org_id = %L', t, v_org),
      format('INSERT INTO public.majordhome_%s (org_id) VALUES (%L)', t, v_org)] LOOP
      r := pg_temp.wl_try(v_member, v_sql);
      IF r IS NULL OR r NOT LIKE '42501|%' THEN RAISE EXCEPTION '(B) écriture directe non refusée : % → %', v_sql, COALESCE(r, 'accepté'); END IF;
      -- Même refus pour un admin : l'écriture passe uniquement par les RPC.
      r := pg_temp.wl_try(v_admin, v_sql);
      IF r IS NULL OR r NOT LIKE '42501|%' THEN RAISE EXCEPTION '(B) écriture directe admin non refusée : % → %', v_sql, COALESCE(r, 'accepté'); END IF;
    END LOOP;
  END LOOP;
  -- Contournement visé : le statut d'une tournée hors webshop_slot_guard.
  r := pg_temp.wl_try(v_member, format('UPDATE public.majordhome_webshop_delivery_slots SET status = %L WHERE id = %L', 'cancelled', v_slot));
  IF r IS NULL OR r NOT LIKE '42501|%' THEN RAISE EXCEPTION '(B) annulation directe d''une tournée non refusée : %', COALESCE(r, 'accepté'); END IF;
  IF (SELECT status FROM majordhome.webshop_delivery_slots WHERE id = v_slot) <> 'open' THEN RAISE EXCEPTION '(B) tournée modifiée'; END IF;
  RAISE NOTICE 'assert-webshop-listes-ecriture-admin B (écriture directe refusée) : OK';

  -- ── C. Les RPC continuent d'écrire ──────────────────────────────────────────
  v_label := 'Répétition ' || left(md5(random()::text), 6);
  r := pg_temp.wl_try(v_admin, format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org, jsonb_build_object('id', v_sector, 'label', v_label)));
  IF r IS NOT NULL THEN RAISE EXCEPTION '(C) sector_upsert : %', r; END IF;
  IF (SELECT label FROM majordhome.webshop_sectors WHERE id = v_sector) <> v_label THEN RAISE EXCEPTION '(C) sector_upsert sans effet'; END IF;

  r := pg_temp.wl_try(v_admin, format('SELECT public.webshop_sector_set_postcodes(%L, %L::jsonb)', v_sector,
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('postal_code', postal_code, 'insee_code', insee_code, 'commune', commune)), '[]'::jsonb)
            FROM majordhome.webshop_sector_postcodes WHERE sector_id = v_sector)));
  IF r IS NOT NULL THEN RAISE EXCEPTION '(C) set_postcodes : %', r; END IF;

  r := pg_temp.wl_try(v_admin, format('SELECT public.webshop_shipping_rate_upsert(%L, %L::jsonb)', v_org,
         jsonb_build_object('label', 'Répétition', 'min_weight_kg', 90000, 'price_ttc', 1)));
  IF r IS NOT NULL THEN RAISE EXCEPTION '(C) shipping_rate_upsert : %', r; END IF;
  SELECT id INTO v_new FROM majordhome.webshop_shipping_rates WHERE org_id = v_org AND min_weight_kg = 90000;
  IF v_new IS NULL THEN RAISE EXCEPTION '(C) tarif non créé'; END IF;
  r := pg_temp.wl_try(v_admin, format('SELECT public.webshop_shipping_rate_delete(%L)', v_new));
  IF r IS NOT NULL OR EXISTS (SELECT 1 FROM majordhome.webshop_shipping_rates WHERE id = v_new) THEN RAISE EXCEPTION '(C) shipping_rate_delete : %', r; END IF;

  r := pg_temp.wl_try(v_admin, format('SELECT public.webshop_pickup_point_upsert(%L, %L::jsonb)', v_org,
         jsonb_build_object('id', v_point, 'name', 'Point renommé')));
  IF r IS NOT NULL OR (SELECT name FROM majordhome.webshop_pickup_points WHERE id = v_point) <> 'Point renommé' THEN
    RAISE EXCEPTION '(C) pickup_point_upsert : %', r;
  END IF;

  r := pg_temp.wl_try(v_admin, format('SELECT public.webshop_regenerate_future_slots(%L)', v_org));
  IF r IS NOT NULL THEN RAISE EXCEPTION '(C) regenerate_future_slots : %', r; END IF;

  -- Geste de tournée (20261013_2, garde team_leader+) : fermer à la main
  SELECT id INTO v_slot FROM majordhome.webshop_delivery_slots WHERE org_id = v_org AND status = 'open' ORDER BY delivery_date DESC LIMIT 1;
  r := pg_temp.wl_try(v_tl, format('SELECT public.webshop_slot_set_status(%L, %L, %L)', v_slot, 'closed', 'répétition'));
  IF r IS NOT NULL OR (SELECT status FROM majordhome.webshop_delivery_slots WHERE id = v_slot) <> 'closed' THEN
    RAISE EXCEPTION '(C) slot_set_status : %', r;
  END IF;
  -- Et le membre non admin reste refusé par la RPC org_admin
  r := pg_temp.wl_try(v_member, format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org, jsonb_build_object('id', v_sector, 'label', 'x')));
  IF r IS NULL OR r NOT LIKE '%org_admin_required%' THEN RAISE EXCEPTION '(C) membre accepté par sector_upsert : %', COALESCE(r, 'accepté'); END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-webshop-listes-ecriture-admin C (RPC) : OK';
END $$;

ROLLBACK;
