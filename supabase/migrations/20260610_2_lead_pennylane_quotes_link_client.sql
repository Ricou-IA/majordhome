-- supabase/migrations/20260610_2_lead_pennylane_quotes_link_client.sql
-- ============================================================================
-- RPC : backfill du pennylane_client_id sur les liaisons d'un lead
-- ============================================================================
-- La vue publique `majordhome_lead_pennylane_quotes` n'est PAS updatable et le
-- schema `majordhome` n'est pas expose via PostgREST (.schema(...) -> 406).
-- Cette RPC permet a `ensureClientForLeadFromPennylane` (post-attach, frontend)
-- de poser `pennylane_client_id` sur les devis d'un lead apres materialisation
-- du client MDH. Idempotente (ne touche que les lignes actives sans client).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_pennylane_quotes_link_client(
  p_lead_id uuid,
  p_org_id uuid,
  p_client_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count int;
BEGIN
  -- Check membership multi-tenant (P0.7)
  IF v_user IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.org_id = p_org_id AND om.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Acces refuse' USING ERRCODE = '42501';
  END IF;

  UPDATE majordhome.lead_pennylane_quotes
  SET pennylane_client_id = p_client_id
  WHERE lead_id = p_lead_id
    AND org_id = p_org_id
    AND ejected_at IS NULL
    AND pennylane_client_id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lead_pennylane_quotes_link_client(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_pennylane_quotes_link_client(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.lead_pennylane_quotes_link_client(uuid, uuid, uuid) IS
  'Backfill pennylane_client_id sur les liaisons actives d''un lead (post-attach, materialisation client). SECURITY DEFINER, membership-checked, REVOKE anon. La vue majordhome_lead_pennylane_quotes n''etant pas updatable. 2026-06-10.';
