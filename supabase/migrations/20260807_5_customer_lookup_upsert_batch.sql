-- 20260807_5 — Alimentation du cache customers Pennylane depuis un contexte
-- service_role (edge function / cron).
--
-- ============================================================================
-- POURQUOI CETTE RPC EXISTE ALORS QUE upsert_pennylane_customer_lookup() EXISTE
-- ============================================================================
-- Ce n'est PAS un doublon. Ne la supprimez pas au motif que l'autre « fait la
-- même chose » — elles s'adressent à deux appelants incompatibles.
--
-- public.upsert_pennylane_customer_lookup(p_org_id, p_payload) vérifie en
-- premier lieu :
--
--     IF NOT EXISTS (SELECT 1 FROM core.organization_members
--                    WHERE user_id = auth.uid() AND org_id = p_org_id)
--     THEN RAISE EXCEPTION 'not_org_member' USING ERRCODE = '42501';
--
-- Cette garde est correcte pour son appelant d'origine : le FRONTEND, où
-- auth.uid() porte l'utilisateur connecté (write-through cache D.5, cf.
-- cacheUpsertCustomer dans pennylane.service.js).
--
-- Elle la rend en revanche STRUCTURELLEMENT INAPPELABLE depuis une edge
-- function. Celles-ci s'authentifient avec SUPABASE_SERVICE_ROLE_KEY et sans
-- session utilisateur (cf. getAdminClient dans _shared/auth.ts) : auth.uid()
-- vaut NULL, la sous-requête ne matche jamais, et l'appel échoue en
-- 42501 not_org_member — y compris pour service_role, à qui EXECUTE est
-- pourtant accordé. Le GRANT laisse donc croire à tort que le cron peut
-- l'utiliser ; constaté par sonde le 2026-08-07.
--
-- Les deux autres voies d'écriture sont également fermées à service_role :
--   - INSERT via la vue publique majordhome_pennylane_customer_lookup →
--     42501 permission denied (vue security_invoker=true, et service_role n'a
--     que SELECT sur la table de base — convention projet : les écritures
--     passent par des RPC SECURITY DEFINER) ;
--   - .schema('majordhome') via PostgREST → schéma non exposé.
--
-- D'où cette variante batch, jumelle de pennylane_quotes_upsert_batch (même
-- balayage, même posture) : pas de auth.uid(), org dérivée du paramètre, donc
-- réservée à service_role.
--
-- CHARTE MULTI-TENANT (CLAUDE.md) : une RPC SECURITY DEFINER qui prend org_id
-- dans son payload SANS le dériver d'auth.uid() doit être REVOKE FROM PUBLIC,
-- anon, authenticated et accessible au seul service_role. Sinon un utilisateur
-- authentifié pourrait forger un org_id arbitraire et écrire cross-org.
-- Le frontend continue d'utiliser upsert_pennylane_customer_lookup().
--
-- Consommée par : supabase/functions/pennylane-quotes-sweep (résolution des
-- noms clients absents du cache — l'endpoint LISTE /quotes de Pennylane V2
-- n'embarque que customer.id, jamais le nom).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pennylane_customer_lookup_upsert_batch(
  p_org_id uuid,
  p_rows   jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO majordhome.pennylane_customer_lookup AS pcl (
    org_id, pennylane_id, name, first_name, last_name, customer_type,
    email, phone, address, postal_code, city, external_reference,
    raw_payload, last_seen
  )
  SELECT
    p_org_id,
    (r->>'pennylane_id')::bigint,
    NULLIF(TRIM(r->>'name'), ''),
    NULLIF(TRIM(r->>'first_name'), ''),
    NULLIF(TRIM(r->>'last_name'), ''),
    NULLIF(TRIM(r->>'customer_type'), ''),
    NULLIF(TRIM(r->>'email'), ''),
    NULLIF(TRIM(r->>'phone'), ''),
    NULLIF(TRIM(r->>'address'), ''),
    NULLIF(TRIM(r->>'postal_code'), ''),
    NULLIF(TRIM(r->>'city'), ''),
    NULLIF(TRIM(r->>'external_reference'), ''),
    r->'raw_payload',
    now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'pennylane_id', '') IS NOT NULL
  ON CONFLICT (org_id, pennylane_id) DO UPDATE SET
    -- COALESCE partout : un fetch partiel n'efface JAMAIS une valeur déjà
    -- connue (même politique que upsert_pennylane_customer_lookup).
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
    last_seen          = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- org_id vient du payload → service_role uniquement (cf. charte ci-dessus).
REVOKE ALL ON FUNCTION public.pennylane_customer_lookup_upsert_batch(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_customer_lookup_upsert_batch(uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.pennylane_customer_lookup_upsert_batch(uuid, jsonb) IS
  'Upsert batch du cache customers Pennylane pour appelants service_role '
  '(edge functions/crons). Jumelle sans auth.uid() de '
  'upsert_pennylane_customer_lookup(), qui reste la voie du frontend et est '
  'inappelable hors contexte utilisateur. service_role only : org_id vient du '
  'payload. Voir migration 20260807_5.';
