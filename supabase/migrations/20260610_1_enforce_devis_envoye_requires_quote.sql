-- supabase/migrations/20260610_1_enforce_devis_envoye_requires_quote.sql
-- ============================================================================
-- Invariant pipeline : « Devis envoyé » interdit sans devis Pennylane rattaché
-- ============================================================================
-- Décision produit (2026-06-10, Eric) : pour une org Pennylane-enabled, un lead
-- ne PEUT PAS passer en statut « Devis envoyé » (display_order 4) sans au moins
-- un devis Pennylane actif rattaché (majordhome.lead_pennylane_quotes,
-- ejected_at IS NULL). Le rattachement reste 100% manuel (human-in-the-loop) ;
-- ce trigger est le filet de sécurité DB qui rend les cas HOULES/ARMESTO
-- impossibles quel que soit le chemin (drag kanban, fiche, futurs flux, API).
--
-- Compatibilité flux légitimes (vérifié) : les 2 RPCs qui basculent un lead en
-- « Devis envoyé » insèrent le devis AVANT de changer le statut, dans la même
-- transaction → le trigger voit la ligne lpq et ne bloque pas :
--   - public.lead_attach_quotes_and_send       (attache manuelle, étape 6 → 7)
--   - public.pennylane_sync_auto_attach_quote   (cron, INSERT → bump statut)
--
-- Scope : orgs Pennylane-enabled uniquement (orgs sans PL = flux devis MDH
-- classique conservé). UPDATE OF status_id uniquement → l'édition d'un lead
-- déjà en « Devis envoyé » n'est pas bloquée : les violateurs historiques
-- restent éditables et rapprochables à la main.
-- ============================================================================

CREATE OR REPLACE FUNCTION majordhome.enforce_devis_envoye_requires_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $$
DECLARE
  v_new_order int;
  v_pl_enabled bool;
BEGIN
  -- Uniquement sur une vraie transition de statut
  IF NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;

  -- display_order du statut cible
  SELECT display_order INTO v_new_order
  FROM majordhome.statuses
  WHERE id = NEW.status_id;

  -- On ne contraint QUE la transition vers « Devis envoyé » (display_order = 4)
  IF v_new_order IS DISTINCT FROM 4 THEN
    RETURN NEW;
  END IF;

  -- Invariant Pennylane uniquement (org sans PL = flux devis MDH classique)
  SELECT COALESCE((settings->'pennylane'->>'enabled')::bool, false)
    INTO v_pl_enabled
  FROM core.organizations
  WHERE id = NEW.org_id;

  IF NOT COALESCE(v_pl_enabled, false) THEN
    RETURN NEW;
  END IF;

  -- Au moins un devis Pennylane actif rattaché, sinon blocage
  IF NOT EXISTS (
    SELECT 1
    FROM majordhome.lead_pennylane_quotes q
    WHERE q.lead_id = NEW.id
      AND q.ejected_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Statut « Devis envoyé » interdit sans devis Pennylane rattaché (lead %)', NEW.id
      USING ERRCODE = 'check_violation',
            HINT = 'Rattache d''abord un devis via la modale « Passer en Devis envoyé ».';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION majordhome.enforce_devis_envoye_requires_quote() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_devis_envoye_requires_quote ON majordhome.leads;
CREATE TRIGGER trg_enforce_devis_envoye_requires_quote
  BEFORE UPDATE OF status_id ON majordhome.leads
  FOR EACH ROW
  EXECUTE FUNCTION majordhome.enforce_devis_envoye_requires_quote();

COMMENT ON FUNCTION majordhome.enforce_devis_envoye_requires_quote() IS
  'Invariant pipeline (2026-06-10) : interdit la transition d''un lead vers « Devis envoyé » (display_order 4) sans devis Pennylane actif rattaché, pour les orgs Pennylane-enabled. Filet DB du rapprochement manuel. Compatible lead_attach_quotes_and_send / pennylane_sync_auto_attach_quote (insertion du devis avant bascule du statut).';
