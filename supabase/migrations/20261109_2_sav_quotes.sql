-- supabase/migrations/20261109_2_sav_quotes.sql
-- ============================================================================
-- Devis créé depuis la fiche SAV (Eric, 2026-11-09 : « que la fiche SAV reprenne
-- la modale de création de devis »). Le devis natif est fléché vers la carte SAV :
--   quotes.intervention_id → majordhome.interventions(id)
-- Il reste rattaché au client (client_id) et ne crée AUCUN lead : un SAV n'est
-- pas une affaire commerciale. C'est le « fléchage vers la carte SAV » décidé le
-- 2026-10-12 (jusqu'ici la carte SAV ne portait aucun lien vers un devis).
--
-- 1. Colonne + index + garde « même organisation que la carte » (trigger).
-- 2. Vues : colonne ajoutée EN FIN de liste, définitions régénérées depuis la
--    prod le 2026-11-09 :
--      - majordhome_quotes / majordhome_quotes_write : intervention_id
--      - majordhome_entretien_sav : sav_quotes (jsonb, devis de la carte, du plus
--        récent au plus ancien) — la carte lit les devis à la source, rien n'est
--        recopié sur l'intervention.
-- 3. pennylane_sync_auto_attach_pending : un devis fléché SAV n'est JAMAIS
--    rattaché automatiquement à une carte du pipeline (sinon, au-dessus du seuil,
--    il placerait un lead en « Devis envoyé » et créerait un chantier à
--    l'acceptation). Définition régénérée depuis la prod, une clause ajoutée ;
--    CREATE OR REPLACE conserve les droits (service_role seul).
-- ============================================================================

ALTER TABLE majordhome.quotes
  ADD COLUMN IF NOT EXISTS intervention_id uuid REFERENCES majordhome.interventions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotes_intervention_id_idx
  ON majordhome.quotes (intervention_id) WHERE intervention_id IS NOT NULL;

COMMENT ON COLUMN majordhome.quotes.intervention_id IS
  'Carte SAV à laquelle le devis est fléché (NULL = devis de lead ou de client). Un devis fléché SAV n''entre jamais dans le pipeline commercial. 2026-11-09.';

-- Garde positive : le devis et la carte appartiennent à la même organisation.
-- SECURITY INVOKER : l'intervention se lit avec les droits de l'appelant (une carte d'une
-- autre org est invisible ⇒ org NULL ⇒ refus) ; aucun privilège n'est prêté.
CREATE OR REPLACE FUNCTION majordhome.quotes_check_intervention_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF NEW.intervention_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT majordhome.project_org_id(i.project_id) INTO v_org
    FROM majordhome.interventions i
   WHERE i.id = NEW.intervention_id;
  IF (v_org = NEW.org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'quote_intervention_org_mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION majordhome.quotes_check_intervention_org() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION majordhome.quotes_check_intervention_org() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_quotes_check_intervention_org ON majordhome.quotes;
CREATE TRIGGER trg_quotes_check_intervention_org
  BEFORE INSERT OR UPDATE OF intervention_id, org_id ON majordhome.quotes
  FOR EACH ROW EXECUTE FUNCTION majordhome.quotes_check_intervention_org();

-- ── Vues des devis ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.majordhome_quotes WITH (security_invoker = true) AS
SELECT q.id,
    q.org_id,
    q.quote_number,
    q.lead_id,
    q.client_id,
    q.status,
    q.subject,
    q.validity_days,
    q.validity_date,
    q.total_ht,
    q.total_tva,
    q.total_ttc,
    q.global_discount_percent,
    q.conditions,
    q.notes_internes,
    q.sent_at,
    q.accepted_at,
    q.refused_at,
    q.quote_pdf_path,
    q.pennylane_quote_id,
    q.pennylane_synced_at,
    q.created_by,
    q.created_at,
    q.updated_at,
    COALESCE(c.first_name, l.first_name) AS client_first_name,
    COALESCE(c.last_name, l.last_name) AS client_last_name,
    COALESCE(NULLIF(concat_ws(' '::text, c.first_name, c.last_name), ''::text), NULLIF(concat_ws(' '::text, l.first_name, l.last_name), ''::text), ''::text) AS client_display_name,
    COALESCE(c.address, l.address) AS client_address,
    COALESCE(c.postal_code, l.postal_code) AS client_postal_code,
    COALESCE(c.city, l.city) AS client_city,
    COALESCE(c.phone, l.phone) AS client_phone,
    COALESCE(c.email, l.email) AS client_email,
    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name,
    l.status_id AS lead_status_id,
    q.commentaire,
    q.intervention_id
   FROM majordhome.quotes q
     LEFT JOIN majordhome.clients c ON c.id = q.client_id
     LEFT JOIN majordhome.leads l ON l.id = q.lead_id;

CREATE OR REPLACE VIEW public.majordhome_quotes_write WITH (security_invoker = true) AS
SELECT id,
    org_id,
    quote_number,
    lead_id,
    client_id,
    status,
    subject,
    validity_days,
    validity_date,
    total_ht,
    total_tva,
    total_ttc,
    global_discount_percent,
    conditions,
    notes_internes,
    sent_at,
    accepted_at,
    refused_at,
    quote_pdf_path,
    pennylane_quote_id,
    pennylane_synced_at,
    created_by,
    created_at,
    updated_at,
    commentaire,
    intervention_id
   FROM majordhome.quotes;

-- ── Vue entretien / SAV (kanban) : devis de la carte ───────────────────────
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
    i.sav_urgency,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', sq.id, 'quote_number', sq.quote_number, 'status', sq.status, 'subject', sq.subject, 'total_ht', sq.total_ht, 'total_ttc', sq.total_ttc, 'pennylane_quote_id', sq.pennylane_quote_id, 'created_at', sq.created_at) ORDER BY sq.created_at DESC) FROM majordhome.quotes sq WHERE sq.intervention_id = i.id), '[]'::jsonb) AS sav_quotes
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

-- ── Rattachement automatique : les devis fléchés SAV sont exclus ───────────
CREATE OR REPLACE FUNCTION public.pennylane_sync_auto_attach_pending(p_org_id uuid, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_min      numeric := majordhome.pl_pipeline_min_amount_ht(p_org_id);
  r          record;
  v_lead     uuid;
  v_by       text;
  v_res      jsonb;
  v_examined int := 0;
  v_attached int := 0;
  v_no_lead  int := 0;
  v_skipped  int := 0;
  v_details  jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT q.pennylane_quote_id, q.customer_id, q.amount_ht, q.quote_number, q.label,
           q.quote_date, q.status, q.pdf_url
    FROM majordhome.pennylane_quotes q
    WHERE q.org_id = p_org_id
      AND q.missing_since IS NULL
      AND q.archived_at IS NULL
      AND q.customer_id IS NOT NULL
      AND q.status IN ('pending', 'expired', 'accepted', 'invoiced', 'denied')
      AND q.amount_ht IS NOT NULL
      AND q.amount_ht >= v_min
      AND NOT EXISTS (
        SELECT 1 FROM majordhome.lead_pennylane_quotes lq
        WHERE lq.org_id = q.org_id AND lq.pennylane_quote_id = q.pennylane_quote_id)
      AND NOT EXISTS (
        SELECT 1 FROM majordhome.pennylane_quote_dismissals d
        WHERE d.org_id = q.org_id AND d.pennylane_quote_id = q.pennylane_quote_id)
      -- Devis natif fléché vers une carte SAV (quotes.intervention_id, 20261109_2) : il appartient
      -- au SAV, jamais au pipeline commercial — pas de carte « Devis envoyé », pas de chantier.
      AND NOT EXISTS (
        SELECT 1 FROM majordhome.quotes nq
        WHERE nq.org_id = q.org_id
          AND nq.intervention_id IS NOT NULL
          AND nq.pennylane_quote_id = q.pennylane_quote_id::text)
    ORDER BY q.quote_date, q.pennylane_quote_id
  LOOP
    v_examined := v_examined + 1;
    v_lead := NULL; v_by := NULL;

    -- (a) pont par devis déjà rattaché (rangée la plus récente, carte non supprimée)
    SELECT lq.lead_id INTO v_lead
    FROM majordhome.lead_pennylane_quotes lq
    JOIN majordhome.leads l ON l.id = lq.lead_id
    WHERE lq.org_id = p_org_id
      AND lq.pennylane_customer_id = r.customer_id
      AND lq.ejected_at IS NULL
      AND COALESCE(l.is_deleted, false) = false
    ORDER BY lq.assigned_at DESC
    LIMIT 1;
    IF v_lead IS NOT NULL THEN v_by := 'bridge'; END IF;

    -- (b) carte active du client ponté / du contact Pennylane
    IF v_lead IS NULL THEN
      SELECT f.lead_id, f.matched_by INTO v_lead, v_by
      FROM majordhome.find_active_lead(
        p_org_id,
        (SELECT s.local_id FROM majordhome.pennylane_sync s
          WHERE s.org_id = p_org_id AND s.entity_type = 'client' AND s.pennylane_id = r.customer_id
          ORDER BY s.created_at DESC LIMIT 1),
        (SELECT k.email FROM majordhome.pennylane_customer_lookup k
          WHERE k.org_id = p_org_id AND k.pennylane_id = r.customer_id LIMIT 1),
        (SELECT k.phone FROM majordhome.pennylane_customer_lookup k
          WHERE k.org_id = p_org_id AND k.pennylane_id = r.customer_id LIMIT 1)
      ) f;
    END IF;

    IF v_lead IS NULL THEN
      v_no_lead := v_no_lead + 1;
      IF jsonb_array_length(v_details) < 50 THEN
        v_details := v_details || jsonb_build_object(
          'quote_pl_id', r.pennylane_quote_id, 'quote_number', r.quote_number,
          'amount_ht', r.amount_ht, 'customer_id', r.customer_id, 'result', 'no_lead');
      END IF;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      IF jsonb_array_length(v_details) < 50 THEN
        v_details := v_details || jsonb_build_object(
          'quote_pl_id', r.pennylane_quote_id, 'quote_number', r.quote_number,
          'amount_ht', r.amount_ht, 'customer_id', r.customer_id,
          'lead_id', v_lead, 'matched_by', v_by, 'result', 'dry_run');
      END IF;
      CONTINUE;
    END IF;

    v_res := public.pennylane_sync_auto_attach_quote(
      p_org_id, v_lead, r.pennylane_quote_id, r.customer_id, r.amount_ht,
      COALESCE(r.quote_number, r.label, 'Q-' || r.pennylane_quote_id::text),
      COALESCE(r.quote_date, CURRENT_DATE), r.status, r.pdf_url);

    IF (v_res->>'attached')::boolean IS TRUE THEN
      v_attached := v_attached + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
    IF jsonb_array_length(v_details) < 50 THEN
      v_details := v_details || jsonb_build_object(
        'quote_pl_id', r.pennylane_quote_id, 'quote_number', r.quote_number,
        'amount_ht', r.amount_ht, 'customer_id', r.customer_id,
        'lead_id', v_lead, 'matched_by', v_by,
        'result', CASE WHEN (v_res->>'attached')::boolean IS TRUE THEN 'attached' ELSE COALESCE(v_res->>'reason', 'skipped') END,
        'status_bumped', (v_res->>'status_bumped')::boolean);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'min_amount_ht', v_min, 'dry_run', p_dry_run,
    'examined', v_examined, 'attached', v_attached, 'no_lead', v_no_lead, 'skipped', v_skipped,
    'details', v_details);
END
$function$;
