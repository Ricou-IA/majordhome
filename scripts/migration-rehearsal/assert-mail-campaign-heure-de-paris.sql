-- assert-mail-campaign-heure-de-paris.sql — migration 20261122_5
-- ============================================================================
-- `mail_campaign_mark_run` : cadence en jours ⇒ prochain envoi à l'heure réglée, heure de Paris, le jour de Paris
-- + N ; cadence en minutes ⇒ maintenant + N minutes ; aucune cadence ⇒ NULL.
-- `now()` ne se règle pas dans une session : la fonction est vérifiée à la date du jour ; la formule est en plus
-- vérifiée sur une date d'hiver et une date d'été (même expression, horodatages fixés).
-- `majordhome.mail_campaigns` n'est pas photographiée par le harnais : une table réduite aux colonnes que la
-- fonction lit et écrit est créée si elle manque (tout est annulé à la fin).
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS majordhome.mail_campaigns (
  id uuid PRIMARY KEY,
  auto_cadence_days integer,
  auto_cadence_minutes integer,
  auto_time_of_day time,
  last_run_at timestamptz,
  next_run_at timestamptz,
  updated_at timestamptz
);

DO $$
DECLARE
  v_jours uuid := '00000000-0000-0000-0000-00000000a001';
  v_minutes uuid := '00000000-0000-0000-0000-00000000a002';
  v_rien uuid := '00000000-0000-0000-0000-00000000a003';
  v_next timestamptz;
  v_lu timestamptz;
  v_attendu date := (now() AT TIME ZONE 'Europe/Paris')::date + 7;
BEGIN
  -- La session en UTC, comme en production : c'est là que l'ancienne formule se trompait.
  PERFORM set_config('TimeZone', 'UTC', true);

  INSERT INTO majordhome.mail_campaigns (id, auto_cadence_days, auto_cadence_minutes, auto_time_of_day)
  VALUES (v_jours, 7, NULL, '09:00'), (v_minutes, NULL, 10, '09:00'), (v_rien, NULL, NULL, NULL);

  -- Cadence en jours : 9 h à Paris, le jour de Paris + 7.
  v_next := public.mail_campaign_mark_run(v_jours);
  SELECT next_run_at INTO v_lu FROM majordhome.mail_campaigns WHERE id = v_jours;
  IF v_lu IS DISTINCT FROM v_next THEN RAISE EXCEPTION 'next_run_at écrit (%) ≠ valeur rendue (%)', v_lu, v_next; END IF;
  IF extract(hour FROM v_next AT TIME ZONE 'Europe/Paris') <> 9 OR extract(minute FROM v_next AT TIME ZONE 'Europe/Paris') <> 0 THEN
    RAISE EXCEPTION 'cadence 7 jours à 09:00 : % (heure de Paris %), attendu 9 h', v_next, v_next AT TIME ZONE 'Europe/Paris';
  END IF;
  IF (v_next AT TIME ZONE 'Europe/Paris')::date <> v_attendu THEN
    RAISE EXCEPTION 'cadence 7 jours : date % à Paris, attendu %', (v_next AT TIME ZONE 'Europe/Paris')::date, v_attendu;
  END IF;

  -- Cadence en minutes : maintenant + 10 minutes (now() est celui de la transaction).
  v_next := public.mail_campaign_mark_run(v_minutes);
  IF v_next IS DISTINCT FROM now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'cadence 10 minutes : %, attendu %', v_next, now() + interval '10 minutes';
  END IF;

  -- Aucune cadence : NULL.
  v_next := public.mail_campaign_mark_run(v_rien);
  IF v_next IS NOT NULL THEN RAISE EXCEPTION 'sans cadence : %, attendu NULL', v_next; END IF;

  -- La formule sur deux dates fixées (même expression que la fonction) : hiver UTC+1, été UTC+2.
  IF ((((timestamptz '2026-01-15 23:30:00+00' AT TIME ZONE 'Europe/Paris')::date + 7) + time '09:00') AT TIME ZONE 'Europe/Paris')
     <> timestamptz '2026-01-23 08:00:00+00' THEN
    RAISE EXCEPTION 'hiver : 15/01 23 h 30 UTC (16/01 à Paris) + 7 jours doit donner le 23/01 à 9 h de Paris (08:00 UTC)';
  END IF;
  IF ((((timestamptz '2026-07-15 10:00:00+00' AT TIME ZONE 'Europe/Paris')::date + 7) + time '09:00') AT TIME ZONE 'Europe/Paris')
     <> timestamptz '2026-07-22 07:00:00+00' THEN
    RAISE EXCEPTION 'été : 15/07 + 7 jours doit donner le 22/07 à 9 h de Paris (07:00 UTC)';
  END IF;

  RAISE NOTICE 'mail_campaign_mark_run : 7 jours à 9 h ⇒ % (Paris %), 10 minutes et sans cadence conformes, hiver et été conformes',
    (SELECT next_run_at FROM majordhome.mail_campaigns WHERE id = v_jours),
    (SELECT next_run_at AT TIME ZONE 'Europe/Paris' FROM majordhome.mail_campaigns WHERE id = v_jours);
END $$;

ROLLBACK;
