-- mesure-effet-rattachement-sans-offre.sql — LECTURE SEULE (deux SELECT, aucune fonction qui écrit, aucun DDL).
-- À lancer en production AVANT d'appliquer 20261129_4_rattachement_articles_sans_offre.sql (revue 1 de la Task 7).
--
-- Requête 1 — catalog_item_proposals_propose : rejoue l'appariement de l'ANCIENNE (20261027_5) et de la NOUVELLE
-- logique (clés propres des articles avec supplier_id NULL, EAN de zéros écartés), avec les mêmes garde-fous (clé
-- partagée par plus de 10 articles écartée, fournisseur commun, paire déjà décidée ou proposée), et liste par
-- organisation les paires qui seraient FRANCHES — donc fusionnées d'office au premier passage — avec la nouvelle
-- logique et qui ne le sont pas avec l'ancienne. Limite : la boucle de propose saute une paire dont un article vient
-- d'être absorbé dans le même passage ; la mesure compte toutes les paires franches, sans ce chaînage.
--
-- Requête 2 — catalog_items_ensure : lignes actives à prix sans article (celles que le prochain passage traitera) qui
-- se rattacheraient avec la nouvelle étape 2 alors que l'ancienne crée un article.

-- ═══ Requête 1 : nouvelles fusions d'office ═══════════════════════════════════════════════════════════════════════
WITH vivants AS (
  SELECT i.* FROM majordhome.catalog_items i WHERE i.is_active AND i.merged_into IS NULL
),
cles_brutes AS (
  -- clés des lignes actives d'un fournisseur actif (les deux versions ; la nouvelle écarte les EAN de zéros)
  SELECT v.version, i.org_id, i.id AS item, p.supplier_id, lower(p.brand) AS marque, p.model_key,
         CASE WHEN p.code_ean ~ '^[0-9]{8,14}$' AND (v.version = 'ancien' OR p.code_ean !~ '^0+$') THEN p.code_ean END AS ean
    FROM vivants i
    JOIN majordhome.supplier_products p ON p.catalog_item_id = i.id AND p.is_active
    JOIN majordhome.suppliers s ON s.id = p.supplier_id AND s.is_active
   CROSS JOIN (VALUES ('ancien'), ('nouveau')) v(version)
  UNION ALL
  -- nouvelle version seulement : clés propres de l'article (supplier_id NULL)
  SELECT 'nouveau', i.org_id, i.id, NULL::uuid, lower(i.brand), i.model_key,
         CASE WHEN i.code_ean ~ '^[0-9]{8,14}$' AND i.code_ean !~ '^0+$' THEN i.code_ean END
    FROM vivants i
   WHERE (i.brand IS NOT NULL AND i.model_key IS NOT NULL) OR (i.code_ean ~ '^[0-9]{8,14}$' AND i.code_ean !~ '^0+$')
),
cles_trop_partagees AS (
  SELECT version, org_id, marque, model_key FROM cles_brutes WHERE model_key IS NOT NULL
   GROUP BY 1, 2, 3, 4 HAVING count(DISTINCT item) > 10
),
ean_trop_partages AS (
  SELECT version, org_id, ean FROM cles_brutes WHERE ean IS NOT NULL GROUP BY 1, 2, 3 HAVING count(DISTINCT item) > 10
),
cles AS (
  SELECT c.version, c.org_id, c.item, c.supplier_id, c.marque,
         CASE WHEN k.model_key IS NULL THEN c.model_key END AS model_key,
         CASE WHEN e.ean IS NULL THEN c.ean END AS ean
    FROM cles_brutes c
    LEFT JOIN cles_trop_partagees k ON k.version = c.version AND k.org_id = c.org_id AND k.marque = c.marque AND k.model_key = c.model_key
    LEFT JOIN ean_trop_partages e ON e.version = c.version AND e.org_id = c.org_id AND e.ean = c.ean
),
four AS (SELECT DISTINCT version, item, supplier_id FROM cles WHERE supplier_id IS NOT NULL),
prix AS (
  SELECT p.catalog_item_id AS item, min(p.purchase_price_ht) FILTER (WHERE p.purchase_price_ht > 0) AS prix
    FROM majordhome.supplier_products p WHERE p.is_active AND p.catalog_item_id IS NOT NULL GROUP BY 1
),
sans_suffixe AS (
  SELECT version, org_id, item, marque, model_key, left(model_key, -1) AS k FROM cles
   WHERE model_key ~ '[A-Z]$' AND length(model_key) >= 6 AND marque IS NOT NULL
  UNION ALL
  SELECT version, org_id, item, marque, model_key, left(model_key, -2) FROM cles
   WHERE model_key ~ '[A-Z]{2}$' AND length(model_key) >= 7 AND marque IS NOT NULL
),
toutes AS (
  SELECT DISTINCT x.version, x.org_id, least(x.item, y.item) AS a, greatest(x.item, y.item) AS b,
         'marque + modèle ' || x.model_key AS motif, 'k:' || x.marque || ':' || x.model_key AS cle, false AS proche
    FROM cles x JOIN cles y ON y.version = x.version AND y.org_id = x.org_id AND y.item <> x.item
                           AND y.marque = x.marque AND y.model_key = x.model_key
   WHERE x.model_key IS NOT NULL AND x.marque IS NOT NULL
  UNION
  SELECT DISTINCT x.version, x.org_id, least(x.item, y.item), greatest(x.item, y.item),
         'code EAN ' || x.ean, 'e:' || x.ean, false
    FROM cles x JOIN cles y ON y.version = x.version AND y.org_id = x.org_id AND y.item <> x.item AND y.ean = x.ean
   WHERE x.ean IS NOT NULL
  UNION
  SELECT DISTINCT x.version, x.org_id, least(x.item, y.item), greatest(x.item, y.item),
         'modèle proche ' || x.model_key || ' / ' || y.model_key, 'p:' || x.marque || ':' || x.model_key, true
    FROM sans_suffixe y JOIN cles x ON x.version = y.version AND x.org_id = y.org_id AND x.marque = y.marque
                                   AND x.model_key = y.k AND x.item <> y.item
),
-- jointures ensemblistes plutôt que des sous-requêtes corrélées sur des CTE (sans index : coût quadratique)
avec_commun AS (
  SELECT DISTINCT t.version, t.a, t.b
    FROM toutes t
    JOIN four fa ON fa.version = t.version AND fa.item = t.a
    JOIN four fb ON fb.version = t.version AND fb.item = t.b AND fb.supplier_id = fa.supplier_id
),
sans_commun AS (
  SELECT t.* FROM toutes t
    LEFT JOIN avec_commun c ON c.version = t.version AND c.a = t.a AND c.b = t.b
    LEFT JOIN majordhome.catalog_item_proposals x ON x.item_a_id = t.a AND x.item_b_id = t.b
   WHERE c.a IS NULL AND x.id IS NULL
),
partenaires AS (
  SELECT version, cle, item, count(DISTINCT partenaire) AS n FROM (
    SELECT version, cle, a AS item, b AS partenaire FROM sans_commun
    UNION ALL
    SELECT version, cle, b, a FROM sans_commun
  ) z GROUP BY 1, 2, 3
),
evaluees AS (
  SELECT t.version, t.org_id, t.a, t.b, t.motif,
         (NOT t.proche AND na.n = 1 AND nb.n = 1 AND ia.product_kind = ib.product_kind
          AND pa.prix IS NOT NULL AND pb.prix IS NOT NULL
          AND greatest(pa.prix, pb.prix) <= 2 * least(pa.prix, pb.prix)) AS franche
    FROM sans_commun t
    JOIN partenaires na ON na.version = t.version AND na.cle = t.cle AND na.item = t.a
    JOIN partenaires nb ON nb.version = t.version AND nb.cle = t.cle AND nb.item = t.b
    JOIN majordhome.catalog_items ia ON ia.id = t.a
    JOIN majordhome.catalog_items ib ON ib.id = t.b
    LEFT JOIN prix pa ON pa.item = t.a
    LEFT JOIN prix pb ON pb.item = t.b
),
paires AS (
  SELECT version, org_id, a, b, bool_or(franche) AS franche, string_agg(DISTINCT motif, ' ; ') AS motifs
    FROM evaluees GROUP BY 1, 2, 3, 4
),
nouvelles AS (
  SELECT n.org_id, n.a, n.b, n.motifs, CASE WHEN o.a IS NULL THEN 'absente' ELSE 'proposée' END AS avant
    FROM paires n
    LEFT JOIN paires o ON o.version = 'ancien' AND o.a = n.a AND o.b = n.b
   WHERE n.version = 'nouveau' AND n.franche AND o.franche IS NOT TRUE
)
SELECT org.name AS organisation, count(*) OVER (PARTITION BY nv.org_id) AS nouvelles_fusions_org, nv.avant, nv.motifs,
       ia.id AS a_id, ia.name AS a_nom, ia.brand AS a_marque, ia.model_key AS a_modele, ia.code_ean AS a_ean, pa.prix AS a_prix,
       ib.id AS b_id, ib.name AS b_nom, ib.brand AS b_marque, ib.model_key AS b_modele, ib.code_ean AS b_ean, pb.prix AS b_prix
  FROM nouvelles nv
  JOIN core.organizations org ON org.id = nv.org_id
  JOIN majordhome.catalog_items ia ON ia.id = nv.a
  JOIN majordhome.catalog_items ib ON ib.id = nv.b
  LEFT JOIN prix pa ON pa.item = nv.a
  LEFT JOIN prix pb ON pb.item = nv.b
 ORDER BY org.name, ia.name, ib.name;

-- ═══ Requête 2 : lignes qui se rattacheraient (ensure) ═══════════════════════════════════════════════════════════
WITH a_traiter AS (
  SELECT p.*, CASE WHEN p.code_ean ~ '^[0-9]{8,14}$' AND p.code_ean !~ '^0+$' THEN p.code_ean END AS ean_n,
         CASE WHEN p.code_ean ~ '^[0-9]{8,14}$' THEN p.code_ean END AS ean_a,
         (p.model_key IS NOT NULL AND p.brand IS NOT NULL) AS cle
    FROM majordhome.supplier_products p
   WHERE p.is_active AND p.catalog_item_id IS NULL AND COALESCE(p.purchase_price_ht, 0) > 0
     AND (p.specs -> 'canonical' ->> 'offert_dans_pack')::boolean IS NOT TRUE
     -- l'étape 1 (doublon legacy déjà rattaché) passe avant et est inchangée
     AND NOT EXISTS (SELECT 1 FROM majordhome.supplier_products q WHERE q.supplier_id = p.supplier_id AND q.reference = p.reference
                      AND q.id <> p.id AND q.catalog_item_id IS NOT NULL)
),
nouveau AS (
  -- nb = articles VIVANTS qui portent une clé de la ligne (seuil de 10 de ensure, revue 2) ; n = candidats retenus
  SELECT r.id, c.nb, c.n
    FROM a_traiter r
   CROSS JOIN LATERAL (
     SELECT count(*) AS nb,
            count(*) FILTER (WHERE i.product_kind = COALESCE(r.product_kind, 'main')
              AND NOT EXISTS (SELECT 1 FROM majordhome.supplier_products q WHERE q.catalog_item_id = i.id AND q.supplier_id = r.supplier_id AND q.is_active)
              AND CASE WHEN m.prix IS NOT NULL THEN greatest(r.purchase_price_ht, m.prix) <= 2 * least(r.purchase_price_ht, m.prix)
                       ELSE COALESCE(i.selling_price_ht, 0) <= 0 OR r.purchase_price_ht <= i.selling_price_ht END) AS n
       FROM majordhome.catalog_items i
       JOIN LATERAL (SELECT min(q.purchase_price_ht) AS prix FROM majordhome.supplier_products q
                     WHERE q.catalog_item_id = i.id AND q.is_active AND q.purchase_price_ht > 0) m ON true
      WHERE i.id IN (
              SELECT i2.id FROM majordhome.catalog_items i2 WHERE r.cle AND i2.org_id = r.org_id AND lower(i2.brand) = lower(r.brand) AND i2.model_key = r.model_key
              UNION SELECT i2.id FROM majordhome.catalog_items i2 WHERE r.ean_n IS NOT NULL AND i2.org_id = r.org_id AND i2.code_ean = r.ean_n
              UNION SELECT q.catalog_item_id FROM majordhome.supplier_products q JOIN majordhome.suppliers s ON s.id = q.supplier_id AND s.is_active
                     WHERE r.cle AND q.org_id = r.org_id AND lower(q.brand) = lower(r.brand) AND q.model_key = r.model_key AND q.is_active AND q.catalog_item_id IS NOT NULL
              UNION SELECT q.catalog_item_id FROM majordhome.supplier_products q JOIN majordhome.suppliers s ON s.id = q.supplier_id AND s.is_active
                     WHERE r.ean_n IS NOT NULL AND q.org_id = r.org_id AND q.code_ean = r.ean_n AND q.is_active AND q.catalog_item_id IS NOT NULL)
        AND i.org_id = r.org_id AND i.is_active AND i.merged_into IS NULL
   ) c
   WHERE r.cle OR r.ean_n IS NOT NULL
),
ancien AS (
  SELECT r.id, (SELECT count(*) FROM majordhome.catalog_items i
                  JOIN LATERAL (SELECT min(q.purchase_price_ht) AS prix FROM majordhome.supplier_products q
                                WHERE q.catalog_item_id = i.id AND q.is_active AND q.purchase_price_ht > 0) m ON true
                 WHERE i.org_id = r.org_id AND i.is_active AND i.merged_into IS NULL AND i.product_kind = COALESCE(r.product_kind, 'main')
                   AND ((r.cle AND lower(i.brand) = lower(r.brand) AND i.model_key = r.model_key) OR (r.ean_a IS NOT NULL AND i.code_ean = r.ean_a))
                   AND NOT EXISTS (SELECT 1 FROM majordhome.supplier_products q WHERE q.catalog_item_id = i.id AND q.supplier_id = r.supplier_id)
                   AND m.prix IS NOT NULL AND greatest(r.purchase_price_ht, m.prix) <= 2 * least(r.purchase_price_ht, m.prix)) AS n
    FROM a_traiter r WHERE r.cle OR r.ean_a IS NOT NULL
)
SELECT org.name AS organisation,
       count(*) AS lignes_a_traiter,
       count(*) FILTER (WHERE r.cle OR r.ean_n IS NOT NULL OR r.ean_a IS NOT NULL) AS dont_avec_cle,
       count(*) FILTER (WHERE a.n = 1) AS rattachees_avant,
       count(*) FILTER (WHERE n.n = 1 AND n.nb <= 10) AS rattachees_apres,
       count(*) FILTER (WHERE n.n = 1 AND n.nb <= 10 AND a.n IS DISTINCT FROM 1) AS nouvelles_rattachees,
       count(*) FILTER (WHERE n.nb > 10) AS ambigues_plus_de_10
  FROM a_traiter r
  JOIN core.organizations org ON org.id = r.org_id
  LEFT JOIN nouveau n ON n.id = r.id
  LEFT JOIN ancien a ON a.id = r.id
 GROUP BY org.name
 ORDER BY org.name;
