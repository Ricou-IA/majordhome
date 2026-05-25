-- supabase/migrations/20260525_6_lpq_invariant_winning_trigger.sql
-- Bug #7 garde-fou — Trigger BEFORE INSERT/UPDATE qui enforce l'invariant
-- "is_winning_quote=true ⟹ quote_status ∈ {accepted, invoiced}".
--
-- Préserve le geste commercial (winning = décision business MDH) en forçant
-- quote_status='accepted' si une RPC ou un cron tente de poser winning=true
-- sur un statut incompatible (expired/refused/pending/null).
--
-- Avant ce fix : 5 lignes en DB avec winning=true ET statut incompatible (4
-- invoiced + 1 expired) — héritage backfill 2026-05-01. La migration data
-- associée (20260525_7) normalise l'état actuel ; ce trigger empêche la
-- régression future.
--
-- Spec : docs/superpowers/specs/2026-05-25-bug7-quote-status-sync-design.md §4

CREATE OR REPLACE FUNCTION majordhome.lead_pennylane_quotes_invariant_winning()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = majordhome, public
AS $$
BEGIN
  IF NEW.is_winning_quote = true
     AND (NEW.quote_status IS NULL OR NEW.quote_status NOT IN ('accepted','invoiced')) THEN
    NEW.quote_status := 'accepted';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION majordhome.lead_pennylane_quotes_invariant_winning() IS
  'Bug #7 garde-fou : enforce is_winning_quote=true ⟹ quote_status ∈ {accepted,invoiced}. Préserve le geste commercial en forçant accepted si statut incompatible.';

DROP TRIGGER IF EXISTS trg_lead_pennylane_quotes_invariant_winning ON majordhome.lead_pennylane_quotes;

CREATE TRIGGER trg_lead_pennylane_quotes_invariant_winning
BEFORE INSERT OR UPDATE OF is_winning_quote, quote_status
ON majordhome.lead_pennylane_quotes
FOR EACH ROW
EXECUTE FUNCTION majordhome.lead_pennylane_quotes_invariant_winning();
