-- supabase/migrations/20260523_lead_pennylane_quotes_is_winning_quote.sql
-- PR 1 du bridge Pipeline ↔ Pennylane
-- Spec : docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md §5, §10
--
-- Ajoute le flag `is_winning_quote` sur les devis PL attachés à un lead.
-- Désigne le devis canonique gagnant après bascule lead → "Gagné" (display_order=5).
-- Les autres devis attachés restent en mémoire pour traçabilité des variantes.
--
-- L'invariant "1 winning max par lead actif" est garanti par la logique RPC
-- `lead_mark_won_with_quote` (PR 3) — pas de contrainte UNIQUE ici (évite les
-- UniqueViolation parasites en cas de transition temporaire).

-- 1. ADD COLUMN
ALTER TABLE majordhome.lead_pennylane_quotes
  ADD COLUMN is_winning_quote BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN majordhome.lead_pennylane_quotes.is_winning_quote IS
  'Flag du devis canonique gagnant. Set à true sur 1 seul devis par lead (parmi les non-ejected) au moment de la bascule lead → Gagné. Les autres devis attachés restent en mémoire (variantes traçables). Cf spec 2026-05-23-pipeline-pennylane-bridge-design.md §5.';

-- 2. Index partiel pour requêtes type "le devis gagnant du lead X"
CREATE INDEX IF NOT EXISTS idx_lead_pennylane_quotes_winning
  ON majordhome.lead_pennylane_quotes (lead_id)
  WHERE is_winning_quote = true AND ejected_at IS NULL;

-- 3. Backfill historique
--    Pour chaque lead en statut "Gagné" (display_order=5, is_won=true)
--    qui a au moins 1 devis PL attaché actif, flagger le devis le plus
--    récent (par assigned_at DESC) comme winning. Heuristique pragmatique
--    pour les 18 leads Gagnés Mayer existants (cf pré-flight 2026-05-23).
WITH winning_pick AS (
  SELECT DISTINCT ON (lpq.lead_id) lpq.id
  FROM majordhome.lead_pennylane_quotes lpq
  JOIN majordhome.leads l ON l.id = lpq.lead_id
  JOIN majordhome.statuses s ON s.id = l.status_id
  WHERE s.display_order = 5    -- 'Gagné' (is_won = true)
    AND lpq.ejected_at IS NULL
  ORDER BY lpq.lead_id, lpq.assigned_at DESC
)
UPDATE majordhome.lead_pennylane_quotes lpq
SET is_winning_quote = true
FROM winning_pick wp
WHERE lpq.id = wp.id;

-- 4. Recréation de la vue publique pour exposer is_winning_quote
--    La vue était en listing explicite (pas SELECT *), donc on doit la
--    DROP + CREATE. security_invoker=true conservé (convention P0.0.2).
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
