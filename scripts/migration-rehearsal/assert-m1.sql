-- assert-m1.sql — vérifie 20260913_1_referentiel_equipements_expansion.sql sur le cluster
-- de répétition (données prod du 2026-09-12). Chiffres attendus : spec §7.1.
-- Un écart lève une exception → run.mjs sort en ECHEC.

-- ── A. Comptages de reprise ────────────────────────────────────────────────
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  n int; r record;
BEGIN
  SELECT count(*) INTO n FROM majordhome.equipment_categories WHERE org_id = v_mayer;
  IF n <> 7 THEN RAISE EXCEPTION 'catégories Mayer attendu 7, trouvé %', n; END IF;

  FOR r IN SELECT * FROM (VALUES
      ('poele', 'Poêle', 'combustion_bois', 5.5, 4, 708),
      ('chaudiere_bois', 'Chaudière bois', 'combustion_bois', 5.5, 2, 69),
      ('pac_air_air', 'PAC Air/Air', 'pac', 5.5, 1, 60),
      ('pac_air_eau', 'PAC Air/Eau', 'pac', 5.5, 1, 25),
      ('climatisation', 'Climatisation', 'pac', 20, 1, 24),
      ('chauffe_eau_thermo', 'Chauffe-eau thermodynamique', 'ecs_thermo', 10, 2, 16),
      ('energie', 'Énergie', 'generique', 20, 3, 1)
    ) AS t(code, label, profile, vat, n_types, n_eq)
  LOOP
    PERFORM 1 FROM majordhome.equipment_categories ec
     WHERE ec.org_id = v_mayer AND ec.code = r.code AND ec.label = r.label
       AND ec.certificate_profile = r.profile AND ec.default_vat_rate = r.vat AND ec.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'catégorie % : libellé/profil/TVA inattendus', r.code; END IF;
    SELECT count(*) INTO n FROM majordhome.pricing_equipment_types pet
      JOIN majordhome.equipment_categories ec ON ec.id = pet.category_id WHERE ec.code = r.code AND ec.org_id = v_mayer;
    IF n <> r.n_types THEN RAISE EXCEPTION 'catégorie % : % types attendus, trouvé %', r.code, r.n_types, n; END IF;
    SELECT count(*) INTO n FROM majordhome.equipments e
      JOIN majordhome.equipment_categories ec ON ec.id = e.category_id WHERE ec.code = r.code AND ec.org_id = v_mayer;
    IF n <> r.n_eq THEN RAISE EXCEPTION 'catégorie % : % équipements attendus, trouvé %', r.code, r.n_eq, n; END IF;
  END LOOP;

  SELECT count(*) INTO n FROM majordhome.pricing_equipment_types WHERE category_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'types sans catégorie : %', n; END IF;
  -- famille → code dénormalisé
  SELECT count(*) INTO n FROM majordhome.pricing_equipment_types pet JOIN majordhome.equipment_categories ec ON ec.id = pet.category_id WHERE pet.category IS DISTINCT FROM ec.code;
  IF n <> 0 THEN RAISE EXCEPTION 'pet.category ≠ code de catégorie sur % types', n; END IF;

  SELECT count(*) INTO n FROM majordhome.equipments WHERE category_id IS NOT NULL;
  IF n <> 903 THEN RAISE EXCEPTION 'équipements catégorisés attendu 903, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.equipments WHERE category_id IS NULL;
  IF n <> 7 THEN RAISE EXCEPTION 'équipements non catégorisés attendu 7, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.equipments WHERE category_id IS NULL AND category <> 'autre';
  IF n <> 0 THEN RAISE EXCEPTION 'un équipement non catégorisé porte un enum ≠ autre (%)', n; END IF;
  SELECT count(*) INTO n FROM majordhome.equipments e JOIN majordhome.pricing_equipment_types t ON t.id = e.equipment_type_id
   WHERE e.category_id IS DISTINCT FROM t.category_id;
  IF n <> 0 THEN RAISE EXCEPTION 'invariant typé ⇒ catégorie du type violé (%)', n; END IF;
  -- l'enum legacy n'a PAS bougé (M1 ne le réécrit pas en masse)
  SELECT count(*) INTO n FROM majordhome.equipments WHERE category = 'poele';
  IF n <> 708 THEN RAISE EXCEPTION 'enum legacy poele attendu 708, trouvé %', n; END IF;

  SELECT count(*) INTO n FROM majordhome.team_member_skills;
  IF n <> 84 THEN RAISE EXCEPTION 'compétences attendu 84, trouvé %', n; END IF;
  SELECT count(DISTINCT team_member_id) INTO n FROM majordhome.team_member_skills;
  IF n <> 3 THEN RAISE EXCEPTION 'techniciens cochés attendu 3, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.team_member_skills s JOIN majordhome.team_members tm ON tm.id = s.team_member_id WHERE tm.role <> 'technician';
  IF n <> 0 THEN RAISE EXCEPTION 'des non-techniciens ont des compétences (%)', n; END IF;

  RAISE NOTICE 'A. reprise OK : 7 catégories, 14 types, 903 + 7 équipements, 84 compétences';
END $$;

-- ── B. Droits ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.team_member_set_skills(uuid, text, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon peut exécuter team_member_set_skills'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.team_member_set_skills(uuid, text, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ne peut pas exécuter team_member_set_skills'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.equipment_categories', 'SELECT') THEN
    RAISE EXCEPTION 'service_role sans SELECT sur equipment_categories'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.team_member_skills', 'SELECT') THEN
    RAISE EXCEPTION 'service_role sans SELECT sur team_member_skills'; END IF;
  IF has_table_privilege('anon', 'majordhome.equipment_categories', 'SELECT') THEN
    RAISE EXCEPTION 'anon a SELECT sur equipment_categories'; END IF;
  IF has_table_privilege('anon', 'majordhome.team_member_skills', 'SELECT') THEN
    RAISE EXCEPTION 'anon a SELECT sur team_member_skills'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.team_member_skills', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated a INSERT direct sur team_member_skills (doit passer par la RPC)'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_equipment_categories', 'SELECT') THEN
    RAISE EXCEPTION 'anon a SELECT sur la vue majordhome_equipment_categories'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_team_member_skills', 'SELECT') THEN
    RAISE EXCEPTION 'anon a SELECT sur la vue majordhome_team_member_skills'; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_client_equipment_kinds', 'SELECT') THEN
    RAISE EXCEPTION 'service_role sans SELECT sur majordhome_client_equipment_kinds (re-GRANT manquant)'; END IF;
  RAISE NOTICE 'B. droits OK';
END $$;

-- ── C. RPC team_member_set_skills : gardes ─────────────────────────────────
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_non_admin uuid; v_antoine uuid; v_pac uuid; v_poele uuid;
  n int; ok boolean;
BEGIN
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role = 'org_admin' AND om.user_id IS NOT NULL LIMIT 1;
  SELECT om.user_id INTO v_non_admin FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role IS DISTINCT FROM 'org_admin' AND om.user_id IS NOT NULL LIMIT 1;
  SELECT tm.id INTO v_antoine FROM majordhome.team_members tm WHERE tm.first_name ILIKE 'Antoine' LIMIT 1;
  SELECT id INTO v_pac FROM majordhome.pricing_equipment_types WHERE org_id = v_mayer AND code = 'pac_air_air';
  SELECT id INTO v_poele FROM majordhome.pricing_equipment_types WHERE org_id = v_mayer AND code = 'poele_bois_insert';
  IF v_admin IS NULL OR v_non_admin IS NULL OR v_antoine IS NULL OR v_pac IS NULL OR v_poele IS NULL THEN
    RAISE EXCEPTION 'fixtures introuvables (admin %, non-admin %, antoine %, pac %, poele %)', v_admin, v_non_admin, v_antoine, v_pac, v_poele;
  END IF;

  -- (d) sans claim → 42501
  PERFORM set_config('request.jwt.claim.sub', '', false);
  ok := false;
  BEGIN
    PERFORM public.team_member_set_skills(v_antoine, 'entretien', ARRAY[v_pac]);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(d) appel anonyme accepté'; END IF;

  -- (c) membre non admin → 42501
  PERFORM set_config('request.jwt.claim.sub', v_non_admin::text, false);
  ok := false;
  BEGIN
    PERFORM public.team_member_set_skills(v_antoine, 'entretien', ARRAY[v_pac]);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(c) non-admin accepté'; END IF;

  -- (a) admin : remplacement atomique → 1 ligne entretien, pose intacte (14)
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  SELECT count(*) INTO n FROM public.team_member_set_skills(v_antoine, 'entretien', ARRAY[v_pac, v_pac]);
  IF n <> 1 THEN RAISE EXCEPTION '(a) attendu 1 type écrit (dédoublonné), trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.team_member_skills WHERE team_member_id = v_antoine AND role = 'entretien';
  IF n <> 1 THEN RAISE EXCEPTION '(a) entretien attendu 1 ligne, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.team_member_skills WHERE team_member_id = v_antoine AND role = 'pose';
  IF n <> 14 THEN RAISE EXCEPTION '(a) pose devait rester à 14, trouvé %', n; END IF;

  -- (b) un uuid étranger dans la liste → 23514, rien n'est écrit
  ok := false;
  BEGIN
    PERFORM public.team_member_set_skills(v_antoine, 'entretien', ARRAY[v_pac, gen_random_uuid()]);
  EXCEPTION WHEN SQLSTATE '23514' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(b) type étranger accepté'; END IF;
  SELECT count(*) INTO n FROM majordhome.team_member_skills WHERE team_member_id = v_antoine AND role = 'entretien';
  IF n <> 1 THEN RAISE EXCEPTION '(b) l''échec a modifié les compétences (%)', n; END IF;

  -- rôle inconnu → 22023 ; rôle NULL → 22023
  ok := false;
  BEGIN PERFORM public.team_member_set_skills(v_antoine, 'installation', ARRAY[v_pac]); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'rôle inconnu accepté'; END IF;
  ok := false;
  BEGIN PERFORM public.team_member_set_skills(v_antoine, NULL, ARRAY[v_pac]); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'rôle NULL accepté'; END IF;

  -- tout décocher = liste vide → 0 ligne
  SELECT count(*) INTO n FROM public.team_member_set_skills(v_antoine, 'entretien', '{}'::uuid[]);
  IF n <> 0 THEN RAISE EXCEPTION 'liste vide : attendu 0, trouvé %', n; END IF;
  -- remettre Antoine « tout coché » (14) pour ne pas fausser la suite
  PERFORM public.team_member_set_skills(v_antoine, 'entretien',
    (SELECT array_agg(id) FROM majordhome.pricing_equipment_types WHERE org_id = v_mayer AND COALESCE(is_active, true)));
  SELECT count(*) INTO n FROM majordhome.team_member_skills;
  IF n <> 84 THEN RAISE EXCEPTION 'après remise à zéro attendu 84, trouvé %', n; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  RAISE NOTICE 'C. RPC OK (anonyme refusé, non-admin refusé, type étranger refusé, remplacement atomique)';
END $$;

-- ── D. RLS SELECT sur les compétences (vue security_invoker, rôle authenticated) ──
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_etranger uuid; n int;
BEGIN
  SELECT om.user_id INTO v_membre FROM core.organization_members om WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL LIMIT 1;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om WHERE om.org_id <> v_mayer AND om.user_id IS NOT NULL
    AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  IF v_etranger IS NULL THEN RAISE NOTICE 'D. aucun membre d''une autre org sans appartenance Mayer : test cross-org sauté'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.majordhome_team_member_skills;
  RESET ROLE;
  IF n <> 84 THEN RAISE EXCEPTION 'D. membre Mayer voit % compétences au lieu de 84', n; END IF;

  IF v_etranger IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_etranger::text, false);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.majordhome_team_member_skills;
    RESET ROLE;
    IF n <> 0 THEN RAISE EXCEPTION 'D. membre étranger voit % compétences Mayer', n; END IF;
  END IF;

  -- catégories : lisibles par un membre, pas par un étranger
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.majordhome_equipment_categories WHERE org_id = v_mayer;
  RESET ROLE;
  IF n <> 7 THEN RAISE EXCEPTION 'D. membre Mayer voit % catégories au lieu de 7', n; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  RAISE NOTICE 'D. RLS OK';
END $$;

-- ── E. Trigger equipments_sync_category ────────────────────────────────────
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_proj uuid; v_pac uuid; v_pv uuid; v_id uuid; v_cat uuid; v_enum text; v_energie uuid; v_poele_cat uuid; ok boolean;
BEGIN
  SELECT p.id INTO v_proj FROM core.projects p WHERE p.org_id = v_mayer LIMIT 1;
  SELECT id INTO v_pac FROM majordhome.pricing_equipment_types WHERE org_id = v_mayer AND code = 'pac_air_air';
  SELECT id INTO v_pv FROM majordhome.pricing_equipment_types WHERE org_id = v_mayer AND code = 'panneau_photovoltaique';
  SELECT id INTO v_energie FROM majordhome.equipment_categories WHERE org_id = v_mayer AND code = 'energie';
  SELECT id INTO v_poele_cat FROM majordhome.equipment_categories WHERE org_id = v_mayer AND code = 'poele';

  -- (e) typé : category_id dérivé, enum legacy = code
  INSERT INTO majordhome.equipments (project_id, equipment_type_id) VALUES (v_proj, v_pac) RETURNING id, category_id, category::text INTO v_id, v_cat, v_enum;
  IF v_cat IS DISTINCT FROM (SELECT category_id FROM majordhome.pricing_equipment_types WHERE id = v_pac) OR v_enum <> 'pac_air_air' THEN
    RAISE EXCEPTION '(e) dérivation type → catégorie/enum incorrecte (% / %)', v_cat, v_enum; END IF;
  -- l'ancien front envoie encore `category` : écrasé par la valeur cohérente
  UPDATE majordhome.equipments SET category = 'poele' WHERE id = v_id RETURNING category::text INTO v_enum;
  IF v_enum <> 'pac_air_air' THEN RAISE EXCEPTION '(e) l''enum envoyé par l''ancien front n''a pas été recalculé (%)', v_enum; END IF;
  DELETE FROM majordhome.equipments WHERE id = v_id;

  -- type hors enum (PV → energie) : category_id = energie, enum = autre
  INSERT INTO majordhome.equipments (project_id, equipment_type_id) VALUES (v_proj, v_pv) RETURNING id, category_id, category::text INTO v_id, v_cat, v_enum;
  IF v_cat <> v_energie OR v_enum <> 'autre' THEN RAISE EXCEPTION 'PV : attendu energie/autre, trouvé %/%', v_cat, v_enum; END IF;
  DELETE FROM majordhome.equipments WHERE id = v_id;

  -- (f) ni type ni catégorie : non catégorisé, enum autre
  INSERT INTO majordhome.equipments (project_id) VALUES (v_proj) RETURNING id, category_id, category::text INTO v_id, v_cat, v_enum;
  IF v_cat IS NOT NULL OR v_enum <> 'autre' THEN RAISE EXCEPTION '(f) attendu NULL/autre, trouvé %/%', v_cat, v_enum; END IF;
  -- catégorie seule (équipement non typé) : conservée, enum = code
  UPDATE majordhome.equipments SET category_id = v_poele_cat WHERE id = v_id RETURNING category_id, category::text INTO v_cat, v_enum;
  IF v_cat <> v_poele_cat OR v_enum <> 'poele' THEN RAISE EXCEPTION 'catégorie seule : attendu poele/poele, trouvé %/%', v_cat, v_enum; END IF;
  DELETE FROM majordhome.equipments WHERE id = v_id;

  -- cross-org : type Mayer sur un projet d'une autre org → 23514
  SELECT p.id INTO v_proj FROM core.projects p WHERE p.org_id <> v_mayer AND p.org_id IS NOT NULL LIMIT 1;
  IF v_proj IS NULL THEN
    INSERT INTO core.projects (org_id, name, status) SELECT id, 'projet test', 'active' FROM core.organizations WHERE id <> v_mayer LIMIT 1 RETURNING id INTO v_proj;
  END IF;
  ok := false;
  BEGIN
    INSERT INTO majordhome.equipments (project_id, equipment_type_id) VALUES (v_proj, v_pac);
  EXCEPTION WHEN SQLSTATE '23514' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'cross-org type/projet accepté'; END IF;
  RAISE NOTICE 'E. trigger OK';
END $$;

-- ── F. process_web_entretien (site vitrine) ────────────────────────────────
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  r record; v_cat uuid; v_type uuid; n int;
BEGIN
  SELECT * INTO r FROM public.process_web_entretien(
    v_mayer, 'Test', 'Répétition', 'test-m1@example.invalid', '0600000000', '1 rue du Test', '81600', 'Gaillac',
    NULL, '[{"type":"poele_granules_elec","label":"Poêle granulés","quantity":1},{"type":"code_inconnu","label":"Mystère","quantity":1}]'::jsonb,
    250, 250, 0, 0, NULL, '[{"label":"Poêle granulés","price":250}]'::jsonb, 'message test');
  IF r.out_client_id IS NULL OR r.out_contract_id IS NULL OR r.out_intervention_id IS NULL THEN
    RAISE EXCEPTION 'F. process_web_entretien n''a pas tout créé (%)', r; END IF;
  SELECT e.category_id, e.equipment_type_id INTO v_cat, v_type FROM majordhome.equipments e
    JOIN majordhome.contract_equipments ce ON ce.equipment_id = e.id WHERE ce.contract_id = r.out_contract_id AND e.equipment_type_id IS NOT NULL;
  IF v_cat IS DISTINCT FROM (SELECT id FROM majordhome.equipment_categories WHERE org_id = v_mayer AND code = 'poele') THEN
    RAISE EXCEPTION 'F. équipement web typé sans catégorie poele'; END IF;
  SELECT count(*) INTO n FROM majordhome.equipments e JOIN majordhome.contract_equipments ce ON ce.equipment_id = e.id
   WHERE ce.contract_id = r.out_contract_id AND e.equipment_type_id IS NULL AND e.category_id IS NULL AND e.category = 'autre';
  IF n <> 1 THEN RAISE EXCEPTION 'F. l''équipement au code inconnu devait être non catégorisé (autre), trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.contract_pricing_items WHERE contract_id = r.out_contract_id;
  IF n <> 1 THEN RAISE EXCEPTION 'F. lignes tarifaires attendu 1, trouvé %', n; END IF;
  RAISE NOTICE 'F. process_web_entretien OK (client %, contrat %)', r.out_client_id, r.out_contract_number;
END $$;

-- ── G. Rejouabilité : ré-exécuter des blocs clés ne change rien ────────────
DO $$
DECLARE n int;
BEGIN
  -- le semis des compétences ne re-coche rien pour une org déjà servie
  INSERT INTO majordhome.team_member_skills (team_member_id, equipment_type_id, role)
  SELECT tm.id, pet.id, r.role
    FROM majordhome.organizations o
    JOIN majordhome.team_members tm ON tm.org_id = o.id AND tm.role = 'technician' AND COALESCE(tm.is_active, true)
    JOIN majordhome.pricing_equipment_types pet ON pet.org_id = o.core_org_id AND COALESCE(pet.is_active, true)
    CROSS JOIN (VALUES ('entretien'), ('pose')) AS r(role)
   WHERE NOT EXISTS (SELECT 1 FROM majordhome.team_member_skills s JOIN majordhome.team_members tm2 ON tm2.id = s.team_member_id WHERE tm2.org_id = o.id)
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM majordhome.team_member_skills;
  IF n <> 84 THEN RAISE EXCEPTION 'G. rejeu du semis a changé les compétences (%)', n; END IF;
  RAISE NOTICE 'G. rejouabilité OK';
END $$;
