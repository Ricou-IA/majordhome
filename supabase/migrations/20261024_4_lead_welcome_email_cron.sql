-- ============================================================================
-- 20261024_4 — Cron pg_cron de l'e-mail d'accueil des leads Meta Ads
-- → edge lead-welcome-email (verify_jwt:false, MDH_CRON_SECRET depuis vault).
-- Toutes les 5 minutes : pour chaque org où settings.lead_welcome_email.enabled,
-- un e-mail de confirmation aux leads Meta créés depuis l'activation, une seule
-- fois par lead (anti-doublon = majordhome_mailing_logs, campagne accueil_lead_meta).
-- Rien ne part tant que l'org n'a pas allumé l'interrupteur (Settings →
-- Communication → Emails) et créé le gabarit.
-- Vérifier : SELECT jobname, schedule FROM cron.job WHERE jobname = 'lead-welcome-email';
-- ============================================================================

DO $$ BEGIN
  PERFORM cron.unschedule('lead-welcome-email');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('lead-welcome-email', '*/5 * * * *', $$
    SELECT net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/lead-welcome-email',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)),
      body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
