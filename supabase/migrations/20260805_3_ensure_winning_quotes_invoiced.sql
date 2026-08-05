-- supabase/migrations/20260805_3_ensure_winning_quotes_invoiced.sql
-- ============================================================================
-- La RPC ne voyait que quote_status = 'accepted', alors que la colonne Gagne
-- accepte 'accepted' OU 'invoiced' (allowlist majordhome.quote_status_bucket).
-- Un devis arrivant deja facture donnait donc une carte en Gagne SANS chantier.
--
-- Latent jusqu'ici (les devis passent par 'accepted' avant d'etre factures, le
-- cron les attrape au passage), mais la descente du seuil pipeline a 500 EUR va
-- importer de l'historique DEJA FACTURE : le trou deviendrait la norme sur ce
-- lot.
--
-- Seul le SELECT change. Le reste de la RPC est identique.
--
-- Spec : docs/superpowers/specs/2026-08-05-pennylane-resync-montants-devis-design.md (§9)
-- Plan : docs/superpowers/plans/2026-08-05-pennylane-resync-montants-devis.md (Task 5)
-- ============================================================================

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
      AND majordhome.quote_status_bucket(lpq.quote_status) = 'validated'
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
      AND majordhome.quote_status_bucket(quote_status) = 'validated'
    ORDER BY pennylane_quote_id DESC
    LIMIT 1;

    IF v_quote_pl_id IS NOT NULL THEN
      BEGIN
        PERFORM public.lead_mark_won_with_quote(p_org_id, v_lead_id, v_quote_pl_id);
        v_updates := v_updates + 1;
      EXCEPTION WHEN OTHERS THEN
        -- ne pas casser le batch si un lead echoue
        RAISE WARNING 'pennylane_sync_ensure_winning_quotes: lead % ignore (%): %',
          v_lead_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_updates;
END
$function$;
