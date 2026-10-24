-- 20261026_3_catalog_items_relecture.sql
-- Corrections de la relecture indépendante des articles Majord'home (spec § 9 ; registre SDD du 2026-10-24) :
--   C1  Une ligne fournisseur créée à la main (ou une variante) n'avait jamais d'article → invisible au devis pour
--       un fournisseur sans relevé. RPC catalog_item_create_for_product(p_product_id) (org_admin) ; le cœur « nouvel
--       article depuis une ligne » devient majordhome.catalog_item_new_for_product, partagé avec catalog_item_detach.
--   I1  « Tout fusionner » : le curseur de catalog_item_proposals_decide livrait encore les propositions supprimées
--       par la fusion précédente (article déjà absorbé) → item_already_merged → toute la transaction annulée. La
--       boucle relit l'état courant et saute (non comptée).
--   I2  catalog_item_merge journalisait APRÈS merge_impl, qui avait déjà supprimé la proposition → trace perdue.
--       Journal d'abord ; une fusion manuelle sans proposition préalable écrit une ligne source 'manuel'.
--   M5  La vue d'écriture majordhome_supplier_products_write exposait catalog_item_id et purchase_price_at alors que
--       la policy UPDATE de supplier_products est « tout membre » : un membre pouvait re-pointer la matrice. Vue
--       recréée sans ces deux colonnes (DROP + CREATE : une vue ne perd pas de colonne par CREATE OR REPLACE) ;
--       anon n'y a plus aucun droit.
-- Répétée sur scripts/migration-rehearsal/ (assert-catalog-items.sql, assert-catalog-items-harmonisation.sql).

-- ---------------------------------------------------------------------------------------------------------------
-- I2 (prérequis) : une proposition peut naître d'une fusion manuelle
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.catalog_item_proposals DROP CONSTRAINT IF EXISTS catalog_item_proposals_source_check;
ALTER TABLE majordhome.catalog_item_proposals ADD CONSTRAINT catalog_item_proposals_source_check CHECK (source IN ('cle', 'ean', 'ia', 'manuel'));

-- ---------------------------------------------------------------------------------------------------------------
-- C1 : nouvel article depuis une ligne fournisseur (cœur interne + deux RPC)
-- ---------------------------------------------------------------------------------------------------------------
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
    (p.org_id, p.name, p.brand, p.model_key, nullif(p.code_ean, ''), p.category, p.gamme, COALESCE(p.product_kind, 'main'),
     COALESCE(p.unit, 'pièce'), COALESCE(p.default_tva_rate, 20), COALESCE(p.selling_price_ht, 0), p.description, p.image_url,
     jsonb_build_object('canonical', COALESCE(p.specs -> 'canonical', '{}'::jsonb)), p.id, 'manuel')
  RETURNING id INTO v_new;
  UPDATE majordhome.supplier_products
  SET catalog_item_id = v_new, catalog_item_link_source = 'manuel', catalog_item_linked_at = now()
  WHERE id = p_product_id;
  RETURN v_new;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.catalog_item_new_for_product(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.catalog_item_detach(p_product_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE p record; v_new uuid;
BEGIN
  SELECT * INTO p FROM majordhome.supplier_products WHERE id = p_product_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM majordhome.catalog_item_require_admin(p.org_id);
  v_new := majordhome.catalog_item_new_for_product(p_product_id);
  IF p.catalog_item_id IS NOT NULL THEN PERFORM majordhome.catalog_item_deactivate_if_empty(p.catalog_item_id); END IF;
  RETURN v_new;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_detach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_detach(uuid) TO authenticated, service_role;

-- Une ligne créée à la main (ou une variante) sans article : l'admin lui en crée un depuis le drawer.
CREATE OR REPLACE FUNCTION public.catalog_item_create_for_product(p_product_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM majordhome.supplier_products WHERE id = p_product_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM majordhome.catalog_item_require_admin(p.org_id);
  IF p.catalog_item_id IS NOT NULL THEN RAISE EXCEPTION 'already_attached' USING ERRCODE = '22023'; END IF;
  RETURN majordhome.catalog_item_new_for_product(p_product_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_create_for_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_create_for_product(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.catalog_item_create_for_product(uuid) IS 'Crée l''article Majord''home d''une ligne fournisseur qui n''en a pas (saisie manuelle, variante) — org_admin. already_attached (22023) si la ligne en a déjà un.';

-- ---------------------------------------------------------------------------------------------------------------
-- I2 : fusion explicite — journal d'abord, trace « manuel » si aucune proposition
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_item_merge(p_survivor_id uuid, p_absorbed_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE v_org uuid; v_res jsonb; v_n int;
BEGIN
  SELECT org_id INTO v_org FROM majordhome.catalog_items WHERE id = p_survivor_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM majordhome.catalog_item_require_admin(v_org);
  UPDATE majordhome.catalog_item_proposals
  SET statut = 'fusionne', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE item_a_id = least(p_survivor_id, p_absorbed_id) AND item_b_id = greatest(p_survivor_id, p_absorbed_id) AND statut = 'propose';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    INSERT INTO majordhome.catalog_item_proposals (org_id, item_a_id, item_b_id, source, motif, statut, decided_by, decided_at)
    VALUES (v_org, least(p_survivor_id, p_absorbed_id), greatest(p_survivor_id, p_absorbed_id), 'manuel', 'fusion manuelle', 'fusionne', auth.uid(), now())
    ON CONFLICT (item_a_id, item_b_id) DO UPDATE SET statut = 'fusionne', decided_by = auth.uid(), decided_at = now(), updated_at = now();
  END IF;
  v_res := majordhome.catalog_item_merge_impl(p_survivor_id, p_absorbed_id);
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_merge(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_merge(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- I1 : décision en lot — une proposition devenue caduque pendant le lot est sautée
-- ---------------------------------------------------------------------------------------------------------------
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
  LOOP
    -- le curseur est un instantané : une fusion précédente du lot a pu supprimer cette proposition ou absorber un article
    IF NOT EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals x WHERE x.id = r.id AND x.statut = 'propose')
       OR EXISTS (SELECT 1 FROM majordhome.catalog_items i WHERE i.id IN (r.item_a_id, r.item_b_id) AND i.merged_into IS NOT NULL) THEN
      CONTINUE;
    END IF;
    PERFORM majordhome.catalog_item_require_admin(r.org_id);
    UPDATE majordhome.catalog_item_proposals
    SET statut = p_statut, decided_by = auth.uid(), decided_at = now(), updated_at = now()
    WHERE id = r.id;
    IF p_statut = 'fusionne' THEN
      IF r.a_at <= r.b_at THEN v_surv := r.item_a_id; v_abs := r.item_b_id; ELSE v_surv := r.item_b_id; v_abs := r.item_a_id; END IF;
      PERFORM majordhome.catalog_item_merge_impl(v_surv, v_abs);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_proposals_decide(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_proposals_decide(uuid[], text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- M5 : la vue d'écriture ne porte ni la matrice ni la date du prix (écrites par les RPC et l'upsert seulement)
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.majordhome_supplier_products_write;
CREATE VIEW public.majordhome_supplier_products_write WITH (security_invoker = true) AS
  SELECT id, supplier_id, org_id, reference, name, description, category, purchase_price_ht, selling_price_ht, default_tva_rate,
         unit, pennylane_product_id, is_active, created_at, updated_at, code_famille, gamme, code_ean, tarif_public, taux_remise,
         diametre, ledger_account_pl_id, ledger_account_pl_number, fuel_type, brand, variant_of, variant_label, image_url,
         image_source_url, specs, client_visible, product_kind, compatible_with_ids, model_key, model_key_source
  FROM majordhome.supplier_products;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_supplier_products_write TO authenticated, service_role;
REVOKE ALL ON public.majordhome_supplier_products_write FROM PUBLIC, anon;
