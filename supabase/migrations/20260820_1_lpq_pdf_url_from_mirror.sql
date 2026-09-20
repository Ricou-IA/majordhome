-- 2026-08-20 — Le pdf_url du pipeline lit le MIROIR, pas la copie figée
--
-- Pennylane fait tourner (rotation) les encrypted_id de ses liens publics de
-- PDF : les URLs copiées dans lead_pennylane_quotes.pdf_url au moment du
-- rattachement finissent en HTTP 400 (constaté le 2026-08-20 : tous les devis
-- du pipeline rattachés avant la rotation avaient un lien mort, alors que le
-- miroir pennylane_quotes — resynchronisé toutes les 5 min par le sweep —
-- portait une URL valide pour les mêmes devis).
--
-- Fix : la vue publique expose COALESCE(miroir, copie locale). La copie lpq
-- reste en fallback pour les devis sortis du périmètre du sweep
-- (missing/hors statuts balayés). Jointure 1:1 garantie par la PK du miroir
-- (org_id, pennylane_quote_id). La vue n'est PAS updatable (écritures via
-- RPC), ajouter un JOIN ne casse rien.

CREATE OR REPLACE VIEW public.majordhome_lead_pennylane_quotes
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
  COALESCE(pq.pdf_url, lpq.pdf_url) AS pdf_url,
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
LEFT JOIN majordhome.clients c ON c.id = l.client_id
LEFT JOIN majordhome.pennylane_quotes pq
  ON pq.org_id = lpq.org_id
 AND pq.pennylane_quote_id = lpq.pennylane_quote_id;

COMMENT ON VIEW public.majordhome_lead_pennylane_quotes IS
  'Liaisons lead <-> devis Pennylane. pdf_url = COALESCE(miroir pennylane_quotes, copie locale) car Pennylane fait tourner les encrypted_id des liens publics (2026-08-20). Non updatable (ecritures via RPC).';
