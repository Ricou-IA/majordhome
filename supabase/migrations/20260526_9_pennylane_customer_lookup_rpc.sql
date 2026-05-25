-- supabase/migrations/20260526_9_pennylane_customer_lookup_rpc.sql
-- D.5 — RPC upsert cache customer PL.
-- Le frontend ne peut pas écrire dans majordhome.* directement (schema non
-- exposé via PostgREST → 406). Pattern projet : RPC SECURITY DEFINER avec
-- check membership user × org_id côté DB.
--
-- Signature flexible : accepte un jsonb pour pouvoir évoluer sans casser
-- l'API. Le caller passe { pennylane_id, name, first_name, last_name, email,
-- phone, address, postal_code, city, customer_type, external_reference,
-- raw_payload? } — tous nullable sauf pennylane_id.
--
-- COALESCE strict sur l'UPDATE : ne jamais écraser une valeur existante avec
-- null/vide. Pattern multi-tenant : un cache partiel vaut mieux qu'un cache
-- écrasé. last_seen toujours bumped à NOW().
--
-- Spec : brief D.5 write-through. Appelé fire-and-forget après chaque
-- pennylane.service.fetchCustomerById() / fetchCustomersByIds().

CREATE OR REPLACE FUNCTION public.upsert_pennylane_customer_lookup(
  p_org_id UUID,
  p_payload JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $$
DECLARE
  v_pennylane_id BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM core.organization_members
    WHERE user_id = auth.uid() AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'not_org_member' USING ERRCODE = '42501';
  END IF;

  v_pennylane_id := (p_payload->>'pennylane_id')::BIGINT;
  IF v_pennylane_id IS NULL THEN
    RAISE EXCEPTION 'pennylane_id required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO majordhome.pennylane_customer_lookup AS pcl (
    org_id, pennylane_id,
    name, first_name, last_name, customer_type,
    email, phone, address, postal_code, city,
    external_reference, raw_payload, last_seen
  ) VALUES (
    p_org_id, v_pennylane_id,
    NULLIF(TRIM(p_payload->>'name'), ''),
    NULLIF(TRIM(p_payload->>'first_name'), ''),
    NULLIF(TRIM(p_payload->>'last_name'), ''),
    NULLIF(TRIM(p_payload->>'customer_type'), ''),
    NULLIF(TRIM(p_payload->>'email'), ''),
    NULLIF(TRIM(p_payload->>'phone'), ''),
    NULLIF(TRIM(p_payload->>'address'), ''),
    NULLIF(TRIM(p_payload->>'postal_code'), ''),
    NULLIF(TRIM(p_payload->>'city'), ''),
    NULLIF(TRIM(p_payload->>'external_reference'), ''),
    p_payload->'raw_payload',
    NOW()
  )
  ON CONFLICT (org_id, pennylane_id) DO UPDATE SET
    name               = COALESCE(EXCLUDED.name, pcl.name),
    first_name         = COALESCE(EXCLUDED.first_name, pcl.first_name),
    last_name          = COALESCE(EXCLUDED.last_name, pcl.last_name),
    customer_type      = COALESCE(EXCLUDED.customer_type, pcl.customer_type),
    email              = COALESCE(EXCLUDED.email, pcl.email),
    phone              = COALESCE(EXCLUDED.phone, pcl.phone),
    address            = COALESCE(EXCLUDED.address, pcl.address),
    postal_code        = COALESCE(EXCLUDED.postal_code, pcl.postal_code),
    city               = COALESCE(EXCLUDED.city, pcl.city),
    external_reference = COALESCE(EXCLUDED.external_reference, pcl.external_reference),
    raw_payload        = COALESCE(EXCLUDED.raw_payload, pcl.raw_payload),
    last_seen          = NOW();
END;
$$;

COMMENT ON FUNCTION public.upsert_pennylane_customer_lookup(UUID, JSONB) IS
  'D.5 write-through : upsert un customer PL dans le cache lookup. SECURITY DEFINER, check membership user × org_id. COALESCE strict : ne jamais écraser une valeur existante avec null/vide.';

REVOKE EXECUTE ON FUNCTION public.upsert_pennylane_customer_lookup(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_pennylane_customer_lookup(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_pennylane_customer_lookup(UUID, JSONB) TO authenticated;
