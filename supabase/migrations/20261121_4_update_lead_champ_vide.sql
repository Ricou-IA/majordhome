-- 20261121_4 — update_majordhome_lead : un champ vidé dans la fiche lead est réellement vidé
--
-- Constat (Eric, 2026-11-21) : complément d'adresse effacé dans la fiche, enregistré,
-- et la valeur revient. Cause : `col = COALESCE(p_updates->>'col', col)`. La fiche envoie
-- `null` pour un champ vide, `->>` rend NULL, COALESCE garde l'ancienne valeur : aucun
-- champ texte ne pouvait être vidé, sans erreur.
--
-- Correctif : pour les champs que la fiche peut vider, la présence de la CLÉ décide
-- (`p_updates ? 'col'`), comme pour les colonnes ajoutées depuis. Clé absente = inchangé.
-- `last_name` reste en COALESCE (jamais vide). Chaîne vide ou espaces = NULL.
-- Appelants vérifiés : aucun n'envoie ces clés à null sans vouloir vider
-- (seule la fiche lead, via buildLeadPayload, les envoie toutes).
--
-- CREATE OR REPLACE : signature inchangée, les droits (REVOKE PUBLIC, anon) sont conservés.

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
    first_name = CASE WHEN p_updates ? 'first_name' THEN NULLIF(btrim(p_updates->>'first_name'), '') ELSE first_name END,
    last_name = COALESCE(p_updates->>'last_name', last_name),
    email = CASE WHEN p_updates ? 'email' THEN NULLIF(btrim(p_updates->>'email'), '') ELSE email END,
    phone = CASE WHEN p_updates ? 'phone' THEN NULLIF(btrim(p_updates->>'phone'), '') ELSE phone END,
    phone_secondary = CASE WHEN p_updates ? 'phone_secondary' THEN NULLIF(btrim(p_updates->>'phone_secondary'), '') ELSE phone_secondary END,
    address = CASE WHEN p_updates ? 'address' THEN NULLIF(btrim(p_updates->>'address'), '') ELSE address END,
    address_complement = CASE WHEN p_updates ? 'address_complement' THEN NULLIF(btrim(p_updates->>'address_complement'), '') ELSE address_complement END,
    postal_code = CASE WHEN p_updates ? 'postal_code' THEN NULLIF(btrim(p_updates->>'postal_code'), '') ELSE postal_code END,
    city = CASE WHEN p_updates ? 'city' THEN NULLIF(btrim(p_updates->>'city'), '') ELSE city END,
    company_name = CASE WHEN p_updates ? 'company_name' THEN NULLIF(btrim(p_updates->>'company_name'), '') ELSE company_name END,
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
    notes = CASE WHEN p_updates ? 'notes' THEN NULLIF(btrim(p_updates->>'notes'), '') ELSE notes END,
    next_action = CASE WHEN p_updates ? 'next_action' THEN NULLIF(btrim(p_updates->>'next_action'), '') ELSE next_action END,
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
