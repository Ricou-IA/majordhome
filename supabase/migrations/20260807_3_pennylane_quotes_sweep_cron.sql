-- 20260807_3_pennylane_quotes_sweep_cron.sql
-- Planifie pennylane-quotes-sweep toutes les 5 min (même pattern que
-- geocode-sweep / mailing-scheduler : secret lu depuis vault).
--
-- Pourquoi 5 min alors que le cron voisin tourne à 15 : ce balayage utilise
-- l'endpoint LISTE paginé (~3 appels pour 250 devis), là où
-- pennylane-sync-quote-status fait un GET par devis rattaché (~360 appels).
-- On est donc plus fréquent ET nettement moins coûteux en appels API.
--
-- ⚠️ Le corps envoyé est `{}` : le balayage tourne en MATÉRIALISATION SEULE.
-- Il n'écrira dans Pennylane que si la variable d'environnement
-- PL_APPLY_DEADLINES=true est posée sur la fonction (dashboard Supabase).
-- C'est volontaire : automatiser la lecture ne doit pas automatiser l'écriture
-- sur des documents clients par effet de bord d'une migration.

SELECT cron.schedule(
  'pennylane-quotes-sweep',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/pennylane-quotes-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
