-- ============================================================================
-- Cron : pennylane-sync-quote-status (toutes les 15 min)
-- Date : 2026-05-27
--
-- Contexte : l'edge function existe depuis 2026-05-25 (commits 1df67db..4b90cf7)
-- mais n'a JAMAIS ete planifiee. Consequences silencieuses pendant ~2 jours :
-- pdf_url jamais backfille sur 155 devis attaches, quote_status jamais sync,
-- customer fields PL->MDH jamais sync, devis supprimes cote PL jamais ejectes.
-- Decouvert via tooltip "PDF non synchronise (prochain cycle <15 min)" qui ne
-- se resolvait jamais.
--
-- Pattern aligne sur pv-scrape-auto-poll : pg_cron + net.http_post + secret
-- lu depuis vault.secrets (entree 'mdh_cron_secret' creee separement via
-- execute_sql : vault.create_secret(<value>, 'mdh_cron_secret', '<desc>')).
-- Le secret n'est volontairement PAS dans ce fichier (versionne) — il vit
-- exclusivement dans vault.secrets cote DB + edge function env.
-- ============================================================================

-- cron.schedule remplace si jobname existe deja -> idempotent
SELECT cron.schedule(
  'pennylane-sync-quote-status',
  '*/15 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/pennylane-sync-quote-status',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'pennylane-sync-quote-status' AND active = true;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cron pennylane-sync-quote-status non planifie ou inactif';
  END IF;
END $$;
