-- 20261027_2_articles_metadonnees.sql
-- Base d'articles fiabilisée (plan 2026-10-25, tranche B ; décisions d'Eric du 2026-10-25) :
--   1. « photo et fiche technique sont des métadonnées de l'article, pas du fournisseur » : product_documents peut
--      porter un catalog_item_id (document de l'article), la ligne fournisseur devient facultative (CHECK : l'un des
--      deux). Vues en LEFT JOIN, colonne en fin.
--   2. Rattacher une ligne à un article recopie ce qui manque à l'article (photo, caractéristiques canoniques) ; une
--      fusion déplace aussi les documents de l'article absorbé.
--   3. Clés modèle des lignes ECOSTAL depuis leur référence (le tarif PDF range la référence fabricant V2C dans
--      `reference` sans poser de clé) — source « manuel » : le prochain import du tarif ne les efface pas.
--   4. catalog_item_proposals_propose : deux clés de même marque qui ne diffèrent que d'un suffixe de 1 ou 2 lettres
--      (TRY323OL10 / TRY323OL10F : version française chez BayWa) sont PROPOSÉES, jamais fusionnées d'office.
-- Répétée sur scripts/migration-rehearsal/ (assert-articles-metadonnees.sql).

-- 1. Documents d'article
ALTER TABLE majordhome.product_documents
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES majordhome.catalog_items(id) ON DELETE CASCADE;
ALTER TABLE majordhome.product_documents ALTER COLUMN supplier_product_id DROP NOT NULL;
ALTER TABLE majordhome.product_documents DROP CONSTRAINT IF EXISTS product_documents_cible_check;
ALTER TABLE majordhome.product_documents ADD CONSTRAINT product_documents_cible_check
  CHECK (supplier_product_id IS NOT NULL OR catalog_item_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS product_documents_catalog_item_idx ON majordhome.product_documents (catalog_item_id) WHERE catalog_item_id IS NOT NULL;
COMMENT ON COLUMN majordhome.product_documents.catalog_item_id IS 'Document de l''article Majord''home (photo, fiche technique) — sinon document d''une ligne fournisseur';

CREATE OR REPLACE VIEW public.majordhome_product_documents WITH (security_invoker = true) AS
  SELECT d.id, d.supplier_product_id, d.org_id, d.document_type, d.file_name, d.storage_path, d.file_size, d.mime_type,
         d.uploaded_by, d.created_at, d.updated_at, sp.name AS product_name, sp.reference AS product_reference, d.catalog_item_id
  FROM majordhome.product_documents d
  LEFT JOIN majordhome.supplier_products sp ON sp.id = d.supplier_product_id;

CREATE OR REPLACE VIEW public.majordhome_product_documents_write WITH (security_invoker = true) AS
  SELECT id, supplier_product_id, org_id, document_type, file_name, storage_path, file_size, mime_type, uploaded_by,
         created_at, updated_at, catalog_item_id
  FROM majordhome.product_documents;

-- 2a. Fusion : les documents de l'article absorbé passent au survivant
CREATE OR REPLACE FUNCTION majordhome.catalog_item_merge_impl(p_survivor_id uuid, p_absorbed_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  s record; a record;
  v_lignes int := 0; v_devis int := 0;
BEGIN
  SELECT * INTO s FROM majordhome.catalog_items WHERE id = p_survivor_id;
  SELECT * INTO a FROM majordhome.catalog_items WHERE id = p_absorbed_id;
  IF s.id IS NULL OR a.id IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.org_id <> a.org_id THEN RAISE EXCEPTION 'items_not_same_org' USING ERRCODE = '42501'; END IF;
  IF s.id = a.id THEN RAISE EXCEPTION 'same_item' USING ERRCODE = '22023'; END IF;
  IF s.merged_into IS NOT NULL OR a.merged_into IS NOT NULL THEN RAISE EXCEPTION 'item_already_merged' USING ERRCODE = '22023'; END IF;

  UPDATE majordhome.supplier_products SET catalog_item_id = s.id, catalog_item_linked_at = now() WHERE catalog_item_id = a.id;
  GET DIAGNOSTICS v_lignes = ROW_COUNT;
  UPDATE majordhome.quote_lines SET catalog_item_id = s.id WHERE catalog_item_id = a.id;
  GET DIAGNOSTICS v_devis = ROW_COUNT;
  UPDATE majordhome.product_documents SET catalog_item_id = s.id, updated_at = now() WHERE catalog_item_id = a.id;

  -- le survivant garde ses valeurs, hérite des champs vides, les specs canoniques se complètent
  UPDATE majordhome.catalog_items SET
    brand = COALESCE(s.brand, a.brand),
    model_key = COALESCE(s.model_key, a.model_key),
    code_ean = COALESCE(s.code_ean, a.code_ean),
    category = COALESCE(s.category, a.category),
    gamme = COALESCE(s.gamme, a.gamme),
    description = COALESCE(s.description, a.description),
    image_url = COALESCE(s.image_url, a.image_url),
    selling_price_ht = CASE WHEN COALESCE(s.selling_price_ht, 0) = 0 THEN COALESCE(a.selling_price_ht, 0) ELSE s.selling_price_ht END,
    specs = (COALESCE(a.specs, '{}'::jsonb) || COALESCE(s.specs, '{}'::jsonb))
            || jsonb_build_object('canonical', COALESCE(a.specs -> 'canonical', '{}'::jsonb) || COALESCE(s.specs -> 'canonical', '{}'::jsonb)),
    updated_at = now()
  WHERE id = s.id;

  UPDATE majordhome.catalog_items SET merged_into = s.id, is_active = false, updated_at = now() WHERE id = a.id;

  -- les propositions encore en attente qui citaient l'absorbé n'ont plus de sens
  DELETE FROM majordhome.catalog_item_proposals WHERE statut = 'propose' AND (item_a_id = a.id OR item_b_id = a.id);

  RETURN jsonb_build_object('lignes', v_lignes, 'lignes_devis', v_devis);
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.catalog_item_merge_impl(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.catalog_item_merge_impl(uuid, uuid) TO service_role;

-- 2b. Rattacher : l'article prend la photo et les caractéristiques qui lui manquent (les siennes priment)
CREATE OR REPLACE FUNCTION public.catalog_item_attach(p_product_id uuid, p_item_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE p record; i record;
BEGIN
  SELECT * INTO p FROM majordhome.supplier_products WHERE id = p_product_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO i FROM majordhome.catalog_items WHERE id = p_item_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;
  IF i.org_id <> p.org_id THEN RAISE EXCEPTION 'items_not_same_org' USING ERRCODE = '42501'; END IF;
  IF i.merged_into IS NOT NULL THEN RAISE EXCEPTION 'item_already_merged' USING ERRCODE = '22023'; END IF;
  PERFORM majordhome.catalog_item_require_admin(p.org_id);
  IF p.catalog_item_id = p_item_id THEN RETURN; END IF;
  UPDATE majordhome.supplier_products
  SET catalog_item_id = p_item_id, catalog_item_link_source = 'manuel', catalog_item_linked_at = now()
  WHERE id = p_product_id;
  UPDATE majordhome.catalog_items SET
    is_active = true,
    image_url = COALESCE(i.image_url, p.image_url),
    specs = COALESCE(i.specs, '{}'::jsonb)
            || jsonb_build_object('canonical', COALESCE(p.specs -> 'canonical', '{}'::jsonb) || COALESCE(i.specs -> 'canonical', '{}'::jsonb)),
    updated_at = now()
  WHERE id = p_item_id;
  IF p.catalog_item_id IS NOT NULL THEN PERFORM majordhome.catalog_item_deactivate_if_empty(p.catalog_item_id); END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_attach(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_attach(uuid, uuid) TO authenticated, service_role;

-- 3. Clés modèle des lignes ECOSTAL (référence = code fabricant V2C), seulement si la référence porte un chiffre
UPDATE majordhome.supplier_products p
SET model_key = upper(regexp_replace(p.reference, '[^A-Za-z0-9]', '', 'g')), model_key_source = 'manuel', updated_at = now()
FROM majordhome.suppliers s
WHERE s.id = p.supplier_id AND upper(s.name) = 'ECOSTAL' AND p.model_key IS NULL AND p.reference ~ '[0-9]';

-- 4. Propositions : clés proches (suffixe de 1 ou 2 lettres) proposées, jamais fusionnées d'office
CREATE OR REPLACE FUNCTION public.catalog_item_proposals_propose(p_org_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  r record;
  v_fusionnes int := 0;
  v_proposes int := 0;
  v_surv uuid; v_abs uuid;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'org_required' USING ERRCODE = '22023'; END IF;

  IF to_regclass('pg_temp.t_cles') IS NOT NULL THEN DROP TABLE pg_temp.t_cles; END IF;
  CREATE TEMP TABLE t_cles ON COMMIT DROP AS
    SELECT i.id AS item, i.product_kind, i.created_at, p.supplier_id, lower(p.brand) AS marque, p.model_key, nullif(p.code_ean, '') AS ean
    FROM majordhome.catalog_items i
    JOIN majordhome.supplier_products p ON p.catalog_item_id = i.id AND p.is_active
    JOIN majordhome.suppliers s ON s.id = p.supplier_id AND s.is_active
    WHERE i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL;

  IF to_regclass('pg_temp.t_prix') IS NOT NULL THEN DROP TABLE pg_temp.t_prix; END IF;
  CREATE TEMP TABLE t_prix ON COMMIT DROP AS
    SELECT p.catalog_item_id AS item, min(p.purchase_price_ht) FILTER (WHERE p.purchase_price_ht > 0) AS prix
    FROM majordhome.supplier_products p WHERE p.is_active AND p.catalog_item_id IN (SELECT DISTINCT item FROM t_cles)
    GROUP BY p.catalog_item_id;

  IF to_regclass('pg_temp.t_paires') IS NOT NULL THEN DROP TABLE pg_temp.t_paires; END IF;
  CREATE TEMP TABLE t_paires ON COMMIT DROP AS
    WITH par_cle AS (
      SELECT DISTINCT least(x.item, y.item) AS a, greatest(x.item, y.item) AS b, 'cle'::text AS source,
             'marque + modèle ' || x.model_key AS motif, 'k:' || x.marque || ':' || x.model_key AS cle, false AS proche
      FROM t_cles x JOIN t_cles y ON y.item <> x.item AND y.marque = x.marque AND y.model_key = x.model_key
      WHERE x.model_key IS NOT NULL AND x.marque IS NOT NULL
    ),
    par_ean AS (
      SELECT DISTINCT least(x.item, y.item) AS a, greatest(x.item, y.item) AS b, 'ean'::text AS source,
             'code EAN ' || x.ean AS motif, 'e:' || x.ean AS cle, false AS proche
      FROM t_cles x JOIN t_cles y ON y.item <> x.item AND y.ean = x.ean
      WHERE x.ean IS NOT NULL
    ),
    -- même marque, une clé = l'autre + 1 ou 2 lettres (clés normalisées A-Z0-9 : pas d'injection de motif possible)
    par_proche AS (
      SELECT DISTINCT least(x.item, y.item) AS a, greatest(x.item, y.item) AS b, 'cle'::text AS source,
             'modèle proche ' || x.model_key || ' / ' || y.model_key AS motif, 'p:' || x.marque || ':' || x.model_key AS cle, true AS proche
      FROM t_cles x JOIN t_cles y ON y.item <> x.item AND y.marque = x.marque
      WHERE x.model_key IS NOT NULL AND x.marque IS NOT NULL AND length(x.model_key) >= 5
        AND y.model_key IS NOT NULL AND y.model_key ~ ('^' || x.model_key || '[A-Z]{1,2}$')
    ),
    toutes AS (SELECT * FROM par_cle UNION SELECT * FROM par_ean UNION SELECT * FROM par_proche),
    -- deux articles qui ont déjà un fournisseur en commun ne sont pas le même article
    sans_commun AS (
      SELECT t.* FROM toutes t
      WHERE NOT EXISTS (SELECT 1 FROM t_cles ca JOIN t_cles cb ON cb.supplier_id = ca.supplier_id WHERE ca.item = t.a AND cb.item = t.b)
        AND NOT EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals x WHERE x.item_a_id = t.a AND x.item_b_id = t.b)
    ),
    evaluees AS (
      SELECT t.a, t.b, t.source, t.motif,
             -- franche = clé exacte, un seul candidat de chaque côté, même nature, prix du même ordre (rapport ≤ 2)
             NOT t.proche
             AND (SELECT count(DISTINCT CASE WHEN u.a = t.a THEN u.b ELSE u.a END) FROM sans_commun u WHERE u.cle = t.cle AND (u.a = t.a OR u.b = t.a)) = 1
             AND (SELECT count(DISTINCT CASE WHEN u.a = t.b THEN u.b ELSE u.a END) FROM sans_commun u WHERE u.cle = t.cle AND (u.a = t.b OR u.b = t.b)) = 1
             AND (SELECT DISTINCT product_kind FROM t_cles WHERE item = t.a LIMIT 1) = (SELECT DISTINCT product_kind FROM t_cles WHERE item = t.b LIMIT 1)
             AND pa.prix IS NOT NULL AND pb.prix IS NOT NULL
             AND greatest(pa.prix, pb.prix) <= 2 * least(pa.prix, pb.prix) AS franche
      FROM sans_commun t
      LEFT JOIN t_prix pa ON pa.item = t.a
      LEFT JOIN t_prix pb ON pb.item = t.b
    )
    SELECT DISTINCT ON (e.a, e.b) e.a, e.b, e.source, e.motif, e.franche
    FROM evaluees e
    ORDER BY e.a, e.b, e.franche DESC, e.motif;

  -- fusions d'office d'abord (survivant = le plus ancien, puis le plus petit id), puis propositions
  FOR r IN SELECT * FROM t_paires ORDER BY franche DESC, a, b LOOP
    IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE id IN (r.a, r.b) AND merged_into IS NOT NULL) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals x WHERE x.item_a_id = r.a AND x.item_b_id = r.b) THEN CONTINUE; END IF;
    IF r.franche THEN
      SELECT CASE WHEN (ca.created_at, ca.id) <= (cb.created_at, cb.id) THEN ca.id ELSE cb.id END,
             CASE WHEN (ca.created_at, ca.id) <= (cb.created_at, cb.id) THEN cb.id ELSE ca.id END
        INTO v_surv, v_abs
      FROM majordhome.catalog_items ca, majordhome.catalog_items cb WHERE ca.id = r.a AND cb.id = r.b;
      INSERT INTO majordhome.catalog_item_proposals (org_id, item_a_id, item_b_id, source, motif, statut, decided_at)
      VALUES (p_org_id, r.a, r.b, r.source, r.motif || ' (fusion d''office)', 'fusionne', now());
      PERFORM majordhome.catalog_item_merge_impl(v_surv, v_abs);
      v_fusionnes := v_fusionnes + 1;
    ELSE
      INSERT INTO majordhome.catalog_item_proposals (org_id, item_a_id, item_b_id, source, motif, statut)
      VALUES (p_org_id, r.a, r.b, r.source, r.motif, 'propose')
      ON CONFLICT (item_a_id, item_b_id) DO NOTHING;
      v_proposes := v_proposes + 1;
    END IF;
  END LOOP;

  -- aucune proposition en attente ne cite un article absorbé
  DELETE FROM majordhome.catalog_item_proposals pr
  WHERE pr.org_id = p_org_id AND pr.statut = 'propose'
    AND EXISTS (SELECT 1 FROM majordhome.catalog_items i WHERE i.id IN (pr.item_a_id, pr.item_b_id) AND i.merged_into IS NOT NULL);

  RETURN jsonb_build_object('fusionnes', v_fusionnes, 'proposes', v_proposes, 'nouvelles', v_fusionnes + v_proposes);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_proposals_propose(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_item_proposals_propose(uuid) TO service_role;
