-- 20260807_1_pennylane_quotes_twin.sql
-- Table jumelle des devis Pennylane : projection en lecture seule alimentée par
-- l'edge function pennylane-quotes-sweep. Sens strictement unique PL → MDH.
-- Spec : docs/superpowers/specs/2026-08-07-devis-pl-deadline-et-materialisation-design.md

CREATE TABLE IF NOT EXISTS majordhome.pennylane_quotes (
  org_id             uuid        NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  pennylane_quote_id bigint      NOT NULL,
  quote_number       text,
  label              text,
  status             text,
  quote_date         date,        -- date d'émission PL
  deadline           date,        -- échéance PL (le champ que le job normalise)
  amount_ht          numeric,
  amount_ttc         numeric,
  pdf_url            text,
  customer_id        bigint,
  customer_name      text,
  pdf_invoice_subject text,
  archived_at        timestamptz,
  pl_created_at      timestamptz,
  pl_updated_at      timestamptz,
  missing_since      timestamptz, -- posé quand le devis disparaît du balayage
  synced_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, pennylane_quote_id)
);

CREATE INDEX IF NOT EXISTS idx_pl_quotes_org_status
  ON majordhome.pennylane_quotes (org_id, status);
CREATE INDEX IF NOT EXISTS idx_pl_quotes_org_date
  ON majordhome.pennylane_quotes (org_id, quote_date DESC);

ALTER TABLE majordhome.pennylane_quotes ENABLE ROW LEVEL SECURITY;

-- Lecture au niveau membre. Aucune policy d'écriture : le job passe par une RPC
-- SECURITY DEFINER (service_role). La table est une projection, jamais éditée
-- depuis Majord'home — sinon elle diverge de Pennylane en silence.
DROP POLICY IF EXISTS plq_select ON majordhome.pennylane_quotes;
CREATE POLICY plq_select ON majordhome.pennylane_quotes
  FOR SELECT USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

-- Vue publique : miroir simple => reste lisible via PostgREST.
-- NE PAS y ajouter de JOIN/LATERAL (cf. gotcha majordhome_appointments).
DROP VIEW IF EXISTS public.majordhome_pennylane_quotes;
CREATE VIEW public.majordhome_pennylane_quotes
  WITH (security_invoker = true) AS
  SELECT org_id, pennylane_quote_id, quote_number, label, status, quote_date, deadline,
         amount_ht, amount_ttc, pdf_url, customer_id, customer_name, pdf_invoice_subject,
         archived_at, pl_created_at, pl_updated_at, missing_since, synced_at
  FROM majordhome.pennylane_quotes;

-- Sans ce GRANT, une edge function lisant la vue plante en 42501 SILENCIEUX.
GRANT SELECT ON majordhome.pennylane_quotes TO service_role;
GRANT SELECT ON public.majordhome_pennylane_quotes TO authenticated;
-- Les nouvelles vues public.* héritent des privilèges par défaut du schéma
-- (constaté le 2026-08-05 sur pennylane_quote_dismissals) : on les retire.
REVOKE ALL ON public.majordhome_pennylane_quotes FROM anon;

-- ---------------------------------------------------------------------------
-- RÈGLE MÉTIER — SOURCE UNIQUE
-- L'échéance cible d'un devis. Définie ICI et nulle part ailleurs : l'edge
-- function ne fait aucune arithmétique de dates, elle reçoit la cible calculée.
-- Postgres gère correctement les fins de mois (30/11 + 3 mois = 28 ou 29/02).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.pl_quote_target_deadline(p_quote_date date)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$ SELECT (p_quote_date + INTERVAL '3 months')::date $$;

-- ---------------------------------------------------------------------------
-- Upsert d'un lot de devis. Retourne les devis dont l'échéance doit être
-- repoussée, avec la cible — l'edge function n'a plus qu'à émettre les PUT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pennylane_quotes_upsert_batch(
  p_org_id uuid,
  p_rows   jsonb
)
RETURNS TABLE (pennylane_quote_id bigint, target_deadline date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  INSERT INTO majordhome.pennylane_quotes AS q (
    org_id, pennylane_quote_id, quote_number, label, status, quote_date, deadline,
    amount_ht, amount_ttc, pdf_url, customer_id, customer_name, pdf_invoice_subject,
    archived_at, pl_created_at, pl_updated_at, missing_since, synced_at
  )
  SELECT
    p_org_id,
    (r->>'id')::bigint,
    r->>'quote_number',
    r->>'label',
    r->>'status',
    NULLIF(r->>'date','')::date,
    NULLIF(r->>'deadline','')::date,
    NULLIF(r->>'amount_ht','')::numeric,
    NULLIF(r->>'amount_ttc','')::numeric,
    r->>'pdf_url',
    NULLIF(r->>'customer_id','')::bigint,
    r->>'customer_name',
    r->>'pdf_invoice_subject',
    NULLIF(r->>'archived_at','')::timestamptz,
    NULLIF(r->>'pl_created_at','')::timestamptz,
    NULLIF(r->>'pl_updated_at','')::timestamptz,
    NULL,          -- vu dans ce balayage => plus manquant
    now()
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (org_id, pennylane_quote_id) DO UPDATE SET
    quote_number = EXCLUDED.quote_number,
    label = EXCLUDED.label,
    status = EXCLUDED.status,
    quote_date = EXCLUDED.quote_date,
    deadline = EXCLUDED.deadline,
    amount_ht = EXCLUDED.amount_ht,
    amount_ttc = EXCLUDED.amount_ttc,
    pdf_url = COALESCE(EXCLUDED.pdf_url, q.pdf_url),
    customer_id = EXCLUDED.customer_id,
    customer_name = COALESCE(EXCLUDED.customer_name, q.customer_name),
    pdf_invoice_subject = EXCLUDED.pdf_invoice_subject,
    archived_at = EXCLUDED.archived_at,
    pl_created_at = EXCLUDED.pl_created_at,
    pl_updated_at = EXCLUDED.pl_updated_at,
    missing_since = NULL,
    synced_at = now();

  RETURN QUERY
  SELECT q.pennylane_quote_id, majordhome.pl_quote_target_deadline(q.quote_date)
  FROM majordhome.pennylane_quotes q
  WHERE q.org_id = p_org_id
    AND q.pennylane_quote_id IN (
      SELECT (r->>'id')::bigint FROM jsonb_array_elements(p_rows) AS r
    )
    AND q.status IN ('pending','expired')
    AND q.quote_date IS NOT NULL
    AND q.deadline IS DISTINCT FROM majordhome.pl_quote_target_deadline(q.quote_date);
END;
$$;

-- Payload contient org_id sans le dériver d'auth.uid() => service_role UNIQUEMENT
-- (règle CLAUDE.md, cf. record_voice_memo_extraction).
REVOKE ALL ON FUNCTION public.pennylane_quotes_upsert_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_quotes_upsert_batch(uuid, jsonb) TO service_role;

-- Marque les devis absents du dernier balayage complet.
CREATE OR REPLACE FUNCTION public.pennylane_quotes_mark_missing(
  p_org_id uuid,
  p_sweep_started timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE majordhome.pennylane_quotes
     SET missing_since = now()
   WHERE org_id = p_org_id
     AND synced_at < p_sweep_started
     AND missing_since IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.pennylane_quotes_mark_missing(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_quotes_mark_missing(uuid, timestamptz) TO service_role;
