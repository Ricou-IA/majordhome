-- ============================================================================
-- Cron : mailing-scheduler (toutes les 10 min)
-- Date : 2026-06-02
--
-- Contexte : régression — depuis la migration P0.8 V2 du 21/05/2026, le
-- scheduler N8n "Mayer - Scheduler Campagnes Auto" continuait d'appeler
-- mail_campaigns_due + mail_campaign_mark_run (last_run_at avançait, masquant
-- la panne) mais son étape d'ENVOI n'avait jamais été recâblée vers l'edge
-- `mailing-send` (le webhook N8n `mayer-mailing` avait été archivé le même
-- jour). Résultat : 0 envoi automatique du 21/05 au 02/06 (welcome + relances).
--
-- Fix : on sort le scheduler de N8n. pg_cron (10 min) → edge `mailing-scheduler`
-- (verify_jwt:false, MDH_CRON_SECRET) qui, pour chaque campagne `is_automated`
-- due (toutes orgs, via `mail_campaigns_due()`), appelle `mailing-send` en
-- service_role puis `mail_campaign_mark_run`. App-level cross-org : 1 cron pour
-- toutes les entreprises.
--
-- Pattern aligné sur pennylane-sync-quote-status / pv-scrape-auto-poll :
-- secret lu depuis vault.secrets (entrée 'mdh_cron_secret'), jamais versionné.
-- ============================================================================

-- cron.schedule remplace si jobname existe déjà -> idempotent
SELECT cron.schedule(
  'mailing-scheduler',
  '*/10 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/mailing-scheduler',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'mailing-scheduler' AND active = true;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cron mailing-scheduler non planifié ou inactif';
  END IF;
END $$;
