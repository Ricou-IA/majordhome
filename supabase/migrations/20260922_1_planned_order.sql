-- supabase/migrations/20260922_1_planned_order.sql
-- ============================================================================
-- Commande « personnes × jours » sur la carte (Eric, 2026-09-21) :
-- installation (chantier = lead) et SAV (intervention). Jusqu'ici ces deux
-- nombres n'existaient nulle part : l'assistant posait un RDV par colonne
-- cliquée, d'où 12 paires d'installations en double en prod (un RDV par
-- technicien pour la même journée). Désormais un jour = un RDV à N techniciens,
-- dérivé de la commande portée par la carte.
-- Spec : docs/superpowers/specs/2026-09-21-chantier-commande-installation-personnes-jours-design.md
--
-- Colonnes nullables (NULL = commande non renseignée → comportement actuel).
-- Vues : colonnes ajoutées EN FIN de liste (CREATE OR REPLACE n'accepte rien
-- d'autre), définitions recopiées de la prod le 2026-09-22 :
--   - majordhome_interventions (miroir updatable : canal d'écriture de savService.updateFields)
--   - majordhome_chantiers
--   - majordhome_entretien_sav
-- RPC update_majordhome_lead : liste de colonnes explicite → 2 lignes ajoutées.
-- ============================================================================

ALTER TABLE majordhome.leads
  ADD COLUMN IF NOT EXISTS planned_team_size smallint,
  ADD COLUMN IF NOT EXISTS planned_days smallint;

ALTER TABLE majordhome.interventions
  ADD COLUMN IF NOT EXISTS planned_team_size smallint,
  ADD COLUMN IF NOT EXISTS planned_days smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_planned_team_size_range') THEN
    ALTER TABLE majordhome.leads
      ADD CONSTRAINT leads_planned_team_size_range CHECK (planned_team_size BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_planned_days_range') THEN
    ALTER TABLE majordhome.leads
      ADD CONSTRAINT leads_planned_days_range CHECK (planned_days BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interventions_planned_team_size_range') THEN
    ALTER TABLE majordhome.interventions
      ADD CONSTRAINT interventions_planned_team_size_range CHECK (planned_team_size BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interventions_planned_days_range') THEN
    ALTER TABLE majordhome.interventions
      ADD CONSTRAINT interventions_planned_days_range CHECK (planned_days BETWEEN 1 AND 60);
  END IF;
END $$;

COMMENT ON COLUMN majordhome.leads.planned_team_size IS
  'Commande d''installation : nombre de personnes par jour (NULL = non renseigné). 2026-09-22.';
COMMENT ON COLUMN majordhome.leads.planned_days IS
  'Commande d''installation : nombre de jours (NULL = non renseigné, le badge compte les RDV). 2026-09-22.';
COMMENT ON COLUMN majordhome.interventions.planned_team_size IS
  'Commande SAV : nombre de personnes par passage (NULL = non renseigné). 2026-09-22.';
COMMENT ON COLUMN majordhome.interventions.planned_days IS
  'Commande SAV : nombre de jours (NULL = non renseigné). 2026-09-22.';

-- ── Vue miroir updatable des interventions ─────────────────────────────────
CREATE OR REPLACE VIEW public.majordhome_interventions WITH (security_invoker = true) AS
SELECT id,
    project_id,
    equipment_id,
    intervention_type,
    scheduled_date,
    scheduled_time_start,
    scheduled_time_end,
    technician_id,
    technician_name,
    status,
    report_date,
    report_notes,
    work_performed,
    parts_replaced,
    photo_before_url,
    photo_after_url,
    photos_extra,
    signature_url,
    signed_at,
    signed_by_name,
    duration_minutes,
    is_billable,
    invoice_id,
    location_lat,
    location_lng,
    metadata,
    created_by,
    created_at,
    updated_at,
    tags,
    lead_id,
    parent_id,
    slot_date,
    slot_start_time,
    slot_end_time,
    slot_notes,
    client_id,
    contract_id,
    workflow_status,
    sav_description,
    parts_order_status,
    devis_amount,
    devis_status,
    sav_origin,
    includes_entretien,
    invoiced_at,
    planned_team_size,
    planned_days
   FROM majordhome.interventions;

-- ── Vue chantiers ──────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.majordhome_chantiers WITH (security_invoker = true) AS
SELECT l.id,
    l.org_id,
    l.first_name,
    l.last_name,
    l.company_name,
    l.email,
    l.phone,
    l.address,
    l.postal_code,
    l.city,
    l.order_amount_ht,
    l.estimated_revenue,
    l.chantier_status,
    l.equipment_order_status,
    l.materials_order_status,
    l.estimated_date,
    l.planification_date,
    l.chantier_notes,
    l.won_date,
    l.client_id,
    l.project_id,
    l.assigned_user_id,
    l.equipment_type_id,
    l.pv_reception_path,
    l.updated_at,
    l.created_at,
    pet.label AS equipment_type_label,
    pet.category AS equipment_type_category,
    i.id AS intervention_id,
    i.status AS intervention_status,
    l.pennylane_quote_id,
    COALESCE(( SELECT lqs.accepted_sum
           FROM majordhome.lead_quote_stats lqs
          WHERE lqs.lead_id = l.id), 0::numeric) AS linked_quotes_amount_ht,
    rdv.next_rdv_date,
    COALESCE(rdv.has_active_rdv, false) AS has_active_rdv,
    COALESCE(( SELECT lqs.accepted_count
           FROM majordhome.lead_quote_stats lqs
          WHERE lqs.lead_id = l.id), 0::bigint) AS validated_quotes_count,
    l.planned_team_size,
    l.planned_days
   FROM majordhome.leads l
     LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = l.equipment_type_id
     LEFT JOIN majordhome.interventions i ON i.lead_id = l.id AND i.parent_id IS NULL
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.lead_id = l.id AND a.appointment_type = 'installation'::text AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE l.chantier_status IS NOT NULL AND l.is_deleted = false;

-- ── Vue entretien / SAV ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.majordhome_entretien_sav WITH (security_invoker = true) AS
SELECT i.id,
    i.project_id,
    i.equipment_id,
    i.intervention_type,
    i.scheduled_date,
    i.scheduled_time_start,
    i.scheduled_time_end,
    i.technician_id,
    i.technician_name,
    i.status,
    i.report_date,
    i.report_notes,
    i.work_performed,
    i.parts_replaced,
    i.photo_before_url,
    i.photo_after_url,
    i.photos_extra,
    i.signature_url,
    i.signed_at,
    i.signed_by_name,
    i.duration_minutes,
    i.is_billable,
    i.invoice_id,
    i.location_lat,
    i.location_lng,
    i.metadata,
    i.created_by,
    i.created_at,
    i.updated_at,
    i.tags,
    i.lead_id,
    i.parent_id,
    i.slot_date,
    i.slot_start_time,
    i.slot_end_time,
    i.slot_notes,
    i.client_id,
    i.contract_id,
    i.workflow_status,
    i.sav_description,
    i.parts_order_status,
    i.devis_amount,
    i.devis_status,
    i.sav_origin,
    i.includes_entretien,
    majordhome.project_org_id(i.project_id) AS org_id,
    cl.display_name AS client_name,
    cl.first_name AS client_first_name,
    cl.last_name AS client_last_name,
    cl.address AS client_address,
    cl.postal_code AS client_postal_code,
    cl.city AS client_city,
    cl.phone AS client_phone,
    cl.phone_secondary AS client_phone_secondary,
    cl.email AS client_email,
    cl.sms_optin AS client_sms_optin,
    c.contract_number,
    c.amount AS contract_amount,
    c.estimated_time,
    c.maintenance_month,
    c.status AS contract_status,
    cl.project_id AS client_project_id,
    (EXISTS ( SELECT 1
           FROM majordhome.sms_logs sl
          WHERE sl.intervention_id = i.id AND sl.campaign_name = 'avis_j1'::text)) AS sms_avis_sent,
    rdv.next_rdv_date,
    COALESCE(rdv.has_active_rdv, false) AS has_active_rdv,
    COALESCE(( SELECT sum(
                CASE
                    WHEN COALESCE((elem.piece ->> 'offert'::text)::boolean, false) THEN 0::numeric
                    ELSE COALESCE((elem.piece ->> 'prix_ht'::text)::numeric, 0::numeric) * COALESCE(NULLIF(elem.piece ->> 'quantite'::text, ''::text)::numeric, 1::numeric)
                END) AS sum
           FROM majordhome.certificats cert
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cert.pieces_remplacees, '[]'::jsonb)) elem(piece)
          WHERE cert.intervention_id = i.id OR (cert.intervention_id IN ( SELECT ch.id
                   FROM majordhome.interventions ch
                  WHERE ch.parent_id = i.id))), 0::numeric) AS parts_total_ttc,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('intervention_id', cert.intervention_id, 'idx', elem.ord - 1, 'designation', elem.piece ->> 'designation'::text, 'reference', elem.piece ->> 'reference'::text, 'quantite', COALESCE(NULLIF(elem.piece ->> 'quantite'::text, ''::text)::numeric, 1::numeric), 'prix_ht', COALESCE((elem.piece ->> 'prix_ht'::text)::numeric, 0::numeric), 'offert', COALESCE((elem.piece ->> 'offert'::text)::boolean, false)) ORDER BY cert.intervention_id, elem.ord) AS jsonb_agg
           FROM majordhome.certificats cert
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cert.pieces_remplacees, '[]'::jsonb)) WITH ORDINALITY elem(piece, ord)
          WHERE (cert.intervention_id = i.id OR (cert.intervention_id IN ( SELECT ch.id
                   FROM majordhome.interventions ch
                  WHERE ch.parent_id = i.id))) AND (COALESCE(elem.piece ->> 'designation'::text, ''::text) <> ''::text OR COALESCE((elem.piece ->> 'prix_ht'::text)::numeric, 0::numeric) > 0::numeric)), '[]'::jsonb) AS parts_detail,
    i.invoiced_at,
    c.id AS effective_contract_id,
    i.planned_team_size,
    i.planned_days
   FROM majordhome.interventions i
     LEFT JOIN majordhome.clients cl ON cl.id = i.client_id
     LEFT JOIN LATERAL ( SELECT ct.id,
            ct.org_id,
            ct.client_id,
            ct.contract_number,
            ct.status,
            ct.frequency,
            ct.start_date,
            ct.end_date,
            ct.renewal_date,
            ct.next_maintenance_date,
            ct.amount,
            ct.notes,
            ct.created_at,
            ct.updated_at,
            ct.maintenance_month,
            ct.estimated_time,
            ct.zone_id,
            ct.subtotal,
            ct.discount_percent,
            ct.source,
            ct.contract_pdf_path,
            ct.signed_at,
            ct.signature_client_base64,
            ct.signature_client_nom,
            ct.cancellation_reason,
            ct.cancelled_at,
            ct.workflow_status,
            ct.amount_forced
           FROM majordhome.contracts ct
          WHERE ct.id = i.contract_id OR i.contract_id IS NULL AND ct.client_id = i.client_id AND ct.status = 'active'::majordhome.contract_status
          ORDER BY (ct.id = i.contract_id) DESC, ct.created_at DESC
         LIMIT 1) c ON true
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.intervention_id = i.id AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE (i.intervention_type = ANY (ARRAY['entretien'::majordhome.intervention_type, 'sav'::majordhome.intervention_type])) AND i.parent_id IS NULL AND (c.status IS NULL OR (c.status <> ALL (ARRAY['cancelled'::majordhome.contract_status, 'archived'::majordhome.contract_status])));

-- ── RPC de patch partiel d'un lead : deux colonnes de plus ─────────────────
CREATE OR REPLACE FUNCTION public.update_majordhome_lead(p_lead_id uuid, p_updates jsonb)
 RETURNS SETOF majordhome.leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $function$
DECLARE
  v_lead_org_id UUID;
BEGIN
  SELECT org_id INTO v_lead_org_id
  FROM majordhome.leads
  WHERE id = p_lead_id;

  IF v_lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead introuvable: %', p_lead_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.org_id = v_lead_org_id AND om.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Acces refuse';
  END IF;

  UPDATE majordhome.leads SET
    first_name = COALESCE(p_updates->>'first_name', first_name),
    last_name = COALESCE(p_updates->>'last_name', last_name),
    email = COALESCE(p_updates->>'email', email),
    phone = COALESCE(p_updates->>'phone', phone),
    phone_secondary = COALESCE(p_updates->>'phone_secondary', phone_secondary),
    address = COALESCE(p_updates->>'address', address),
    address_complement = COALESCE(p_updates->>'address_complement', address_complement),
    postal_code = COALESCE(p_updates->>'postal_code', postal_code),
    city = COALESCE(p_updates->>'city', city),
    company_name = COALESCE(p_updates->>'company_name', company_name),
    source_id = COALESCE((p_updates->>'source_id')::UUID, source_id),
    status_id = COALESCE((p_updates->>'status_id')::UUID, status_id),
    assigned_user_id = CASE WHEN p_updates ? 'assigned_user_id' THEN (p_updates->>'assigned_user_id')::UUID ELSE assigned_user_id END,
    client_id = CASE WHEN p_updates ? 'client_id' THEN (p_updates->>'client_id')::UUID ELSE client_id END,
    project_id = CASE WHEN p_updates ? 'project_id' THEN (p_updates->>'project_id')::UUID ELSE project_id END,
    appointment_id = CASE WHEN p_updates ? 'appointment_id' THEN (p_updates->>'appointment_id')::UUID ELSE appointment_id END,
    equipment_type_id = CASE WHEN p_updates ? 'equipment_type_id' THEN (p_updates->>'equipment_type_id')::UUID ELSE equipment_type_id END,
    order_amount_ht = COALESCE((p_updates->>'order_amount_ht')::NUMERIC, order_amount_ht),
    estimated_revenue = COALESCE((p_updates->>'estimated_revenue')::NUMERIC, estimated_revenue),
    probability = COALESCE((p_updates->>'probability')::INTEGER, probability),
    call_count = COALESCE((p_updates->>'call_count')::INTEGER, call_count),
    notes = COALESCE(p_updates->>'notes', notes),
    next_action = COALESCE(p_updates->>'next_action', next_action),
    lost_reason = CASE WHEN p_updates ? 'lost_reason' THEN p_updates->>'lost_reason' ELSE lost_reason END,
    next_action_date = CASE WHEN p_updates ? 'next_action_date' THEN (p_updates->>'next_action_date')::DATE ELSE next_action_date END,
    created_date = CASE WHEN p_updates ? 'created_date' THEN (p_updates->>'created_date')::DATE ELSE created_date END,
    converted_date = CASE WHEN p_updates ? 'converted_date' THEN (p_updates->>'converted_date')::DATE ELSE converted_date END,
    appointment_date = CASE WHEN p_updates ? 'appointment_date' THEN (p_updates->>'appointment_date')::DATE ELSE appointment_date END,
    quote_sent_date = CASE WHEN p_updates ? 'quote_sent_date' THEN (p_updates->>'quote_sent_date')::DATE ELSE quote_sent_date END,
    won_date = CASE WHEN p_updates ? 'won_date' THEN (p_updates->>'won_date')::DATE ELSE won_date END,
    estimated_date = CASE WHEN p_updates ? 'estimated_date' THEN (p_updates->>'estimated_date')::DATE ELSE estimated_date END,
    last_call_date = CASE WHEN p_updates ? 'last_call_date' THEN (p_updates->>'last_call_date')::TIMESTAMPTZ ELSE last_call_date END,
    is_deleted = COALESCE((p_updates->>'is_deleted')::BOOLEAN, is_deleted),
    external_id = COALESCE(p_updates->>'external_id', external_id),
    external_source = COALESCE(p_updates->>'external_source', external_source),
    external_data = CASE WHEN p_updates ? 'external_data' THEN (p_updates->'external_data') ELSE external_data END,
    chantier_status = CASE WHEN p_updates ? 'chantier_status' THEN p_updates->>'chantier_status' ELSE chantier_status END,
    equipment_order_status = CASE WHEN p_updates ? 'equipment_order_status' THEN p_updates->>'equipment_order_status' ELSE equipment_order_status END,
    materials_order_status = CASE WHEN p_updates ? 'materials_order_status' THEN p_updates->>'materials_order_status' ELSE materials_order_status END,
    pennylane_quote_id = CASE WHEN p_updates ? 'pennylane_quote_id' THEN NULLIF(p_updates->>'pennylane_quote_id', '')::BIGINT ELSE pennylane_quote_id END,
    chantier_notes = CASE WHEN p_updates ? 'chantier_notes' THEN p_updates->>'chantier_notes' ELSE chantier_notes END,
    is_long_term_project = COALESCE((p_updates->>'is_long_term_project')::BOOLEAN, is_long_term_project),
    long_term_started_at = CASE WHEN p_updates ? 'long_term_started_at' THEN NULLIF(p_updates->>'long_term_started_at', '')::TIMESTAMPTZ ELSE long_term_started_at END,
    long_term_notes = CASE WHEN p_updates ? 'long_term_notes' THEN p_updates->>'long_term_notes' ELSE long_term_notes END,
    -- Commande « personnes × jours » (2026-09-22) : clé présente et vide/null ⇒ NULL (effacement explicite).
    planned_team_size = CASE WHEN p_updates ? 'planned_team_size' THEN NULLIF(p_updates->>'planned_team_size', '')::SMALLINT ELSE planned_team_size END,
    planned_days = CASE WHEN p_updates ? 'planned_days' THEN NULLIF(p_updates->>'planned_days', '')::SMALLINT ELSE planned_days END,
    updated_at = COALESCE((p_updates->>'updated_at')::TIMESTAMPTZ, NOW())
  WHERE id = p_lead_id;

  RETURN QUERY SELECT * FROM majordhome.leads WHERE id = p_lead_id;
END;
$function$;

-- Charte multi-tenant : REVOKE FROM PUBLIC obligatoire (anon en hérite sinon).
-- Constaté le 2026-09-22 : anon pouvait EXECUTE (garde auth.uid() fail-close, mais
-- la règle est le REVOKE). Ni le site vitrine ni les edges n'appellent cette RPC.
REVOKE EXECUTE ON FUNCTION public.update_majordhome_lead(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_majordhome_lead(uuid, jsonb) TO authenticated, service_role;
