-- ============================================================================
-- GRANT SELECT a service_role sur 14 tables majordhome.* post-Sem0
-- Date : 2026-05-27
--
-- Contexte : depuis le hardening Sem 0 (P0.0.2 - vues publiques en
-- security_invoker=true), les edge functions doivent avoir GRANT explicite
-- sur les tables sous-jacentes via service_role pour lire les vues
-- public.majordhome_*. RLS ne suffit plus a "ouvrir" l'acces.
--
-- Bug detecte 2026-05-27 : le cron pennylane-sync-quote-status plantait
-- silencieusement (42501 permission denied sur lead_pennylane_quotes)
-- et l'erreur sortait en "[object Object]" via sanitizeError.
--
-- Decision : GRANT SELECT only. Les ecritures continuent de passer par
-- des RPCs SECURITY DEFINER (pattern multi-tenant standard). INSERT/UPDATE/
-- DELETE non accordes pour reduire la surface d'attaque.
--
-- Idempotent : GRANT est idempotent en Postgres.
-- ============================================================================

GRANT SELECT ON majordhome.chantier_line_receptions TO service_role;
GRANT SELECT ON majordhome.client_creation_audit TO service_role;
GRANT SELECT ON majordhome.dedup_candidates TO service_role;
GRANT SELECT ON majordhome.dedup_merge_history TO service_role;
GRANT SELECT ON majordhome.geogrid_benchmarks TO service_role;
GRANT SELECT ON majordhome.geogrid_keyword_lists TO service_role;
GRANT SELECT ON majordhome.lead_interactions TO service_role;
GRANT SELECT ON majordhome.lead_pennylane_quotes TO service_role;
GRANT SELECT ON majordhome.mail_segments TO service_role;
GRANT SELECT ON majordhome.meta_ads_daily_stats TO service_role;
GRANT SELECT ON majordhome.pellets_orders TO service_role;
GRANT SELECT ON majordhome.pennylane_customer_lookup TO service_role;
GRANT SELECT ON majordhome.voice_memos TO service_role;
GRANT SELECT ON majordhome.voice_quotas TO service_role;

DO $$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM information_schema.tables t
  WHERE t.table_schema = 'majordhome'
    AND t.table_type = 'BASE TABLE'
    AND NOT has_table_privilege('service_role', 'majordhome.' || quote_ident(t.table_name), 'SELECT');
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Encore % tables majordhome.* sans SELECT pour service_role', v_missing;
  END IF;
END $$;
