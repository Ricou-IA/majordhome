-- assert-m2.sql — vérifie M1 + M2 (20260913_1 puis 20260920_1) sur le cluster de répétition.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  n int; v_proj uuid; v_pac uuid; v_id uuid; v_cat uuid; v_admin uuid; v_antoine uuid; r record; ok boolean;
BEGIN
  -- Structures
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace WHERE ns.nspname = 'majordhome' AND t.typname = 'equipment_category') THEN
    RAISE EXCEPTION 'enum equipment_category existe encore'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'equipments' AND column_name = 'category') THEN
    RAISE EXCEPTION 'equipments.category existe encore'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'pricing_equipment_types' AND column_name = 'equipment_category') THEN
    RAISE EXCEPTION 'pricing_equipment_types.equipment_category existe encore'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'pricing_equipment_types' AND column_name = 'category') THEN
    RAISE EXCEPTION 'pricing_equipment_types.category (code dénormalisé) a disparu : 4 vues en dépendent'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'team_members' AND column_name = 'specialties') THEN
    RAISE EXCEPTION 'team_members.specialties existe encore'; END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'majordhome' AND viewname IN ('v_planning', 'v_equipments_maintenance')) THEN
    RAISE EXCEPTION 'vues mortes encore présentes'; END IF;

  -- Vues recréées : security_invoker + colonnes attendues + GRANT
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' AND viewname IN ('majordhome_equipments', 'majordhome_pricing_equipment_types', 'majordhome_team_members', 'majordhome_client_equipment_kinds', 'majordhome_equipment_categories', 'majordhome_team_member_skills')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relname = r.viewname AND c.reloptions::text ILIKE '%security_invoker=true%') THEN
      RAISE EXCEPTION 'vue % sans security_invoker', r.viewname; END IF;
    IF NOT has_table_privilege('service_role', 'public.' || r.viewname, 'SELECT') OR NOT has_table_privilege('authenticated', 'public.' || r.viewname, 'SELECT') THEN
      RAISE EXCEPTION 'vue % : GRANT manquant', r.viewname; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_equipments' AND column_name = 'category_id') THEN
    RAISE EXCEPTION 'majordhome_equipments sans category_id'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_team_members' AND column_name = 'specialties') THEN
    RAISE EXCEPTION 'majordhome_team_members expose encore specialties'; END IF;
  -- La vue miroir reste updatable (PostgREST écrit à travers)
  IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_equipments' AND is_insertable_into = 'YES') THEN
    RAISE EXCEPTION 'majordhome_equipments n''est plus updatable'; END IF;

  -- RPC : une seule signature (3 paramètres), anon révoqué
  SELECT count(*) INTO n FROM pg_proc WHERE proname = 'team_member_set_routing_settings';
  IF n <> 1 THEN RAISE EXCEPTION 'team_member_set_routing_settings : % signature(s), attendu 1', n; END IF;
  IF has_function_privilege('anon', 'public.team_member_set_routing_settings(uuid, integer, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon peut exécuter team_member_set_routing_settings'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.team_member_set_routing_settings(uuid, integer, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ne peut pas exécuter team_member_set_routing_settings'; END IF;

  -- Données intactes
  SELECT count(*) INTO n FROM majordhome.equipments WHERE category_id IS NOT NULL;
  IF n <> 903 THEN RAISE EXCEPTION 'équipements catégorisés attendu 903, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.team_member_skills;
  IF n <> 84 THEN RAISE EXCEPTION 'compétences attendu 84, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.pricing_equipment_types pet JOIN majordhome.equipment_categories ec ON ec.id = pet.category_id WHERE pet.category IS DISTINCT FROM ec.code;
  IF n <> 0 THEN RAISE EXCEPTION 'pet.category ≠ code sur % types', n; END IF;

  -- Trigger sans branche legacy : INSERT typé → catégorie dérivée
  SELECT p.id INTO v_proj FROM core.projects p WHERE p.org_id = v_mayer LIMIT 1;
  SELECT id INTO v_pac FROM majordhome.pricing_equipment_types WHERE org_id = v_mayer AND code = 'pac_air_air';
  INSERT INTO majordhome.equipments (project_id, equipment_type_id) VALUES (v_proj, v_pac) RETURNING id, category_id INTO v_id, v_cat;
  IF v_cat IS DISTINCT FROM (SELECT category_id FROM majordhome.pricing_equipment_types WHERE id = v_pac) THEN
    RAISE EXCEPTION 'trigger M2 : catégorie non dérivée'; END IF;
  DELETE FROM majordhome.equipments WHERE id = v_id;
  -- INSERT à travers la vue publique (chemin PostgREST) : sans type ni catégorie → non catégorisé
  INSERT INTO public.majordhome_equipments (project_id) VALUES (v_proj) RETURNING id, category_id INTO v_id, v_cat;
  IF v_cat IS NOT NULL THEN RAISE EXCEPTION 'vue : équipement sans type devrait être non catégorisé'; END IF;
  DELETE FROM majordhome.equipments WHERE id = v_id;

  -- RPC routing à 3 paramètres fonctionne
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role = 'org_admin' AND om.user_id IS NOT NULL LIMIT 1;
  SELECT tm.id INTO v_antoine FROM majordhome.team_members tm WHERE tm.first_name ILIKE 'Antoine' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  SELECT count(*) INTO n FROM public.team_member_set_routing_settings(v_antoine, 480, true);
  IF n <> 1 THEN RAISE EXCEPTION 'routing settings : attendu 1 ligne, trouvé %', n; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', false);

  -- process_web_entretien toujours fonctionnel (site vitrine)
  SELECT * INTO r FROM public.process_web_entretien(
    v_mayer, 'Test', 'M2', 'test-m2@example.invalid', '0600000001', '2 rue du Test', '81600', 'Gaillac',
    NULL, '[{"type":"pac_air_air","label":"PAC","quantity":1}]'::jsonb, 150, 150, 0, 0, NULL, '[{"label":"PAC","price":150}]'::jsonb, NULL);
  IF r.out_contract_id IS NULL THEN RAISE EXCEPTION 'process_web_entretien KO après M2'; END IF;
  SELECT count(*) INTO n FROM majordhome.equipments e JOIN majordhome.contract_equipments ce ON ce.equipment_id = e.id
   WHERE ce.contract_id = r.out_contract_id AND e.category_id = (SELECT category_id FROM majordhome.pricing_equipment_types WHERE id = v_pac);
  IF n <> 1 THEN RAISE EXCEPTION 'process_web_entretien : équipement web non catégorisé après M2'; END IF;

  RAISE NOTICE 'M2 OK : enum supprimé, colonnes legacy retirées, vues recréées (invoker + GRANT + updatable), RPC 3 paramètres, données intactes';
END $$;
