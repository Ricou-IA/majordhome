-- assert-client-dpe.sql — vérifie 20261112_2_client_dpe.sql.
-- Couvre : privilèges (anon rien, authenticated lecture seule, RPC service_role seul) ; vue security_invoker ;
-- tentative auto qui rattache et tient clients.dpe_number ; un numéro saisi n'est jamais remplacé par l'auto ;
-- un auto est remplacé par une nouvelle tentative (adresse changée) ; detacher écarte et vide la fiche ; un numéro
-- écarté n'est pas reposé ; client d'une autre org refusé ; idempotence (une ligne par client) ; lecture RLS.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_client uuid;
  v_membre uuid;
  v_n int;
  v_r jsonb;
  v_fiche text;
  ok boolean;
  sig text := 'public.client_dpe_record(uuid, uuid, text, jsonb, uuid)';
  carte jsonb := '{"carte": {"dpeLabel": "A"}, "version_carte": 1, "etiquette_dpe": "A", "surface": 114.02, "date_dpe": "2026-02-18", "rapport_complet": true}';
BEGIN
  -- (0) privilèges
  IF has_table_privilege('anon', 'public.majordhome_client_dpe', 'SELECT') OR has_table_privilege('anon', 'majordhome.client_dpe', 'SELECT') THEN
    RAISE EXCEPTION 'anon lit client_dpe';
  END IF;
  IF has_table_privilege('authenticated', 'majordhome.client_dpe', 'INSERT') OR has_table_privilege('authenticated', 'majordhome.client_dpe', 'UPDATE')
     OR has_table_privilege('authenticated', 'majordhome.client_dpe', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated écrit client_dpe';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_client_dpe', 'SELECT') OR NOT has_table_privilege('service_role', 'majordhome.client_dpe', 'SELECT') THEN
    RAISE EXCEPTION 'lecture manquante';
  END IF;
  IF has_function_privilege('anon', sig, 'EXECUTE') OR has_function_privilege('authenticated', sig, 'EXECUTE') OR NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'privilèges de client_dpe_record incorrects';
  END IF;
  IF (SELECT reloptions::text FROM pg_class WHERE oid = 'public.majordhome_client_dpe'::regclass) NOT LIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION 'vue sans security_invoker';
  END IF;

  -- fixture : un client Mayer sans numéro
  SELECT id INTO v_client FROM majordhome.clients WHERE org_id = v_mayer AND dpe_number IS NULL LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer LIMIT 1;
  INSERT INTO core.organizations (name) VALUES ('TEST client_dpe autre org') RETURNING id INTO v_autre;
  DELETE FROM majordhome.client_dpe WHERE client_id = v_client;

  -- (1) tentative sans DPE puis tentative qui rattache
  PERFORM public.client_dpe_record(v_mayer, v_client, 'tentative', '{"etat": "aucun_dpe", "adresse_tentee": "a1"}', NULL);
  v_r := public.client_dpe_record(v_mayer, v_client, 'tentative', '{"etat": "rattache", "dpe_number": "2631E0482288Y", "adresse_tentee": "a1"}'::jsonb || carte, v_membre);
  SELECT dpe_number INTO v_fiche FROM majordhome.clients WHERE id = v_client;
  IF v_r->>'origine' <> 'auto' OR v_fiche <> '2631E0482288Y' OR (v_r->>'rapport_complet')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'tentative rattachée incorrecte : % / fiche %', v_r, v_fiche;
  END IF;
  SELECT count(*) INTO v_n FROM majordhome.client_dpe WHERE client_id = v_client;
  IF v_n <> 1 THEN RAISE EXCEPTION 'idempotence : % lignes', v_n; END IF;

  -- (2) un auto se remplace (adresse changée)
  v_r := public.client_dpe_record(v_mayer, v_client, 'tentative', '{"etat": "aucun_dpe", "adresse_tentee": "a2"}', NULL);
  SELECT dpe_number INTO v_fiche FROM majordhome.clients WHERE id = v_client;
  IF v_fiche IS NOT NULL OR v_r->>'dpe_number' IS NOT NULL OR v_r->'carte' <> 'null'::jsonb AND v_r->'carte' IS NOT NULL THEN
    RAISE EXCEPTION 'auto non remplacé : % / fiche %', v_r, v_fiche;
  END IF;

  -- (3) saisi protégé contre l'auto
  PERFORM public.client_dpe_record(v_mayer, v_client, 'actualiser', '{"dpe_number": "2481E2082752C", "origine": "saisi"}'::jsonb || carte, v_membre);
  ok := false;
  BEGIN
    PERFORM public.client_dpe_record(v_mayer, v_client, 'tentative', '{"etat": "rattache", "dpe_number": "2631E0482288Y"}', NULL);
  EXCEPTION WHEN OTHERS THEN ok := (SQLERRM = 'client_dpe_saisi_protege');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'un saisi a été remplacé par l''auto'; END IF;

  -- (4) detacher : numéro écarté, fiche vidée ; l'auto ne repose pas un numéro écarté
  v_r := public.client_dpe_record(v_mayer, v_client, 'detacher', '{}', v_membre);
  SELECT dpe_number INTO v_fiche FROM majordhome.clients WHERE id = v_client;
  IF v_fiche IS NOT NULL OR NOT ('2481E2082752C' = ANY (ARRAY(SELECT jsonb_array_elements_text(v_r->'ecartes')))) OR v_r->>'etat' <> 'detache' THEN
    RAISE EXCEPTION 'detacher incorrect : %', v_r;
  END IF;
  ok := false;
  BEGIN
    PERFORM public.client_dpe_record(v_mayer, v_client, 'tentative', '{"etat": "rattache", "dpe_number": "2481E2082752C"}', NULL);
  EXCEPTION WHEN OTHERS THEN ok := (SQLERRM = 'client_dpe_numero_ecarte');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'numéro écarté reposé'; END IF;

  -- (5) choisir : origine choisi, voisinage conservé
  v_r := public.client_dpe_record(v_mayer, v_client, 'choisir', '{"dpe_number": "2631E0482288Y", "voisinage": true}'::jsonb || carte, v_membre);
  IF v_r->>'origine' <> 'choisi' OR (v_r->>'voisinage')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'choisir incorrect : %', v_r; END IF;

  -- (6) client d'une autre org refusé
  ok := false;
  BEGIN
    PERFORM public.client_dpe_record(v_autre, v_client, 'detacher', '{}', NULL);
  EXCEPTION WHEN OTHERS THEN ok := (SQLERRM = 'client_dpe_client_org_mismatch');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'client d''une autre org accepté'; END IF;

  -- (7) RLS : un membre lit, un inconnu ne lit rien
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.majordhome_client_dpe WHERE client_id = v_client;
  RESET ROLE;
  IF v_n <> 1 THEN RAISE EXCEPTION 'un membre lit % ligne(s)', v_n; END IF;
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.majordhome_client_dpe;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'un inconnu lit % ligne(s)', v_n; END IF;

  -- nettoyage
  DELETE FROM majordhome.client_dpe WHERE client_id = v_client;
  UPDATE majordhome.clients SET dpe_number = NULL WHERE id = v_client;
  DELETE FROM core.organizations WHERE id = v_autre;
  RAISE NOTICE 'assert-client-dpe : OK';
END $$;
