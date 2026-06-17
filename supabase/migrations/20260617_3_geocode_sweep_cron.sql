-- 20260617_3_geocode_sweep_cron.sql
-- Planifie geocode-sweep toutes les 30 min. Secret lu depuis vault (même pattern
-- que mailing-scheduler / pennylane-sync-quote-status).

SELECT cron.schedule(
  'geocode-sweep',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/geocode-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
