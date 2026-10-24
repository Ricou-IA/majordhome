-- 20261025_3_catalog_matches.sql
-- Articles communs entre fournisseurs (spec 2026-10-24-catalogue-photovoltaique-connexion-generique § 7) :
--   majordhome.catalog_matches : une paire ordonnée de produits (fournisseurs différents, même org), source
--   cle | ia | manuel, statut propose | confirme | refuse. Lecture par tout membre de l'org (vue
--   majordhome_catalog_matches, avec les deux produits et l'écart de prix d'achat) ; écriture par RPC seulement.
--   catalog_matches_propose(p_org_id) — service_role (après un relevé ou une normalisation) : paires de même
--     marque (insensible à la casse) et même model_key, ou même code_ean ; CONFIRMÉE d'office quand un seul
--     candidat de chaque côté, PROPOSÉE sinon ; une paire déjà confirmée ou refusée n'est jamais touchée.
--   catalog_match_set_status(p_match_ids, p_statut) — org_admin : confirme | refuse en lot.
--   catalog_match_create(p_product_a, p_product_b) — org_admin : rapprochement manuel, confirmé.

CREATE TABLE IF NOT EXISTS majordhome.catalog_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  product_a_id uuid NOT NULL REFERENCES majordhome.supplier_products(id) ON DELETE CASCADE,
  product_b_id uuid NOT NULL REFERENCES majordhome.supplier_products(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('cle', 'ia', 'manuel')),
  statut text NOT NULL CHECK (statut IN ('propose', 'confirme', 'refuse')),
  motif text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_matches_ordre CHECK (product_a_id < product_b_id),
  CONSTRAINT catalog_matches_paire_uniq UNIQUE (product_a_id, product_b_id)
);
CREATE INDEX IF NOT EXISTS catalog_matches_org_statut_idx ON majordhome.catalog_matches (org_id, statut);
CREATE INDEX IF NOT EXISTS catalog_matches_b_idx ON majordhome.catalog_matches (product_b_id);

ALTER TABLE majordhome.catalog_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_matches_select ON majordhome.catalog_matches;
CREATE POLICY catalog_matches_select ON majordhome.catalog_matches FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
-- Aucune policy d'écriture : INSERT / UPDATE / DELETE passent par les RPC SECURITY DEFINER ci-dessous.
REVOKE INSERT, UPDATE, DELETE ON majordhome.catalog_matches FROM anon, authenticated;
GRANT SELECT ON majordhome.catalog_matches TO service_role;

CREATE OR REPLACE VIEW public.majordhome_catalog_matches WITH (security_invoker = true) AS
  SELECT m.id, m.org_id, m.source, m.statut, m.motif, m.confirmed_by, m.confirmed_at, m.created_at, m.updated_at,
         m.product_a_id, a.name AS product_a_name, a.reference AS product_a_reference, a.brand AS product_a_brand,
         a.purchase_price_ht AS product_a_purchase, a.supplier_id AS supplier_a_id, sa.name AS supplier_a_name,
         m.product_b_id, b.name AS product_b_name, b.reference AS product_b_reference, b.brand AS product_b_brand,
         b.purchase_price_ht AS product_b_purchase, b.supplier_id AS supplier_b_id, sb.name AS supplier_b_name,
         COALESCE(a.model_key, b.model_key) AS model_key,
         CASE WHEN a.purchase_price_ht > 0 THEN round((b.purchase_price_ht - a.purchase_price_ht) / a.purchase_price_ht * 100, 1) ELSE NULL END AS ecart_pct
  FROM majordhome.catalog_matches m
  JOIN majordhome.supplier_products a ON a.id = m.product_a_id
  JOIN majordhome.supplier_products b ON b.id = m.product_b_id
  LEFT JOIN majordhome.suppliers sa ON sa.id = a.supplier_id
  LEFT JOIN majordhome.suppliers sb ON sb.id = b.supplier_id;
GRANT SELECT ON public.majordhome_catalog_matches TO authenticated, service_role;
REVOKE ALL ON public.majordhome_catalog_matches FROM anon;

-- ---------------------------------------------------------------------------------------------------------------
-- Proposition automatique (service_role)
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
    toutes AS (SELECT * FROM par_cle UNION SELECT * FROM par_ean)
    SELECT t.a, t.b, t.source, t.motif,
           -- franche = un seul candidat de chaque côté pour cette clé, même nature (un accessoire qui cite le modèle
           -- de son onduleur n'est pas l'onduleur) et prix d'achat du même ordre (rapport ≤ 2)
           (SELECT count(*) FROM toutes u WHERE u.cle = t.cle AND (u.a = t.a OR u.b = t.a)) = 1
           AND (SELECT count(*) FROM toutes u WHERE u.cle = t.cle AND (u.a = t.b OR u.b = t.b)) = 1
           AND t.meme_nature AND t.meme_ordre_de_prix AS franche
    FROM toutes t;

  INSERT INTO majordhome.catalog_matches (org_id, product_a_id, product_b_id, source, statut, motif, confirmed_at)
  SELECT p_org_id, t.a, t.b, t.source, CASE WHEN t.franche THEN 'confirme' ELSE 'propose' END, t.motif,
         CASE WHEN t.franche THEN now() ELSE NULL END
  FROM t_paires t
  WHERE NOT EXISTS (SELECT 1 FROM majordhome.catalog_matches m WHERE m.product_a_id = t.a AND m.product_b_id = t.b);
  GET DIAGNOSTICS v_proposes = ROW_COUNT;
  SELECT count(*) INTO v_confirmes FROM majordhome.catalog_matches m JOIN t_paires t ON t.a = m.product_a_id AND t.b = m.product_b_id
  WHERE m.statut = 'confirme' AND m.confirmed_by IS NULL AND m.created_at >= now() - interval '1 second';
  RETURN jsonb_build_object('confirmes', v_confirmes, 'proposes', v_proposes - v_confirmes, 'nouvelles', v_proposes);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_matches_propose(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_matches_propose(uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Décisions (org_admin)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_match_set_status(p_match_ids uuid[], p_statut text) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_n int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_statut IS NULL OR p_statut NOT IN ('confirme', 'refuse') THEN RAISE EXCEPTION 'statut_invalide' USING ERRCODE = '22023'; END IF;
  IF p_match_ids IS NULL OR array_length(p_match_ids, 1) IS NULL THEN RETURN 0; END IF;
  -- Toutes les paires doivent appartenir à une org dont l'appelant est org_admin (garde positive).
  IF EXISTS (
    SELECT 1 FROM majordhome.catalog_matches m WHERE m.id = ANY (p_match_ids)
      AND (SELECT om.role FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.org_id = m.org_id) IS DISTINCT FROM 'org_admin'
  ) THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;
  UPDATE majordhome.catalog_matches SET statut = p_statut, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
  WHERE id = ANY (p_match_ids) AND statut IS DISTINCT FROM p_statut;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_match_set_status(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_match_set_status(uuid[], text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.catalog_match_create(p_product_a uuid, p_product_b uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_a uuid := least(p_product_a, p_product_b);
  v_b uuid := greatest(p_product_a, p_product_b);
  v_org uuid;
  v_role text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF v_a IS NULL OR v_b IS NULL OR v_a = v_b THEN RAISE EXCEPTION 'paire_invalide' USING ERRCODE = '22023'; END IF;
  SELECT a.org_id INTO v_org FROM majordhome.supplier_products a JOIN majordhome.supplier_products b ON b.id = v_b
  WHERE a.id = v_a AND b.org_id = a.org_id AND b.supplier_id <> a.supplier_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'paire_invalide' USING ERRCODE = '22023'; END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE user_id = auth.uid() AND org_id = v_org;
  IF (v_role = 'org_admin') IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;
  INSERT INTO majordhome.catalog_matches (org_id, product_a_id, product_b_id, source, statut, motif, confirmed_by, confirmed_at)
  VALUES (v_org, v_a, v_b, 'manuel', 'confirme', 'rapprochement manuel', auth.uid(), now())
  ON CONFLICT (product_a_id, product_b_id) DO UPDATE
    SET statut = 'confirme', source = 'manuel', confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_match_create(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_match_create(uuid, uuid) TO authenticated, service_role;
