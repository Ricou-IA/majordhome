-- 20261129_4 — Les lignes d'un relevé se rattachent aux articles qui n'ont pas (ou plus) de fournisseur.
--
-- Spec : docs/superpowers/specs/2026-11-28-import-articles-fichier-design.md (§ 6.5). Suite de 20261129_2 / _3.
-- Recrée public.catalog_items_ensure et public.catalog_item_proposals_propose depuis leur définition de PRODUCTION du
-- 2026-11-28 (pg_get_functiondef ; identiques à 20261027_4 et 20261027_5). Signatures, droits (service_role seul) et
-- retours inchangés. Ces deux fonctions tournent après CHAQUE relevé de CHAQUE organisation de l'instance partagée.
--
-- Pourquoi : un article importé d'un fichier n'a pas de ligne fournisseur (ou une ligne à la référence de l'ancien
-- logiciel, que le premier relevé complet éteint). L'étape 2 exigeait une ligne active à prix et l'absence de TOUTE
-- ligne du fournisseur : la ligne du site créait un second article à côté de l'article importé.
--
-- 1. catalog_items_ensure, étape 2 (rattachement franc) :
--    - un article est candidat s'il a la même nature et les mêmes clés (marque + model_key, ou EAN valide) portées
--      par l'article lui-même OU par une de ses lignes ACTIVES, et qu'il est le seul candidat (inchangé) ;
--    - « l'article a déjà une ligne de ce fournisseur » ne compte que les lignes ACTIVES (une ligne éteinte par un
--      relevé n'empêche plus la nouvelle référence du même produit de s'y rattacher) ;
--    - contrôle du prix : article AVEC une ligne active à prix ⇒ règle d'avant (rapport ≤ 2 avec la meilleure offre) ;
--      article SANS ligne active à prix ⇒ achat de la ligne ≤ prix de vente de l'article quand celui-ci est > 0, aucun
--      contrôle quand il vaut 0. Source du lien : `cle` / `ean` comme avant.
--    - garde-fous (revue 1) : plus de 10 articles candidats ⇒ ambigu (création) ; les clés des lignes d'un fournisseur
--      INACTIF ne comptent pas (comme dans les propositions) ; un EAN fait de zéros est écarté (ensure et propositions ;
--      il n'est plus recopié sur un article créé).
--    Effet des propositions sur la production mesuré AVANT livraison : scripts/catalogue/mesure-effet-rattachement-sans-offre.sql.
--    Effet assumé, toutes organisations : un article dont toutes les lignes ont été éteintes (ou sont à 0 €) redevient
--    candidat par ses clés. Mesure avant / après : scripts/catalogue/mesure-rattachement-sans-offre.sql.
--    Nouvel index supplier_products (org_id, code_ean) : la recherche par l'EAN des lignes se fait une fois par ligne
--    relevée sans rattachement (sans index : un parcours complet de supplier_products à chaque fois).
-- 2. catalog_item_proposals_propose : t_cles reçoit aussi, pour chaque article vivant qui porte une clé, sa propre
--    ligne (supplier_id NULL). Le test « fournisseur commun » ignore ces lignes (t_four ne garde que les vrais
--    fournisseurs). Garde-fous de 20261027_5 conservés : clé partagée par plus de 10 articles écartée, index + ANALYZE
--    sur chaque table temporaire. Un article sans ligne à prix n'est jamais fusionné d'office (pas de prix à comparer) :
--    il est proposé.
--
-- Répétée sur scripts/migration-rehearsal/ (fixture-catalog-harmonisation-prod.sql → 20261028_4 → 20261124_2 →
-- 20261129_2 → 20261129_3 → 20261129_4 ; assert-rattachement-articles-sans-offre.sql, assert-catalog-items.sql,
-- assert-catalog-items-harmonisation.sql).
--
-- Mesuré sur le harnais le 2026-11-28, jeu à la taille de la production (41 400 lignes : Mayer 31 100 lignes de 12
-- fournisseurs reproduisant les volumes, EAN et clés relevés en prod ; Cimaj 10 274 articles à lignes à 0 €), avant →
-- après : création de tout le catalogue Mayer (31 100 lignes) 23,9 → 28,8 s ; relevé de 1 000 lignes 0,64 → 1,37 s ;
-- relevé Cimaj de 2 000 lignes portant les EAN de ses articles 1,95 → 3,80 s (1 550 rattachées au lieu de 0) ;
-- propositions Mayer 0,40 → 0,56 s (0,42 → 0,70 après un relevé), Cimaj 0,16 → 0,27 s (1,09 → 0,40 après un relevé).
--
-- Retour arrière : rejouer les définitions de catalog_items_ensure (20261027_4, § 1a) et de
-- catalog_item_proposals_propose (20261027_5), puis DROP INDEX majordhome.supplier_products_org_ean_idx.

CREATE INDEX IF NOT EXISTS supplier_products_org_ean_idx
  ON majordhome.supplier_products USING btree (org_id, code_ean) WHERE code_ean IS NOT NULL;

-- 1. Création automatique des articles en fin de relevé
CREATE OR REPLACE FUNCTION public.catalog_items_ensure(p_org_id uuid, p_limit integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_crees int := 0;
  v_ratt int := 0;
  r record;
  v_item uuid;
  v_src text;
  v_n int;
  v_ean boolean;
  v_ean_r text;     -- EAN valide de la ligne (8 à 14 chiffres), sinon NULL
  v_cle_r boolean;  -- la ligne porte marque + model_key
  v_ids uuid[];     -- articles qui portent une clé de la ligne
  v_ids_ean uuid[]; -- … dont par l'EAN
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
    -- un EAN fait de zéros (« 00000000 ») ne désigne aucun produit : écarté comme un EAN invalide
    v_ean_r := CASE WHEN r.code_ean ~ '^[0-9]{8,14}$' AND r.code_ean !~ '^0+$' THEN r.code_ean END;
    v_cle_r := r.model_key IS NOT NULL AND r.brand IS NOT NULL;

    -- (1) une autre ligne du même fournisseur et même référence (doublon legacy) est déjà rattachée : même article
    SELECT q.catalog_item_id INTO v_item FROM majordhome.supplier_products q
    WHERE q.supplier_id = r.supplier_id AND q.reference = r.reference AND q.id <> r.id AND q.catalog_item_id IS NOT NULL
    ORDER BY q.created_at LIMIT 1;
    IF v_item IS NOT NULL THEN v_src := 'auto'; END IF;

    -- (2) rattachement franc : même marque + modèle, ou même EAN, portés par l'article ou par une de ses lignes
    --     actives ; un seul article candidat ; aucune ligne ACTIVE de ce fournisseur ; même nature ; prix plausible
    --     (rapport ≤ 2 avec la meilleure offre active de l'article, ou, s'il n'en a pas, achat ≤ prix de vente
    --     quand celui-ci est renseigné).
    --     En deux temps : (2a) les articles qui portent la clé, une branche par clé et par origine, chacune sur son
    --     index ; (2b) les contrôles, sur ces seuls articles. D'un seul tenant, le planificateur partait de tous les
    --     articles de l'organisation dès que ses statistiques la croyaient vide (organisation nouvelle, gros premier
    --     relevé) : 2,7 ms par ligne au lieu de 0,7 mesurés sur le harnais (2 000 lignes : 5,5 s contre 1,4 s).
    IF v_item IS NULL AND (v_cle_r OR v_ean_r IS NOT NULL) THEN
      SELECT array_agg(DISTINCT x.item), array_agg(DISTINCT x.item) FILTER (WHERE x.par_ean)
        INTO v_ids, v_ids_ean
      FROM (
        SELECT i2.id AS item, false AS par_ean FROM majordhome.catalog_items i2
         WHERE v_cle_r AND i2.org_id = p_org_id AND lower(i2.brand) = lower(r.brand) AND i2.model_key = r.model_key
        UNION ALL
        SELECT i2.id, true FROM majordhome.catalog_items i2
         WHERE v_ean_r IS NOT NULL AND i2.org_id = p_org_id AND i2.code_ean = v_ean_r
        UNION ALL
        SELECT q.catalog_item_id, false FROM majordhome.supplier_products q
          JOIN majordhome.suppliers s ON s.id = q.supplier_id AND s.is_active
         WHERE v_cle_r AND q.org_id = p_org_id AND lower(q.brand) = lower(r.brand) AND q.model_key = r.model_key
           AND q.is_active AND q.catalog_item_id IS NOT NULL
        UNION ALL
        SELECT q.catalog_item_id, true FROM majordhome.supplier_products q
          JOIN majordhome.suppliers s ON s.id = q.supplier_id AND s.is_active
         WHERE v_ean_r IS NOT NULL AND q.org_id = p_org_id AND q.code_ean = v_ean_r
           AND q.is_active AND q.catalog_item_id IS NOT NULL
      ) x;

      -- plus de 10 articles portent la clé : elle ne distingue rien (même seuil que les propositions) ⇒ ambigu, création
      IF v_ids IS NOT NULL AND cardinality(v_ids) <= 10 THEN
        SELECT count(*), (array_agg(i.id))[1], bool_or(i.id = ANY (COALESCE(v_ids_ean, '{}'::uuid[])))
          INTO v_n, v_item, v_ean
        FROM majordhome.catalog_items i
        JOIN LATERAL (SELECT min(q.purchase_price_ht) AS prix FROM majordhome.supplier_products q
                      WHERE q.catalog_item_id = i.id AND q.is_active AND q.purchase_price_ht > 0) m ON true
        WHERE i.id = ANY (v_ids)
          AND i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL
          AND i.product_kind = COALESCE(r.product_kind, 'main')
          AND NOT EXISTS (SELECT 1 FROM majordhome.supplier_products q
                          WHERE q.catalog_item_id = i.id AND q.supplier_id = r.supplier_id AND q.is_active)
          AND CASE WHEN m.prix IS NOT NULL
                   THEN greatest(r.purchase_price_ht, m.prix) <= 2 * least(r.purchase_price_ht, m.prix)
                   ELSE COALESCE(i.selling_price_ht, 0) <= 0 OR r.purchase_price_ht <= i.selling_price_ht
              END;
        IF v_n = 1 THEN v_src := CASE WHEN v_ean THEN 'ean' ELSE 'cle' END; ELSE v_item := NULL; END IF;
      END IF;
    END IF;

    -- (3) sinon : création (copie des champs humains et des specs canoniques de la ligne)
    IF v_item IS NULL THEN
      INSERT INTO majordhome.catalog_items
        (org_id, name, brand, model_key, code_ean, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht,
         description, image_url, specs, source_product_id, origin)
      VALUES
        (p_org_id, r.name, r.brand, r.model_key, v_ean_r, r.category, r.gamme, COALESCE(r.product_kind, 'main'),
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
$function$;

REVOKE ALL ON FUNCTION public.catalog_items_ensure(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_items_ensure(uuid, integer) TO service_role;

-- 2. Propositions de fusion
CREATE OR REPLACE FUNCTION public.catalog_item_proposals_propose(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  r record;
  v_fusionnes int := 0;
  v_proposes int := 0;
  v_surv uuid; v_abs uuid;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'org_required' USING ERRCODE = '22023'; END IF;

  -- Clés de chaque article vivant : celles de ses lignes actives (fournisseur actif), plus les siennes propres
  -- (supplier_id NULL) — un article importé d'un fichier n'a souvent aucune ligne (20261129_4).
  IF to_regclass('pg_temp.t_cles') IS NOT NULL THEN DROP TABLE pg_temp.t_cles; END IF;
  CREATE TEMP TABLE t_cles ON COMMIT DROP AS
    SELECT i.id AS item, i.product_kind, i.created_at, p.supplier_id, lower(p.brand) AS marque, p.model_key, (CASE WHEN p.code_ean ~ '^[0-9]{8,14}$' AND p.code_ean !~ '^0+$' THEN p.code_ean END) AS ean
    FROM majordhome.catalog_items i
    JOIN majordhome.supplier_products p ON p.catalog_item_id = i.id AND p.is_active
    JOIN majordhome.suppliers s ON s.id = p.supplier_id AND s.is_active
    WHERE i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL
    UNION ALL
    SELECT i.id, i.product_kind, i.created_at, NULL::uuid, lower(i.brand), i.model_key, (CASE WHEN i.code_ean ~ '^[0-9]{8,14}$' AND i.code_ean !~ '^0+$' THEN i.code_ean END)
    FROM majordhome.catalog_items i
    WHERE i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL
      AND ((i.brand IS NOT NULL AND i.model_key IS NOT NULL) OR (i.code_ean ~ '^[0-9]{8,14}$' AND i.code_ean !~ '^0+$'));

  -- une clé partagée par plus de 10 articles ne distingue rien (faux EAN « - » sur 1 540 articles, référence générique) :
  -- l'écarter évite une jointure quadratique qui a saturé l'espace temporaire de la base partagée le 2026-10-25
  UPDATE t_cles SET model_key = NULL
  WHERE (marque, model_key) IN (SELECT marque, model_key FROM t_cles WHERE model_key IS NOT NULL GROUP BY 1, 2 HAVING count(DISTINCT item) > 10);
  UPDATE t_cles SET ean = NULL
  WHERE ean IN (SELECT ean FROM t_cles WHERE ean IS NOT NULL GROUP BY 1 HAVING count(DISTINCT item) > 10);

  -- Statistiques et index sur les tables temporaires : sans eux, le planificateur joignait toutes les lignes d'un même
  -- fournisseur entre elles pour le test « fournisseur commun » (DINAK 12 000², Modinox 11 800²) — espace temporaire
  -- de la base partagée saturé le 2026-10-25. t_four = fournisseurs distincts de chaque article, indexée par article ;
  -- les clés propres d'un article (supplier_id NULL) n'y entrent pas : ce ne sont pas des fournisseurs.
  CREATE INDEX ON t_cles (item);
  ANALYZE t_cles;
  IF to_regclass('pg_temp.t_four') IS NOT NULL THEN DROP TABLE pg_temp.t_four; END IF;
  CREATE TEMP TABLE t_four ON COMMIT DROP AS SELECT DISTINCT item, supplier_id FROM t_cles WHERE supplier_id IS NOT NULL;
  CREATE INDEX ON t_four (item, supplier_id);
  ANALYZE t_four;

  IF to_regclass('pg_temp.t_prix') IS NOT NULL THEN DROP TABLE pg_temp.t_prix; END IF;
  CREATE TEMP TABLE t_prix ON COMMIT DROP AS
    SELECT p.catalog_item_id AS item, min(p.purchase_price_ht) FILTER (WHERE p.purchase_price_ht > 0) AS prix
    FROM majordhome.supplier_products p WHERE p.is_active AND p.catalog_item_id IN (SELECT DISTINCT item FROM t_cles)
    GROUP BY p.catalog_item_id;
  CREATE INDEX ON t_prix (item);
  ANALYZE t_prix;

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
$function$;

REVOKE ALL ON FUNCTION public.catalog_item_proposals_propose(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_item_proposals_propose(uuid) TO service_role;
