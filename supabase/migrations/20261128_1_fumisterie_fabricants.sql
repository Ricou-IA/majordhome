-- supabase/migrations/20261128_1_fumisterie_fabricants.sql
-- ============================================================================
-- Métré de fumisterie indépendant du fabricant (spec 2026-11-28-fumisterie-plan-dtu-dinak-design.md, bloc C).
--   - fum_metres.supplier_id : fabricant retenu à l'injection (NULL = métré antérieur, fabricant historique).
--   - fum_gamme_equivalences : par configuration et par fabricant, gamme du tarif équivalente, longueurs
--     d'éléments / de raccordement et plage du réglable propres au fabricant ; « validée » par une personne
--     (Eric ou Philippe) — une équivalence non validée reste utilisable et l'écran le dit.
--   - majordhome_fum_fabricants : fournisseurs de l'organisation qui ont des articles de fumisterie.
-- org_id = org CORE. Lecture membre, écriture org_admin. Répétée sur scripts/migration-rehearsal/
-- (assert-fumisterie-fabricants.sql, chaîne 20260929_1 → 20261128_1).
-- ============================================================================

ALTER TABLE majordhome.fum_metres ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES majordhome.suppliers(id);
COMMENT ON COLUMN majordhome.fum_metres.supplier_id IS
  'Fabricant retenu à l''injection (comparaison des fabricants). NULL = métré antérieur au 2026-11-28 : fabricant historique de l''organisation.';

-- La vue miroir a figé ses colonnes à sa création (SELECT *) : la recréer ajoute supplier_id EN FIN de liste.
-- CREATE OR REPLACE garde les droits existants ; anon et PUBLIC sont retirés à nouveau par prudence.
CREATE OR REPLACE VIEW public.majordhome_fum_metres WITH (security_invoker = true) AS SELECT * FROM majordhome.fum_metres;
REVOKE ALL ON public.majordhome_fum_metres FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS majordhome.fum_gamme_equivalences (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES core.organizations(id),
  configuration_code        text NOT NULL,
  gamme_catalogue           text NOT NULL,
  supplier_id               uuid NOT NULL REFERENCES majordhome.suppliers(id),
  gamme_tarif               text NOT NULL,
  finition                  text CHECK (finition IS NULL OR finition IN ('noir', 'inox')),
  longueurs_elements_mm     integer[],
  longueurs_raccordement_mm integer[],
  reglable_min_mm           integer,
  reglable_max_mm           integer,
  notes                     text,
  validee_par               text,
  validee_le                date,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fum_gamme_equivalences_reglable CHECK ((reglable_min_mm IS NULL) = (reglable_max_mm IS NULL) AND (reglable_min_mm IS NULL OR reglable_min_mm < reglable_max_mm)),
  CONSTRAINT fum_gamme_equivalences_validation CHECK ((validee_par IS NULL) = (validee_le IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS fum_gamme_equivalences_cle
  ON majordhome.fum_gamme_equivalences (org_id, configuration_code, gamme_catalogue, supplier_id, coalesce(finition, ''));
COMMENT ON TABLE majordhome.fum_gamme_equivalences IS
  'Fumisterie : gamme équivalente d''une configuration chez un fabricant, avec ses longueurs propres. Proposée par l''import (scripts/fumisterie), validée par une personne (validee_par / validee_le).';

DROP TRIGGER IF EXISTS trg_fum_gamme_equivalences_updated_at ON majordhome.fum_gamme_equivalences;
CREATE TRIGGER trg_fum_gamme_equivalences_updated_at BEFORE UPDATE ON majordhome.fum_gamme_equivalences
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

ALTER TABLE majordhome.fum_gamme_equivalences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fum_gamme_equivalences_select ON majordhome.fum_gamme_equivalences;
CREATE POLICY fum_gamme_equivalences_select ON majordhome.fum_gamme_equivalences FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
-- Écriture : org_admin de l'organisation, et le fabricant doit être un fournisseur de CETTE organisation.
DROP POLICY IF EXISTS fum_gamme_equivalences_write_admin ON majordhome.fum_gamme_equivalences;
CREATE POLICY fum_gamme_equivalences_write_admin ON majordhome.fum_gamme_equivalences FOR ALL TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid()) AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid()) AND om.role = 'org_admin')
    AND supplier_id IN (SELECT s.id FROM majordhome.suppliers s WHERE s.org_id = fum_gamme_equivalences.org_id));
REVOKE ALL ON majordhome.fum_gamme_equivalences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.fum_gamme_equivalences TO authenticated;
GRANT SELECT ON majordhome.fum_gamme_equivalences TO service_role;

DROP VIEW IF EXISTS public.majordhome_fum_gamme_equivalences;
CREATE VIEW public.majordhome_fum_gamme_equivalences WITH (security_invoker = true) AS SELECT * FROM majordhome.fum_gamme_equivalences;
REVOKE ALL ON public.majordhome_fum_gamme_equivalences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_fum_gamme_equivalences TO authenticated;
GRANT SELECT ON public.majordhome_fum_gamme_equivalences TO service_role;

-- Fabricants de fumisterie de l'organisation : fournisseurs qui ont au moins un article avec attributs.
DROP VIEW IF EXISTS public.majordhome_fum_fabricants;
CREATE VIEW public.majordhome_fum_fabricants WITH (security_invoker = true) AS
  SELECT s.id, s.org_id, s.name
    FROM majordhome.suppliers s
   WHERE EXISTS (SELECT 1 FROM majordhome.supplier_products p
                   JOIN majordhome.fum_article_attrs a ON a.supplier_product_id = p.id
                  WHERE p.supplier_id = s.id AND p.is_active);
REVOKE ALL ON public.majordhome_fum_fabricants FROM PUBLIC, anon;
GRANT SELECT ON public.majordhome_fum_fabricants TO authenticated, service_role;
