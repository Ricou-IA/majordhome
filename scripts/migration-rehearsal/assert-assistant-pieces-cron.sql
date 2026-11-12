-- assert-assistant-pieces-cron.sql — vérifie 20261113_2_assistant_pieces_cron.sql (balayage des recherches de pièces).
-- Le cluster de répétition n'a qu'un stub pg_cron (bootstrap-pre.sql : cron.job + cron.schedule qui met à jour le job
-- de même nom ; rien n'est exécuté, donc ni net ni vault ne sont lus ; cron.unschedule n'y existe pas, l'appel est
-- avalé par le bloc EXCEPTION de la migration). À lancer après avoir rejoué la migration DEUX fois : une seule tâche.
-- Le contrôle reste gardé par to_regclass('cron.job'), comme assert-auto-rdv-invitations.sql.
DO $$
DECLARE
  n int;
  v_schedule text;
  v_command text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'assert-assistant-pieces-cron : pg_cron absent du cluster, contrôle ignoré';
    RETURN;
  END IF;
  SELECT count(*), max(schedule), max(command) INTO n, v_schedule, v_command FROM cron.job WHERE jobname = 'assistant-pieces-cron';
  IF n <> 1 THEN RAISE EXCEPTION '% tâche(s) assistant-pieces-cron au lieu de 1', n; END IF;
  IF v_schedule <> '* * * * *' THEN RAISE EXCEPTION 'planification % au lieu de * * * * *', v_schedule; END IF;
  -- L'edge n'est appelée que s'il existe une recherche en cours (pas de requête chaque minute pour rien).
  IF (v_command ~ 'WHERE EXISTS \(SELECT 1 FROM majordhome\.assistant_recherches WHERE statut = ''en_cours''\)') IS NOT TRUE THEN
    RAISE EXCEPTION 'la commande planifiée n''est pas gardée par WHERE EXISTS (… statut = ''en_cours'')';
  END IF;
  IF (v_command LIKE '%net.http_post(%' AND v_command LIKE '%/functions/v1/assistant-pieces-cron%'
      AND v_command LIKE '%mdh_cron_secret%' AND v_command LIKE '%timeout_milliseconds := 120000%') IS NOT TRUE THEN
    RAISE EXCEPTION 'commande planifiée incomplète (URL, secret ou délai)';
  END IF;
  -- La garde se lit et s'évalue : même requête que la commande, sans l'appel réseau (net absent du cluster).
  PERFORM 1 WHERE EXISTS (SELECT 1 FROM majordhome.assistant_recherches WHERE statut = 'en_cours');
  RAISE NOTICE 'assert-assistant-pieces-cron : OK';
END $$;
