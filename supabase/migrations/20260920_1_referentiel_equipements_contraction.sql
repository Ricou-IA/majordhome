-- 20260920_1_referentiel_equipements_contraction.sql
-- ============================================================================
-- Référentiel équipements par organisation — M2 : CONTRACTION.
-- Spec : docs/superpowers/specs/2026-09-12-referentiel-equipements-tarifs-competences-design.md (§7.4)
--
-- À appliquer SEULEMENT après : M1 (20260913_1) en prod, front + edge déployés,
-- fenêtre d'observation (≥ 1 semaine) sans écart. PAS DE RETOUR ARRIÈRE après
-- cette migration (le type enum disparaît) — c'est la raison des deux temps.
--
-- Ce qu'elle retire :
--   1. les vues internes mortes v_planning / v_equipments_maintenance
--   2. equipments.category (enum) + le TYPE majordhome.equipment_category
--   3. pricing_equipment_types.equipment_category (texte, ex-mapping caché) ;
--      `category` RESTE (code de catégorie dénormalisé depuis M1 : 4 vues en dépendent)
--   4. team_members.specialties + le paramètre p_specialties de team_member_set_routing_settings
-- Chaque vue touchée est recréée à l'identique moins la colonne, et re-GRANTée
-- (un DROP VIEW perd les GRANT : 42501 silencieux côté edge sinon).
-- Rejouable : DROP … IF EXISTS partout ; les CREATE VIEW ne sont exécutés que
-- si la vue n'existe pas déjà sous sa forme cible (DROP + CREATE).
-- ============================================================================

-- ── 1. Vues mortes ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS majordhome.v_planning;
DROP VIEW IF EXISTS majordhome.v_equipments_maintenance;

-- ── 2. equipments.category + enum ──────────────────────────────────────────
-- Garde-fou : aucune autre relation ne doit dépendre encore de la colonne
-- (le DROP COLUMN échouerait de lui-même, mais on préfère le dire).
DO $$
DECLARE v_dep text;
BEGIN
  SELECT string_agg(dn.nspname || '.' || dc.relname, ', ') INTO v_dep
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class dc ON dc.oid = r.ev_class
    JOIN pg_namespace dn ON dn.oid = dc.relnamespace
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   WHERE d.refobjid = 'majordhome.equipments'::regclass
     AND a.attname = 'category'
     AND dc.oid <> d.refobjid
     AND NOT (dn.nspname = 'public' AND dc.relname = 'majordhome_equipments');
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION 'referentiel M2 : des vues dépendent encore de equipments.category : %', v_dep;
  END IF;
END $$;

-- Le trigger M1 cite `category` dans sa liste UPDATE OF : il dépend de la colonne
-- et doit tomber avant elle (recréé plus bas sans la branche legacy).
DROP TRIGGER IF EXISTS tr_equipments_sync_category ON majordhome.equipments;
DROP VIEW IF EXISTS public.majordhome_equipments;
ALTER TABLE majordhome.equipments DROP COLUMN IF EXISTS category;
DROP TYPE IF EXISTS majordhome.equipment_category;

CREATE VIEW public.majordhome_equipments
  WITH (security_invoker = true) AS
  SELECT id, project_id, brand, model, serial_number, install_date, warranty_end_date,
         maintenance_frequency_months, last_maintenance_date, next_maintenance_due, contract_type,
         contract_tarif, contract_start_date, contract_status, invoice_file_id, manual_file_id,
         status, notes, metadata, created_by, created_at, updated_at, installation_year,
         equipment_type_id, installation_type, supplier_product_id, unit_count,
         category_id
  FROM majordhome.equipments;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_equipments TO authenticated, service_role;

-- Trigger sans la branche legacy (plus d'enum à alimenter).
CREATE OR REPLACE FUNCTION majordhome.equipments_sync_category()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $$
DECLARE
  v_proj_org uuid;
  v_type_org uuid;
  v_type_cat uuid;
  v_cat_org  uuid;
BEGIN
  SELECT p.org_id INTO v_proj_org FROM core.projects p WHERE p.id = NEW.project_id;

  IF NEW.equipment_type_id IS NOT NULL THEN
    SELECT pet.org_id, pet.category_id INTO v_type_org, v_type_cat
      FROM majordhome.pricing_equipment_types pet WHERE pet.id = NEW.equipment_type_id;
    IF v_type_org IS NULL THEN
      RAISE EXCEPTION 'equipment_type_introuvable' USING ERRCODE = '23503', DETAIL = NEW.equipment_type_id::text;
    END IF;
    IF v_type_org IS DISTINCT FROM v_proj_org THEN
      RAISE EXCEPTION 'equipment_type_cross_org' USING ERRCODE = '23514',
        DETAIL = format('type org %s, projet org %s', v_type_org, v_proj_org);
    END IF;
    NEW.category_id := v_type_cat;            -- invariant : typé ⇒ catégorie du type
  ELSIF NEW.category_id IS NOT NULL THEN
    SELECT ec.org_id INTO v_cat_org FROM majordhome.equipment_categories ec WHERE ec.id = NEW.category_id;
    IF v_cat_org IS DISTINCT FROM v_proj_org THEN
      RAISE EXCEPTION 'equipment_category_cross_org' USING ERRCODE = '23514',
        DETAIL = format('catégorie org %s, projet org %s', v_cat_org, v_proj_org);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_equipments_sync_category ON majordhome.equipments;
CREATE TRIGGER tr_equipments_sync_category
  BEFORE INSERT OR UPDATE OF equipment_type_id, category_id, project_id ON majordhome.equipments
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipments_sync_category();

-- ── 3. pricing_equipment_types.equipment_category ──────────────────────────
DROP VIEW IF EXISTS public.majordhome_pricing_equipment_types;
ALTER TABLE majordhome.pricing_equipment_types DROP COLUMN IF EXISTS equipment_category;

CREATE VIEW public.majordhome_pricing_equipment_types
  WITH (security_invoker = true) AS
  SELECT id, org_id, code, label, category, has_unit_pricing, unit_label,
         included_units, sort_order, is_active, created_at, updated_at,
         duration_base_minutes, duration_per_extra_unit_minutes, unfavorable_months,
         category_id
  FROM majordhome.pricing_equipment_types;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_pricing_equipment_types TO authenticated, service_role;

-- ── 4. team_members.specialties + RPC à 3 paramètres ───────────────────────
DROP VIEW IF EXISTS public.majordhome_team_members;
ALTER TABLE majordhome.team_members DROP COLUMN IF EXISTS specialties;

CREATE VIEW public.majordhome_team_members
  WITH (security_invoker = true) AS
  SELECT id, org_id, first_name, last_name, display_name, email, phone, role,
         calendar_color, google_calendar_id, google_calendar_email, default_availability,
         default_zone, slack_user_id, is_active, created_at, updated_at, user_id,
         daily_work_minutes, include_in_routing
  FROM majordhome.team_members;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_team_members TO authenticated, service_role;

-- Signature à 4 paramètres retirée EXPLICITEMENT : PostgREST ne départage pas
-- deux surcharges à valeurs par défaut.
DROP FUNCTION IF EXISTS public.team_member_set_routing_settings(uuid, integer, boolean, text[]);

CREATE OR REPLACE FUNCTION public.team_member_set_routing_settings(
  p_team_member_id      uuid,
  p_daily_work_minutes  integer DEFAULT NULL,
  p_include_in_routing  boolean DEFAULT NULL
)
RETURNS TABLE (daily_work_minutes integer, include_in_routing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id     uuid := auth.uid();
  v_core_org_id uuid;
  v_role        text;
BEGIN
  -- Posture frontend : pas d'appelant anonyme, traité en première instruction.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;

  -- Une journée de travail hors de ces bornes est une faute de saisie, pas un
  -- réglage : la laisser passer produirait des tournées absurdes en silence.
  IF p_daily_work_minutes IS NOT NULL
     AND (p_daily_work_minutes < 60 OR p_daily_work_minutes > 1440) THEN
    RAISE EXCEPTION 'Budget journalier hors bornes (60-1440 min): %', p_daily_work_minutes
      USING ERRCODE = '22023';
  END IF;

  SELECT o.core_org_id INTO v_core_org_id
  FROM majordhome.team_members tm
  JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;

  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  SELECT role INTO v_role
  FROM core.organization_members
  WHERE user_id = v_user_id AND org_id = v_core_org_id;

  -- Garde en autorisation positive : `IS DISTINCT FROM` refuse aussi un rôle NULL
  -- (utilisateur sans appartenance), là où `!=` laisserait passer.
  IF v_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un org_admin peut modifier les reglages de tournee (role=%)', v_role
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE majordhome.team_members tm
     SET daily_work_minutes = COALESCE(p_daily_work_minutes, tm.daily_work_minutes),
         include_in_routing = COALESCE(p_include_in_routing, tm.include_in_routing),
         updated_at         = NOW()
   WHERE tm.id = p_team_member_id
  RETURNING tm.daily_work_minutes, tm.include_in_routing;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean)
  TO authenticated;

-- ── 5. Contrôles ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'majordhome' AND t.typname = 'equipment_category') THEN
    RAISE EXCEPTION 'referentiel M2 : le type equipment_category existe encore';
  END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'majordhome'
     AND ((table_name = 'equipments' AND column_name = 'category')
       OR (table_name = 'pricing_equipment_types' AND column_name = 'equipment_category')
       OR (table_name = 'team_members' AND column_name = 'specialties'));
  IF n > 0 THEN RAISE EXCEPTION 'referentiel M2 : % colonne(s) legacy encore présente(s)', n; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_equipments', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.majordhome_pricing_equipment_types', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.majordhome_team_members', 'SELECT') THEN
    RAISE EXCEPTION 'referentiel M2 : GRANT service_role manquant sur une vue recréée';
  END IF;
  RAISE NOTICE 'referentiel M2 : enum supprimé, colonnes legacy retirées, vues recréées avec leurs GRANT';
END $$;
