-- ============================================================================
-- 20261113_2 — Cron pg_cron du balayage des recherches de pièces → edge assistant-pieces-cron
-- (verify_jwt:false, MDH_CRON_SECRET depuis vault). Chaque minute : toute recherche restée `en_cours`
-- (fenêtre fermée, personne ne l'interroge) est suivie par la même fonction que l'écran, et close si le
-- run d'Hermes est fini, échoué ou trop vieux. Sans cela, le résultat se perdrait (Hermes oublie un run
-- fini au bout d'une heure) et la ligne resterait `en_cours`.
-- Séparé de 20261113_1 : le harnais de répétition n'a ni pg_cron, ni net, ni vault.
-- timeout_milliseconds 120000 : budget de 40 s de l'edge + un suivi en cours (15 s au plus) + marge.
-- La commande n'appelle l'edge QUE s'il existe une recherche `en_cours` (WHERE EXISTS) : sans recherche, aucune
-- requête ne part, chaque minute coûte une lecture de l'index partiel assistant_recherches_en_cours_idx
-- (20261113_1, WHERE statut = 'en_cours'). La tâche s'exécute sous le rôle qui l'a planifiée (cron.job.username :
-- postgres, qui applique les migrations), propriétaire de majordhome.assistant_recherches : il la lit sans GRANT
-- ni policy (pas de FORCE ROW LEVEL SECURITY). Aucun GRANT ajouté.
-- Vérifier : SELECT jobname, schedule FROM cron.job WHERE jobname = 'assistant-pieces-cron';
-- ============================================================================

DO $$ BEGIN
  PERFORM cron.unschedule('assistant-pieces-cron');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('assistant-pieces-cron', '* * * * *', $$
    SELECT net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/assistant-pieces-cron',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)),
      body := '{}'::jsonb, timeout_milliseconds := 120000)
    WHERE EXISTS (SELECT 1 FROM majordhome.assistant_recherches WHERE statut = 'en_cours');
$$);
