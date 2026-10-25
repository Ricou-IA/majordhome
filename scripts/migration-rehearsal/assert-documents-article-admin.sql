-- assert-documents-article-admin.sql — vérifie 20261027_6_documents_article_admin.sql (après 20261027_2).
-- Couvre : un membre non admin ne peut ni ajouter, ni modifier, ni retirer un document d'ARTICLE ; l'org_admin le peut ;
-- un document de LIGNE FOURNISSEUR reste ajoutable et retirable par tout membre (non-régression). Fixture nettoyée.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_membre uuid;
  v_sup uuid; v_prod uuid; v_item uuid; v_doc uuid; v_doc_ligne uuid; v_n int; ok boolean;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer AND role <> 'org_admin' LIMIT 1;
  IF v_admin IS NULL OR v_membre IS NULL THEN RAISE EXCEPTION 'fixture : il faut un org_admin et un membre non admin Mayer'; END IF;

  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, origin) VALUES (v_mayer, 'TEST DOC Article', 'V2C', 'main', 'manuel') RETURNING id INTO v_item;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST DOC Fournisseur', true) RETURNING id INTO v_sup;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht) VALUES (v_sup, v_mayer, 'DOC-1', 'Ligne DOC', 10) RETURNING id INTO v_prod;

  -- (1) membre non admin : ajout d'un document d'article refusé
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  ok := false;
  BEGIN
    INSERT INTO majordhome.product_documents (org_id, catalog_item_id, document_type, file_name, storage_path)
    VALUES (v_mayer, v_item, 'Fiche technique', 'membre.pdf', v_mayer || '/articles/' || v_item || '/membre.pdf');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'un membre non admin a ajouté un document d''article'; END IF;

  -- (2) membre non admin : document de ligne fournisseur toujours possible (inchangé)
  INSERT INTO majordhome.product_documents (org_id, supplier_product_id, document_type, file_name, storage_path)
  VALUES (v_mayer, v_prod, 'Fiche technique', 'ligne.pdf', v_mayer || '/' || v_prod || '/ligne.pdf') RETURNING id INTO v_doc_ligne;
  RESET ROLE;

  -- (3) org_admin : ajout d'un document d'article accepté
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  INSERT INTO majordhome.product_documents (org_id, catalog_item_id, document_type, file_name, storage_path)
  VALUES (v_mayer, v_item, 'Fiche technique', 'admin.pdf', v_mayer || '/articles/' || v_item || '/admin.pdf') RETURNING id INTO v_doc;
  RESET ROLE;

  -- (4) membre non admin : ni modification ni retrait du document d'article (la RLS filtre : 0 ligne touchée)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  UPDATE majordhome.product_documents SET file_name = 'pirate.pdf' WHERE id = v_doc;
  DELETE FROM majordhome.product_documents WHERE id = v_doc;
  -- … mais le retrait d'un document de ligne fournisseur reste permis
  DELETE FROM majordhome.product_documents WHERE id = v_doc_ligne;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF NOT EXISTS (SELECT 1 FROM majordhome.product_documents WHERE id = v_doc AND file_name = 'admin.pdf') THEN
    RAISE EXCEPTION 'un membre non admin a modifié ou retiré un document d''article';
  END IF;
  IF v_n <> 1 THEN RAISE EXCEPTION 'retrait d''un document de ligne fournisseur refusé à un membre (régression)'; END IF;

  -- nettoyage
  DELETE FROM majordhome.product_documents WHERE id IN (v_doc, v_doc_ligne);
  DELETE FROM majordhome.supplier_products WHERE id = v_prod;
  DELETE FROM majordhome.catalog_items WHERE id = v_item OR id IN (SELECT catalog_item_id FROM majordhome.supplier_products WHERE supplier_id = v_sup);
  DELETE FROM majordhome.suppliers WHERE id = v_sup;

  RAISE NOTICE 'assert-documents-article-admin : OK';
END $$;
