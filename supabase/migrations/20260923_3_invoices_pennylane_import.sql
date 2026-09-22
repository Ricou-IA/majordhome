-- supabase/migrations/20260923_3_invoices_pennylane_import.sql
-- ============================================================================
-- Hub de facturation — phase 2 : import de la facture émise dans Pennylane
-- (spec 2026-09-22, § Flux étape 3). Journal de ventes principal (décision Eric
-- 2026-09-22 soir), aucun déplacement d'écriture.
--   - invoice_lines.vat_code : code TVA Pennylane figé à la création (FR_200…),
--     pour que l'edge n'ait pas à recopier la table de correspondance du modèle.
--   - invoices.import_attempted_at : dernière tentative (succès ou échec).
--   - invoice_set_import_result : SEULE voie d'écriture du résultat d'import
--     (service_role only : prend un invoice_id sans auth.uid()).
--   - majordhome_entretien_sav.invoice_import_status : pilote le bouton de rejeu.
-- Répétée sur scripts/migration-rehearsal/ (assert-invoices-import.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colonnes
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.invoice_lines ADD COLUMN IF NOT EXISTS vat_code text;
COMMENT ON COLUMN majordhome.invoice_lines.vat_code IS
  'Code TVA Pennylane figé à la création du brouillon (FR_200, FR_100, FR_55, exempt) — VAT_CODES de src/lib/entretienInvoiceModel.js. NULL = 20 % par défaut à l''import.';

ALTER TABLE majordhome.invoices ADD COLUMN IF NOT EXISTS import_attempted_at timestamptz;
COMMENT ON COLUMN majordhome.invoices.import_attempted_at IS
  'Dernière tentative d''import Pennylane (succès ou échec), posée par invoice_set_import_result.';

-- ----------------------------------------------------------------------------
-- 2. invoice_create_draft — corps identique à 20260923_1 + vat_code par ligne
-- ----------------------------------------------------------------------------
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
  -- Garde POSITIVE (jamais « IF NOT … » : NULL ouvrirait la porte)
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
    due_days, total_ht, total_tva, total_ttc, vat_breakdown, discount, created_by
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
    v_user
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

  -- En-tête et lignes doivent porter le même montant : évite qu'une facture parte avec un
  -- total affiché qui ne correspond pas à la somme réelle des lignes comptables.
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

REVOKE EXECUTE ON FUNCTION public.invoice_create_draft(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_create_draft(jsonb, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC — résultat d'import (service_role only : invoice_id dans le payload)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_set_import_result(
  p_invoice_id uuid,
  p_status text,
  p_pennylane_invoice_id bigint DEFAULT NULL,
  p_pennylane_ledger_entry_id bigint DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_status text;
  v_status_out text;
  v_error_out text;
  v_attempted timestamptz;
  v_pl_id bigint;
  v_ledger_id bigint;
BEGIN
  IF p_status NOT IN ('pending', 'imported', 'error') THEN
    RAISE EXCEPTION 'invalid_import_status' USING ERRCODE = '22023', DETAIL = p_status;
  END IF;
  SELECT status INTO v_status FROM majordhome.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'issued' THEN
    RAISE EXCEPTION 'invoice_not_issued' USING ERRCODE = '22023', DETAIL = v_status;
  END IF;
  IF p_status = 'imported' AND p_pennylane_invoice_id IS NULL THEN
    RAISE EXCEPTION 'pennylane_invoice_id_required' USING ERRCODE = '22023';
  END IF;

  UPDATE majordhome.invoices
     SET import_status = p_status,
         import_error = CASE WHEN p_status = 'error' THEN left(p_error, 2000) ELSE NULL END,
         import_attempted_at = now(),
         pennylane_invoice_id = COALESCE(p_pennylane_invoice_id, pennylane_invoice_id),
         pennylane_ledger_entry_id = COALESCE(p_pennylane_ledger_entry_id, pennylane_ledger_entry_id)
   WHERE id = p_invoice_id
   RETURNING import_status, import_error, import_attempted_at, pennylane_invoice_id, pennylane_ledger_entry_id
     INTO v_status_out, v_error_out, v_attempted, v_pl_id, v_ledger_id;

  RETURN jsonb_build_object('id', p_invoice_id, 'import_status', v_status_out,
    'import_error', v_error_out, 'pennylane_invoice_id', v_pl_id,
    'pennylane_ledger_entry_id', v_ledger_id, 'import_attempted_at', v_attempted);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_set_import_result(uuid, text, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_set_import_result(uuid, text, bigint, bigint, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Vues miroirs recréées (SELECT * est figé à la création : nouvelles colonnes)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.majordhome_invoices;
CREATE VIEW public.majordhome_invoices WITH (security_invoker = true) AS
  SELECT * FROM majordhome.invoices;

DROP VIEW IF EXISTS public.majordhome_invoice_lines;
CREATE VIEW public.majordhome_invoice_lines WITH (security_invoker = true) AS
  SELECT * FROM majordhome.invoice_lines;

REVOKE ALL ON public.majordhome_invoices, public.majordhome_invoice_lines FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.majordhome_invoices TO authenticated;
GRANT SELECT ON public.majordhome_invoice_lines TO authenticated;
GRANT SELECT ON public.majordhome_invoices, public.majordhome_invoice_lines TO service_role;

COMMENT ON VIEW public.majordhome_invoices IS
  'Miroir auto-updatable de majordhome.invoices (security_invoker, RLS org). Lecture front ; sur un brouillon, UPDATE libre sauf status/number/year/issued_at/invoice_date/due_at réservés à la RPC invoice_issue ; sur une facture émise, UPDATE limité aux colonnes de suivi (pdf_path, pennylane_*, import_*) ; INSERT via invoice_create_draft ; résultat d''import via invoice_set_import_result (service_role).';
COMMENT ON VIEW public.majordhome_invoice_lines IS
  'Miroir de majordhome.invoice_lines (security_invoker, RLS org). Lecture front ; écriture via invoice_create_draft.';

-- ----------------------------------------------------------------------------
-- 5. majordhome_entretien_sav + invoice_import_status (EN FIN de liste)
--    Définition recopiée de 20260922_1_planned_order.sql (= prod au 2026-09-22),
--    seule la dernière colonne est ajoutée. `interventions.invoice_id` (text)
--    porte un id Pennylane (chiffres) ou un uuid Majord'home : le cast est
--    protégé par le CASE (un cast direct casserait TOUTE la vue).
-- ----------------------------------------------------------------------------
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
    CASE WHEN i.invoice_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         THEN ( SELECT inv.import_status FROM majordhome.invoices inv WHERE inv.id = i.invoice_id::uuid)
         ELSE NULL::text END AS invoice_import_status
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
