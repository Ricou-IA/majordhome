-- 20261026_1_catalog_items.sql
-- Articles Majord'home et matrice fournisseurs — tranche A, partie 1
-- (spec docs/superpowers/specs/2026-10-24-articles-majordhome-matrice-fournisseurs-design.md).
--   1. majordhome.catalog_items : l'article de l'org, base du devis (champs humains + specs harmonisées + prix de
--      vente). Lecture : tout membre ; écriture des champs humains : org_admin seul (vue miroir updatable) ;
--      liens : RPC seulement.
--   2. La matrice : supplier_products.catalog_item_id (+ link_source, linked_at). quote_lines.catalog_item_id.
--      supplier_products.purchase_price_at = date du prix d'achat, posée UNIQUEMENT par l'upsert (relevé) ou
--      par l'import d'achats (date de la facture) — updated_at ne sert plus jamais de date de prix.
--   3. Vues : majordhome_catalog_items (miroir), majordhome_catalog_items_list (lecture : offres_actives…),
--      majordhome_catalog_item_offers (article × ligne fournisseur) ; colonnes en FIN sur les vues produits / devis.
--   4. catalog_items_ensure(p_org_id) — service_role : pour chaque ligne active sans article, rattachement franc
--      (même marque + modèle ou même EAN, un seul candidat, même nature, prix du même ordre) sinon création.
--   5. supplier_catalog_upsert v6 (corps de 20261025_5 + purchase_price_at + ensure en fin) ;
--      supplier_catalog_apply_mapping v3 (l'article à une seule ligne suit la ligne reclassée).
--   6. Backfill : purchase_price_at, articles pour toutes les orgs, quote_lines.catalog_item_id.
-- Répétée sur scripts/migration-rehearsal/ (assert-catalog-items.sql).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  name text NOT NULL,
  brand text,
  model_key text,
  code_ean text,
  category text,
  gamme text,
  product_kind text NOT NULL DEFAULT 'main',
  unit text NOT NULL DEFAULT 'pièce',
  default_tva_rate numeric NOT NULL DEFAULT 20,
  selling_price_ht numeric NOT NULL DEFAULT 0,
  description text,
  image_url text,
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  source_product_id uuid REFERENCES majordhome.supplier_products(id) ON DELETE SET NULL,
  origin text NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto', 'manuel')),
  merged_into uuid REFERENCES majordhome.catalog_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE majordhome.catalog_items IS 'Article Majord''home de l''org : base du devis, rattaché à N lignes fournisseur (supplier_products.catalog_item_id). Champs humains édités ici, jamais sur la ligne fournisseur.';
CREATE INDEX IF NOT EXISTS catalog_items_org_key_idx ON majordhome.catalog_items (org_id, lower(brand), model_key) WHERE model_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_items_org_ean_idx ON majordhome.catalog_items (org_id, code_ean) WHERE code_ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_items_org_active_idx ON majordhome.catalog_items (org_id, is_active);

ALTER TABLE majordhome.catalog_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_items_select ON majordhome.catalog_items;
CREATE POLICY catalog_items_select ON majordhome.catalog_items FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
DROP POLICY IF EXISTS catalog_items_update_admin ON majordhome.catalog_items;
CREATE POLICY catalog_items_update_admin ON majordhome.catalog_items FOR UPDATE
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
-- Pas de policy INSERT / DELETE : création et fusion passent par les RPC SECURITY DEFINER.
REVOKE ALL ON majordhome.catalog_items FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON majordhome.catalog_items TO authenticated;
GRANT SELECT ON majordhome.catalog_items TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. La matrice et la date du prix
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.supplier_products
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES majordhome.catalog_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS catalog_item_link_source text,
  ADD COLUMN IF NOT EXISTS catalog_item_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchase_price_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_catalog_item_link_source_check') THEN
    ALTER TABLE majordhome.supplier_products
      ADD CONSTRAINT supplier_products_catalog_item_link_source_check
      CHECK (catalog_item_link_source IS NULL OR catalog_item_link_source IN ('auto', 'cle', 'ean', 'ia', 'manuel'));
  END IF;
END $$;
COMMENT ON COLUMN majordhome.supplier_products.catalog_item_id IS 'Article Majord''home auquel cette ligne fournisseur est rattachée (matrice org × fournisseur). Écrit par RPC seulement.';
COMMENT ON COLUMN majordhome.supplier_products.purchase_price_at IS 'Date du prix d''achat : relevé (upsert) ou facture (import d''achats). Jamais updated_at.';
CREATE INDEX IF NOT EXISTS supplier_products_catalog_item_idx ON majordhome.supplier_products (catalog_item_id) WHERE catalog_item_id IS NOT NULL;

ALTER TABLE majordhome.quote_lines
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES majordhome.catalog_items(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Vues (colonnes en fin ; security_invoker)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_supplier_products WITH (security_invoker = true) AS
  SELECT p.id, p.supplier_id, p.org_id, p.reference, p.name, p.description, p.category, p.purchase_price_ht, p.selling_price_ht,
         p.default_tva_rate, p.unit, p.pennylane_product_id, p.is_active, p.created_at, p.updated_at, p.code_famille, p.gamme,
         p.code_ean, p.tarif_public, p.taux_remise, p.diametre, p.ledger_account_pl_id, p.ledger_account_pl_number, p.fuel_type,
         p.brand, p.variant_of, p.variant_label, p.image_url, p.image_source_url, p.specs, p.client_visible, p.product_kind,
         p.compatible_with_ids, s.name AS supplier_name, p.model_key, p.model_key_source,
         p.purchase_price_at, p.catalog_item_link_source, p.catalog_item_id
  FROM majordhome.supplier_products p
  LEFT JOIN majordhome.suppliers s ON s.id = p.supplier_id;

CREATE OR REPLACE VIEW public.majordhome_supplier_products_write WITH (security_invoker = true) AS
  SELECT id, supplier_id, org_id, reference, name, description, category, purchase_price_ht, selling_price_ht, default_tva_rate,
         unit, pennylane_product_id, is_active, created_at, updated_at, code_famille, gamme, code_ean, tarif_public, taux_remise,
         diametre, ledger_account_pl_id, ledger_account_pl_number, fuel_type, brand, variant_of, variant_label, image_url,
         image_source_url, specs, client_visible, product_kind, compatible_with_ids, model_key, model_key_source,
         purchase_price_at, catalog_item_id
  FROM majordhome.supplier_products;

CREATE OR REPLACE VIEW public.majordhome_quote_lines WITH (security_invoker = true) AS
  SELECT ql.id, ql.quote_id, ql.sort_order, ql.line_type, ql.supplier_product_id, ql.supplier_id, ql.designation, ql.description,
         ql.reference, ql.quantity, ql.unit, ql.purchase_price_ht, ql.unit_price_ht, ql.tva_rate, ql.total_ht, ql.total_tva,
         ql.total_ttc, ql.created_at, s.name AS supplier_name, ql.catalog_item_id
  FROM majordhome.quote_lines ql
  LEFT JOIN majordhome.suppliers s ON s.id = ql.supplier_id;

CREATE OR REPLACE VIEW public.majordhome_quote_lines_write WITH (security_invoker = true) AS
  SELECT id, quote_id, sort_order, line_type, supplier_product_id, supplier_id, designation, description, reference, quantity,
         unit, purchase_price_ht, unit_price_ht, tva_rate, total_ht, total_tva, total_ttc, created_at, catalog_item_id
  FROM majordhome.quote_lines;

CREATE OR REPLACE VIEW public.majordhome_catalog_items WITH (security_invoker = true) AS
  SELECT id, org_id, name, brand, model_key, code_ean, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht,
         description, image_url, specs, is_active, source_product_id, origin, merged_into, created_at, updated_at
  FROM majordhome.catalog_items;
GRANT SELECT, UPDATE ON public.majordhome_catalog_items TO authenticated;
GRANT SELECT ON public.majordhome_catalog_items TO service_role;
REVOKE ALL ON public.majordhome_catalog_items FROM anon;

-- Lecture : l'article avec ses offres comptées (une ligne fournisseur active chez un fournisseur actif = une offre).
CREATE OR REPLACE VIEW public.majordhome_catalog_items_list WITH (security_invoker = true) AS
  SELECT i.id, i.org_id, i.name, i.brand, i.model_key, i.code_ean, i.category, i.gamme, i.product_kind, i.unit, i.default_tva_rate,
         i.selling_price_ht, i.description, i.image_url, i.specs, i.is_active, i.source_product_id, i.origin, i.merged_into,
         i.created_at, i.updated_at,
         COALESCE(o.offres_actives, 0)::int AS offres_actives,
         COALESCE(o.offres_total, 0)::int AS offres_total,
         o.meilleur_prix_achat,
         COALESCE(o.fournisseurs, ARRAY[]::text[]) AS fournisseurs,
         o.prix_le_plus_recent
  FROM majordhome.catalog_items i
  LEFT JOIN (
    SELECT p.catalog_item_id,
           count(*) FILTER (WHERE p.is_active AND s.is_active) AS offres_actives,
           count(*) AS offres_total,
           min(p.purchase_price_ht) FILTER (WHERE p.is_active AND s.is_active AND p.purchase_price_ht > 0) AS meilleur_prix_achat,
           array_agg(DISTINCT s.name) FILTER (WHERE p.is_active AND s.is_active) AS fournisseurs,
           max(p.purchase_price_at) FILTER (WHERE p.is_active AND s.is_active) AS prix_le_plus_recent
    FROM majordhome.supplier_products p
    JOIN majordhome.suppliers s ON s.id = p.supplier_id
    WHERE p.catalog_item_id IS NOT NULL
    GROUP BY p.catalog_item_id
  ) o ON o.catalog_item_id = i.id;
GRANT SELECT ON public.majordhome_catalog_items_list TO authenticated, service_role;
REVOKE ALL ON public.majordhome_catalog_items_list FROM anon;

-- Lecture : une ligne par (article, ligne fournisseur) — la forme consommée par la règle « chez qui on achète ».
CREATE OR REPLACE VIEW public.majordhome_catalog_item_offers WITH (security_invoker = true) AS
  SELECT p.catalog_item_id AS item_id, p.id AS product_id, p.org_id, p.supplier_id, s.name AS supplier_name,
         s.auto_sync AS supplier_auto_sync, p.reference, p.name, p.purchase_price_ht, p.purchase_price_at, p.selling_price_ht,
         CASE WHEN jsonb_typeof(p.specs -> 'canonical' -> 'stock_releve' -> 'qty') = 'number'
              THEN round((p.specs -> 'canonical' -> 'stock_releve' ->> 'qty')::numeric)::int END AS stock_qty,
         CASE WHEN jsonb_typeof(p.specs -> 'canonical' -> 'stock_releve' -> 'en_stock') = 'boolean'
              THEN (p.specs -> 'canonical' -> 'stock_releve' ->> 'en_stock')::boolean END AS en_stock,
         (p.is_active AND s.is_active) AS is_active,
         p.catalog_item_link_source AS link_source,
         p.image_url
  FROM majordhome.supplier_products p
  JOIN majordhome.suppliers s ON s.id = p.supplier_id
  WHERE p.catalog_item_id IS NOT NULL;
GRANT SELECT ON public.majordhome_catalog_item_offers TO authenticated, service_role;
REVOKE ALL ON public.majordhome_catalog_item_offers FROM anon;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Création automatique des articles (service_role)
-- ---------------------------------------------------------------------------------------------------------------
-- p_limit : nombre maximal de lignes traitées par appel (NULL = toutes) — permet un backfill par lots depuis un client
-- HTTP ; l'appel est idempotent, on le répète jusqu'à {crees: 0, rattaches: 0}.
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

  FOR r IN SELECT p.* FROM majordhome.supplier_products p
           WHERE p.org_id = p_org_id AND p.is_active AND p.catalog_item_id IS NULL
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
    IF v_item IS NULL AND ((r.model_key IS NOT NULL AND r.brand IS NOT NULL) OR nullif(r.code_ean, '') IS NOT NULL) THEN
      SELECT count(*), (array_agg(c.id))[1], bool_or(c.par_ean) INTO v_n, v_item, v_ean FROM (
        SELECT i.id, (nullif(r.code_ean, '') IS NOT NULL AND i.code_ean = r.code_ean) AS par_ean
        FROM majordhome.catalog_items i
        JOIN LATERAL (SELECT min(q.purchase_price_ht) AS prix FROM majordhome.supplier_products q
                      WHERE q.catalog_item_id = i.id AND q.is_active AND q.purchase_price_ht > 0) m ON true
        WHERE i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL
          AND i.product_kind = COALESCE(r.product_kind, 'main')
          AND ((r.model_key IS NOT NULL AND r.brand IS NOT NULL AND lower(i.brand) = lower(r.brand) AND i.model_key = r.model_key)
               OR (nullif(r.code_ean, '') IS NOT NULL AND i.code_ean = r.code_ean))
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
        (p_org_id, r.name, r.brand, r.model_key, nullif(r.code_ean, ''), r.category, r.gamme, COALESCE(r.product_kind, 'main'),
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
REVOKE EXECUTE ON FUNCTION public.catalog_items_ensure(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_items_ensure(uuid, int) TO service_role;
COMMENT ON FUNCTION public.catalog_items_ensure(uuid, int) IS 'Pose un article Majord''home sur chaque ligne fournisseur active qui n''en a pas : rattachement franc (marque + modèle ou EAN, un seul candidat, même nature, prix du même ordre) sinon création. service_role ; appelée en fin de supplier_catalog_upsert.';

-- ---------------------------------------------------------------------------------------------------------------
-- 5a. supplier_catalog_upsert v6 : purchase_price_at + articles en fin de relevé
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
  v_art jsonb;
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
           COALESCE(r.specs, '{}'::jsonb)
             || CASE WHEN r.category IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('categorie_releve', r.category) END AS specs,
           r.image_url, r.image_source_url, r.model_key,
           -- date du prix : fournie par l'appelant (import d'achats : date de la facture), sinon le relevé = maintenant
           COALESCE(r.purchase_price_at, now()) AS purchase_price_at,
           -- prix public et taux de remise = faits fournisseur (« Prix de base » Soditelem), rafraîchis à chaque relevé
           r.tarif_public, r.taux_remise
    FROM jsonb_to_recordset(p_rows) AS r(
      reference text, name text, brand text, gamme text, product_kind text, purchase_price_ht numeric,
      selling_price_ht_defaut numeric, default_tva_rate numeric, unit text, category text, specs jsonb,
      image_url text, image_source_url text, model_key text, purchase_price_at timestamptz,
      tarif_public numeric, taux_remise numeric);

  IF EXISTS (SELECT 1 FROM t_imp WHERE reference IS NULL OR reference = '' OR name IS NULL OR name = '' OR purchase_price_ht IS NULL) THEN
    RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) - count(DISTINCT reference) FROM t_imp) > 0 THEN
    RAISE EXCEPTION 'reference_en_double' USING ERRCODE = '22023';
  END IF;

  UPDATE majordhome.supplier_products p SET
    purchase_price_ht = t.purchase_price_ht,
    purchase_price_at = t.purchase_price_at,
    tarif_public = COALESCE(t.tarif_public, p.tarif_public),
    taux_remise = COALESCE(t.taux_remise, p.taux_remise),
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
    (supplier_id, org_id, reference, name, category, gamme, brand, purchase_price_ht, purchase_price_at, selling_price_ht,
     default_tva_rate, unit, specs, product_kind, is_active, image_url, image_source_url, model_key, model_key_source,
     tarif_public, taux_remise)
  SELECT p_supplier_id, p_org_id, t.reference, t.name, t.category, t.gamme, t.brand, t.purchase_price_ht, t.purchase_price_at,
         COALESCE(t.selling_price_ht_defaut, 0), COALESCE(t.default_tva_rate, 20), COALESCE(t.unit, 'pièce'),
         t.specs, COALESCE(t.product_kind, 'main'), true, t.image_url, t.image_source_url, t.model_key,
         CASE WHEN t.model_key IS NOT NULL THEN 'cle' ELSE NULL END,
         t.tarif_public, COALESCE(t.taux_remise, 0)
  FROM t_imp t
  WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p
                    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  IF v_desactiver THEN
    UPDATE majordhome.supplier_products p
    SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_releve": true}'::jsonb, updated_at = now()
    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active
      AND NOT EXISTS (SELECT 1 FROM t_imp t WHERE t.reference = p.reference);
    GET DIAGNOSTICS v_des = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_total FROM majordhome.supplier_products p
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active;

  -- Articles Majord'home : chaque ligne active sans article en reçoit un (rattachement franc ou création).
  v_art := public.catalog_items_ensure(p_org_id);

  v_res := jsonb_build_object('ok', true, 'at', now(), 'version', p_source_version,
                              'inseres', v_ins, 'mis_a_jour', v_upd - v_ign, 'desactives', v_des,
                              'ignores_inactifs', v_ign, 'total', v_total,
                              'categories_vues', COALESCE(p_meta -> 'categories_vues', '[]'::jsonb),
                              'desactiver_absents', v_desactiver,
                              'articles', v_art);
  UPDATE majordhome.suppliers SET catalog_sync_at = now(), catalog_sync_result = v_res, catalog_sync_error = NULL, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) TO service_role;
COMMENT ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) IS
  'Écrivain unique du catalogue fournisseur depuis un relevé (service_role). name / selling_price_ht / category / product_kind / brand / gamme à l''INSERT seulement ; photo si absente ; clé modèle : manuelle > adaptateur > IA ; purchase_price_at = date fournie sinon maintenant ; tarif_public / taux_remise rafraîchis ; specs.categorie_releve ; absents désactivés sauf p_meta.desactiver_absents=false ; suppression manuelle respectée ; articles Majord''home posés en fin (catalog_items_ensure).';

-- ---------------------------------------------------------------------------------------------------------------
-- 5b. supplier_catalog_apply_mapping v3 : l'article à une seule ligne suit la ligne reclassée
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
  v_articles int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT org_id, category_mapping INTO v_org, v_mapping FROM majordhome.suppliers WHERE id = p_supplier_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'supplier_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE user_id = auth.uid() AND org_id = v_org;
  IF (v_role = 'org_admin') IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;

  IF to_regclass('pg_temp.t_cibles') IS NOT NULL THEN DROP TABLE pg_temp.t_cibles; END IF;
  CREATE TEMP TABLE t_cibles ON COMMIT DROP AS
    SELECT p.id, p.category AS ancienne, p.catalog_item_id,
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

  -- L'article suit sa ligne quand il n'en a qu'une et que sa catégorie n'avait pas été corrigée à la main (= ancienne).
  UPDATE majordhome.catalog_items i
  SET category = t.cible, updated_at = now()
  FROM t_cibles t
  WHERE i.id = t.catalog_item_id AND t.cible IS NOT NULL AND t.cible <> 'exclure' AND NOT t.manuel
    AND t.ancienne IS DISTINCT FROM t.cible AND i.category IS NOT DISTINCT FROM t.ancienne
    AND (SELECT count(*) FROM majordhome.supplier_products q WHERE q.catalog_item_id = i.id) = 1;
  GET DIAGNOSTICS v_articles = ROW_COUNT;

  RETURN jsonb_build_object('reclasses', v_reclasses, 'exclus', v_exclus, 'reactives', v_reactives,
                            'ignores_manuels', v_manuels, 'articles_reclasses', v_articles);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.supplier_catalog_apply_mapping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_apply_mapping(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Backfill
-- ---------------------------------------------------------------------------------------------------------------
-- date du prix : relevé (stock_releve.at), facture (prix_du), sinon la dernière modification
UPDATE majordhome.supplier_products
SET purchase_price_at = COALESCE(
      NULLIF(specs -> 'canonical' -> 'stock_releve' ->> 'at', '')::timestamptz,
      NULLIF(specs -> 'canonical' ->> 'prix_du', '')::date::timestamptz,
      updated_at)
WHERE purchase_price_at IS NULL;

-- un article pour chaque ligne active, dans chaque org qui a un catalogue fournisseur
DO $$
DECLARE v_org uuid; v_res jsonb;
BEGIN
  FOR v_org IN SELECT DISTINCT org_id FROM majordhome.supplier_products WHERE org_id IS NOT NULL LOOP
    v_res := public.catalog_items_ensure(v_org);
    RAISE NOTICE 'catalog_items_ensure(%) : %', v_org, v_res;
  END LOOP;
END $$;

-- les lignes de devis existantes citent l'article de leur ligne fournisseur
UPDATE majordhome.quote_lines ql
SET catalog_item_id = p.catalog_item_id
FROM majordhome.supplier_products p
WHERE p.id = ql.supplier_product_id AND ql.catalog_item_id IS NULL AND p.catalog_item_id IS NOT NULL;
