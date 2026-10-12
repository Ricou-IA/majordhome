-- assert-lead-search-attach.sql — vérifie 20261012_3_lead_search_for_attach.sql sur le cluster de répétition.
-- leads est photographiée sans données : on pose les cartes du scénario ROZIÈRES (incident
-- 2026-10-12) puis on interroge la RPC comme le fait la modale « Rattacher le devis ».

-- ── A. Structure / ACL ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.lead_search_for_attach(uuid, text, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lead_search_for_attach exécutable par anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.lead_search_for_attach(uuid, text, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lead_search_for_attach non exécutable par authenticated';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.lead_search_for_attach(uuid, text, uuid, integer)'::regprocedure) THEN
    RAISE EXCEPTION 'lead_search_for_attach doit rester SECURITY INVOKER (RLS leads)';
  END IF;
END $$;

-- ── B. Comportement ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid; v_other_org uuid := gen_random_uuid();
  v_client uuid;
  v_rozieres uuid; v_gautier uuid; v_status uuid;
  v_ids uuid[]; v_first uuid; v_n int; v_bool boolean; v_row record;
BEGIN
  SELECT id INTO v_org FROM core.organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'aucune org dans le snapshot'; END IF;
  SELECT id INTO v_status FROM majordhome.statuses WHERE label = 'RDV planifié' LIMIT 1;
  IF v_status IS NULL THEN RAISE EXCEPTION 'statut « RDV planifié » absent du snapshot (statuses)'; END IF;
  -- Un client réel du snapshot (FK leads.client_id), qui ne porte encore aucune carte.
  SELECT c.id INTO v_client FROM majordhome.clients c
  WHERE c.org_id = v_org AND NOT EXISTS (SELECT 1 FROM majordhome.leads l WHERE l.client_id = c.id)
  ORDER BY c.created_at LIMIT 1;
  IF v_client IS NULL THEN RAISE EXCEPTION 'aucun client disponible dans le snapshot pour %', v_org; END IF;

  -- La carte de l'incident : stockée AVEC accents, client ponté Pennylane.
  INSERT INTO majordhome.leads (org_id, first_name, last_name, city, status_id, client_id, is_deleted, created_at)
  VALUES (v_org, 'FRANÇOIS', 'ROZIÈRES', 'Montans', v_status, v_client, false, now() - interval '20 days')
  RETURNING id INTO v_rozieres;
  -- Les faux amis qui remontaient seuls (prénom sans cédille).
  INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted, created_at)
  VALUES (v_org, 'FRANCOIS', 'GAUTIER', false, now() - interval '1 day')
  RETURNING id INTO v_gautier;
  INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted) VALUES (v_org, 'FRANCOISE', 'DUPONT', false);
  -- Supprimé : jamais proposé.
  INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted) VALUES (v_org, 'FRANÇOIS', 'ROZIÈRES', true);
  -- Autre org : invisible même avec le bon nom.
  INSERT INTO core.organizations (id, name) VALUES (v_other_org, 'Autre org (test)');
  INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted) VALUES (v_other_org, 'FRANÇOIS', 'ROZIÈRES', false);
  -- 25 « FRANCOIS » récents : plus que le plafond de 20, pour prouver le classement.
  FOR v_n IN 1..25 LOOP
    INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted, created_at)
    VALUES (v_org, 'FRANCOIS', 'HOMONYME' || v_n, false, now() - (v_n || ' minutes')::interval);
  END LOOP;

  -- 1. Saisie Pennylane sans accent → la carte accentuée est trouvée, et en PREMIER
  --    (2 tokens matchés), devant les 25 homonymes plus récents.
  SELECT array_agg(r.id ORDER BY ord) INTO v_ids
  FROM public.lead_search_for_attach(v_org, 'FRANCOIS ROZIERES', NULL, 20) WITH ORDINALITY AS r(id, first_name, last_name, city, status_label, client_match, matched_tokens, ord);
  IF v_ids[1] IS DISTINCT FROM v_rozieres THEN
    RAISE EXCEPTION 'ROZIÈRES attendu en 1er pour « FRANCOIS ROZIERES », obtenu %', v_ids[1];
  END IF;
  IF array_length(v_ids, 1) <> 20 THEN
    RAISE EXCEPTION 'plafond 20 attendu, obtenu %', array_length(v_ids, 1);
  END IF;
  SELECT * INTO v_row FROM public.lead_search_for_attach(v_org, 'FRANCOIS ROZIERES', NULL, 20) LIMIT 1;
  IF v_row.matched_tokens <> 2 OR v_row.client_match OR v_row.status_label <> 'RDV planifié' THEN
    RAISE EXCEPTION 'ligne ROZIÈRES inattendue : tokens=% client_match=% statut=%', v_row.matched_tokens, v_row.client_match, v_row.status_label;
  END IF;

  -- 2. Le nom seul, sans accent, en minuscules : trouvé.
  IF NOT EXISTS (SELECT 1 FROM public.lead_search_for_attach(v_org, 'rozieres', NULL, 20) WHERE id = v_rozieres) THEN
    RAISE EXCEPTION '« rozieres » ne trouve pas ROZIÈRES';
  END IF;
  -- Et la saisie accentuée trouve aussi les cartes non accentuées.
  IF NOT EXISTS (SELECT 1 FROM public.lead_search_for_attach(v_org, 'François', NULL, 50) WHERE id = v_gautier) THEN
    RAISE EXCEPTION '« François » ne trouve pas FRANCOIS GAUTIER';
  END IF;

  -- 3. Client ponté : son lead en tête même si la saisie ne lui ressemble pas,
  --    et proposé sans aucune saisie.
  SELECT id, client_match INTO v_first, v_bool FROM public.lead_search_for_attach(v_org, 'GAUTIER', v_client, 20) LIMIT 1;
  IF v_first IS DISTINCT FROM v_rozieres OR v_bool IS NOT TRUE THEN
    RAISE EXCEPTION 'le lead du client ponté doit être 1er et marqué client_match, obtenu % (%)', v_first, v_bool;
  END IF;
  SELECT count(*), bool_and(client_match) INTO v_n, v_bool FROM public.lead_search_for_attach(v_org, NULL, v_client, 20);
  IF v_n <> 1 OR v_bool IS NOT TRUE THEN
    RAISE EXCEPTION 'sans saisie, seul le lead du client ponté est attendu (obtenu %)', v_n;
  END IF;

  -- 4. Hygiène : supprimé et autre org absents ; particule < 2 caractères ignorée ;
  --    `%` seul ne ramène rien ; sans saisie ni client → vide.
  IF (SELECT count(*) FROM public.lead_search_for_attach(v_org, 'ROZIERES', NULL, 50)) <> 1 THEN
    RAISE EXCEPTION 'ROZIÈRES supprimé ou d''une autre org remonté';
  END IF;
  IF (SELECT count(*) FROM public.lead_search_for_attach(v_org, 'a', NULL, 50)) <> 0 THEN
    RAISE EXCEPTION 'un token d''1 caractère ne doit rien ramener';
  END IF;
  IF (SELECT count(*) FROM public.lead_search_for_attach(v_org, '%%', NULL, 50)) <> 0 THEN
    RAISE EXCEPTION '« %% » ne doit pas matcher toute la base';
  END IF;
  IF (SELECT count(*) FROM public.lead_search_for_attach(v_org, NULL, NULL, 50)) <> 0 THEN
    RAISE EXCEPTION 'sans saisie ni client, aucune ligne attendue';
  END IF;

  RAISE NOTICE 'assert-lead-search-attach OK (ROZIÈRES trouvé sans accent, client ponté en tête)';
END $$;
