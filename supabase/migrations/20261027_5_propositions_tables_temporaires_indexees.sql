-- 20261027_5_propositions_tables_temporaires_indexees.sql
-- Correctif urgent (2026-10-25), cause réelle de la saturation de l'espace temporaire : dans
-- catalog_item_proposals_propose, le test « les deux articles partagent un fournisseur » joignait t_cles à elle-même
-- sur supplier_id ; les tables temporaires n'ayant ni index ni statistiques, le planificateur matérialisait toutes
-- les paires de lignes d'un même fournisseur (DINAK 12 000², Modinox 11 800² ≈ 290 millions de lignes). Défaut présent
-- depuis 20261026_2, masqué tant que le plan choisi restait favorable. Correction : index + ANALYZE des tables
-- temporaires, table t_four (fournisseurs distincts par article) et test par article.
-- Répétée sur scripts/migration-rehearsal/ (assert-articles-metadonnees.sql, assert-catalog-items-harmonisation.sql).

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

  -- Statistiques et index sur les tables temporaires : sans eux, le planificateur joignait toutes les lignes d'un même
  -- fournisseur entre elles pour le test « fournisseur commun » (DINAK 12 000², Modinox 11 800²) — espace temporaire
  -- de la base partagée saturé le 2026-10-25. t_four = fournisseurs distincts de chaque article, indexée par article.
  CREATE INDEX ON t_cles (item);
  ANALYZE t_cles;
  IF to_regclass('pg_temp.t_four') IS NOT NULL THEN DROP TABLE pg_temp.t_four; END IF;
  CREATE TEMP TABLE t_four ON COMMIT DROP AS SELECT DISTINCT item, supplier_id FROM t_cles;
  CREATE INDEX ON t_four (item, supplier_id);
  ANALYZE t_four;

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
      WHERE NOT EXISTS (SELECT 1 FROM t_four fa WHERE fa.item = t.a AND EXISTS (SELECT 1 FROM t_four fb WHERE fb.item = t.b AND fb.supplier_id = fa.supplier_id))
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
