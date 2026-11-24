-- 20261124_2_catalog_items_recherche_rangee.sql
-- ============================================================================
-- Recherche d'articles hors délai (constaté le 2026-11-24) : « Importer une offre fournisseur » dans un devis ne
-- s'ouvrait plus. La vue majordhome_catalog_items_list calculait `recherche` (libellé + marque + gamme + clés +
-- références et marques de TOUTES les lignes fournisseur) et les offres en agrégeant les 31 000 lignes fournisseur
-- de TOUS les articles avant de filtrer : 3,7 s par recherche sans même la RLS, et l'import en lance une par ligne
-- du PDF (≈ 20 à la fois) ⇒ « canceling statement due to statement timeout », HTTP 500, bouton jamais ouvert.
-- La vue n'avait pas changé depuis le 2026-10-28 : c'est le volume (26 700 articles depuis les relevés de pièces)
-- qui l'a fait passer au-delà du délai.
--
-- Correctif :
--   1. majordhome.catalog_items.recherche = le MÊME texte qu'avant (majordhome.catalog_item_texte, formule de la vue
--      recopiée telle quelle), rangé sur l'article et tenu à jour par la base seule :
--        - BEFORE INSERT / UPDATE OF (libellé, marque, gamme, clé modèle, EAN, référence interne) sur catalog_items ;
--        - AFTER INSERT / UPDATE / DELETE (par instruction, tables de transition) sur supplier_products : les
--          articles touchés sont recalculés en UNE requête (aucune jointure entre tables de transition : cf. incident
--          du 2026-10-25, espace temporaire saturé par une jointure sans index).
--      Aucun droit d'écriture n'est donné sur la colonne (l'UPDATE par colonne d'`authenticated` ne la cite pas).
--   2. La vue lit cette colonne et calcule les offres par article (LEFT JOIN LATERAL) : seulement pour les lignes
--      que la requête retient. Colonnes, ordre et types inchangés ; ACL conservée par CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION majordhome.catalog_item_texte(
  p_name text, p_brand text, p_gamme text, p_model_key text, p_code_ean text, p_code text, p_refs text
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT translate(lower(concat_ws(' ', p_name, p_brand, p_gamme, p_model_key, p_code_ean, p_code, p_refs)),
                   'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy');
$$;

-- Références et marques des lignes fournisseur d'un article (toutes, actives ou non : même périmètre qu'avant).
CREATE OR REPLACE FUNCTION majordhome.catalog_item_refs(p_item uuid) RETURNS text
LANGUAGE sql STABLE
SET search_path = majordhome, pg_catalog
AS $$
  SELECT string_agg(DISTINCT concat_ws(' ', p.reference, p.brand), ' ')
    FROM majordhome.supplier_products p
    JOIN majordhome.suppliers s ON s.id = p.supplier_id
   WHERE p.catalog_item_id = p_item;
$$;

ALTER TABLE majordhome.catalog_items ADD COLUMN IF NOT EXISTS recherche text;

-- Recalcule le texte des articles donnés (n'écrit que ce qui change). SECURITY DEFINER : appelée par les déclencheurs
-- de supplier_products, dont l'auteur (relevé, fiche fournisseur) n'a pas le droit d'écrire cette colonne.
CREATE OR REPLACE FUNCTION majordhome.catalog_items_recherche_recalculer(p_ids uuid[]) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = majordhome, pg_catalog
AS $$
  UPDATE majordhome.catalog_items i
     SET recherche = t.texte
    FROM (
      SELECT c.id, majordhome.catalog_item_texte(c.name, c.brand, c.gamme, c.model_key, c.code_ean, c.code, majordhome.catalog_item_refs(c.id)) AS texte
        FROM majordhome.catalog_items c
       WHERE c.id = ANY (p_ids)
    ) t
   WHERE i.id = t.id AND i.recherche IS DISTINCT FROM t.texte;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.catalog_items_recherche_recalculer(uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION majordhome.catalog_items_recherche_avant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = majordhome, pg_catalog
AS $$
BEGIN
  NEW.recherche := majordhome.catalog_item_texte(NEW.name, NEW.brand, NEW.gamme, NEW.model_key, NEW.code_ean, NEW.code,
                                                 majordhome.catalog_item_refs(NEW.id));
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.catalog_items_recherche_avant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_catalog_items_recherche ON majordhome.catalog_items;
CREATE TRIGGER trg_catalog_items_recherche
  BEFORE INSERT OR UPDATE OF name, brand, gamme, model_key, code_ean, code ON majordhome.catalog_items
  FOR EACH ROW EXECUTE FUNCTION majordhome.catalog_items_recherche_avant();

-- Lignes fournisseur : un déclencheur par évènement (une table de transition par déclencheur).
CREATE OR REPLACE FUNCTION majordhome.supplier_products_recherche_apres() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = majordhome, pg_catalog
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT catalog_item_id) INTO v_ids FROM nouvelles WHERE catalog_item_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT catalog_item_id) INTO v_ids FROM anciennes WHERE catalog_item_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT x) INTO v_ids FROM (
      SELECT catalog_item_id AS x FROM nouvelles WHERE catalog_item_id IS NOT NULL
      UNION
      SELECT catalog_item_id FROM anciennes WHERE catalog_item_id IS NOT NULL
    ) a;
  END IF;
  IF v_ids IS NOT NULL THEN PERFORM majordhome.catalog_items_recherche_recalculer(v_ids); END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.supplier_products_recherche_apres() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_supplier_products_recherche_ins ON majordhome.supplier_products;
DROP TRIGGER IF EXISTS trg_supplier_products_recherche_upd ON majordhome.supplier_products;
DROP TRIGGER IF EXISTS trg_supplier_products_recherche_del ON majordhome.supplier_products;
CREATE TRIGGER trg_supplier_products_recherche_ins AFTER INSERT ON majordhome.supplier_products
  REFERENCING NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION majordhome.supplier_products_recherche_apres();
CREATE TRIGGER trg_supplier_products_recherche_upd AFTER UPDATE ON majordhome.supplier_products
  REFERENCING OLD TABLE AS anciennes NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION majordhome.supplier_products_recherche_apres();
CREATE TRIGGER trg_supplier_products_recherche_del AFTER DELETE ON majordhome.supplier_products
  REFERENCING OLD TABLE AS anciennes FOR EACH STATEMENT EXECUTE FUNCTION majordhome.supplier_products_recherche_apres();

-- Reprise : tous les articles existants (une requête).
UPDATE majordhome.catalog_items c
   SET recherche = majordhome.catalog_item_texte(c.name, c.brand, c.gamme, c.model_key, c.code_ean, c.code, r.refs)
  FROM (
    SELECT p.catalog_item_id, string_agg(DISTINCT concat_ws(' ', p.reference, p.brand), ' ') AS refs
      FROM majordhome.supplier_products p JOIN majordhome.suppliers s ON s.id = p.supplier_id
     WHERE p.catalog_item_id IS NOT NULL
     GROUP BY p.catalog_item_id
  ) r
 WHERE r.catalog_item_id = c.id;
UPDATE majordhome.catalog_items c
   SET recherche = majordhome.catalog_item_texte(c.name, c.brand, c.gamme, c.model_key, c.code_ean, c.code, NULL)
 WHERE c.recherche IS NULL;

CREATE OR REPLACE VIEW public.majordhome_catalog_items_list WITH (security_invoker = true) AS
 SELECT i.id,
    i.org_id,
    i.name,
    i.brand,
    i.model_key,
    i.code_ean,
    i.category,
    i.gamme,
    i.product_kind,
    i.unit,
    i.default_tva_rate,
    i.selling_price_ht,
    i.description,
    i.image_url,
    i.specs,
    i.is_active,
    i.source_product_id,
    i.origin,
    i.merged_into,
    i.created_at,
    i.updated_at,
    (COALESCE(o.offres_actives, (0)::bigint))::integer AS offres_actives,
    (COALESCE(o.offres_total, (0)::bigint))::integer AS offres_total,
    o.meilleur_prix_achat,
    COALESCE(o.fournisseurs, ARRAY[]::text[]) AS fournisseurs,
    o.prix_le_plus_recent,
    i.recherche,
    i.code
   FROM majordhome.catalog_items i
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE (p.is_active AND s.is_active)) AS offres_actives,
              count(*) AS offres_total,
              min(p.purchase_price_ht) FILTER (WHERE (p.is_active AND s.is_active AND (p.purchase_price_ht > (0)::numeric))) AS meilleur_prix_achat,
              array_agg(DISTINCT s.name) FILTER (WHERE (p.is_active AND s.is_active)) AS fournisseurs,
              max(p.purchase_price_at) FILTER (WHERE (p.is_active AND s.is_active)) AS prix_le_plus_recent
         FROM majordhome.supplier_products p
         JOIN majordhome.suppliers s ON s.id = p.supplier_id
        WHERE p.catalog_item_id = i.id
     ) o ON true;

REVOKE ALL ON public.majordhome_catalog_items_list FROM anon;
