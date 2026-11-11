-- 20261112_4_referentiel_appareils.sql — référentiel des appareils installés (base)
-- Spec : docs/superpowers/specs/2026-11-11-referentiel-appareils-installes-saisie-terrain-design.md § 3.
-- Plan : docs/superpowers/plans/2026-11-11-referentiel-appareils-installes-saisie-terrain.md, tâche 3.
-- majordhome.equipment_models (470 modèles relevés sur le site de pièces Invicta) devient le référentiel des appareils
-- installés : une fiche a une ORIGINE (relevé fabricant, recherche web, article du catalogue), un ÉTAT de contrôle et une
-- clé facultative vers l'article. Marques de référence par organisation (equipment_brand_refs). La clôture d'un relevé
-- fabricant ne touche plus que les fiches relevées (sinon la relève Invicta suivante désactiverait les fiches web).
-- Répétée sur scripts/migration-rehearsal/ (assert-referentiel-appareils.sql).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Fiches : origine, état, liens
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.equipment_models
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'releve_fabricant',
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'controle',
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES majordhome.catalog_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS equipment_type_id uuid REFERENCES majordhome.pricing_equipment_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES majordhome.equipment_models(id) ON DELETE SET NULL;

ALTER TABLE majordhome.equipment_models DROP CONSTRAINT IF EXISTS equipment_models_origin_check;
ALTER TABLE majordhome.equipment_models ADD CONSTRAINT equipment_models_origin_check
  CHECK (origin IN ('releve_fabricant', 'web', 'catalogue'));
ALTER TABLE majordhome.equipment_models DROP CONSTRAINT IF EXISTS equipment_models_review_status_check;
ALTER TABLE majordhome.equipment_models ADD CONSTRAINT equipment_models_review_status_check
  CHECK (review_status IN ('controle', 'a_controler'));
ALTER TABLE majordhome.equipment_models DROP CONSTRAINT IF EXISTS equipment_models_not_merged_into_self;
ALTER TABLE majordhome.equipment_models ADD CONSTRAINT equipment_models_not_merged_into_self
  CHECK (merged_into IS NULL OR merged_into <> id);

CREATE INDEX IF NOT EXISTS equipment_models_a_controler_idx
  ON majordhome.equipment_models (org_id, review_status) WHERE review_status = 'a_controler';
CREATE INDEX IF NOT EXISTS equipment_models_catalog_item_idx
  ON majordhome.equipment_models (catalog_item_id) WHERE catalog_item_id IS NOT NULL;

COMMENT ON TABLE majordhome.equipment_models IS 'Référentiel des appareils installés : modèles relevés chez le fabricant, trouvés par la recherche web ou créés depuis un article. Écrit par RPC seulement (aucune écriture authenticated).';
COMMENT ON COLUMN majordhome.equipment_models.origin IS 'releve_fabricant (site de pièces), web (recherche validée sur le terrain), catalogue (créée depuis un article).';
COMMENT ON COLUMN majordhome.equipment_models.review_status IS 'controle, ou a_controler (fiche web en attente dans la file de contrôle org_admin).';
COMMENT ON COLUMN majordhome.equipment_models.catalog_item_id IS 'Article du catalogue qui correspond à cet appareil, s''il en existe un (facultatif : un appareil installé peut ne plus être vendu).';
COMMENT ON COLUMN majordhome.equipment_models.merged_into IS 'Fiche absorbée par une fusion : elle sort des recherches, ses équipements sont passés sur la fiche gardée.';

-- Liens vers la même organisation seulement (catalogue, type d'équipement, fusion).
CREATE OR REPLACE FUNCTION majordhome.equipment_models_check_refs() RETURNS trigger
LANGUAGE plpgsql
SET search_path = majordhome, public
AS $$
BEGIN
  IF NEW.catalog_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM majordhome.catalog_items ci WHERE ci.id = NEW.catalog_item_id AND ci.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'catalog_item_other_org' USING ERRCODE = '22023';
  END IF;
  IF NEW.equipment_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM majordhome.pricing_equipment_types t WHERE t.id = NEW.equipment_type_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'equipment_type_other_org' USING ERRCODE = '22023';
  END IF;
  IF NEW.merged_into IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM majordhome.equipment_models m WHERE m.id = NEW.merged_into AND m.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'merged_into_other_org' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.equipment_models_check_refs() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS equipment_models_check_refs ON majordhome.equipment_models;
CREATE TRIGGER equipment_models_check_refs
  BEFORE INSERT OR UPDATE OF catalog_item_id, equipment_type_id, merged_into, org_id ON majordhome.equipment_models
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipment_models_check_refs();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Marques de référence par organisation
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.equipment_brand_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  brand_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_brand_refs_org_key_unique UNIQUE (org_id, brand_key)
);
COMMENT ON TABLE majordhome.equipment_brand_refs IS 'Écriture de référence d''une marque d''appareil par organisation (MAJUSCULES) : la saisie terrain la propose. Écrite par majordhome.equipment_brand_ref_ensure seulement.';

CREATE OR REPLACE FUNCTION majordhome.equipment_brand_refs_set_key() RETURNS trigger
LANGUAGE plpgsql
SET search_path = majordhome, public
AS $$
BEGIN
  NEW.name := upper(btrim(NEW.name));
  NEW.brand_key := majordhome.equipment_model_key(NEW.name);
  IF NEW.brand_key IS NULL THEN
    RAISE EXCEPTION 'brand_key_required' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.equipment_brand_refs_set_key() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS equipment_brand_refs_set_key ON majordhome.equipment_brand_refs;
CREATE TRIGGER equipment_brand_refs_set_key
  BEFORE INSERT OR UPDATE OF name ON majordhome.equipment_brand_refs
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipment_brand_refs_set_key();

ALTER TABLE majordhome.equipment_brand_refs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipment_brand_refs_select ON majordhome.equipment_brand_refs;
CREATE POLICY equipment_brand_refs_select ON majordhome.equipment_brand_refs FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
REVOKE ALL ON majordhome.equipment_brand_refs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.equipment_brand_refs TO authenticated, service_role;

-- Renvoie l'écriture de référence de la marque (la crée si absente). Appelée par les RPC de création de fiche.
CREATE OR REPLACE FUNCTION majordhome.equipment_brand_ref_ensure(p_org_id uuid, p_brand text) RETURNS text
LANGUAGE plpgsql
SET search_path = majordhome, public
AS $$
DECLARE
  v_k text := majordhome.equipment_model_key(p_brand);
  v_name text;
BEGIN
  IF p_org_id IS NULL OR v_k IS NULL THEN RETURN NULL; END IF;
  SELECT r.name INTO v_name FROM majordhome.equipment_brand_refs r WHERE r.org_id = p_org_id AND r.brand_key = v_k;
  IF v_name IS NOT NULL THEN RETURN v_name; END IF;
  INSERT INTO majordhome.equipment_brand_refs (org_id, name, brand_key) VALUES (p_org_id, p_brand, v_k)
  ON CONFLICT (org_id, brand_key) DO NOTHING;
  SELECT r.name INTO v_name FROM majordhome.equipment_brand_refs r WHERE r.org_id = p_org_id AND r.brand_key = v_k;
  RETURN v_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.equipment_brand_ref_ensure(uuid, text) FROM PUBLIC, anon, authenticated;

-- Amorçage : marques des équipements, des fiches et des articles actifs ; par clé, l'écriture la plus fréquente.
INSERT INTO majordhome.equipment_brand_refs (org_id, name, brand_key)
SELECT DISTINCT ON (s.org_id, s.k) s.org_id, s.nom, s.k
FROM (
  SELECT x.org_id, upper(btrim(x.brand)) AS nom, majordhome.equipment_model_key(x.brand) AS k, count(*) AS n
  FROM (
    SELECT majordhome.project_org_id(e.project_id) AS org_id, e.brand FROM majordhome.equipments e
    UNION ALL SELECT em.org_id, em.brand FROM majordhome.equipment_models em
    UNION ALL SELECT ci.org_id, ci.brand FROM majordhome.catalog_items ci WHERE ci.merged_into IS NULL AND ci.is_active
  ) x
  WHERE x.org_id IS NOT NULL AND majordhome.equipment_model_key(x.brand) IS NOT NULL
  GROUP BY 1, 2, 3
) s
ORDER BY s.org_id, s.k, s.n DESC, s.nom
ON CONFLICT (org_id, brand_key) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Clôture d'un relevé fabricant : seulement les fiches relevées
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equipment_models_close(
  p_org_id uuid,
  p_brand text,
  p_source_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_bk text := majordhome.equipment_model_key(p_brand);
  v_des int := 0;
  v_rat int := 0;
BEGIN
  IF p_org_id IS NULL OR v_bk IS NULL OR COALESCE(btrim(p_source_version), '') = '' THEN
    RAISE EXCEPTION 'brand_and_version_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.equipment_models em
                 WHERE em.org_id = p_org_id AND em.brand_key = v_bk AND em.origin = 'releve_fabricant'
                   AND em.source ->> 'version' = p_source_version) THEN
    RAISE EXCEPTION 'releve_non_importe' USING ERRCODE = '22023', HINT = 'Aucun modèle de cette marque ne porte cette version : rien n''est désactivé.';
  END IF;

  -- Modèles RELEVÉS absents du relevé : désactivés, jamais supprimés. Une fiche web ou catalogue n'est jamais touchée.
  UPDATE majordhome.equipment_models em SET is_active = false, updated_at = now()
  WHERE em.org_id = p_org_id AND em.brand_key = v_bk AND em.is_active AND em.origin = 'releve_fabricant'
    AND em.source ->> 'version' IS DISTINCT FROM p_source_version;
  GET DIAGNOSTICS v_des = ROW_COUNT;

  -- Rattachement d'office : modèle saisi EXACTEMENT égal à une référence fabricant d'un seul modèle relevé actif.
  WITH cand AS (
    SELECT e.id AS equipment_id, em.id AS model_id, count(*) OVER (PARTITION BY e.id) AS n
    FROM majordhome.equipments e
    JOIN majordhome.equipment_models em
      ON em.org_id = p_org_id AND em.brand_key = v_bk AND em.is_active AND em.origin = 'releve_fabricant'
     AND em.merged_into IS NULL
     AND em.reference_key IN (majordhome.equipment_model_key(e.model), 'p' || majordhome.equipment_model_key(e.model))
    WHERE e.equipment_model_id IS NULL
      AND majordhome.equipment_model_key(e.brand) = v_bk
      AND majordhome.project_org_id(e.project_id) = p_org_id
  )
  UPDATE majordhome.equipments e SET equipment_model_id = c.model_id
  FROM cand c WHERE c.equipment_id = e.id AND c.n = 1;
  GET DIAGNOSTICS v_rat = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'version', p_source_version, 'modeles_desactives', v_des, 'equipements_rattaches', v_rat);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_models_close(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_models_close(uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.equipment_models_close(uuid, text, text) IS
  'Clôt un relevé de modèles d''appareil (service_role) : désactive les modèles RELEVÉS de la marque absents de cette version, rattache d''office les équipements dont le modèle saisi est exactement une référence fabricant. Les fiches web ou catalogue ne sont jamais touchées.';

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Vues de lecture
-- ---------------------------------------------------------------------------------------------------------------
-- Colonnes ajoutées EN FIN (CREATE OR REPLACE VIEW n'autorise que cela).
CREATE OR REPLACE VIEW public.majordhome_equipment_models WITH (security_invoker = true) AS
  SELECT em.id, em.org_id, em.supplier_id, em.brand, em.brand_key, em.source_id, em.reference, em.reference_key, em.name,
         em.model_name, em.model_name_key, em.category, em.lifecycle, em.photo_path, em.exploded_views, em.source,
         em.is_active, em.created_at, em.updated_at,
         em.origin, em.review_status, em.catalog_item_id, em.equipment_type_id, em.specs, em.source_urls,
         em.created_by, em.reviewed_by, em.reviewed_at, em.merged_into,
         (SELECT ci.source_product_id FROM majordhome.catalog_items ci WHERE ci.id = em.catalog_item_id) AS catalog_source_product_id
  FROM majordhome.equipment_models em;
REVOKE ALL ON public.majordhome_equipment_models FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_equipment_models TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_equipment_brand_refs WITH (security_invoker = true) AS
  SELECT r.id, r.org_id, r.name, r.brand_key FROM majordhome.equipment_brand_refs r;
REVOKE ALL ON public.majordhome_equipment_brand_refs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_equipment_brand_refs TO authenticated, service_role;
