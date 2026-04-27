-- migration_mail_campaign_stats.sql
-- ============================================================================
-- Vue agrégée des KPIs par campagne mailing.
-- Source : majordhome.mailing_logs + jointures clients/leads pour les désabos.
-- Consommée par l'onglet "Stats" du module Mailing (StatsTab.jsx).
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_mail_campaign_stats AS
SELECT
  ml.org_id,
  ml.campaign_name,
  COUNT(*)                                                                AS total_sent,
  COUNT(*) FILTER (WHERE ml.status IN ('sent','delivered','opened','clicked')) AS total_delivered,
  COUNT(*) FILTER (WHERE ml.status IN ('opened','clicked'))               AS total_opened,
  COUNT(*) FILTER (WHERE ml.status = 'clicked')                            AS total_clicked,
  COUNT(*) FILTER (WHERE ml.status = 'bounced')                            AS total_bounced,
  COUNT(*) FILTER (WHERE ml.status = 'failed')                             AS total_failed,
  COUNT(*) FILTER (WHERE ml.status = 'complained')                         AS total_complained,
  COUNT(*) FILTER (
    WHERE (c.email_unsubscribed_at IS NOT NULL AND c.email_unsubscribed_at >= ml.sent_at)
       OR (l.email_unsubscribed_at IS NOT NULL AND l.email_unsubscribed_at >= ml.sent_at)
  )                                                                        AS total_unsubscribed,
  COALESCE(SUM(ml.open_count), 0)                                          AS total_open_events,
  COALESCE(SUM(ml.click_count), 0)                                         AS total_click_events,
  MIN(ml.sent_at)                                                          AS first_sent_at,
  MAX(ml.sent_at)                                                          AS last_sent_at
FROM majordhome.mailing_logs ml
LEFT JOIN majordhome.clients c ON c.id = ml.client_id
LEFT JOIN majordhome.leads   l ON l.id = ml.lead_id
GROUP BY ml.org_id, ml.campaign_name
ORDER BY MAX(ml.sent_at) DESC;

GRANT SELECT ON public.majordhome_mail_campaign_stats TO anon, authenticated, service_role;
