-- supabase/migrations/20260525_5_kanban_cards_allow_invoiced.sql
-- Bug #7 fix — Étend l'allowlist accepted_count de la vue Kanban pour
-- inclure quote_status='invoiced' (devis transformé en facture émise côté PL).
-- Sémantiquement : invoiced = stade post-accepted, doit apparaître en colonne
-- "Gagné" du Kanban Pipeline.
-- Spec : docs/superpowers/specs/2026-05-25-bug7-quote-status-sync-design.md
--
-- Avant ce fix : 4 cartes Gagné Mayer (FAISANT, FEDERATION, MAZEL, SALLOIGNON)
-- + 1 multi-devis (FRENCH COUNTRY) étaient invisibles ou rangées en colonne
-- mauvaise dans le Kanban car leur devis PL était passé en `invoiced` côté PL.

CREATE OR REPLACE VIEW public.majordhome_kanban_cards
WITH (security_invoker = true) AS
WITH lead_quote_stats AS (
  SELECT
    lpq.lead_id,
    lpq.org_id,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('pending','draft')) AS pending_count,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('accepted','invoiced')) AS accepted_count,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('refused','denied','expired','canceled')) AS refused_count,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('pending','draft')) AS pending_sum,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('accepted','invoiced')) AS accepted_sum,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('refused','denied','expired','canceled')) AS refused_sum
  FROM majordhome.lead_pennylane_quotes lpq
  WHERE lpq.ejected_at IS NULL
  GROUP BY lpq.lead_id, lpq.org_id
)
SELECT
  l.id::text || ':devis_envoye' AS card_key,
  l.id AS lead_id,
  l.org_id,
  'lead'::text AS card_type,
  'devis_envoye'::text AS column_key,
  lqs.pending_count AS devis_count,
  ROUND(lqs.pending_sum)::numeric AS total_amount,
  lqs.pending_count,
  lqs.accepted_count,
  lqs.refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.pending_count > 0 AND COALESCE(l.is_deleted, false) = false

UNION ALL

SELECT
  l.id::text || ':gagne' AS card_key,
  l.id AS lead_id,
  l.org_id,
  'lead'::text AS card_type,
  'gagne'::text AS column_key,
  lqs.accepted_count AS devis_count,
  ROUND(lqs.accepted_sum)::numeric AS total_amount,
  lqs.pending_count,
  lqs.accepted_count,
  lqs.refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.accepted_count > 0 AND COALESCE(l.is_deleted, false) = false

UNION ALL

SELECT
  l.id::text || ':perdu' AS card_key,
  l.id AS lead_id,
  l.org_id,
  'lead'::text AS card_type,
  'perdu'::text AS column_key,
  lqs.refused_count AS devis_count,
  ROUND(lqs.refused_sum)::numeric AS total_amount,
  lqs.pending_count,
  lqs.accepted_count,
  lqs.refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.refused_count > 0 AND lqs.accepted_count = 0 AND lqs.pending_count = 0
  AND COALESCE(l.is_deleted, false) = false

UNION ALL

SELECT
  l.id::text || ':classic' AS card_key,
  l.id AS lead_id,
  l.org_id,
  'lead'::text AS card_type,
  CASE s.display_order
    WHEN 1 THEN 'nouveau'
    WHEN 2 THEN 'contacte'
    WHEN 3 THEN 'rdv_planifie'
    WHEN 4 THEN 'devis_envoye'
    WHEN 5 THEN 'gagne'
    WHEN 6 THEN 'perdu'
    ELSE 'unknown'
  END AS column_key,
  0 AS devis_count,
  COALESCE(l.order_amount_ht, 0)::numeric AS total_amount,
  0 AS pending_count,
  0 AS accepted_count,
  0 AS refused_count
FROM majordhome.leads l
LEFT JOIN majordhome.statuses s ON s.id = l.status_id
WHERE COALESCE(l.is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM lead_quote_stats lqs WHERE lqs.lead_id = l.id
  );

COMMENT ON VIEW public.majordhome_kanban_cards IS
  'Cartes Kanban calculées : 1 lead avec devis PL peut générer 1-2 cartes selon mix quote_status. Allowlist accepted = {accepted,invoiced} (bug #7 fix 2026-05-25). Pennylane canonical pour le placement. Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md + 2026-05-25-bug7-quote-status-sync-design.md';
