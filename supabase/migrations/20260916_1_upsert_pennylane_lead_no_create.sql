-- ============================================================================
-- 20260916_1 — upsert_pennylane_lead ne crée plus JAMAIS de lead
-- ============================================================================
--
-- Décision Eric (2026-09-16) : un flux serveur (cron pennylane-sync-cron,
-- job pennylane-backfill-quotes) n'invente pas de carte commerciale. Si aucun
-- lead ACTIF ne correspond au client Pennylane, la RPC renvoie `no_lead` et le
-- devis reste « Non rattaché » dans l'explorateur de devis (/devis), où un
-- humain tranche : Rattacher / Créer le lead / Écarter.
--
-- Vécu : GOTTARDI ELIANE (2026-09-11) — fiche Pennylane créée sans email ni
-- téléphone, le cron n'a rien pu rapprocher et a créé un 2ᵉ lead à côté de
-- celui saisi la veille par le commercial. Doublon silencieux.
--
-- Changements par rapport à la version précédente :
--   1. Plus de branche INSERT (action `lead_created` disparaît).
--   2. Le rapprochement ne retient que les leads NON TERMINÉS (statut non
--      final) : un nouveau devis pour un client dont le lead est Gagné ou
--      Perdu n'a rien à faire sur cette carte — c'est un nouveau projet, à
--      qualifier à la main depuis l'explorateur.
--   3. 3ᵉ axe de rapprochement : les leads déjà liés au client résolu
--      (`client_id = p_client_id`), pour couvrir le cas où le contact du lead
--      diffère de la fiche Pennylane.
--
-- Signature, sécurité (SECURITY DEFINER, service_role only) inchangées.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_pennylane_lead(
  p_org_id uuid,
  p_client_id uuid,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_first_name text DEFAULT NULL::text,
  p_last_name text DEFAULT NULL::text,
  p_company_name text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_postal_code text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_max_quote_ht numeric DEFAULT 0,
  p_quote_label text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_status_devis_envoye uuid := '47937391-5ffa-4804-9b5d-72f3fec6f4fe';
  v_status_gagne uuid := 'c717780c-0ba7-4bf1-9e1e-5f014c1e9e2f';
  v_status_perdu uuid := 'e0419cea-d0fe-4be5-aba4-56197b2fd4fb';
  v_email_norm text;
  v_phone_norm text;
  v_lead_id uuid;
  v_lead_status uuid;
  v_action text;
  v_matched_by text := NULL;
  v_notes text;
BEGIN
  v_email_norm := NULLIF(LOWER(TRIM(p_email)), '');
  v_phone_norm := regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g');
  IF LENGTH(v_phone_norm) < 8 THEN v_phone_norm := NULL; END IF;
  v_notes := '[Sync PL] Devis ' || COALESCE(p_quote_label,'') || ' - ' || ROUND(p_max_quote_ht)::text || ' EUR HT';

  -- 1) Lead ACTIF par email
  IF v_email_norm IS NOT NULL THEN
    SELECT l.id, l.status_id INTO v_lead_id, v_lead_status
    FROM majordhome.leads l
    LEFT JOIN majordhome.statuses s ON s.id = l.status_id
    WHERE l.org_id = p_org_id
      AND COALESCE(l.is_deleted, false) = false
      AND COALESCE(s.is_final, false) = false
      AND LOWER(TRIM(COALESCE(l.email,''))) = v_email_norm
    ORDER BY l.created_at DESC
    LIMIT 1;
    IF v_lead_id IS NOT NULL THEN v_matched_by := 'email'; END IF;
  END IF;

  -- 2) Lead ACTIF par téléphone
  IF v_lead_id IS NULL AND v_phone_norm IS NOT NULL THEN
    SELECT l.id, l.status_id INTO v_lead_id, v_lead_status
    FROM majordhome.leads l
    LEFT JOIN majordhome.statuses s ON s.id = l.status_id
    WHERE l.org_id = p_org_id
      AND COALESCE(l.is_deleted, false) = false
      AND COALESCE(s.is_final, false) = false
      AND regexp_replace(COALESCE(l.phone,''), '[^0-9]', '', 'g') = v_phone_norm
    ORDER BY l.created_at DESC
    LIMIT 1;
    IF v_lead_id IS NOT NULL THEN v_matched_by := 'phone'; END IF;
  END IF;

  -- 3) Lead ACTIF déjà lié au client résolu
  IF v_lead_id IS NULL AND p_client_id IS NOT NULL THEN
    SELECT l.id, l.status_id INTO v_lead_id, v_lead_status
    FROM majordhome.leads l
    LEFT JOIN majordhome.statuses s ON s.id = l.status_id
    WHERE l.org_id = p_org_id
      AND COALESCE(l.is_deleted, false) = false
      AND COALESCE(s.is_final, false) = false
      AND l.client_id = p_client_id
    ORDER BY l.created_at DESC
    LIMIT 1;
    IF v_lead_id IS NOT NULL THEN v_matched_by := 'client_id'; END IF;
  END IF;

  -- Aucune carte active : on n'invente rien. Le devis reste « Non rattaché »
  -- dans l'explorateur, l'humain décide.
  IF v_lead_id IS NULL THEN
    RETURN jsonb_build_object('lead_id', NULL, 'action', 'no_lead', 'matched_by', NULL);
  END IF;

  -- Lead existe : ne pas rétrograder un statut prioritaire
  IF v_lead_status IN (v_status_devis_envoye, v_status_gagne, v_status_perdu) THEN
    UPDATE majordhome.leads SET client_id = COALESCE(client_id, p_client_id)
    WHERE id = v_lead_id AND client_id IS NULL;
    v_action := 'lead_skipped_priority_status';
  ELSE
    UPDATE majordhome.leads SET
      status_id = v_status_devis_envoye,
      quote_sent_date = CURRENT_DATE,
      client_id = COALESCE(client_id, p_client_id),
      estimated_revenue = p_max_quote_ht,
      notes = v_notes
    WHERE id = v_lead_id;
    v_action := 'lead_updated';
  END IF;

  RETURN jsonb_build_object('lead_id', v_lead_id, 'action', v_action, 'matched_by', v_matched_by);
END
$function$;

-- Posture inchangée : service_role only (cron + job). PUBLIC obligatoire dans
-- le REVOKE, sinon anon hérite (cf. charte multi-tenant).
REVOKE EXECUTE ON FUNCTION public.upsert_pennylane_lead(uuid, uuid, text, text, text, text, text, text, text, text, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_pennylane_lead(uuid, uuid, text, text, text, text, text, text, text, text, numeric, text)
  TO service_role;

COMMENT ON FUNCTION public.upsert_pennylane_lead(uuid, uuid, text, text, text, text, text, text, text, text, numeric, text) IS
  'Rapproche un client Pennylane d''un lead ACTIF (email, téléphone, client_id) et le passe en Devis envoyé. Ne crée JAMAIS de lead : renvoie action=no_lead, le devis reste Non rattaché dans l''explorateur (décision 2026-09-16).';
