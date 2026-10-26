-- 20261028_2_catalog_items_code.sql
-- Référence interne de l'article Majord'home (devis : « référence interne » éditable, plan 2026-10-26, tâche 9).
--   1. majordhome.catalog_items.code : référence INTERNE de l'article (ex. ME-001), propre à l'org, distincte de la
--      référence fournisseur (supplier_products.reference, jamais touchée). Unique par org, insensible à la casse,
--      parmi les articles vivants (merged_into IS NULL) ; blanc interdit (NULL = pas de référence).
--   2. Vues : `code` EN FIN de majordhome_catalog_items (miroir updatable : CREATE OR REPLACE VIEW n'autorise l'ajout
--      qu'en fin de liste) et de majordhome_catalog_items_list, où `code` entre aussi dans le champ de recherche.
--      majordhome_catalog_item_offers / _proposals n'exposent aucune colonne de l'article à ce titre : inchangées.
--   3. Fusion (catalog_item_merge_impl, dernière définition = 20261027_2, reprise à l'identique) : le code de l'article
--      absorbé est libéré AVANT toute chose (l'index d'unicité ne voit que merged_into IS NULL, l'absorbé ne l'est
--      qu'en fin de fonction), puis le survivant garde son code ou hérite de celui de l'absorbé.
-- Répétée sur scripts/migration-rehearsal/ (assert-catalog-items-code.sql).

-- 1. Colonne, contrainte, unicité par org
ALTER TABLE majordhome.catalog_items ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE majordhome.catalog_items DROP CONSTRAINT IF EXISTS catalog_items_code_check;
ALTER TABLE majordhome.catalog_items ADD CONSTRAINT catalog_items_code_check CHECK (code IS NULL OR btrim(code) <> '');
CREATE UNIQUE INDEX IF NOT EXISTS catalog_items_code_org_unique
  ON majordhome.catalog_items (org_id, lower(code)) WHERE code IS NOT NULL AND merged_into IS NULL;
COMMENT ON COLUMN majordhome.catalog_items.code IS 'Référence interne de l''article (propre à l''org, unique sans tenir compte de la casse parmi les articles vivants) — distincte de la référence fournisseur';

-- 2a. Miroir updatable : code en fin
CREATE OR REPLACE VIEW public.majordhome_catalog_items WITH (security_invoker = true) AS
  SELECT id, org_id, name, brand, model_key, code_ean, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht,
         description, image_url, specs, is_active, source_product_id, origin, merged_into, created_at, updated_at, code
  FROM majordhome.catalog_items;
GRANT SELECT, UPDATE ON public.majordhome_catalog_items TO authenticated;
GRANT SELECT ON public.majordhome_catalog_items TO service_role;
REVOKE ALL ON public.majordhome_catalog_items FROM anon;

-- 2b. Liste : code en fin + dans le champ de recherche (définition de 20261027_1 reprise)
CREATE OR REPLACE VIEW public.majordhome_catalog_items_list WITH (security_invoker = true) AS
  SELECT i.id, i.org_id, i.name, i.brand, i.model_key, i.code_ean, i.category, i.gamme, i.product_kind, i.unit, i.default_tva_rate,
         i.selling_price_ht, i.description, i.image_url, i.specs, i.is_active, i.source_product_id, i.origin, i.merged_into,
         i.created_at, i.updated_at,
         COALESCE(o.offres_actives, 0)::int AS offres_actives,
         COALESCE(o.offres_total, 0)::int AS offres_total,
         o.meilleur_prix_achat,
         COALESCE(o.fournisseurs, ARRAY[]::text[]) AS fournisseurs,
         o.prix_le_plus_recent,
         translate(lower(concat_ws(' ', i.name, i.brand, i.gamme, i.model_key, i.code_ean, i.code, o.refs)),
                   'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy') AS recherche,
         i.code
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

-- 3. Fusion : corps de 20261027_2 + reprise du code (libération de l'absorbé avant tout, puis héritage)
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

  -- le code de l'absorbé est libéré d'abord (a.code reste lu plus bas) : l'index d'unicité ne le voit encore comme
  -- « vivant » que jusqu'à la fin de la fonction
  UPDATE majordhome.catalog_items SET code = NULL WHERE id = a.id;

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
    code = COALESCE(s.code, a.code),
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
