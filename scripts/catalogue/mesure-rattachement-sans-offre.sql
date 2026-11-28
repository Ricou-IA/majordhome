-- mesure-rattachement-sans-offre.sql — LECTURE SEULE. À lancer avant et après la mise en production de
-- 20261129_4_rattachement_articles_sans_offre.sql (Task 7 / Task 10 du plan d'import d'articles).
--
-- Compte, par organisation, les articles vivants (actifs, non absorbés) qui deviennent candidats au rattachement
-- d'une ligne de relevé avec la nouvelle étape 2 de catalog_items_ensure :
--   - sans_offre          : aucune ligne ACTIVE avec un prix d'achat (> 0) — « sans fournisseur » au sens du § 6.5 ;
--   - sans_offre_cles     : … et qui portent des clés (marque + model_key, ou EAN valide), les leurs ou celles de
--                           leurs lignes actives : ceux-là peuvent désormais recevoir une ligne d'un relevé ;
--   - dont_jamais_ligne   : … sans aucune ligne du tout (articles importés, ou créés à la main) ;
--   - dont_lignes_eteintes: … qui ont des lignes, toutes éteintes ou sans prix (effet assumé : un produit revenu sous une
--                           nouvelle référence se rattache au lieu de se doubler) ;
--   - avec_offre_cles_lignes : articles AVEC une ligne active à prix dont une ligne active porte une clé différente de
--                           celles de l'article : la recherche par les clés des lignes leur ouvre un rattachement de plus.
-- Aucune écriture : un seul SELECT.
WITH vivants AS (
  SELECT i.* FROM majordhome.catalog_items i WHERE i.is_active AND i.merged_into IS NULL
),
etat AS (
  SELECT v.org_id, v.id,
         EXISTS (SELECT 1 FROM majordhome.supplier_products p
                  WHERE p.catalog_item_id = v.id AND p.is_active AND p.purchase_price_ht > 0) AS avec_offre,
         EXISTS (SELECT 1 FROM majordhome.supplier_products p WHERE p.catalog_item_id = v.id) AS a_une_ligne,
         ((v.brand IS NOT NULL AND v.model_key IS NOT NULL) OR v.code_ean ~ '^[0-9]{8,14}$') AS cles_propres,
         EXISTS (SELECT 1 FROM majordhome.supplier_products p
                  WHERE p.catalog_item_id = v.id AND p.is_active
                    AND ((p.brand IS NOT NULL AND p.model_key IS NOT NULL) OR p.code_ean ~ '^[0-9]{8,14}$')) AS cles_lignes,
         EXISTS (SELECT 1 FROM majordhome.supplier_products p
                  WHERE p.catalog_item_id = v.id AND p.is_active
                    AND (   (p.brand IS NOT NULL AND p.model_key IS NOT NULL
                             AND (lower(p.brand) IS DISTINCT FROM lower(v.brand) OR p.model_key IS DISTINCT FROM v.model_key))
                         OR (p.code_ean ~ '^[0-9]{8,14}$' AND p.code_ean IS DISTINCT FROM v.code_ean))) AS cle_ligne_differente
    FROM vivants v
)
SELECT o.name AS organisation, e.org_id,
       count(*) AS articles_vivants,
       count(*) FILTER (WHERE NOT e.avec_offre) AS sans_offre,
       count(*) FILTER (WHERE NOT e.avec_offre AND (e.cles_propres OR e.cles_lignes)) AS sans_offre_cles,
       count(*) FILTER (WHERE NOT e.avec_offre AND (e.cles_propres OR e.cles_lignes) AND NOT e.a_une_ligne) AS dont_jamais_ligne,
       count(*) FILTER (WHERE NOT e.avec_offre AND (e.cles_propres OR e.cles_lignes) AND e.a_une_ligne) AS dont_lignes_eteintes,
       count(*) FILTER (WHERE e.avec_offre AND e.cle_ligne_differente) AS avec_offre_cles_lignes
  FROM etat e
  LEFT JOIN core.organizations o ON o.id = e.org_id
 GROUP BY o.name, e.org_id
 ORDER BY articles_vivants DESC;
