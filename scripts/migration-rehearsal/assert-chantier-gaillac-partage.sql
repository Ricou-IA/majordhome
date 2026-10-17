-- assert-chantier-gaillac-partage.sql — vérifie 20261017_2_chantier_gaillac_partage.sql
-- (à jouer après 20261017_1 : --migration accepte les deux dans l'ordre via un fichier concaténé).
-- Couvre : ACL effectives, gardes de gestion (anonyme, technicien, admin), lecture anonyme
-- avec / sans / mauvais token, colonnes masquées, révocation.
CREATE OR REPLACE FUNCTION pg_temp.expect_err(p_label text, p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION '% : aucune erreur levée', p_label;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_code THEN
    RAISE EXCEPTION '% : SQLSTATE % attendu, % reçu (%)', p_label, p_code, SQLSTATE, SQLERRM;
  END IF;
END;
$f$;

DO $$
DECLARE
  v_antoine uuid := '8b2891e0-2894-4580-a4ec-89004a72e755';
  v_admin   uuid;
  v_token   text;
  v_old     text;
  v_data    jsonb;
  v_tache   jsonb;
BEGIN
  -- 1. ACL ----------------------------------------------------------------------------------
  IF has_table_privilege('anon', 'majordhome.chantier_gaillac_partage', 'SELECT')
     OR has_table_privilege('authenticated', 'majordhome.chantier_gaillac_partage', 'SELECT') THEN
    RAISE EXCEPTION 'table des liens lisible directement';
  END IF;
  IF has_function_privilege('anon', 'public.chantier_gaillac_partage_gerer(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon gère le lien';
  END IF;
  IF NOT has_function_privilege('anon', 'public.chantier_gaillac_partage_lire(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ne peut pas lire avec un lien';
  END IF;

  SELECT om.user_id INTO v_admin FROM core.organization_members om
   WHERE om.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' AND om.role = 'org_admin' LIMIT 1;

  -- 2. Gestion -----------------------------------------------------------------------------
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.expect_err('gérer anonyme', $q$SELECT public.chantier_gaillac_partage_gerer('generer')$q$, '42501');
  PERFORM set_config('request.jwt.claim.sub', v_antoine::text, true);
  PERFORM pg_temp.expect_err('gérer technicien', $q$SELECT public.chantier_gaillac_partage_gerer('generer')$q$, '42501');
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.expect_err('action inconnue', $q$SELECT public.chantier_gaillac_partage_gerer('x')$q$, '22023');
  IF public.chantier_gaillac_partage_gerer('lire') IS NOT NULL THEN RAISE EXCEPTION 'lien présent avant génération'; END IF;
  v_old := public.chantier_gaillac_partage_gerer('generer');
  v_token := public.chantier_gaillac_partage_gerer('generer');
  IF v_token !~ '^[0-9a-f]{64}$' OR v_token = v_old THEN RAISE EXCEPTION 'token invalide %', v_token; END IF;
  IF public.chantier_gaillac_partage_gerer('lire') IS DISTINCT FROM v_token THEN RAISE EXCEPTION 'lire ≠ dernier token'; END IF;

  -- 3. Lecture externe (rôle anon) -----------------------------------------------------------
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.expect_err('lire sans token', $q$SELECT public.chantier_gaillac_partage_lire(NULL)$q$, '42501');
  PERFORM pg_temp.expect_err('lire mauvais token', $q$SELECT public.chantier_gaillac_partage_lire(repeat('0', 64))$q$, '42501');
  PERFORM pg_temp.expect_err('lire ancien token', format('SELECT public.chantier_gaillac_partage_lire(%L)', v_old), '42501');
  PERFORM pg_temp.expect_err('anon lit la vue', $q$SELECT count(*) FROM public.majordhome_chantier_gaillac_taches$q$, '42501');

  v_data := public.chantier_gaillac_partage_lire(v_token);
  IF jsonb_array_length(v_data->'taches') <> 98 OR jsonb_array_length(v_data->'planning') <> 21
     OR jsonb_array_length(v_data->'techniciens') <> 2 THEN
    RAISE EXCEPTION 'lecture incomplète : % tâches, % codes, % techniciens',
      jsonb_array_length(v_data->'taches'), jsonb_array_length(v_data->'planning'), jsonb_array_length(v_data->'techniciens');
  END IF;
  FOR v_tache IN SELECT * FROM jsonb_array_elements(v_data->'taches') LOOP
    IF v_tache ?| ARRAY['duree_min', 'achat_requis', 'observations', 'commentaire_terrain', 'fait_par'] THEN
      RAISE EXCEPTION 'colonne masquée exposée : %', v_tache;
    END IF;
  END LOOP;

  -- 4. Révocation ----------------------------------------------------------------------------
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.chantier_gaillac_partage_gerer('revoquer');
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.expect_err('lire après révocation', format('SELECT public.chantier_gaillac_partage_lire(%L)', v_token), '42501');

  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'chantier gaillac partage : OK';
END $$;
