-- 20260617_2_geocode_sweep_rpcs.sql
-- RPCs du balayage de géocodage. service_role only (prennent/écrivent des données
-- clients sans dériver l'org d'auth.uid()).

-- 1) Lire un lot de clients à géocoder
CREATE OR REPLACE FUNCTION public.geocode_fetch_pending_clients(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, address text, postal_code text, city text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = majordhome, public
AS $function$
  SELECT c.id, c.address, c.postal_code, c.city
  FROM majordhome.clients c
  WHERE c.geocoded_at IS NULL
    AND COALESCE(c.is_archived, false) = false
    AND COALESCE(c.postal_code, '') <> ''
    AND (COALESCE(c.address, '') <> '' OR COALESCE(c.city, '') <> '')
    AND COALESCE(c.geocode_attempts, 0) < 3
  ORDER BY c.created_at ASC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

REVOKE EXECUTE ON FUNCTION public.geocode_fetch_pending_clients(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geocode_fetch_pending_clients(int) TO service_role;

-- 2) Appliquer les coordonnées (et incrémenter le compteur de tentatives)
-- p_rows : [{ "id": uuid, "lat": number|null, "lng": number|null }]
-- COALESCE strict : on n'écrit lat/lng QUE si non nuls (jamais d'écrasement par NULL).
CREATE OR REPLACE FUNCTION public.geocode_apply_client_coordinates(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $function$
DECLARE
  r jsonb;
  n int := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    IF (r->>'lat') IS NOT NULL AND (r->>'lng') IS NOT NULL THEN
      UPDATE majordhome.clients
        SET latitude = (r->>'lat')::numeric,
            longitude = (r->>'lng')::numeric,
            geocoded_at = now(),
            geocode_attempts = COALESCE(geocode_attempts, 0) + 1
      WHERE id = (r->>'id')::uuid;
      n := n + 1;
    ELSE
      UPDATE majordhome.clients
        SET geocode_attempts = COALESCE(geocode_attempts, 0) + 1
      WHERE id = (r->>'id')::uuid;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.geocode_apply_client_coordinates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geocode_apply_client_coordinates(jsonb) TO service_role;
