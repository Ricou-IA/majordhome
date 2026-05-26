-- supabase/migrations/20260526_12_pennylane_sync_update_quote_fields.sql
-- Nouvelle RPC interne service_role : update batch des fields synchronisables
-- depuis le cron pennylane-sync-quote-status (status + pdf_url).
-- COALESCE strict pour ne jamais vider une valeur existante avec NULL.
-- Appelée à chaque devis actif au sync (pas seulement quand status change),
-- pour backfill pdf_url des 152 lignes historiques en 1 cycle cron.
--
-- Remplace l'usage de pennylane_sync_update_quote_status côté cron
-- (l'ancienne RPC reste disponible pour rétrocompat, mais le cron n'y appelle
-- plus à partir de 2026-05-26).

CREATE OR REPLACE FUNCTION public.pennylane_sync_update_quote_fields(
  p_quote_id uuid,
  p_new_status text,
  p_pdf_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
BEGIN
  UPDATE majordhome.lead_pennylane_quotes
  SET
    quote_status = COALESCE(NULLIF(p_new_status, ''), quote_status),
    pdf_url      = COALESCE(NULLIF(p_pdf_url, ''), pdf_url)
  WHERE id = p_quote_id
    AND (
      quote_status IS DISTINCT FROM COALESCE(NULLIF(p_new_status, ''), quote_status)
      OR pdf_url IS DISTINCT FROM COALESCE(NULLIF(p_pdf_url, ''), pdf_url)
    );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text) IS
  'Sync batch des fields modifiables (quote_status + pdf_url) depuis le cron pennylane-sync-quote-status. service_role only. COALESCE strict (jamais vider). Idempotent (no-op si rien à changer).';
