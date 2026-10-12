-- ============================================================================
-- 20261012_5 — Seuil pipeline = réglage d'org ; rattachement automatique du
-- PREMIER devis Pennylane d'un client à sa carte active.
--
-- Décision Eric (2026-10-12, incident ROZIÈRES) :
--   • seuil = réglage d'org `settings.pennylane.pipeline_min_amount_ht` (défaut 500 € HT) ;
--   • au-dessus = chantier = rattachement automatique à la carte lead active du client ;
--   • en dessous = rattachement manuel (explorateur /devis), rien n'est fait tout seul ;
--   • évolution : fléchage vers la carte SAV (quand elle portera le lien vers le devis PL).
--
-- Constat : le cron 15 min (`pennylane-sync-quote-status`, étape 5) rattachait déjà
-- les devis SUIVANTS d'un client, mais ne tenait un client pour « ponté » que s'il
-- avait DÉJÀ un devis rattaché — le premier devis n'était jamais traité. Le cron
-- horaire ne regarde que les clients Pennylane nouveaux (absents de pennylane_sync) :
-- ROZIÈRES ponté à 08:00 sans devis, ses devis de 08:26 et 10:20 sont restés
-- « Non rattaché » 12 h. Le seuil vivait en 4 copies (constants.js + 3 edges) et
-- les devis ÉCARTÉS (pennylane_quote_dismissals) n'étaient pas respectés.
--
-- Objets :
--   1. majordhome.pl_pipeline_min_amount_ht(org)          — le réglage, défaut 500
--   2. majordhome.find_active_lead(org, client, email, tel) — recherche de carte active
--      sortie d'upsert_pennylane_lead (qui l'appelle désormais, même ordre, même garde)
--   3. public.pennylane_sync_auto_attach_pending(org, dry_run) — service_role only
--   4. pennylane_sync_update_quote_fields : p_pipeline_min_ht NULL ⇒ réglage d'org
--
-- Répétée sur scripts/migration-rehearsal/ (assert-pennylane-auto-attach.sql).
-- ============================================================================

-- ── 1. Seuil pipeline de l'org ────────────────────────────────────────────────
-- Valeur non numérique ou absente ⇒ 500 (jamais d'erreur de cast en plein cron).
CREATE OR REPLACE FUNCTION majordhome.pl_pipeline_min_amount_ht(p_org_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((
    SELECT CASE WHEN s.v ~ '^\d+([.,]\d+)?$' THEN replace(s.v, ',', '.')::numeric END
    FROM (
      SELECT trim(o.settings->'pennylane'->>'pipeline_min_amount_ht') AS v
      FROM core.organizations o WHERE o.id = p_org_id
    ) s
  ), 500);
$function$;

REVOKE EXECUTE ON FUNCTION majordhome.pl_pipeline_min_amount_ht(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION majordhome.pl_pipeline_min_amount_ht(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION majordhome.pl_pipeline_min_amount_ht(uuid) IS
  'Seuil (€ HT) sous lequel un devis Pennylane reste hors pipeline : settings.pennylane.pipeline_min_amount_ht, défaut 500. Source unique (RPC + edges).';

-- ── 2. Carte active d'un client Pennylane ───────────────────────────────────
-- Extrait tel quel d'upsert_pennylane_lead : email, puis téléphone, puis client
-- ponté ; carte non supprimée et statut non final. Une seule définition.
CREATE OR REPLACE FUNCTION majordhome.find_active_lead(
  p_org_id    uuid,
  p_client_id uuid,
  p_email     text,
  p_phone     text
)
RETURNS TABLE (lead_id uuid, status_id uuid, matched_by text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_email_norm text := NULLIF(LOWER(TRIM(p_email)), '');
  v_phone_norm text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  IF LENGTH(v_phone_norm) < 8 THEN v_phone_norm := NULL; END IF;

  IF v_email_norm IS NOT NULL THEN
    RETURN QUERY
      SELECT l.id, l.status_id, 'email'::text
      FROM majordhome.leads l
      LEFT JOIN majordhome.statuses s ON s.id = l.status_id
      WHERE l.org_id = p_org_id
        AND COALESCE(l.is_deleted, false) = false
        AND COALESCE(s.is_final, false) = false
        AND LOWER(TRIM(COALESCE(l.email, ''))) = v_email_norm
      ORDER BY l.created_at DESC
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF v_phone_norm IS NOT NULL THEN
    RETURN QUERY
      SELECT l.id, l.status_id, 'phone'::text
      FROM majordhome.leads l
      LEFT JOIN majordhome.statuses s ON s.id = l.status_id
      WHERE l.org_id = p_org_id
        AND COALESCE(l.is_deleted, false) = false
        AND COALESCE(s.is_final, false) = false
        AND regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g') = v_phone_norm
      ORDER BY l.created_at DESC
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF p_client_id IS NOT NULL THEN
    RETURN QUERY
      SELECT l.id, l.status_id, 'client_id'::text
      FROM majordhome.leads l
      LEFT JOIN majordhome.statuses s ON s.id = l.status_id
      WHERE l.org_id = p_org_id
        AND COALESCE(l.is_deleted, false) = false
        AND COALESCE(s.is_final, false) = false
        AND l.client_id = p_client_id
      ORDER BY l.created_at DESC
      LIMIT 1;
  END IF;
END
$function$;

REVOKE EXECUTE ON FUNCTION majordhome.find_active_lead(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION majordhome.find_active_lead(uuid, uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION majordhome.find_active_lead(uuid, uuid, text, text) IS
  'Carte lead ACTIVE (non supprimée, statut non final) d''un contact : email, puis téléphone, puis client_id. Source unique d''upsert_pennylane_lead et du rattachement automatique.';

-- upsert_pennylane_lead : même signature, même comportement, la recherche déléguée.
CREATE OR REPLACE FUNCTION public.upsert_pennylane_lead(
  p_org_id uuid, p_client_id uuid, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text,
  p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_company_name text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_city text DEFAULT NULL::text,
  p_max_quote_ht numeric DEFAULT 0, p_quote_label text DEFAULT NULL::text
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
  v_lead_id uuid;
  v_lead_status uuid;
  v_action text;
  v_matched_by text := NULL;
  v_notes text;
BEGIN
  v_notes := '[Sync PL] Devis ' || COALESCE(p_quote_label,'') || ' - ' || ROUND(p_max_quote_ht)::text || ' EUR HT';

  -- Lead ACTIF : email, puis téléphone, puis client ponté (majordhome.find_active_lead).
  SELECT f.lead_id, f.status_id, f.matched_by
    INTO v_lead_id, v_lead_status, v_matched_by
  FROM majordhome.find_active_lead(p_org_id, p_client_id, p_email, p_phone) f;

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

-- ── 3. Rattachement automatique des devis en attente ────────────────────────
-- Appelée par le cron 15 min (service_role). Candidats : miroir non disparu, non
-- archivé, statut du périmètre balayé, montant ≥ seuil de l'org, AUCUNE ligne
-- lead_pennylane_quotes (une éjection est une décision humaine), pas écarté.
-- Carte : (a) pont par devis déjà rattaché du même client PL (comportement
-- historique de l'étape 5), sinon (b) find_active_lead avec le client ponté
-- (pennylane_sync) et le contact Pennylane (pennylane_customer_lookup).
-- Sans carte active : `no_lead`, rien n'est créé (décision 2026-09-16), le devis
-- est réexaminé au passage suivant (une carte peut apparaître entre-temps).
-- Écriture = pennylane_sync_auto_attach_quote (existant : idempotent, bump
-- forward-only vers « Devis envoyé »). `p_dry_run` = liste sans écrire.
CREATE OR REPLACE FUNCTION public.pennylane_sync_auto_attach_pending(
  p_org_id  uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_min      numeric := majordhome.pl_pipeline_min_amount_ht(p_org_id);
  r          record;
  v_lead     uuid;
  v_by       text;
  v_res      jsonb;
  v_examined int := 0;
  v_attached int := 0;
  v_no_lead  int := 0;
  v_skipped  int := 0;
  v_details  jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT q.pennylane_quote_id, q.customer_id, q.amount_ht, q.quote_number, q.label,
           q.quote_date, q.status, q.pdf_url
    FROM majordhome.pennylane_quotes q
    WHERE q.org_id = p_org_id
      AND q.missing_since IS NULL
      AND q.archived_at IS NULL
      AND q.customer_id IS NOT NULL
      AND q.status IN ('pending', 'expired', 'accepted', 'invoiced', 'denied')
      AND q.amount_ht IS NOT NULL
      AND q.amount_ht >= v_min
      AND NOT EXISTS (
        SELECT 1 FROM majordhome.lead_pennylane_quotes lq
        WHERE lq.org_id = q.org_id AND lq.pennylane_quote_id = q.pennylane_quote_id)
      AND NOT EXISTS (
        SELECT 1 FROM majordhome.pennylane_quote_dismissals d
        WHERE d.org_id = q.org_id AND d.pennylane_quote_id = q.pennylane_quote_id)
    ORDER BY q.quote_date, q.pennylane_quote_id
  LOOP
    v_examined := v_examined + 1;
    v_lead := NULL; v_by := NULL;

    -- (a) pont par devis déjà rattaché (rangée la plus récente, carte non supprimée)
    SELECT lq.lead_id INTO v_lead
    FROM majordhome.lead_pennylane_quotes lq
    JOIN majordhome.leads l ON l.id = lq.lead_id
    WHERE lq.org_id = p_org_id
      AND lq.pennylane_customer_id = r.customer_id
      AND lq.ejected_at IS NULL
      AND COALESCE(l.is_deleted, false) = false
    ORDER BY lq.assigned_at DESC
    LIMIT 1;
    IF v_lead IS NOT NULL THEN v_by := 'bridge'; END IF;

    -- (b) carte active du client ponté / du contact Pennylane
    IF v_lead IS NULL THEN
      SELECT f.lead_id, f.matched_by INTO v_lead, v_by
      FROM majordhome.find_active_lead(
        p_org_id,
        (SELECT s.local_id FROM majordhome.pennylane_sync s
          WHERE s.org_id = p_org_id AND s.entity_type = 'client' AND s.pennylane_id = r.customer_id
          ORDER BY s.created_at DESC LIMIT 1),
        (SELECT k.email FROM majordhome.pennylane_customer_lookup k
          WHERE k.org_id = p_org_id AND k.pennylane_id = r.customer_id LIMIT 1),
        (SELECT k.phone FROM majordhome.pennylane_customer_lookup k
          WHERE k.org_id = p_org_id AND k.pennylane_id = r.customer_id LIMIT 1)
      ) f;
    END IF;

    IF v_lead IS NULL THEN
      v_no_lead := v_no_lead + 1;
      IF jsonb_array_length(v_details) < 50 THEN
        v_details := v_details || jsonb_build_object(
          'quote_pl_id', r.pennylane_quote_id, 'quote_number', r.quote_number,
          'amount_ht', r.amount_ht, 'customer_id', r.customer_id, 'result', 'no_lead');
      END IF;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      IF jsonb_array_length(v_details) < 50 THEN
        v_details := v_details || jsonb_build_object(
          'quote_pl_id', r.pennylane_quote_id, 'quote_number', r.quote_number,
          'amount_ht', r.amount_ht, 'customer_id', r.customer_id,
          'lead_id', v_lead, 'matched_by', v_by, 'result', 'dry_run');
      END IF;
      CONTINUE;
    END IF;

    v_res := public.pennylane_sync_auto_attach_quote(
      p_org_id, v_lead, r.pennylane_quote_id, r.customer_id, r.amount_ht,
      COALESCE(r.quote_number, r.label, 'Q-' || r.pennylane_quote_id::text),
      COALESCE(r.quote_date, CURRENT_DATE), r.status, r.pdf_url);

    IF (v_res->>'attached')::boolean IS TRUE THEN
      v_attached := v_attached + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
    IF jsonb_array_length(v_details) < 50 THEN
      v_details := v_details || jsonb_build_object(
        'quote_pl_id', r.pennylane_quote_id, 'quote_number', r.quote_number,
        'amount_ht', r.amount_ht, 'customer_id', r.customer_id,
        'lead_id', v_lead, 'matched_by', v_by,
        'result', CASE WHEN (v_res->>'attached')::boolean IS TRUE THEN 'attached' ELSE COALESCE(v_res->>'reason', 'skipped') END,
        'status_bumped', (v_res->>'status_bumped')::boolean);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'min_amount_ht', v_min, 'dry_run', p_dry_run,
    'examined', v_examined, 'attached', v_attached, 'no_lead', v_no_lead, 'skipped', v_skipped,
    'details', v_details);
END
$function$;

-- org_id dans le payload sans dérivation d'auth.uid() ⇒ service_role only (cf. CLAUDE.md).
REVOKE EXECUTE ON FUNCTION public.pennylane_sync_auto_attach_pending(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.pennylane_sync_auto_attach_pending(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_auto_attach_pending(uuid, boolean) IS
  'Cron 15 min : rattache à la carte lead active du client tout devis Pennylane du miroir ≥ seuil d''org, non rattaché, non éjecté, non écarté. Sans carte : no_lead (rien n''est créé). p_dry_run liste sans écrire. service_role only.';

-- ── 4. pennylane_sync_update_quote_fields : seuil = réglage d'org par défaut ─
-- Même corps qu'en prod ; seul changement : p_pipeline_min_ht NULL ⇒ réglage.
CREATE OR REPLACE FUNCTION public.pennylane_sync_update_quote_fields(
  p_quote_id uuid, p_new_status text, p_pdf_url text, p_amount_ht numeric DEFAULT NULL::numeric,
  p_label text DEFAULT NULL::text, p_quote_date date DEFAULT NULL::date, p_pipeline_min_ht numeric DEFAULT NULL::numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
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
  v_min_ht          numeric;
BEGIN
  SELECT * INTO v_old
  FROM majordhome.lead_pennylane_quotes
  WHERE id = p_quote_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  -- Seuil : paramètre explicite (compat), sinon réglage de l'org du devis (20261012_5).
  v_min_ht := COALESCE(p_pipeline_min_ht, majordhome.pl_pipeline_min_amount_ht(v_old.org_id));

  v_new_status := COALESCE(NULLIF(p_new_status, ''), v_old.quote_status);
  v_new_pdf    := COALESCE(NULLIF(p_pdf_url, ''),    v_old.pdf_url);
  v_new_amount := COALESCE(p_amount_ht,              v_old.quote_amount_ht);
  v_new_label  := COALESCE(NULLIF(p_label, ''),      v_old.quote_label);
  v_new_date   := COALESCE(p_quote_date,             v_old.quote_date);

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

  IF v_new_amount IS NOT NULL AND v_new_amount < v_min_ht THEN
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

-- ACL inchangées (service_role only), réaffirmées. upsert_pennylane_lead garde la
-- sienne (CREATE OR REPLACE la conserve) : ses appelants ne changent pas ici.
REVOKE EXECUTE ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric) TO service_role;
