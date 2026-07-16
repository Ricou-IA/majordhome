-- supabase/migrations/20260716_1_quote_status_bucket_and_winning_trigger.sql
-- ============================================================================
-- Bug A — le trigger réécrivait le statut canonique Pennylane.
--
-- trg_lead_pennylane_quotes_invariant_winning forçait quote_status='accepted'
-- dès que is_winning_quote=true et que le statut sortait de {accepted,invoiced}.
-- Le cron écrivait le 'refused' lu dans PL, le trigger le réécrivait en
-- 'accepted' avant écriture : la valeur stockée ne changeait jamais et le cron
-- comptait l'opération comme réussie. Échec silencieux permanent.
-- Vu sur OBIERTI JEAN MARC : D-2026-07301 refusé dans PL, stocké 'accepted'.
--
-- Sémantique retenue (validée Eric, PL fait foi) :
--   refused|denied|canceled  -> PL dit non   : le statut passe, winning := false
--   null|pending|draft|expired -> PL ne sait pas : geste commercial préservé
--   accepted|invoiced        -> validé       : inchangé
-- ============================================================================

-- 1. Définition UNIQUE des 3 seaux de statut PL.
--    Reproduit à l'identique les allowlists de majordhome_kanban_cards.
--    Le seau 'other' préserve la décision documentée : tout statut PL futur
--    (ex. 'scheduled') reste invisible tant qu'il n'est pas ajouté ici.
CREATE OR REPLACE FUNCTION majordhome.quote_status_bucket(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_status IN ('accepted', 'invoiced')          THEN 'validated'
    WHEN p_status IN ('pending', 'draft', 'expired')   THEN 'pending'
    WHEN p_status IN ('refused', 'denied', 'canceled') THEN 'refused'
    ELSE 'other'
  END;
$$;

COMMENT ON FUNCTION majordhome.quote_status_bucket(text) IS
  'Seau d''un quote_status Pennylane : validated | pending | refused | other. Definition UNIQUE de l''allowlist, consommée par majordhome.lead_quote_stats, la vue pivot et le trigger invariant_winning. Ne pas recopier l''allowlist ailleurs. NOT SECURITY DEFINER, aucun accès aux données.';

-- 2. Trigger : PL fait foi sur un refus explicite.
CREATE OR REPLACE FUNCTION majordhome.lead_pennylane_quotes_invariant_winning()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'majordhome', 'public'
AS $function$
BEGIN
  -- Cas 1 — le statut CHANGE vers un refus explicite : c'est Pennylane qui
  -- parle (cron), PL gagne. Le flag gagnant saute.
  -- Discriminant OLD : « la RPC pose winning sur une ligne déjà refusée »
  -- (geste commercial) présente le même NEW mais ne change pas le statut.
  IF TG_OP = 'UPDATE'
     AND NEW.quote_status IS DISTINCT FROM OLD.quote_status
     AND majordhome.quote_status_bucket(NEW.quote_status) = 'refused' THEN
    NEW.is_winning_quote := false;

  -- Cas 2 — on pose/garde winning sur un statut non validé : geste commercial
  -- préservé (PL encore pending/draft/expired, ou pas encore synchro).
  -- Le cron réaligne sur PL au passage suivant (auto-correction <= 15 min).
  ELSIF NEW.is_winning_quote = true
     AND majordhome.quote_status_bucket(NEW.quote_status) <> 'validated' THEN
    NEW.quote_status := 'accepted';
  END IF;

  RETURN NEW;
END;
$function$;
