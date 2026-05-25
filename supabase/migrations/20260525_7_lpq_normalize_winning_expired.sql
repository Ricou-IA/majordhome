-- supabase/migrations/20260525_7_lpq_normalize_winning_expired.sql
-- Bug #7 fix data — Normalise les winning hors {accepted,invoiced} héritage
-- backfill 2026-05-01.
--
-- Le trigger 20260525_6 le ferait automatiquement à la prochaine UPDATE, mais
-- on veut un état cohérent ici et maintenant (la prochaine UPDATE peut ne
-- jamais venir).
--
-- Appliqué prod 2026-05-25 : 1 ligne migrée (LEMUR JEROME D-2026-04123
-- expired winning legacy).
--
-- Spec : docs/superpowers/specs/2026-05-25-bug7-quote-status-sync-design.md §4

UPDATE majordhome.lead_pennylane_quotes
SET quote_status = 'accepted'
WHERE is_winning_quote = true
  AND ejected_at IS NULL
  AND (quote_status IS NULL OR quote_status NOT IN ('accepted','invoiced'));
