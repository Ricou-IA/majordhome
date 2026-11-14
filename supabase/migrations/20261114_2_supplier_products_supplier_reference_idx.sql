-- 20261114_2_supplier_products_supplier_reference_idx.sql — index (supplier_id, reference) sur majordhome.supplier_products.
--
-- Constat (production, 2026-11-14) : le premier relevé du catalogue de pièces d'Energies Bois Distribution a été refusé
-- deux fois, `ecriture_refusee` / « canceling statement due to statement timeout ». L'edge supplier-catalog-sync écrit
-- par PostgREST, donc sous le délai de 8 s du rôle authenticator (service_role n'a pas de délai propre).
--
-- Cause mesurée : `catalog_items_ensure` (appelée en fin de supplier_catalog_upsert) cherche, pour CHAQUE ligne sans
-- article, une autre ligne du même fournisseur et de même référence. Aucun index ne servait cette recherche (le seul
-- index (supplier_id, reference) est partiel, `WHERE specs ? 'source_version'`, et la requête ne reprend pas ce
-- prédicat) : lecture complète des 28 389 lignes, 13,7 ms par pièce. Essai annulé de 119 pièces : 2 017 ms, dont
-- ≈ 1 630 ms pour cette seule recherche. Un premier relevé de quelques centaines de pièces dépasse donc 8 s.
-- Les relevés suivants (mises à jour, plus aucune ligne sans article) n'étaient pas touchés, d'où BayWa sans erreur.
--
-- L'index sert aussi les jointures `p.supplier_id = … AND p.reference = t.reference` de supplier_catalog_upsert et de
-- supplier_pieces_upsert. Création non concurrente : 28 000 lignes, verrou de moins d'une seconde.
--
-- Retour arrière : DROP INDEX IF EXISTS majordhome.supplier_products_supplier_reference_idx;

CREATE INDEX IF NOT EXISTS supplier_products_supplier_reference_idx
  ON majordhome.supplier_products (supplier_id, reference);
