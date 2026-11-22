-- Assertions de 20261122_2 — numéros de client sans troncature au-delà de 99 999.
-- Lancé AVANT la migration, ce fichier doit échouer (défaut d'origine : « CLI-10000 » au numéro 100 000).

-- 1. Les numéros déjà attribués ne changent pas de forme, et on garde leur empreinte pour la fin.
CREATE TEMP TABLE zz_cn_avant AS
  SELECT count(*) AS n, md5(string_agg(id::text || client_number, ',' ORDER BY id)) AS empreinte
    FROM majordhome.clients;

-- 2. Le défaut de la colonne passe par la fonction, et les droits sont ceux attendus.
DO $$
DECLARE
  v_defaut text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_defaut
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'majordhome.clients'::regclass AND a.attname = 'client_number';
  IF v_defaut IS DISTINCT FROM 'majordhome.client_number_suivant()' THEN
    RAISE EXCEPTION 'défaut inattendu de client_number : %', v_defaut;
  END IF;

  IF has_function_privilege('anon', 'majordhome.client_number_suivant()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon peut exécuter client_number_suivant';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = 'majordhome.client_number_suivant()'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC peut exécuter client_number_suivant';
  END IF;
  IF has_function_privilege('authenticated', 'majordhome.client_number_suivant()', 'EXECUTE') IS NOT TRUE
     OR has_function_privilege('service_role', 'majordhome.client_number_suivant()', 'EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'authenticated ou service_role ne peut pas exécuter client_number_suivant : toute création de client échouerait';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'majordhome.client_number_suivant()'::regprocedure) THEN
    RAISE EXCEPTION 'client_number_suivant ne doit pas être SECURITY DEFINER';
  END IF;
END $$;

-- 3. Sous 100 000 : la forme à cinq chiffres est inchangée.
DO $$
DECLARE
  v_org uuid;
  v_p   uuid;
  v_num text;
BEGIN
  SELECT id INTO v_org FROM core.organizations ORDER BY id LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'aucune organisation dans la photo'; END IF;

  -- Un numéro libre, loin de ceux de la photo (qui s'arrêtent sous 10 000).
  PERFORM setval('majordhome.client_number_seq', 41999);
  INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'NUMERO 42000', 'active') RETURNING id INTO v_p;
  INSERT INTO majordhome.clients (project_id, org_id, display_name) VALUES (v_p, v_org, 'NUMERO 42000')
    RETURNING client_number INTO v_num;
  IF v_num IS DISTINCT FROM 'CLI-42000' THEN
    RAISE EXCEPTION 'sous 100 000 : attendu CLI-42000, obtenu %', v_num;
  END IF;
END $$;

-- 4. Le passage de 99 999 à 100 000, puis au-delà : aucun numéro tronqué, aucune erreur d'unicité.
DO $$
DECLARE
  v_org uuid;
  v_p   uuid;
  v_num text;
  v_attendus text[] := ARRAY['CLI-99999', 'CLI-100000', 'CLI-100001'];
  i int;
BEGIN
  SELECT id INTO v_org FROM core.organizations ORDER BY id LIMIT 1;

  -- « CLI-10000 » doit exister : c'est sur lui que le défaut d'origine venait buter au numéro 100 000.
  IF NOT EXISTS (SELECT 1 FROM majordhome.clients WHERE client_number = 'CLI-10000') THEN
    PERFORM setval('majordhome.client_number_seq', 9999);
    INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'NUMERO 10000', 'active') RETURNING id INTO v_p;
    INSERT INTO majordhome.clients (project_id, org_id, display_name) VALUES (v_p, v_org, 'NUMERO 10000')
      RETURNING client_number INTO v_num;
    IF v_num IS DISTINCT FROM 'CLI-10000' THEN
      RAISE EXCEPTION 'préparation : attendu CLI-10000, obtenu %', v_num;
    END IF;
  END IF;

  PERFORM setval('majordhome.client_number_seq', 99998);
  FOR i IN 1..3 LOOP
    INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'NUMERO SEUIL ' || i, 'active') RETURNING id INTO v_p;
    INSERT INTO majordhome.clients (project_id, org_id, display_name) VALUES (v_p, v_org, 'NUMERO SEUIL ' || i)
      RETURNING client_number INTO v_num;
    IF v_num IS DISTINCT FROM v_attendus[i] THEN
      RAISE EXCEPTION 'au seuil : attendu %, obtenu %', v_attendus[i], v_num;
    END IF;
  END LOOP;

  -- Très au-delà : la colonne (varchar 20) tient.
  PERFORM setval('majordhome.client_number_seq', 123456788);
  INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'NUMERO LOIN', 'active') RETURNING id INTO v_p;
  INSERT INTO majordhome.clients (project_id, org_id, display_name) VALUES (v_p, v_org, 'NUMERO LOIN')
    RETURNING client_number INTO v_num;
  IF v_num IS DISTINCT FROM 'CLI-123456789' THEN
    RAISE EXCEPTION 'loin du seuil : attendu CLI-123456789, obtenu %', v_num;
  END IF;
END $$;

-- 5. Le rôle de l'application peut tirer un numéro (droit sur la fonction ET sur la séquence).
DO $$
DECLARE
  v_num text;
BEGIN
  PERFORM setval('majordhome.client_number_seq', 200000);
  SET LOCAL ROLE authenticated;
  v_num := majordhome.client_number_suivant();
  RESET ROLE;
  IF v_num IS DISTINCT FROM 'CLI-200001' THEN
    RAISE EXCEPTION 'sous le rôle authenticated : attendu CLI-200001, obtenu %', v_num;
  END IF;
END $$;

-- 6. Aucun numéro existant n'a été touché.
DO $$
DECLARE
  v_n int;
  v_empreinte text;
  v_avant record;
BEGIN
  SELECT * INTO v_avant FROM zz_cn_avant;
  SELECT count(*), md5(string_agg(id::text || client_number, ',' ORDER BY id)) INTO v_n, v_empreinte
    FROM majordhome.clients WHERE display_name NOT LIKE 'NUMERO %';
  IF v_n IS DISTINCT FROM v_avant.n::int OR v_empreinte IS DISTINCT FROM v_avant.empreinte THEN
    RAISE EXCEPTION 'des numéros existants ont changé (% fiches avant, % après)', v_avant.n, v_n;
  END IF;
  RAISE NOTICE 'numéros de client sans troncature OK (% fiches existantes inchangées)', v_n;
END $$;
