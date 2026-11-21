-- 20261121_9 — un lead ne reçoit qu'un commercial de SA propre organisation
--
-- `leads.assigned_user_id` (id de `majordhome.commercials`) n'a ni clé étrangère ni contrôle :
-- toute voie d'écriture (fiche lead, attribution par zone, RPC, webhook) pouvait poser le
-- commercial d'une autre entreprise. Côté application, l'attribution par zone lisait le
-- commercial sans filtrer l'organisation, avec un cache par nom de zone (corrigé le même jour).
-- Mesuré avant : 658 leads attribués, 0 commercial inconnu, 0 commercial d'une autre organisation.
--
-- Garde POSITIVE, à l'insertion et au changement de commercial seulement (les autres écritures
-- d'un lead ne sont pas concernées). Retirer le commercial (NULL) reste permis.

CREATE OR REPLACE FUNCTION majordhome.lead_commercial_meme_organisation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = majordhome, pg_temp
AS $$
BEGIN
  IF NEW.assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.assigned_user_id IS NOT DISTINCT FROM OLD.assigned_user_id
     AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id THEN
    RETURN NEW;
  END IF;
  IF (EXISTS (
        SELECT 1 FROM majordhome.commercials c
        WHERE c.id = NEW.assigned_user_id AND c.org_id = NEW.org_id
      )) IS NOT TRUE THEN
    RAISE EXCEPTION 'commercial_autre_organisation'
      USING HINT = 'Le commercial attribué à un lead doit appartenir à l''organisation du lead.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION majordhome.lead_commercial_meme_organisation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_commercial_meme_organisation ON majordhome.leads;
CREATE TRIGGER trg_lead_commercial_meme_organisation
  BEFORE INSERT OR UPDATE ON majordhome.leads
  FOR EACH ROW EXECUTE FUNCTION majordhome.lead_commercial_meme_organisation();
