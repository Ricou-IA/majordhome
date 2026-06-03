-- ============================================================================
-- call_campaign_brain_review_fixes
-- Corrections issues de la revue finale de la migration call_campaign_brain.
--   #2  call_get_card_context : LEFT JOIN clients (une intervention sans client
--       ne doit PAS lever 'not_authorized') + org dérivé via client OU contrat.
--   #7  call_attempt_record  : vérifie que p_intervention_id / p_lead_id
--       appartient bien à p_org_id (défense en profondeur multi-tenant).
-- Spec : docs/superpowers/specs/2026-06-03-campagne-appels-sortants-moteur-design.md
-- ============================================================================

CREATE OR REPLACE FUNCTION public.call_get_card_context(
  p_intervention_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public, core AS $$
DECLARE v_org uuid; v_res jsonb;
BEGIN
  SELECT COALESCE(c.org_id, ct.org_id) INTO v_org
  FROM majordhome.interventions i
  LEFT JOIN majordhome.clients   c  ON c.id = i.client_id
  LEFT JOIN majordhome.contracts ct ON ct.id = i.contract_id
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
  LEFT JOIN majordhome.clients   c          ON c.id = i.client_id
  LEFT JOIN majordhome.contracts ct_direct  ON ct_direct.id = i.contract_id
  LEFT JOIN majordhome.contracts ct_active  ON ct_active.client_id = i.client_id AND ct_active.status = 'active'
  WHERE i.id = p_intervention_id
  LIMIT 1;

  RETURN v_res;
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

  IF p_intervention_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM majordhome.interventions i
    LEFT JOIN majordhome.clients   c  ON c.id = i.client_id
    LEFT JOIN majordhome.contracts ct ON ct.id = i.contract_id
    WHERE i.id = p_intervention_id AND COALESCE(c.org_id, ct.org_id) = p_org_id
  ) THEN
    RAISE EXCEPTION 'intervention_not_in_org';
  END IF;

  IF p_lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM majordhome.leads l WHERE l.id = p_lead_id AND l.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'lead_not_in_org';
  END IF;

  INSERT INTO majordhome.call_attempts(
    org_id, session_id, intervention_id, lead_id, phone_dialed, result, note, created_by)
  VALUES (p_org_id, p_session_id, p_intervention_id, p_lead_id, p_phone, p_result, p_note, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.call_get_card_context(uuid)                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.call_attempt_record(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.call_get_card_context(uuid)                             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.call_attempt_record(uuid,uuid,uuid,uuid,text,text,text) TO authenticated;
