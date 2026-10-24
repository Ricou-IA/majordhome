-- 20261026_2_catalog_items_harmonisation.sql
-- Articles Majord'home — tranche A, partie 2 : harmonisation au niveau de l'org
-- (spec docs/superpowers/specs/2026-10-24-articles-majordhome-matrice-fournisseurs-design.md § 5.3, 5.6, 5.7).
--   1. majordhome.catalog_item_proposals : une paire d'articles (a < b) candidats à la fusion, source cle | ean | ia,
--      statut propose | fusionne | refuse. Une paire refusée n'est jamais reproposée.
--   2. RPC : catalog_item_proposals_propose(org) — service_role (clés lues sur les LIGNES fournisseur actives, donc
--      une clé posée après coup par l'IA ou un EAN ajouté comptent ; fusion d'office si un seul candidat de chaque
--      côté, même nature, prix du même ordre ; sinon proposée) ; catalog_item_merge(survivor, absorbed),
--      catalog_item_proposals_decide(ids, statut), catalog_item_attach(product, item), catalog_item_detach(product)
--      — org_admin. Le cœur de la fusion est majordhome.catalog_item_merge_impl (interne, sans garde) partagé par
--      propose (service_role) et decide / merge (org_admin).
--   3. Conversion de majordhome.catalog_matches (rapprochements deux à deux) : confirmé → fusion des articles
--      (sauf si le backfill de 20261026_1 les a déjà réunis), proposé → proposition, refusé → refus ; puis DROP de la
--      table, de sa vue et de ses trois RPC.
-- Contrôle prod (avant) : SELECT statut, count(*) FROM majordhome.catalog_matches GROUP BY 1 → confirme 15, propose 3.
-- Contrôle prod (après) : les 15 paires confirmées partagent un article (NOTICE « conversion : … » de cette
-- migration) ; SELECT count(*) FROM majordhome.catalog_item_proposals WHERE statut = 'propose' → 3.
-- Répétée sur scripts/migration-rehearsal/ (assert-catalog-items-harmonisation.sql).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Propositions
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.catalog_item_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  item_a_id uuid NOT NULL REFERENCES majordhome.catalog_items(id) ON DELETE CASCADE,
  item_b_id uuid NOT NULL REFERENCES majordhome.catalog_items(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('cle', 'ean', 'ia')),
  motif text,
  statut text NOT NULL CHECK (statut IN ('propose', 'fusionne', 'refuse')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_item_proposals_ordre CHECK (item_a_id < item_b_id),
  CONSTRAINT catalog_item_proposals_paire_uniq UNIQUE (item_a_id, item_b_id)
);
CREATE INDEX IF NOT EXISTS catalog_item_proposals_org_statut_idx ON majordhome.catalog_item_proposals (org_id, statut);
CREATE INDEX IF NOT EXISTS catalog_item_proposals_b_idx ON majordhome.catalog_item_proposals (item_b_id);
ALTER TABLE majordhome.catalog_item_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_item_proposals_select ON majordhome.catalog_item_proposals;
CREATE POLICY catalog_item_proposals_select ON majordhome.catalog_item_proposals FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
-- Aucune policy d'écriture : tout passe par les RPC.
REVOKE ALL ON majordhome.catalog_item_proposals FROM PUBLIC, anon;
GRANT SELECT ON majordhome.catalog_item_proposals TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_catalog_item_proposals WITH (security_invoker = true) AS
  SELECT pr.id, pr.org_id, pr.source, pr.statut, pr.motif, pr.decided_by, pr.decided_at, pr.created_at, pr.updated_at,
         pr.item_a_id, a.name AS item_a_name, a.brand AS item_a_brand, a.category AS item_a_category, a.image_url AS item_a_image_url,
         COALESCE(oa.offres, 0)::int AS item_a_offres, oa.prix AS item_a_prix, oa.fournisseurs AS item_a_fournisseurs,
         pr.item_b_id, b.name AS item_b_name, b.brand AS item_b_brand, b.category AS item_b_category, b.image_url AS item_b_image_url,
         COALESCE(ob.offres, 0)::int AS item_b_offres, ob.prix AS item_b_prix, ob.fournisseurs AS item_b_fournisseurs,
         CASE WHEN oa.prix > 0 AND ob.prix IS NOT NULL THEN round((ob.prix - oa.prix) / oa.prix * 100, 1) END AS ecart_pct
  FROM majordhome.catalog_item_proposals pr
  JOIN majordhome.catalog_items a ON a.id = pr.item_a_id
  JOIN majordhome.catalog_items b ON b.id = pr.item_b_id
  LEFT JOIN LATERAL (SELECT count(*) AS offres, min(p.purchase_price_ht) FILTER (WHERE p.purchase_price_ht > 0) AS prix,
                            array_agg(DISTINCT s.name) AS fournisseurs
                     FROM majordhome.supplier_products p JOIN majordhome.suppliers s ON s.id = p.supplier_id
                     WHERE p.catalog_item_id = a.id AND p.is_active) oa ON true
  LEFT JOIN LATERAL (SELECT count(*) AS offres, min(p.purchase_price_ht) FILTER (WHERE p.purchase_price_ht > 0) AS prix,
                            array_agg(DISTINCT s.name) AS fournisseurs
                     FROM majordhome.supplier_products p JOIN majordhome.suppliers s ON s.id = p.supplier_id
                     WHERE p.catalog_item_id = b.id AND p.is_active) ob ON true;
GRANT SELECT ON public.majordhome_catalog_item_proposals TO authenticated, service_role;
REVOKE ALL ON public.majordhome_catalog_item_proposals FROM anon;

-- ---------------------------------------------------------------------------------------------------------------
-- 2a. Cœur de la fusion (interne, sans garde : appelé par propose en service_role et par decide / merge en org_admin)
-- ---------------------------------------------------------------------------------------------------------------
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

  UPDATE majordhome.supplier_products SET catalog_item_id = s.id, catalog_item_linked_at = now() WHERE catalog_item_id = a.id;
  GET DIAGNOSTICS v_lignes = ROW_COUNT;
  UPDATE majordhome.quote_lines SET catalog_item_id = s.id WHERE catalog_item_id = a.id;
  GET DIAGNOSTICS v_devis = ROW_COUNT;

  -- le survivant garde ses valeurs, hérite des champs vides, les specs canoniques se complètent
  UPDATE majordhome.catalog_items SET
    brand = COALESCE(s.brand, a.brand),
    model_key = COALESCE(s.model_key, a.model_key),
    code_ean = COALESCE(s.code_ean, a.code_ean),
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

-- garde org_admin partagée par les RPC d'écriture (frontend)
CREATE OR REPLACE FUNCTION majordhome.catalog_item_require_admin(p_org_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE user_id = auth.uid() AND org_id = p_org_id;
  IF (v_role = 'org_admin') IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.catalog_item_require_admin(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2b. Fusion explicite (org_admin)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_item_merge(p_survivor_id uuid, p_absorbed_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE v_org uuid; v_res jsonb;
BEGIN
  SELECT org_id INTO v_org FROM majordhome.catalog_items WHERE id = p_survivor_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM majordhome.catalog_item_require_admin(v_org);
  v_res := majordhome.catalog_item_merge_impl(p_survivor_id, p_absorbed_id);
  UPDATE majordhome.catalog_item_proposals
  SET statut = 'fusionne', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE item_a_id = least(p_survivor_id, p_absorbed_id) AND item_b_id = greatest(p_survivor_id, p_absorbed_id) AND statut = 'propose';
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_merge(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_merge(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2c. Propositions automatiques (service_role) — clés lues sur les lignes fournisseur actives
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_item_proposals_propose(p_org_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  r record;
  v_fusionnes int := 0;
  v_proposes int := 0;
  v_a uuid; v_b uuid; v_surv uuid; v_abs uuid;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'org_required' USING ERRCODE = '22023'; END IF;

  IF to_regclass('pg_temp.t_cles') IS NOT NULL THEN DROP TABLE pg_temp.t_cles; END IF;
  CREATE TEMP TABLE t_cles ON COMMIT DROP AS
    SELECT i.id AS item, i.product_kind, i.created_at, p.supplier_id, lower(p.brand) AS marque, p.model_key, nullif(p.code_ean, '') AS ean
    FROM majordhome.catalog_items i
    JOIN majordhome.supplier_products p ON p.catalog_item_id = i.id AND p.is_active
    JOIN majordhome.suppliers s ON s.id = p.supplier_id AND s.is_active
    WHERE i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL;

  IF to_regclass('pg_temp.t_prix') IS NOT NULL THEN DROP TABLE pg_temp.t_prix; END IF;
  CREATE TEMP TABLE t_prix ON COMMIT DROP AS
    SELECT p.catalog_item_id AS item, min(p.purchase_price_ht) FILTER (WHERE p.purchase_price_ht > 0) AS prix
    FROM majordhome.supplier_products p WHERE p.is_active AND p.catalog_item_id IN (SELECT DISTINCT item FROM t_cles)
    GROUP BY p.catalog_item_id;

  IF to_regclass('pg_temp.t_paires') IS NOT NULL THEN DROP TABLE pg_temp.t_paires; END IF;
  CREATE TEMP TABLE t_paires ON COMMIT DROP AS
    WITH par_cle AS (
      SELECT DISTINCT least(x.item, y.item) AS a, greatest(x.item, y.item) AS b, 'cle'::text AS source,
             'marque + modèle ' || x.model_key AS motif, 'k:' || x.marque || ':' || x.model_key AS cle
      FROM t_cles x JOIN t_cles y ON y.item <> x.item AND y.marque = x.marque AND y.model_key = x.model_key
      WHERE x.model_key IS NOT NULL AND x.marque IS NOT NULL
    ),
    par_ean AS (
      SELECT DISTINCT least(x.item, y.item) AS a, greatest(x.item, y.item) AS b, 'ean'::text AS source,
             'code EAN ' || x.ean AS motif, 'e:' || x.ean AS cle
      FROM t_cles x JOIN t_cles y ON y.item <> x.item AND y.ean = x.ean
      WHERE x.ean IS NOT NULL
    ),
    toutes AS (SELECT * FROM par_cle UNION SELECT * FROM par_ean),
    -- deux articles qui ont déjà un fournisseur en commun ne sont pas le même article
    sans_commun AS (
      SELECT t.* FROM toutes t
      WHERE NOT EXISTS (SELECT 1 FROM t_cles ca JOIN t_cles cb ON cb.supplier_id = ca.supplier_id WHERE ca.item = t.a AND cb.item = t.b)
        AND NOT EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals x WHERE x.item_a_id = t.a AND x.item_b_id = t.b)
    ),
    evaluees AS (
      SELECT t.a, t.b, t.source, t.motif,
             -- franche = un seul candidat de chaque côté pour cette clé, même nature, prix d'achat du même ordre (rapport ≤ 2)
             (SELECT count(DISTINCT CASE WHEN u.a = t.a THEN u.b ELSE u.a END) FROM sans_commun u WHERE u.cle = t.cle AND (u.a = t.a OR u.b = t.a)) = 1
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

  -- fusions d'office d'abord (survivant = le plus ancien), puis propositions ; un article absorbé en cours de route sort du jeu
  FOR r IN SELECT * FROM t_paires ORDER BY franche DESC, a, b LOOP
    IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE id IN (r.a, r.b) AND merged_into IS NOT NULL) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals x WHERE x.item_a_id = r.a AND x.item_b_id = r.b) THEN CONTINUE; END IF;
    IF r.franche THEN
      SELECT CASE WHEN ca.created_at <= cb.created_at THEN ca.id ELSE cb.id END,
             CASE WHEN ca.created_at <= cb.created_at THEN cb.id ELSE ca.id END
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

-- ---------------------------------------------------------------------------------------------------------------
-- 2d. Décision en lot (org_admin)
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
  FOR r IN SELECT pr.*, ca.created_at AS a_at, cb.created_at AS b_at
           FROM majordhome.catalog_item_proposals pr
           JOIN majordhome.catalog_items ca ON ca.id = pr.item_a_id
           JOIN majordhome.catalog_items cb ON cb.id = pr.item_b_id
           WHERE pr.id = ANY (p_ids) AND pr.statut = 'propose'
  LOOP
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
-- 2e. Rattacher / détacher une ligne fournisseur (org_admin)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.catalog_item_deactivate_if_empty(p_item_id uuid) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
  UPDATE majordhome.catalog_items i SET is_active = false, updated_at = now()
  WHERE i.id = p_item_id AND i.is_active
    AND NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p WHERE p.catalog_item_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM majordhome.quote_lines q WHERE q.catalog_item_id = i.id);
$$;
REVOKE EXECUTE ON FUNCTION majordhome.catalog_item_deactivate_if_empty(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.catalog_item_attach(p_product_id uuid, p_item_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE p record; i record;
BEGIN
  SELECT * INTO p FROM majordhome.supplier_products WHERE id = p_product_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO i FROM majordhome.catalog_items WHERE id = p_item_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;
  IF i.org_id <> p.org_id THEN RAISE EXCEPTION 'items_not_same_org' USING ERRCODE = '42501'; END IF;
  IF i.merged_into IS NOT NULL THEN RAISE EXCEPTION 'item_already_merged' USING ERRCODE = '22023'; END IF;
  PERFORM majordhome.catalog_item_require_admin(p.org_id);
  IF p.catalog_item_id = p_item_id THEN RETURN; END IF;
  UPDATE majordhome.supplier_products
  SET catalog_item_id = p_item_id, catalog_item_link_source = 'manuel', catalog_item_linked_at = now()
  WHERE id = p_product_id;
  UPDATE majordhome.catalog_items SET is_active = true, updated_at = now() WHERE id = p_item_id AND NOT is_active;
  IF p.catalog_item_id IS NOT NULL THEN PERFORM majordhome.catalog_item_deactivate_if_empty(p.catalog_item_id); END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_attach(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_attach(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.catalog_item_detach(p_product_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE p record; v_new uuid; v_old uuid;
BEGIN
  SELECT * INTO p FROM majordhome.supplier_products WHERE id = p_product_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM majordhome.catalog_item_require_admin(p.org_id);
  v_old := p.catalog_item_id;
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
  IF v_old IS NOT NULL THEN PERFORM majordhome.catalog_item_deactivate_if_empty(v_old); END IF;
  RETURN v_new;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_detach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_detach(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Conversion des rapprochements deux à deux, puis retrait
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE r record; v_ia uuid; v_ib uuid; v_fus int := 0; v_deja int := 0; v_prop int := 0; v_ref int := 0; v_surv uuid; v_abs uuid;
BEGIN
  IF to_regclass('majordhome.catalog_matches') IS NULL THEN RETURN; END IF;
  FOR r IN SELECT m.*, pa.catalog_item_id AS ia, pb.catalog_item_id AS ib
           FROM majordhome.catalog_matches m
           JOIN majordhome.supplier_products pa ON pa.id = m.product_a_id
           JOIN majordhome.supplier_products pb ON pb.id = m.product_b_id
           ORDER BY m.created_at
  LOOP
    SELECT COALESCE(i.merged_into, i.id) INTO v_ia FROM majordhome.catalog_items i WHERE i.id = r.ia;
    SELECT COALESCE(i.merged_into, i.id) INTO v_ib FROM majordhome.catalog_items i WHERE i.id = r.ib;
    IF v_ia IS NULL OR v_ib IS NULL THEN CONTINUE; END IF;
    IF r.statut = 'confirme' THEN
      IF v_ia = v_ib THEN v_deja := v_deja + 1; CONTINUE; END IF;
      SELECT CASE WHEN ca.created_at <= cb.created_at THEN ca.id ELSE cb.id END,
             CASE WHEN ca.created_at <= cb.created_at THEN cb.id ELSE ca.id END INTO v_surv, v_abs
      FROM majordhome.catalog_items ca, majordhome.catalog_items cb WHERE ca.id = v_ia AND cb.id = v_ib;
      INSERT INTO majordhome.catalog_item_proposals (org_id, item_a_id, item_b_id, source, motif, statut, decided_by, decided_at)
      VALUES (r.org_id, least(v_ia, v_ib), greatest(v_ia, v_ib), CASE WHEN r.motif LIKE 'code EAN%' THEN 'ean' ELSE 'cle' END,
              COALESCE(r.motif, '') || ' (converti)', 'fusionne', r.confirmed_by, COALESCE(r.confirmed_at, now()))
      ON CONFLICT (item_a_id, item_b_id) DO NOTHING;
      PERFORM majordhome.catalog_item_merge_impl(v_surv, v_abs);
      v_fus := v_fus + 1;
    ELSIF v_ia <> v_ib THEN
      INSERT INTO majordhome.catalog_item_proposals (org_id, item_a_id, item_b_id, source, motif, statut, decided_by, decided_at)
      VALUES (r.org_id, least(v_ia, v_ib), greatest(v_ia, v_ib), CASE WHEN r.motif LIKE 'code EAN%' THEN 'ean' ELSE 'cle' END,
              COALESCE(r.motif, '') || ' (converti)', r.statut, r.confirmed_by, r.confirmed_at)
      ON CONFLICT (item_a_id, item_b_id) DO NOTHING;
      IF r.statut = 'propose' THEN v_prop := v_prop + 1; ELSE v_ref := v_ref + 1; END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'conversion catalog_matches : % fusions, % paires déjà réunies par le backfill, % propositions, % refus', v_fus, v_deja, v_prop, v_ref;
END $$;

DROP FUNCTION IF EXISTS public.catalog_matches_propose(uuid);
DROP FUNCTION IF EXISTS public.catalog_match_set_status(uuid[], text);
DROP FUNCTION IF EXISTS public.catalog_match_create(uuid, uuid);
DROP VIEW IF EXISTS public.majordhome_catalog_matches;
DROP TABLE IF EXISTS majordhome.catalog_matches;
