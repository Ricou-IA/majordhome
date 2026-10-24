-- 20261025_1_catalogue_rpc_categories.sql
-- Familles de devis multi-catégories (spec 2026-10-24-catalogue-photovoltaique-connexion-generique § 3.3) : un devis
-- Photovoltaïque pioche aussi des batteries. Surcharges « tableau » des trois lectures catalogue du picker, mêmes corps
-- que les versions texte (get_suppliers_by_category / get_distinct_gammes / get_distinct_diametres), filtre
-- `LOWER(category) = ANY (p_categories)`. STABLE, security invoker (RLS des tables), REVOKE anon (charte).

CREATE OR REPLACE FUNCTION public.get_suppliers_by_categories(p_org_id uuid, p_categories text[])
RETURNS TABLE(id uuid, name text, org_id uuid, product_count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $$
  SELECT s.id, s.name, s.org_id, count(sp.id) AS product_count
  FROM majordhome.suppliers s
  JOIN majordhome.supplier_products sp ON sp.supplier_id = s.id AND sp.is_active = true
  WHERE s.org_id = p_org_id AND s.is_active = true
    AND LOWER(sp.category) = ANY (SELECT LOWER(c) FROM unnest(p_categories) AS c)
  GROUP BY s.id, s.name, s.org_id
  ORDER BY s.name;
$$;
REVOKE EXECUTE ON FUNCTION public.get_suppliers_by_categories(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_suppliers_by_categories(uuid, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_distinct_gammes(p_supplier_id uuid, p_categories text[])
RETURNS TABLE(gamme text)
LANGUAGE sql STABLE
SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $$
  SELECT DISTINCT sp.gamme
  FROM majordhome.supplier_products sp
  WHERE sp.supplier_id = p_supplier_id AND sp.is_active = true AND sp.gamme IS NOT NULL
    AND LOWER(sp.category) = ANY (SELECT LOWER(c) FROM unnest(p_categories) AS c)
  ORDER BY sp.gamme;
$$;
REVOKE EXECUTE ON FUNCTION public.get_distinct_gammes(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_distinct_gammes(uuid, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_distinct_diametres(p_supplier_id uuid, p_gamme text, p_categories text[])
RETURNS TABLE(diametre text)
LANGUAGE sql STABLE
SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $$
  SELECT DISTINCT sp.diametre
  FROM majordhome.supplier_products sp
  WHERE sp.supplier_id = p_supplier_id AND sp.is_active = true AND sp.diametre IS NOT NULL
    AND (p_gamme IS NULL OR sp.gamme = p_gamme)
    AND LOWER(sp.category) = ANY (SELECT LOWER(c) FROM unnest(p_categories) AS c)
  ORDER BY sp.diametre;
$$;
REVOKE EXECUTE ON FUNCTION public.get_distinct_diametres(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_distinct_diametres(uuid, text, text[]) TO authenticated, service_role;
