-- assert-pennylane-identity-sync.sql — vérifie 20261011_1_pennylane_customer_bidirectional_sync.sql
-- sur le cluster de répétition (pennylane_sync / pennylane_customer_lookup photographiées AVEC données).

-- ── A. ACL : service_role seul (org_id en paramètre, jamais dérivé d'auth.uid()) ─────────────
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.pennylane_customer_identity_upsert(uuid, jsonb)',
    'public.pennylane_customer_identity_get(uuid, bigint[])',
    'public.pennylane_customer_unbaselined(uuid, integer)',
    'public.pennylane_customer_delta_get_state(uuid)',
    'public.pennylane_customer_delta_set_state(uuid, timestamptz, jsonb)',
    'public.pennylane_client_set_push_state(uuid, uuid, jsonb, text)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par anon', f; END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par authenticated', f; END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION '% non exécutable par service_role', f; END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'majordhome.pennylane_customer_delta_state', 'SELECT')
     OR has_table_privilege('anon', 'majordhome.pennylane_customer_delta_state', 'SELECT') THEN
    RAISE EXCEPTION 'pennylane_customer_delta_state lisible hors service_role';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.pennylane_customer_delta_state'::regclass) THEN
    RAISE EXCEPTION 'RLS inactive sur pennylane_customer_delta_state';
  END IF;
END $$;

-- ── B. Comportement ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid; v_client uuid; v_pl bigint; v_n int; v_row record; v_meta jsonb; v_status text;
  v_unbased_before int; v_unbased_after int; v_ok boolean;
BEGIN
  SELECT s.org_id, s.local_id, s.pennylane_id INTO v_org, v_client, v_pl
    FROM majordhome.pennylane_sync s WHERE s.entity_type = 'client' LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'aucun client ponté dans le snapshot'; END IF;

  -- Toutes les lignes existantes partent SANS base fiable.
  IF EXISTS (SELECT 1 FROM majordhome.pennylane_customer_lookup WHERE identity_baseline_at IS NOT NULL) THEN
    RAISE EXCEPTION 'des lignes de cache sont marquées base fiable dès la migration';
  END IF;
  SELECT count(*) INTO v_unbased_before FROM public.pennylane_customer_unbaselined(v_org, 100000);
  IF v_unbased_before = 0 THEN RAISE EXCEPTION 'passe base : aucun customer à photographier'; END IF;

  -- 1. Upsert EXACT : une valeur présente puis absente devient NULL (le COALESCE historique ne vidait jamais).
  PERFORM public.pennylane_customer_identity_upsert(v_org, jsonb_build_array(jsonb_build_object(
    'pennylane_id', v_pl, 'name', 'TEST', 'first_name', 'A', 'last_name', 'B', 'customer_type', 'individual',
    'email', 'a@example.invalid', 'phone', '0600000001', 'address', '1 rue', 'postal_code', '81600', 'city', 'Gaillac')));
  PERFORM public.pennylane_customer_identity_upsert(v_org, jsonb_build_array(jsonb_build_object(
    'pennylane_id', v_pl, 'first_name', 'A', 'last_name', 'B', 'email', 'a@example.invalid',
    'address', '2 rue', 'postal_code', '81600', 'city', 'Gaillac')));
  SELECT * INTO v_row FROM public.pennylane_customer_identity_get(v_org, ARRAY[v_pl]);
  IF v_row.pennylane_id IS NULL THEN RAISE EXCEPTION 'base non relue après upsert'; END IF;
  IF v_row.phone IS NOT NULL THEN RAISE EXCEPTION 'upsert exact : téléphone vidé dans PL non reflété (%)', v_row.phone; END IF;
  IF v_row.address <> '2 rue' THEN RAISE EXCEPTION 'upsert exact : adresse %', v_row.address; END IF;
  IF v_row.customer_type <> 'individual' THEN RAISE EXCEPTION 'customer_type perdu sur réponse partielle'; END IF;
  SELECT count(*) INTO v_unbased_after FROM public.pennylane_customer_unbaselined(v_org, 100000);
  IF v_unbased_after <> v_unbased_before - 1 THEN
    RAISE EXCEPTION 'passe base : % → % (attendu -1)', v_unbased_before, v_unbased_after;
  END IF;

  -- Isolation : une autre org ne lit pas cette base.
  SELECT count(*) INTO v_n FROM public.pennylane_customer_identity_get(gen_random_uuid(), ARRAY[v_pl]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'base lisible par une autre org'; END IF;

  -- 2. Curseur du journal.
  IF public.pennylane_customer_delta_get_state(v_org) IS NOT NULL THEN RAISE EXCEPTION 'curseur non vide au départ'; END IF;
  PERFORM public.pennylane_customer_delta_set_state(v_org, '2026-10-11T10:00:00Z', '{"ok":true}');
  PERFORM public.pennylane_customer_delta_set_state(v_org, '2026-10-11T10:15:00Z', '{"ok":true}');
  IF public.pennylane_customer_delta_get_state(v_org) <> '2026-10-11T10:15:00Z'::timestamptz THEN
    RAISE EXCEPTION 'curseur mal enregistré';
  END IF;
  v_ok := false;
  BEGIN
    PERFORM public.pennylane_customer_delta_set_state(v_org, NULL, NULL);
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'curseur NULL accepté'; END IF;

  -- 3. Saisies en attente : posées, conservant les autres clés de metadata, puis levées.
  UPDATE majordhome.pennylane_sync SET metadata = '{"source":"test"}'
   WHERE org_id = v_org AND entity_type = 'client' AND local_id = v_client;
  IF NOT public.pennylane_client_set_push_state(v_org, v_client, '{"address":"2026-10-11T11:00:00Z"}', 'Pennylane 422') THEN
    RAISE EXCEPTION 'push state : mapping non trouvé';
  END IF;
  SELECT metadata, sync_status INTO v_meta, v_status FROM majordhome.pennylane_sync
   WHERE org_id = v_org AND entity_type = 'client' AND local_id = v_client;
  IF v_status <> 'error' OR v_meta->'pending_push'->>'address' IS NULL OR v_meta->>'source' <> 'test' THEN
    RAISE EXCEPTION 'push state en attente incorrect : % / %', v_status, v_meta;
  END IF;
  PERFORM public.pennylane_client_set_push_state(v_org, v_client, '{}', NULL);
  SELECT metadata, sync_status INTO v_meta, v_status FROM majordhome.pennylane_sync
   WHERE org_id = v_org AND entity_type = 'client' AND local_id = v_client;
  IF v_status <> 'synced' OR v_meta ? 'pending_push' OR v_meta->>'source' <> 'test' THEN
    RAISE EXCEPTION 'push state levé incorrect : % / %', v_status, v_meta;
  END IF;
  -- Mauvaise org : aucune ligne touchée.
  IF public.pennylane_client_set_push_state(gen_random_uuid(), v_client, '{"city":"x"}', 'x') THEN
    RAISE EXCEPTION 'push state écrit cross-org';
  END IF;

  RAISE NOTICE 'OK — % customers pontés à photographier (passe base)', v_unbased_before;
END $$;
