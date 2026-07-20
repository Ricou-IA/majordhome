-- migration_mail_campaign_recipients.sql
-- ============================================================================
-- Vue destinataire (1 ligne par email envoyé) pour le drill-down de l'onglet
-- "Stats" du module Mailing : permet de lister QUI a ouvert / cliqué / bouncé /
-- s'est désabonné pour une campagne donnée.
--
-- Source : majordhome.mailing_logs + JOIN clients/leads (nom + désabo).
-- security_invoker=true → RLS de mailing_logs s'applique (défense en profondeur :
-- le front garde aussi .eq('org_id', orgId)).
--
-- Le flag `unsubscribed_after_send` reprend EXACTEMENT la logique de la vue
-- agrégée `majordhome_mail_campaign_stats` (email_unsubscribed_at >= sent_at)
-- pour que le décompte du drawer == le chiffre affiché dans la cellule "Désabos".
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_mail_campaign_recipients
WITH (security_invoker = true) AS
SELECT
  ml.id,
  ml.org_id,
  ml.campaign_name,
  ml.subject,
  ml.email_to,
  ml.client_id,
  ml.lead_id,
  -- Nom destinataire : client prioritaire (raison sociale puis prénom/nom),
  -- sinon lead. NULL si aucun rattachement → le front retombe sur email_to.
  COALESCE(
    NULLIF(btrim(c.company_name), ''),
    NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
    NULLIF(btrim(l.company_name), ''),
    NULLIF(btrim(concat_ws(' ', l.first_name, l.last_name)), '')
  )                                                       AS recipient_name,
  c.client_number,
  ml.status,
  ml.sent_at,
  ml.delivered_at,
  ml.opened_at,
  ml.clicked_at,
  ml.bounced_at,
  ml.complained_at,
  ml.last_event_at,
  ml.open_count,
  ml.click_count,
  ml.error_message,
  -- Désabonné AU MOMENT OU APRÈS la réception de cette campagne.
  (
    (c.email_unsubscribed_at IS NOT NULL AND c.email_unsubscribed_at >= ml.sent_at)
    OR (l.email_unsubscribed_at IS NOT NULL AND l.email_unsubscribed_at >= ml.sent_at)
  )                                                       AS unsubscribed_after_send,
  COALESCE(c.email_unsubscribed_at, l.email_unsubscribed_at) AS unsubscribed_at
FROM majordhome.mailing_logs ml
LEFT JOIN majordhome.clients c ON c.id = ml.client_id
LEFT JOIN majordhome.leads   l ON l.id = ml.lead_id;

-- Pas d'anon (security_invoker → anon ne verrait rien de toute façon, mais on durcit).
REVOKE ALL ON public.majordhome_mail_campaign_recipients FROM anon;
GRANT SELECT ON public.majordhome_mail_campaign_recipients TO authenticated, service_role;
