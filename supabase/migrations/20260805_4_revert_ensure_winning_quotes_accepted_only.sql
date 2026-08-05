-- supabase/migrations/20260805_4_revert_ensure_winning_quotes_accepted_only.sql
-- ============================================================================
-- REVERT de 20260805_3. Retour au declencheur 'accepted' UNIQUEMENT.
--
-- 20260805_3 avait elargi le declencheur a quote_status_bucket = 'validated'
-- (donc 'accepted' OU 'invoiced'), au motif que la colonne Gagne accepte les
-- deux : un devis arrivant directement en 'invoiced' produisait une carte Gagne
-- sans chantier.
--
-- C'etait une ERREUR d'analyse. Le filtre 'accepted' n'est pas un oubli, c'est
-- un GARDE-FOU documente : un devis 'invoiced' est deja facture, et dans le flux
-- normal il est passe par 'accepted' avant — sa carte chantier existe deja.
-- Elargir a 'invoiced' ne change rien en flux normal et devient destructeur des
-- qu'on importe de l'historique : chaque vieux devis facture creerait une carte
-- de prepa chantier pour un travail termine et encaisse.
--
-- Le cas residuel (devis facture sans passer par 'accepted', affaire vivante)
-- est rare et rattrapable a la main — un ordre de grandeur moins couteux qu'une
-- prepa chantier inondee de chantiers deja livres.
--
-- ⚠️ NE PAS "corriger" a nouveau. Si un jour le besoin revient, la bonne reponse
-- n'est pas d'elargir ce declencheur mais de traiter le cas a la source.
--
-- Impact du round-trip : NUL. Les 3 leads concernes avaient deja leur
-- chantier_status et lead_mark_won_with_quote est idempotent — aucun chantier
-- retroactif n'a ete cree entre 20260805_3 et ce revert.
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
        -- ne pas casser le batch si un lead echoue
        RAISE WARNING 'pennylane_sync_ensure_winning_quotes: lead % ignore (%): %',
          v_lead_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_updates;
END
$function$;

COMMENT ON FUNCTION public.pennylane_sync_ensure_winning_quotes(uuid) IS
  'Helper du cron : pour chaque lead avec >=1 devis accepted sans devis gagnant, appelle lead_mark_won_with_quote sur le plus recent accepted (effet gagne complet -> cree le chantier). Declencheur sur accepted UNIQUEMENT : garde-fou delibere contre la creation de chantiers retroactifs sur de vieux invoiced (cf migration 20260805_4). service_role only.';
