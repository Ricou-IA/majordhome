-- supabase/migrations/20260925_2_maintenance_digest_cron.sql
-- ============================================================================
-- Cron HORAIRE de l'e-mail du soir du module Maintenance (edge maintenance-digest).
-- L'heure d'envoi est un réglage d'org (settings.maintenance.digest.hour, Paris) :
-- l'edge décide seule s'il y a quelque chose à faire maintenant (H ou H+1 pour la
-- reprise d'un échec), anti-doublon par majordhome.maint_digest_runs.
-- Toutes les heures à :05 (pg_cron en UTC) — même patron que sms-rappel-rdv :
-- secret lu depuis vault (mdh_cron_secret).
-- Sans org abonnée au module, l'edge répond sans rien faire.
-- ============================================================================
select cron.unschedule('maintenance-digest')
 where exists (select 1 from cron.job where jobname = 'maintenance-digest');

select cron.schedule(
  'maintenance-digest',
  '5 * * * *',
  $$
    select net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/maintenance-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mdh_cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
