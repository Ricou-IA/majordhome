-- 20261027_1_articles_natures_devis.sql
-- Devis par chapitres (plan docs/superpowers/plans/2026-10-25-devis-chapitres-articles-stock-enrichissement.md,
-- décisions d'Eric du 2026-10-24/25) :
--   1. Natures d'article : main (équipement), accessory (option), consumable, stock (matériel stocké « par type »,
--      plusieurs marques), main_oeuvre (article interne, sans fournisseur). CHECK sur catalog_items.product_kind.
--   2. Un article se crée depuis le devis ou la page Articles : INSERT autorisé à l'org_admin seul (policy + GRANT),
--      par la vue miroir majordhome_catalog_items (insérable).
--   3. quote_lines.brand : la marque choisie dans le devis pour un article de stock (colonne en fin des deux vues).
--   4. Vue des offres : + brand (la marque de chaque ligne fournisseur) en fin.
--   5. Vue liste : + recherche (libellé, marque, gamme, clé modèle, EAN et références des lignes fournisseur, en
--      minuscules sans accents) en fin — la recherche par mots séparés du devis et de la page Articles.
--   6. catalog_item_proposals_decide : une proposition devenue caduque parce que, après une fusion du même lot, ses deux
--      articles partagent désormais un fournisseur est sautée (sinon deux produits distincts d'un même fournisseur
--      — « Symo 10 » et « Symo 10 bis » — finissaient dans un seul article ; vu sur le harnais, ordre dépendant des uuid).
-- Répétée sur scripts/migration-rehearsal/ (assert-articles-natures-devis.sql, assert-catalog-items-harmonisation.sql).

-- 1. Natures
ALTER TABLE majordhome.catalog_items DROP CONSTRAINT IF EXISTS catalog_items_product_kind_check;
ALTER TABLE majordhome.catalog_items ADD CONSTRAINT catalog_items_product_kind_check
  CHECK (product_kind IN ('main', 'accessory', 'consumable', 'stock', 'main_oeuvre'));
COMMENT ON COLUMN majordhome.catalog_items.product_kind IS 'main = équipement, accessory = option, consumable, stock = matériel stocké par type (marque choisie au devis), main_oeuvre = article interne';

-- 2. Création par l'org_admin
DROP POLICY IF EXISTS catalog_items_insert_admin ON majordhome.catalog_items;
CREATE POLICY catalog_items_insert_admin ON majordhome.catalog_items FOR INSERT
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
GRANT INSERT ON majordhome.catalog_items TO authenticated;
GRANT INSERT ON public.majordhome_catalog_items TO authenticated;
REVOKE INSERT ON majordhome.catalog_items FROM anon;
REVOKE INSERT ON public.majordhome_catalog_items FROM anon;

-- 3. Marque choisie dans le devis
ALTER TABLE majordhome.quote_lines ADD COLUMN IF NOT EXISTS brand text;
COMMENT ON COLUMN majordhome.quote_lines.brand IS 'Marque choisie dans le devis pour un article de stock (plusieurs marques en offres)';

CREATE OR REPLACE VIEW public.majordhome_quote_lines WITH (security_invoker = true) AS
  SELECT ql.id, ql.quote_id, ql.sort_order, ql.line_type, ql.supplier_product_id, ql.supplier_id, ql.designation, ql.description,
         ql.reference, ql.quantity, ql.unit, ql.purchase_price_ht, ql.unit_price_ht, ql.tva_rate, ql.total_ht, ql.total_tva,
         ql.total_ttc, ql.created_at, s.name AS supplier_name, ql.catalog_item_id, ql.brand
  FROM majordhome.quote_lines ql
  LEFT JOIN majordhome.suppliers s ON s.id = ql.supplier_id;

CREATE OR REPLACE VIEW public.majordhome_quote_lines_write WITH (security_invoker = true) AS
  SELECT id, quote_id, sort_order, line_type, supplier_product_id, supplier_id, designation, description, reference, quantity,
         unit, purchase_price_ht, unit_price_ht, tva_rate, total_ht, total_tva, total_ttc, created_at, catalog_item_id, brand
  FROM majordhome.quote_lines;

-- 4. Offres : marque de chaque ligne
CREATE OR REPLACE VIEW public.majordhome_catalog_item_offers WITH (security_invoker = true) AS
  SELECT p.catalog_item_id AS item_id, p.id AS product_id, p.org_id, p.supplier_id, s.name AS supplier_name,
         s.auto_sync AS supplier_auto_sync, p.reference, p.name, p.purchase_price_ht, p.purchase_price_at, p.selling_price_ht,
         CASE WHEN jsonb_typeof(p.specs -> 'canonical' -> 'stock_releve' -> 'qty') = 'number'
              THEN round((p.specs -> 'canonical' -> 'stock_releve' ->> 'qty')::numeric)::int END AS stock_qty,
         CASE WHEN jsonb_typeof(p.specs -> 'canonical' -> 'stock_releve' -> 'en_stock') = 'boolean'
              THEN (p.specs -> 'canonical' -> 'stock_releve' ->> 'en_stock')::boolean END AS en_stock,
         (p.is_active AND s.is_active) AS is_active,
         p.catalog_item_link_source AS link_source,
         p.image_url,
         p.brand
  FROM majordhome.supplier_products p
  JOIN majordhome.suppliers s ON s.id = p.supplier_id
  WHERE p.catalog_item_id IS NOT NULL;
GRANT SELECT ON public.majordhome_catalog_item_offers TO authenticated, service_role;
REVOKE ALL ON public.majordhome_catalog_item_offers FROM anon;

-- 5. Liste : champ de recherche (minuscules, accents retirés par translate — même normalisation côté front :
--    NFD sans diacritiques puis minuscules ; « œ » n'est pas décomposé, des deux côtés)
CREATE OR REPLACE VIEW public.majordhome_catalog_items_list WITH (security_invoker = true) AS
  SELECT i.id, i.org_id, i.name, i.brand, i.model_key, i.code_ean, i.category, i.gamme, i.product_kind, i.unit, i.default_tva_rate,
         i.selling_price_ht, i.description, i.image_url, i.specs, i.is_active, i.source_product_id, i.origin, i.merged_into,
         i.created_at, i.updated_at,
         COALESCE(o.offres_actives, 0)::int AS offres_actives,
         COALESCE(o.offres_total, 0)::int AS offres_total,
         o.meilleur_prix_achat,
         COALESCE(o.fournisseurs, ARRAY[]::text[]) AS fournisseurs,
         o.prix_le_plus_recent,
         translate(lower(concat_ws(' ', i.name, i.brand, i.gamme, i.model_key, i.code_ean, o.refs)),
                   'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy') AS recherche
  FROM majordhome.catalog_items i
  LEFT JOIN (
    SELECT p.catalog_item_id,
           count(*) FILTER (WHERE p.is_active AND s.is_active) AS offres_actives,
           count(*) AS offres_total,
           min(p.purchase_price_ht) FILTER (WHERE p.is_active AND s.is_active AND p.purchase_price_ht > 0) AS meilleur_prix_achat,
           array_agg(DISTINCT s.name) FILTER (WHERE p.is_active AND s.is_active) AS fournisseurs,
           max(p.purchase_price_at) FILTER (WHERE p.is_active AND s.is_active) AS prix_le_plus_recent,
           string_agg(DISTINCT concat_ws(' ', p.reference, p.brand), ' ') AS refs
    FROM majordhome.supplier_products p
    JOIN majordhome.suppliers s ON s.id = p.supplier_id
    WHERE p.catalog_item_id IS NOT NULL
    GROUP BY p.catalog_item_id
  ) o ON o.catalog_item_id = i.id;
GRANT SELECT ON public.majordhome_catalog_items_list TO authenticated, service_role;
REVOKE ALL ON public.majordhome_catalog_items_list FROM anon;

-- 6. Décision en lot : une proposition caduque (article absorbé, ou fournisseur désormais commun) est sautée
CREATE OR REPLACE FUNCTION public.catalog_item_proposals_decide(p_ids uuid[], p_statut text) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE r record; v_n int := 0; v_surv uuid; v_abs uuid;
BEGIN
  IF p_statut NOT IN ('fusionne', 'refuse') THEN RAISE EXCEPTION 'statut_invalide' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT pr.id, pr.org_id, pr.item_a_id, pr.item_b_id, ca.created_at AS a_at, cb.created_at AS b_at
           FROM majordhome.catalog_item_proposals pr
           JOIN majordhome.catalog_items ca ON ca.id = pr.item_a_id
           JOIN majordhome.catalog_items cb ON cb.id = pr.item_b_id
           WHERE pr.id = ANY (p_ids) AND pr.statut = 'propose'
           ORDER BY pr.created_at, pr.id
  LOOP
    -- le curseur est un instantané : une fusion précédente du lot a pu supprimer cette proposition, absorber un de
    -- ses articles, ou donner aux deux articles un fournisseur commun (ce ne sont alors pas les mêmes produits)
    IF NOT EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals x WHERE x.id = r.id AND x.statut = 'propose')
       OR EXISTS (SELECT 1 FROM majordhome.catalog_items i WHERE i.id IN (r.item_a_id, r.item_b_id) AND i.merged_into IS NOT NULL)
       OR (p_statut = 'fusionne' AND EXISTS (
             SELECT 1 FROM majordhome.supplier_products pa JOIN majordhome.supplier_products pb ON pb.supplier_id = pa.supplier_id
             WHERE pa.catalog_item_id = r.item_a_id AND pb.catalog_item_id = r.item_b_id AND pa.is_active AND pb.is_active)) THEN
      CONTINUE;
    END IF;
    PERFORM majordhome.catalog_item_require_admin(r.org_id);
    UPDATE majordhome.catalog_item_proposals
    SET statut = p_statut, decided_by = auth.uid(), decided_at = now(), updated_at = now()
    WHERE id = r.id;
    IF p_statut = 'fusionne' THEN
      IF (r.a_at, r.item_a_id) <= (r.b_at, r.item_b_id) THEN v_surv := r.item_a_id; v_abs := r.item_b_id; ELSE v_surv := r.item_b_id; v_abs := r.item_a_id; END IF;
      PERFORM majordhome.catalog_item_merge_impl(v_surv, v_abs);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_proposals_decide(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_proposals_decide(uuid[], text) TO authenticated, service_role;
