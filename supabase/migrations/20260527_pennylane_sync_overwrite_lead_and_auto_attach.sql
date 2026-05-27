-- ============================================================================
-- Bridge canonique lead <-> customer PL : RPCs cron
-- Date : 2026-05-27
--
-- Decision produit (2026-05-27) : une fois qu'un devis PL est rattache a un
-- lead, PL devient canonique pour l'identite du lead. Le cron doit (1)
-- synchroniser les fields lead avec PL en mode OVERWRITE (sans preserver
-- les saisies user), et (2) auto-rattacher tout nouveau devis PL pour ce
-- meme customer au meme lead.
--
-- Pattern : pennylane_sync_overwrite_lead_fields mirror exact de
-- pennylane_sync_update_client_fields (deja en place pour clients). Le
-- COALESCE+NULLIF protege contre l'ecrasement avec une valeur PL vide
-- ("OVERWRITE-when-PL-has-value").
-- ============================================================================

-- 1. Sync fields lead PL -> MDH (service_role, mode overwrite via NULLIF)
CREATE OR REPLACE FUNCTION public.pennylane_sync_overwrite_lead_fields(
  p_lead_id uuid,
  p_org_id uuid,
  p_fields jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $$
BEGIN
  UPDATE majordhome.leads
  SET
    first_name = COALESCE(NULLIF(p_fields->>'first_name', ''), first_name),
    last_name = COALESCE(NULLIF(p_fields->>'last_name', ''), last_name),
    email = COALESCE(NULLIF(p_fields->>'email', ''), email),
    phone = COALESCE(NULLIF(p_fields->>'phone', ''), phone),
    address = COALESCE(NULLIF(p_fields->>'address', ''), address),
    postal_code = COALESCE(NULLIF(p_fields->>'postal_code', ''), postal_code),
    city = COALESCE(NULLIF(p_fields->>'city', ''), city),
    updated_at = NOW()
  WHERE id = p_lead_id AND org_id = p_org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_overwrite_lead_fields(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_overwrite_lead_fields(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_overwrite_lead_fields(uuid, uuid, jsonb) IS
'Sync direct des fields lead depuis Pennylane (cron). service_role only. Mode OVERWRITE-when-PL-has-value via COALESCE+NULLIF : si PL fournit un field non-vide, on ecrase MDH (PL canonical post-attach). Si PL fournit vide/null, on preserve MDH. 2026-05-27.';

-- 2. Auto-attach d'un nouveau devis PL (cron, sur bridge customer deja existant)
CREATE OR REPLACE FUNCTION public.pennylane_sync_auto_attach_quote(
  p_org_id uuid,
  p_lead_id uuid,
  p_quote_pl_id bigint,
  p_customer_id bigint,
  p_amount_ht numeric,
  p_label text,
  p_quote_date date,
  p_status text,
  p_pdf_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $$
DECLARE
  v_existing_id uuid;
  v_existing_ejected_at timestamptz;
  v_devis_envoye_id uuid;
  v_devis_envoye_order int;
  v_current_order int;
  v_status_bumped bool := false;
BEGIN
  -- Idempotence stricte : on respecte les ejections manuelles de l'user.
  -- Si le quote_pl_id existe deja en base (active OU ejected), no-op.
  SELECT id, ejected_at INTO v_existing_id, v_existing_ejected_at
  FROM majordhome.lead_pennylane_quotes
  WHERE org_id = p_org_id AND pennylane_quote_id = p_quote_pl_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'attached', false,
      'reason', CASE WHEN v_existing_ejected_at IS NOT NULL THEN 'ejected_by_user' ELSE 'already_attached' END
    );
  END IF;

  -- Insert nouveau rattachement
  INSERT INTO majordhome.lead_pennylane_quotes (
    org_id, lead_id, pennylane_quote_id, pennylane_customer_id,
    quote_amount_ht, quote_label, quote_date, quote_status, pdf_url,
    assigned_at, created_at, is_winning_quote
  ) VALUES (
    p_org_id, p_lead_id, p_quote_pl_id, p_customer_id,
    p_amount_ht, p_label, p_quote_date, p_status, p_pdf_url,
    NOW(), NOW(), false
  );

  -- Lookup dynamique du statut "Devis envoye" (label-based, robuste si UUIDs varient par org)
  SELECT s.id, s.display_order INTO v_devis_envoye_id, v_devis_envoye_order
  FROM majordhome.statuses s
  WHERE s.label = 'Devis envoyé'
  LIMIT 1;

  IF v_devis_envoye_id IS NOT NULL THEN
    SELECT s.display_order INTO v_current_order
    FROM majordhome.leads l
    JOIN majordhome.statuses s ON s.id = l.status_id
    WHERE l.id = p_lead_id AND l.org_id = p_org_id;

    -- Bump forward-only : Nouveau/Contacte/RDV planifie -> Devis envoye.
    -- On NE remet PAS en arriere un lead Gagne (5) ou Perdu (6).
    IF v_current_order IS NOT NULL AND v_current_order < v_devis_envoye_order THEN
      UPDATE majordhome.leads
      SET status_id = v_devis_envoye_id,
          status_changed_at = NOW(),
          updated_at = NOW()
      WHERE id = p_lead_id AND org_id = p_org_id;
      v_status_bumped := true;
    END IF;
  END IF;

  RETURN jsonb_build_object('attached', true, 'status_bumped', v_status_bumped);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_auto_attach_quote(uuid, uuid, bigint, bigint, numeric, text, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_auto_attach_quote(uuid, uuid, bigint, bigint, numeric, text, date, text, text) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_auto_attach_quote(uuid, uuid, bigint, bigint, numeric, text, date, text, text) IS
'Auto-attach d''un nouveau devis PL pour un bridge (lead, customer) existant, depuis le cron. service_role only. Idempotent par pennylane_quote_id. Respecte les ejections manuelles (no-op si ejected_at NOT NULL). Bump status si lead en stage < Devis envoye (forward-only : pas de retour en arriere depuis Gagne/Perdu). 2026-05-27.';
