-- assert-find-or-create-client.sql — vérifie 20261021_1_find_or_create_client_rapprochement_fort.sql
-- sur le cluster de répétition. Scénarios posés dans une org dédiée (fiches au format MDH, entrées
-- au format Pennylane « +33 … » / « Prénom NOM »), plus un cas réel Mayer (JEAN GOMES, déjà en double).

-- ── A. Structure / ACL ──────────────────────────────────────────────────────
DO $$
DECLARE v_fn text := 'public.find_or_create_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean)';
BEGIN
  IF to_regprocedure('public.find_or_create_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ancienne surcharge de find_or_create_client toujours présente';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'find_or_create_client exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'mémos vocaux : authenticated doit garder EXECUTE'; END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'service_role sans EXECUTE'; END IF;
  IF has_function_privilege('anon', 'majordhome.client_identity_tokens(text[])', 'EXECUTE') THEN RAISE EXCEPTION 'helper exécutable par anon'; END IF;
END $$;

-- ── B. Helpers ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF majordhome.phone_tail_key('+33 6 86 47 22 16') IS DISTINCT FROM majordhome.phone_tail_key('06.86.47.22.16') THEN
    RAISE EXCEPTION 'phone_tail_key : +33 et 06 doivent donner la même clé';
  END IF;
  IF majordhome.phone_tail_key('12345') IS NOT NULL THEN RAISE EXCEPTION 'phone_tail_key : numéro court ⇒ NULL'; END IF;
  IF NOT majordhome.client_names_compatible(majordhome.client_identity_tokens('JEAN', 'GOMES'), majordhome.client_identity_tokens('Gomes', 'Jean')) THEN
    RAISE EXCEPTION 'ordre prénom/nom doit être indifférent';
  END IF;
  IF NOT majordhome.client_names_compatible(majordhome.client_identity_tokens('MME', 'RAYNAUD'), majordhome.client_identity_tokens('FABIEN', 'RAYNAUD')) THEN
    RAISE EXCEPTION 'civilité seule + nom doit être compatible';
  END IF;
  IF majordhome.client_names_compatible(majordhome.client_identity_tokens('JEROME', 'VIGROUX'), majordhome.client_identity_tokens('ISABELLE', 'VIGROUX')) THEN
    RAISE EXCEPTION 'deux prénoms différents ne doivent pas être compatibles';
  END IF;
  IF majordhome.client_names_compatible(majordhome.client_identity_tokens('MME'), majordhome.client_identity_tokens('MME', 'DUPONT')) THEN
    RAISE EXCEPTION 'une identité vide (civilité seule) ne doit jamais être compatible';
  END IF;
END $$;

-- ── C. Scénarios ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-00000000f0c1';
  v_gomes uuid; v_vig uuid; v_r1 uuid; v_r2 uuid; v_res jsonb; v_n int;
  v_proj uuid;
BEGIN
  -- Le snapshot charge client_number sans recaler la séquence : on la place au-delà.
  PERFORM setval('majordhome.client_number_seq', 99000);
  INSERT INTO core.organizations (id, name) VALUES (v_org, 'Org test find_or_create') ON CONFLICT DO NOTHING;

  -- Fiches MDH existantes (format « NOM Prénom », téléphone national).
  v_proj := gen_random_uuid(); INSERT INTO core.projects (id, org_id, name) VALUES (v_proj, v_org, 'GOMES JEAN');
  INSERT INTO majordhome.clients (project_id, org_id, display_name, first_name, last_name, phone, email)
  VALUES (v_proj, v_org, 'GOMES JEAN', 'JEAN', 'GOMES', '06 86 47 22 16', NULL) RETURNING id INTO v_gomes;
  -- inversé volontairement : last_name = prénom (vu sur des imports)
  UPDATE majordhome.clients SET first_name = 'GOMES', last_name = 'JEAN' WHERE id = v_gomes;

  v_proj := gen_random_uuid(); INSERT INTO core.projects (id, org_id, name) VALUES (v_proj, v_org, 'VIGROUX ISABELLE');
  INSERT INTO majordhome.clients (project_id, org_id, display_name, first_name, last_name, phone)
  VALUES (v_proj, v_org, 'VIGROUX ISABELLE', 'ISABELLE', 'VIGROUX', '0645594446') RETURNING id INTO v_vig;

  v_proj := gen_random_uuid(); INSERT INTO core.projects (id, org_id, name) VALUES (v_proj, v_org, 'DURAND PAUL');
  INSERT INTO majordhome.clients (project_id, org_id, display_name, first_name, last_name, email)
  VALUES (v_proj, v_org, 'DURAND PAUL', 'PAUL', 'DURAND', 'famille.durand@example.fr') RETURNING id INTO v_r1;
  v_proj := gen_random_uuid(); INSERT INTO core.projects (id, org_id, name) VALUES (v_proj, v_org, 'DURAND MARIE');
  INSERT INTO majordhome.clients (project_id, org_id, display_name, first_name, last_name, email)
  VALUES (v_proj, v_org, 'DURAND', '', 'DURAND', 'famille.durand@example.fr') RETURNING id INTO v_r2;

  -- 1. GOMES : +33, « Prénom NOM », champs inversés en base ⇒ rattaché, rien créé.
  v_res := public.find_or_create_client(v_org, 'gdsjean@yahoo.fr', '+33 6 86 47 22 16', 'JEAN', 'GOMES', 'JEAN GOMES',
    NULL, NULL, NULL, NULL, 'particulier', '411GOMES', 'cron_pennylane', true);
  IF v_res->>'action' <> 'matched_strict' OR (v_res->>'client_id')::uuid <> v_gomes OR v_res->>'match_type' <> 'client_strong_unique' THEN
    RAISE EXCEPTION 'GOMES devait être rattaché à la fiche existante : %', v_res;
  END IF;
  IF (SELECT email FROM majordhome.clients WHERE id = v_gomes) IS DISTINCT FROM 'gdsjean@yahoo.fr' THEN
    RAISE EXCEPTION 'GOMES : e-mail vide non complété';
  END IF;

  -- 2. VIGROUX JEROME : même téléphone, autre prénom ⇒ ambigu, rien créé.
  SELECT count(*) INTO v_n FROM majordhome.clients WHERE org_id = v_org;
  v_res := public.find_or_create_client(v_org, NULL, '+33 6 45 59 44 46', 'JEROME', 'VIGROUX', 'JEROME VIGROUX',
    NULL, NULL, NULL, NULL, 'particulier', '411VIG', 'cron_pennylane', true);
  IF v_res->>'action' <> 'ambiguous' OR v_res->>'client_id' IS NOT NULL
     OR NOT (v_res->'candidate_client_ids') @> to_jsonb(ARRAY[v_vig]) THEN
    RAISE EXCEPTION 'VIGROUX JEROME devait être ambigu : %', v_res;
  END IF;
  IF (SELECT count(*) FROM majordhome.clients WHERE org_id = v_org) <> v_n THEN RAISE EXCEPTION 'ambigu : une fiche a été créée'; END IF;
  IF (SELECT count(*) FROM majordhome.client_creation_audit WHERE org_id = v_org AND action = 'ambiguous') <> 1 THEN
    RAISE EXCEPTION 'ambigu non tracé dans client_creation_audit';
  END IF;
  -- Rejeu horaire : pas de seconde ligne d'audit le même jour.
  PERFORM public.find_or_create_client(v_org, NULL, '+33 6 45 59 44 46', 'JEROME', 'VIGROUX', 'JEROME VIGROUX',
    NULL, NULL, NULL, NULL, 'particulier', '411VIG', 'cron_pennylane', true);
  IF (SELECT count(*) FROM majordhome.client_creation_audit WHERE org_id = v_org AND action = 'ambiguous') <> 1 THEN
    RAISE EXCEPTION 'ambigu rejoué : audit dupliqué';
  END IF;

  -- 3. Sans le drapeau (mémos vocaux) : comportement historique, la fiche est créée.
  v_res := public.find_or_create_client(p_org_id => v_org, p_phone => '06 45 59 44 46', p_first_name => 'JEROME',
    p_last_name => 'VIGROUX', p_source => 'voice_pwa_prospect');
  IF v_res->>'action' <> 'created' THEN RAISE EXCEPTION 'sans drapeau, l''ambigu doit créer comme avant : %', v_res; END IF;

  -- 4. Deux fiches compatibles sur le même e-mail ⇒ ambigu (plusieurs).
  v_res := public.find_or_create_client(v_org, 'Famille.Durand@example.fr ', NULL, 'MME', 'DURAND', 'MME DURAND',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'ambiguous' OR v_res->>'match_type' <> 'client_strong_several' THEN
    RAISE EXCEPTION 'DURAND (2 fiches compatibles) devait être ambigu/several : %', v_res;
  END IF;

  -- 5. Personne inconnue ⇒ création inchangée.
  v_res := public.find_or_create_client(v_org, 'nouveau@example.fr', '+33 7 11 22 33 44', 'LEA', 'NOUVEAU', 'LEA NOUVEAU',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'created' THEN RAISE EXCEPTION 'inconnu : création attendue : %', v_res; END IF;

  -- 6. Fiche archivée ignorée.
  UPDATE majordhome.clients SET is_archived = true WHERE id = (v_res->>'client_id')::uuid;
  v_res := public.find_or_create_client(v_org, NULL, '0711223344', 'LEA', 'NOUVEAU', 'LEA NOUVEAU',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'created' THEN RAISE EXCEPTION 'une fiche archivée ne doit pas être candidate : %', v_res; END IF;
END $$;

-- ── D. Cas réel Mayer : JEAN GOMES existe deux fois (doublon du 2026-09-22) ⇒ jamais un 3ᵉ. ──
DO $$
DECLARE v_res jsonb; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM majordhome.clients
  WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' AND majordhome.phone_tail_key(phone) = '686472216' AND NOT COALESCE(is_archived, false);
  IF v_n < 2 THEN
    RAISE NOTICE 'cas réel GOMES : % fiche(s) dans le snapshot, scénario sauté', v_n;
    RETURN;
  END IF;
  v_res := public.find_or_create_client('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'gdsjean@yahoo.fr', '+33 6 86 47 22 16', 'JEAN', 'GOMES', 'JEAN GOMES',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' IN ('created', 'created_linked_lead') THEN RAISE EXCEPTION 'GOMES réel : 3ᵉ fiche créée : %', v_res; END IF;
  RAISE NOTICE 'cas réel GOMES : % fiches, % / %', v_n, v_res->>'action', v_res->>'match_type';
END $$;
