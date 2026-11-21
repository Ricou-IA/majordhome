-- 20261121_14_geocode_file_equitable.sql
-- File de géocodage équitable entre entreprises. Le balayage (edge geocode-sweep, cron de 30 min) prend les
-- fiches 100 par 100, les plus anciennes d'abord, toutes entreprises mêlées : l'import de 3 000 fiches par
-- une entreprise ferait attendre une quinzaine d'heures les nouvelles fiches des autres. Ici, chaque lot est
-- partagé entre les entreprises qui ont des fiches en attente : la plus ancienne de chacune, puis la
-- deuxième de chacune, etc. Seul l'ordre change : même signature, mêmes colonnes rendues, mêmes conditions.
-- Égalité de rang : created_at, puis id (sortie déterministe).

CREATE OR REPLACE FUNCTION public.geocode_fetch_pending_clients(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, address text, postal_code text, city text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = majordhome, public
AS $function$
  SELECT f.id, f.address, f.postal_code, f.city
  FROM (
    SELECT c.id, c.address, c.postal_code, c.city, c.created_at,
           row_number() OVER (PARTITION BY c.org_id ORDER BY c.created_at ASC NULLS LAST, c.id) AS rang
    FROM majordhome.clients c
    WHERE c.geocoded_at IS NULL
      AND COALESCE(c.is_archived, false) = false
      AND COALESCE(c.postal_code, '') <> ''
      AND (COALESCE(c.address, '') <> '' OR COALESCE(c.city, '') <> '')
      AND COALESCE(c.geocode_attempts, 0) < 3
  ) f
  ORDER BY f.rang, f.created_at ASC NULLS LAST, f.id
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

-- Droits : CREATE OR REPLACE les conserve ; réémis à l'identique de 20260617_2 (service_role seul).
REVOKE EXECUTE ON FUNCTION public.geocode_fetch_pending_clients(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geocode_fetch_pending_clients(int) TO service_role;
