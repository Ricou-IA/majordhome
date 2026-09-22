-- assert-baseline.sql — le cluster de répétition reflète bien la prod photographiée par
-- snapshot.mjs (avant toute migration). Chaque écart lève une exception : pas de « ça a l'air bon ».
--
-- Aucun compte d'ACTIVITÉ ici (équipements, certificats, clients…) : ils bougent chaque jour en
-- prod et ne prouvent rien — run.mjs a déjà chargé data.json ligne à ligne et s'arrête au
-- moindre INSERT refusé. Ce fichier vérifie :
--   §1 la STRUCTURE que les migrations supposent (fonctions, triggers, vues + security_invoker,
--      RLS/policies, enum legacy, colonne GENERATED, ACL par défaut) ;
--   §2 les invariants de DONNÉES tenus par les triggers de prod (typé ⇒ catégorie du type…) ;
--   §3 les seuls comptes STABLES (référentiel / config, pas activité) : types, membres, enum.
-- Quand ré-aligner : un objet entre ou sort des listes FUNCTIONS / TRIGGER_TABLES / VIEWS /
-- POLICY_TABLES de snapshot.mjs (§1) ; un type d'équipement ou un membre d'équipe est créé ou
-- supprimé en prod (§3) ; M2 (20260920_1) supprime l'enum equipment_category (§1 + §3). Cf. README.

-- ── §1 Structure ─────────────────────────────────────────────────────────────
DO $$
DECLARE r record; n int;
BEGIN
  -- Fonctions (liste FUNCTIONS de snapshot.mjs)
  FOR r IN SELECT * FROM (VALUES
      ('majordhome.handle_updated_at()'),
      ('majordhome.calculate_next_maintenance()'),
      ('majordhome.update_client_on_equipment_change()'),
      ('majordhome.equipments_sync_category()'),
      ('majordhome.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text)'),
      ('public.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text)'),
      ('public.team_member_set_routing_settings(uuid, integer, boolean, text[])'),
      ('majordhome.project_org_id(uuid)'),
      ('majordhome.quote_status_bucket(text)'),
      ('public.update_majordhome_lead(uuid, jsonb)')
    ) AS t(fn)
  LOOP
    IF to_regprocedure(r.fn) IS NULL THEN RAISE EXCEPTION 'fonction absente : %', r.fn; END IF;
  END LOOP;

  -- Triggers utilisateur de majordhome.equipments (TRIGGER_TABLES)
  FOR r IN SELECT * FROM (VALUES
      ('tr_equipments_sync_category', 'majordhome.equipments_sync_category()'),
      ('tr_equipments_calc_maintenance', 'majordhome.calculate_next_maintenance()'),
      ('tr_equipments_updated_at', 'majordhome.handle_updated_at()'),
      ('trg_update_client_on_equipment', 'majordhome.update_client_on_equipment_change()')
    ) AS t(trg, fn)
  LOOP
    PERFORM 1 FROM pg_trigger
     WHERE tgrelid = 'majordhome.equipments'::regclass AND NOT tgisinternal
       AND tgname = r.trg AND tgfoid = to_regprocedure(r.fn);
    IF NOT FOUND THEN RAISE EXCEPTION 'trigger % → % absent sur majordhome.equipments', r.trg, r.fn; END IF;
  END LOOP;

  -- Vues (liste VIEWS) ; celles exposées via PostgREST doivent être security_invoker=true
  FOR r IN SELECT * FROM (VALUES
      ('public.profiles', false),
      ('majordhome.v_planning', false),
      ('majordhome.v_equipments_maintenance', false),
      ('public.majordhome_equipments', true),
      ('public.majordhome_pricing_equipment_types', true),
      ('public.majordhome_team_members', true),
      ('public.majordhome_client_equipment_kinds', true),
      ('public.majordhome_pricing_zones', true),
      ('public.majordhome_organizations', true),
      ('majordhome.lead_quote_stats', true),
      ('public.majordhome_interventions', true),
      ('public.majordhome_chantiers', true),
      ('public.majordhome_entretien_sav', true)
    ) AS t(vue, invoker)
  LOOP
    IF to_regclass(r.vue) IS NULL THEN RAISE EXCEPTION 'vue absente : %', r.vue; END IF;
    IF r.invoker AND NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid = to_regclass(r.vue) AND relkind = 'v' AND 'security_invoker=true' = ANY (reloptions)
    ) THEN RAISE EXCEPTION 'vue % : security_invoker=true attendu', r.vue; END IF;
  END LOOP;

  -- RLS activée + au moins une policy (POLICY_TABLES)
  FOR r IN SELECT * FROM (VALUES ('pricing_zones'), ('pricing_equipment_types'), ('team_members')) AS t(tbl)
  LOOP
    PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'majordhome' AND c.relname = r.tbl AND c.relrowsecurity;
    IF NOT FOUND THEN RAISE EXCEPTION 'RLS désactivée sur majordhome.%', r.tbl; END IF;
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = r.tbl;
    IF n = 0 THEN RAISE EXCEPTION 'aucune policy sur majordhome.%', r.tbl; END IF;
  END LOOP;

  -- Enum legacy encore présent tant que M2 (20260920_1) n'est pas passée
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'equipment_category';
  IF n <> 11 THEN RAISE EXCEPTION 'enum equipment_category attendu 11 valeurs, trouvé %', n; END IF;

  -- team_members.display_name reconstruite en colonne GENERATED
  PERFORM 1 FROM pg_attribute
   WHERE attrelid = 'majordhome.team_members'::regclass AND attname = 'display_name' AND attgenerated = 's';
  IF NOT FOUND THEN RAISE EXCEPTION 'team_members.display_name devrait être GENERATED'; END IF;

  -- ACL par défaut reproduite (bootstrap-pre.sql) : anon a des droits sur une table majordhome
  -- existante, service_role a SELECT sur equipments (GRANT explicite d'une migration passée)
  IF NOT has_table_privilege('anon', 'majordhome.pricing_equipment_types', 'SELECT') THEN
    RAISE EXCEPTION 'ACL baseline : anon devrait avoir SELECT sur pricing_equipment_types';
  END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.equipments', 'SELECT') THEN
    RAISE EXCEPTION 'ACL baseline : service_role devrait avoir SELECT sur equipments';
  END IF;
END $$;

-- ── §2 Invariants de données (tenus par les triggers de prod, indépendants du volume) ──
DO $$
DECLARE r record; n int;
BEGIN
  -- Les tables à données du snapshot ne sont pas vides (data.json chargé)
  FOR r IN SELECT * FROM (VALUES
      ('core.organizations'), ('core.profiles'), ('core.organization_members'),
      ('majordhome.equipment_categories'), ('majordhome.pricing_equipment_types'),
      ('majordhome.pricing_rates'), ('majordhome.team_members'), ('majordhome.clients'),
      ('majordhome.equipments'), ('majordhome.certificats')
    ) AS t(tbl)
  LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.tbl) INTO n;
    IF n = 0 THEN RAISE EXCEPTION 'table vide après chargement : %', r.tbl; END IF;
  END LOOP;

  -- typé ⇒ catégorie du type (trigger equipments_sync_category)
  SELECT count(*) INTO n FROM majordhome.equipments e
    JOIN majordhome.pricing_equipment_types t ON t.id = e.equipment_type_id
   WHERE e.category_id IS DISTINCT FROM t.category_id;
  IF n <> 0 THEN RAISE EXCEPTION 'invariant typé ⇒ catégorie du type violé sur % équipements', n; END IF;

  -- type → code de catégorie dénormalisé (trigger pricing_equipment_types)
  SELECT count(*) INTO n FROM majordhome.pricing_equipment_types t
    LEFT JOIN majordhome.equipment_categories ec ON ec.id = t.category_id
   WHERE ec.id IS NULL OR t.category IS DISTINCT FROM ec.code;
  IF n <> 0 THEN RAISE EXCEPTION 'pricing_equipment_types.category ≠ code de catégorie sur % types', n; END IF;

  -- display_name GENERATED reconstruit correctement
  SELECT count(*) INTO n FROM majordhome.team_members WHERE display_name IS DISTINCT FROM (first_name || ' ' || last_name);
  IF n <> 0 THEN RAISE EXCEPTION 'display_name generated incohérent sur % lignes', n; END IF;
END $$;

-- ── §3 Comptes stables (référentiel / config) + bilan ─────────────────────────
DO $$
DECLARE n_types int; n_membres int; n_eq int; n_sans_type int; n_cert int;
BEGIN
  SELECT count(*) INTO n_types FROM majordhome.pricing_equipment_types;
  IF n_types <> 14 THEN RAISE EXCEPTION 'pricing_equipment_types attendu 14, trouvé % (type créé/supprimé en prod ? ré-aligner §3)', n_types; END IF;

  SELECT count(*) INTO n_membres FROM majordhome.team_members;
  IF n_membres <> 7 THEN RAISE EXCEPTION 'team_members attendu 7, trouvé % (membre créé/supprimé en prod ? ré-aligner §3)', n_membres; END IF;

  SELECT count(*), count(*) FILTER (WHERE equipment_type_id IS NULL) INTO n_eq, n_sans_type FROM majordhome.equipments;
  SELECT count(*) INTO n_cert FROM majordhome.certificats;
  RAISE NOTICE 'baseline OK : structure conforme, % types, % membres, enum 11 valeurs — snapshot : % équipements (% sans type), % certificats',
    n_types, n_membres, n_eq, n_sans_type, n_cert;
END $$;
