-- supabase/migrations/20260525_3_pennylane_sync_ensure_winning_quotes.sql
-- PR 5 — Cron pennylane-sync-quote-status
-- Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §9
--
-- RPC helper appelée par le cron toutes les 15 min.
-- Pour chaque lead avec ≥1 devis accepted ET aucun is_winning_quote=true,
-- pose is_winning_quote=true sur le plus récent (par pennylane_quote_id DESC).
-- Idempotent : ne touche pas aux leads qui ont déjà un winning.
-- service_role only (REVOKE anon + authenticated).

CREATE OR REPLACE FUNCTION public.pennylane_sync_ensure_winning_quotes(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
DECLARE
  v_updates int := 0;
  v_lead_id uuid;
  v_quote_id uuid;
BEGIN
  -- Pour chaque lead avec ≥1 accepted ET aucun is_winning_quote=true :
  --   poser is_winning_quote=true sur le plus récent accepted
  FOR v_lead_id IN
    SELECT DISTINCT lpq.lead_id
    FROM majordhome.lead_pennylane_quotes lpq
    WHERE lpq.org_id = p_org_id
      AND lpq.ejected_at IS NULL
      AND lpq.quote_status = 'accepted'
    EXCEPT
    SELECT DISTINCT lpq2.lead_id
    FROM majordhome.lead_pennylane_quotes lpq2
    WHERE lpq2.org_id = p_org_id
      AND lpq2.ejected_at IS NULL
      AND lpq2.is_winning_quote = true
  LOOP
    -- Sélectionner le plus récent par pennylane_quote_id (ID numérique croissant)
    SELECT id INTO v_quote_id
    FROM majordhome.lead_pennylane_quotes
    WHERE lead_id = v_lead_id
      AND org_id = p_org_id
      AND ejected_at IS NULL
      AND quote_status = 'accepted'
    ORDER BY pennylane_quote_id DESC
    LIMIT 1;

    IF v_quote_id IS NOT NULL THEN
      UPDATE majordhome.lead_pennylane_quotes
      SET is_winning_quote = true
      WHERE id = v_quote_id;
      v_updates := v_updates + 1;
    END IF;
  END LOOP;

  RETURN v_updates;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_ensure_winning_quotes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_ensure_winning_quotes(uuid) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_ensure_winning_quotes(uuid) IS
  'Pour chaque lead avec ≥1 devis accepted ET aucun winning posé, pose is_winning_quote=true sur le plus récent (pennylane_quote_id DESC). Idempotent. Appelée par le cron pennylane-sync-quote-status. service_role only.';
