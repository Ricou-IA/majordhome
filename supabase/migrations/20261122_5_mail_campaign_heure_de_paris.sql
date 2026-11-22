-- 20261122_5_mail_campaign_heure_de_paris.sql
-- ============================================================================
-- Heure d'envoi d'une campagne automatique lue à l'heure de Paris.
-- Quoi : `public.mail_campaign_mark_run` (appelée par l'edge `mailing-scheduler` après chaque passage réussi)
-- calculait la date du prochain envoi d'une cadence en jours par
--   (CURRENT_DATE + jours)::timestamptz + heure
-- dans le fuseau de la session de la base, qui est UTC : une campagne réglée sur 9 h partait à 10 h l'hiver
-- et à 11 h l'été, et la page du mail affichait « à 9 h » à côté d'un prochain envoi « vers 10 h ».
-- Le jour aussi était celui d'UTC (entre minuit et 1 h ou 2 h à Paris, la veille).
-- Maintenant : date du jour À PARIS + jours, à l'heure réglée, lue comme heure locale de Paris
-- (`date + time` donne un horodatage sans fuseau, que `AT TIME ZONE 'Europe/Paris'` lit comme l'heure de Paris).
-- Cadence en minutes et absence de cadence : inchangées.
--
-- Limite : un seul fuseau. Toutes les entreprises sont en France aujourd'hui ; une entreprise ailleurs aura
-- besoin de son fuseau dans ses réglages (`core.organizations.settings`), lu ici.
--
-- Privilèges : inchangés. `CREATE OR REPLACE` garde les droits existants de la fonction ; cette migration n'ajoute
-- ni ne retire aucun GRANT / REVOKE. Vérifier par l'effet, après application :
--   SELECT has_function_privilege('anon', 'public.mail_campaign_mark_run(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.mail_campaign_mark_run(uuid)', 'EXECUTE'),
--          has_function_privilege('service_role', 'public.mail_campaign_mark_run(uuid)', 'EXECUTE');
-- doit rendre les mêmes valeurs qu'avant (cf. 20261030_3, qui l'a retirée à anon).
--
-- Vérifier : node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261122_5_mail_campaign_heure_de_paris.sql \
--            --assert scripts/migration-rehearsal/assert-mail-campaign-heure-de-paris.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mail_campaign_mark_run(p_campaign_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'majordhome'
AS $function$
DECLARE
  v_cadence_days integer;
  v_cadence_minutes integer;
  v_time_of_day time;
  v_next timestamptz;
BEGIN
  SELECT auto_cadence_days, auto_cadence_minutes, auto_time_of_day
    INTO v_cadence_days, v_cadence_minutes, v_time_of_day
  FROM majordhome.mail_campaigns WHERE id = p_campaign_id;

  IF v_cadence_minutes IS NOT NULL AND v_cadence_minutes > 0 THEN
    -- cadence sub-jour (ex: lead_bienvenue toutes les 10 min)
    v_next := NOW() + make_interval(mins => v_cadence_minutes);
  ELSIF v_cadence_days IS NOT NULL AND v_cadence_days > 0 THEN
    -- cadence en jours : le jour de Paris + N jours, à l'heure réglée, heure de Paris
    v_next := (((now() AT TIME ZONE 'Europe/Paris')::date + v_cadence_days) + COALESCE(v_time_of_day, '09:00'::time)) AT TIME ZONE 'Europe/Paris';
  ELSE
    v_next := NULL; -- one-shot ou pas de cadence définie
  END IF;

  UPDATE majordhome.mail_campaigns
    SET last_run_at = NOW(), next_run_at = v_next, updated_at = NOW()
    WHERE id = p_campaign_id;

  RETURN v_next;
END;
$function$;
