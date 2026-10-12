-- assert-pennylane-auto-attach.sql — vérifie 20261012_5_pennylane_pipeline_threshold_auto_attach.sql
-- sur le cluster de répétition. Scénario posé dans une org dédiée (les tables du miroir sont
-- photographiées sans données) : un client ponté avec une carte « RDV planifié », un contact
-- connu par e-mail, un client sans carte, un devis écarté, un devis éjecté, un disparu, un brouillon.

-- ── A. Structure / ACL ──────────────────────────────────────────────────────
DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'majordhome.pl_pipeline_min_amount_ht(uuid)',
    'majordhome.find_active_lead(uuid, uuid, text, text)',
    'public.pennylane_sync_auto_attach_pending(uuid, boolean)',
    'public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% exécutable par anon', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% non exécutable par service_role', v_fn;
    END IF;
  END LOOP;
  -- org_id dans le payload ⇒ service_role only.
  IF has_function_privilege('authenticated', 'public.pennylane_sync_auto_attach_pending(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'pennylane_sync_auto_attach_pending exécutable par authenticated';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.pennylane_sync_auto_attach_pending(uuid, boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'pennylane_sync_auto_attach_pending doit être SECURITY DEFINER';
  END IF;
  -- Une seule recherche de carte active : upsert_pennylane_lead délègue.
  IF pg_get_functiondef('public.upsert_pennylane_lead(uuid, uuid, text, text, text, text, text, text, text, text, numeric, text)'::regprocedure)
     NOT LIKE '%majordhome.find_active_lead(%' THEN
    RAISE EXCEPTION 'upsert_pennylane_lead doit déléguer à majordhome.find_active_lead';
  END IF;
  -- Le seuil n'est plus une constante dans pennylane_sync_update_quote_fields.
  IF pg_get_functiondef('public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric)'::regprocedure)
     NOT LIKE '%pl_pipeline_min_amount_ht(%' THEN
    RAISE EXCEPTION 'pennylane_sync_update_quote_fields doit lire le seuil de l''org';
  END IF;
END $$;

-- ── B. Seuil = réglage d'org ────────────────────────────────────────────────
DO $$
DECLARE v_org uuid := gen_random_uuid();
BEGIN
  INSERT INTO core.organizations (id, name, settings) VALUES (v_org, 'Org seuil (test)', '{}'::jsonb);
  IF majordhome.pl_pipeline_min_amount_ht(v_org) <> 500 THEN RAISE EXCEPTION 'défaut 500 attendu'; END IF;
  IF majordhome.pl_pipeline_min_amount_ht(gen_random_uuid()) <> 500 THEN RAISE EXCEPTION 'org inconnue ⇒ 500'; END IF;
  UPDATE core.organizations SET settings = '{"pennylane":{"pipeline_min_amount_ht":0}}' WHERE id = v_org;
  IF majordhome.pl_pipeline_min_amount_ht(v_org) <> 0 THEN RAISE EXCEPTION '0 doit être accepté (plus de filtre)'; END IF;
  UPDATE core.organizations SET settings = '{"pennylane":{"pipeline_min_amount_ht":"1 250,50"}}' WHERE id = v_org;
  IF majordhome.pl_pipeline_min_amount_ht(v_org) <> 500 THEN RAISE EXCEPTION 'valeur non numérique ⇒ 500, pas une erreur'; END IF;
  UPDATE core.organizations SET settings = '{"pennylane":{"pipeline_min_amount_ht":"250.5"}}' WHERE id = v_org;
  IF majordhome.pl_pipeline_min_amount_ht(v_org) <> 250.5 THEN RAISE EXCEPTION '250.5 attendu'; END IF;
END $$;

-- ── C. Rattachement automatique ─────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_client uuid; v_client2 uuid;
  v_rdv uuid; v_nouveau uuid; v_devis uuid; v_final uuid;
  v_lead_a uuid; v_lead_b uuid; v_lead_c uuid;
  v_res jsonb; v_row record; v_n int;
BEGIN
  INSERT INTO core.organizations (id, name, settings) VALUES (v_org, 'Org auto-attach (test)', '{"pennylane":{"enabled":true}}'::jsonb);
  SELECT id INTO v_rdv     FROM majordhome.statuses WHERE label = 'RDV planifié' LIMIT 1;
  SELECT id INTO v_nouveau FROM majordhome.statuses WHERE label = 'Nouveau' LIMIT 1;
  SELECT id INTO v_devis   FROM majordhome.statuses WHERE label = 'Devis envoyé' LIMIT 1;
  SELECT id INTO v_final   FROM majordhome.statuses WHERE is_final = true ORDER BY display_order LIMIT 1;
  IF v_rdv IS NULL OR v_nouveau IS NULL OR v_devis IS NULL OR v_final IS NULL THEN
    RAISE EXCEPTION 'statuts attendus absents du snapshot (RDV planifié / Nouveau / Devis envoyé / un statut final)';
  END IF;
  -- Deux clients réels du snapshot (FK leads.client_id ; clients exige project_id).
  SELECT c.id INTO v_client FROM majordhome.clients c
   WHERE NOT EXISTS (SELECT 1 FROM majordhome.leads l WHERE l.client_id = c.id) ORDER BY c.created_at LIMIT 1;
  SELECT c.id INTO v_client2 FROM majordhome.clients c
   WHERE c.id <> v_client AND NOT EXISTS (SELECT 1 FROM majordhome.leads l WHERE l.client_id = c.id) ORDER BY c.created_at LIMIT 1;
  IF v_client IS NULL OR v_client2 IS NULL THEN RAISE EXCEPTION 'pas assez de clients dans le snapshot'; END IF;

  -- Client PL 111 ponté → carte A (RDV planifié, sans e-mail ni téléphone : seul le pont la trouve).
  INSERT INTO majordhome.pennylane_sync (org_id, entity_type, local_id, pennylane_id, sync_status)
  VALUES (v_org, 'client', v_client, 111, 'synced');
  INSERT INTO majordhome.leads (org_id, first_name, last_name, client_id, status_id, is_deleted)
  VALUES (v_org, 'FRANÇOIS', 'ROZIÈRES', v_client, v_rdv, false) RETURNING id INTO v_lead_a;
  -- Client PL 222 : pas de pont, mais contact connu par e-mail → carte B (Nouveau).
  INSERT INTO majordhome.pennylane_customer_lookup (org_id, pennylane_id, email, phone)
  VALUES (v_org, 222, 'Marie.Durand@example.org', NULL);
  INSERT INTO majordhome.leads (org_id, first_name, last_name, email, status_id, is_deleted)
  VALUES (v_org, 'Marie', 'DURAND', 'marie.durand@example.org', v_nouveau, false) RETURNING id INTO v_lead_b;
  -- Client PL 444 ponté → carte C dans un statut FINAL : jamais proposée.
  INSERT INTO majordhome.pennylane_sync (org_id, entity_type, local_id, pennylane_id, sync_status)
  VALUES (v_org, 'client', v_client2, 444, 'synced');
  INSERT INTO majordhome.leads (org_id, first_name, last_name, client_id, status_id, is_deleted)
  VALUES (v_org, 'Paul', 'FINI', v_client2, v_final, false) RETURNING id INTO v_lead_c;

  -- Miroir des devis.
  INSERT INTO majordhome.pennylane_quotes (org_id, pennylane_quote_id, quote_number, status, quote_date, amount_ht, customer_id, customer_name, pl_created_at, synced_at) VALUES
    (v_org, 1001, 'D-1001', 'pending',  '2026-10-12', 5466,  111, 'FRANCOIS ROZIERES', now(), now()), -- ≥ seuil, client ponté → A
    (v_org, 1002, 'D-1002', 'pending',  '2026-10-12', 300,   111, 'FRANCOIS ROZIERES', now(), now()), -- < seuil : manuel
    (v_org, 1003, 'D-1003', 'accepted', '2026-10-11', 1200,  222, 'MARIE DURAND',      now(), now()), -- contact e-mail → B
    (v_org, 1004, 'D-1004', 'pending',  '2026-10-12', 9000,  333, 'INCONNU',           now(), now()), -- aucune carte → no_lead
    (v_org, 1005, 'D-1005', 'pending',  '2026-10-12', 800,   111, 'FRANCOIS ROZIERES', now(), now()), -- écarté
    (v_org, 1006, 'D-1006', 'pending',  '2026-10-12', 700,   111, 'FRANCOIS ROZIERES', now(), now()), -- éjecté
    (v_org, 1007, 'D-1007', 'pending',  '2026-10-12', 900,   111, 'FRANCOIS ROZIERES', now(), now()), -- disparu
    (v_org, 1008, 'D-1008', 'draft',    '2026-10-12', 950,   111, 'FRANCOIS ROZIERES', now(), now()), -- hors périmètre
    (v_org, 1009, 'D-1009', 'pending',  '2026-10-12', 4000,  444, 'PAUL FINI',         now(), now()); -- carte finale → no_lead
  UPDATE majordhome.pennylane_quotes SET missing_since = now() WHERE org_id = v_org AND pennylane_quote_id = 1007;
  INSERT INTO majordhome.pennylane_quote_dismissals (org_id, pennylane_quote_id, reason) VALUES (v_org, 1005, 'test');
  INSERT INTO majordhome.lead_pennylane_quotes (org_id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_status, ejected_at, ejected_reason)
  VALUES (v_org, v_lead_a, 1006, 111, 700, 'pending', now(), 'test');

  -- 1. Dry-run : liste sans écrire.
  v_res := public.pennylane_sync_auto_attach_pending(v_org, true);
  IF (v_res->>'examined')::int <> 4 OR (v_res->>'attached')::int <> 0 OR (v_res->>'no_lead')::int <> 2 THEN
    RAISE EXCEPTION 'dry-run : 4 examinés / 0 rattaché / 2 sans carte attendus, obtenu %', v_res;
  END IF;
  IF (SELECT count(*) FROM majordhome.lead_pennylane_quotes WHERE org_id = v_org AND ejected_at IS NULL) <> 0 THEN
    RAISE EXCEPTION 'le dry-run a écrit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'details') d
                 WHERE (d->>'quote_pl_id')::bigint = 1001 AND d->>'matched_by' = 'client_id' AND (d->>'lead_id')::uuid = v_lead_a) THEN
    RAISE EXCEPTION 'D-1001 doit viser la carte A par client_id : %', v_res->'details';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'details') d
                 WHERE (d->>'quote_pl_id')::bigint = 1003 AND d->>'matched_by' = 'email' AND (d->>'lead_id')::uuid = v_lead_b) THEN
    RAISE EXCEPTION 'D-1003 doit viser la carte B par e-mail : %', v_res->'details';
  END IF;

  -- 2. Passage réel : D-1001 → A, D-1003 → B ; A et B passent en « Devis envoyé ».
  v_res := public.pennylane_sync_auto_attach_pending(v_org, false);
  IF (v_res->>'attached')::int <> 2 OR (v_res->>'no_lead')::int <> 2 THEN
    RAISE EXCEPTION 'passage réel : 2 rattachés / 2 sans carte attendus, obtenu %', v_res;
  END IF;
  SELECT lead_id INTO v_row FROM majordhome.lead_pennylane_quotes WHERE org_id = v_org AND pennylane_quote_id = 1001 AND ejected_at IS NULL;
  IF v_row.lead_id IS DISTINCT FROM v_lead_a THEN RAISE EXCEPTION 'D-1001 non rattaché à A'; END IF;
  SELECT lead_id INTO v_row FROM majordhome.lead_pennylane_quotes WHERE org_id = v_org AND pennylane_quote_id = 1003 AND ejected_at IS NULL;
  IF v_row.lead_id IS DISTINCT FROM v_lead_b THEN RAISE EXCEPTION 'D-1003 non rattaché à B'; END IF;
  IF (SELECT status_id FROM majordhome.leads WHERE id = v_lead_a) <> v_devis
     OR (SELECT status_id FROM majordhome.leads WHERE id = v_lead_b) <> v_devis THEN
    RAISE EXCEPTION 'A et B doivent passer en « Devis envoyé »';
  END IF;
  -- Jamais touchés : sous seuil, écarté, éjecté, disparu, brouillon, carte finale.
  IF EXISTS (SELECT 1 FROM majordhome.lead_pennylane_quotes WHERE org_id = v_org AND ejected_at IS NULL
             AND pennylane_quote_id IN (1002, 1005, 1006, 1007, 1008, 1009)) THEN
    RAISE EXCEPTION 'un devis hors règle a été rattaché';
  END IF;
  IF (SELECT status_id FROM majordhome.leads WHERE id = v_lead_c) <> v_final THEN
    RAISE EXCEPTION 'la carte finale ne doit pas bouger';
  END IF;

  -- 3. Idempotent : seuls les no_lead sont réexaminés, rien de rattaché.
  v_res := public.pennylane_sync_auto_attach_pending(v_org, false);
  IF (v_res->>'examined')::int <> 2 OR (v_res->>'attached')::int <> 0 THEN
    RAISE EXCEPTION 'second passage : 2 examinés / 0 rattaché attendus, obtenu %', v_res;
  END IF;

  -- 4. Devis suivant du même client : pont par devis déjà rattaché (comportement historique).
  INSERT INTO majordhome.pennylane_quotes (org_id, pennylane_quote_id, quote_number, status, quote_date, amount_ht, customer_id, customer_name, pl_created_at, synced_at)
  VALUES (v_org, 1010, 'D-1010', 'pending', '2026-10-13', 2000, 111, 'FRANCOIS ROZIERES', now(), now());
  v_res := public.pennylane_sync_auto_attach_pending(v_org, false);
  IF (v_res->>'attached')::int <> 1
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'details') d WHERE (d->>'quote_pl_id')::bigint = 1010 AND d->>'matched_by' = 'bridge') THEN
    RAISE EXCEPTION 'D-1010 doit suivre le pont par devis rattaché : %', v_res;
  END IF;

  -- 5. Une carte apparaît pour le client 333 : le no_lead est rattrapé au passage suivant.
  -- Même normalisation qu'upsert_pennylane_lead : chiffres seuls, sans conversion +33 → 0.
  INSERT INTO majordhome.pennylane_customer_lookup (org_id, pennylane_id, email, phone) VALUES (v_org, 333, NULL, '06.12.34.56.78');
  INSERT INTO majordhome.leads (org_id, first_name, last_name, phone, status_id, is_deleted)
  VALUES (v_org, 'Jean', 'TARDIF', '06 12 34 56 78', v_rdv, false);
  v_res := public.pennylane_sync_auto_attach_pending(v_org, false);
  IF (v_res->>'attached')::int <> 1
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'details') d WHERE (d->>'quote_pl_id')::bigint = 1004 AND d->>'matched_by' = 'phone') THEN
    RAISE EXCEPTION 'D-1004 doit être rattrapé par téléphone : %', v_res;
  END IF;

  -- 6. Seuil à 0 : le petit devis part aussi ; écarté et éjecté restent intouchables.
  UPDATE core.organizations SET settings = settings || '{"pennylane":{"enabled":true,"pipeline_min_amount_ht":0}}' WHERE id = v_org;
  v_res := public.pennylane_sync_auto_attach_pending(v_org, false);
  IF (v_res->>'min_amount_ht')::numeric <> 0 OR (v_res->>'attached')::int <> 1
     OR NOT EXISTS (SELECT 1 FROM majordhome.lead_pennylane_quotes WHERE org_id = v_org AND pennylane_quote_id = 1002 AND ejected_at IS NULL) THEN
    RAISE EXCEPTION 'seuil 0 : D-1002 attendu rattaché, obtenu %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.lead_pennylane_quotes WHERE org_id = v_org AND ejected_at IS NULL AND pennylane_quote_id IN (1005, 1006)) THEN
    RAISE EXCEPTION 'écarté / éjecté rattaché malgré le seuil 0';
  END IF;

  -- 7. upsert_pennylane_lead inchangé en surface : même carte, même action.
  v_res := public.upsert_pennylane_lead(v_org, v_client2, NULL, NULL, 'Paul', 'FINI', NULL, NULL, NULL, NULL, 4000, 'D-1009');
  IF v_res->>'action' <> 'no_lead' THEN RAISE EXCEPTION 'carte finale ⇒ no_lead, obtenu %', v_res; END IF;
  v_res := public.upsert_pennylane_lead(v_org, NULL, 'MARIE.DURAND@example.org', NULL, 'Marie', 'DURAND', NULL, NULL, NULL, NULL, 1200, 'D-1003');
  IF v_res->>'matched_by' <> 'email' OR (v_res->>'lead_id')::uuid <> v_lead_b OR v_res->>'action' <> 'lead_skipped_priority_status' THEN
    RAISE EXCEPTION 'upsert_pennylane_lead par e-mail : %', v_res;
  END IF;

  SELECT count(*) INTO v_n FROM majordhome.lead_pennylane_quotes WHERE org_id = v_org AND ejected_at IS NULL;
  RAISE NOTICE 'assert-pennylane-auto-attach OK (% devis rattachés automatiquement, seuil réglable, écartés/éjectés respectés)', v_n;
END $$;
