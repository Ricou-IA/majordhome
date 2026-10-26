-- 20261028_4_articles_droits_durcissement.sql
-- Durcissement après l'ouverture des articles au team_leader (20261028_3) — relecture finale du plan
-- « Devis — référence interne, caractéristiques, détail par chapitre, éditer l'article » (2026-10-26).
-- Spec : docs/superpowers/specs/2026-10-26-devis-reference-interne-caracteristiques-detail-chapitre-design.md
-- Répétée sur le harnais : scripts/migration-rehearsal/assert-articles-droits-durcissement.sql
--
-- (1) majordhome.catalog_items + miroir public.majordhome_catalog_items : UPDATE limité aux colonnes HUMAINES.
--     Avant : GRANT UPDATE sur toute la table (20261026_1) → depuis 20261028_3 un team_leader pouvait écrire par
--     PostgREST `merged_into`, `source_product_id`, `origin`, `org_id`, `model_key`, `code_ean` (la fusion et le
--     rattachement sont réservés aux RPC d'harmonisation org_admin, les clés à l'upsert du relevé).
--     Liste = exactement ce qu'écrivent catalogItems.service.updateItem (name, code, brand, category, gamme,
--     product_kind, unit, default_tva_rate, selling_price_ht, description, image_url, specs, is_active, updated_at)
--     et l'edge catalog-item-enrich (image_url, specs, updated_at). INSERT inchangé (policy role_can create) ;
--     DELETE retiré du GRANT (aucune policy, un article ne se supprime pas) ; service_role = SELECT seul (comme la table).
--     ⚠️ Un futur `CREATE OR REPLACE VIEW public.majordhome_catalog_items` conserve l'ACL, mais ne JAMAIS
--     recopier le boilerplate `GRANT SELECT, UPDATE ON public.majordhome_catalog_items TO authenticated` des
--     migrations 20261026_1 / 20261028_2 : il rouvrirait toutes les colonnes. Mesure : scripts/permissions-coherence.mjs § 5.
-- (2) majordhome.product_documents : un document ne peut pointer que vers un article (catalog_item_id) ou une ligne
--     fournisseur (supplier_product_id) de SA propre org — contrôle d'intégrité dans WITH CHECK (insert, update) ;
--     USING (qui peut toucher) inchangé. Même geste pour les objets Storage du bucket product-documents sous
--     `${org}/articles/…` : ajouter, remplacer ou retirer le fichier d'un document d'article suit articles.edit
--     (sinon tout membre pouvait effacer le PDF d'un article sans pouvoir toucher sa ligne — fiche cassée).
--     Lecture inchangée. Bloc Storage conditionnel (répété sur le stub storage.objects du harnais, bootstrap-pre.sql).
-- (3) `anon` sur les vues public.majordhome_* : NON traité ici — arbitrage d'Eric (102 vues + 92 tables majordhome
--     portent encore des privilèges anon, RLS security_invoker protège). Inventaire dans la note de session.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. catalog_items : UPDATE par colonne
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
REVOKE ALL ON majordhome.catalog_items FROM PUBLIC, anon; -- déjà le cas en prod (20261026_1) ; rend le harnais fidèle
REVOKE UPDATE, DELETE ON majordhome.catalog_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON majordhome.catalog_items FROM service_role; -- SELECT seul en prod depuis 20261026_1 ; le harnais rejoue des ACL par défaut
GRANT UPDATE (name, code, brand, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht,
              description, image_url, specs, is_active, updated_at)
  ON majordhome.catalog_items TO authenticated;

REVOKE ALL ON public.majordhome_catalog_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.majordhome_catalog_items TO authenticated;
GRANT UPDATE (name, code, brand, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht,
              description, image_url, specs, is_active, updated_at)
  ON public.majordhome_catalog_items TO authenticated;
GRANT SELECT ON public.majordhome_catalog_items TO service_role;
COMMENT ON VIEW public.majordhome_catalog_items IS 'Miroir updatable de majordhome.catalog_items. UPDATE accordé PAR COLONNE (champs humains) : ne jamais réémettre un GRANT UPDATE de table entière — merged_into / source_product_id / origin / org_id / model_key / code_ean ne s''écrivent que par RPC ou relevé.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. product_documents : l'article ou la ligne pointés appartiennent à l'org du document
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS product_documents_insert ON majordhome.product_documents;
CREATE POLICY product_documents_insert ON majordhome.product_documents FOR INSERT TO public
WITH CHECK (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR majordhome.role_can(product_documents.org_id, 'articles', 'edit'))
  AND (catalog_item_id IS NULL
       OR EXISTS (SELECT 1 FROM majordhome.catalog_items ci WHERE ci.id = product_documents.catalog_item_id AND ci.org_id = product_documents.org_id))
  AND (supplier_product_id IS NULL
       OR EXISTS (SELECT 1 FROM majordhome.supplier_products sp WHERE sp.id = product_documents.supplier_product_id AND sp.org_id = product_documents.org_id))
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
  AND (catalog_item_id IS NULL
       OR EXISTS (SELECT 1 FROM majordhome.catalog_items ci WHERE ci.id = product_documents.catalog_item_id AND ci.org_id = product_documents.org_id))
  AND (supplier_product_id IS NULL
       OR EXISTS (SELECT 1 FROM majordhome.supplier_products sp WHERE sp.id = product_documents.supplier_product_id AND sp.org_id = product_documents.org_id))
);
-- product_documents_delete (20261028_3) inchangée : USING membre + articles.edit pour un document d'article.

-- 2b. Storage product-documents : les objets d'ARTICLE (`${org}/articles/${item}/…`) suivent articles.edit.
--     Garde positive : role_can NULL ⇒ le OR vaut NULL ⇒ refus. Les objets de ligne (`${org}/${product}/…`) restent
--     « tout membre » (20260809_2). SELECT inchangé. Même nom de policy que 20260809_2 (DROP + CREATE).
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects absente : policies Storage non rejouées';
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS product_documents_org_insert ON storage.objects';
  EXECUTE $p$CREATE POLICY product_documents_org_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'product-documents'
      AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
      AND ((storage.foldername(name))[2] IS DISTINCT FROM 'articles'
           OR majordhome.role_can(((storage.foldername(name))[1])::uuid, 'articles', 'edit'))
    )$p$;
  EXECUTE 'DROP POLICY IF EXISTS product_documents_org_update ON storage.objects';
  EXECUTE $p$CREATE POLICY product_documents_org_update ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'product-documents'
      AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
      AND ((storage.foldername(name))[2] IS DISTINCT FROM 'articles'
           OR majordhome.role_can(((storage.foldername(name))[1])::uuid, 'articles', 'edit'))
    )
    WITH CHECK (
      bucket_id = 'product-documents'
      AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
      AND ((storage.foldername(name))[2] IS DISTINCT FROM 'articles'
           OR majordhome.role_can(((storage.foldername(name))[1])::uuid, 'articles', 'edit'))
    )$p$;
  EXECUTE 'DROP POLICY IF EXISTS product_documents_org_delete ON storage.objects';
  EXECUTE $p$CREATE POLICY product_documents_org_delete ON storage.objects FOR DELETE TO authenticated
    USING (
      bucket_id = 'product-documents'
      AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
      AND ((storage.foldername(name))[2] IS DISTINCT FROM 'articles'
           OR majordhome.role_can(((storage.foldername(name))[1])::uuid, 'articles', 'edit'))
    )$p$;
END $$;
