-- assert-baseline.sql — le cluster de répétition reflète bien la prod du 2026-09-12
-- (avant toute migration). Chaque écart lève une exception : pas de « ça a l'air bon ».
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM majordhome.equipments;
  IF n <> 910 THEN RAISE EXCEPTION 'equipments attendu 910, trouvé %', n; END IF;

  SELECT count(*) INTO n FROM majordhome.equipments WHERE equipment_type_id IS NULL;
  IF n <> 353 THEN RAISE EXCEPTION 'equipments sans type attendu 353, trouvé %', n; END IF;

  SELECT count(*) INTO n FROM majordhome.pricing_equipment_types;
  IF n <> 14 THEN RAISE EXCEPTION 'pricing_equipment_types attendu 14, trouvé %', n; END IF;

  SELECT count(*) INTO n FROM majordhome.team_members;
  IF n <> 7 THEN RAISE EXCEPTION 'team_members attendu 7, trouvé %', n; END IF;

  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'equipment_category';
  IF n <> 11 THEN RAISE EXCEPTION 'enum equipment_category attendu 11 valeurs, trouvé %', n; END IF;

  SELECT count(*) INTO n FROM majordhome.certificats;
  IF n <> 80 THEN RAISE EXCEPTION 'certificats attendu 80, trouvé %', n; END IF;

  -- display_name GENERATED reconstruit correctement
  SELECT count(*) INTO n FROM majordhome.team_members WHERE display_name IS DISTINCT FROM (first_name || ' ' || last_name);
  IF n <> 0 THEN RAISE EXCEPTION 'display_name generated incohérent sur % lignes', n; END IF;

  -- ACL par défaut reproduite : anon a des droits sur une table majordhome existante
  IF NOT has_table_privilege('anon', 'majordhome.pricing_equipment_types', 'SELECT') THEN
    RAISE EXCEPTION 'ACL baseline : anon devrait avoir SELECT sur pricing_equipment_types';
  END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.equipments', 'SELECT') THEN
    RAISE EXCEPTION 'ACL baseline : service_role devrait avoir SELECT sur equipments';
  END IF;

  RAISE NOTICE 'baseline OK : 910 équipements (353 sans type), 14 types, 7 membres, enum 11 valeurs, 80 certificats';
END $$;
