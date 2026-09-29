-- assert-auto-rdv.sql — vérifie 20260930_2_auto_rdv_poser.sql sur le cluster de répétition
-- (à jouer APRÈS 20260930_1, dont dépend journees_secteur). Un écart lève une exception.

-- ── A. Exposition : service_role seulement ─────────────────────────────────
DO $$
DECLARE sig text := 'public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text, jsonb)';
BEGIN
  -- Une seule surcharge : l'ancienne signature (10 args) a été supprimée par 20260930_4.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'auto_rdv_poser') <> 1 THEN
    RAISE EXCEPTION 'auto_rdv_poser : plusieurs surcharges';
  END IF;
  IF has_function_privilege('anon', sig, 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute auto_rdv_poser'; END IF;
  IF has_function_privilege('authenticated', sig, 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute auto_rdv_poser'; END IF;
  IF NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN RAISE EXCEPTION 'service_role n''exécute pas auto_rdv_poser'; END IF;
END $$;

-- ── B. Gardes, dans l'ordre où la RPC les évalue ───────────────────────────
DO $$
DECLARE v_msg text;
BEGIN
  -- B1. demi-journée inconnue → invalid_args
  BEGIN
    PERFORM public.auto_rdv_poser(gen_random_uuid(), gen_random_uuid(), current_date + 3, 'soir', '09:00', '10:00', 60, '', NULL, NULL);
    RAISE EXCEPTION 'demi-journée « soir » acceptée';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'invalid_args' THEN RAISE EXCEPTION 'attendu invalid_args, obtenu %', SQLERRM; END IF;
  END;
  -- B2. fin avant début → invalid_args
  BEGIN
    PERFORM public.auto_rdv_poser(gen_random_uuid(), gen_random_uuid(), current_date + 3, 'matin', '10:00', '09:00', 60, '', NULL, NULL);
    RAISE EXCEPTION 'fin < début acceptée';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'invalid_args' THEN RAISE EXCEPTION 'attendu invalid_args, obtenu %', SQLERRM; END IF;
  END;
  -- B3. date à deux mois → hors_mois (borne dure ; le mois suivant n'est toléré
  --     que dans les 7 derniers jours du mois, cf. 20260930_3)
  BEGIN
    PERFORM public.auto_rdv_poser(gen_random_uuid(), gen_random_uuid(), (date_trunc('month', current_date) + interval '2 month')::date, 'matin', '09:00', '10:00', 60, '', NULL, NULL);
    RAISE EXCEPTION 'date à deux mois acceptée';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'hors_mois' THEN RAISE EXCEPTION 'attendu hors_mois, obtenu %', SQLERRM; END IF;
  END;
  -- B3bis. mois suivant : accepté seulement dans les 7 derniers jours du mois
  BEGIN
    PERFORM public.auto_rdv_poser(gen_random_uuid(), gen_random_uuid(), (date_trunc('month', current_date) + interval '1 month')::date, 'matin', '09:00', '10:00', 60, '', NULL, NULL);
    RAISE EXCEPTION 'contrat inconnu accepté (B3bis)';
  EXCEPTION WHEN OTHERS THEN
    IF (date_trunc('month', current_date) + interval '1 month - 1 day')::date - current_date < 7 THEN
      IF SQLERRM <> 'contrat_introuvable' THEN RAISE EXCEPTION 'fin de mois : attendu contrat_introuvable (mois suivant toléré), obtenu %', SQLERRM; END IF;
    ELSE
      IF SQLERRM <> 'hors_mois' THEN RAISE EXCEPTION 'attendu hors_mois, obtenu %', SQLERRM; END IF;
    END IF;
  END;
  -- B4. date passée → hors_mois
  BEGIN
    PERFORM public.auto_rdv_poser(gen_random_uuid(), gen_random_uuid(), current_date - 1, 'matin', '09:00', '10:00', 60, '', NULL, NULL);
    RAISE EXCEPTION 'date passée acceptée';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'hors_mois' THEN RAISE EXCEPTION 'attendu hors_mois, obtenu %', SQLERRM; END IF;
  END;
  -- B5. contrat inconnu → contrat_introuvable (date du jour = dans le mois)
  BEGIN
    PERFORM public.auto_rdv_poser(gen_random_uuid(), gen_random_uuid(), current_date, 'matin', '09:00', '10:00', 60, '', NULL, NULL);
    RAISE EXCEPTION 'contrat inconnu accepté';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'contrat_introuvable' THEN RAISE EXCEPTION 'attendu contrat_introuvable, obtenu %', SQLERRM; END IF;
  END;
END $$;

-- ── C. Rien n'a été écrit par les refus ────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM majordhome.appointments a WHERE a.source = 'auto_rdv') THEN RAISE EXCEPTION 'un refus a écrit un RDV'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.journees_secteur) THEN RAISE EXCEPTION 'un refus a écrit une étiquette'; END IF;
END $$;
