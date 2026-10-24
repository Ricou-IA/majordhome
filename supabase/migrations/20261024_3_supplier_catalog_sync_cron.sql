-- ============================================================================
-- 20261024_3 — Cron pg_cron du relevé automatique des catalogues fournisseurs
-- → edge supplier-catalog-sync { mode: "cron" } (verify_jwt:false, MDH_CRON_SECRET
-- depuis vault). Chaque nuit à 04:00 UTC : pour chaque fournisseur actif dont
-- connector = 'baywa', connexion avec les identifiants Vault de l'org, relevé de
-- l'API catalogue, supplier_catalog_upsert. Un échec est écrit dans
-- suppliers.catalog_sync_result ({ ok:false, code }) et n'écrit rien d'autre.
-- Séparé de 20261024_2 : le harnais de répétition n'a ni pg_cron ni net.
-- Vérifier : SELECT jobname, schedule FROM cron.job WHERE jobname = 'supplier-catalog-sync';
-- ============================================================================

DO $$ BEGIN
  PERFORM cron.unschedule('supplier-catalog-sync');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('supplier-catalog-sync', '0 4 * * *', $$
    SELECT net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/supplier-catalog-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)),
      body := '{"mode":"cron"}'::jsonb, timeout_milliseconds := 300000);
$$);
