-- 20261027_4_ean_valides_cles_discriminantes.sql
-- Correctif urgent (2026-10-25) : catalog_item_proposals_propose saturait l'espace temporaire de la base partagée
-- (« No space left on device ») — 1 540 articles DINAK / MODINOX portent le même faux EAN « - », et la jointure par
-- EAN en faisait ~2,4 millions de paires. 20261027_3 n'avait corrigé que la jointure « à un suffixe près ».
--   1. Un EAN n'est retenu que s'il fait 8 à 14 chiffres (création d'article, rattachement franc, propositions) ;
--      les faux EAN déjà recopiés sur les articles sont effacés (la ligne fournisseur garde le sien, intact).
--   2. Propositions : une clé (marque + modèle, ou EAN) partagée par plus de 10 articles est écartée.
-- Répétée sur scripts/migration-rehearsal/ (assert-articles-metadonnees.sql, assert-catalog-items*.sql).

-- 1a. Création automatique des articles
CREATE OR REPLACE FUNCTION public.catalog_items_ensure(p_org_id uuid, p_limit int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_crees int := 0;
  v_ratt int := 0;
  r record;
  v_item uuid;
  v_src text;
  v_n int;
  v_ean boolean;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'org_required' USING ERRCODE = '22023'; END IF;

  -- Recadrage d'Eric (spec § 9) : une ligne sans prix d'achat ou offerte dans un pack n'a rien à faire dans la base devis.
  FOR r IN SELECT p.* FROM majordhome.supplier_products p
           WHERE p.org_id = p_org_id AND p.is_active AND p.catalog_item_id IS NULL
             AND COALESCE(p.purchase_price_ht, 0) > 0
             AND (p.specs -> 'canonical' ->> 'offert_dans_pack')::boolean IS NOT TRUE
           ORDER BY p.created_at, p.id
           LIMIT COALESCE(p_limit, 2147483647)
  LOOP
    v_item := NULL; v_src := NULL;

    -- (1) une autre ligne du même fournisseur et même référence (doublon legacy) est déjà rattachée : même article
    SELECT q.catalog_item_id INTO v_item FROM majordhome.supplier_products q
    WHERE q.supplier_id = r.supplier_id AND q.reference = r.reference AND q.id <> r.id AND q.catalog_item_id IS NOT NULL
    ORDER BY q.created_at LIMIT 1;
    IF v_item IS NOT NULL THEN v_src := 'auto'; END IF;

    -- (2) rattachement franc : même marque + modèle, ou même EAN ; un seul article candidat ; sans ligne de ce
    --     fournisseur ; même nature ; prix d'achat du même ordre (rapport ≤ 2 avec la meilleure offre de l'article)
    IF v_item IS NULL AND ((r.model_key IS NOT NULL AND r.brand IS NOT NULL) OR (CASE WHEN r.code_ean ~ '^[0-9]{8,14}$' THEN r.code_ean END) IS NOT NULL) THEN
      SELECT count(*), (array_agg(c.id))[1], bool_or(c.par_ean) INTO v_n, v_item, v_ean FROM (
        SELECT i.id, ((CASE WHEN r.code_ean ~ '^[0-9]{8,14}$' THEN r.code_ean END) IS NOT NULL AND i.code_ean = (CASE WHEN r.code_ean ~ '^[0-9]{8,14}$' THEN r.code_ean END)) AS par_ean
        FROM majordhome.catalog_items i
        JOIN LATERAL (SELECT min(q.purchase_price_ht) AS prix FROM majordhome.supplier_products q
                      WHERE q.catalog_item_id = i.id AND q.is_active AND q.purchase_price_ht > 0) m ON true
        WHERE i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL
          AND i.product_kind = COALESCE(r.product_kind, 'main')
          AND ((r.model_key IS NOT NULL AND r.brand IS NOT NULL AND lower(i.brand) = lower(r.brand) AND i.model_key = r.model_key)
               OR ((CASE WHEN r.code_ean ~ '^[0-9]{8,14}$' THEN r.code_ean END) IS NOT NULL AND i.code_ean = (CASE WHEN r.code_ean ~ '^[0-9]{8,14}$' THEN r.code_ean END)))
          AND NOT EXISTS (SELECT 1 FROM majordhome.supplier_products q WHERE q.catalog_item_id = i.id AND q.supplier_id = r.supplier_id)
          AND m.prix IS NOT NULL AND COALESCE(r.purchase_price_ht, 0) > 0
          AND greatest(r.purchase_price_ht, m.prix) <= 2 * least(r.purchase_price_ht, m.prix)
      ) c;
      IF v_n = 1 THEN v_src := CASE WHEN v_ean THEN 'ean' ELSE 'cle' END; ELSE v_item := NULL; END IF;
    END IF;

    -- (3) sinon : création (copie des champs humains et des specs canoniques de la ligne)
    IF v_item IS NULL THEN
      INSERT INTO majordhome.catalog_items
        (org_id, name, brand, model_key, code_ean, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht,
         description, image_url, specs, source_product_id, origin)
      VALUES
        (p_org_id, r.name, r.brand, r.model_key, (CASE WHEN r.code_ean ~ '^[0-9]{8,14}$' THEN r.code_ean END), r.category, r.gamme, COALESCE(r.product_kind, 'main'),
         COALESCE(r.unit, 'pièce'), COALESCE(r.default_tva_rate, 20), COALESCE(r.selling_price_ht, 0), r.description, r.image_url,
         jsonb_build_object('canonical', COALESCE(r.specs -> 'canonical', '{}'::jsonb)), r.id, 'auto')
      RETURNING id INTO v_item;
      v_src := 'auto';
      v_crees := v_crees + 1;
    ELSE
      v_ratt := v_ratt + 1;
    END IF;

    UPDATE majordhome.supplier_products
    SET catalog_item_id = v_item, catalog_item_link_source = v_src, catalog_item_linked_at = now()
    WHERE id = r.id;
  END LOOP;

  RETURN jsonb_build_object('crees', v_crees, 'rattaches', v_ratt);
END;
$$;

-- 1b. Nouvel article depuis une ligne
CREATE OR REPLACE FUNCTION majordhome.catalog_item_new_for_product(p_product_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE p record; v_new uuid;
BEGIN
  SELECT * INTO p FROM majordhome.supplier_products WHERE id = p_product_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO majordhome.catalog_items
    (org_id, name, brand, model_key, code_ean, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht,
     description, image_url, specs, source_product_id, origin)
  VALUES
    (p.org_id, p.name, p.brand, p.model_key, (CASE WHEN p.code_ean ~ '^[0-9]{8,14}$' THEN p.code_ean END), p.category, p.gamme, COALESCE(p.product_kind, 'main'),
     COALESCE(p.unit, 'pièce'), COALESCE(p.default_tva_rate, 20), COALESCE(p.selling_price_ht, 0), p.description, p.image_url,
     jsonb_build_object('canonical', COALESCE(p.specs -> 'canonical', '{}'::jsonb)), p.id, 'manuel')
  RETURNING id INTO v_new;
  UPDATE majordhome.supplier_products
  SET catalog_item_id = v_new, catalog_item_link_source = 'manuel', catalog_item_linked_at = now()
  WHERE id = p_product_id;
  RETURN v_new;
END;
$$;

-- 2. Propositions
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
    SELECT i.id AS item, i.product_kind, i.created_at, p.supplier_id, lower(p.brand) AS marque, p.model_key, (CASE WHEN p.code_ean ~ '^[0-9]{8,14}$' THEN p.code_ean END) AS ean
    FROM majordhome.catalog_items i
    JOIN majordhome.supplier_products p ON p.catalog_item_id = i.id AND p.is_active
    JOIN majordhome.suppliers s ON s.id = p.supplier_id AND s.is_active
    WHERE i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL;

  -- une clé partagée par plus de 10 articles ne distingue rien (faux EAN « - » sur 1 540 articles, référence générique) :
  -- l'écarter évite une jointure quadratique qui a saturé l'espace temporaire de la base partagée le 2026-10-25
  UPDATE t_cles SET model_key = NULL
  WHERE (marque, model_key) IN (SELECT marque, model_key FROM t_cles WHERE model_key IS NOT NULL GROUP BY 1, 2 HAVING count(DISTINCT item) > 10);
  UPDATE t_cles SET ean = NULL
  WHERE ean IN (SELECT ean FROM t_cles WHERE ean IS NOT NULL GROUP BY 1 HAVING count(DISTINCT item) > 10);

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
    -- même marque, une clé = l'autre + 1 ou 2 lettres : jointure d'ÉGALITÉ sur la clé tronquée de sa ou ses dernières
    -- lettres (coût linéaire). La première version comparait toutes les lignes d'une marque deux à deux avec une regex :
    -- 12 000 pièces DINAK ⇒ ~150 M paires, espace temporaire de la base saturé (« No space left on device », 2026-10-25).
    sans_suffixe AS (
      SELECT item, marque, model_key, left(model_key, -1) AS k FROM t_cles
      WHERE model_key ~ '[A-Z]$' AND length(model_key) >= 6 AND marque IS NOT NULL
      UNION ALL
      SELECT item, marque, model_key, left(model_key, -2) AS k FROM t_cles
      WHERE model_key ~ '[A-Z]{2}$' AND length(model_key) >= 7 AND marque IS NOT NULL
    ),
    par_proche AS (
      SELECT DISTINCT least(x.item, y.item) AS a, greatest(x.item, y.item) AS b, 'cle'::text AS source,
             'modèle proche ' || x.model_key || ' / ' || y.model_key AS motif, 'p:' || x.marque || ':' || x.model_key AS cle, true AS proche
      FROM sans_suffixe y JOIN t_cles x ON x.marque = y.marque AND x.model_key = y.k AND x.item <> y.item
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

REVOKE EXECUTE ON FUNCTION public.catalog_items_ensure(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_items_ensure(uuid, int) TO service_role;
REVOKE EXECUTE ON FUNCTION majordhome.catalog_item_new_for_product(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.catalog_item_proposals_propose(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_item_proposals_propose(uuid) TO service_role;

-- faux EAN recopiés sur les articles
UPDATE majordhome.catalog_items SET code_ean = NULL, updated_at = now() WHERE code_ean IS NOT NULL AND code_ean !~ '^[0-9]{8,14}$';
