-- 20261027_8_remise_ligne_devis.sql
-- Remise à la ligne sur un devis (demande d'Eric, 2026-10-25) : quote_lines.discount_percent (0 à 100, défaut 0).
-- total_ht de la ligne = quantité × prix unitaire × (1 − remise) — calculé par src/lib/devisCalculs.js et stocké ;
-- la remise globale du devis reste appliquée ensuite, au total. Envoyée à Pennylane en remise de ligne relative.
-- Colonne ajoutée EN FIN des deux vues (CREATE OR REPLACE VIEW n'autorise l'ajout qu'en fin de liste).

ALTER TABLE majordhome.quote_lines
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_lines_discount_percent_check') THEN
    ALTER TABLE majordhome.quote_lines
      ADD CONSTRAINT quote_lines_discount_percent_check CHECK (discount_percent >= 0 AND discount_percent <= 100);
  END IF;
END $$;

CREATE OR REPLACE VIEW public.majordhome_quote_lines WITH (security_invoker = true) AS
  SELECT ql.id, ql.quote_id, ql.sort_order, ql.line_type, ql.supplier_product_id, ql.supplier_id, ql.designation, ql.description,
         ql.reference, ql.quantity, ql.unit, ql.purchase_price_ht, ql.unit_price_ht, ql.tva_rate, ql.total_ht, ql.total_tva,
         ql.total_ttc, ql.created_at, s.name AS supplier_name, ql.catalog_item_id, ql.brand, ql.discount_percent
  FROM majordhome.quote_lines ql
  LEFT JOIN majordhome.suppliers s ON s.id = ql.supplier_id;

CREATE OR REPLACE VIEW public.majordhome_quote_lines_write WITH (security_invoker = true) AS
  SELECT id, quote_id, sort_order, line_type, supplier_product_id, supplier_id, designation, description, reference, quantity,
         unit, purchase_price_ht, unit_price_ht, tva_rate, total_ht, total_tva, total_ttc, created_at, catalog_item_id, brand,
         discount_percent
  FROM majordhome.quote_lines;
