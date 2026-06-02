-- Fix régression : un gain auto via Pennylane (cron) ne créait plus le chantier.
-- Le cron posait seulement is_winning_quote ; l'effet "gagné" complet (statut
-- Gagné + won_date + chantier_status='gagne' + lead_activity) vivait uniquement
-- dans le chemin manuel lead_mark_won_with_quote (bouton front retiré depuis que
-- Pennylane est canonical). On unifie : le cron appelle désormais
-- lead_mark_won_with_quote (source unique de "ce que signifie gagner un lead").
-- Déclencheur conservé sur 'accepted' (un devis passé direct 'invoiced' a été
-- 'accepted' avant → capté à ce moment ; évite des chantiers rétroactifs sur de
-- vieux leads facturés). Chaque lead wrappé en EXCEPTION (un échec ne casse pas
-- le batch).
CREATE OR REPLACE FUNCTION public.pennylane_sync_ensure_winning_quotes(p_org_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_updates int := 0;
  v_lead_id uuid;
  v_quote_pl_id bigint;
BEGIN
  FOR v_lead_id IN
    SELECT DISTINCT lpq.lead_id
    FROM majordhome.lead_pennylane_quotes lpq
    WHERE lpq.org_id = p_org_id
      AND lpq.ejected_at IS NULL
      AND lpq.quote_status = 'accepted'
    EXCEPT
    SELECT DISTINCT lpq2.lead_id
    FROM majordhome.lead_pennylane_quotes lpq2
    WHERE lpq2.org_id = p_org_id
      AND lpq2.ejected_at IS NULL
      AND lpq2.is_winning_quote = true
  LOOP
    SELECT pennylane_quote_id INTO v_quote_pl_id
    FROM majordhome.lead_pennylane_quotes
    WHERE lead_id = v_lead_id
      AND org_id = p_org_id
      AND ejected_at IS NULL
      AND quote_status = 'accepted'
    ORDER BY pennylane_quote_id DESC
    LIMIT 1;

    IF v_quote_pl_id IS NOT NULL THEN
      BEGIN
        PERFORM public.lead_mark_won_with_quote(p_org_id, v_lead_id, v_quote_pl_id);
        v_updates := v_updates + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'pennylane_sync_ensure_winning_quotes: lead % ignore (%): %',
          v_lead_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_updates;
END
$function$;
