-- 20260913_1_referentiel_equipements_expansion.sql
-- ============================================================================
-- Référentiel équipements par organisation — M1 : EXPANSION (additive).
-- Spec : docs/superpowers/specs/2026-09-12-referentiel-equipements-tarifs-competences-design.md (§4, §7.1)
-- Plan : docs/superpowers/plans/2026-09-12-referentiel-equipements-tarifs-competences.md
-- Répétée sur cluster local (scripts/migration-rehearsal) avant livraison.
--
-- Ce que fait cette migration, dans l'ordre :
--   1. majordhome.equipment_categories (par org) + RLS + vue publique
--   2. semis des catégories DÉRIVÉ des données (aucun UUID en dur)
--   3. pricing_equipment_types.category_id NOT NULL (FK composite même org) ;
--      la colonne `category` (ex-famille) devient le CODE de catégorie, dénormalisé par trigger
--   4. equipments.category_id (typé ← catégorie du type ; non typé ← même code ; 'autre' → NULL)
--   5. trigger equipments_sync_category (dérive du type ; remplit encore l'enum legacy — retiré en M2)
--   6. majordhome.team_member_skills + RLS + vue + RPC team_member_set_skills
--   7. semis « tout coché » (Entretien + Pose) pour les techniciens actifs — seulement si l'org n'a
--      encore aucune compétence (rejouable sans re-cocher ce qu'un admin aurait décoché)
--   8. vues publiques : category_id EN FIN de liste ; client_equipment_kinds recréée
--   9. process_web_entretien sans référence à l'enum
--  10. comptages (RAISE NOTICE) à comparer aux chiffres attendus de la spec
--
-- Compatible avec le front et l'edge en prod au moment où elle passe : rien n'est
-- retiré, l'enum equipments.category reste alimenté, specialties reste lue/écrite.
-- Seule exception (fenêtre M1 → déploiement du front) : créer un TYPE d'équipement
-- depuis l'ancien éditeur échoue (category_id NOT NULL) — bruyant, jamais silencieux.
-- ============================================================================

-- ── 1. equipment_categories ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS majordhome.equipment_categories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  code                text NOT NULL,
  label               text NOT NULL,
  sort_order          integer NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  certificate_profile text NOT NULL DEFAULT 'generique',
  default_vat_rate    numeric(4,2) NOT NULL DEFAULT 20,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_categories_code_format CHECK (code ~ '^[a-z0-9_]+$'),
  CONSTRAINT equipment_categories_profile_check CHECK (certificate_profile IN
    ('combustion_bois', 'combustion_fossile', 'pac', 'ecs_thermo', 'ecs', 'aeraulique', 'generique')),
  CONSTRAINT equipment_categories_vat_range CHECK (default_vat_rate >= 0 AND default_vat_rate < 100),
  CONSTRAINT equipment_categories_org_code_key UNIQUE (org_id, code),
  -- cible de la FK composite de pricing_equipment_types (même org garanti structurellement)
  CONSTRAINT equipment_categories_id_org_key UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS equipment_categories_org_id_idx ON majordhome.equipment_categories (org_id);

COMMENT ON TABLE majordhome.equipment_categories IS
  'Catégories d''équipement de l''organisation (niveau 1 du référentiel : catégorie → type). Remplace l''enum equipment_category. Le code est immuable (certificats et site vitrine désignent par code).';
COMMENT ON COLUMN majordhome.equipment_categories.certificate_profile IS
  'Gabarit du certificat d''entretien (liste fermée niveau app = ce que le wizard sait produire : ramonage / F-Gaz / brûleur / cendres / mesures). Remplace SECTIONS_PAR_EQUIPEMENT[enum].';
COMMENT ON COLUMN majordhome.equipment_categories.default_vat_rate IS
  'TVA par défaut proposée sur le certificat (5.5 / 10 / 20 — libre, les DOM ont 8.5 et 2.1).';

DROP TRIGGER IF EXISTS tr_equipment_categories_updated_at ON majordhome.equipment_categories;
CREATE TRIGGER tr_equipment_categories_updated_at
  BEFORE UPDATE ON majordhome.equipment_categories
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

-- Code immuable : certificats.equipement_type et les codes de types du site vitrine
-- désignent par code ; un renommage casserait des artefacts remis au client.
CREATE OR REPLACE FUNCTION majordhome.equipment_categories_code_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'equipment_category_code_immutable'
      USING ERRCODE = '23514', DETAIL = format('%s -> %s', OLD.code, NEW.code);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_equipment_categories_code_immutable ON majordhome.equipment_categories;
CREATE TRIGGER tr_equipment_categories_code_immutable
  BEFORE UPDATE OF code ON majordhome.equipment_categories
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipment_categories_code_immutable();

-- RLS : copie des policies pricing_* (SELECT membre, écriture org_admin)
ALTER TABLE majordhome.equipment_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipment_categories_select ON majordhome.equipment_categories;
CREATE POLICY equipment_categories_select ON majordhome.equipment_categories FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
DROP POLICY IF EXISTS equipment_categories_insert ON majordhome.equipment_categories;
CREATE POLICY equipment_categories_insert ON majordhome.equipment_categories FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
DROP POLICY IF EXISTS equipment_categories_update ON majordhome.equipment_categories;
CREATE POLICY equipment_categories_update ON majordhome.equipment_categories FOR UPDATE TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
DROP POLICY IF EXISTS equipment_categories_delete ON majordhome.equipment_categories;
CREATE POLICY equipment_categories_delete ON majordhome.equipment_categories FOR DELETE TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- ACL par défaut du schéma majordhome : anon/authenticated = arwd, service_role = rien.
REVOKE ALL ON majordhome.equipment_categories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.equipment_categories TO authenticated;
GRANT SELECT ON majordhome.equipment_categories TO service_role;

CREATE OR REPLACE VIEW public.majordhome_equipment_categories
  WITH (security_invoker = true) AS
  SELECT id, org_id, code, label, sort_order, is_active, certificate_profile, default_vat_rate, created_at, updated_at
  FROM majordhome.equipment_categories;
REVOKE ALL ON public.majordhome_equipment_categories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_equipment_categories TO authenticated;
GRANT SELECT ON public.majordhome_equipment_categories TO service_role;

-- ── 2. Semis dérivé des données ────────────────────────────────────────────
-- Une catégorie par valeur distincte de COALESCE(type.equipment_category, type.famille),
-- plus toute valeur enum encore portée par des équipements (hors 'autre').
-- Libellé / gabarit / TVA : table de correspondance = SECTIONS_PAR_EQUIPEMENT d'aujourd'hui.
WITH corr(code, label, profile, vat) AS (VALUES
  ('poele',              'Poêle',                        'combustion_bois',    5.5),
  ('chaudiere_bois',     'Chaudière bois',               'combustion_bois',    5.5),
  ('chaudiere_gaz',      'Chaudière gaz',                'combustion_fossile', 10),
  ('chaudiere_fioul',    'Chaudière fioul',              'combustion_fossile', 10),
  ('pac_air_air',        'PAC Air/Air',                  'pac',                5.5),
  ('pac_air_eau',        'PAC Air/Eau',                  'pac',                5.5),
  ('climatisation',      'Climatisation',                'pac',                20),
  ('chauffe_eau_thermo', 'Chauffe-eau thermodynamique',  'ecs_thermo',         10),
  ('ballon_ecs',         'Ballon ECS',                   'ecs',                10),
  ('vmc',                'VMC',                          'aeraulique',         10),
  ('energie',            'Énergie',                      'generique',          20)
), besoins AS (
  SELECT pet.org_id,
         regexp_replace(lower(btrim(COALESCE(NULLIF(pet.equipment_category, ''), pet.category))), '[^a-z0-9_]', '_', 'g') AS code,
         COALESCE(min(pet.sort_order), 0) AS sort_order
    FROM majordhome.pricing_equipment_types pet
   GROUP BY 1, 2
  UNION ALL
  SELECT p.org_id, e.category::text, 1000
    FROM majordhome.equipments e
    JOIN core.projects p ON p.id = e.project_id
   WHERE e.category <> 'autre' AND p.org_id IS NOT NULL
   GROUP BY 1, 2
)
INSERT INTO majordhome.equipment_categories (org_id, code, label, sort_order, certificate_profile, default_vat_rate)
SELECT b.org_id, b.code,
       COALESCE(c.label, initcap(replace(b.code, '_', ' '))),
       min(b.sort_order),
       COALESCE(c.profile, 'generique'),
       COALESCE(c.vat, 20)
  FROM besoins b
  LEFT JOIN corr c ON c.code = b.code
 WHERE b.code <> ''
 GROUP BY b.org_id, b.code, c.label, c.profile, c.vat
ON CONFLICT (org_id, code) DO NOTHING;

-- ── 3. pricing_equipment_types.category_id ─────────────────────────────────
ALTER TABLE majordhome.pricing_equipment_types ADD COLUMN IF NOT EXISTS category_id uuid;

UPDATE majordhome.pricing_equipment_types pet
   SET category_id = ec.id
  FROM majordhome.equipment_categories ec
 WHERE ec.org_id = pet.org_id
   AND ec.code = regexp_replace(lower(btrim(COALESCE(NULLIF(pet.equipment_category, ''), pet.category))), '[^a-z0-9_]', '_', 'g')
   AND pet.category_id IS NULL;

-- Échec FORT si un type reste sans catégorie : pas de repli silencieux.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM majordhome.pricing_equipment_types WHERE category_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'referentiel M1 : % type(s) d''équipement sans catégorie résolue — corriger la table de correspondance', n;
  END IF;
END $$;

ALTER TABLE majordhome.pricing_equipment_types ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE majordhome.pricing_equipment_types DROP CONSTRAINT IF EXISTS pricing_equipment_types_category_fkey;
ALTER TABLE majordhome.pricing_equipment_types
  ADD CONSTRAINT pricing_equipment_types_category_fkey
  FOREIGN KEY (category_id, org_id) REFERENCES majordhome.equipment_categories (id, org_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS pricing_equipment_types_category_id_idx ON majordhome.pricing_equipment_types (category_id);

-- `category` (NOT NULL, ex-famille tarifaire) = code de catégorie dénormalisé, maintenu par
-- trigger, jamais écrit par l'app. Fait ici et non en M2 : dès que le front cesse d'envoyer
-- la famille, un INSERT sans trigger violerait le NOT NULL. Les 4 vues qui l'exposent en
-- `equipment_type_category` (leads, chantiers, contract_pricing_items, pricing_rates — zéro
-- lecteur) continuent de fonctionner.
UPDATE majordhome.pricing_equipment_types pet
   SET category = ec.code
  FROM majordhome.equipment_categories ec
 WHERE ec.id = pet.category_id AND pet.category IS DISTINCT FROM ec.code;

CREATE OR REPLACE FUNCTION majordhome.pricing_equipment_types_sync_category_code()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $$
DECLARE v_code text;
BEGIN
  SELECT ec.code INTO v_code FROM majordhome.equipment_categories ec WHERE ec.id = NEW.category_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'equipment_category_introuvable' USING ERRCODE = '23503', DETAIL = NEW.category_id::text;
  END IF;
  NEW.category := v_code;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_pricing_equipment_types_sync_category_code ON majordhome.pricing_equipment_types;
CREATE TRIGGER tr_pricing_equipment_types_sync_category_code
  BEFORE INSERT OR UPDATE OF category_id, category ON majordhome.pricing_equipment_types
  FOR EACH ROW EXECUTE FUNCTION majordhome.pricing_equipment_types_sync_category_code();

COMMENT ON COLUMN majordhome.pricing_equipment_types.category IS
  'Code de la catégorie (dénormalisé depuis category_id par trigger, lecture seule). Était la famille tarifaire avant 2026-09.';
COMMENT ON COLUMN majordhome.pricing_equipment_types.category_id IS
  'Catégorie du type (référentiel de l''org). Porte la compétence requise, le gabarit de certificat, le regroupement.';

-- ── 4. equipments.category_id ──────────────────────────────────────────────
ALTER TABLE majordhome.equipments ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE majordhome.equipments DROP CONSTRAINT IF EXISTS equipments_category_id_fkey;
ALTER TABLE majordhome.equipments
  ADD CONSTRAINT equipments_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES majordhome.equipment_categories (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_equipments_category_id ON majordhome.equipments (category_id);

-- typés : la catégorie du type gagne (1 écart connu chez Mayer : le panneau PV autre → energie)
UPDATE majordhome.equipments e
   SET category_id = pet.category_id
  FROM majordhome.pricing_equipment_types pet
 WHERE pet.id = e.equipment_type_id
   AND e.category_id IS DISTINCT FROM pet.category_id;

-- non typés : catégorie de même code dans l'org du projet ; 'autre' reste NULL (non catégorisé)
UPDATE majordhome.equipments e
   SET category_id = ec.id
  FROM core.projects p, majordhome.equipment_categories ec
 WHERE p.id = e.project_id
   AND ec.org_id = p.org_id
   AND ec.code = e.category::text
   AND e.equipment_type_id IS NULL
   AND e.category_id IS NULL
   AND e.category <> 'autre';

COMMENT ON COLUMN majordhome.equipments.category_id IS
  'Catégorie (référentiel de l''org). Dérivée du type par trigger quand equipment_type_id est renseigné ; portée directement sinon ; NULL = non catégorisé.';

-- ── 5. Trigger de cohérence equipments ─────────────────────────────────────
-- SECURITY DEFINER : la lecture de core.projects est soumise à une RLS par
-- assignation qui, exécutée avec les droits de l'utilisateur qui saisit, peut ne
-- rien renvoyer et faire passer un équipement légitime pour cross-org.
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
  v_code     text;
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

  -- TRANSITION (retirée en M2) : l'enum legacy `category` suit la catégorie, quoi
  -- qu'envoie le front — l'ancien EquipmentFormModal l'envoie encore, le nouveau non.
  IF NEW.category_id IS NULL THEN
    NEW.category := 'autre'::majordhome.equipment_category;
  ELSE
    SELECT ec.code INTO v_code FROM majordhome.equipment_categories ec WHERE ec.id = NEW.category_id;
    IF v_code = ANY (enum_range(NULL::majordhome.equipment_category)::text[]) THEN
      NEW.category := v_code::majordhome.equipment_category;
    ELSE
      NEW.category := 'autre'::majordhome.equipment_category;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_equipments_sync_category ON majordhome.equipments;
CREATE TRIGGER tr_equipments_sync_category
  BEFORE INSERT OR UPDATE OF equipment_type_id, category_id, project_id, category ON majordhome.equipments
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipments_sync_category();

-- ── 6. team_member_skills ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS majordhome.team_member_skills (
  team_member_id    uuid NOT NULL REFERENCES majordhome.team_members (id) ON DELETE CASCADE,
  equipment_type_id uuid NOT NULL REFERENCES majordhome.pricing_equipment_types (id) ON DELETE CASCADE,
  role              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_member_skills_pkey PRIMARY KEY (team_member_id, equipment_type_id, role),
  CONSTRAINT team_member_skills_role_check CHECK (role IN ('entretien', 'pose'))
);
CREATE INDEX IF NOT EXISTS team_member_skills_type_idx ON majordhome.team_member_skills (equipment_type_id);
COMMENT ON TABLE majordhome.team_member_skills IS
  'Compétences techniciens cochées comme des droits : 1 ligne = ce membre couvre ce type pour ce rôle. Aucune ligne pour un rôle = jamais proposé. Écriture par la RPC team_member_set_skills uniquement (org_admin).';

ALTER TABLE majordhome.team_member_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_member_skills_select_org_member ON majordhome.team_member_skills;
CREATE POLICY team_member_skills_select_org_member ON majordhome.team_member_skills FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM majordhome.team_members tm
      JOIN majordhome.organizations mo ON mo.id = tm.org_id
      JOIN core.organization_members om ON om.org_id = mo.core_org_id
     WHERE tm.id = team_member_skills.team_member_id
       AND om.user_id = auth.uid()));
-- Aucune policy d'écriture : deny by default, la RPC SECURITY DEFINER est la seule voie.
REVOKE ALL ON majordhome.team_member_skills FROM anon, authenticated;
GRANT SELECT ON majordhome.team_member_skills TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_team_member_skills
  WITH (security_invoker = true) AS
  SELECT team_member_id, equipment_type_id, role, created_at
  FROM majordhome.team_member_skills;
REVOKE ALL ON public.majordhome_team_member_skills FROM anon, authenticated;
GRANT SELECT ON public.majordhome_team_member_skills TO authenticated, service_role;

-- RPC : remplace ATOMIQUEMENT l'ensemble (membre × rôle). Cocher une case, décocher,
-- « tout cocher » passent par la même primitive.
CREATE OR REPLACE FUNCTION public.team_member_set_skills(
  p_team_member_id     uuid,
  p_role               text,
  p_equipment_type_ids uuid[]
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id     uuid := auth.uid();
  v_core_org_id uuid;
  v_role        text;
  v_ids         uuid[] := COALESCE(p_equipment_type_ids, '{}'::uuid[]);
  v_bad         integer;
BEGIN
  -- Posture frontend : pas d'appelant anonyme, traité en première instruction.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;

  -- Asymétrie d'org : team_members porte l'org majordhome, les types l'org core.
  SELECT o.core_org_id INTO v_core_org_id
    FROM majordhome.team_members tm
    JOIN majordhome.organizations o ON o.id = tm.org_id
   WHERE tm.id = p_team_member_id;
  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  SELECT om.role INTO v_role
    FROM core.organization_members om
   WHERE om.user_id = v_user_id AND om.org_id = v_core_org_id;
  -- Autorisation positive : un rôle NULL (pas membre) est refusé, jamais laissé passer.
  IF v_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un org_admin peut modifier les competences (role=%)', v_role USING ERRCODE = '42501';
  END IF;

  IF (p_role = ANY (ARRAY['entretien', 'pose'])) IS NOT TRUE THEN
    RAISE EXCEPTION 'Role de competence inconnu: %', p_role USING ERRCODE = '22023';
  END IF;

  -- TOUT type doit appartenir à l'org : un seul étranger → refus, jamais un filtrage silencieux.
  SELECT count(*) INTO v_bad
    FROM unnest(v_ids) AS u(id)
   WHERE NOT EXISTS (SELECT 1 FROM majordhome.pricing_equipment_types pet
                      WHERE pet.id = u.id AND pet.org_id = v_core_org_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% type(s) d''equipement hors organisation', v_bad USING ERRCODE = '23514';
  END IF;

  DELETE FROM majordhome.team_member_skills
   WHERE team_member_id = p_team_member_id AND role = p_role;
  INSERT INTO majordhome.team_member_skills (team_member_id, equipment_type_id, role)
  SELECT DISTINCT p_team_member_id, u.id, p_role FROM unnest(v_ids) AS u(id);

  RETURN QUERY
    SELECT s.equipment_type_id FROM majordhome.team_member_skills s
     WHERE s.team_member_id = p_team_member_id AND s.role = p_role;
END;
$function$;

-- PUBLIC n'est PAS optionnel (anon en hérite sinon).
REVOKE EXECUTE ON FUNCTION public.team_member_set_skills(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_skills(uuid, text, uuid[]) TO authenticated;

-- ── 7. Semis « tout coché » ────────────────────────────────────────────────
-- Techniciens actifs de rôle planning `technician` × types actifs de l'org core × 2 rôles.
-- Uniquement pour une org qui n'a ENCORE AUCUNE compétence : rejouer M1 après qu'un
-- admin a décoché des cases ne les re-coche pas.
INSERT INTO majordhome.team_member_skills (team_member_id, equipment_type_id, role)
SELECT tm.id, pet.id, r.role
  FROM majordhome.organizations o
  JOIN majordhome.team_members tm
    ON tm.org_id = o.id AND tm.role = 'technician' AND COALESCE(tm.is_active, true)
  JOIN majordhome.pricing_equipment_types pet
    ON pet.org_id = o.core_org_id AND COALESCE(pet.is_active, true)
  CROSS JOIN (VALUES ('entretien'), ('pose')) AS r(role)
 WHERE NOT EXISTS (
   SELECT 1 FROM majordhome.team_member_skills s
   JOIN majordhome.team_members tm2 ON tm2.id = s.team_member_id
   WHERE tm2.org_id = o.id)
ON CONFLICT DO NOTHING;

-- ── 8. Vues publiques ──────────────────────────────────────────────────────
-- category_id EN FIN de liste : CREATE OR REPLACE VIEW n'autorise que cela.
CREATE OR REPLACE VIEW public.majordhome_pricing_equipment_types
  WITH (security_invoker = true) AS
  SELECT id, org_id, code, label, category, equipment_category, has_unit_pricing, unit_label,
         included_units, sort_order, is_active, created_at, updated_at,
         duration_base_minutes, duration_per_extra_unit_minutes, unfavorable_months,
         category_id
  FROM majordhome.pricing_equipment_types;

CREATE OR REPLACE VIEW public.majordhome_equipments
  WITH (security_invoker = true) AS
  SELECT id, project_id, category, brand, model, serial_number, install_date, warranty_end_date,
         maintenance_frequency_months, last_maintenance_date, next_maintenance_due, contract_type,
         contract_tarif, contract_start_date, contract_status, invoice_file_id, manual_file_id,
         status, notes, metadata, created_by, created_at, updated_at, installation_year,
         equipment_type_id, installation_type, supplier_product_id, unit_count,
         category_id
  FROM majordhome.equipments;

-- Lecture seule (JOIN) : DROP/CREATE + re-GRANT. `category` devient le code de catégorie
-- (identique aux valeurs enum chez Mayer : equipmentIcons.js ne voit aucune différence).
DROP VIEW IF EXISTS public.majordhome_client_equipment_kinds;
CREATE VIEW public.majordhome_client_equipment_kinds
  WITH (security_invoker = true) AS
  SELECT c.id AS client_id,
         c.org_id,
         e.id AS equipment_id,
         ec.code AS category,
         pet.code AS type_code,
         pet.label AS type_label
    FROM majordhome.clients c
    JOIN majordhome.equipments e ON e.project_id = c.project_id
    LEFT JOIN majordhome.equipment_categories ec ON ec.id = e.category_id
    LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = e.equipment_type_id
   WHERE e.status = 'active'::majordhome.equipment_status;
GRANT SELECT ON public.majordhome_client_equipment_kinds TO authenticated, service_role;

-- ── 9. process_web_entretien sans enum ─────────────────────────────────────
-- Seul changement fonctionnel : l'INSERT dans equipments n'envoie plus `category`
-- (dérivée du type par le trigger ; type inconnu → non catégorisé). Le wrapper
-- public.process_web_entretien (LANGUAGE sql) reste valide : même signature.
CREATE OR REPLACE FUNCTION majordhome.process_web_entretien(
  p_org_id          uuid,
  p_prenom          text,
  p_nom             text,
  p_email           text,
  p_telephone       text,
  p_adresse         text,
  p_code_postal     text,
  p_ville           text,
  p_zone            text    DEFAULT NULL,
  p_equipements     jsonb   DEFAULT '[]'::jsonb,
  p_estimation_ttc  numeric DEFAULT 0,
  p_sous_total      numeric DEFAULT 0,
  p_discount        integer DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_label  text    DEFAULT NULL,
  p_details         jsonb   DEFAULT '[]'::jsonb,
  p_message         text    DEFAULT NULL
)
RETURNS TABLE(
  out_client_id       uuid,
  out_contract_id     uuid,
  out_contract_number character varying,
  out_intervention_id uuid,
  out_contract_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core', 'pg_temp'
AS $function$
DECLARE
  v_client_id       UUID;
  v_project_id      UUID;
  v_contract_id     UUID;
  v_contract_number VARCHAR;
  v_contract_status majordhome.contract_status;
  v_locked          BOOLEAN := false;
  v_intervention_id UUID;
  v_zone_id         UUID;
  v_display_name    TEXT;
  v_eq              JSONB;
  v_eq_id           UUID;
  v_eq_type_id      UUID;
  v_fallback_type   UUID;
  v_detail          JSONB;
  v_dept            TEXT;
  v_new_eq_ids      UUID[] := '{}';
  v_i               INTEGER;
  v_count           INTEGER;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = 'P0001';
  END IF;

  v_display_name := btrim(coalesce(p_prenom, '') || ' ' || coalesce(p_nom, ''));

  -- ═══ 1. ZONE (résolue par les données de l'org) ═══
  SELECT z.id INTO v_zone_id FROM majordhome.pricing_zones z
   WHERE z.org_id = p_org_id AND z.is_active
     AND upper(z.code) = upper(btrim(coalesce(p_zone, '')))
   ORDER BY z.sort_order LIMIT 1;

  IF v_zone_id IS NULL AND coalesce(btrim(p_zone), '') <> '' THEN
    SELECT z.id INTO v_zone_id FROM majordhome.pricing_zones z
     WHERE z.org_id = p_org_id AND z.is_active
       AND btrim(p_zone) = ANY(z.departments)
     ORDER BY z.sort_order LIMIT 1;
  END IF;

  IF v_zone_id IS NULL THEN
    v_dept := left(nullif(btrim(coalesce(p_code_postal, '')), ''), 2);
    IF v_dept IS NOT NULL THEN
      SELECT z.id INTO v_zone_id FROM majordhome.pricing_zones z
       WHERE z.org_id = p_org_id AND z.is_active AND v_dept = ANY(z.departments)
       ORDER BY z.sort_order LIMIT 1;
    END IF;
  END IF;

  IF v_zone_id IS NULL THEN
    SELECT z.id INTO v_zone_id FROM majordhome.pricing_zones z
     WHERE z.org_id = p_org_id AND z.is_active AND z.is_default
     ORDER BY z.sort_order LIMIT 1;
  END IF;

  IF v_zone_id IS NULL THEN
    RAISE EXCEPTION 'no_pricing_zone_for_org' USING ERRCODE = 'P0001';
  END IF;

  -- ═══ 2. CLIENT ═══
  SELECT c.id, c.project_id INTO v_client_id, v_project_id
    FROM majordhome.clients c
   WHERE c.email = p_email AND c.org_id = p_org_id LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO core.projects (org_id, name, status)
    VALUES (p_org_id, v_display_name, 'active') RETURNING id INTO v_project_id;

    INSERT INTO majordhome.clients (
      project_id, org_id, first_name, last_name, display_name,
      email, phone, address, postal_code, city, lead_source, is_web_draft)
    VALUES (v_project_id, p_org_id, p_prenom, p_nom, v_display_name,
      p_email, p_telephone, p_adresse, p_code_postal, p_ville, 'web', true)
    RETURNING id INTO v_client_id;
  ELSE
    UPDATE majordhome.clients SET
      phone       = coalesce(nullif(btrim(p_telephone), ''), phone),
      address     = coalesce(nullif(btrim(p_adresse), ''), address),
      postal_code = coalesce(nullif(btrim(p_code_postal), ''), postal_code),
      city        = coalesce(nullif(btrim(p_ville), ''), city),
      updated_at  = NOW()
    WHERE id = v_client_id;
  END IF;

  -- ═══ 3. CONTRAT EXISTANT ? ═══
  SELECT ct.id, ct.contract_number, ct.status
    INTO v_contract_id, v_contract_number, v_contract_status
    FROM majordhome.contracts ct WHERE ct.client_id = v_client_id;

  v_locked := v_contract_id IS NOT NULL AND v_contract_status <> 'pending';

  -- ═══ 4. ÉQUIPEMENTS (type résolu par (org, code) ; catégorie dérivée par trigger) ═══
  IF NOT v_locked THEN
    v_count := jsonb_array_length(coalesce(p_equipements, '[]'::jsonb));
    FOR v_i IN 0 .. v_count - 1 LOOP
      v_eq := p_equipements -> v_i;
      v_eq_type_id := NULL;
      SELECT pet.id INTO v_eq_type_id
        FROM majordhome.pricing_equipment_types pet
       WHERE pet.org_id = p_org_id AND pet.code = v_eq ->> 'type' LIMIT 1;

      INSERT INTO majordhome.equipments (project_id, equipment_type_id, notes, metadata)
      VALUES (v_project_id, v_eq_type_id, v_eq ->> 'label',
        jsonb_build_object('quantity', coalesce((v_eq ->> 'quantity')::int, 1),
          'source', 'web', 'form_type', v_eq ->> 'type'))
      RETURNING id INTO v_eq_id;
      v_new_eq_ids := v_new_eq_ids || v_eq_id;
    END LOOP;
  END IF;

  -- ═══ 5. CONTRAT ═══
  IF NOT v_locked THEN
    DELETE FROM majordhome.contract_pricing_items WHERE contract_id = v_contract_id;
    DELETE FROM majordhome.contract_equipments WHERE contract_id = v_contract_id;

    INSERT INTO majordhome.contracts (
      org_id, client_id, status, start_date, zone_id,
      amount, subtotal, discount_percent, source, notes)
    VALUES (p_org_id, v_client_id, 'pending', CURRENT_DATE, v_zone_id,
      p_estimation_ttc, p_sous_total, p_discount, 'web', p_message)
    ON CONFLICT (client_id) DO UPDATE SET
      status = 'pending', zone_id = EXCLUDED.zone_id, amount = EXCLUDED.amount,
      subtotal = EXCLUDED.subtotal, discount_percent = EXCLUDED.discount_percent,
      source = EXCLUDED.source, notes = EXCLUDED.notes, updated_at = NOW()
    RETURNING id, contract_number INTO v_contract_id, v_contract_number;

    IF array_length(v_new_eq_ids, 1) > 0 THEN
      INSERT INTO majordhome.contract_equipments (contract_id, equipment_id)
      SELECT v_contract_id, unnest(v_new_eq_ids);
    END IF;

    -- ═══ 6. LIGNES TARIFAIRES ═══
    SELECT pet.id INTO v_fallback_type FROM majordhome.pricing_equipment_types pet
     WHERE pet.org_id = p_org_id AND pet.is_active AND pet.is_entretien
     ORDER BY pet.sort_order LIMIT 1;
    IF v_fallback_type IS NULL THEN
      SELECT pet.id INTO v_fallback_type FROM majordhome.pricing_equipment_types pet
       WHERE pet.org_id = p_org_id AND pet.is_active
       ORDER BY pet.sort_order LIMIT 1;
    END IF;

    v_count := jsonb_array_length(coalesce(p_details, '[]'::jsonb));
    FOR v_i IN 0 .. v_count - 1 LOOP
      v_detail := p_details -> v_i;
      v_eq_type_id := NULL;

      SELECT e.equipment_type_id INTO v_eq_type_id FROM majordhome.equipments e
       WHERE e.id = ANY(v_new_eq_ids) AND e.equipment_type_id IS NOT NULL
         AND coalesce(e.notes, '') <> ''
         AND (v_detail ->> 'label') ILIKE '%' || e.notes || '%' LIMIT 1;

      IF v_eq_type_id IS NULL THEN
        SELECT e.equipment_type_id INTO v_eq_type_id FROM majordhome.equipments e
         WHERE e.id = ANY(v_new_eq_ids) AND e.equipment_type_id IS NOT NULL LIMIT 1;
      END IF;

      v_eq_type_id := coalesce(v_eq_type_id, v_fallback_type);

      IF v_eq_type_id IS NOT NULL THEN
        INSERT INTO majordhome.contract_pricing_items (
          contract_id, equipment_type_id, zone_id,
          quantity, base_price, unit_price, line_total)
        VALUES (v_contract_id, v_eq_type_id, v_zone_id, 1,
          coalesce((v_detail ->> 'price')::numeric, 0), 0,
          coalesce((v_detail ->> 'price')::numeric, 0));
      END IF;
    END LOOP;
  END IF;

  -- ═══ 7. INTERVENTION « à planifier » (dans tous les cas) ═══
  INSERT INTO majordhome.interventions (
    project_id, client_id, contract_id, intervention_type,
    status, workflow_status, includes_entretien, tags, metadata)
  VALUES (v_project_id, v_client_id, v_contract_id, 'entretien',
    'scheduled', 'a_planifier', true,
    CASE WHEN v_locked THEN ARRAY['Web', 'Contrat existant'] ELSE ARRAY['Web'] END,
    jsonb_build_object('source', 'web', 'equipements', p_equipements, 'zone', p_zone,
      'estimation', p_estimation_ttc, 'contract_locked', v_locked, 'message', p_message))
  RETURNING id INTO v_intervention_id;

  RETURN QUERY SELECT v_client_id, v_contract_id, v_contract_number,
                      v_intervention_id, v_locked;
END;
$function$;

-- ── 10. Comptages ──────────────────────────────────────────────────────────
DO $$
DECLARE
  n_cat int; n_types_sans int; n_eq_cat int; n_eq_non int; n_inv int; n_skills int;
BEGIN
  SELECT count(*) INTO n_cat FROM majordhome.equipment_categories;
  SELECT count(*) INTO n_types_sans FROM majordhome.pricing_equipment_types WHERE category_id IS NULL;
  SELECT count(*) INTO n_eq_cat FROM majordhome.equipments WHERE category_id IS NOT NULL;
  SELECT count(*) INTO n_eq_non FROM majordhome.equipments WHERE category_id IS NULL;
  SELECT count(*) INTO n_inv FROM majordhome.equipments e
    JOIN majordhome.pricing_equipment_types t ON t.id = e.equipment_type_id
   WHERE e.category_id IS DISTINCT FROM t.category_id;
  SELECT count(*) INTO n_skills FROM majordhome.team_member_skills;
  RAISE NOTICE 'referentiel M1 : % catégories, % type(s) sans catégorie, % équipements catégorisés, % non catégorisés, % violation(s) de l''invariant, % compétences',
    n_cat, n_types_sans, n_eq_cat, n_eq_non, n_inv, n_skills;
  IF n_inv > 0 THEN
    RAISE EXCEPTION 'referentiel M1 : invariant « typé ⇒ catégorie du type » violé sur % équipement(s)', n_inv;
  END IF;
END $$;
