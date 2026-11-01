-- assert-find-or-create-client-strict-unique.sql — vérifie 20261101_1_find_or_create_client_strict_unique.sql
-- sur le cluster de répétition : deux fiches au même e-mail ET même téléphone (cas CATHALO / VICTORIN),
-- les étapes strictes ne tirent plus au hasard ; mappings de la paire supprimés.

-- ── A. Structure / ACL ──────────────────────────────────────────────────────
DO $$
DECLARE v_fn text := 'public.find_or_create_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean)';
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'find_or_create_client exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'mémos vocaux : authenticated doit garder EXECUTE'; END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'service_role sans EXECUTE'; END IF;
END $$;

-- ── B. Données : liens de la paire coupés, rien d'autre ─────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM majordhome.pennylane_sync WHERE entity_type = 'client'
             AND local_id IN ('ea99cbd1-1d8c-48fa-877b-f5151d8d3b65', 'b23e0aff-62a7-4467-b6b1-731fc4e00aae')) THEN
    RAISE EXCEPTION 'mapping CATHALO / VICTORIN toujours présent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.pennylane_sync WHERE entity_type = 'client'
                 AND local_id = '24ff6c8b-bb42-4737-8742-a389ba05a308') THEN
    RAISE EXCEPTION 'le mapping MAILLOC ne devait pas être touché';
  END IF;
END $$;

-- ── C. Scénarios ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-00000000f0c2';
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_res jsonb; v_n int; v_proj uuid;
BEGIN
  PERFORM setval('majordhome.client_number_seq', 99500);
  INSERT INTO core.organizations (id, name) VALUES (v_org, 'Org test strict unique') ON CONFLICT DO NOTHING;

  -- Deux voisines : même e-mail, même téléphone, noms différents.
  v_proj := gen_random_uuid(); INSERT INTO core.projects (id, org_id, name) VALUES (v_proj, v_org, 'CATHALO MONIQUE');
  INSERT INTO majordhome.clients (project_id, org_id, display_name, first_name, last_name, phone, email)
  VALUES (v_proj, v_org, 'CATHALO MONIQUE', 'MONIQUE', 'CATHALO', '06 88 04 20 18', 'leleu.test@example.fr') RETURNING id INTO v_a;
  v_proj := gen_random_uuid(); INSERT INTO core.projects (id, org_id, name) VALUES (v_proj, v_org, 'VICTORIN HELENE');
  INSERT INTO majordhome.clients (project_id, org_id, display_name, first_name, last_name, phone, email)
  VALUES (v_proj, v_org, 'VICTORIN HELENE', 'HELENE', 'VICTORIN', '06 88 04 20 18', 'leleu.test@example.fr') RETURNING id INTO v_b;

  -- 1. Entrée au nom de VICTORIN ⇒ toujours la fiche VICTORIN (plus de tirage au sort), rien créé.
  SELECT count(*) INTO v_n FROM majordhome.clients WHERE org_id = v_org;
  v_res := public.find_or_create_client(v_org, 'leleu.test@example.fr', '0688042018', 'HELENE', 'VICTORIN', 'HELENE VICTORIN',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'matched_strict' OR (v_res->>'client_id')::uuid <> v_b THEN
    RAISE EXCEPTION 'VICTORIN devait être rattachée à sa fiche : %', v_res;
  END IF;
  -- 2. Entrée au nom de CATHALO ⇒ fiche CATHALO.
  v_res := public.find_or_create_client(v_org, 'leleu.test@example.fr', '0688042018', 'MONIQUE', 'CATHALO', 'MONIQUE CATHALO',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'matched_strict' OR (v_res->>'client_id')::uuid <> v_a THEN
    RAISE EXCEPTION 'CATHALO devait être rattachée à sa fiche : %', v_res;
  END IF;
  -- 3. Nom qui ne correspond à aucune des deux ⇒ ambigu, rien créé ni rattaché.
  v_res := public.find_or_create_client(v_org, 'leleu.test@example.fr', '0688042018', 'PAUL', 'TIERS', 'PAUL TIERS',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'ambiguous' OR v_res->>'client_id' IS NOT NULL THEN
    RAISE EXCEPTION 'nom inconnu sur e-mail+téléphone partagés : ambigu attendu : %', v_res;
  END IF;
  IF (SELECT count(*) FROM majordhome.clients WHERE org_id = v_org) <> v_n THEN RAISE EXCEPTION 'une fiche a été créée'; END IF;

  -- 4. Deux fiches strictement identiques (téléphone + prénom + nom) ⇒ ambigu « several ».
  v_proj := gen_random_uuid(); INSERT INTO core.projects (id, org_id, name) VALUES (v_proj, v_org, 'DOUBLE JEAN');
  INSERT INTO majordhome.clients (project_id, org_id, display_name, first_name, last_name, phone)
  VALUES (v_proj, v_org, 'DOUBLE JEAN', 'JEAN', 'DOUBLE', '0611223344') RETURNING id INTO v_c;
  v_proj := gen_random_uuid(); INSERT INTO core.projects (id, org_id, name) VALUES (v_proj, v_org, 'DOUBLE JEAN');
  INSERT INTO majordhome.clients (project_id, org_id, display_name, first_name, last_name, phone)
  VALUES (v_proj, v_org, 'DOUBLE JEAN', 'JEAN', 'DOUBLE', '0611223344') RETURNING id INTO v_d;
  v_res := public.find_or_create_client(v_org, NULL, '0611223344', 'JEAN', 'DOUBLE', 'JEAN DOUBLE',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'ambiguous' OR v_res->>'match_type' <> 'client_strong_several' THEN
    RAISE EXCEPTION 'deux fiches identiques : ambigu/several attendu : %', v_res;
  END IF;

  -- 5. Candidat strict unique : comportement inchangé (client_email_plus).
  v_res := public.find_or_create_client(v_org, 'seul@example.fr', NULL, 'ANNE', 'SEULE', 'ANNE SEULE',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'created' THEN RAISE EXCEPTION 'création attendue : %', v_res; END IF;
  v_res := public.find_or_create_client(v_org, 'seul@example.fr', NULL, 'ANNE', 'SEULE', 'ANNE SEULE',
    NULL, NULL, NULL, NULL, 'particulier', NULL, 'cron_pennylane', true);
  IF v_res->>'action' <> 'matched_strict' OR v_res->>'match_type' <> 'client_email_plus' THEN
    RAISE EXCEPTION 'candidat strict unique : client_email_plus attendu : %', v_res;
  END IF;
END $$;
