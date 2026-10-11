-- 20261011_1 — Synchro BIDIRECTIONNELLE de l'identité client Majord'home ⇄ Pennylane
-- ============================================================================
-- Décision Eric 2026-10-11 : la fiche client se modifie des DEUX côtés. Avant, le
-- cron `pennylane-sync-quote-status` réimposait toutes les 15 min la fiche PL du
-- cache `pennylane_customer_lookup` — un cache jamais rafraîchi (326 fiches pour
-- 994 clients pontés, dernières lectures entre mai et octobre) : toute correction
-- faite dans MDH était écrasée par une photo périmée (HELLARD CLI-03715), et
-- aucune modification faite dans Pennylane n'arrivait.
--
-- Nouveau modèle (règles pures : supabase/functions/_shared/pennylaneIdentity.js) :
--   - MDH → PL : push immédiat des seules colonnes modifiées (edge
--     `pennylane-customer-push`). Échec = saisie « en attente »
--     (pennylane_sync.metadata.pending_push = { colonne: date de saisie }),
--     rejouée par le cron.
--   - PL → MDH : le journal `/changelogs/customers` désigne les clients modifiés ;
--     on compare la fiche fraîche à la DERNIÈRE FICHE PL CONNUE et on n'écrit que
--     les champs que Pennylane a changés.
--
-- « Dernière fiche PL connue » = une ligne du cache marquée `identity_baseline_at`
-- par ces edges, avec écriture EXACTE des champs (null compris). Les lignes
-- antérieures ne sont PAS fiables comme base de comparaison : le sweep les
-- remplissait depuis des champs au root (`c.address`, `c.email`) qui n'existent
-- pas en V2 (adresse dans `billing_address`, e-mails dans `emails[]`) et les
-- upserts COALESCE ne vident jamais un champ. Une diff contre elles ferait
-- croire à des changements PL et écraserait MDH : elles sont rebasées par le
-- cron (passe « base », sans aucune écriture dans MDH).
--
-- Toutes les RPC ci-dessous prennent org_id en paramètre sans le dériver
-- d'auth.uid() ⇒ service_role SEUL (charte : REVOKE PUBLIC, anon, authenticated).
-- L'edge user-facing `pennylane-customer-push` vérifie la membership elle-même
-- (requireOrgMembership) avant de les appeler avec la clé service_role.
-- ============================================================================

ALTER TABLE majordhome.pennylane_customer_lookup
  ADD COLUMN IF NOT EXISTS identity_baseline_at timestamptz;

COMMENT ON COLUMN majordhome.pennylane_customer_lookup.identity_baseline_at IS
  'Date de la dernière écriture EXACTE de l''identité par les edges de synchro (push MDH→PL, journal PL→MDH). NULL = ligne non fiable comme base de diff.';

-- ----------------------------------------------------------------------------
-- Curseur du journal Pennylane par org
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.pennylane_customer_delta_state (
  org_id            uuid PRIMARY KEY REFERENCES core.organizations(id) ON DELETE CASCADE,
  last_processed_at timestamptz NOT NULL,
  last_run_at       timestamptz NOT NULL DEFAULT now(),
  last_result       jsonb
);

COMMENT ON TABLE majordhome.pennylane_customer_delta_state IS
  'Curseur du journal GET /changelogs/customers (rétention PL : 4 semaines). Écrit uniquement par pennylane-sync-quote-status via pennylane_customer_delta_set_state.';

-- Table interne au cron : RLS active et AUCUNE policy (aucun accès PostgREST),
-- lue/écrite par les RPC SECURITY DEFINER ci-dessous.
ALTER TABLE majordhome.pennylane_customer_delta_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON majordhome.pennylane_customer_delta_state FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Écriture EXACTE de la fiche PL dans le cache (base de diff)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pennylane_customer_identity_upsert(
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
    raw_payload, last_seen, identity_baseline_at
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
    now(),
    now()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
  WHERE (r->>'pennylane_id') IS NOT NULL
  ON CONFLICT (org_id, pennylane_id) DO UPDATE SET
    -- Identité : écrasée telle quelle (null compris) — c'est la photo PL exacte.
    first_name           = EXCLUDED.first_name,
    last_name            = EXCLUDED.last_name,
    email                = EXCLUDED.email,
    phone                = EXCLUDED.phone,
    address              = EXCLUDED.address,
    postal_code          = EXCLUDED.postal_code,
    city                 = EXCLUDED.city,
    -- Métadonnées : on ne perd pas une valeur connue sur une réponse partielle.
    name                 = COALESCE(EXCLUDED.name, pcl.name),
    customer_type        = COALESCE(EXCLUDED.customer_type, pcl.customer_type),
    external_reference   = COALESCE(EXCLUDED.external_reference, pcl.external_reference),
    raw_payload          = COALESCE(EXCLUDED.raw_payload, pcl.raw_payload),
    last_seen            = now(),
    identity_baseline_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pennylane_customer_identity_upsert(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_customer_identity_upsert(uuid, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- Lecture des bases de diff (lignes rebasées uniquement)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pennylane_customer_identity_get(
  p_org_id uuid,
  p_ids    bigint[]
)
RETURNS TABLE (
  pennylane_id bigint, customer_type text,
  first_name text, last_name text, email text, phone text,
  address text, postal_code text, city text,
  identity_baseline_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
  SELECT pcl.pennylane_id, pcl.customer_type,
         pcl.first_name, pcl.last_name, pcl.email, pcl.phone,
         pcl.address, pcl.postal_code, pcl.city,
         pcl.identity_baseline_at
    FROM majordhome.pennylane_customer_lookup pcl
   WHERE pcl.org_id = p_org_id
     AND pcl.pennylane_id = ANY (p_ids)
     AND pcl.identity_baseline_at IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.pennylane_customer_identity_get(uuid, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_customer_identity_get(uuid, bigint[]) TO service_role;

-- ----------------------------------------------------------------------------
-- Customers pontés à un client MDH sans base de diff fiable (passe « base »)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pennylane_customer_unbaselined(
  p_org_id uuid,
  p_limit  integer
)
RETURNS SETOF bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
  SELECT DISTINCT s.pennylane_id
    FROM majordhome.pennylane_sync s
    LEFT JOIN majordhome.pennylane_customer_lookup pcl
      ON pcl.org_id = s.org_id AND pcl.pennylane_id = s.pennylane_id
   WHERE s.org_id = p_org_id
     AND s.entity_type = 'client'
     AND pcl.identity_baseline_at IS NULL
   ORDER BY s.pennylane_id
   LIMIT GREATEST(COALESCE(p_limit, 0), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.pennylane_customer_unbaselined(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_customer_unbaselined(uuid, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- Curseur du journal
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pennylane_customer_delta_get_state(p_org_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
  SELECT last_processed_at FROM majordhome.pennylane_customer_delta_state WHERE org_id = p_org_id;
$$;

REVOKE EXECUTE ON FUNCTION public.pennylane_customer_delta_get_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_customer_delta_get_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pennylane_customer_delta_set_state(
  p_org_id            uuid,
  p_last_processed_at timestamptz,
  p_result            jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  IF p_last_processed_at IS NULL THEN
    RAISE EXCEPTION 'last_processed_at requis' USING ERRCODE = '22023';
  END IF;
  INSERT INTO majordhome.pennylane_customer_delta_state (org_id, last_processed_at, last_run_at, last_result)
  VALUES (p_org_id, p_last_processed_at, now(), p_result)
  ON CONFLICT (org_id) DO UPDATE SET
    last_processed_at = EXCLUDED.last_processed_at,
    last_run_at       = now(),
    last_result       = EXCLUDED.last_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pennylane_customer_delta_set_state(uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_customer_delta_set_state(uuid, timestamptz, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- État du push MDH → PL d'un client (saisies en attente)
-- ----------------------------------------------------------------------------
-- p_pending : { colonne: date ISO de la saisie } — objet vide = tout est parti.
-- Remplace la clé metadata.pending_push (les autres clés de metadata sont gardées).
CREATE OR REPLACE FUNCTION public.pennylane_client_set_push_state(
  p_org_id    uuid,
  p_client_id uuid,
  p_pending   jsonb,
  p_error     text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_pending jsonb := CASE WHEN jsonb_typeof(p_pending) = 'object' THEN p_pending ELSE '{}'::jsonb END;
  v_found   boolean;
BEGIN
  UPDATE majordhome.pennylane_sync
     SET metadata = CASE
                      WHEN v_pending = '{}'::jsonb THEN COALESCE(metadata, '{}'::jsonb) - 'pending_push'
                      ELSE jsonb_set(COALESCE(metadata, '{}'::jsonb), '{pending_push}', v_pending)
                    END,
         sync_status    = CASE WHEN v_pending = '{}'::jsonb THEN 'synced' ELSE 'error' END,
         sync_error     = CASE WHEN v_pending = '{}'::jsonb THEN NULL ELSE p_error END,
         last_synced_at = CASE WHEN v_pending = '{}'::jsonb THEN now() ELSE last_synced_at END,
         updated_at     = now()
   WHERE org_id = p_org_id
     AND entity_type = 'client'
     AND local_id = p_client_id;
  v_found := FOUND;
  RETURN v_found;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pennylane_client_set_push_state(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_client_set_push_state(uuid, uuid, jsonb, text) TO service_role;
