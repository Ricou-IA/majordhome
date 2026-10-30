-- 20261030_1_lead_projet_commercial.sql
-- « Projet » commercial du lead (décision d'Eric, 2026-10-25) : la liste commerciale est découplée du référentiel
-- d'entretien. Le référentiel (equipment_categories / pricing_equipment_types) reste celui de l'entretien et du parc
-- client — il n'est PAS touché ici. Le lead porte désormais leads.project_family_key = clé d'une famille de devis de
-- l'org (settings.devis.familles[].key, défauts DEFAULT_FAMILLES de src/lib/devisConfig.js) ; c'est elle qui
-- présélectionne l'installation d'un nouveau devis. Pas de FK possible (les familles vivent dans settings) : une clé
-- inconnue ou désactivée retombe sur le repli par libellé côté front, sans erreur.
-- Expansion seule : une colonne nullable, ajoutée à create_majordhome_lead / update_majordhome_lead (liste de colonnes
-- EXPLICITE : sans sa ligne, la colonne serait ignorée en silence) et EN FIN de la vue publique majordhome_leads.
-- CREATE OR REPLACE conserve les privilèges existants des deux fonctions.

ALTER TABLE majordhome.leads
  ADD COLUMN IF NOT EXISTS project_family_key text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_project_family_key_check') THEN
    ALTER TABLE majordhome.leads
      ADD CONSTRAINT leads_project_family_key_check CHECK (project_family_key ~ '^[a-z0-9_]+$');
  END IF;
END $$;

COMMENT ON COLUMN majordhome.leads.project_family_key IS
  'Projet commercial du lead : clé d''une famille de devis de l''org (settings.devis.familles[].key). Indépendant du référentiel d''équipements d''entretien.';

CREATE OR REPLACE FUNCTION public.create_majordhome_lead(p_data jsonb)
 RETURNS SETOF majordhome.leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $function$
DECLARE
  v_org_id UUID;
  v_lead_id UUID;
BEGIN
  -- Extraire org_id obligatoire
  v_org_id := (p_data->>'org_id')::UUID;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id requis';
  END IF;

  -- Vérifier l'accès org
  IF NOT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.org_id = v_org_id AND om.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  -- Insérer le lead
  INSERT INTO majordhome.leads (
    org_id,
    first_name,
    last_name,
    email,
    phone,
    phone_secondary,
    address,
    address_complement,
    postal_code,
    city,
    company_name,
    source_id,
    status_id,
    assigned_user_id,
    client_id,
    project_id,
    appointment_id,
    equipment_type_id,
    order_amount_ht,
    estimated_revenue,
    probability,
    notes,
    next_action,
    next_action_date,
    created_date,
    converted_date,
    appointment_date,
    quote_sent_date,
    won_date,
    estimated_date,
    lost_reason,
    external_id,
    external_source,
    external_data,
    chantier_status,
    equipment_order_status,
    materials_order_status,
    chantier_notes,
    planification_date,
    project_family_key
  ) VALUES (
    v_org_id,
    p_data->>'first_name',
    p_data->>'last_name',
    p_data->>'email',
    p_data->>'phone',
    p_data->>'phone_secondary',
    p_data->>'address',
    p_data->>'address_complement',
    p_data->>'postal_code',
    p_data->>'city',
    p_data->>'company_name',
    (p_data->>'source_id')::UUID,
    (p_data->>'status_id')::UUID,
    (p_data->>'assigned_user_id')::UUID,
    (p_data->>'client_id')::UUID,
    (p_data->>'project_id')::UUID,
    (p_data->>'appointment_id')::UUID,
    (p_data->>'equipment_type_id')::UUID,
    (p_data->>'order_amount_ht')::NUMERIC,
    (p_data->>'estimated_revenue')::NUMERIC,
    COALESCE((p_data->>'probability')::INTEGER, 50),
    p_data->>'notes',
    p_data->>'next_action',
    (p_data->>'next_action_date')::DATE,
    COALESCE((p_data->>'created_date')::DATE, CURRENT_DATE),
    (p_data->>'converted_date')::DATE,
    (p_data->>'appointment_date')::DATE,
    (p_data->>'quote_sent_date')::DATE,
    (p_data->>'won_date')::DATE,
    (p_data->>'estimated_date')::DATE,
    p_data->>'lost_reason',
    p_data->>'external_id',
    p_data->>'external_source',
    CASE WHEN p_data ? 'external_data' THEN p_data->'external_data' ELSE NULL END,
    p_data->>'chantier_status',
    p_data->>'equipment_order_status',
    p_data->>'materials_order_status',
    p_data->>'chantier_notes',
    (p_data->>'planification_date')::DATE,
    NULLIF(btrim(p_data->>'project_family_key'), '')
  )
  RETURNING id INTO v_lead_id;

  RETURN QUERY SELECT * FROM majordhome.leads WHERE id = v_lead_id;
END;
$function$;

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
    planned_team_size = CASE WHEN p_updates ? 'planned_team_size' THEN NULLIF(p_updates->>'planned_team_size', '')::SMALLINT ELSE planned_team_size END,
    planned_days = CASE WHEN p_updates ? 'planned_days' THEN NULLIF(p_updates->>'planned_days', '')::SMALLINT ELSE planned_days END,
    project_family_key = CASE WHEN p_updates ? 'project_family_key' THEN NULLIF(btrim(p_updates->>'project_family_key'), '') ELSE project_family_key END,
    updated_at = COALESCE((p_updates->>'updated_at')::TIMESTAMPTZ, NOW())
  WHERE id = p_lead_id;

  RETURN QUERY SELECT * FROM majordhome.leads WHERE id = p_lead_id;
END;
$function$;

CREATE OR REPLACE VIEW public.majordhome_leads WITH (security_invoker = true) AS
SELECT l.id,
    l.first_name,
    l.last_name,
    l.email,
    l.phone,
    l.phone_secondary,
    l.address,
    l.address_complement,
    l.postal_code,
    l.city,
    l.source_id,
    l.status_id,
    l.assigned_user_id,
    l.project_id,
    l.order_amount_ht,
    l.estimated_revenue,
    l.probability,
    l.notes,
    l.next_action,
    l.next_action_date,
    l.created_date,
    l.converted_date,
    l.lost_reason,
    l.is_deleted,
    l.external_id,
    l.external_source,
    l.external_data,
    l.created_at,
    l.updated_at,
    l.org_id,
    l.equipment_type_id,
    l.last_call_date,
    l.call_count,
    l.appointment_date,
    l.quote_sent_date,
    l.won_date,
    l.client_id,
    l.company_name,
    l.appointment_id,
    l.latitude,
    l.longitude,
    l.geocoded_at,
    l.zone,
    l.chantier_status,
    l.equipment_order_status,
    l.materials_order_status,
    l.estimated_date,
    l.chantier_notes,
    l.planification_date,
    l.last_call_result,
    l.email_sent,
    l.sort_order,
    l.followup_count,
    l.last_followup_date,
    l.pv_reception_path,
    l.email_unsubscribed_at,
    l.email_unsubscribe_reason,
    l.meta_campaign_id,
    l.meta_adset_id,
    l.meta_ad_id,
    l.status_changed_at,
    l.is_long_term_project,
    l.long_term_started_at,
    l.long_term_notes,
    s.label AS status_label,
    s.color AS status_color,
    s.display_order AS status_display_order,
    s.is_final AS status_is_final,
    s.is_won AS status_is_won,
    src.name AS source_name,
    src.color AS source_color,
    pet.label AS equipment_type_label,
    pet.category AS equipment_type_category,
    c.display_name AS client_display_name,
    c.client_number,
    ( SELECT max(li.created_at) AS max
           FROM majordhome.lead_interactions li
          WHERE li.lead_id = l.id) AS last_interaction_at,
    l.project_family_key
   FROM majordhome.leads l
     LEFT JOIN majordhome.statuses s ON s.id = l.status_id
     LEFT JOIN majordhome.sources src ON src.id = l.source_id
     LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = l.equipment_type_id
     LEFT JOIN majordhome.clients c ON c.id = l.client_id;

-- Charte multi-tenant : une vue public.majordhome_* ne doit jamais rester ouverte a anon (20261029_1).
REVOKE ALL ON public.majordhome_leads FROM PUBLIC, anon;
