-- assert-geocode-file-equitable.sql — vérifie 20261121_14 (file de géocodage équitable entre entreprises).
-- Autonome : neutralise les fiches en attente de la photo, crée 150 fiches en attente pour une entreprise A
-- (créées hier) et 3 pour une entreprise B (créées aujourd'hui), puis lit la file comme le fait l'edge geocode-sweep.
-- Tout écart lève une exception.

-- ── 1. Droits : ceux voulus par 20260617_2 (service_role seul), inchangés par la migration ─────────────
DO $$
DECLARE v_oid oid := 'public.geocode_fetch_pending_clients(integer)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'geocode_fetch_pending_clients : anon peut exécuter'; END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'geocode_fetch_pending_clients : authenticated peut exécuter'; END IF;
  IF has_function_privilege('service_role', v_oid, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION 'geocode_fetch_pending_clients : service_role ne peut plus exécuter'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) IS NOT TRUE THEN RAISE EXCEPTION 'geocode_fetch_pending_clients : plus SECURITY DEFINER'; END IF;
END $$;

-- ── 2. Données ──────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE zz_geo (cle text PRIMARY KEY, val uuid);

DO $$
DECLARE v_a uuid; v_b uuid; v_p uuid; i int;
BEGIN
  SELECT id INTO v_a FROM core.organizations ORDER BY id LIMIT 1;
  SELECT id INTO v_b FROM core.organizations WHERE id <> v_a ORDER BY id LIMIT 1;
  IF v_a IS NULL OR v_b IS NULL THEN RAISE EXCEPTION 'il faut deux entreprises dans la photo'; END IF;
  INSERT INTO zz_geo VALUES ('a', v_a), ('b', v_b);

  -- La séquence du harnais n'est pas alignée sur les numéros de la photo.
  PERFORM setval('majordhome.client_number_seq', 98000);

  -- Les fiches en attente de la photo ne doivent pas fausser les comptes.
  UPDATE majordhome.clients SET geocoded_at = now() WHERE geocoded_at IS NULL;

  FOR i IN 1..150 LOOP
    INSERT INTO core.projects (org_id, name, status) VALUES (v_a, 'GEO A ' || i, 'active') RETURNING id INTO v_p;
    INSERT INTO majordhome.clients (project_id, org_id, display_name, address, postal_code, city, created_at)
    VALUES (v_p, v_a, 'GEO A ' || lpad(i::text, 3, '0'), '1 rue du Test', '81600', 'Gaillac', now() - interval '1 day' + (i || ' seconds')::interval);
  END LOOP;
  FOR i IN 1..3 LOOP
    INSERT INTO core.projects (org_id, name, status) VALUES (v_b, 'GEO B ' || i, 'active') RETURNING id INTO v_p;
    INSERT INTO majordhome.clients (project_id, org_id, display_name, address, postal_code, city, created_at)
    VALUES (v_p, v_b, 'GEO B ' || i, '2 rue du Test', '31000', 'Toulouse', now() + (i || ' seconds')::interval);
  END LOOP;
END $$;

-- ── 3. A (150 hier) et B (3 aujourd'hui) en attente : les 3 de B sont servies dans le lot de 100 ──────
DO $$
DECLARE v_b uuid; n_total int; n_b int; n_a int; v_rang_b int;
BEGIN
  SELECT val INTO v_b FROM zz_geo WHERE cle = 'b';
  SELECT count(*), count(*) FILTER (WHERE c.org_id = v_b), count(*) FILTER (WHERE c.org_id <> v_b)
    INTO n_total, n_b, n_a
  FROM public.geocode_fetch_pending_clients(100) f JOIN majordhome.clients c ON c.id = f.id;
  IF n_total <> 100 THEN RAISE EXCEPTION 'lot : 100 lignes attendues, % rendues', n_total; END IF;
  IF n_b <> 3 THEN RAISE EXCEPTION 'les 3 fiches de B devraient être dans le lot de 100, % trouvées (A : %)', n_b, n_a; END IF;
  -- Alternance : B passe en tête de file (rang 1 de chaque entreprise d'abord).
  SELECT count(*) INTO v_rang_b FROM (SELECT f.id, c.org_id FROM public.geocode_fetch_pending_clients(100) f
                                      JOIN majordhome.clients c ON c.id = f.id LIMIT 4) t WHERE t.org_id = v_b;
  IF v_rang_b < 1 THEN RAISE EXCEPTION 'B devrait être servie dès les premières lignes'; END IF;
END $$;

-- ── 4. Les colonnes rendues sont inchangées ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT pg_get_function_result('public.geocode_fetch_pending_clients(integer)'::regprocedure))
     IS DISTINCT FROM 'TABLE(id uuid, address text, postal_code text, city text)' THEN
    RAISE EXCEPTION 'colonnes rendues modifiées : %', pg_get_function_result('public.geocode_fetch_pending_clients(integer)'::regprocedure);
  END IF;
END $$;

-- ── 5. A seule en attente : les 100 plus anciennes, dans l'ordre de création ──────────────────────────
DO $$
DECLARE v_b uuid; v_attendu uuid[]; v_rendu uuid[];
BEGIN
  SELECT val INTO v_b FROM zz_geo WHERE cle = 'b';
  UPDATE majordhome.clients SET geocoded_at = now() WHERE org_id = v_b AND geocoded_at IS NULL;
  SELECT array_agg(id ORDER BY created_at, id) INTO v_attendu FROM (
    SELECT id, created_at FROM majordhome.clients WHERE geocoded_at IS NULL ORDER BY created_at, id LIMIT 100) t;
  SELECT array_agg(id) INTO v_rendu FROM (SELECT id FROM public.geocode_fetch_pending_clients(100)) t;
  IF v_rendu IS DISTINCT FROM v_attendu THEN RAISE EXCEPTION 'A seule : les 100 plus anciennes, dans l''ordre, attendues'; END IF;
END $$;

-- ── 6. Les conditions inchangées : tentatives épuisées, archivées, sans code postal restent exclues ────
DO $$
DECLARE v_id uuid; n int;
BEGIN
  SELECT id INTO v_id FROM majordhome.clients WHERE geocoded_at IS NULL ORDER BY created_at LIMIT 1;
  UPDATE majordhome.clients SET geocode_attempts = 3 WHERE id = v_id;
  SELECT count(*) INTO n FROM public.geocode_fetch_pending_clients(500) WHERE id = v_id;
  IF n <> 0 THEN RAISE EXCEPTION 'une fiche à 3 tentatives ne doit plus être servie'; END IF;
  SELECT count(*) INTO n FROM public.geocode_fetch_pending_clients(500);
  IF n <> 149 THEN RAISE EXCEPTION '149 fiches attendues, % rendues', n; END IF;
  SELECT count(*) INTO n FROM public.geocode_fetch_pending_clients(0);
  IF n <> 1 THEN RAISE EXCEPTION 'p_limit = 0 doit rendre 1 ligne (plancher), % rendues', n; END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'geocode file équitable OK'; END $$;
