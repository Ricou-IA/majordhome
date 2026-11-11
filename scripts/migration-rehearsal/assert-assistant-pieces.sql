-- assert-assistant-pieces.sql — vérifie 20261113_1_assistant_pieces.sql (assistant « Trouver une pièce », Hermes).
-- Une ligne par recherche de pièce lancée sur l'appareil d'un client ; écrites par l'edge (service_role) via cinq RPC,
-- lues par le front via la vue public.majordhome_assistant_recherches. Org Mayer = org CORE (3c68…).
-- Impersonation : SET LOCAL ROLE authenticated + request.jwt.claim.sub (stub auth.uid() du harnais) ; request.jwt.claims
-- posé aussi, comme en prod. Fixtures supprimées en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;            -- autre org CORE
  v_membre uuid;           -- membre de Mayer
  v_etranger uuid;         -- membre de l'autre org, pas de Mayer
  v_eq uuid;               -- équipement Mayer
  v_cli uuid; v_proj uuid; -- client Mayer
  v_cli_a uuid; v_proj_a uuid; -- client de l'autre org
  v_inter uuid; v_inter_a uuid; v_inter_ct uuid; v_ct uuid;
  v_id uuid; v_id2 uuid; v_id3 uuid;
  v_row record;
  v_fin timestamptz;
  v_ok boolean;
  v_n int;
  f text;
  r text;
  p text;
  v_fonctions text[] := ARRAY[
    'public.assistant_recherche_ouvrir(uuid, uuid, uuid, text, uuid)',
    'public.assistant_recherche_attacher_run(uuid, text)',
    'public.assistant_recherche_clore(uuid, text, jsonb, text, jsonb, text)',
    'public.assistant_recherches_en_cours()',
    'public.increment_assistant_quota(uuid, uuid, integer)'];
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────
  SELECT om.user_id INTO v_membre FROM core.organization_members om WHERE om.org_id = v_mayer LIMIT 1;
  SELECT om.org_id, om.user_id INTO v_autre, v_etranger FROM core.organization_members om
  WHERE om.org_id <> v_mayer
    AND NOT EXISTS (SELECT 1 FROM core.organization_members m2 WHERE m2.user_id = om.user_id AND m2.org_id = v_mayer)
  LIMIT 1;
  IF v_membre IS NULL OR v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : il faut un membre Mayer et un membre d''une autre org'; END IF;
  SELECT e.id INTO v_eq FROM majordhome.equipments e WHERE majordhome.project_org_id(e.project_id) = v_mayer LIMIT 1;
  IF v_eq IS NULL THEN RAISE EXCEPTION 'fixture : aucun équipement Mayer'; END IF;
  SELECT c.id, c.project_id INTO v_cli, v_proj FROM majordhome.clients c WHERE c.org_id = v_mayer AND c.project_id IS NOT NULL LIMIT 1;
  SELECT c.id, c.project_id INTO v_cli_a, v_proj_a FROM majordhome.clients c WHERE c.org_id = v_autre AND c.project_id IS NOT NULL LIMIT 1;
  IF v_cli IS NULL OR v_cli_a IS NULL THEN RAISE EXCEPTION 'fixture : il faut un client Mayer et un client de l''autre org'; END IF;
  INSERT INTO majordhome.interventions (project_id, client_id, intervention_type) VALUES (v_proj, v_cli, 'sav') RETURNING id INTO v_inter;
  INSERT INTO majordhome.interventions (project_id, client_id, intervention_type) VALUES (v_proj_a, v_cli_a, 'sav') RETURNING id INTO v_inter_a;
  INSERT INTO majordhome.contracts (org_id, client_id, status) VALUES (v_mayer, v_cli, 'pending') RETURNING id INTO v_ct;
  INSERT INTO majordhome.interventions (project_id, contract_id, intervention_type) VALUES (v_proj, v_ct, 'maintenance') RETURNING id INTO v_inter_ct;

  -- ── 1. ouvrir : équipement d'une autre org refusé ; équipement de l'org accepté, ligne en_cours ───────────
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_ouvrir(v_autre, v_eq, NULL, 'Joint de porte', v_etranger);
  EXCEPTION WHEN no_data_found THEN v_ok := (SQLERRM = 'equipement_introuvable');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(1) ouvrir accepte un équipement d''une autre org'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_ouvrir(v_mayer, gen_random_uuid(), NULL, 'Joint de porte', v_membre);
  EXCEPTION WHEN no_data_found THEN v_ok := (SQLERRM = 'equipement_introuvable');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(1) ouvrir accepte un équipement inexistant'; END IF;

  v_id := public.assistant_recherche_ouvrir(v_mayer, v_eq, NULL, '  Joint de porte foyer  ', v_membre);
  IF v_id IS NULL THEN RAISE EXCEPTION '(1) ouvrir ne rend pas d''id'; END IF;
  SELECT * INTO v_row FROM majordhome.assistant_recherches WHERE id = v_id;
  IF v_row.statut IS DISTINCT FROM 'en_cours' OR v_row.org_id IS DISTINCT FROM v_mayer OR v_row.equipment_id IS DISTINCT FROM v_eq
     OR v_row.created_by IS DISTINCT FROM v_membre OR v_row.demande IS DISTINCT FROM 'Joint de porte foyer' OR v_row.finished_at IS NOT NULL THEN
    RAISE EXCEPTION '(1) ligne ouverte inattendue : %', row_to_json(v_row);
  END IF;

  -- 1 bis. intervention : de l'org (par client, par contrat sans client) acceptée ; d'une autre org refusée
  v_id2 := public.assistant_recherche_ouvrir(v_mayer, v_eq, v_inter, 'Carte électronique', v_membre);
  IF (SELECT intervention_id FROM majordhome.assistant_recherches WHERE id = v_id2) IS DISTINCT FROM v_inter THEN
    RAISE EXCEPTION '(1 bis) intervention de l''org non rattachée';
  END IF;
  v_id3 := public.assistant_recherche_ouvrir(v_mayer, v_eq, v_inter_ct, 'Carte électronique', v_membre);
  IF v_id3 IS NULL THEN RAISE EXCEPTION '(1 bis) intervention rattachée à un contrat (sans client) refusée'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_ouvrir(v_mayer, v_eq, v_inter_a, 'Carte électronique', v_membre);
  EXCEPTION WHEN no_data_found THEN v_ok := (SQLERRM = 'intervention_introuvable');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(1 bis) ouvrir accepte une intervention d''une autre org'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_ouvrir(v_mayer, v_eq, gen_random_uuid(), 'Carte électronique', v_membre);
  EXCEPTION WHEN no_data_found THEN v_ok := (SQLERRM = 'intervention_introuvable');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(1 bis) ouvrir accepte une intervention inexistante'; END IF;

  -- 1 ter. utilisateur non membre de l'org refusé ; NULL refusé
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_ouvrir(v_mayer, v_eq, NULL, 'Joint', v_etranger);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := (SQLERRM = 'not_authorized');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(1 ter) ouvrir accepte un utilisateur non membre de l''org'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_ouvrir(v_mayer, v_eq, NULL, 'Joint', NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := (SQLERRM = 'not_authorized');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(1 ter) ouvrir accepte un utilisateur NULL'; END IF;

  -- 1 quater. demande vide ou trop longue refusée
  FOREACH p IN ARRAY ARRAY['   ', repeat('x', 501)] LOOP
    v_ok := false;
    BEGIN
      PERFORM public.assistant_recherche_ouvrir(v_mayer, v_eq, NULL, p, v_membre);
    EXCEPTION WHEN invalid_parameter_value THEN v_ok := (SQLERRM = 'demande_invalide');
    END;
    IF NOT v_ok THEN RAISE EXCEPTION '(1 quater) demande invalide acceptée (longueur %)', length(p); END IF;
  END LOOP;
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_ouvrir(v_mayer, v_eq, NULL, NULL, v_membre);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := (SQLERRM = 'demande_invalide');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(1 quater) demande NULL acceptée'; END IF;

  -- attacher_run : posé tant que en_cours ; id inconnu refusé
  PERFORM public.assistant_recherche_attacher_run(v_id, 'run_abc');
  IF (SELECT run_id FROM majordhome.assistant_recherches WHERE id = v_id) IS DISTINCT FROM 'run_abc' THEN
    RAISE EXCEPTION '(attacher_run) run_id non posé';
  END IF;
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_attacher_run(gen_random_uuid(), 'run_x');
  EXCEPTION WHEN no_data_found THEN v_ok := (SQLERRM = 'recherche_introuvable');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(attacher_run) id inconnu accepté'; END IF;

  -- en_cours() : la ligne ouverte y est (avant clôture)
  IF NOT EXISTS (SELECT 1 FROM public.assistant_recherches_en_cours() x WHERE x.id = v_id AND x.run_id = 'run_abc') THEN
    RAISE EXCEPTION '(en_cours) la recherche ouverte n''est pas listée';
  END IF;

  -- ── 2. clore : vrai puis faux, la seconde ne change rien ─────────────────────────────────────────────────
  IF public.assistant_recherche_clore(v_id, 'terminee', '{"pieces":[{"ref":"J-1"}]}'::jsonb, 'texte', '{"tokens":12}'::jsonb, NULL) IS NOT TRUE THEN
    RAISE EXCEPTION '(2) premier clore ne rend pas vrai';
  END IF;
  SELECT * INTO v_row FROM majordhome.assistant_recherches WHERE id = v_id;
  IF v_row.statut <> 'terminee' OR v_row.finished_at IS NULL OR v_row.reponse #>> '{pieces,0,ref}' IS DISTINCT FROM 'J-1'
     OR v_row.texte_brut IS DISTINCT FROM 'texte' OR v_row.usage ->> 'tokens' IS DISTINCT FROM '12' THEN
    RAISE EXCEPTION '(2) ligne close inattendue : %', row_to_json(v_row);
  END IF;
  v_fin := v_row.finished_at;
  IF public.assistant_recherche_clore(v_id, 'echec', NULL, NULL, NULL, 'boum') IS NOT FALSE THEN
    RAISE EXCEPTION '(2) second clore ne rend pas faux';
  END IF;
  SELECT * INTO v_row FROM majordhome.assistant_recherches WHERE id = v_id;
  IF v_row.statut <> 'terminee' OR v_row.finished_at IS DISTINCT FROM v_fin OR v_row.erreur IS NOT NULL OR v_row.reponse IS NULL THEN
    RAISE EXCEPTION '(2) second clore a modifié la ligne : %', row_to_json(v_row);
  END IF;
  -- attacher_run sur une ligne close : sans effet
  PERFORM public.assistant_recherche_attacher_run(v_id, 'run_tardif');
  IF (SELECT run_id FROM majordhome.assistant_recherches WHERE id = v_id) IS DISTINCT FROM 'run_abc' THEN
    RAISE EXCEPTION '(attacher_run) run_id modifié sur une recherche close';
  END IF;
  -- en_cours() : la close n'y est plus, l'ouverte v_id2 y est
  IF EXISTS (SELECT 1 FROM public.assistant_recherches_en_cours() x WHERE x.id = v_id) THEN
    RAISE EXCEPTION '(en_cours) une recherche close est listée';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assistant_recherches_en_cours() x WHERE x.id = v_id2) THEN
    RAISE EXCEPTION '(en_cours) une recherche ouverte n''est pas listée';
  END IF;

  -- ── 3. clore : statut hors terminee|echec refusé ─────────────────────────────────────────────────────────
  FOREACH p IN ARRAY ARRAY['en_cours', 'termine', ''] LOOP
    v_ok := false;
    BEGIN
      PERFORM public.assistant_recherche_clore(v_id2, p, NULL, NULL, NULL, NULL);
    EXCEPTION WHEN invalid_parameter_value THEN v_ok := (SQLERRM = 'statut_invalide');
    END;
    IF NOT v_ok THEN RAISE EXCEPTION '(3) clore accepte le statut « % »', p; END IF;
  END LOOP;
  v_ok := false;
  BEGIN
    PERFORM public.assistant_recherche_clore(v_id2, NULL, NULL, NULL, NULL, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := (SQLERRM = 'statut_invalide');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(3) clore accepte un statut NULL'; END IF;
  IF (SELECT statut FROM majordhome.assistant_recherches WHERE id = v_id2) <> 'en_cours' THEN
    RAISE EXCEPTION '(3) un statut refusé a modifié la ligne';
  END IF;

  -- ── 4. EXECUTE : ni anon ni authenticated, service_role toutes ──────────────────────────────────────────
  FOREACH f IN ARRAY v_fonctions LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(r, f, 'EXECUTE') THEN RAISE EXCEPTION '(4) % peut exécuter %', r, f; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION '(4) service_role ne peut pas exécuter %', f; END IF;
    IF (SELECT p2.prosecdef FROM pg_proc p2 WHERE p2.oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '(4) % n''est pas SECURITY DEFINER', f; END IF;
  END LOOP;

  -- ── 5. privilèges de table et de vue, RLS, aucune policy d'écriture ─────────────────────────────────────
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'majordhome.assistant_recherches', p) THEN RAISE EXCEPTION '(5) anon a % sur la table', p; END IF;
    IF has_table_privilege('anon', 'public.majordhome_assistant_recherches', p) THEN RAISE EXCEPTION '(5) anon a % sur la vue', p; END IF;
    IF has_table_privilege('anon', 'majordhome.assistant_quotas', p) THEN RAISE EXCEPTION '(5) anon a % sur les quotas', p; END IF;
    IF has_table_privilege('authenticated', 'majordhome.assistant_quotas', p) THEN RAISE EXCEPTION '(5) authenticated a % sur les quotas', p; END IF;
    IF p <> 'SELECT' AND has_table_privilege('authenticated', 'public.majordhome_assistant_recherches', p) THEN
      RAISE EXCEPTION '(5) authenticated a % sur la vue', p;
    END IF;
    IF p <> 'SELECT' AND has_table_privilege('authenticated', 'majordhome.assistant_recherches', p) THEN
      RAISE EXCEPTION '(5) authenticated a % sur la table', p;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_assistant_recherches', 'SELECT') THEN RAISE EXCEPTION '(5) authenticated sans SELECT sur la vue'; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_assistant_recherches', 'SELECT') THEN RAISE EXCEPTION '(5) service_role sans SELECT sur la vue'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.assistant_recherches', 'SELECT') THEN RAISE EXCEPTION '(5) service_role sans SELECT sur la table'; END IF;
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'majordhome.assistant_recherches'::regclass) IS NOT TRUE
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'majordhome.assistant_quotas'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION '(5) RLS non activée';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'assistant_recherches' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '(5) une policy d''écriture existe sur la table';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'assistant_quotas') THEN
    RAISE EXCEPTION '(5) une policy existe sur les quotas';
  END IF;
  IF (SELECT array_to_string(c.reloptions, ',') FROM pg_class c WHERE c.oid = 'public.majordhome_assistant_recherches'::regclass) NOT LIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION '(5) vue sans security_invoker';
  END IF;

  -- ── 6. lecture par la vue : membre oui, autre org non ───────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_membre, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_assistant_recherches v WHERE v.id = v_id AND v.created_by_name IS NOT DISTINCT FROM
    (SELECT pr.full_name FROM public.profiles pr WHERE pr.id = v_membre);
  IF v_n <> 1 THEN RAISE EXCEPTION '(6) le membre ne lit pas sa recherche par la vue (% ligne)', v_n; END IF;
  v_ok := false;
  BEGIN
    UPDATE majordhome.assistant_recherches SET statut = 'echec' WHERE id = v_id2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_ok := (v_n = 0);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(6) un membre modifie une recherche en direct'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_etranger, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_assistant_recherches v WHERE v.org_id = v_mayer;
  IF v_n <> 0 THEN RAISE EXCEPTION '(6) un utilisateur d''une autre org voit % recherche(s) Mayer', v_n; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM public.majordhome_assistant_recherches;
  IF v_n <> 0 THEN RAISE EXCEPTION '(6) un appel sans utilisateur voit % recherche(s)', v_n; END IF;
  SET LOCAL ROLE postgres;

  -- ── 7. quota : le 11ᵉ appel du jour lève P0001 ──────────────────────────────────────────────────────────
  FOR i IN 1..10 LOOP
    PERFORM public.increment_assistant_quota(v_membre, v_mayer);
  END LOOP;
  v_ok := false;
  BEGIN
    PERFORM public.increment_assistant_quota(v_membre, v_mayer);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM = 'assistant_quota_exceeded');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(7) le 11ᵉ appel du jour passe'; END IF;
  -- 7 bis. limite NULL explicite (un `null` JS n'est pas omis : le DEFAULT ne joue pas) → ramenée à 10, plafond fermé.
  -- Compteur distinct (autre utilisateur, autre org) pour repartir de zéro.
  FOR i IN 1..10 LOOP
    PERFORM public.increment_assistant_quota(v_etranger, v_autre, NULL);
  END LOOP;
  v_ok := false;
  BEGIN
    PERFORM public.increment_assistant_quota(v_etranger, v_autre, NULL);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM = 'assistant_quota_exceeded');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(7 bis) limite NULL : le 11ᵉ appel du jour passe'; END IF;

  -- ── 8. droit assistant_pieces/use vrai pour les trois rôles ────────────────────────────────────────────
  IF (SELECT count(*) FROM majordhome.app_role_permissions
      WHERE resource = 'assistant_pieces' AND action = 'use' AND allowed AND role IN ('team_leader', 'commercial', 'technicien')) <> 3 THEN
    RAISE EXCEPTION '(8) assistant_pieces/use absent ou faux pour un des trois rôles';
  END IF;

  -- ── Nettoyage ────────────────────────────────────────────────────────────────────────────────────────────
  DELETE FROM majordhome.assistant_recherches WHERE equipment_id = v_eq;
  DELETE FROM majordhome.assistant_quotas WHERE (user_id = v_membre AND org_id = v_mayer) OR (user_id = v_etranger AND org_id = v_autre);
  DELETE FROM majordhome.interventions WHERE id IN (v_inter, v_inter_a, v_inter_ct);
  DELETE FROM majordhome.contracts WHERE id = v_ct;
  RAISE NOTICE 'assert-assistant-pieces : OK';
END $$;
