-- Meta Ads attribution view — 2 fixes (2026-06-02) :
-- (1) Compter les leads Meta même sans campaign_id.
--     Le polling N8N stockait l'objet leadgen Meta par défaut ({id,field_data,
--     created_time}) sans campaign_id/adset_id/ad_id → colonnes générées
--     meta_campaign_id NULL sur tous les leads live. L'ancien filtre
--     `AND meta_campaign_id IS NOT NULL` les jetait TOUS (dashboard figé au
--     backfill 2026-04-17). On retire ce filtre : tous les leads meta_ads
--     comptent dans le funnel global (correct aussi pour les leads organiques
--     sans campaign_id). Le breakdown par campagne reste vide tant que le
--     campaign_id n'est pas backfillé côté N8N.
-- (2) leads_won Pennylane-aware.
--     Un lead gagné via devis Pennylane accepté/invoiced garde souvent
--     status_id='Devis envoyé' (le cron pose is_winning_quote sans flipper le
--     statut). Le Kanban le voit gagné (il lit quote_status), pas le dashboard
--     (qui lisait status_id). On aligne : leads_won = statut gagné OU devis
--     non-éjecté winning/accepted/invoiced. Guard `NOT pl_won` sur leads_lost.
CREATE OR REPLACE VIEW public.majordhome_meta_ads_leads_attribution
WITH (security_invoker = true) AS
  SELECT l.org_id,
    l.meta_campaign_id AS campaign_id,
    l.meta_adset_id AS adset_id,
    l.assigned_user_id AS commercial_id,
    date((COALESCE((l.external_data ->> 'created_time'::text)::timestamp with time zone, l.created_at) AT TIME ZONE 'Europe/Paris'::text)) AS date_start,
    count(*) AS leads_total,
    count(*) FILTER (WHERE s.display_order >= 2 AND s.display_order IS NOT NULL) AS leads_contacted,
    count(*) FILTER (WHERE s.display_order >= 3 AND s.display_order <> 6 AND s.display_order IS NOT NULL) AS leads_planified,
    count(*) FILTER (WHERE s.display_order >= 4 AND s.display_order <> 6 AND s.display_order IS NOT NULL) AS leads_quoted,
    count(*) FILTER (WHERE s.is_won = true OR pq.pl_won) AS leads_won,
    count(*) FILTER (WHERE s.display_order = 6 AND NOT COALESCE(pq.pl_won, false)) AS leads_lost
   FROM majordhome.leads l
     LEFT JOIN majordhome.statuses s ON s.id = l.status_id
     LEFT JOIN LATERAL (
       SELECT bool_or(q.is_winning_quote OR q.quote_status IN ('accepted','invoiced')) AS pl_won
       FROM majordhome.lead_pennylane_quotes q
       WHERE q.lead_id = l.id AND q.ejected_at IS NULL
     ) pq ON true
  WHERE l.external_source = 'meta_ads'::text
  GROUP BY l.org_id, l.meta_campaign_id, l.meta_adset_id, l.assigned_user_id,
           (date((COALESCE((l.external_data ->> 'created_time'::text)::timestamp with time zone, l.created_at) AT TIME ZONE 'Europe/Paris'::text)));
