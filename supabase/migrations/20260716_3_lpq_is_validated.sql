-- supabase/migrations/20260716_3_lpq_is_validated.sql
-- ============================================================================
-- Expose le booléen is_validated sur la vue pivot pour que le frontend chantier
-- filtre sans recopier l'allowlist en JS. Source : quote_status_bucket().
--
-- Colonne ajoutée EN FIN de liste (CREATE OR REPLACE VIEW ne l'autorise nulle
-- part ailleurs). Vue déjà non-updatable (is_insertable_into=NO), écritures via
-- RPC (lead_pennylane_quotes_link_client) -> aucun risque de régression.
-- ============================================================================
CREATE OR REPLACE VIEW public.majordhome_lead_pennylane_quotes
WITH (security_invoker = true) AS
 SELECT lpq.id,
    lpq.org_id,
    lpq.lead_id,
    lpq.pennylane_quote_id,
    lpq.pennylane_customer_id,
    lpq.pennylane_client_id,
    lpq.quote_amount_ht,
    lpq.quote_label,
    lpq.quote_date,
    lpq.quote_status,
    lpq.pdf_url,
    lpq.assigned_at,
    lpq.ejected_at,
    lpq.ejected_reason,
    lpq.created_at,
    lpq.is_winning_quote,
    l.last_name AS lead_last_name,
    l.first_name AS lead_first_name,
    l.status_id AS lead_status_id,
    l.client_id,
    c.client_number,
    c.last_name AS client_last_name,
    c.first_name AS client_first_name,
    c.pennylane_account_number AS client_pl_number,
    majordhome.quote_status_bucket(lpq.quote_status) = 'validated' AS is_validated
   FROM majordhome.lead_pennylane_quotes lpq
     JOIN majordhome.leads l ON l.id = lpq.lead_id
     LEFT JOIN majordhome.clients c ON c.id = l.client_id;
