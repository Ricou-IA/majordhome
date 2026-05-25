-- supabase/migrations/20260525_2_lpq_kanban_index.sql
-- Follow-up PR 1 Phase 1 pipeline multi-devis
-- Covering index for the CTE lead_quote_stats in majordhome_kanban_cards view.
-- Avoids sequential scans on lead_pennylane_quotes as the table grows
-- (especially after the 2nd org onboards).
--
-- Suggested by code quality review of commit c83faa9.

CREATE INDEX IF NOT EXISTS idx_lpq_kanban_stats
  ON majordhome.lead_pennylane_quotes (lead_id, org_id, quote_status, quote_amount_ht)
  WHERE ejected_at IS NULL;

COMMENT ON INDEX majordhome.idx_lpq_kanban_stats IS
  'Index couvrant pour le CTE lead_quote_stats de la vue public.majordhome_kanban_cards. Évite seq scan sur lead_pennylane_quotes au fur et à mesure que la table grossit.';
