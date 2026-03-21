-- Migration : Ajout signature client sur les contrats
-- ============================================================================

-- 1. Colonnes signature
ALTER TABLE majordhome.contracts
  ADD COLUMN IF NOT EXISTS signature_client_base64 text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signature_client_nom text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN majordhome.contracts.signature_client_base64 IS 'Signature client en base64 (data:image/png;base64,...)';
COMMENT ON COLUMN majordhome.contracts.signature_client_nom IS 'Nom du signataire client';
COMMENT ON COLUMN majordhome.contracts.signed_at IS 'Date/heure de signature';

-- 2. Recréer la vue lecture majordhome_contracts (DROP + CREATE car colonnes changent)
DROP VIEW IF EXISTS public.majordhome_contracts;
CREATE VIEW public.majordhome_contracts AS
SELECT
  c.*,
  cl.last_name AS client_name,
  cl.first_name AS client_first_name,
  cl.email AS client_email,
  cl.phone AS client_phone,
  cl.address AS client_address,
  cl.postal_code AS client_postal_code,
  cl.city AS client_city,
  cl.display_name AS client_display_name
FROM majordhome.contracts c
LEFT JOIN majordhome.clients cl ON cl.id = c.client_id;

-- 3. Recréer la vue écriture majordhome_contracts_write
DROP VIEW IF EXISTS public.majordhome_contracts_write;
CREATE VIEW public.majordhome_contracts_write AS
SELECT * FROM majordhome.contracts;

-- Rendre la vue writable
CREATE OR REPLACE RULE contracts_write_insert AS ON INSERT TO public.majordhome_contracts_write
  DO INSTEAD INSERT INTO majordhome.contracts VALUES (NEW.*) RETURNING *;
CREATE OR REPLACE RULE contracts_write_update AS ON UPDATE TO public.majordhome_contracts_write
  DO INSTEAD UPDATE majordhome.contracts SET
    org_id = NEW.org_id,
    client_id = NEW.client_id,
    status = NEW.status,
    frequency = NEW.frequency,
    start_date = NEW.start_date,
    end_date = NEW.end_date,
    next_maintenance_date = NEW.next_maintenance_date,
    maintenance_month = NEW.maintenance_month,
    amount = NEW.amount,
    estimated_time = NEW.estimated_time,
    notes = NEW.notes,
    zone_id = NEW.zone_id,
    subtotal = NEW.subtotal,
    discount_percent = NEW.discount_percent,
    source = NEW.source,
    contract_pdf_path = NEW.contract_pdf_path,
    signature_client_base64 = NEW.signature_client_base64,
    signature_client_nom = NEW.signature_client_nom,
    signed_at = NEW.signed_at,
    updated_at = NEW.updated_at
  WHERE id = OLD.id RETURNING *;
CREATE OR REPLACE RULE contracts_write_delete AS ON DELETE TO public.majordhome_contracts_write
  DO INSTEAD DELETE FROM majordhome.contracts WHERE id = OLD.id;
