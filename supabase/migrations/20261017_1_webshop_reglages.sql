-- ============================================================================
-- 20261017_1_webshop_reglages.sql — la base lit les réglages de livraison du webshop
-- (spec docs/superpowers/specs/2026-10-17-webshop-parametrage-livraison-process-design.md).
--
-- Source des valeurs : core.organizations.settings.webshop (org CORE), éditée dans
-- Settings → Webshop ; défauts = src/lib/webshop/reglages.js (WEBSHOP_REGLAGES_DEFAUT),
-- recopiés par scripts/gen-webshop-reglages-sql.mjs dans majordhome.webshop_reglages_defaut().
--   - majordhome.webshop_reglages(org)      : défaut ← settings.webshop, mêmes bornes que le JS ;
--   - majordhome.webshop_should_send(org, t): envoi_auto ET heure de Paris = heure_envoi ;
--   - public.webshop_cycle_week(date, ancre): rang dans le cycle de 4 semaines, ancre réglable.
-- Fonctions remplacées À SIGNATURE IDENTIQUE (définitions LIVE de prod, pg_get_functiondef du
-- 2026-10-17 — le site Mayer en appelle cinq) : J-2 → délai de l'org, capacité 10 → réglage,
-- horizon 12 → réglage si NULL, ancre fixe → réglage, URL du site → réglage `site_url`.
-- close_reason reste 'j_minus_2' (valeur du CHECK ; libellé front corrigé ailleurs).
-- Cron webshop-tours-daily : horaire ; chaque org est fermée (J-n) puis envoyée à SON heure
-- d'envoi (heure de Paris) — jamais avant : défaut 18 h = comportement historique.
-- Répétée sur scripts/migration-rehearsal/ (assert-webshop-reglages.sql + assert-webshop-tournees.sql).
-- ============================================================================

-- ---------- 1. Défauts (GÉNÉRÉ — ne pas éditer à la main) -------------------
-- GÉNÉRÉ par scripts/gen-webshop-reglages-sql.mjs depuis src/lib/webshop/reglages.js — ne pas éditer à la main.
CREATE OR REPLACE FUNCTION majordhome.webshop_reglages_defaut()
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $f$
  SELECT $defaut${"site_url":"","emails":{"interne":[]},"depots":[{"code":"castanet","libelle":"Dépôt Castanet-Tolosan","adresse":"Castanet-Tolosan"}],"palette":{"transporteur":{"nom":"","emails":[],"note":""},"envoi_auto":true,"heure_envoi":18,"delai_fermeture_jours":2,"horizon_semaines":12,"ancre_cycle":"2026-01-05","capacite_emplacements":10,"prix_emplacement_defaut_cents":5500,"tva_pct":10,"max_emplacements_panier":10},"colis":{"prestataire":{"nom":"","mode":"email","emails":[],"note":""},"tva_pct":20,"max_qty_ligne":20}}$defaut$::jsonb;
$f$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_reglages_defaut() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.webshop_reglages_defaut() TO service_role;

-- ---------- 2. Coercition (miroir de entierBorne / dateIso de reglages.js) --
-- Entier dans [min, max] depuis un nombre JSON ou une chaîne non vide, sinon défaut.
CREATE OR REPLACE FUNCTION majordhome.webshop_reglage_entier(p_v jsonb, p_min integer, p_max integer, p_defaut integer)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  n numeric;
BEGIN
  IF jsonb_typeof(p_v) = 'number' THEN
    n := (p_v #>> '{}')::numeric;
  ELSIF jsonb_typeof(p_v) = 'string' AND btrim(p_v #>> '{}') <> '' THEN
    BEGIN
      n := btrim(p_v #>> '{}')::numeric;
    EXCEPTION WHEN others THEN
      RETURN p_defaut;
    END;
  ELSE
    RETURN p_defaut;
  END IF;
  IF (n = trunc(n) AND n >= p_min AND n <= p_max) IS TRUE THEN
    RETURN n::integer;
  END IF;
  RETURN p_defaut;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_reglage_entier(jsonb, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.webshop_reglage_entier(jsonb, integer, integer, integer) TO service_role;

-- Date ISO YYYY-MM-DD réellement existante, sinon défaut.
CREATE OR REPLACE FUNCTION majordhome.webshop_reglage_date(p_v jsonb, p_defaut text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  s text;
  d date;
BEGIN
  IF jsonb_typeof(p_v) IS DISTINCT FROM 'string' THEN RETURN p_defaut; END IF;
  s := p_v #>> '{}';
  IF (s ~ '^\d{4}-\d{2}-\d{2}$') IS NOT TRUE THEN RETURN p_defaut; END IF;
  BEGIN
    d := s::date;
  EXCEPTION WHEN others THEN
    RETURN p_defaut;
  END;
  IF to_char(d, 'YYYY-MM-DD') = s THEN RETURN s; END IF;
  RETURN p_defaut;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_reglage_date(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.webshop_reglage_date(jsonb, text) TO service_role;

-- Fusion profonde : objet ← objet récursivement ; un objet par défaut n'est jamais remplacé
-- par autre chose qu'un objet ; une feuille est remplacée par toute valeur non nulle.
CREATE OR REPLACE FUNCTION majordhome.webshop_jsonb_fusion(p_defaut jsonb, p_valeur jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  r jsonb;
  k text;
  v jsonb;
BEGIN
  IF jsonb_typeof(p_defaut) IS DISTINCT FROM 'object' THEN
    IF p_valeur IS NULL OR jsonb_typeof(p_valeur) = 'null' THEN RETURN p_defaut; END IF;
    RETURN p_valeur;
  END IF;
  IF jsonb_typeof(p_valeur) IS DISTINCT FROM 'object' THEN RETURN p_defaut; END IF;
  r := p_defaut;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(p_valeur) e LOOP
    IF r ? k THEN
      r := jsonb_set(r, ARRAY[k], majordhome.webshop_jsonb_fusion(r -> k, v));
    ELSE
      r := r || jsonb_build_object(k, v);
    END IF;
  END LOOP;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_jsonb_fusion(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.webshop_jsonb_fusion(jsonb, jsonb) TO service_role;

-- ---------- 3. Réglages d'une org --------------------------------------------
-- Fusion profonde défaut ← settings.webshop, puis coercition des clés lues par la base
-- (site_url, depots, palette.*) avec les bornes de buildWebshopConfig. Org inconnue = défauts.
CREATE OR REPLACE FUNCTION majordhome.webshop_reglages(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $$
DECLARE
  d  jsonb := majordhome.webshop_reglages_defaut();
  dp jsonb := majordhome.webshop_reglages_defaut() -> 'palette';
  w  jsonb;
  p  jsonb;
  r  jsonb;
  v_depots jsonb;
  v_capacite integer;
BEGIN
  SELECT o.settings -> 'webshop' INTO w FROM core.organizations o WHERE o.id = p_org_id;
  IF jsonb_typeof(w) IS DISTINCT FROM 'object' THEN w := '{}'::jsonb; END IF;
  p := CASE WHEN jsonb_typeof(w -> 'palette') = 'object' THEN w -> 'palette' ELSE '{}'::jsonb END;

  r := majordhome.webshop_jsonb_fusion(d, w);

  r := jsonb_set(r, '{site_url}', to_jsonb(
         CASE WHEN jsonb_typeof(w -> 'site_url') = 'string' THEN btrim(w ->> 'site_url') ELSE d ->> 'site_url' END));

  SELECT jsonb_agg(jsonb_build_object(
           'code', t.c,
           'libelle', COALESCE(NULLIF(t.l, ''), 'Dépôt ' || t.c),
           'adresse', COALESCE(NULLIF(t.a, ''), t.c)) ORDER BY t.ord)
    INTO v_depots
    FROM (SELECT x.ord, btrim(x.e ->> 'code') AS c,
                 CASE WHEN jsonb_typeof(x.e -> 'libelle') = 'string' THEN btrim(x.e ->> 'libelle') END AS l,
                 CASE WHEN jsonb_typeof(x.e -> 'adresse') = 'string' THEN btrim(x.e ->> 'adresse') END AS a
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w -> 'depots') = 'array' THEN w -> 'depots' ELSE '[]'::jsonb END)
                 WITH ORDINALITY AS x(e, ord)
           WHERE jsonb_typeof(x.e) = 'object' AND jsonb_typeof(x.e -> 'code') = 'string' AND btrim(x.e ->> 'code') <> '') t;
  r := jsonb_set(r, '{depots}', COALESCE(v_depots, d -> 'depots'));

  v_capacite := majordhome.webshop_reglage_entier(p -> 'capacite_emplacements', 1, 40, (dp ->> 'capacite_emplacements')::integer);
  r := jsonb_set(r, '{palette}', (r -> 'palette') || jsonb_build_object(
    'envoi_auto', CASE
                    WHEN jsonb_typeof(p -> 'envoi_auto') = 'boolean' THEN (p ->> 'envoi_auto')::boolean
                    WHEN jsonb_typeof(p -> 'envoi_auto') = 'string' AND p ->> 'envoi_auto' IN ('true', 'false') THEN (p ->> 'envoi_auto')::boolean
                    ELSE (dp ->> 'envoi_auto')::boolean END,
    'heure_envoi', majordhome.webshop_reglage_entier(p -> 'heure_envoi', 0, 23, (dp ->> 'heure_envoi')::integer),
    'delai_fermeture_jours', majordhome.webshop_reglage_entier(p -> 'delai_fermeture_jours', 0, 14, (dp ->> 'delai_fermeture_jours')::integer),
    'horizon_semaines', majordhome.webshop_reglage_entier(p -> 'horizon_semaines', 1, 26, (dp ->> 'horizon_semaines')::integer),
    'ancre_cycle', majordhome.webshop_reglage_date(p -> 'ancre_cycle', dp ->> 'ancre_cycle'),
    'capacite_emplacements', v_capacite,
    'prix_emplacement_defaut_cents', majordhome.webshop_reglage_entier(p -> 'prix_emplacement_defaut_cents', 0, 10000000, (dp ->> 'prix_emplacement_defaut_cents')::integer)));
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_reglages(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.webshop_reglages(uuid) TO service_role;

-- Envoi automatique dû à cet instant : envoi_auto ET heure de Paris = heure_envoi.
CREATE OR REPLACE FUNCTION majordhome.webshop_should_send(p_org_id uuid, p_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO ''
AS $$
  SELECT ((r.v -> 'palette' ->> 'envoi_auto')::boolean
          AND extract(hour FROM p_at AT TIME ZONE 'Europe/Paris') = (r.v -> 'palette' ->> 'heure_envoi')::integer) IS TRUE
    FROM (SELECT majordhome.webshop_reglages(p_org_id) AS v) r;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_should_send(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.webshop_should_send(uuid, timestamptz) TO service_role;

-- ---------- 4. Cycle de quatre semaines, ancre réglable ---------------------
CREATE OR REPLACE FUNCTION public.webshop_cycle_week(p_date date, p_ancre date)
RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT (((floor((p_date - p_ancre) / 7.0)::integer % 4) + 4) % 4) + 1;
$$;
REVOKE EXECUTE ON FUNCTION public.webshop_cycle_week(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_cycle_week(date, date) TO authenticated, service_role;

-- Ancienne signature conservée (ancre historique du 5 janvier 2026) ; ACL inchangée.
CREATE OR REPLACE FUNCTION public.webshop_cycle_week(p_date date)
RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT public.webshop_cycle_week(p_date, DATE '2026-01-05');
$$;

-- ---------- 5. Insertion de créneaux : capacité par défaut = réglage ---------
CREATE OR REPLACE FUNCTION public.webshop_insert_slots(p_org_id uuid, p_slots jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
  v_capacite integer := (majordhome.webshop_reglages(p_org_id) -> 'palette' ->> 'capacite_emplacements')::integer;
BEGIN
  WITH ins AS (
    INSERT INTO majordhome.webshop_delivery_slots (org_id, sector_id, delivery_date, capacity_slots, capacity_stops)
    SELECT p_org_id, (e->>'sector_id')::uuid, (e->>'delivery_date')::date,
           COALESCE((e->>'capacity_slots')::integer, v_capacite), (e->>'capacity_stops')::integer
    FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) e
    ON CONFLICT (sector_id, delivery_date) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END $function$;
REVOKE EXECUTE ON FUNCTION public.webshop_insert_slots(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webshop_insert_slots(uuid, jsonb) TO service_role;

-- ---------- 6. Génération : horizon (si NULL), capacité, ancre = réglages ---
CREATE OR REPLACE FUNCTION public.webshop_generate_slots(p_org_id uuid, p_horizon_weeks integer DEFAULT NULL::integer, p_from date DEFAULT NULL::date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'pg_temp'
AS $function$
DECLARE
  v_from     date := COALESCE(p_from, (now() AT TIME ZONE 'Europe/Paris')::date);
  v_reglages jsonb;
  v_horizon  integer;
  v_capacite integer;
  v_ancre    date;
  v_slots    jsonb;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'webshop_generate_slots : p_org_id requis'; END IF;
  v_reglages := majordhome.webshop_reglages(p_org_id);
  v_horizon  := COALESCE(p_horizon_weeks, (v_reglages -> 'palette' ->> 'horizon_semaines')::integer);
  v_capacite := (v_reglages -> 'palette' ->> 'capacite_emplacements')::integer;
  v_ancre    := (v_reglages -> 'palette' ->> 'ancre_cycle')::date;
  IF v_horizon IS NULL OR v_horizon < 1 THEN
    RAISE EXCEPTION 'webshop_generate_slots : p_horizon_weeks doit être >= 1 (reçu %)', v_horizon;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sector_id', s.id, 'delivery_date', j.d::text,
           'capacity_slots', v_capacite, 'capacity_stops', s.max_stops) ORDER BY s.code, j.d), '[]'::jsonb)
    INTO v_slots
  FROM majordhome.webshop_sectors s
  CROSS JOIN LATERAL (SELECT v_from + g AS d FROM generate_series(0, v_horizon * 7 - 1) g) j
  WHERE s.org_id = p_org_id
    AND s.is_active
    AND jsonb_typeof(s.recurrence) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(s.recurrence) m
      WHERE jsonb_typeof(m) = 'object'
        AND jsonb_typeof(m->'weekday') = 'number' AND jsonb_typeof(m->'week') = 'number'
        AND (m->>'weekday')::numeric = extract(isodow FROM j.d)
        AND (m->>'week')::numeric = public.webshop_cycle_week(j.d, v_ancre))
    AND NOT public.webshop_is_french_holiday(j.d);

  RETURN public.webshop_insert_slots(p_org_id, v_slots);
END $function$;
REVOKE EXECUTE ON FUNCTION public.webshop_generate_slots(uuid, integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webshop_generate_slots(uuid, integer, date) TO service_role;

-- ---------- 7. Fermeture J-n : chaque org selon SON délai --------------------
-- Interne : ferme les créneaux ouverts d'UNE org dont la date est <= p_today + son délai.
CREATE OR REPLACE FUNCTION majordhome.webshop_close_due_slots_org(p_org_id uuid, p_today date)
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
  UPDATE majordhome.webshop_delivery_slots s
     SET status = 'closed', closed_at = now(), close_reason = 'j_minus_2', updated_at = now()
   WHERE s.org_id = p_org_id AND s.status = 'open'
     AND s.delivery_date <= p_today + (majordhome.webshop_reglages(p_org_id) -> 'palette' ->> 'delai_fermeture_jours')::integer
  RETURNING s.id;
$function$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_close_due_slots_org(uuid, date) FROM PUBLIC, anon, authenticated;

-- Publique (usage manuel, appel ?fermer=1 du site) : toutes les orgs, chacune selon son délai,
-- sans condition d'heure. Le cron horaire, lui, passe par webshop_run_daily_tours_at.
CREATE OR REPLACE FUNCTION public.webshop_close_due_slots(p_today date DEFAULT CURRENT_DATE)
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'pg_temp'
AS $function$
  SELECT majordhome.webshop_close_due_slots_org(o.org_id, p_today)
    FROM (SELECT DISTINCT org_id FROM majordhome.webshop_delivery_slots WHERE status = 'open') o;
$function$;
REVOKE EXECUTE ON FUNCTION public.webshop_close_due_slots(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webshop_close_due_slots(date) TO service_role;

-- ---------- 8. Paiement confirmé : plancher J+n de l'org ---------------------
CREATE OR REPLACE FUNCTION public.webshop_apply_paid_order(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'pg_temp'
AS $function$
DECLARE
  v_order    record;
  v_item     record;
  v_slot     record;
  v_target   uuid;
  v_new_stop boolean := false;
  v_changed  boolean := false;
  v_from     date;
  v_delai    integer;
BEGIN
  SELECT id, org_id, paid_at, pallet_delivery_mode, pallet_slots, requested_slot_id, sector_id, normalized_address
    INTO v_order
    FROM majordhome.webshop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_order.paid_at IS NOT NULL THEN RETURN 'already_paid'; END IF;

  v_delai := (majordhome.webshop_reglages(v_order.org_id) -> 'palette' ->> 'delai_fermeture_jours')::integer;

  UPDATE majordhome.webshop_orders
     SET status = 'nouvelle', paid_at = now()
   WHERE id = p_order_id;

  FOR v_item IN
    SELECT product_id, qty FROM majordhome.webshop_order_items
     WHERE order_id = p_order_id AND product_id IS NOT NULL
     ORDER BY product_id
  LOOP
    UPDATE majordhome.webshop_products
       SET stock_qty = GREATEST(0, stock_qty - v_item.qty)
     WHERE id = v_item.product_id;
  END LOOP;

  IF v_order.pallet_delivery_mode = 'delivery' AND COALESCE(v_order.pallet_slots, 0) > 0 THEN
    v_target := NULL;

    IF v_order.requested_slot_id IS NOT NULL THEN
      SELECT * INTO v_slot FROM majordhome.webshop_delivery_slots
       WHERE id = v_order.requested_slot_id FOR UPDATE;
      IF FOUND AND v_slot.status = 'open'
         AND v_slot.delivery_date >= CURRENT_DATE + v_delai
         AND v_slot.used_slots + v_order.pallet_slots <= v_slot.capacity_slots THEN
        v_new_stop := NOT EXISTS (
          SELECT 1 FROM majordhome.webshop_orders o
           WHERE o.delivery_slot_id = v_slot.id AND o.id <> p_order_id
             AND o.paid_at IS NOT NULL AND o.status <> 'annulee'
             AND o.normalized_address IS NOT DISTINCT FROM v_order.normalized_address);
        IF (NOT v_new_stop) OR v_slot.used_stops + 1 <= v_slot.capacity_stops THEN
          v_target := v_slot.id;
        END IF;
      END IF;
    END IF;

    IF v_target IS NULL AND v_order.sector_id IS NOT NULL THEN
      v_changed := v_order.requested_slot_id IS NOT NULL;
      SELECT delivery_date INTO v_from FROM majordhome.webshop_delivery_slots WHERE id = v_order.requested_slot_id;
      v_from := COALESCE(v_from, CURRENT_DATE + v_delai);
      FOR v_slot IN
        SELECT * FROM majordhome.webshop_delivery_slots
         WHERE sector_id = v_order.sector_id AND status = 'open'
           AND delivery_date >= v_from
           AND delivery_date >= CURRENT_DATE + v_delai
           AND id IS DISTINCT FROM v_order.requested_slot_id
         ORDER BY delivery_date
         FOR UPDATE
      LOOP
        IF v_slot.used_slots + v_order.pallet_slots > v_slot.capacity_slots THEN CONTINUE; END IF;
        v_new_stop := NOT EXISTS (
          SELECT 1 FROM majordhome.webshop_orders o
           WHERE o.delivery_slot_id = v_slot.id AND o.id <> p_order_id
             AND o.paid_at IS NOT NULL AND o.status <> 'annulee'
             AND o.normalized_address IS NOT DISTINCT FROM v_order.normalized_address);
        IF v_new_stop AND v_slot.used_stops + 1 > v_slot.capacity_stops THEN CONTINUE; END IF;
        v_target := v_slot.id;
        EXIT;
      END LOOP;
    END IF;

    IF v_target IS NULL THEN
      UPDATE majordhome.webshop_orders
         SET delivery_slot_id = NULL, needs_manual_planning = true,
             delivery_slot_changed = (v_order.requested_slot_id IS NOT NULL)
       WHERE id = p_order_id;
    ELSE
      UPDATE majordhome.webshop_delivery_slots
         SET used_slots = used_slots + v_order.pallet_slots,
             used_stops = used_stops + CASE WHEN v_new_stop THEN 1 ELSE 0 END,
             updated_at = now()
       WHERE id = v_target;
      UPDATE majordhome.webshop_delivery_slots
         SET status = 'closed', closed_at = now(), updated_at = now(),
             close_reason = CASE WHEN used_slots >= capacity_slots THEN 'capacity' ELSE 'stops' END
       WHERE id = v_target AND status = 'open'
         AND (used_slots >= capacity_slots OR used_stops >= capacity_stops);
      UPDATE majordhome.webshop_orders
         SET delivery_slot_id = v_target, delivery_slot_changed = v_changed, needs_manual_planning = false
       WHERE id = p_order_id;
    END IF;
  END IF;

  RETURN 'applied';
END $function$;
REVOKE EXECUTE ON FUNCTION public.webshop_apply_paid_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webshop_apply_paid_order(uuid) TO service_role;

-- ---------- 9. Recalcul du remplissage : réouverture tant que J+n de l'org ---
CREATE OR REPLACE FUNCTION majordhome.webshop_slot_recount(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_delai integer;
BEGIN
  SELECT (majordhome.webshop_reglages(s.org_id) -> 'palette' ->> 'delai_fermeture_jours')::integer INTO v_delai
    FROM majordhome.webshop_delivery_slots s WHERE s.id = p_slot_id;

  UPDATE majordhome.webshop_delivery_slots s
     SET used_slots = x.sl, used_stops = x.st, updated_at = now()
    FROM (
      SELECT COALESCE(sum(o.pallet_slots), 0)::int AS sl,
             count(DISTINCT COALESCE(o.normalized_address, lower(o.address), o.id::text))::int AS st
        FROM majordhome.webshop_orders o
       WHERE o.delivery_slot_id = p_slot_id AND o.paid_at IS NOT NULL AND o.status <> 'annulee'
    ) x
   WHERE s.id = p_slot_id;

  UPDATE majordhome.webshop_delivery_slots
     SET status = 'closed', closed_at = now(), updated_at = now(),
         close_reason = CASE WHEN used_slots >= capacity_slots THEN 'capacity' ELSE 'stops' END
   WHERE id = p_slot_id AND status = 'open'
     AND (used_slots >= capacity_slots OR used_stops >= capacity_stops);

  UPDATE majordhome.webshop_delivery_slots
     SET status = 'open', closed_at = NULL, close_reason = NULL, updated_at = now()
   WHERE id = p_slot_id AND status = 'closed' AND close_reason IN ('capacity', 'stops')
     AND route_sheet_sent_at IS NULL
     AND delivery_date >= v_today + v_delai
     AND used_slots < capacity_slots AND used_stops < capacity_stops;
END $function$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_slot_recount(uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 10. Fermer / rouvrir : réouverture tant que J+n de l'org ---------
CREATE OR REPLACE FUNCTION public.webshop_slot_set_status(p_slot_id uuid, p_status text, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
DECLARE
  v_slot majordhome.webshop_delivery_slots;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_delai integer;
BEGIN
  v_slot := majordhome.webshop_slot_guard(p_slot_id);
  v_delai := (majordhome.webshop_reglages(v_slot.org_id) -> 'palette' ->> 'delai_fermeture_jours')::integer;

  IF p_status = 'closed' THEN
    IF v_slot.status <> 'open' THEN RAISE EXCEPTION 'slot_not_open' USING ERRCODE = '22023', DETAIL = v_slot.status; END IF;
    UPDATE majordhome.webshop_delivery_slots
       SET status = 'closed', closed_at = now(), close_reason = 'manual',
           status_note = NULLIF(btrim(p_note), ''), updated_at = now()
     WHERE id = p_slot_id;
  ELSIF p_status = 'open' THEN
    IF v_slot.status NOT IN ('closed', 'cancelled') THEN RAISE EXCEPTION 'slot_not_reopenable' USING ERRCODE = '22023', DETAIL = v_slot.status; END IF;
    IF v_slot.delivery_date < v_today + v_delai THEN RAISE EXCEPTION 'slot_too_late' USING ERRCODE = '22023', DETAIL = v_slot.delivery_date::text; END IF;
    IF v_slot.used_slots >= v_slot.capacity_slots OR v_slot.used_stops >= v_slot.capacity_stops THEN
      RAISE EXCEPTION 'slot_full' USING ERRCODE = '22023';
    END IF;
    UPDATE majordhome.webshop_delivery_slots
       SET status = 'open', closed_at = NULL, close_reason = NULL, status_note = NULL,
           route_sheet_sent_at = NULL, updated_at = now()
     WHERE id = p_slot_id;
  ELSE
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023', DETAIL = p_status;
  END IF;

  RETURN jsonb_build_object('slot_id', p_slot_id, 'status', p_status);
END $function$;
REVOKE EXECUTE ON FUNCTION public.webshop_slot_set_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_slot_set_status(uuid, text, text) TO authenticated;

-- ---------- 11. Envoi manuel : URL = réglage site_url, sinon site_url_missing ---
CREATE OR REPLACE FUNCTION public.webshop_slot_send_now(p_slot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
DECLARE
  v_slot majordhome.webshop_delivery_slots;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_url text;
  v_secret text;
  v_request bigint;
  v_others int;
BEGIN
  v_slot := majordhome.webshop_slot_guard(p_slot_id);
  IF v_slot.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'slot_not_sendable' USING ERRCODE = '22023', DETAIL = v_slot.status;
  END IF;

  v_url := rtrim(majordhome.webshop_reglages(v_slot.org_id) ->> 'site_url', '/');
  IF COALESCE(v_url, '') = '' THEN RAISE EXCEPTION 'site_url_missing' USING ERRCODE = '55000'; END IF;

  IF NOT EXISTS (SELECT 1 FROM majordhome.webshop_orders
                  WHERE delivery_slot_id = p_slot_id AND paid_at IS NOT NULL AND status <> 'annulee') THEN
    RAISE EXCEPTION 'slot_empty' USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'webshop_cron_secret' LIMIT 1;
  IF v_secret IS NULL OR v_secret = '' THEN RAISE EXCEPTION 'cron_secret_missing' USING ERRCODE = '55000'; END IF;

  SELECT count(*) INTO v_others FROM majordhome.webshop_delivery_slots
   WHERE org_id = v_slot.org_id AND id <> p_slot_id AND status = 'closed' AND route_sheet_sent_at IS NULL;

  UPDATE majordhome.webshop_delivery_slots
     SET status = 'closed',
         closed_at = COALESCE(closed_at, now()),
         close_reason = COALESCE(close_reason, 'manual'),
         route_sheet_sent_at = NULL, updated_at = now()
   WHERE id = p_slot_id;

  SELECT net.http_post(
    url := v_url || '/api/boutique/cron/tournees',
    body := jsonb_build_object('source', 'majordhome', 'today', v_today::text, 'slot_id', p_slot_id, 'org_id', v_slot.org_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 90000)
  INTO v_request;

  UPDATE majordhome.webshop_delivery_slots
     SET route_sheet_request_id = v_request, route_sheet_requested_at = now()
   WHERE id = p_slot_id;

  RETURN jsonb_build_object('slot_id', p_slot_id, 'request_id', v_request, 'other_pending_slots', v_others);
END $function$;
REVOKE EXECUTE ON FUNCTION public.webshop_slot_send_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_slot_send_now(uuid) TO authenticated;

-- ---------- 12. Clôture horaire : chaque org à SON heure d'envoi ------------
-- Cœur testable : l'instant est un paramètre (le cron passe now()). Pour chaque org qui a un
-- créneau ouvert ou un secteur actif, et dont l'heure de Paris = heure_envoi :
--   1) fermeture J-n de CETTE org (même si envoi_auto est faux : on ferme toujours à l'heure
--      dite, comme le cron quotidien historique de 18 h / 19 h) ;
--   2) si envoi_auto et secteur actif : POST <site_url>/api/boutique/cron/tournees, org_id dans le body.
-- Sans secret Vault ou sans site_url : WARNING + mention dans le texte retourné, jamais
-- d'exception (elle annulerait la fermeture).
CREATE OR REPLACE FUNCTION majordhome.webshop_run_daily_tours_at(p_at timestamptz, p_today date DEFAULT NULL::date)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
DECLARE
  v_today    date := COALESCE(p_today, (p_at AT TIME ZONE 'Europe/Paris')::date);
  v_heure    integer := extract(hour FROM p_at AT TIME ZONE 'Europe/Paris')::integer;
  v_closed   integer := 0;
  v_n        integer;
  v_secret   text;
  v_request  bigint;
  v_org      uuid;
  v_reglages jsonb;
  v_url      text;
  v_lignes   text[] := '{}';
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'webshop_cron_secret' LIMIT 1;

  FOR v_org IN
    SELECT org_id FROM majordhome.webshop_sectors WHERE is_active
    UNION
    SELECT org_id FROM majordhome.webshop_delivery_slots WHERE status = 'open'
    ORDER BY 1
  LOOP
    v_reglages := majordhome.webshop_reglages(v_org);
    IF (v_heure = (v_reglages -> 'palette' ->> 'heure_envoi')::integer) IS NOT TRUE THEN CONTINUE; END IF;

    SELECT count(*) INTO v_n FROM majordhome.webshop_close_due_slots_org(v_org, v_today);
    v_closed := v_closed + v_n;

    IF ((v_reglages -> 'palette' ->> 'envoi_auto')::boolean) IS NOT TRUE THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM majordhome.webshop_sectors WHERE org_id = v_org AND is_active) THEN CONTINUE; END IF;

    v_url := rtrim(v_reglages ->> 'site_url', '/');
    IF COALESCE(v_url, '') = '' THEN
      RAISE WARNING '[webshop_run_daily_tours] org % : site_url absent (Settings → Webshop), feuilles de route non déclenchées', v_org;
      v_lignes := v_lignes || format('org=%s http=non (site_url absent)', v_org);
      CONTINUE;
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE WARNING '[webshop_run_daily_tours] org % : secret Vault webshop_cron_secret absent, feuilles de route non déclenchées', v_org;
      v_lignes := v_lignes || format('org=%s http=non (secret Vault webshop_cron_secret absent)', v_org);
      CONTINUE;
    END IF;

    SELECT net.http_post(
      url := v_url || '/api/boutique/cron/tournees',
      body := jsonb_build_object('source', 'pg_cron', 'today', v_today::text, 'org_id', v_org),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 90000)
    INTO v_request;
    v_lignes := v_lignes || format('org=%s http_request_id=%s', v_org, v_request);
  END LOOP;

  RETURN format('fermes=%s', v_closed)
      || CASE WHEN cardinality(v_lignes) = 0 THEN ', http=non (aucun envoi dû à cette heure)'
              ELSE ', ' || array_to_string(v_lignes, ', ') END;
END $function$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_run_daily_tours_at(timestamptz, date) FROM PUBLIC, anon, authenticated;

-- Signature publique inchangée : appelée chaque heure par le cron.
CREATE OR REPLACE FUNCTION public.webshop_run_daily_tours(p_today date DEFAULT NULL::date)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'pg_temp'
AS $function$
BEGIN
  RETURN majordhome.webshop_run_daily_tours_at(now(), p_today);
END $function$;
REVOKE EXECUTE ON FUNCTION public.webshop_run_daily_tours(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webshop_run_daily_tours(date) TO service_role;

-- ---------- 13. Cron horaire (même nom = mise à jour du job existant) -------
SELECT cron.schedule('webshop-tours-daily', '0 * * * *', $$SELECT public.webshop_run_daily_tours()$$);

-- ---------- 14. Backfill Mayer : site_url (merge niveau 1 de webshop) -------
UPDATE core.organizations
   SET settings = jsonb_set(
         COALESCE(settings, '{}'::jsonb), '{webshop}',
         CASE WHEN jsonb_typeof(settings -> 'webshop') = 'object' THEN settings -> 'webshop' ELSE '{}'::jsonb END
           || jsonb_build_object('site_url', 'https://www.mayer-energie.fr'))
 WHERE id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
   AND COALESCE(btrim(settings -> 'webshop' ->> 'site_url'), '') = '';

-- ---------- Vérification ------------------------------------------------------
-- SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'webshop-%';            -- webshop-tours-daily = 0 * * * *
-- SELECT majordhome.webshop_reglages('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');       -- site_url renseignée, défauts
-- SELECT has_function_privilege('anon', 'majordhome.webshop_reglages(uuid)', 'EXECUTE'); -- false
