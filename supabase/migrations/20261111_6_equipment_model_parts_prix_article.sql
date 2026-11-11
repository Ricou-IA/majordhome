-- 20261111_6_equipment_model_parts_prix_article.sql
-- Relecture de la tranche 3 : le prix de vente d'une pièce posée dans un devis depuis le bloc « Pièces détachées »
-- doit être celui de l'ARTICLE (celui qu'on ajuste dans la fiche article, celui que prend la recherche d'articles du
-- devis), pas celui de la ligne fournisseur — les deux peuvent diverger. La vue l'expose, EN FIN de liste.
CREATE OR REPLACE VIEW public.majordhome_equipment_model_parts WITH (security_invoker = true) AS
  SELECT mp.id, mp.org_id, mp.equipment_model_id, mp.position, mp.repere, mp.quantity, mp.notes,
         mp.supplier_product_id,
         sp.reference AS piece_reference,
         sp.name AS piece_name,
         COALESCE(mp.public_price_ht, NULLIF(sp.tarif_public, 0)) AS prix_public_ht,
         sp.selling_price_ht,
         sp.unit,
         sp.catalog_item_id,
         sp.is_active AS piece_active,
         sp.image_url AS piece_image_url,
         sp.specs -> 'canonical' ->> 'cycle_de_vie' AS cycle_de_vie,
         sp.specs -> 'canonical' ->> 'remplacee_par' AS remplacee_par,
         COALESCE((sp.specs -> 'canonical' ->> 'kit')::boolean, false) AS kit,
         COALESCE((sp.specs -> 'canonical' ->> 'vendue_seule')::boolean, true) AS vendue_seule,
         COALESCE((sp.specs -> 'canonical' ->> 'prix_selon_appareil')::boolean, false) AS prix_selon_appareil,
         sp.purchase_price_ht,
         sp.taux_remise,
         ci.selling_price_ht AS article_selling_price_ht
  FROM majordhome.equipment_model_parts mp
  JOIN majordhome.supplier_products sp ON sp.id = mp.supplier_product_id
  LEFT JOIN majordhome.catalog_items ci ON ci.id = sp.catalog_item_id;
REVOKE ALL ON public.majordhome_equipment_model_parts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_equipment_model_parts TO authenticated, service_role;
