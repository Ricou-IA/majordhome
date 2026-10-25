-- 20261027_7_photo_articles_fusionnes_avant.sql
-- Rattrapage : la recopie de la photo d'une ligne fournisseur vers son article (au rattachement et à la fusion) date de
-- 20261027_2. Un article fusionné AVANT garde une photo vide alors qu'une de ses lignes en a une (constat d'Eric,
-- 2026-10-25 : « Borne rapide DC V2C Denka 20 kW », survivant ECOSTAL sans photo, photo portée par la ligne BayWa).
-- Pose la photo de la ligne active la plus récemment mise à jour. Rejouable : ne touche qu'un article sans photo.
UPDATE majordhome.catalog_items i
SET image_url = (
      SELECT p.image_url FROM majordhome.supplier_products p
      WHERE p.catalog_item_id = i.id AND p.is_active AND p.image_url IS NOT NULL
      ORDER BY p.updated_at DESC NULLS LAST LIMIT 1),
    updated_at = now()
WHERE i.is_active AND i.merged_into IS NULL AND i.image_url IS NULL
  AND EXISTS (SELECT 1 FROM majordhome.supplier_products p
              WHERE p.catalog_item_id = i.id AND p.is_active AND p.image_url IS NOT NULL);
