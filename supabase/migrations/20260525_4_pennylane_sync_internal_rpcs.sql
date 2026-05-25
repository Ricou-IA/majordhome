-- supabase/migrations/20260525_4_pennylane_sync_internal_rpcs.sql
-- PR 5 fix — RPCs internes pour les writes de l'edge function pennylane-sync-quote-status
-- Pattern obligatoire : .schema('majordhome').from() ne fonctionne PAS côté edge function
-- (PostgREST renvoie "Invalid schema: majordhome"). Ces RPCs SECURITY DEFINER wrappent
-- les 3 writes qui nécessitaient ce pattern cassé.
-- Toutes service_role only (REVOKE PUBLIC, anon, authenticated).

-- Eject a quote (used by cron when PL returns 404)
CREATE OR REPLACE FUNCTION public.pennylane_sync_eject_quote(
  p_quote_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
BEGIN
  UPDATE majordhome.lead_pennylane_quotes
  SET
    ejected_at = NOW(),
    ejected_reason = p_reason
  WHERE id = p_quote_id;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_eject_quote(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_eject_quote(uuid, text) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_eject_quote(uuid, text) IS
  'Eject d''un devis PL attaché lors du cron pennylane-sync-quote-status (cas 404 deleted_in_pennylane). service_role only.';

-- Update quote_status from PL sync
CREATE OR REPLACE FUNCTION public.pennylane_sync_update_quote_status(
  p_quote_id uuid,
  p_new_status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
BEGIN
  UPDATE majordhome.lead_pennylane_quotes
  SET quote_status = p_new_status
  WHERE id = p_quote_id AND quote_status IS DISTINCT FROM p_new_status;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_update_quote_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_update_quote_status(uuid, text) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_update_quote_status(uuid, text) IS
  'Sync quote_status d''un devis PL depuis l''API Pennylane. service_role only. Idempotent (no-op si déjà à l''état cible).';

-- Update client fields from PL customer sync (COALESCE strict server-side)
CREATE OR REPLACE FUNCTION public.pennylane_sync_update_client_fields(
  p_client_id uuid,
  p_org_id uuid,
  p_fields jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
BEGIN
  UPDATE majordhome.clients
  SET
    first_name = COALESCE(NULLIF(p_fields->>'first_name', ''), first_name),
    last_name = COALESCE(NULLIF(p_fields->>'last_name', ''), last_name),
    email = COALESCE(NULLIF(p_fields->>'email', ''), email),
    phone = COALESCE(NULLIF(p_fields->>'phone', ''), phone),
    address = COALESCE(NULLIF(p_fields->>'address', ''), address),
    postal_code = COALESCE(NULLIF(p_fields->>'postal_code', ''), postal_code),
    city = COALESCE(NULLIF(p_fields->>'city', ''), city),
    updated_at = NOW()
  WHERE id = p_client_id AND org_id = p_org_id;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_update_client_fields(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_update_client_fields(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_update_client_fields(uuid, uuid, jsonb) IS
  'Sync fields du client MDH depuis le customer Pennylane (COALESCE strict server-side). service_role only.';
