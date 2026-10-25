-- 20261027_6_documents_article_admin.sql
-- Un document d'ARTICLE (product_documents.catalog_item_id renseigné, 20261027_2) est une métadonnée de l'article :
-- l'ajouter, le modifier ou le retirer est réservé à l'org_admin, comme toute correction d'article (décision d'Eric,
-- « admin seul »). Avant : policies « tout membre » héritées des fiches de lignes fournisseur — un non-admin pouvait
-- retirer la fiche technique d'un article. Les documents des lignes fournisseur (catalog_item_id NULL) restent
-- « tout membre » (inchangé). La lecture reste « tout membre ». La fusion d'articles (catalog_item_merge_impl,
-- SECURITY DEFINER) n'est pas concernée.
-- Relecture finale du plan 2026-10-25 (point « Declined to judge » : policies de product_documents).

DROP POLICY IF EXISTS product_documents_insert ON majordhome.product_documents;
CREATE POLICY product_documents_insert ON majordhome.product_documents FOR INSERT TO public
WITH CHECK (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.org_id = product_documents.org_id AND om.role = 'org_admin'))
);

DROP POLICY IF EXISTS product_documents_update ON majordhome.product_documents;
CREATE POLICY product_documents_update ON majordhome.product_documents FOR UPDATE TO public
USING (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.org_id = product_documents.org_id AND om.role = 'org_admin'))
)
WITH CHECK (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.org_id = product_documents.org_id AND om.role = 'org_admin'))
);

DROP POLICY IF EXISTS product_documents_delete ON majordhome.product_documents;
CREATE POLICY product_documents_delete ON majordhome.product_documents FOR DELETE TO public
USING (
  org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  AND (catalog_item_id IS NULL OR EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.org_id = product_documents.org_id AND om.role = 'org_admin'))
);
