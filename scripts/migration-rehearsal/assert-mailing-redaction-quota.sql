-- assert-mailing-redaction-quota.sql — vérifie 20261122_4_mailing_redaction_quota.sql (plafond de la rédaction
-- assistée des e-mails). Fonction réservée à service_role, table sans droit ni policy pour les rôles applicatifs.
-- Fixtures : un membre de Mayer et un membre d'une autre org ; compteurs supprimés en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_membre uuid;
  v_etranger uuid;
  v_ok boolean;
  v_res jsonb;
  f text := 'public.increment_mailing_redaction_quota(uuid, uuid, integer)';
  r text;
  p text;
BEGIN
  SELECT om.user_id INTO v_membre FROM core.organization_members om WHERE om.org_id = v_mayer LIMIT 1;
  SELECT om.org_id, om.user_id INTO v_autre, v_etranger FROM core.organization_members om
  WHERE om.org_id <> v_mayer
    AND NOT EXISTS (SELECT 1 FROM core.organization_members m2 WHERE m2.user_id = om.user_id AND m2.org_id = v_mayer)
  LIMIT 1;
  IF v_membre IS NULL OR v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : il faut un membre Mayer et un membre d''une autre org'; END IF;

  -- 1. EXECUTE : ni anon ni authenticated (PUBLIC retiré), service_role oui, SECURITY DEFINER, search_path fixé
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, f, 'EXECUTE') THEN RAISE EXCEPTION '(1) % peut exécuter la fonction', r; END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION '(1) service_role ne peut pas exécuter'; END IF;
  IF (SELECT p2.prosecdef FROM pg_proc p2 WHERE p2.oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '(1) pas SECURITY DEFINER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p2 WHERE p2.oid = f::regprocedure AND p2.proconfig::text LIKE '%search_path=majordhome, public%') THEN
    RAISE EXCEPTION '(1) search_path non fixé';
  END IF;

  -- 2. table : RLS activée, aucun droit pour anon / authenticated, aucune policy
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'majordhome.mailing_redaction_quotas'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION '(2) RLS non activée';
  END IF;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(r, 'majordhome.mailing_redaction_quotas', p) THEN RAISE EXCEPTION '(2) % a % sur la table', r, p; END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'majordhome.mailing_redaction_quotas', 'SELECT') THEN RAISE EXCEPTION '(2) service_role sans SELECT'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'mailing_redaction_quotas') THEN
    RAISE EXCEPTION '(2) la table porte une policy';
  END IF;

  -- 3. appels sans utilisateur ou sans org refusés
  v_ok := false;
  BEGIN PERFORM public.increment_mailing_redaction_quota(NULL, v_mayer, 3);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION '(3) utilisateur NULL accepté'; END IF;
  v_ok := false;
  BEGIN PERFORM public.increment_mailing_redaction_quota(v_membre, NULL, 3);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION '(3) org NULL acceptée'; END IF;

  -- 4. plafond : le 4ᵉ appel d'une limite à 3 lève P0001 ; les trois premiers rendent le compte
  v_res := public.increment_mailing_redaction_quota(v_membre, v_mayer, 3);
  IF (v_res->>'count')::int <> 1 OR (v_res->>'limit')::int <> 3 THEN RAISE EXCEPTION '(4) premier appel : %', v_res; END IF;
  PERFORM public.increment_mailing_redaction_quota(v_membre, v_mayer, 3);
  v_res := public.increment_mailing_redaction_quota(v_membre, v_mayer, 3);
  IF (v_res->>'count')::int <> 3 THEN RAISE EXCEPTION '(4) troisième appel : %', v_res; END IF;
  v_ok := false;
  BEGIN PERFORM public.increment_mailing_redaction_quota(v_membre, v_mayer, 3);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM = 'mailing_redaction_quota_exceeded'); END;
  IF NOT v_ok THEN RAISE EXCEPTION '(4) le 4ᵉ appel d''une limite à 3 passe'; END IF;

  -- 5. compteur propre à l'utilisateur ET à l'org : un autre compte repart de zéro
  v_res := public.increment_mailing_redaction_quota(v_etranger, v_autre, 3);
  IF (v_res->>'count')::int <> 1 THEN RAISE EXCEPTION '(5) le compteur d''un autre compte n''est pas indépendant : %', v_res; END IF;

  -- 6. limite NULL ou négative : ramenée à 50 (jamais de plafond ouvert) ; limite 0 : le premier appel est refusé
  v_res := public.increment_mailing_redaction_quota(v_etranger, v_autre, NULL);
  IF (v_res->>'limit')::int <> 50 THEN RAISE EXCEPTION '(6) limite NULL non ramenée à 50 : %', v_res; END IF;
  v_res := public.increment_mailing_redaction_quota(v_etranger, v_autre, -4);
  IF (v_res->>'limit')::int <> 50 THEN RAISE EXCEPTION '(6) limite négative non ramenée à 50 : %', v_res; END IF;
  v_res := public.increment_mailing_redaction_quota(v_etranger, v_autre);
  IF (v_res->>'limit')::int <> 50 THEN RAISE EXCEPTION '(6) défaut différent de 50 : %', v_res; END IF;
  v_ok := false;
  BEGIN PERFORM public.increment_mailing_redaction_quota(v_membre, v_autre, 0);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION '(6) limite 0 : le premier appel passe'; END IF;

  DELETE FROM majordhome.mailing_redaction_quotas
  WHERE (user_id = v_membre AND org_id IN (v_mayer, v_autre)) OR (user_id = v_etranger AND org_id = v_autre);
  RAISE NOTICE 'assert-mailing-redaction-quota : OK';
END $$;
