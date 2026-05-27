-- ============================================================================
-- majordhome_kanban_cards : expired traite comme pending (option A)
-- Date : 2026-05-27
--
-- Decision produit (2026-05-27) : "expired n'est pas une notion suivie".
-- Un devis expire reste informatif mais ne classe pas le lead en Perdu.
-- Semantiquement : "le client n'a pas tranche dans les temps, mais la perte
-- n'est pas constatee — le commercial peut relancer".
--
-- Bug detecte sur PORCQ HUGO (2 devis expired) -> place en Perdu alors qu'il
-- devrait rester visible en Devis envoye pour relance.
--
-- Changement vs migration precedente (20260525_5) :
--   - expired : refused_count -> pending_count
--   - expired : refused_sum   -> pending_sum
--   - refused_count = refused + denied + canceled (sans expired)
--
-- Effets de bord :
--   - Une carte Perdu n'apparait QUE si refused/denied/canceled > 0 et
--     pending (incluant expired) = 0 et accepted = 0
--   - Les devis expired remontent dans la liste des sous-cartes du Devis
--     envoye (alignement filtre LeadCard.filteredQuotes en parallele)
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_kanban_cards
WITH (security_invoker = true) AS
WITH lead_quote_stats AS (
  SELECT
    lpq.lead_id,
    lpq.org_id,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('pending','draft','expired')) AS pending_count,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('accepted','invoiced')) AS accepted_count,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('refused','denied','canceled')) AS refused_count,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('pending','draft','expired')) AS pending_sum,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('accepted','invoiced')) AS accepted_sum,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('refused','denied','canceled')) AS refused_sum
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
  'Cartes Kanban : 1 lead avec devis PL peut generer 1-2 cartes selon mix quote_status. Allowlist accepted = {accepted,invoiced} (bug #7). Expired traite comme pending : un devis expire reste en Devis envoye pour relance, ne pousse PAS le lead en Perdu (decision produit 2026-05-27). Refused = refused+denied+canceled. Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md.';
