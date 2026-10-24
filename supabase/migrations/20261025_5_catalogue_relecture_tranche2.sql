-- 20261025_5_catalogue_relecture_tranche2.sql
-- Corrections de la relecture indépendante de la tranche 2 (catalogue photovoltaïque / connexion générique) :
--   I-2  supplier_catalog_upsert v5 (corps de 20261025_4, desactiver_absents conservé) : une clé modèle posée par
--        l'IA (model_key_source = 'ia') survit à un relevé dont l'adaptateur ne trouve toujours pas de clé (avant :
--        remise à NULL chaque nuit, la normalisation IA était perdue dès le lendemain). Une clé trouvée par
--        l'adaptateur ('cle') reste prioritaire, une clé manuelle n'est jamais touchée.
--        Le relevé mémorise aussi la catégorie calculée par l'adaptateur dans specs.categorie_releve (la catégorie
--        courante, humaine, n'est jamais touchée) : c'est ce qui permet de reconnaître une correction manuelle.
--   I-4  supplier_catalog_apply_mapping v2 : un article dont la catégorie courante diffère de celle du dernier
--        relevé (correction faite dans le drawer) n'est PAS reclassé ; compteur ignores_manuels. Avant, le bouton
--        « Appliquer la correspondance » écrasait les corrections manuelles alors que l'écran promettait l'inverse.
--   I-5  catalog_matches_propose : une paire qui correspond à la fois par marque + modèle et par code EAN ne
--        produit plus deux lignes candidates (23505 sur l'index unique ⇒ toute la proposition échouait) ;
--        DISTINCT ON + ON CONFLICT DO NOTHING.
--   M-1  majordhome.catalog_matches : anon n'a plus SELECT sur la table (RLS seule le tenait).
-- Répétée sur scripts/migration-rehearsal/ (assert-catalogue-generique.sql, assert-catalog-matches.sql).

-- ---------------------------------------------------------------------------------------------------------------
-- I-2 : upsert v5
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supplier_catalog_upsert(
  p_org_id uuid,
  p_supplier_id uuid,
  p_source_version text,
  p_rows jsonb,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_des int := 0;
  v_ign int := 0;
  v_total int := 0;
  v_res jsonb;
  v_desactiver boolean := COALESCE((p_meta ->> 'desactiver_absents')::boolean, true);
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows_empty' USING ERRCODE = '22023';
  END IF;
  IF p_org_id IS NULL OR p_supplier_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM majordhome.suppliers s WHERE s.id = p_supplier_id AND s.org_id = p_org_id) THEN
    RAISE EXCEPTION 'supplier_not_in_org' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('pg_temp.t_imp') IS NOT NULL THEN DROP TABLE pg_temp.t_imp; END IF;
  CREATE TEMP TABLE t_imp ON COMMIT DROP AS
    SELECT r.reference, r.name, r.brand, r.gamme, r.product_kind, r.purchase_price_ht, r.selling_price_ht_defaut,
           r.default_tva_rate, r.unit, r.category,
           -- la catégorie calculée par l'adaptateur est mémorisée à part : elle sert à reconnaître une correction manuelle
           COALESCE(r.specs, '{}'::jsonb)
             || CASE WHEN r.category IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('categorie_releve', r.category) END AS specs,
           r.image_url, r.image_source_url, r.model_key
    FROM jsonb_to_recordset(p_rows) AS r(
      reference text, name text, brand text, gamme text, product_kind text, purchase_price_ht numeric,
      selling_price_ht_defaut numeric, default_tva_rate numeric, unit text, category text, specs jsonb,
      image_url text, image_source_url text, model_key text);

  IF EXISTS (SELECT 1 FROM t_imp WHERE reference IS NULL OR reference = '' OR name IS NULL OR name = '' OR purchase_price_ht IS NULL) THEN
    RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) - count(DISTINCT reference) FROM t_imp) > 0 THEN
    RAISE EXCEPTION 'reference_en_double' USING ERRCODE = '22023';
  END IF;

  -- Articles présents dans le relevé : prix d'achat, specs (fusion niveau 1 + canonical), photo si absente, clé modèle.
  -- JAMAIS name, category, product_kind, brand, gamme (humains) ; selling_price_ht seulement s'il est encore à 0.
  -- Clé modèle : manuelle conservée ; trouvée par l'adaptateur ('cle') prioritaire ; sinon une clé IA est conservée.
  -- is_active : réactivé seulement si la désactivation venait du relevé ; une suppression manuelle est respectée.
  UPDATE majordhome.supplier_products p SET
    purchase_price_ht = t.purchase_price_ht,
    selling_price_ht = CASE WHEN p.selling_price_ht = 0 AND COALESCE(t.selling_price_ht_defaut, 0) > 0
                            THEN t.selling_price_ht_defaut ELSE p.selling_price_ht END,
    default_tva_rate = COALESCE(t.default_tva_rate, p.default_tva_rate),
    unit = COALESCE(t.unit, p.unit),
    image_url = COALESCE(p.image_url, t.image_url),
    image_source_url = CASE WHEN p.image_url IS NULL THEN COALESCE(t.image_source_url, p.image_source_url) ELSE p.image_source_url END,
    model_key = CASE WHEN p.model_key_source = 'manuel' THEN p.model_key
                     WHEN t.model_key IS NOT NULL THEN t.model_key
                     WHEN p.model_key_source = 'ia' THEN p.model_key
                     ELSE NULL END,
    model_key_source = CASE WHEN p.model_key_source = 'manuel' THEN 'manuel'
                            WHEN t.model_key IS NOT NULL THEN 'cle'
                            WHEN p.model_key_source = 'ia' THEN 'ia'
                            ELSE NULL END,
    specs = (COALESCE(p.specs, '{}'::jsonb) || t.specs
             || jsonb_build_object('canonical', COALESCE(p.specs -> 'canonical', '{}'::jsonb) || COALESCE(t.specs -> 'canonical', '{}'::jsonb))
            ) - 'desactive_par_releve',
    is_active = CASE WHEN p.is_active THEN true
                     WHEN (p.specs ->> 'desactive_par_releve')::boolean IS TRUE THEN true
                     ELSE false END,
    updated_at = now()
  FROM t_imp t
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference;
  GET DIAGNOSTICS v_upd = ROW_COUNT;

  SELECT count(*) INTO v_ign FROM majordhome.supplier_products p JOIN t_imp t ON t.reference = p.reference
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND NOT p.is_active;

  INSERT INTO majordhome.supplier_products
    (supplier_id, org_id, reference, name, category, gamme, brand, purchase_price_ht, selling_price_ht,
     default_tva_rate, unit, specs, product_kind, is_active, image_url, image_source_url, model_key, model_key_source)
  SELECT p_supplier_id, p_org_id, t.reference, t.name, t.category, t.gamme, t.brand, t.purchase_price_ht,
         COALESCE(t.selling_price_ht_defaut, 0), COALESCE(t.default_tva_rate, 20), COALESCE(t.unit, 'pièce'),
         t.specs, COALESCE(t.product_kind, 'main'), true, t.image_url, t.image_source_url, t.model_key,
         CASE WHEN t.model_key IS NOT NULL THEN 'cle' ELSE NULL END
  FROM t_imp t
  WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p
                    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- Absent du relevé = plus au tarif : désactivé (marqué comme tel), jamais supprimé — sauf si l'appelant le débraye
  -- (p_meta.desactiver_absents = false : relevé de FACTURES, un article non racheté ce mois-ci reste au catalogue).
  IF v_desactiver THEN
    UPDATE majordhome.supplier_products p
    SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_releve": true}'::jsonb, updated_at = now()
    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active
      AND NOT EXISTS (SELECT 1 FROM t_imp t WHERE t.reference = p.reference);
    GET DIAGNOSTICS v_des = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_total FROM majordhome.supplier_products p
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active;

  v_res := jsonb_build_object('ok', true, 'at', now(), 'version', p_source_version,
                              'inseres', v_ins, 'mis_a_jour', v_upd - v_ign, 'desactives', v_des,
                              'ignores_inactifs', v_ign, 'total', v_total,
                              'categories_vues', COALESCE(p_meta -> 'categories_vues', '[]'::jsonb),
                              'desactiver_absents', v_desactiver);
  UPDATE majordhome.suppliers SET catalog_sync_at = now(), catalog_sync_result = v_res, catalog_sync_error = NULL, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) TO service_role;
COMMENT ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) IS
  'Écrivain unique du catalogue fournisseur depuis un relevé (service_role). name / selling_price_ht / category / product_kind / brand / gamme à l''INSERT seulement ; photo si absente ; clé modèle : manuelle > adaptateur > IA ; specs.categorie_releve = catégorie calculée par l''adaptateur ; absents désactivés (marqués) sauf p_meta.desactiver_absents=false (relevé de factures) ; suppression manuelle respectée.';

-- ---------------------------------------------------------------------------------------------------------------
-- I-4 : apply_mapping v2 — une correction manuelle (catégorie courante ≠ catégorie du dernier relevé) est respectée
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supplier_catalog_apply_mapping(p_supplier_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_org uuid;
  v_role text;
  v_mapping jsonb;
  v_reclasses int := 0;
  v_exclus int := 0;
  v_reactives int := 0;
  v_manuels int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT org_id, category_mapping INTO v_org, v_mapping FROM majordhome.suppliers WHERE id = p_supplier_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'supplier_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE user_id = auth.uid() AND org_id = v_org;
  IF (v_role = 'org_admin') IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;

  -- Cible d'un article = la plus prioritaire (exclure > batterie > borne_recharge > photovoltaique) parmi les
  -- SURCHARGES qui couvrent l'une de ses catégories du site ((sans categorie) si aucune). Article non couvert : inchangé.
  -- manuel = la catégorie courante diffère de celle posée par le dernier relevé (correction faite dans le drawer).
  IF to_regclass('pg_temp.t_cibles') IS NOT NULL THEN DROP TABLE pg_temp.t_cibles; END IF;
  CREATE TEMP TABLE t_cibles ON COMMIT DROP AS
    SELECT p.id,
           (SELECT c FROM unnest(ARRAY['exclure', 'batterie', 'borne_recharge', 'photovoltaique']) AS c
             WHERE c IN (SELECT v_mapping ->> k FROM (
                           SELECT CASE WHEN jsonb_array_length(COALESCE(p.specs -> 'canonical' -> 'categories_site', '[]'::jsonb)) = 0
                                       THEN ARRAY['(sans categorie)']
                                       ELSE ARRAY(SELECT jsonb_array_elements_text(p.specs -> 'canonical' -> 'categories_site')) END AS cles
                         ) x, unnest(x.cles) AS k)
             ORDER BY array_position(ARRAY['exclure', 'batterie', 'borne_recharge', 'photovoltaique'], c) LIMIT 1) AS cible,
           (p.specs ? 'categorie_releve' AND p.category IS DISTINCT FROM p.specs ->> 'categorie_releve') AS manuel
    FROM majordhome.supplier_products p
    WHERE p.supplier_id = p_supplier_id AND p.org_id = v_org AND p.specs ? 'source_version';

  UPDATE majordhome.supplier_products p
  SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_mapping": true}'::jsonb, updated_at = now()
  FROM t_cibles t WHERE t.id = p.id AND t.cible = 'exclure' AND p.is_active;
  GET DIAGNOSTICS v_exclus = ROW_COUNT;

  UPDATE majordhome.supplier_products p
  SET is_active = true, specs = p.specs - 'desactive_par_mapping', updated_at = now()
  FROM t_cibles t WHERE t.id = p.id AND t.cible IS DISTINCT FROM 'exclure' AND NOT p.is_active
    AND (p.specs ->> 'desactive_par_mapping')::boolean IS TRUE;
  GET DIAGNOSTICS v_reactives = ROW_COUNT;

  SELECT count(*) INTO v_manuels FROM majordhome.supplier_products p JOIN t_cibles t ON t.id = p.id
  WHERE t.cible IS NOT NULL AND t.cible <> 'exclure' AND p.category IS DISTINCT FROM t.cible AND t.manuel;

  UPDATE majordhome.supplier_products p
  SET category = t.cible, specs = COALESCE(p.specs, '{}'::jsonb) || jsonb_build_object('categorie_releve', t.cible), updated_at = now()
  FROM t_cibles t WHERE t.id = p.id AND t.cible IS NOT NULL AND t.cible <> 'exclure' AND p.category IS DISTINCT FROM t.cible AND NOT t.manuel;
  GET DIAGNOSTICS v_reclasses = ROW_COUNT;

  RETURN jsonb_build_object('reclasses', v_reclasses, 'exclus', v_exclus, 'reactives', v_reactives, 'ignores_manuels', v_manuels);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.supplier_catalog_apply_mapping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_apply_mapping(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.supplier_catalog_apply_mapping(uuid) IS
  'Reclasse les articles relevés d''un fournisseur selon suppliers.category_mapping (org_admin). Une catégorie corrigée à la main (≠ specs.categorie_releve) est respectée (ignores_manuels).';

-- ---------------------------------------------------------------------------------------------------------------
-- M-1 : anon ne lit pas la table des rapprochements
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON majordhome.catalog_matches FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------------------------------------------
-- I-5 : une paire candidate par deux motifs ne produit qu'une ligne
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_matches_propose(p_org_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_confirmes int := 0;
  v_proposes int := 0;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'org_required' USING ERRCODE = '22023'; END IF;

  IF to_regclass('pg_temp.t_paires') IS NOT NULL THEN DROP TABLE pg_temp.t_paires; END IF;
  CREATE TEMP TABLE t_paires ON COMMIT DROP AS
    WITH actifs AS (
      SELECT id, supplier_id, lower(brand) AS marque, model_key, nullif(code_ean, '') AS ean, product_kind, purchase_price_ht
      FROM majordhome.supplier_products WHERE org_id = p_org_id AND is_active
    ),
    par_cle AS (
      SELECT least(x.id, y.id) AS a, greatest(x.id, y.id) AS b, 'cle'::text AS source,
             'marque + modèle ' || x.model_key AS motif, x.marque, x.model_key AS cle,
             x.product_kind = y.product_kind AS meme_nature,
             greatest(x.purchase_price_ht, y.purchase_price_ht) <= 2 * least(x.purchase_price_ht, y.purchase_price_ht) AS meme_ordre_de_prix
      FROM actifs x JOIN actifs y ON y.supplier_id <> x.supplier_id AND y.marque = x.marque AND y.model_key = x.model_key
      WHERE x.model_key IS NOT NULL AND x.marque IS NOT NULL AND x.id < y.id
    ),
    par_ean AS (
      SELECT least(x.id, y.id) AS a, greatest(x.id, y.id) AS b, 'cle'::text AS source,
             'code EAN ' || x.ean AS motif, NULL::text AS marque, 'ean:' || x.ean AS cle,
             true AS meme_nature, true AS meme_ordre_de_prix
      FROM actifs x JOIN actifs y ON y.supplier_id <> x.supplier_id AND y.ean = x.ean
      WHERE x.ean IS NOT NULL AND x.id < y.id
    ),
    toutes AS (SELECT * FROM par_cle UNION SELECT * FROM par_ean),
    evaluees AS (
      SELECT t.a, t.b, t.source, t.motif,
             -- franche = un seul candidat de chaque côté pour cette clé, même nature (un accessoire qui cite le modèle
             -- de son onduleur n'est pas l'onduleur) et prix d'achat du même ordre (rapport ≤ 2)
             (SELECT count(*) FROM toutes u WHERE u.cle = t.cle AND (u.a = t.a OR u.b = t.a)) = 1
             AND (SELECT count(*) FROM toutes u WHERE u.cle = t.cle AND (u.a = t.b OR u.b = t.b)) = 1
             AND t.meme_nature AND t.meme_ordre_de_prix AS franche
      FROM toutes t
    )
    -- une même paire trouvée par deux motifs (clé ET EAN) : une seule ligne, le motif franc d'abord
    SELECT DISTINCT ON (e.a, e.b) e.a, e.b, e.source, e.motif, e.franche
    FROM evaluees e
    ORDER BY e.a, e.b, e.franche DESC, e.motif;

  INSERT INTO majordhome.catalog_matches (org_id, product_a_id, product_b_id, source, statut, motif, confirmed_at)
  SELECT p_org_id, t.a, t.b, t.source, CASE WHEN t.franche THEN 'confirme' ELSE 'propose' END, t.motif,
         CASE WHEN t.franche THEN now() ELSE NULL END
  FROM t_paires t
  WHERE NOT EXISTS (SELECT 1 FROM majordhome.catalog_matches m WHERE m.product_a_id = t.a AND m.product_b_id = t.b)
  ON CONFLICT (product_a_id, product_b_id) DO NOTHING;
  GET DIAGNOSTICS v_proposes = ROW_COUNT;
  SELECT count(*) INTO v_confirmes FROM majordhome.catalog_matches m JOIN t_paires t ON t.a = m.product_a_id AND t.b = m.product_b_id
  WHERE m.statut = 'confirme' AND m.confirmed_by IS NULL AND m.created_at >= now() - interval '1 second';
  RETURN jsonb_build_object('confirmes', v_confirmes, 'proposes', v_proposes - v_confirmes, 'nouvelles', v_proposes);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_matches_propose(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_matches_propose(uuid) TO service_role;
