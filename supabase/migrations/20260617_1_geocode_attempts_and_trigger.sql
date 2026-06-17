-- 20260617_1_geocode_attempts_and_trigger.sql
-- Compteur anti-retry pour le balayage de géocodage + reset à 0 quand l'adresse change.

ALTER TABLE majordhome.clients
  ADD COLUMN IF NOT EXISTS geocode_attempts smallint NOT NULL DEFAULT 0;

-- Le trigger BEFORE UPDATE existant remet déjà lat/lng/geocoded_at à NULL quand
-- l'adresse change. On ajoute le reset du compteur (1 ligne) pour qu'un ré-adressage
-- relance le géocodage même après 3 échecs.
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
  END IF;
  RETURN NEW;
END;
$function$;
