-- ============================================================================
-- 20260930_6 — Crons pg_cron de l'auto-RDV → edge auto-rdv-cron
-- (verify_jwt:false, MDH_CRON_SECRET depuis vault). Même patron que
-- maintenance-digest / tournees-figer. Séparé de 20260930_5 : le harnais de
-- répétition n'a ni pg_cron ni vault.
--   auto-rdv-ouverture : le 1er du mois à 04:00 UTC (06:00 Paris) — invitations
--     + étiquetage des journées vides par secteur.
--   auto-rdv-relances : tous les jours à 04:20 UTC — SMS J+7, liste d'appels
--     J+15, expiration fin de mois, réouverture des secteurs saturés.
-- Vérifier : SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'auto-rdv%';
-- ============================================================================

DO $$ BEGIN
  PERFORM cron.unschedule('auto-rdv-ouverture');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('auto-rdv-relances');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('auto-rdv-ouverture', '0 4 1 * *', $$
    SELECT net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/auto-rdv-cron',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)),
      body := '{"mode":"ouverture"}'::jsonb, timeout_milliseconds := 300000);
$$);

SELECT cron.schedule('auto-rdv-relances', '20 4 * * *', $$
    SELECT net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/auto-rdv-cron',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)),
      body := '{"mode":"relances"}'::jsonb, timeout_milliseconds := 300000);
$$);
