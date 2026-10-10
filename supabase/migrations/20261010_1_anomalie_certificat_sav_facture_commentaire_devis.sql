-- ============================================================================
-- 20261010_1 — Anomalie du certificat → carte Entretien, demande SAV, facture ;
--              commentaire sur le devis natif.
-- Spec : docs/superpowers/specs/2026-10-10-anomalie-certificat-sav-facture-commentaire-devis-design.md
--
-- 1. quotes.commentaire (visible par le client) — vues majordhome_quotes / _write (colonne en fin)
-- 2. interventions.source_certificat_id — une demande SAV par certificat « Devis à établir »
-- 3. invoices.client_note — information client imprimée, figée à l'émission
-- 4. majordhome_entretien_sav.anomalies — certificats non conformes agrégés (racine + enfants)
-- Répétée sur scripts/migration-rehearsal/ (assert-anomalie-certificat.sql).
-- ============================================================================

-- ── 1. Devis : commentaire visible par le client ───────────────────────────
ALTER TABLE majordhome.quotes ADD COLUMN IF NOT EXISTS commentaire text;
COMMENT ON COLUMN majordhome.quotes.commentaire IS
  'Commentaire libre propre à ce devis, imprimé sur le PDF (≠ conditions de vente, ≠ notes_internes).';

-- Vue JOIN (lecture) : CREATE OR REPLACE n'autorise l'ajout qu'EN FIN de liste.
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
    q.commentaire
   FROM majordhome.quotes q
     LEFT JOIN majordhome.clients c ON c.id = q.client_id
     LEFT JOIN majordhome.leads l ON l.id = q.lead_id;

-- Miroir updatable (écriture)
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
    commentaire
   FROM majordhome.quotes;

-- ── 2. Interventions : demande SAV ouverte depuis un certificat ────────────
ALTER TABLE majordhome.interventions
  ADD COLUMN IF NOT EXISTS source_certificat_id uuid REFERENCES majordhome.certificats(id) ON DELETE SET NULL;
COMMENT ON COLUMN majordhome.interventions.source_certificat_id IS
  'Certificat d''entretien dont le bilan (« Devis à établir ») a ouvert cette demande SAV. Unique : un certificat = au plus une demande.';
CREATE UNIQUE INDEX IF NOT EXISTS interventions_source_certificat_uniq
  ON majordhome.interventions (source_certificat_id) WHERE source_certificat_id IS NOT NULL;

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
    source_certificat_id
   FROM majordhome.interventions;

-- ── 3. Factures : information client imprimée ──────────────────────────────
ALTER TABLE majordhome.invoices ADD COLUMN IF NOT EXISTS client_note text;
COMMENT ON COLUMN majordhome.invoices.client_note IS
  'Information client imprimée sur la facture (bloc « Information »), ex. anomalie constatée à l''entretien. Figée à l''émission.';

-- `i.*` est développé à la création : la nouvelle colonne passerait avant credited_number ⇒ DROP + CREATE.
DROP VIEW IF EXISTS public.majordhome_invoices;
CREATE VIEW public.majordhome_invoices WITH (security_invoker = true) AS
  SELECT i.*,
         (SELECT o.number FROM majordhome.invoices o WHERE o.id = i.credited_invoice_id) AS credited_number
    FROM majordhome.invoices i;
REVOKE ALL ON public.majordhome_invoices FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.majordhome_invoices TO authenticated;
GRANT SELECT ON public.majordhome_invoices TO service_role;
COMMENT ON VIEW public.majordhome_invoices IS
  'Miroir auto-updatable de majordhome.invoices (security_invoker, RLS org) + credited_number (numéro de la facture créditée par un avoir). Brouillon : UPDATE libre sauf colonnes d''émission ; émise : colonnes de suivi seulement ; INSERT via invoice_create_draft / invoice_cancel_with_credit_note.';

-- Brouillon : client_note dans l'INSERT (corps identique à 20260923_3, + une colonne).
CREATE OR REPLACE FUNCTION public.invoice_create_draft(p_invoice jsonb, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_id uuid;
  v_line jsonb;
  v_count int := 0;
  v_header_ht numeric(12,2);
  v_header_tva numeric(12,2);
  v_header_ttc numeric(12,2);
  v_sum_ht numeric(12,2);
  v_sum_tva numeric(12,2);
  v_sum_ttc numeric(12,2);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := (p_invoice->>'org_id')::uuid;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_role FROM core.organization_members
   WHERE org_id = v_org AND user_id = v_user LIMIT 1;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_leader_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'lines_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO majordhome.invoices (
    org_id, kind, context, client_id, contract_id, intervention_id, customer, subject, currency,
    due_days, total_ht, total_tva, total_ttc, vat_breakdown, discount, created_by, client_note
  ) VALUES (
    v_org,
    COALESCE(p_invoice->>'kind', 'invoice'),
    COALESCE(p_invoice->>'context', 'contrat'),
    (p_invoice->>'client_id')::uuid,
    (p_invoice->>'contract_id')::uuid,
    (p_invoice->>'intervention_id')::uuid,
    COALESCE(p_invoice->'customer', '{}'::jsonb),
    p_invoice->>'subject',
    COALESCE(p_invoice->>'currency', 'EUR'),
    COALESCE((p_invoice->>'due_days')::int, 30),
    COALESCE((p_invoice->>'total_ht')::numeric, 0),
    COALESCE((p_invoice->>'total_tva')::numeric, 0),
    COALESCE((p_invoice->>'total_ttc')::numeric, 0),
    COALESCE(p_invoice->'vat_breakdown', '[]'::jsonb),
    p_invoice->'discount',
    v_user,
    NULLIF(btrim(p_invoice->>'client_note'), '')
  ) RETURNING id, total_ht, total_tva, total_ttc INTO v_id, v_header_ht, v_header_tva, v_header_ttc;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_count := v_count + 1;
    INSERT INTO majordhome.invoice_lines (
      invoice_id, org_id, position, kind, label, description, quantity, unit_price_ht, vat_rate,
      discount_percent, ht, tva, ttc, ledger_account_number, ledger_account_pl_id, metier_key,
      equipment_id, category_id, vat_code
    ) VALUES (
      v_id, v_org,
      COALESCE((v_line->>'position')::int, v_count),
      COALESCE(v_line->>'kind', 'libre'),
      v_line->>'label',
      v_line->>'description',
      COALESCE((v_line->>'quantity')::numeric, 1),
      COALESCE((v_line->>'unit_price_ht')::numeric, 0),
      COALESCE((v_line->>'vat_rate')::numeric, 20),
      COALESCE((v_line->>'discount_percent')::numeric, 0),
      COALESCE((v_line->>'ht')::numeric, 0),
      COALESCE((v_line->>'tva')::numeric, 0),
      COALESCE((v_line->>'ttc')::numeric, 0),
      v_line->>'ledger_account_number',
      (v_line->>'ledger_account_pl_id')::bigint,
      v_line->>'metier_key',
      (v_line->>'equipment_id')::uuid,
      (v_line->>'category_id')::uuid,
      v_line->>'vat_code'
    );
  END LOOP;

  SELECT sum(ht), sum(tva), sum(ttc) INTO v_sum_ht, v_sum_tva, v_sum_ttc
    FROM majordhome.invoice_lines WHERE invoice_id = v_id;
  IF v_sum_ht IS DISTINCT FROM v_header_ht
     OR v_sum_tva IS DISTINCT FROM v_header_tva
     OR v_sum_ttc IS DISTINCT FROM v_header_ttc
  THEN
    RAISE EXCEPTION 'totals_mismatch' USING ERRCODE = '22023',
      DETAIL = format('en-tête (ht=%s, tva=%s, ttc=%s) ≠ somme des lignes (ht=%s, tva=%s, ttc=%s)',
        v_header_ht, v_header_tva, v_header_ttc, v_sum_ht, v_sum_tva, v_sum_ttc);
  END IF;

  RETURN v_id;
END;
$function$;
-- CREATE OR REPLACE conserve les droits en prod ; on les réaffirme (PUBLIC obligatoire, cf. charte).
REVOKE EXECUTE ON FUNCTION public.invoice_create_draft(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_create_draft(jsonb, jsonb) TO authenticated, service_role;

-- Facture émise : client_note figée comme le reste de l'en-tête (correction = avoir).
CREATE OR REPLACE FUNCTION majordhome.invoices_guard_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_issuing boolean;
BEGIN
  IF OLD.status = 'draft' THEN
    v_issuing := (current_setting('majordhome.invoice_issue_id', true) = OLD.id::text);
    IF (v_issuing IS NOT TRUE) AND (
         NEW.status IS DISTINCT FROM OLD.status
      OR NEW.number IS DISTINCT FROM OLD.number
      OR NEW.year IS DISTINCT FROM OLD.year
      OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
      OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
      OR NEW.due_at IS DISTINCT FROM OLD.due_at
    ) THEN
      RAISE EXCEPTION 'invoice_immutable' USING ERRCODE = '42501',
        DETAIL = 'numéro et émission réservés à invoice_issue';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number
     OR NEW.year IS DISTINCT FROM OLD.year
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.credited_invoice_id IS DISTINCT FROM OLD.credited_invoice_id
     OR NEW.context IS DISTINCT FROM OLD.context
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
     OR NEW.intervention_id IS DISTINCT FROM OLD.intervention_id
     OR NEW.customer IS DISTINCT FROM OLD.customer
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.client_note IS DISTINCT FROM OLD.client_note
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.due_days IS DISTINCT FROM OLD.due_days
     OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.total_ht IS DISTINCT FROM OLD.total_ht
     OR NEW.total_tva IS DISTINCT FROM OLD.total_tva
     OR NEW.total_ttc IS DISTINCT FROM OLD.total_ttc
     OR NEW.vat_breakdown IS DISTINCT FROM OLD.vat_breakdown
     OR NEW.discount IS DISTINCT FROM OLD.discount
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
  THEN
    RAISE EXCEPTION 'invoice_immutable' USING ERRCODE = '42501',
      DETAIL = format('Facture %s émise : en-tête figé, correction par avoir.', OLD.number);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'issued' AND NEW.status = 'cancelled') THEN
    RAISE EXCEPTION 'invoice_immutable' USING ERRCODE = '42501',
      DETAIL = format('Facture %s : transition %s → %s interdite.', OLD.number, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 4. Vue Kanban Entretien : anomalies des certificats (racine + enfants) ──
-- Corps identique à 20260923_3 ; `anomalies` ajoutée EN FIN (CREATE OR REPLACE).
-- Un élément par certificat dont le bilan n'est pas conforme ; `sav_id` = demande SAV ouverte
-- depuis ce certificat (interventions.source_certificat_id). La source reste le certificat.
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
    COALESCE(( SELECT jsonb_agg(jsonb_build_object(
                'certificat_id', cert.id,
                'intervention_id', cert.intervention_id,
                'equipment_id', cert.equipment_id,
                'equipement', NULLIF(btrim(concat_ws(' '::text, cert.equipement_marque, cert.equipement_modele)), ''::text),
                'equipement_type', cert.equipement_type,
                'bilan', cert.bilan_conformite,
                'detail', cert.anomalies_detail,
                'action', cert.action_corrective,
                'date', cert.date_intervention,
                'sav_id', sav.id) ORDER BY cert.date_intervention, cert.created_at)
           FROM majordhome.certificats cert
             LEFT JOIN majordhome.interventions sav ON sav.source_certificat_id = cert.id
          WHERE (cert.intervention_id = i.id OR (cert.intervention_id IN ( SELECT ch.id
                   FROM majordhome.interventions ch
                  WHERE ch.parent_id = i.id)))
            AND cert.bilan_conformite = ANY (ARRAY['anomalie'::text, 'arret_urgence'::text])), '[]'::jsonb) AS anomalies
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

NOTIFY pgrst, 'reload schema';
