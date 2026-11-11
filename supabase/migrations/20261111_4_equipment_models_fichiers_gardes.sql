-- 20261111_4_equipment_models_fichiers_gardes.sql
-- Relecture de 20261111_3 : un fichier relevé sur le site du fabricant est stocké une fois par contenu et PARTAGÉ par
-- plusieurs lignes de equipment_documents. Sa protection ne doit pas reposer sur l'écran (un ancien bundle en cache
-- supprimait l'objet avec la ligne) :
--   1. une ligne MANUELLE ne peut pas pointer un fichier du dossier `…/equipment-models/site/` (sinon son retrait
--      supprimerait le fichier de tous les modèles) ;
--   2. une ligne RELEVÉE ne se supprime plus depuis l'application (org_admin compris) : seule la RPC
--      equipment_models_set_files (service_role) les remplace ;
--   3. Storage : les objets de ce dossier ne s'écrivent, ne se modifient et ne se suppriment que par service_role
--      (policies RESTRICTIVES : elles ne changent rien pour les autres objets du bucket).
-- Répétée sur scripts/migration-rehearsal/ (assert-equipment-models-fichiers.sql).

ALTER TABLE majordhome.equipment_documents DROP CONSTRAINT IF EXISTS equipment_documents_site_path_reserved;
ALTER TABLE majordhome.equipment_documents ADD CONSTRAINT equipment_documents_site_path_reserved
  CHECK (equipment_model_id IS NOT NULL OR storage_path NOT LIKE '%/equipment-models/site/%');

DROP POLICY IF EXISTS equipment_documents_delete_role_can ON majordhome.equipment_documents;
CREATE POLICY equipment_documents_delete_role_can ON majordhome.equipment_documents FOR DELETE
  USING (majordhome.role_can(org_id, 'clients', 'delete') AND equipment_model_id IS NULL);

DROP POLICY IF EXISTS product_documents_site_no_insert ON storage.objects;
CREATE POLICY product_documents_site_no_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (NOT (bucket_id = 'product-documents' AND name LIKE '%/equipment-models/site/%'));
DROP POLICY IF EXISTS product_documents_site_no_update ON storage.objects;
CREATE POLICY product_documents_site_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (NOT (bucket_id = 'product-documents' AND name LIKE '%/equipment-models/site/%'))
  WITH CHECK (NOT (bucket_id = 'product-documents' AND name LIKE '%/equipment-models/site/%'));
DROP POLICY IF EXISTS product_documents_site_no_delete ON storage.objects;
CREATE POLICY product_documents_site_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (NOT (bucket_id = 'product-documents' AND name LIKE '%/equipment-models/site/%'));
