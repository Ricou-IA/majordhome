-- 20260807_2_mark_missing_refuse_wipe.sql
-- Garde-fou : `mark_missing` refuse de marquer 100 % des devis d'une org.
--
-- Mode de panne visé : le balayage interroge Pennylane, reçoit un HTTP 200 avec
-- zéro devis (filtre qui se comporte mal, réponse vide, changement d'API), et
-- marque alors TOUTE la projection comme « manquante ». L'explorateur se vide
-- d'un coup, sans erreur, sans alerte — l'utilisateur lit « aucun devis » là où
-- il faudrait lire « je ne sais plus ».
--
-- Aujourd'hui c'est théorique ; une fois le cron actif toutes les 5 minutes ça
-- ne l'est plus. Une disparition totale et réelle est un événement si rare
-- qu'exiger une intervention humaine est le bon arbitrage.
--
-- Convention de retour : -1 signale un refus (visible dans la réponse du
-- balayage, là où un nombre positif est banal). Le marquage partiel légitime
-- (quelques devis passés en `denied`, donc sortis du périmètre balayé) continue
-- de fonctionner normalement.

CREATE OR REPLACE FUNCTION public.pennylane_quotes_mark_missing(
  p_org_id uuid,
  p_sweep_started timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_total     integer;
  v_candidats integer;
  v_count     integer;
BEGIN
  SELECT count(*) INTO v_total
    FROM majordhome.pennylane_quotes
   WHERE org_id = p_org_id;

  SELECT count(*) INTO v_candidats
    FROM majordhome.pennylane_quotes
   WHERE org_id = p_org_id
     AND synced_at < p_sweep_started
     AND missing_since IS NULL;

  -- Rien à marquer : cas nominal.
  IF v_candidats = 0 THEN
    RETURN 0;
  END IF;

  -- Le balayage n'a rien revu de ce que l'org possède : c'est la signature
  -- d'un balayage vide, pas d'une suppression massive. On refuse.
  IF v_total > 0 AND v_candidats >= v_total THEN
    RAISE WARNING 'pennylane_quotes_mark_missing: refus de marquer % / % devis (balayage vide ?)',
      v_candidats, v_total;
    RETURN -1;
  END IF;

  UPDATE majordhome.pennylane_quotes
     SET missing_since = now()
   WHERE org_id = p_org_id
     AND synced_at < p_sweep_started
     AND missing_since IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.pennylane_quotes_mark_missing(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_quotes_mark_missing(uuid, timestamptz) TO service_role;
