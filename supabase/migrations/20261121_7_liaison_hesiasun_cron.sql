-- ============================================================================
-- 20261121_7 — Cron pg_cron du rejeu des envois d'identité vers HésiaSun → edge hesiasun-identite-cron
-- (verify_jwt:false, MDH_CRON_SECRET depuis vault). Chaque heure, à la minute 20 : un envoi resté en attente
-- (HésiaSun injoignable au moment de l'enregistrement) est rejoué par la même fonction que l'écran.
-- Séparé de 20261121_6 : le harnais de répétition n'a ni net ni vault.
-- La commande n'appelle l'edge QUE s'il existe une organisation en attente (WHERE EXISTS) : sans envoi à
-- rejouer, aucune requête ne part. La tâche s'exécute sous le rôle qui l'a planifiée (postgres).
-- Vérifier : SELECT jobname, schedule FROM cron.job WHERE jobname = 'hesiasun-identite-cron';
-- ============================================================================

DO $$ BEGIN
  PERFORM cron.unschedule('hesiasun-identite-cron');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('hesiasun-identite-cron', '20 * * * *', $$
    SELECT net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/hesiasun-identite-cron',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)),
      body := '{}'::jsonb, timeout_milliseconds := 60000)
    WHERE EXISTS (SELECT 1 FROM core.organizations WHERE settings -> 'hesiasun' ->> 'en_attente' = 'true');
$$);
