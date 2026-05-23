-- supabase/migrations/20260523_3_lead_mark_won_with_quote.sql
-- PR 3 du bridge Pipeline ↔ Pennylane
-- Spec : docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md §6 RPC 2, §10
--
-- Marque un devis Pennylane attaché comme canonique gagnant, bascule le lead
-- en "Gagné" (avec won_date + chantier_status='gagne' cohérent avec
-- leads.service.js:updateLeadStatus), insère 1 lead_activity 'status_changed'
-- source='mark_won_with_quote'.
--
-- Idempotence :
-- - Si lead déjà Gagné (display_order=5) → pas de bascule, pas de lead_activity,
--   mais le flag winning peut quand même bouger (cas usage : commercial change
--   d'avis sur quel devis est canonique).
-- - Si lead Perdu (display_order=6) ou autre statut → bascule en Gagné
--   (override). Pratique pour corriger une erreur de saisie.
--
-- Note : le lock de la fiche technique terrain reste côté front
-- (fire-and-forget dans leads.service.js:454), géré par le caller PR 5
-- (MarkWonQuoteModal). La RPC ne le fait pas car le futur cron PR 7
-- l'appellera sans session user.

CREATE OR REPLACE FUNCTION public.lead_mark_won_with_quote(
  p_org_id uuid,
  p_lead_id uuid,
  p_winning_quote_pl_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_pennylane_enabled bool := false;
  v_current_status_id uuid;
  v_current_display_order int;
  v_gagne_status_id uuid;
  v_target_lpq_id uuid;
  v_target_quote_label text;
  v_status_changed bool := false;
BEGIN
  -- ============================================================================
  -- 1. Check membership multi-tenant (P0.7)
  -- ============================================================================
  IF v_user IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.org_id = p_org_id AND om.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Acces refuse' USING ERRCODE = '42501';
  END IF;

  -- ============================================================================
  -- 2. Check org existe + settings.pennylane.enabled = true
  -- ============================================================================
  SELECT COALESCE((settings->'pennylane'->>'enabled')::bool, false)
    INTO v_pennylane_enabled
  FROM core.organizations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Org % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_pennylane_enabled THEN
    RAISE EXCEPTION 'Pennylane integration disabled for org %', p_org_id
      USING ERRCODE = '42501';
  END IF;

  -- ============================================================================
  -- 3. Charger le lead + son statut courant
  -- ============================================================================
  SELECT l.status_id, s.display_order
    INTO v_current_status_id, v_current_display_order
  FROM majordhome.leads l
  LEFT JOIN majordhome.statuses s ON s.id = l.status_id
  WHERE l.id = p_lead_id AND l.org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % not found in org %', p_lead_id, p_org_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ============================================================================
  -- 4. Vérifier que le devis est bien attaché à ce lead (actif, non-éjecté)
  -- ============================================================================
  SELECT id, quote_label INTO v_target_lpq_id, v_target_quote_label
  FROM majordhome.lead_pennylane_quotes
  WHERE lead_id = p_lead_id
    AND pennylane_quote_id = p_winning_quote_pl_id
    AND org_id = p_org_id
    AND ejected_at IS NULL
  LIMIT 1;

  IF v_target_lpq_id IS NULL THEN
    RAISE EXCEPTION 'Devis Pennylane % non attaché au lead %', p_winning_quote_pl_id, p_lead_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ============================================================================
  -- 5. Set is_winning_quote=false sur les autres devis du lead (unicité)
  -- ============================================================================
  UPDATE majordhome.lead_pennylane_quotes
  SET is_winning_quote = false
  WHERE lead_id = p_lead_id
    AND ejected_at IS NULL
    AND id <> v_target_lpq_id
    AND is_winning_quote = true;  -- évite UPDATE inutile

  -- ============================================================================
  -- 6. Set is_winning_quote=true sur le cible
  -- ============================================================================
  UPDATE majordhome.lead_pennylane_quotes
  SET is_winning_quote = true
  WHERE id = v_target_lpq_id;

  -- ============================================================================
  -- 7. Bascule lead → Gagné (si pas déjà Gagné)
  -- ============================================================================
  IF v_current_display_order IS NULL OR v_current_display_order <> 5 THEN
    SELECT id INTO v_gagne_status_id
    FROM majordhome.statuses
    WHERE display_order = 5
    LIMIT 1;

    IF v_gagne_status_id IS NOT NULL THEN
      UPDATE majordhome.leads SET
        status_id = v_gagne_status_id,
        won_date = CURRENT_DATE,
        chantier_status = 'gagne',
        updated_at = now()
      WHERE id = p_lead_id;

      INSERT INTO majordhome.lead_activities (
        lead_id, user_id, activity_type, description,
        old_status_id, new_status_id, metadata, org_id
      ) VALUES (
        p_lead_id,
        v_user,
        'status_changed',
        'Statut : ' ||
          COALESCE((SELECT label FROM majordhome.statuses WHERE id = v_current_status_id), '?') ||
          ' → Gagné (devis canonique : ' ||
          COALESCE(v_target_quote_label, p_winning_quote_pl_id::text) || ')',
        v_current_status_id,
        v_gagne_status_id,
        jsonb_build_object(
          'source', 'mark_won_with_quote',
          'winning_quote_pl_id', p_winning_quote_pl_id,
          'winning_quote_label', v_target_quote_label
        ),
        p_org_id
      );

      v_status_changed := true;
    END IF;
  END IF;

  -- ============================================================================
  -- 8. Retour JSON
  -- ============================================================================
  RETURN jsonb_build_object(
    'lead_status_changed', v_status_changed,
    'winning_quote_pl_id', p_winning_quote_pl_id,
    'winning_quote_label', v_target_quote_label
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.lead_mark_won_with_quote(uuid, uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_mark_won_with_quote(uuid, uuid, bigint) TO authenticated;

COMMENT ON FUNCTION public.lead_mark_won_with_quote(uuid, uuid, bigint) IS
  'PR 3 du bridge Pipeline ↔ Pennylane. Marque un devis attaché comme winning (is_winning_quote=true), set is_winning_quote=false sur les autres devis du lead, bascule le lead en "Gagné" (won_date=today, chantier_status=''gagne''), insère lead_activity ''status_changed'' source=''mark_won_with_quote''. Idempotent (si lead déjà Gagné, pas de bascule mais flag winning peut bouger). Le lock fiche technique terrain reste côté front. Spec : docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md §6 RPC 2.';
