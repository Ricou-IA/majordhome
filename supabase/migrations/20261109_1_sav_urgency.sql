-- supabase/migrations/20261109_1_sav_urgency.sql
-- ============================================================================
-- Degré d'urgence d'une demande SAV (Eric, 2026-11-09 : « il manque une
-- information primordiale : le degré d'urgence »). Porté par la carte
-- (intervention racine de type sav), saisi à la création, modifiable ensuite.
--
-- Trois niveaux : urgent | normal | peut_attendre. NULL = non renseigné, lu
-- comme « normal » par l'écran (src/lib/savUrgency.js) : aucune reprise de
-- données, les SAV déjà ouverts ne sont pas réécrits.
--
-- Vues : colonne ajoutée EN FIN de liste (CREATE OR REPLACE n'accepte rien
-- d'autre), définitions régénérées depuis la prod le 2026-11-09 :
--   - majordhome_interventions (miroir updatable : canal d'écriture de savService)
--   - majordhome_entretien_sav (lecture du kanban)
-- ============================================================================

ALTER TABLE majordhome.interventions
  ADD COLUMN IF NOT EXISTS sav_urgency text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interventions_sav_urgency_check') THEN
    ALTER TABLE majordhome.interventions
      ADD CONSTRAINT interventions_sav_urgency_check
      CHECK (sav_urgency IN ('urgent', 'normal', 'peut_attendre'));
  END IF;
END $$;

COMMENT ON COLUMN majordhome.interventions.sav_urgency IS
  'Degré d''urgence d''une demande SAV : urgent | normal | peut_attendre (NULL = non renseigné, lu comme normal). 2026-11-09.';

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
    planned_days,
    source_certificat_id,
    sav_urgency
   FROM majordhome.interventions;

-- ── Vue entretien / SAV (kanban) ───────────────────────────────────────────
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
    i.planned_days,
        CASE
            WHEN i.invoice_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN ( SELECT inv.import_status
               FROM majordhome.invoices inv
              WHERE inv.id = i.invoice_id::uuid)
            ELSE NULL::text
        END AS invoice_import_status,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('certificat_id', cert.id, 'intervention_id', cert.intervention_id, 'equipment_id', cert.equipment_id, 'equipement', NULLIF(btrim(concat_ws(' '::text, cert.equipement_marque, cert.equipement_modele)), ''::text), 'equipement_type', cert.equipement_type, 'bilan', cert.bilan_conformite, 'detail', cert.anomalies_detail, 'action', cert.action_corrective, 'date', cert.date_intervention, 'sav_id', sav.id, 'photo_plaque_path', cert.photo_plaque_path, 'photo_plaque_absence', cert.photo_plaque_absence) ORDER BY cert.date_intervention, cert.created_at) AS jsonb_agg
           FROM majordhome.certificats cert
             LEFT JOIN majordhome.interventions sav ON sav.source_certificat_id = cert.id
          WHERE (cert.intervention_id = i.id OR (cert.intervention_id IN ( SELECT ch.id
                   FROM majordhome.interventions ch
                  WHERE ch.parent_id = i.id))) AND (cert.bilan_conformite = ANY (ARRAY['anomalie'::text, 'arret_urgence'::text]))), '[]'::jsonb) AS anomalies,
    i.sav_urgency
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
