-- ============================================================================
-- call_campaign_brain
-- Moteur de campagne d'appels sortants (cerveau, niveau 0.5).
-- Spec : docs/superpowers/specs/2026-06-03-campagne-appels-sortants-moteur-design.md
-- Plan : docs/superpowers/plans/2026-06-03-campagne-appels-sortants-moteur.md (Task 1)
-- ============================================================================

-- 1. TABLES -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.call_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id),
  kanban      text NOT NULL DEFAULT 'entretien',
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'active',
  started_by  uuid REFERENCES core.profiles(id),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

CREATE TABLE IF NOT EXISTS majordhome.call_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES core.organizations(id),
  session_id      uuid REFERENCES majordhome.call_sessions(id) ON DELETE SET NULL,
  intervention_id uuid REFERENCES majordhome.interventions(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES majordhome.leads(id) ON DELETE CASCADE,
  phone_dialed    text,
  result          text NOT NULL,
  note            text,
  attempt_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES core.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_attempts_one_target CHECK (
    (intervention_id IS NOT NULL)::int + (lead_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT call_attempts_result_chk CHECK (
    result IN ('no_answer','voicemail','transferred_answered','transfer_missed','rdv_booked','refused','callback')
  )
);

CREATE INDEX IF NOT EXISTS idx_call_attempts_org          ON majordhome.call_attempts(org_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_intervention ON majordhome.call_attempts(intervention_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_lead         ON majordhome.call_attempts(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_session      ON majordhome.call_attempts(session_id);

-- 2. RLS --------------------------------------------------------------------
ALTER TABLE majordhome.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.call_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_sessions_org ON majordhome.call_sessions;
CREATE POLICY call_sessions_org ON majordhome.call_sessions
  FOR ALL USING (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS call_attempts_org ON majordhome.call_attempts;
CREATE POLICY call_attempts_org ON majordhome.call_attempts
  FOR ALL USING (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()));

GRANT SELECT ON majordhome.call_sessions TO service_role;
GRANT SELECT ON majordhome.call_attempts TO service_role;

-- 3. VUES PUBLIQUES (security_invoker) --------------------------------------
CREATE OR REPLACE VIEW public.majordhome_call_sessions
  WITH (security_invoker = true) AS SELECT * FROM majordhome.call_sessions;

CREATE OR REPLACE VIEW public.majordhome_call_attempts
  WITH (security_invoker = true) AS SELECT * FROM majordhome.call_attempts;

CREATE OR REPLACE VIEW public.majordhome_call_attempt_stats
  WITH (security_invoker = true) AS
  SELECT
    org_id, intervention_id, lead_id,
    COUNT(*)        AS call_count,
    MAX(attempt_at) AS last_call_at,
    (ARRAY_AGG(result ORDER BY attempt_at DESC))[1] AS last_call_result
  FROM majordhome.call_attempts
  GROUP BY org_id, intervention_id, lead_id;

GRANT SELECT ON public.majordhome_call_sessions      TO authenticated, service_role;
GRANT SELECT ON public.majordhome_call_attempts      TO authenticated, service_role;
GRANT SELECT ON public.majordhome_call_attempt_stats TO authenticated, service_role;

-- 4. RPCs (SECURITY DEFINER, REVOKE anon, membership check) ------------------
CREATE OR REPLACE FUNCTION public.call_session_start(
  p_org_id uuid, p_kanban text, p_params jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public, core AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.organization_members
                 WHERE user_id = auth.uid() AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  INSERT INTO majordhome.call_sessions(org_id, kanban, params, started_by)
  VALUES (p_org_id, COALESCE(p_kanban,'entretien'), COALESCE(p_params,'{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.call_attempt_record(
  p_org_id uuid, p_session_id uuid, p_intervention_id uuid, p_lead_id uuid,
  p_result text, p_phone text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public, core AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.organization_members
                 WHERE user_id = auth.uid() AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  INSERT INTO majordhome.call_attempts(
    org_id, session_id, intervention_id, lead_id, phone_dialed, result, note, created_by)
  VALUES (p_org_id, p_session_id, p_intervention_id, p_lead_id, p_phone, p_result, p_note, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.call_get_card_context(
  p_intervention_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public, core AS $$
DECLARE v_org uuid; v_res jsonb;
BEGIN
  SELECT c.org_id INTO v_org
  FROM majordhome.interventions i
  JOIN majordhome.clients c ON c.id = i.client_id
  WHERE i.id = p_intervention_id;

  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM core.organization_members
                                  WHERE user_id = auth.uid() AND org_id = v_org) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT jsonb_build_object(
    'intervention_id', i.id,
    'client_id',       c.id,
    'client_name',     TRIM(COALESCE(c.last_name,'') || ' ' || COALESCE(c.first_name,'')),
    'client_phone',    c.phone,
    'contract_id',     COALESCE(i.contract_id, ct_active.id),
    'contract_number', COALESCE(ct_direct.contract_number, ct_active.contract_number),
    'visit_year',      EXTRACT(YEAR FROM now())::int
  ) INTO v_res
  FROM majordhome.interventions i
  JOIN majordhome.clients c ON c.id = i.client_id
  LEFT JOIN majordhome.contracts ct_direct ON ct_direct.id = i.contract_id
  LEFT JOIN majordhome.contracts ct_active ON ct_active.client_id = i.client_id AND ct_active.status = 'active'
  WHERE i.id = p_intervention_id
  LIMIT 1;

  RETURN v_res;
END $$;

REVOKE EXECUTE ON FUNCTION public.call_session_start(uuid,text,jsonb)                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.call_attempt_record(uuid,uuid,uuid,uuid,text,text,text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.call_get_card_context(uuid)                               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.call_session_start(uuid,text,jsonb)                        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.call_attempt_record(uuid,uuid,uuid,uuid,text,text,text)    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.call_get_card_context(uuid)                                TO authenticated;
