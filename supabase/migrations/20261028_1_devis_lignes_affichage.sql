-- 20261028_1_devis_lignes_affichage.sql
-- Devis : affichage par ligne (spec docs/superpowers/specs/ — référence interne, caractéristiques et description par ligne,
-- détail des prix par chapitre, 2026-10-26). Trois colonnes sur majordhome.quote_lines :
--   hide_prices      : masque prix unitaire / total de CETTE ligne dans le document client (le total du chapitre reste porté
--                      par la ligne « détail » ou le sous-total, la ligne ne disparaît jamais du calcul) ;
--   show_specs       : affiche les caractéristiques de la ligne sous sa désignation dans le document client ;
--   caracteristiques : liste de lignes de texte libres (« Puissance : 8 kW »), vide par défaut.
-- Colonnes ajoutées EN FIN des deux vues (CREATE OR REPLACE VIEW n'autorise l'ajout qu'en fin de liste) : après
-- catalog_item_id, brand, discount_percent (20261027_8). Droits des vues inchangés (CREATE OR REPLACE les conserve).

ALTER TABLE majordhome.quote_lines
  ADD COLUMN IF NOT EXISTS hide_prices boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_specs boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS caracteristiques text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE VIEW public.majordhome_quote_lines WITH (security_invoker = true) AS
  SELECT ql.id, ql.quote_id, ql.sort_order, ql.line_type, ql.supplier_product_id, ql.supplier_id, ql.designation, ql.description,
         ql.reference, ql.quantity, ql.unit, ql.purchase_price_ht, ql.unit_price_ht, ql.tva_rate, ql.total_ht, ql.total_tva,
         ql.total_ttc, ql.created_at, s.name AS supplier_name, ql.catalog_item_id, ql.brand, ql.discount_percent,
         ql.hide_prices, ql.show_specs, ql.caracteristiques
  FROM majordhome.quote_lines ql
  LEFT JOIN majordhome.suppliers s ON s.id = ql.supplier_id;

CREATE OR REPLACE VIEW public.majordhome_quote_lines_write WITH (security_invoker = true) AS
  SELECT id, quote_id, sort_order, line_type, supplier_product_id, supplier_id, designation, description, reference, quantity,
         unit, purchase_price_ht, unit_price_ht, tva_rate, total_ht, total_tva, total_ttc, created_at, catalog_item_id, brand,
         discount_percent, hide_prices, show_specs, caracteristiques
  FROM majordhome.quote_lines;
