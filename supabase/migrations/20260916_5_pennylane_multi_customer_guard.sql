-- ============================================================================
-- 20260916_5 — Leads multi-payeurs Pennylane : fin de l'oscillation d'identité
-- ============================================================================
-- Constat (mouchard `majordhome.audit_log`, 2026-09-16, 30 min après sa pose) :
-- le cron `pennylane-sync-quote-status` applique « post-attache, Pennylane fait
-- foi pour l'identité du lead » customer par customer. Un lead qui porte des
-- devis de DEUX customers PL différents est donc réécrit deux fois par passage :
-- nom, prénom, adresse, CP, ville, téléphone passent de A à B puis de B à A,
-- toutes les 15 minutes (3 leads : SDIS 2 casernes, BASILE/SAPATER,
-- CATHALO/VICTORIN ; 2 autres portent 2 fiches PL du même contact).
--
-- Règle : quand les devis ACTIFS (ejected_at IS NULL) d'un lead couvrent ≥ 2
-- customers, Pennylane ne peut pas faire foi → la RPC n'écrit RIEN, et le lead
-- est remonté sur le tableau de bord de l'org_admin (vue live
-- `majordhome_lead_multi_customers`), où l'humain tranche : écarter les devis
-- du mauvais customer (ils redeviennent « Non rattachés » dans l'explorateur
-- /devis) ou fusionner les fiches dans Pennylane. Dès qu'il ne reste qu'un
-- customer, la synchro d'identité reprend d'elle-même.
--
-- Signature inchangée (RETURNS void) → privilèges conservés (service_role only,
-- la RPC prend p_org_id en payload) ; ré-affirmés ci-dessous par hygiène.
-- Critère de succès : plus aucune ligne `source = 'pennylane_sync_overwrite_lead_fields'`
-- dans `majordhome.audit_log` pour ces leads au passage suivant du cron.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Garde dans la RPC d'écrasement
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pennylane_sync_overwrite_lead_fields(p_lead_id uuid, p_org_id uuid, p_fields jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_customers integer;
BEGIN
  -- Multi-payeurs : deux customers PL rattachés au même lead → aucun ne fait
  -- foi. On s'abstient (le tableau de bord remonte le cas via
  -- public.majordhome_lead_multi_customers) plutôt que d'osciller.
  SELECT count(DISTINCT q.pennylane_customer_id)
    INTO v_customers
    FROM majordhome.lead_pennylane_quotes q
   WHERE q.lead_id = p_lead_id
     AND q.org_id = p_org_id
     AND q.ejected_at IS NULL
     AND q.pennylane_customer_id IS NOT NULL;

  IF v_customers > 1 THEN
    RETURN;
  END IF;

  UPDATE majordhome.leads
  SET
    first_name = COALESCE(NULLIF(p_fields->>'first_name', ''), first_name),
    last_name = COALESCE(NULLIF(p_fields->>'last_name', ''), last_name),
    email = COALESCE(NULLIF(p_fields->>'email', ''), email),
    phone = COALESCE(NULLIF(p_fields->>'phone', ''), phone),
    address = COALESCE(NULLIF(p_fields->>'address', ''), address),
    postal_code = COALESCE(NULLIF(p_fields->>'postal_code', ''), postal_code),
    city = COALESCE(NULLIF(p_fields->>'city', ''), city),
    updated_at = NOW()
  WHERE id = p_lead_id AND org_id = p_org_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.pennylane_sync_overwrite_lead_fields(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_overwrite_lead_fields(uuid, uuid, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Vue live : leads dont les devis actifs couvrent ≥ 2 customers Pennylane
--    (security_invoker → RLS de leads / lead_pennylane_quotes / lookup)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_lead_multi_customers
WITH (security_invoker = true) AS
WITH par_customer AS (
  SELECT
    q.org_id,
    q.lead_id,
    q.pennylane_customer_id,
    count(*)::integer                                                  AS quote_count,
    array_agg(q.pennylane_quote_id ORDER BY q.pennylane_quote_id)      AS quote_ids,
    array_agg(q.quote_status        ORDER BY q.pennylane_quote_id)     AS quote_statuses,
    max(q.assigned_at)                                                 AS last_assigned_at
  FROM majordhome.lead_pennylane_quotes q
  WHERE q.ejected_at IS NULL
    AND q.pennylane_customer_id IS NOT NULL
  GROUP BY q.org_id, q.lead_id, q.pennylane_customer_id
)
SELECT
  l.org_id,
  l.id                       AS lead_id,
  l.last_name,
  l.first_name,
  l.city                     AS lead_city,
  l.client_id,
  count(*)::integer          AS customer_count,
  jsonb_agg(
    jsonb_build_object(
      'pennylane_id',     pc.pennylane_customer_id,
      'name',             c.name,
      'city',             c.city,
      'quote_count',      pc.quote_count,
      'quote_ids',        to_jsonb(pc.quote_ids),
      'quote_statuses',   to_jsonb(pc.quote_statuses),
      'last_assigned_at', pc.last_assigned_at
    )
    ORDER BY pc.last_assigned_at DESC
  )                          AS customers
FROM par_customer pc
JOIN majordhome.leads l
  ON l.id = pc.lead_id AND l.org_id = pc.org_id AND l.is_deleted = false
LEFT JOIN majordhome.pennylane_customer_lookup c
  ON c.pennylane_id = pc.pennylane_customer_id AND c.org_id = pc.org_id
GROUP BY l.org_id, l.id, l.last_name, l.first_name, l.city, l.client_id
HAVING count(*) > 1;

REVOKE ALL ON public.majordhome_lead_multi_customers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.majordhome_lead_multi_customers TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Vérification post-apply :
--   SELECT has_function_privilege('anon','public.pennylane_sync_overwrite_lead_fields(uuid,uuid,jsonb)','EXECUTE');          -- false
--   SELECT has_function_privilege('authenticated','public.pennylane_sync_overwrite_lead_fields(uuid,uuid,jsonb)','EXECUTE'); -- false
--   SELECT has_table_privilege('anon','public.majordhome_lead_multi_customers','SELECT');                                      -- false
--   SELECT lead_id, customer_count FROM public.majordhome_lead_multi_customers;                                                 -- 5 leads le 2026-09-16
--   puis, après le passage suivant du cron :
--   SELECT count(*) FROM majordhome.audit_log WHERE source='pennylane_sync_overwrite_lead_fields' AND changed_at > now() - interval '20 min'; -- 0 attendu
-- ----------------------------------------------------------------------------
