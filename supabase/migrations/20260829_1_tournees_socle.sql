-- 20260829_1_tournees_socle.sql
-- Socle de l'optimisation des tournées d'entretien.
-- Spec : docs/superpowers/specs/2026-08-29-optimisation-tournees-entretiens-design.md
-- Plan : docs/superpowers/plans/2026-08-29-optimisation-tournees-entretiens.md
--
-- 1) Durée d'intervention par type d'équipement (même mécanique que le prix :
--    base + N unités au-delà de `included_units`).
-- 2) Mois défavorables par type (préférence, jamais interdiction — cf. spec 3.3).
-- 3) Budget de travail journalier par technicien, distinct de l'amplitude
--    `default_availability` qui, elle, borne OÙ placer un RDV.
-- 4) Cache des temps de trajet : condition de fonctionnement, pas optimisation
--    (quota Mapbox Matrix = 100 000 éléments/mois).

-- ── 1 & 2 ──────────────────────────────────────────────────────────────────
ALTER TABLE majordhome.pricing_equipment_types
  ADD COLUMN IF NOT EXISTS duration_base_minutes            integer,
  ADD COLUMN IF NOT EXISTS duration_per_extra_unit_minutes  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unfavorable_months               smallint[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN majordhome.pricing_equipment_types.duration_base_minutes IS
  'Duree d''entretien de base en minutes. NULL = type non entretenu (travaux, prestations).';
COMMENT ON COLUMN majordhome.pricing_equipment_types.duration_per_extra_unit_minutes IS
  'Minutes ajoutees par unite au-dela de included_units (ex. +30 min par split).';
COMMENT ON COLUMN majordhome.pricing_equipment_types.unfavorable_months IS
  'Mois (1-12) ou l''entretien est deconseille (appareil chaud). Preference penalisante, jamais un filtre.';

-- ── 3 ──────────────────────────────────────────────────────────────────────
ALTER TABLE majordhome.team_members
  ADD COLUMN IF NOT EXISTS daily_work_minutes  integer NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS include_in_routing  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN majordhome.team_members.daily_work_minutes IS
  'Budget de travail journalier (trajets + interventions, pause exclue). Distinct de l''amplitude default_availability.';
COMMENT ON COLUMN majordhome.team_members.include_in_routing IS
  'false = ressource hors optimisation des tournees (sous-traitant organise hors outil).';

-- ── 4 ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS majordhome.travel_cache (
  org_id       uuid        NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  from_key     text        NOT NULL,
  to_key       text        NOT NULL,
  minutes      integer     NOT NULL,
  km           numeric(7,2),
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, from_key, to_key)
);

COMMENT ON TABLE majordhome.travel_cache IS
  'Temps de trajet voiture entre deux points, cles = "lat,lng" arrondis a 3 decimales (~100 m).';

ALTER TABLE majordhome.travel_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS travel_cache_select ON majordhome.travel_cache;
CREATE POLICY travel_cache_select ON majordhome.travel_cache FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

DROP POLICY IF EXISTS travel_cache_insert ON majordhome.travel_cache;
CREATE POLICY travel_cache_insert ON majordhome.travel_cache FOR INSERT
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

DROP POLICY IF EXISTS travel_cache_update ON majordhome.travel_cache;
CREATE POLICY travel_cache_update ON majordhome.travel_cache FOR UPDATE
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE ON majordhome.travel_cache TO service_role;

DROP VIEW IF EXISTS public.majordhome_travel_cache;
CREATE VIEW public.majordhome_travel_cache
  WITH (security_invoker = true) AS
  SELECT org_id, from_key, to_key, minutes, km, computed_at
  FROM majordhome.travel_cache;

GRANT SELECT, INSERT, UPDATE ON public.majordhome_travel_cache TO authenticated;

-- ── Seed Mayer ─────────────────────────────────────────────────────────────
-- Durées validées avec Eric le 2026-08-29. Mois défavorables = combustion
-- (appareil devant être froid) : novembre à mars.
WITH d(code, base, per_unit, unfavorable) AS (VALUES
  ('poele_granules_elec',       90,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('poele_bois_insert',         60,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('pac_air_air',               60, 30, ARRAY[]::smallint[]),
  ('chaudiere_granules',       150,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('pac_air_eau',               90,  0, ARRAY[]::smallint[]),
  ('gainable',                  90,  0, ARRAY[]::smallint[]),
  ('ballon_thermo',             90,  0, ARRAY[]::smallint[]),
  ('chaudiere_bois',           150,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('poele_granules_sans_elec',  90,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('poele_hydro',              150,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('chauffe_eau_solaire',       90,  0, ARRAY[]::smallint[]),
  ('panneau_photovoltaique',    90,  0, ARRAY[]::smallint[])
)
UPDATE majordhome.pricing_equipment_types pet
   SET duration_base_minutes           = d.base,
       duration_per_extra_unit_minutes = d.per_unit,
       unfavorable_months              = d.unfavorable,
       updated_at                      = now()
  FROM d
 WHERE pet.code = d.code
   AND pet.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';

-- Mohammed est un renfort ponctuel, organisé hors outil (spec §9).
-- ⚠️ ASYMÉTRIE D'ORG : team_members et appointments portent l'org MAJORDHOME
-- (7825fe43…), alors que contracts, clients et pricing_equipment_types portent
-- l'org CORE (3c68193e…). Filtrer team_members sur l'org core matcherait ZÉRO
-- ligne sans lever d'erreur. travel_cache ci-dessus est volontairement en org
-- CORE : ses points viennent des clients et du siège, tous deux côté core.
UPDATE majordhome.team_members
   SET include_in_routing = false
 WHERE org_id = '7825fe43-cacb-4feb-b783-6ea3f1ccff77'
   AND trim(first_name) ILIKE 'Mohammed';
