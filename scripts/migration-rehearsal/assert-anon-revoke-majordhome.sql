-- assert-anon-revoke-majordhome.sql — vérifie 20261029_1_anon_revoke_majordhome.sql.
-- anon n'a plus AUCUN privilège sur les tables, vues et séquences du schéma majordhome ni sur les vues public.majordhome_*,
-- l'ACL par défaut du schéma ne l'accorde plus (une table créée après coup naît sans anon), et le refus est effectif
-- (SET ROLE anon ⇒ insufficient_privilege). Non-régression : authenticated et service_role gardent ce qu'ils avaient.
-- Le harnais rejoue les ACL par défaut de la prod (bootstrap-pre.sql : majordhome anon/authenticated = arwd, public ALL),
-- pas les ACL par objet : ce qui est prouvé ici est l'effet du REVOKE sur un état « tout ouvert », donc a fortiori sur la prod.
DO $$
DECLARE v_n int; v_liste text; ok boolean;
BEGIN
  -- 1. Tables et vues du schéma majordhome
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_n, v_liste
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'majordhome' AND c.relkind IN ('r', 'v', 'm', 'p')
    AND (has_any_column_privilege('anon', c.oid, 'SELECT') OR has_any_column_privilege('anon', c.oid, 'INSERT')
         OR has_any_column_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')
         OR has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'REFERENCES')
         OR has_table_privilege('anon', c.oid, 'TRIGGER'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'anon a encore un privilège sur % relation(s) majordhome : %', v_n, v_liste; END IF;

  -- 2. Séquences du schéma majordhome
  SELECT count(*), string_agg(c.relname, ', ') INTO v_n, v_liste
  FROM (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'majordhome' AND c.relkind = 'S') c
  WHERE has_sequence_privilege('anon', c.oid, 'USAGE') OR has_sequence_privilege('anon', c.oid, 'SELECT') OR has_sequence_privilege('anon', c.oid, 'UPDATE');
  IF v_n <> 0 THEN RAISE EXCEPTION 'anon a encore un privilège sur % séquence(s) majordhome : %', v_n, v_liste; END IF;

  -- 3. Vues public.majordhome_*
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_n, v_liste
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') AND c.relname LIKE 'majordhome\_%'
    AND (has_any_column_privilege('anon', c.oid, 'SELECT') OR has_any_column_privilege('anon', c.oid, 'INSERT')
         OR has_any_column_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'anon a encore un privilège sur % vue(s) public.majordhome_* : %', v_n, v_liste; END IF;

  -- 4. ACL par défaut du schéma majordhome : plus d'entrée anon (tables ni séquences)
  IF EXISTS (SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
             WHERE n.nspname = 'majordhome' AND d.defaclacl::text ~ '(^|[{,])anon=') THEN
    RAISE EXCEPTION 'pg_default_acl du schéma majordhome accorde encore quelque chose à anon';
  END IF;
  -- … et une table créée après la migration naît sans anon
  CREATE TABLE majordhome._assert_anon_defaut (id int);
  IF has_any_column_privilege('anon', 'majordhome._assert_anon_defaut', 'SELECT') OR has_table_privilege('anon', 'majordhome._assert_anon_defaut', 'INSERT') THEN
    DROP TABLE majordhome._assert_anon_defaut;
    RAISE EXCEPTION 'une table majordhome créée après la migration reçoit encore des privilèges anon par défaut';
  END IF;
  IF NOT has_table_privilege('authenticated', 'majordhome._assert_anon_defaut', 'SELECT') THEN
    DROP TABLE majordhome._assert_anon_defaut;
    RAISE EXCEPTION 'le défaut authenticated du schéma majordhome a été perdu (régression)';
  END IF;
  DROP TABLE majordhome._assert_anon_defaut;

  -- 5. Non-régression : authenticated / service_role / baikal_reader inchangés sur des objets témoins
  IF NOT has_table_privilege('authenticated', 'majordhome.clients', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.majordhome_product_documents', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'majordhome.product_documents', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated a perdu un privilège (régression)';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_product_documents', 'SELECT') THEN
    RAISE EXCEPTION 'service_role a perdu SELECT sur public.majordhome_product_documents (régression)';
  END IF;
  IF NOT has_table_privilege('baikal_reader', 'majordhome.clients', 'SELECT') THEN
    RAISE EXCEPTION 'baikal_reader a perdu SELECT sur majordhome.clients (régression)';
  END IF;

  -- 6. Refus effectif
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN
    PERFORM 1 FROM public.majordhome_product_documents LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'anon lit public.majordhome_product_documents'; END IF;
  ok := false;
  BEGIN
    PERFORM 1 FROM majordhome.clients LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'anon lit majordhome.clients'; END IF;
  ok := false;
  BEGIN
    INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'pirate', true);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'anon écrit dans majordhome.suppliers'; END IF;
  RESET ROLE;

  RAISE NOTICE 'assert-anon-revoke-majordhome : OK';
END $$;
