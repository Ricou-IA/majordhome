-- assert-webshop-reglages-listes.sql — vérifie 20261017_2_webshop_reglages_listes.sql.
-- Prérequis du run : 20261013_2 puis 20261017_1 rejouées AVANT 20261017_2 (cf. rapport Task 3).
-- Modifie les données du cluster : à lancer en DERNIER (ou seul).

-- Outil : appelle p_sql sous l'identité p_uid (NULL = anonyme) avec le rôle authenticated.
-- Renvoie NULL si l'appel passe, sinon 'message|detail'. Les effets d'un appel réussi restent.
CREATE OR REPLACE FUNCTION pg_temp.ws_try(p_uid uuid, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_msg text; v_detail text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    RESET ROLE;
    RETURN v_msg || '|' || COALESCE(v_detail, '');
  END;
END $$;

-- Exécute p_sql (SELECT d'une valeur) en admin et renvoie la valeur texte.
CREATE OR REPLACE FUNCTION pg_temp.ws_val(p_uid uuid, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
END $$;

-- ── A. Structure et privilèges ───────────────────────────────────────────────
DO $$
DECLARE
  f text;
  v_fns text[] := ARRAY[
    'public.webshop_sector_upsert(uuid, jsonb)',
    'public.webshop_sector_set_postcodes(uuid, jsonb)',
    'public.webshop_regenerate_future_slots(uuid)',
    'public.webshop_shipping_rate_upsert(uuid, jsonb)',
    'public.webshop_shipping_rate_delete(uuid)',
    'public.webshop_pickup_point_upsert(uuid, jsonb)'];
BEGIN
  FOREACH f IN ARRAY v_fns LOOP
    IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION 'fonction absente : %', f; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION 'anon peut exécuter %', f; END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION 'authenticated ne peut pas exécuter %', f; END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN RAISE EXCEPTION '% n''est pas SECURITY DEFINER', f; END IF;
  END LOOP;
  f := 'majordhome.webshop_require_org_admin(uuid)';
  IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION 'fonction absente : %', f; END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'garde interne exécutable par anon/authenticated'; END IF;
  RAISE NOTICE 'assert-webshop-reglages-listes A (structure) : OK';
END $$;

-- ── B. Refus : anonyme, membre non admin, admin d'une autre org ─────────────
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_member uuid; v_other_admin uuid; v_sector uuid; v_rate uuid; r text; who uuid; i int;
  v_calls text[];
BEGIN
  SELECT user_id INTO v_member FROM core.organization_members
   WHERE org_id = v_org AND role <> 'org_admin' AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_other_admin FROM core.organization_members m
   WHERE org_id <> v_org AND role = 'org_admin' AND user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.organization_members x WHERE x.user_id = m.user_id AND x.org_id = v_org) LIMIT 1;
  SELECT id INTO v_sector FROM majordhome.webshop_sectors WHERE org_id = v_org ORDER BY code LIMIT 1;
  SELECT id INTO v_rate FROM majordhome.webshop_shipping_rates WHERE org_id = v_org LIMIT 1;
  IF v_member IS NULL OR v_other_admin IS NULL OR v_sector IS NULL OR v_rate IS NULL THEN
    RAISE EXCEPTION 'fixture B incomplète (membre %, admin autre org %, secteur %, tarif %)', v_member, v_other_admin, v_sector, v_rate;
  END IF;

  v_calls := ARRAY[
    format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org, jsonb_build_object('code','zz-test','label','Test','max_stops',5)),
    format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org, jsonb_build_object('id', v_sector, 'label','Piraté')),
    format('SELECT public.webshop_sector_set_postcodes(%L, %L::jsonb)', v_sector, '[]'),
    format('SELECT public.webshop_regenerate_future_slots(%L)', v_org),
    format('SELECT public.webshop_shipping_rate_upsert(%L, %L::jsonb)', v_org, jsonb_build_object('label','X','min_weight_kg',0,'price_ttc',1)),
    format('SELECT public.webshop_shipping_rate_upsert(%L, %L::jsonb)', v_org, jsonb_build_object('id', v_rate, 'price_ttc', 0)),
    format('SELECT public.webshop_shipping_rate_delete(%L)', v_rate),
    format('SELECT public.webshop_pickup_point_upsert(%L, %L::jsonb)', v_org, jsonb_build_object('slug','zz-test','name','X','address','Y'))];

  FOR i IN 1 .. array_length(v_calls, 1) LOOP
    FOREACH who IN ARRAY ARRAY[NULL::uuid, v_member, v_other_admin] LOOP
      r := pg_temp.ws_try(who, v_calls[i]);
      IF r IS NULL OR split_part(r, '|', 1) <> 'org_admin_required' THEN
        RAISE EXCEPTION 'appel % sous % : attendu org_admin_required, obtenu %', i, COALESCE(who::text, 'anonyme'), COALESCE(r, 'succès');
      END IF;
    END LOOP;
  END LOOP;

  -- L'admin d'une autre org qui passe SON org_id avec l'id d'un secteur Mayer : l'org de la ligne fait foi.
  r := pg_temp.ws_try(v_other_admin, format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)',
         (SELECT org_id FROM core.organization_members WHERE user_id = v_other_admin AND role = 'org_admin' LIMIT 1),
         jsonb_build_object('id', v_sector, 'label', 'Piraté')));
  IF r IS NULL OR split_part(r, '|', 1) <> 'org_admin_required' THEN RAISE EXCEPTION 'secteur Mayer modifiable via une autre org : %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_other_admin, format('SELECT public.webshop_shipping_rate_upsert(%L, %L::jsonb)',
         (SELECT org_id FROM core.organization_members WHERE user_id = v_other_admin AND role = 'org_admin' LIMIT 1),
         jsonb_build_object('id', v_rate, 'price_ttc', 0)));
  IF r IS NULL OR split_part(r, '|', 1) <> 'org_admin_required' THEN RAISE EXCEPTION 'tarif Mayer modifiable via une autre org : %', COALESCE(r,'succès'); END IF;

  -- Rien n'a bougé
  IF EXISTS (SELECT 1 FROM majordhome.webshop_sectors WHERE label = 'Piraté' OR code = 'zz-test') THEN RAISE EXCEPTION 'écriture secteur malgré refus'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.webshop_shipping_rates WHERE id = v_rate AND price_ttc > 0) THEN RAISE EXCEPTION 'tarif modifié/supprimé malgré refus'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.webshop_pickup_points WHERE slug = 'zz-test') THEN RAISE EXCEPTION 'point créé malgré refus'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-webshop-reglages-listes B (refus) : OK';
END $$;

-- ── C. Secteurs : création, mise à jour, validations ─────────────────────────
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_id uuid; v_s majordhome.webshop_sectors; v_s1 uuid; r text; v_old_label text;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_org AND role = 'org_admin' AND user_id IS NOT NULL LIMIT 1;

  -- création sans prix → prix par défaut du réglage (5500), dépôt absent → 1er dépôt du réglage
  v_id := pg_temp.ws_val(v_admin, format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org,
            '{"code":"zz-S10","label":"Secteur test","max_stops":6,"recurrence":[{"week":1,"weekday":2},{"week":3,"weekday":4}]}'))::uuid;
  SELECT * INTO v_s FROM majordhome.webshop_sectors WHERE id = v_id;
  IF v_s.org_id <> v_org OR v_s.slot_price_ttc_cents <> 5500 OR v_s.depot <> 'castanet' OR v_s.max_stops <> 6
     OR v_s.max_minutes <> 540 OR v_s.max_km <> 350 OR v_s.slots_per_cycle <> 2 OR NOT v_s.is_active
     OR jsonb_array_length(v_s.recurrence) <> 2 THEN
    RAISE EXCEPTION 'création secteur incorrecte : %', row_to_json(v_s);
  END IF;

  -- réglage prix par défaut lu (et non la valeur 5500 en dur)
  UPDATE core.organizations SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{webshop}',
    COALESCE(settings->'webshop','{}'::jsonb) || '{"palette":{"prix_emplacement_defaut_cents":6100}}'::jsonb) WHERE id = v_org;
  v_id := pg_temp.ws_val(v_admin, format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org,
            '{"code":"zz-S11","label":"Secteur test 2","max_stops":4}'))::uuid;
  IF (SELECT slot_price_ttc_cents FROM majordhome.webshop_sectors WHERE id = v_id) <> 6100 THEN
    RAISE EXCEPTION 'le prix par défaut du réglage n''est pas appliqué'; END IF;
  UPDATE core.organizations SET settings = settings #- '{webshop,palette}' WHERE id = v_org;

  -- mise à jour partielle : seules les clés fournies changent ; org passée ignorée
  SELECT * INTO v_s FROM majordhome.webshop_sectors WHERE org_id = v_org AND code = 'castanet-S1';
  v_s1 := v_s.id; v_old_label := v_s.label;
  PERFORM pg_temp.ws_val(v_admin, format('SELECT public.webshop_sector_upsert(NULL, %L::jsonb)',
            jsonb_build_object('id', v_s1, 'max_km', 400, 'recurrence', '[{"week":2,"weekday":5}]'::jsonb)));
  SELECT * INTO v_s FROM majordhome.webshop_sectors WHERE id = v_s1;
  IF v_s.max_km <> 400 OR v_s.label <> v_old_label OR v_s.recurrence <> '[{"week":2,"weekday":5}]'::jsonb THEN
    RAISE EXCEPTION 'mise à jour partielle incorrecte : %', row_to_json(v_s); END IF;

  -- validations
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org,
         '{"code":"zz-S12","label":"X","max_stops":3,"recurrence":[{"week":5,"weekday":1}]}'));
  IF split_part(COALESCE(r,''), '|', 1) <> 'invalid_recurrence' THEN RAISE EXCEPTION 'week 5 : attendu invalid_recurrence, obtenu %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_upsert(NULL, %L::jsonb)',
         jsonb_build_object('id', v_s1, 'recurrence', '[{"week":1,"weekday":6}]'::jsonb)));
  IF split_part(COALESCE(r,''), '|', 1) <> 'invalid_recurrence' THEN RAISE EXCEPTION 'weekday 6 : attendu invalid_recurrence, obtenu %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_upsert(NULL, %L::jsonb)',
         jsonb_build_object('id', v_s1, 'recurrence', '{"week":1}'::jsonb)));
  IF split_part(COALESCE(r,''), '|', 1) <> 'invalid_recurrence' THEN RAISE EXCEPTION 'objet : attendu invalid_recurrence, obtenu %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org,
         '{"code":"zz-S13","label":"X","max_stops":3,"depot":"inconnu"}'));
  IF split_part(COALESCE(r,''), '|', 1) <> 'depot_unknown' THEN RAISE EXCEPTION 'dépôt inconnu : attendu depot_unknown, obtenu %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_upsert(%L, %L::jsonb)', v_org,
         '{"code":"zz-S14","label":"X"}'));
  IF split_part(COALESCE(r,''), '|', 1) <> 'invalid_value' OR split_part(r, '|', 2) <> 'max_stops' THEN
    RAISE EXCEPTION 'max_stops absent : attendu invalid_value|max_stops, obtenu %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_upsert(NULL, %L::jsonb)',
         jsonb_build_object('id', v_s1, 'code', 'autre-code')));
  IF split_part(COALESCE(r,''), '|', 1) <> 'immutable_field' THEN RAISE EXCEPTION 'code modifié : attendu immutable_field, obtenu %', COALESCE(r,'succès'); END IF;
  IF EXISTS (SELECT 1 FROM majordhome.webshop_sectors WHERE code IN ('zz-S12','zz-S13','zz-S14')) THEN RAISE EXCEPTION 'secteur créé malgré une erreur'; END IF;

  -- désactivation
  PERFORM pg_temp.ws_val(v_admin, format('SELECT public.webshop_sector_upsert(NULL, %L::jsonb)', jsonb_build_object('id', v_id, 'is_active', false)));
  IF (SELECT is_active FROM majordhome.webshop_sectors WHERE id = v_id) THEN RAISE EXCEPTION 'désactivation non appliquée'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-webshop-reglages-listes C (secteurs) : OK';
END $$;

-- ── D. Codes postaux : remplacement atomique, postcode_taken ─────────────────
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_s1 uuid; v_s2 uuid; v_s2_code text; v_rows jsonb; v_before int; v_n int; r text;
  v_foreign jsonb; v_cp text;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_org AND role = 'org_admin' AND user_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_s1 FROM majordhome.webshop_sectors WHERE org_id = v_org AND code = 'castanet-S1';
  SELECT id, code INTO v_s2, v_s2_code FROM majordhome.webshop_sectors WHERE org_id = v_org AND code = 'castanet-S2';
  SELECT count(*), jsonb_agg(jsonb_build_object('postal_code', postal_code, 'insee_code', insee_code, 'commune', commune) ORDER BY postal_code, insee_code)
    INTO v_before, v_rows FROM majordhome.webshop_sector_postcodes WHERE sector_id = v_s1;
  IF v_before = 0 THEN RAISE EXCEPTION 'fixture D : castanet-S1 sans code postal'; END IF;
  SELECT jsonb_build_object('postal_code', postal_code, 'insee_code', insee_code, 'commune', commune), postal_code
    INTO v_foreign, v_cp FROM majordhome.webshop_sector_postcodes WHERE sector_id = v_s2 LIMIT 1;

  -- INSEE d'un autre secteur → refus, DETAIL = code du secteur occupant, table inchangée
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_set_postcodes(%L, %L::jsonb)', v_s1, v_rows || jsonb_build_array(v_foreign)));
  IF r IS NULL OR r <> 'postcode_taken|' || v_s2_code THEN RAISE EXCEPTION 'INSEE pris : attendu postcode_taken|%, obtenu %', v_s2_code, COALESCE(r,'succès'); END IF;
  IF (SELECT count(*) FROM majordhome.webshop_sector_postcodes WHERE sector_id = v_s1) <> v_before THEN RAISE EXCEPTION 'S1 modifié malgré postcode_taken'; END IF;

  -- CP sans INSEE déjà rattaché à un autre secteur → refus
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_set_postcodes(%L, %L::jsonb)', v_s1,
         v_rows || jsonb_build_array(jsonb_build_object('postal_code', v_cp, 'insee_code', '', 'commune', 'X'))));
  IF r IS NULL OR r <> 'postcode_taken|' || v_s2_code THEN RAISE EXCEPTION 'CP pris : attendu postcode_taken|%, obtenu %', v_s2_code, COALESCE(r,'succès'); END IF;

  -- CP invalide
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_sector_set_postcodes(%L, %L::jsonb)', v_s1, '[{"postal_code":"","insee_code":"81099","commune":"X"}]'));
  IF split_part(COALESCE(r,''), '|', 1) <> 'invalid_value' THEN RAISE EXCEPTION 'CP vide : attendu invalid_value, obtenu %', COALESCE(r,'succès'); END IF;

  -- remplacement : retirer une ligne, doublon dans l'entrée toléré
  v_n := pg_temp.ws_val(v_admin, format('SELECT public.webshop_sector_set_postcodes(%L, %L::jsonb)', v_s1,
           (v_rows - 0) || jsonb_build_array(v_rows -> 1)))::int;
  IF v_n <> v_before - 1 OR (SELECT count(*) FROM majordhome.webshop_sector_postcodes WHERE sector_id = v_s1) <> v_before - 1 THEN
    RAISE EXCEPTION 'remplacement : % renvoyé, % en base, attendu %', v_n,
      (SELECT count(*) FROM majordhome.webshop_sector_postcodes WHERE sector_id = v_s1), v_before - 1; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.webshop_sector_postcodes WHERE sector_id = v_s1 AND org_id <> v_org) THEN RAISE EXCEPTION 'org_id incorrect sur les codes postaux'; END IF;
  -- restauration
  v_n := pg_temp.ws_val(v_admin, format('SELECT public.webshop_sector_set_postcodes(%L, %L::jsonb)', v_s1, v_rows))::int;
  IF v_n <> v_before THEN RAISE EXCEPTION 'restauration : % au lieu de %', v_n, v_before; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-webshop-reglages-listes D (codes postaux) : OK';
END $$;

-- ── E. Régénération des créneaux à venir ─────────────────────────────────────
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_today date := (now() AT TIME ZONE 'Europe/Paris')::date; v_delai int;
  v_sector uuid; v_with_order uuid; v_closed uuid; v_plain majordhome.webshop_delivery_slots; v_stray uuid; v_near uuid;
  v_total_before int; v_deletable int; v_total_after int; v_res jsonb; v_order uuid;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_org AND role = 'org_admin' AND user_id IS NOT NULL LIMIT 1;
  v_delai := (majordhome.webshop_reglages(v_org) -> 'palette' ->> 'delai_fermeture_jours')::int;
  SELECT id INTO v_sector FROM majordhome.webshop_sectors WHERE org_id = v_org AND code = 'castanet-S5';
  -- garantir des créneaux futurs pour S5 (le snapshot peut être court)
  PERFORM public.webshop_generate_slots(v_org, 8, v_today + v_delai + 1);

  -- 1 créneau futur avec une commande rattachée, 1 fermé, 1 ouvert vide (récurrent)
  SELECT id INTO v_with_order FROM majordhome.webshop_delivery_slots
   WHERE sector_id = v_sector AND status = 'open' AND delivery_date > v_today + v_delai ORDER BY delivery_date LIMIT 1;
  SELECT id INTO v_closed FROM majordhome.webshop_delivery_slots
   WHERE sector_id = v_sector AND status = 'open' AND delivery_date > v_today + v_delai AND id <> v_with_order ORDER BY delivery_date LIMIT 1;
  SELECT * INTO v_plain FROM majordhome.webshop_delivery_slots
   WHERE sector_id = v_sector AND status = 'open' AND delivery_date > v_today + v_delai AND id NOT IN (v_with_order, v_closed) ORDER BY delivery_date LIMIT 1;
  IF v_with_order IS NULL OR v_closed IS NULL OR v_plain.id IS NULL THEN RAISE EXCEPTION 'fixture E : pas assez de créneaux futurs pour S5'; END IF;
  SELECT id INTO v_order FROM majordhome.webshop_orders ORDER BY order_number LIMIT 1;
  UPDATE majordhome.webshop_orders SET requested_slot_id = v_with_order WHERE id = v_order;
  UPDATE majordhome.webshop_delivery_slots SET status = 'closed', close_reason = 'manual', closed_at = now() WHERE id = v_closed;
  -- créneau hors récurrence (un dimanche futur) : supprimé et non recréé
  INSERT INTO majordhome.webshop_delivery_slots (org_id, sector_id, delivery_date, capacity_stops)
  VALUES (v_org, v_sector, (v_today + v_delai + 15) - extract(isodow FROM v_today + v_delai + 15)::int + 7, 5)
  ON CONFLICT DO NOTHING RETURNING id INTO v_stray;
  -- créneau ouvert vide DANS la fenêtre de fermeture : intouché
  INSERT INTO majordhome.webshop_delivery_slots (org_id, sector_id, delivery_date, capacity_stops)
  VALUES (v_org, v_sector, v_today + v_delai, 5)
  ON CONFLICT (sector_id, delivery_date) DO UPDATE SET status = majordhome.webshop_delivery_slots.status RETURNING id INTO v_near;
  IF v_stray IS NULL THEN RAISE EXCEPTION 'fixture E : créneau dimanche non inséré'; END IF;

  SELECT count(*) INTO v_total_before FROM majordhome.webshop_delivery_slots WHERE org_id = v_org;
  SELECT count(*) INTO v_deletable FROM majordhome.webshop_delivery_slots s
   WHERE s.org_id = v_org AND s.status = 'open' AND s.delivery_date > v_today + v_delai AND s.used_slots = 0
     AND NOT EXISTS (SELECT 1 FROM majordhome.webshop_orders o WHERE o.delivery_slot_id = s.id OR o.requested_slot_id = s.id);

  v_res := pg_temp.ws_val(v_admin, format('SELECT public.webshop_regenerate_future_slots(%L)::text', v_org))::jsonb;
  SELECT count(*) INTO v_total_after FROM majordhome.webshop_delivery_slots WHERE org_id = v_org;

  IF (v_res ->> 'supprimes')::int <> v_deletable THEN RAISE EXCEPTION 'supprimes = % au lieu de %', v_res ->> 'supprimes', v_deletable; END IF;
  IF v_total_after <> v_total_before - v_deletable + (v_res ->> 'crees')::int THEN
    RAISE EXCEPTION 'compteurs incohérents : avant %, supprimés %, créés %, après %', v_total_before, v_deletable, v_res ->> 'crees', v_total_after; END IF;
  IF (v_res ->> 'crees')::int < 1 THEN RAISE EXCEPTION 'aucun créneau recréé'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.webshop_delivery_slots WHERE id = v_with_order) THEN RAISE EXCEPTION 'créneau avec commande supprimé'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.webshop_delivery_slots WHERE id = v_closed AND status = 'closed') THEN RAISE EXCEPTION 'créneau fermé supprimé'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.webshop_delivery_slots WHERE id = v_near) THEN RAISE EXCEPTION 'créneau dans la fenêtre de fermeture supprimé'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.webshop_delivery_slots WHERE id = v_stray)
     OR EXISTS (SELECT 1 FROM majordhome.webshop_delivery_slots WHERE sector_id = v_sector AND extract(isodow FROM delivery_date) = 7) THEN
    RAISE EXCEPTION 'créneau hors récurrence conservé ou recréé'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.webshop_delivery_slots WHERE id = v_plain.id) THEN RAISE EXCEPTION 'créneau ouvert vide non supprimé'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.webshop_delivery_slots WHERE sector_id = v_sector AND delivery_date = v_plain.delivery_date AND status = 'open' AND used_slots = 0) THEN
    RAISE EXCEPTION 'créneau ouvert vide non recréé (%)', v_plain.delivery_date; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-webshop-reglages-listes E (régénération : %) : OK', v_res;
END $$;

-- ── F. Tarifs colis et points de retrait ────────────────────────────────────
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_rate uuid; v_point uuid; r text; v_rt majordhome.webshop_shipping_rates; v_pp majordhome.webshop_pickup_points;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_org AND role = 'org_admin' AND user_id IS NOT NULL LIMIT 1;

  v_rate := pg_temp.ws_val(v_admin, format('SELECT public.webshop_shipping_rate_upsert(%L, %L::jsonb)', v_org,
              '{"label":"Colis 30 à 50 kg","min_weight_kg":30,"max_weight_kg":50,"price_ttc":39.9}'))::uuid;
  SELECT * INTO v_rt FROM majordhome.webshop_shipping_rates WHERE id = v_rate;
  IF v_rt.org_id <> v_org OR v_rt.price_ttc <> 39.9 OR v_rt.max_weight_kg <> 50 OR NOT v_rt.is_active THEN RAISE EXCEPTION 'tarif créé incorrect : %', row_to_json(v_rt); END IF;
  PERFORM pg_temp.ws_val(v_admin, format('SELECT public.webshop_shipping_rate_upsert(NULL, %L::jsonb)',
            jsonb_build_object('id', v_rate, 'max_weight_kg', NULL, 'price_ttc', 44)));
  SELECT * INTO v_rt FROM majordhome.webshop_shipping_rates WHERE id = v_rate;
  IF v_rt.price_ttc <> 44 OR v_rt.max_weight_kg IS NOT NULL OR v_rt.label <> 'Colis 30 à 50 kg' THEN RAISE EXCEPTION 'tarif mis à jour incorrect : %', row_to_json(v_rt); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_shipping_rate_upsert(NULL, %L::jsonb)', jsonb_build_object('id', v_rate, 'max_weight_kg', 10)));
  IF split_part(COALESCE(r,''), '|', 1) <> 'invalid_value' THEN RAISE EXCEPTION 'max < min : attendu invalid_value, obtenu %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_shipping_rate_upsert(%L, %L::jsonb)', v_org, '{"label":"X","min_weight_kg":0,"price_ttc":-1}'));
  IF split_part(COALESCE(r,''), '|', 1) <> 'invalid_value' THEN RAISE EXCEPTION 'prix négatif : attendu invalid_value, obtenu %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_shipping_rate_delete(%L)', v_rate));
  IF r IS NOT NULL OR EXISTS (SELECT 1 FROM majordhome.webshop_shipping_rates WHERE id = v_rate) THEN RAISE EXCEPTION 'suppression du tarif : %', COALESCE(r,'ligne toujours là'); END IF;

  v_point := pg_temp.ws_val(v_admin, format('SELECT public.webshop_pickup_point_upsert(%L, %L::jsonb)', v_org,
               '{"slug":"zz-albi","name":"Point Albi","address":"1 rue X, 81000 Albi","accepts":"parcel"}'))::uuid;
  SELECT * INTO v_pp FROM majordhome.webshop_pickup_points WHERE id = v_point;
  IF v_pp.org_id <> v_org OR v_pp.accepts <> 'parcel' OR NOT v_pp.is_active THEN RAISE EXCEPTION 'point créé incorrect : %', row_to_json(v_pp); END IF;
  PERFORM pg_temp.ws_val(v_admin, format('SELECT public.webshop_pickup_point_upsert(NULL, %L::jsonb)', jsonb_build_object('id', v_point, 'is_active', false, 'opening_hours', 'Lun-Ven 8h-12h')));
  SELECT * INTO v_pp FROM majordhome.webshop_pickup_points WHERE id = v_point;
  IF v_pp.is_active OR v_pp.opening_hours <> 'Lun-Ven 8h-12h' OR v_pp.name <> 'Point Albi' THEN RAISE EXCEPTION 'point mis à jour incorrect : %', row_to_json(v_pp); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_pickup_point_upsert(%L, %L::jsonb)', v_org, '{"slug":"zz-albi","name":"Doublon","address":"Y"}'));
  IF split_part(COALESCE(r,''), '|', 1) <> 'slug_taken' THEN RAISE EXCEPTION 'slug en double : attendu slug_taken, obtenu %', COALESCE(r,'succès'); END IF;
  r := pg_temp.ws_try(v_admin, format('SELECT public.webshop_pickup_point_upsert(NULL, %L::jsonb)', jsonb_build_object('id', v_point, 'accepts', 'drone')));
  IF split_part(COALESCE(r,''), '|', 1) <> 'invalid_value' THEN RAISE EXCEPTION 'accepts invalide : attendu invalid_value, obtenu %', COALESCE(r,'succès'); END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-webshop-reglages-listes F (tarifs, points de retrait) : OK';
END $$;
