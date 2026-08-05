-- supabase/migrations/20260805_2_pennylane_sync_update_quote_fields_v2.sql
-- ============================================================================
-- v2 : la RPC de sync propage aussi le CONTENU du devis (montant / numero /
-- date), pas seulement status + pdf_url.
--
-- Bug corrige : un devis modifie dans Pennylane apres rattachement gardait son
-- montant d'origine. La carte affichait une photo d'avril tout en ouvrant un PDF
-- de mai (lead FLECHER : 7096 en base, 7386 chez Pennylane).
--
-- Effets de bord voulus, tous dans cette RPC (transaction unique) :
--   1. ecriture d'une ligne lead_quote_revisions si le CONTENU change
--   2. ligne de timeline lead_activities (type 'quote_revised')
--   3. repropagation de leads.order_amount_ht si le devis touche est le plus
--      recent du lead (tie-break pennylane_quote_id DESC, meme regle qu'a
--      l'attache)
--
-- Le seuil pipeline arrive en PARAMETRE (p_pipeline_min_ht) : il vit deja en 4
-- exemplaires cote code, on n'en cree pas un 5e en base.
--
-- Spec : docs/superpowers/specs/2026-08-05-pennylane-resync-montants-devis-design.md
-- Plan : docs/superpowers/plans/2026-08-05-pennylane-resync-montants-devis.md (Task 2)
-- ============================================================================

-- L'ancienne signature DOIT partir : garder les deux rendrait l'appel a 3
-- arguments ambigu (les nouveaux parametres ont des DEFAULT).
DROP FUNCTION IF EXISTS public.pennylane_sync_update_quote_fields(uuid, text, text);

CREATE OR REPLACE FUNCTION public.pennylane_sync_update_quote_fields(
  p_quote_id        uuid,
  p_new_status      text,
  p_pdf_url         text,
  p_amount_ht       numeric DEFAULT NULL,
  p_label           text    DEFAULT NULL,
  p_quote_date      date    DEFAULT NULL,
  p_pipeline_min_ht numeric DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
DECLARE
  -- Marqueur historique : tout devis rattache AVANT cette date et dont on
  -- decouvre un ecart pour la premiere fois releve de la reconciliation
  -- initiale (le delta est reel, sa date de modification est inconnue).
  c_reconciliation_cutoff constant timestamptz := '2026-08-05 00:00:00+00';

  v_old             record;
  v_won_date        date;
  v_new_status      text;
  v_new_pdf         text;
  v_new_amount      numeric;
  v_new_label       text;
  v_new_date        date;
  v_content_changed boolean;
  v_any_changed     boolean;
  v_flags           text[] := '{}'::text[];
  v_source          text;
  v_delta           numeric;
  v_delta_pct       numeric;
  v_max_pl_id       bigint;
BEGIN
  SELECT * INTO v_old
  FROM majordhome.lead_pennylane_quotes
  WHERE id = p_quote_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  -- COALESCE strict : ne JAMAIS vider une valeur existante avec NULL.
  v_new_status := COALESCE(NULLIF(p_new_status, ''), v_old.quote_status);
  v_new_pdf    := COALESCE(NULLIF(p_pdf_url, ''),    v_old.pdf_url);
  v_new_amount := COALESCE(p_amount_ht,              v_old.quote_amount_ht);
  v_new_label  := COALESCE(NULLIF(p_label, ''),      v_old.quote_label);
  v_new_date   := COALESCE(p_quote_date,             v_old.quote_date);

  -- Contenu = ce qui fait l'objet d'une revision. Un simple changement de
  -- status ou de pdf_url est du cycle de vie, pas une modification de devis.
  v_content_changed :=
       v_new_amount IS DISTINCT FROM v_old.quote_amount_ht
    OR v_new_label  IS DISTINCT FROM v_old.quote_label
    OR v_new_date   IS DISTINCT FROM v_old.quote_date;

  v_any_changed := v_content_changed
    OR v_new_status IS DISTINCT FROM v_old.quote_status
    OR v_new_pdf    IS DISTINCT FROM v_old.pdf_url;

  IF NOT v_any_changed THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'no_change');
  END IF;

  UPDATE majordhome.lead_pennylane_quotes SET
    quote_status    = v_new_status,
    pdf_url         = v_new_pdf,
    quote_amount_ht = v_new_amount,
    quote_label     = v_new_label,
    quote_date      = v_new_date
  WHERE id = p_quote_id;

  IF NOT v_content_changed THEN
    RETURN jsonb_build_object('updated', true, 'revision', false);
  END IF;

  -- ---- Revision -----------------------------------------------------------
  SELECT won_date INTO v_won_date FROM majordhome.leads WHERE id = v_old.lead_id;

  -- Le cast ::text est OBLIGATOIRE : sans lui, `text[] || 'litteral'` est
  -- resolu en concatenation de deux TABLEAUX et Postgres tente de parser la
  -- chaine comme un array literal -> 22P02 malformed array literal.
  IF v_won_date IS NOT NULL THEN
    v_flags := v_flags || 'modified_after_won'::text;
  END IF;

  IF majordhome.quote_status_bucket(v_old.quote_status) = 'validated' THEN
    v_flags := v_flags || 'modified_after_validated'::text;
  END IF;

  IF v_new_amount IS NOT NULL AND v_new_amount < p_pipeline_min_ht THEN
    v_flags := v_flags || 'below_pipeline_threshold'::text;
  END IF;

  v_delta := v_new_amount - COALESCE(v_old.quote_amount_ht, 0);
  v_delta_pct := CASE
    WHEN COALESCE(v_old.quote_amount_ht, 0) <> 0
      THEN ROUND(v_delta / v_old.quote_amount_ht * 100, 2)
    ELSE NULL
  END;

  v_source := CASE
    WHEN v_old.assigned_at < c_reconciliation_cutoff
     AND NOT EXISTS (
       SELECT 1 FROM majordhome.lead_quote_revisions r
       WHERE r.lead_quote_id = p_quote_id
     )
    THEN 'initial_reconciliation'
    ELSE 'sync'
  END;

  INSERT INTO majordhome.lead_quote_revisions (
    org_id, lead_quote_id, lead_id, pennylane_quote_id,
    amount_ht, quote_label, quote_date, quote_status,
    previous_amount_ht, amount_delta, amount_delta_pct,
    source, anomaly_flags
  ) VALUES (
    v_old.org_id, p_quote_id, v_old.lead_id, v_old.pennylane_quote_id,
    v_new_amount, v_new_label, v_new_date, v_new_status,
    v_old.quote_amount_ht, v_delta, v_delta_pct,
    v_source, v_flags
  );

  -- ---- Timeline lead ------------------------------------------------------
  -- Pas de TO_CHAR : les separateurs de milliers dependent de lc_numeric et
  -- peuvent injecter des caracteres exotiques. ROUND()::text est neutre.
  INSERT INTO majordhome.lead_activities (
    lead_id, user_id, activity_type, description, metadata, org_id
  ) VALUES (
    v_old.lead_id,
    NULL,
    'quote_revised',
    'Devis ' || COALESCE(v_new_label, '?') || ' modifié dans Pennylane : ' ||
      ROUND(COALESCE(v_old.quote_amount_ht, 0))::text || ' € → ' ||
      ROUND(COALESCE(v_new_amount, 0))::text || ' € HT',
    jsonb_build_object(
      'source', v_source,
      'pennylane_quote_id', v_old.pennylane_quote_id,
      'previous_amount_ht', v_old.quote_amount_ht,
      'amount_ht', v_new_amount,
      'amount_delta', v_delta,
      'anomaly_flags', v_flags
    ),
    v_old.org_id
  );

  -- ---- Repropagation de leads.order_amount_ht -----------------------------
  -- Uniquement si le devis touche est le plus recent du lead. Tie-break
  -- pennylane_quote_id DESC : l'ID interne PL est strictement incremental.
  IF v_new_amount IS DISTINCT FROM v_old.quote_amount_ht THEN
    SELECT max(pennylane_quote_id) INTO v_max_pl_id
    FROM majordhome.lead_pennylane_quotes
    WHERE lead_id = v_old.lead_id AND ejected_at IS NULL;

    IF v_max_pl_id = v_old.pennylane_quote_id THEN
      UPDATE majordhome.leads
      SET order_amount_ht = ROUND(v_new_amount),
          updated_at = now()
      WHERE id = v_old.lead_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'revision', true,
    'source', v_source,
    'amount_delta', v_delta,
    'anomaly_flags', v_flags
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric)
  TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric) IS
  'Sync des champs mutables d''un devis Pennylane rattache (status, pdf_url, montant, numero, date) depuis le cron pennylane-sync-quote-status. Ecrit une revision + une ligne de timeline si le CONTENU change, et repropage leads.order_amount_ht si le devis est le plus recent. service_role only. COALESCE strict. Idempotent.';
