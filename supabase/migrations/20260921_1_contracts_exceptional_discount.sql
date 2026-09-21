-- supabase/migrations/20260921_1_contracts_exceptional_discount.sql
-- ============================================================================
-- Remise exceptionnelle sur un contrat d'entretien (Eric, 2026-09-21) :
-- total = sous-total − dégressivité − remise exceptionnelle. Permet d'ajuster le
-- montant global à l'euro près sans forcer chaque ligne. Reprise sur le PDF
-- contrat, l'écran de signature et la facture Pennylane (remise relative par
-- ligne). Colonne NOT NULL DEFAULT 0 : les contrats existants ne changent pas.
--
-- Vues : `majordhome_contracts` (JOIN clients, colonnes explicites → ajout EN FIN
-- de liste, CREATE OR REPLACE n'accepte rien d'autre) et `majordhome_contracts_write`
-- (miroir updatable, idem). Définitions recopiées de la prod le 2026-09-21.
-- ============================================================================

ALTER TABLE majordhome.contracts
  ADD COLUMN IF NOT EXISTS exceptional_discount numeric(10,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_exceptional_discount_nonneg'
  ) THEN
    ALTER TABLE majordhome.contracts
      ADD CONSTRAINT contracts_exceptional_discount_nonneg CHECK (exceptional_discount >= 0);
  END IF;
END $$;

COMMENT ON COLUMN majordhome.contracts.exceptional_discount IS
  'Remise exceptionnelle (TTC, €) appliquée après la dégressivité — total = sous-total − dégressivité − remise exceptionnelle. Saisie Tarification du contrat (org_admin). 2026-09-21.';

CREATE OR REPLACE VIEW public.majordhome_contracts WITH (security_invoker = true) AS
 SELECT c.id,
    c.org_id,
    c.client_id,
    c.contract_number,
    c.status,
    c.frequency,
    c.start_date,
    c.end_date,
    c.renewal_date,
    c.next_maintenance_date,
    c.amount,
    c.amount_forced,
    c.notes,
    c.created_at,
    c.updated_at,
    c.maintenance_month,
    c.estimated_time,
    c.zone_id,
    c.subtotal,
    c.discount_percent,
    c.source,
    c.contract_pdf_path,
    c.signed_at,
    c.signature_client_base64,
    c.signature_client_nom,
    c.cancellation_reason,
    c.cancelled_at,
    c.workflow_status,
    cl.last_name AS client_name,
    cl.first_name AS client_first_name,
    cl.address AS client_address,
    cl.postal_code AS client_postal_code,
    cl.city AS client_city,
    cl.phone AS client_phone,
    cl.email AS client_email,
    cl.client_number,
    cl.project_id AS client_project_id,
    mv.status AS current_year_visit_status,
    c.exceptional_discount
   FROM majordhome.contracts c
     LEFT JOIN majordhome.clients cl ON cl.id = c.client_id
     LEFT JOIN LATERAL ( SELECT mv2.status
           FROM majordhome.maintenance_visits mv2
          WHERE mv2.contract_id = c.id AND mv2.visit_year = (EXTRACT(year FROM CURRENT_DATE))::integer
          ORDER BY mv2.created_at DESC
         LIMIT 1) mv ON true;

CREATE OR REPLACE VIEW public.majordhome_contracts_write WITH (security_invoker = true) AS
 SELECT id,
    org_id,
    client_id,
    contract_number,
    status,
    workflow_status,
    frequency,
    start_date,
    end_date,
    renewal_date,
    next_maintenance_date,
    amount,
    amount_forced,
    notes,
    created_at,
    updated_at,
    maintenance_month,
    estimated_time,
    zone_id,
    subtotal,
    discount_percent,
    source,
    contract_pdf_path,
    signed_at,
    signature_client_base64,
    signature_client_nom,
    cancellation_reason,
    cancelled_at,
    exceptional_discount
   FROM majordhome.contracts;
