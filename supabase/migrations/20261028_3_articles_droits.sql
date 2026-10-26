-- 20261028_3_articles_droits.sql
-- Droits app-level : nouvelle ressource `articles` (base du devis, table majordhome.catalog_items).
-- Spec : docs/superpowers/specs/2026-10-26-devis-reference-interne-caracteristiques-detail-chapitre-design.md
-- Décision d'Eric (2026-10-26) : l'édition des articles se fait au niveau team_leader
--   view = responsable + commercial + technicien ; create / edit = responsable ; pas de delete
--   (un article se désactive ou se fusionne). org_admin = bypass, jamais listé.
--
-- PARTIE 1 (ce bloc) : défauts app, sortie de `node scripts/gen-app-role-permissions-sql.mjs`
--   (registre src/lib/permissionsRegistry.js = source unique), collée telle quelle.
--   Idempotent (upsert sur la clé primaire role, resource, action).
-- PARTIE 2 (en fin de fichier) : écritures d'article sous majordhome.role_can(org, 'articles', …) —
--   garde des RPC (catalog_item_require_edit), policies RLS de catalog_items et des documents d'article,
--   enveloppe public.user_can pour les edge functions.
-- Vérifié par impersonation sur le harnais : scripts/migration-rehearsal/assert-articles-droits.sql
INSERT INTO majordhome.app_role_permissions (role, resource, action, allowed) VALUES
  ('team_leader','dashboard','view',true),
  ('commercial','dashboard','view',true),
  ('technicien','dashboard','view',true),
  ('team_leader','clients','view',true),
  ('commercial','clients','view',true),
  ('technicien','clients','view',true),
  ('team_leader','clients','create',true),
  ('commercial','clients','create',true),
  ('technicien','clients','create',false),
  ('team_leader','clients','edit',true),
  ('commercial','clients','edit',true),
  ('technicien','clients','edit',true),
  ('team_leader','clients','delete',false),
  ('commercial','clients','delete',false),
  ('technicien','clients','delete',false),
  ('team_leader','pipeline','view',true),
  ('commercial','pipeline','view',true),
  ('technicien','pipeline','view',false),
  ('team_leader','pipeline','create',true),
  ('commercial','pipeline','create',true),
  ('technicien','pipeline','create',false),
  ('team_leader','pipeline','edit',true),
  ('commercial','pipeline','edit',false),
  ('technicien','pipeline','edit',false),
  ('team_leader','pipeline','edit_own',true),
  ('commercial','pipeline','edit_own',true),
  ('technicien','pipeline','edit_own',false),
  ('team_leader','pipeline','delete',false),
  ('commercial','pipeline','delete',false),
  ('technicien','pipeline','delete',false),
  ('team_leader','pipeline','assign',true),
  ('commercial','pipeline','assign',false),
  ('technicien','pipeline','assign',false),
  ('team_leader','chantiers','view',true),
  ('commercial','chantiers','view',true),
  ('technicien','chantiers','view',true),
  ('team_leader','chantiers','edit',true),
  ('commercial','chantiers','edit',false),
  ('technicien','chantiers','edit',false),
  ('team_leader','chantiers','edit_own',true),
  ('commercial','chantiers','edit_own',true),
  ('technicien','chantiers','edit_own',true),
  ('team_leader','planning','view',true),
  ('commercial','planning','view',true),
  ('technicien','planning','view',true),
  ('team_leader','planning','create',true),
  ('commercial','planning','create',true),
  ('technicien','planning','create',false),
  ('team_leader','entretiens','view',true),
  ('commercial','entretiens','view',true),
  ('technicien','entretiens','view',true),
  ('team_leader','entretiens','create',true),
  ('commercial','entretiens','create',true),
  ('technicien','entretiens','create',true),
  ('team_leader','entretiens','edit',true),
  ('commercial','entretiens','edit',false),
  ('technicien','entretiens','edit',true),
  ('team_leader','sav','view',true),
  ('commercial','sav','view',true),
  ('technicien','sav','view',true),
  ('team_leader','sav','create',true),
  ('commercial','sav','create',false),
  ('technicien','sav','create',false),
  ('team_leader','sav','edit',true),
  ('commercial','sav','edit',false),
  ('technicien','sav','edit',false),
  ('team_leader','devis','view',true),
  ('commercial','devis','view',true),
  ('technicien','devis','view',false),
  ('team_leader','devis','create',true),
  ('commercial','devis','create',true),
  ('technicien','devis','create',false),
  ('team_leader','devis','edit',true),
  ('commercial','devis','edit',true),
  ('technicien','devis','edit',false),
  ('team_leader','devis','delete',false),
  ('commercial','devis','delete',false),
  ('technicien','devis','delete',false),
  ('team_leader','articles','view',true),
  ('commercial','articles','view',true),
  ('technicien','articles','view',true),
  ('team_leader','articles','create',true),
  ('commercial','articles','create',false),
  ('technicien','articles','create',false),
  ('team_leader','articles','edit',true),
  ('commercial','articles','edit',false),
  ('technicien','articles','edit',false),
  ('team_leader','tasks','view',true),
  ('commercial','tasks','view',true),
  ('technicien','tasks','view',true),
  ('team_leader','tasks','create',true),
  ('commercial','tasks','create',true),
  ('technicien','tasks','create',true),
  ('team_leader','tasks','edit',true),
  ('commercial','tasks','edit',false),
  ('technicien','tasks','edit',false),
  ('team_leader','tasks','edit_own',false),
  ('commercial','tasks','edit_own',true),
  ('technicien','tasks','edit_own',false),
  ('team_leader','tasks','delete',false),
  ('commercial','tasks','delete',false),
  ('technicien','tasks','delete',false),
  ('team_leader','tasks','assign',true),
  ('commercial','tasks','assign',false),
  ('technicien','tasks','assign',false),
  ('team_leader','territoire','view',true),
  ('commercial','territoire','view',true),
  ('technicien','territoire','view',true),
  ('team_leader','meta_ads','view',false),
  ('commercial','meta_ads','view',false),
  ('technicien','meta_ads','view',false),
  ('team_leader','voice_recorder','use',true),
  ('commercial','voice_recorder','use',false),
  ('technicien','voice_recorder','use',false),
  ('team_leader','pv_calculator','view',true),
  ('commercial','pv_calculator','view',true),
  ('technicien','pv_calculator','view',false),
  ('team_leader','thermal_study','view',true),
  ('commercial','thermal_study','view',true),
  ('technicien','thermal_study','view',false),
  ('team_leader','maintenance','view',true),
  ('commercial','maintenance','view',true),
  ('technicien','maintenance','view',true),
  ('team_leader','maintenance','edit',false),
  ('commercial','maintenance','edit',false),
  ('technicien','maintenance','edit',false),
  ('team_leader','settings','view',false),
  ('commercial','settings','view',false),
  ('technicien','settings','view',false),
  ('team_leader','settings','edit',false),
  ('commercial','settings','edit',false),
  ('technicien','settings','edit',false)
ON CONFLICT (role, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- PARTIE 2 : écritures d'article sous role_can(org, 'articles', create | edit)
-- Avant : org_admin seul (policies catalog_items_*_admin, garde catalog_item_require_admin des RPC,
--   documents d'article 20261027_6). Après : le verdict de l'arbitre unique, donc team_leader par défaut,
--   surchargeable par org (Settings → Droits d'accès) et par profil maison.
-- Inchangés : la lecture (catalog_items_select, product_documents_select, baikal_read), les documents de
--   LIGNE fournisseur (catalog_item_id NULL, « tout membre »), et les gestes restés org_admin (fusion,
--   décisions de propositions, harmonisation : ils gardent catalog_item_require_admin).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════

-- 2.1 Garde partagée des RPC d'écriture d'article (pendant de catalog_item_require_admin).
--     Garde POSITIVE : un verdict NULL refuse (jamais `IF NOT role_can`).
CREATE OR REPLACE FUNCTION majordhome.catalog_item_require_edit(p_org_id uuid, p_action text DEFAULT 'edit') RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF majordhome.role_can(p_org_id, 'articles', p_action) IS NOT TRUE THEN
    RAISE EXCEPTION 'articles_edit_required' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.catalog_item_require_edit(uuid, text) FROM PUBLIC, anon, authenticated;

-- 2.2 RPC : corps inchangé (dernières définitions 20261027_2 / 20261026_3), seule la garde change.
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
  PERFORM majordhome.catalog_item_require_edit(p.org_id, 'edit');
  IF p.catalog_item_id = p_item_id THEN RETURN; END IF;
  UPDATE majordhome.supplier_products
  SET catalog_item_id = p_item_id, catalog_item_link_source = 'manuel', catalog_item_linked_at = now()
  WHERE id = p_product_id;
  UPDATE majordhome.catalog_items SET
    is_active = true,
    image_url = COALESCE(i.image_url, p.image_url),
    specs = COALESCE(i.specs, '{}'::jsonb)
            || jsonb_build_object('canonical', COALESCE(p.specs -> 'canonical', '{}'::jsonb) || COALESCE(i.specs -> 'canonical', '{}'::jsonb)),
    updated_at = now()
  WHERE id = p_item_id;
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
DECLARE p record; v_new uuid;
BEGIN
  SELECT * INTO p FROM majordhome.supplier_products WHERE id = p_product_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM majordhome.catalog_item_require_edit(p.org_id, 'edit');
  v_new := majordhome.catalog_item_new_for_product(p_product_id);
  IF p.catalog_item_id IS NOT NULL THEN PERFORM majordhome.catalog_item_deactivate_if_empty(p.catalog_item_id); END IF;
  RETURN v_new;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_detach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_detach(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.catalog_item_create_for_product(p_product_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM majordhome.supplier_products WHERE id = p_product_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM majordhome.catalog_item_require_edit(p.org_id, 'create');
  IF p.catalog_item_id IS NOT NULL THEN RAISE EXCEPTION 'already_attached' USING ERRCODE = '22023'; END IF;
  RETURN majordhome.catalog_item_new_for_product(p_product_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_item_create_for_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_item_create_for_product(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.catalog_item_create_for_product(uuid) IS 'Crée l''article Majord''home d''une ligne fournisseur qui n''en a pas (saisie manuelle, variante) — droit articles.create (role_can). already_attached (22023) si la ligne en a déjà un.';

-- 2.3 Policies catalog_items : ADD (role_can) puis DROP des policies org_admin. Lecture inchangée.
--     Pas de policy DELETE : un article ne se supprime pas (il se désactive ou se fusionne).
CREATE POLICY catalog_items_insert ON majordhome.catalog_items
  FOR INSERT TO PUBLIC
  WITH CHECK (majordhome.role_can(org_id, 'articles', 'create'));

CREATE POLICY catalog_items_update ON majordhome.catalog_items
  FOR UPDATE TO PUBLIC
  USING (majordhome.role_can(org_id, 'articles', 'edit'))
  WITH CHECK (majordhome.role_can(org_id, 'articles', 'edit'));

DROP POLICY IF EXISTS catalog_items_insert_admin ON majordhome.catalog_items;
DROP POLICY IF EXISTS catalog_items_update_admin ON majordhome.catalog_items;

-- 2.4 Documents : un document d'ARTICLE (catalog_item_id renseigné) suit articles.edit (ajouter, modifier ou
--     retirer une fiche = corriger l'article) ; un document de LIGNE fournisseur reste « tout membre ».
DROP POLICY IF EXISTS product_documents_insert ON majordhome.product_documents;
CREATE POLICY product_documents_insert ON majordhome.product_documents FOR INSERT TO public
WITH CHECK (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR majordhome.role_can(product_documents.org_id, 'articles', 'edit'))
);

DROP POLICY IF EXISTS product_documents_update ON majordhome.product_documents;
CREATE POLICY product_documents_update ON majordhome.product_documents FOR UPDATE TO public
USING (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR majordhome.role_can(product_documents.org_id, 'articles', 'edit'))
)
WITH CHECK (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR majordhome.role_can(product_documents.org_id, 'articles', 'edit'))
);

DROP POLICY IF EXISTS product_documents_delete ON majordhome.product_documents;
CREATE POLICY product_documents_delete ON majordhome.product_documents FOR DELETE TO public
USING (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR majordhome.role_can(product_documents.org_id, 'articles', 'edit'))
);

-- 2.5 public.user_can : le verdict de l'arbitre pour l'appelant (edge functions sous JWT utilisateur).
--     SECURITY INVOKER (simple enveloppe : role_can, SECURITY DEFINER, lit auth.uid()) ; NULL ⇒ false.
CREATE OR REPLACE FUNCTION public.user_can(p_org_id uuid, p_resource text, p_action text) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = majordhome, public
AS $$
BEGIN
  RETURN COALESCE(majordhome.role_can(p_org_id, p_resource, p_action), false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.user_can(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can(uuid, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.user_can(uuid, text, text) IS 'Verdict de majordhome.role_can(org, resource, action) pour l''utilisateur du JWT — false si non authentifié, non membre ou refusé. Pour les edge functions.';
