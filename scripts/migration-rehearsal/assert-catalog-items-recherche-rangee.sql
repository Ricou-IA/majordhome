-- assert-catalog-items-recherche-rangee.sql — vérifie 20261124_2_catalog_items_recherche_rangee.sql
-- Couvre : texte rangé = ancienne formule (libellé, marque, gamme, clé, EAN, code + références / marques des lignes
-- fournisseur), tenu à jour par les déclencheurs (ajout, changement de référence, déplacement, suppression, renommage),
-- vue : mêmes colonnes et types, security_invoker, offres par article, aucun droit pour anon ; fonctions internes
-- non exécutables par anon / authenticated.
-- Chaîne : 20261028_4 (droits d'UPDATE par colonne, non photographiés) puis 20261124_2. Le cluster local est en
-- locale C : lower() n'y met pas une majuscule accentuée en minuscule (la production, si), d'où « été » en minuscules.
-- Mesures de durée faites en production dans une transaction annulée (2026-11-24) : 80 ms au lieu de 3,7 s.
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_sup uuid; v_item uuid; v_item2 uuid; v_sp uuid; v_sp2 uuid;
  v_txt text; v_row record; v_n int;
BEGIN
  IF has_function_privilege('anon', 'majordhome.catalog_items_recherche_recalculer(uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'majordhome.catalog_items_recherche_recalculer(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'catalog_items_recherche_recalculer exécutable hors base';
  END IF;
  IF has_table_privilege('anon', 'public.majordhome_catalog_items_list', 'SELECT') THEN RAISE EXCEPTION 'anon lit la liste des articles'; END IF;
  IF has_column_privilege('authenticated', 'majordhome.catalog_items', 'recherche', 'UPDATE') THEN RAISE EXCEPTION 'authenticated écrit recherche'; END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'majordhome_catalog_items_list' AND c.reloptions::text LIKE '%security_invoker=true%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'security_invoker perdu'; END IF;
  SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) INTO v_txt
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_catalog_items_list'
     AND column_name IN ('offres_actives', 'offres_total', 'fournisseurs', 'recherche', 'code');
  IF v_txt <> 'offres_actives:integer,offres_total:integer,fournisseurs:ARRAY,recherche:text,code:text' THEN RAISE EXCEPTION 'colonnes de la vue : %', v_txt; END IF;

  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_org, 'TEST RECHERCHE', true) RETURNING id INTO v_sup;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, unit, origin)
  VALUES (v_org, 'Vase d''expansion Chauffage 18 L', 'Zilmet', 'accessory', 'pièce', 'manuel') RETURNING id INTO v_item;
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, unit, origin)
  VALUES (v_org, 'Autre article', 'accessory', 'pièce', 'manuel') RETURNING id INTO v_item2;
  IF (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item) <> 'vase d''expansion chauffage 18 l zilmet' THEN
    RAISE EXCEPTION 'texte à la création : %', (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item);
  END IF;

  INSERT INTO majordhome.supplier_products (org_id, supplier_id, reference, name, catalog_item_id, brand, purchase_price_ht, is_active)
  VALUES (v_org, v_sup, 'REF-A', 'x', v_item, 'Zilmet', 40, true) RETURNING id INTO v_sp;
  INSERT INTO majordhome.supplier_products (org_id, supplier_id, reference, name, catalog_item_id, purchase_price_ht, is_active)
  VALUES (v_org, v_sup, 'REF-B', 'y', v_item, 35, false) RETURNING id INTO v_sp2;
  v_txt := (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item);
  IF v_txt <> 'vase d''expansion chauffage 18 l zilmet ref-a zilmet ref-b' THEN RAISE EXCEPTION 'texte après ajout des lignes : %', v_txt; END IF;

  SELECT * INTO v_row FROM public.majordhome_catalog_items_list WHERE id = v_item;
  IF v_row.offres_total <> 2 OR v_row.offres_actives <> 1 OR v_row.meilleur_prix_achat <> 40 OR v_row.fournisseurs <> ARRAY['TEST RECHERCHE'] THEN
    RAISE EXCEPTION 'offres : % % % %', v_row.offres_total, v_row.offres_actives, v_row.meilleur_prix_achat, v_row.fournisseurs;
  END IF;
  SELECT * INTO v_row FROM public.majordhome_catalog_items_list WHERE id = v_item2;
  IF v_row.offres_total <> 0 OR v_row.fournisseurs <> ARRAY[]::text[] OR v_row.meilleur_prix_achat IS NOT NULL THEN RAISE EXCEPTION 'article sans offre : %', v_row; END IF;
  SELECT count(*) INTO v_n FROM public.majordhome_catalog_items_list WHERE recherche ILIKE '%expansion%' AND recherche ILIKE '%ref-b%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'recherche par référence : %', v_n; END IF;

  UPDATE majordhome.supplier_products SET reference = 'REF-C' WHERE id = v_sp;
  IF (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item) NOT LIKE '%ref-c%' THEN RAISE EXCEPTION 'référence changée non suivie'; END IF;
  UPDATE majordhome.supplier_products SET catalog_item_id = v_item2 WHERE id = v_sp2;
  IF (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item) LIKE '%ref-b%'
     OR (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item2) NOT LIKE '%ref-b%' THEN RAISE EXCEPTION 'déplacement non suivi'; END IF;
  DELETE FROM majordhome.supplier_products WHERE id = v_sp2;
  IF (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item2) <> 'autre article' THEN RAISE EXCEPTION 'suppression non suivie'; END IF;
  UPDATE majordhome.catalog_items SET name = 'Vase été', code = 'MAY-12' WHERE id = v_item;
  IF (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item) <> 'vase ete zilmet may-12 ref-c zilmet' THEN
    RAISE EXCEPTION 'renommage : %', (SELECT recherche FROM majordhome.catalog_items WHERE id = v_item);
  END IF;

  RAISE NOTICE 'assert-catalog-items-recherche-rangee : OK';
END $$;
