-- supabase/migrations/20260526_10_lpq_pdf_url.sql
-- Bug fix : 3 composants Kanban (QuoteSubCard, LinkedQuotesPanel, MarkWonQuoteModal)
-- pointaient vers un URL inventé (`app.pennylane.com/quotes/{id}`) qui 404
-- en multi-cabinet. Migration vers le pattern Sprint 9 : ouvrir le PDF direct
-- via `q.public_file_url` Pennylane (homogène avec TabDevisPL / QuoteBlock /
-- LinkPennylaneQuoteModal / QuoteCandidatesModal).
--
-- Choix B retenu (vs fetch à la volée) : stocker pdf_url en DB pour zéro
-- latence au clic + homogène avec les autres composants qui le reçoivent
-- déjà dans leurs payloads API.
--
-- Backfill : pas de SQL manuel — le cron `pennylane-sync-quote-status`
-- (tournant toutes les 15 min) UPSERT pdf_url systématiquement après cette
-- migration. Les 152 lignes actives seront enrichies au prochain run.

ALTER TABLE majordhome.lead_pennylane_quotes
  ADD COLUMN IF NOT EXISTS pdf_url text NULL;

COMMENT ON COLUMN majordhome.lead_pennylane_quotes.pdf_url IS
  'URL publique stable du PDF du devis Pennylane (q.public_file_url). Synced par le cron pennylane-sync-quote-status + posé à l attach via lead_attach_quotes_and_send.';

-- Recreate public view with pdf_url exposed (DROP+CREATE car nouvelle colonne)
DROP VIEW IF EXISTS public.majordhome_lead_pennylane_quotes;

CREATE VIEW public.majordhome_lead_pennylane_quotes
WITH (security_invoker = true) AS
SELECT
  lpq.id,
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
  c.pennylane_account_number AS client_pl_number
FROM majordhome.lead_pennylane_quotes lpq
JOIN majordhome.leads l ON l.id = lpq.lead_id
LEFT JOIN majordhome.clients c ON c.id = l.client_id;

COMMENT ON VIEW public.majordhome_lead_pennylane_quotes IS
  'Liaisons lead <-> devis Pennylane enrichies (lead/client labels). security_invoker=true → RLS via lpq + l + c.';
