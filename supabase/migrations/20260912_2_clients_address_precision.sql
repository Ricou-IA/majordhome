-- 20260912_2_clients_address_precision.sql
-- ============================================================================
-- Adresse BAN à la saisie : précision de la localisation d'un client + RPC
-- d'écriture des coordonnées choisies + étage « commune » du balayage.
-- Spec : docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md §4.1
--
-- Pourquoi une RPC et pas un UPDATE via la vue majordhome_clients : la vue
-- n'expose pas (encore) `address_precision` et sa définition n'est pas versionnée
-- dans le repo — on n'y touche pas ; l'écriture passe par une RPC SECURITY
-- DEFINER à garde positive (membership), comme les autres écritures sensibles.
-- ============================================================================

-- 1) Précision de la localisation : housenumber | street | locality | municipality.
--    NULL = géocodé par l'ancien chemin (précision inconnue).
ALTER TABLE majordhome.clients
  ADD COLUMN IF NOT EXISTS address_precision text;

ALTER TABLE majordhome.clients
  DROP CONSTRAINT IF EXISTS clients_address_precision_check;
ALTER TABLE majordhome.clients
  ADD CONSTRAINT clients_address_precision_check
  CHECK (address_precision IS NULL OR address_precision IN ('housenumber', 'street', 'locality', 'municipality'));

COMMENT ON COLUMN majordhome.clients.address_precision IS
  'Precision BAN de latitude/longitude : housenumber | street | locality | municipality. NULL = inconnue (ancien geocodage).';

-- 2) Le trigger existant (20260617_1) remet les coordonnées à NULL quand
--    l'adresse change ; la précision suit le même sort — sinon une adresse
--    retapée à la main garderait « housenumber » alors qu'elle n'est plus
--    localisée. Condition INCHANGÉE : les coordonnées BAN sont écrites par un
--    2e UPDATE (client_set_location), après l'adresse.
CREATE OR REPLACE FUNCTION majordhome.reset_geocode_on_address_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'majordhome', 'public', 'core', 'pg_temp'
AS $function$
BEGIN
  IF (
    COALESCE(NEW.address, '') IS DISTINCT FROM COALESCE(OLD.address, '') OR
    COALESCE(NEW.postal_code, '') IS DISTINCT FROM COALESCE(OLD.postal_code, '') OR
    COALESCE(NEW.city, '') IS DISTINCT FROM COALESCE(OLD.city, '')
  ) THEN
    NEW.latitude := NULL;
    NEW.longitude := NULL;
    NEW.geocoded_at := NULL;
    NEW.geocode_attempts := 0;
    NEW.address_precision := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) Écriture des coordonnées choisies à la saisie (BAN). Membership positive :
--    `IS NOT TRUE` refuse aussi un NULL (charte multi-tenant).
CREATE OR REPLACE FUNCTION public.client_set_location(
  p_client_id uuid,
  p_lat       numeric,
  p_lng       numeric,
  p_precision text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_org    uuid;
  v_member boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'Coordonnees requises' USING ERRCODE = '22023';
  END IF;
  IF p_precision IS NOT NULL
     AND p_precision NOT IN ('housenumber', 'street', 'locality', 'municipality') THEN
    RAISE EXCEPTION 'Precision invalide: %', p_precision USING ERRCODE = '22023';
  END IF;

  SELECT org_id INTO v_org FROM majordhome.clients WHERE id = p_client_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Client % introuvable', p_client_id USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM core.organization_members
    WHERE user_id = auth.uid() AND org_id = v_org
  ) INTO v_member;
  IF v_member IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE majordhome.clients
     SET latitude          = p_lat,
         longitude         = p_lng,
         geocoded_at       = now(),
         geocode_attempts  = 0,
         address_precision = p_precision
   WHERE id = p_client_id AND org_id = v_org;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.client_set_location(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.client_set_location(uuid, numeric, numeric, text) TO authenticated;

-- 4) Le balayage (edge geocode-sweep) peut désormais poser la précision —
--    en particulier « municipality » quand seule la commune est reconnue.
--    p_rows : [{ "id": uuid, "lat": number|null, "lng": number|null, "precision"?: text }]
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
        SET latitude          = (r->>'lat')::numeric,
            longitude         = (r->>'lng')::numeric,
            geocoded_at       = now(),
            geocode_attempts  = COALESCE(geocode_attempts, 0) + 1,
            address_precision = COALESCE(r->>'precision', address_precision)
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
GRANT  EXECUTE ON FUNCTION public.geocode_apply_client_coordinates(jsonb) TO service_role;

-- Vérifications (après application) :
--   SELECT has_function_privilege('anon', 'public.client_set_location(uuid, numeric, numeric, text)', 'EXECUTE');  -- false
--   BEGIN;
--   UPDATE majordhome.clients SET address = address || ' '
--    WHERE id = (SELECT id FROM majordhome.clients WHERE latitude IS NOT NULL LIMIT 1)
--   RETURNING latitude, address_precision;   -- NULL, NULL : le trigger remet bien à zéro
--   ROLLBACK;
