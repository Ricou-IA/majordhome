-- 20261017_2_webshop_reglages_listes.sql
-- Webshop — paramétrage, étape 1, Task 3 : RPC d'écriture (org_admin) des listes de livraison.
-- Spec : docs/superpowers/specs/2026-10-17-webshop-parametrage-livraison-process-design.md
-- Dépend de 20261017_1_webshop_reglages.sql (majordhome.webshop_reglages, webshop_generate_slots
-- avec horizon NULL = réglage). Consommées par l'écran Settings → Webshop (Task 4).
--
-- Toutes les RPC publiques : SECURITY DEFINER, search_path fixé, `auth.uid() IS NULL` refusé en
-- première instruction, garde positive « org_admin de l'org de la CIBLE » (une cible désignée par
-- id porte son org ; l'org passée par l'appelant est alors ignorée). Une cible introuvable ne
-- révèle rien : même refus `org_admin_required`. REVOKE PUBLIC, anon ; GRANT authenticated.
--
-- Codes d'erreur (MESSAGE_TEXT, DETAIL) :
--   org_admin_required (42501)              refus de droit, anonyme ou cible inconnue
--   invalid_value (22023, DETAIL = champ)   donnée absente / hors bornes / mal typée
--   invalid_recurrence (22023)              récurrence ≠ [{week 1-4, weekday 1-5}]
--   depot_unknown (22023, DETAIL = code)    dépôt absent de webshop_reglages(org)->'depots'
--   immutable_field (22023, DETAIL = champ) code de secteur / slug de point modifié
--   code_taken (22023, DETAIL = code)       code de secteur déjà utilisé dans l'org
--   slug_taken (22023, DETAIL = slug)       slug de point de retrait déjà utilisé dans l'org
--   postcode_taken (22023, DETAIL = code du secteur occupant)
--
-- Pas de suppression de secteur ni de point de retrait (désactivation `is_active`) : des
-- créneaux et des commandes y font référence. Un tarif colis se supprime.

-- ============================================================================
-- 1. Outils internes (jamais exposés)
-- ============================================================================

-- Garde : l'utilisateur courant est org_admin de p_org_id. Positive (IS NOT TRUE), p_org_id NULL
-- (cible inconnue) = refus.
CREATE OR REPLACE FUNCTION majordhome.webshop_require_org_admin(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = majordhome, public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  IF (p_org_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM core.organization_members om
         WHERE om.org_id = p_org_id AND om.user_id = auth.uid() AND om.role = 'org_admin')) IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_require_org_admin(uuid) FROM PUBLIC, anon, authenticated;

-- Entier JSON obligatoire dans [p_min, p_max], sinon invalid_value (DETAIL = champ).
CREATE OR REPLACE FUNCTION majordhome.webshop_json_int(p_val jsonb, p_field text, p_min integer, p_max integer)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE n numeric;
BEGIN
  IF p_val IS NULL OR jsonb_typeof(p_val) <> 'number' THEN
    RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = p_field;
  END IF;
  n := (p_val #>> '{}')::numeric;
  IF n <> trunc(n) OR n < p_min OR n > p_max THEN
    RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = p_field;
  END IF;
  RETURN n::integer;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_json_int(jsonb, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- Nombre JSON obligatoire >= p_min, sinon invalid_value.
CREATE OR REPLACE FUNCTION majordhome.webshop_json_num(p_val jsonb, p_field text, p_min numeric)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE n numeric;
BEGIN
  IF p_val IS NULL OR jsonb_typeof(p_val) <> 'number' THEN
    RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = p_field;
  END IF;
  n := (p_val #>> '{}')::numeric;
  IF n < p_min THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = p_field; END IF;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_json_num(jsonb, text, numeric) FROM PUBLIC, anon, authenticated;

-- Texte JSON non vide (trim), sinon invalid_value.
CREATE OR REPLACE FUNCTION majordhome.webshop_json_text(p_val jsonb, p_field text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
BEGIN
  IF p_val IS NULL OR jsonb_typeof(p_val) <> 'string' OR btrim(p_val #>> '{}') = '' THEN
    RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = p_field;
  END IF;
  RETURN btrim(p_val #>> '{}');
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_json_text(jsonb, text) FROM PUBLIC, anon, authenticated;

-- Booléen JSON, sinon invalid_value.
CREATE OR REPLACE FUNCTION majordhome.webshop_json_bool(p_val jsonb, p_field text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
BEGIN
  IF p_val IS NULL OR jsonb_typeof(p_val) <> 'boolean' THEN
    RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = p_field;
  END IF;
  RETURN (p_val #>> '{}')::boolean;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_json_bool(jsonb, text) FROM PUBLIC, anon, authenticated;

-- Récurrence : tableau d'objets {week 1-4, weekday 1-5} (entiers). Renvoie la forme normalisée
-- (dédoublonnée, triée semaine puis jour). Tableau vide accepté (secteur sans passage).
CREATE OR REPLACE FUNCTION majordhome.webshop_check_recurrence(p_rec jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE m jsonb; v_out jsonb;
BEGIN
  IF p_rec IS NULL OR jsonb_typeof(p_rec) <> 'array' THEN
    RAISE EXCEPTION 'invalid_recurrence' USING ERRCODE = '22023';
  END IF;
  FOR m IN SELECT e FROM jsonb_array_elements(p_rec) e LOOP
    IF jsonb_typeof(m) <> 'object'
       OR jsonb_typeof(m -> 'week') IS DISTINCT FROM 'number' OR jsonb_typeof(m -> 'weekday') IS DISTINCT FROM 'number'
       OR ((m ->> 'week')::numeric IN (1, 2, 3, 4)) IS NOT TRUE
       OR ((m ->> 'weekday')::numeric IN (1, 2, 3, 4, 5)) IS NOT TRUE THEN
      RAISE EXCEPTION 'invalid_recurrence' USING ERRCODE = '22023', DETAIL = m::text;
    END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('week', w, 'weekday', d) ORDER BY w, d), '[]'::jsonb) INTO v_out
    FROM (SELECT DISTINCT (e ->> 'week')::int AS w, (e ->> 'weekday')::int AS d FROM jsonb_array_elements(p_rec) e) x;
  RETURN v_out;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_check_recurrence(jsonb) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. Secteurs : création / mise à jour partielle (pas de suppression)
-- p_sector : { id?, code, label, depot, max_stops, max_minutes, max_km, slot_price_ttc_cents,
--              slots_per_cycle, recurrence, is_active }
-- Création : code, label, max_stops obligatoires ; depot absent → 1er dépôt du réglage ;
--   slot_price_ttc_cents absent → palette.prix_emplacement_defaut_cents du réglage ;
--   autres champs absents → défauts de colonne.
-- Mise à jour : seules les clés présentes changent ; le code est immuable.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_sector_upsert(p_org_id uuid, p_sector jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  s jsonb := COALESCE(p_sector, '{}'::jsonb);
  v_cur majordhome.webshop_sectors;
  v_org uuid;
  v_reglages jsonb;
  v_depot text;
  v_rec jsonb;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(s) <> 'object' THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'sector'; END IF;

  IF NULLIF(s ->> 'id', '') IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_cur FROM majordhome.webshop_sectors WHERE id = (s ->> 'id')::uuid FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
    END;
    v_org := v_cur.org_id;               -- l'org de la ligne fait foi ; NULL si introuvable → refus
  ELSE
    v_org := p_org_id;
  END IF;
  PERFORM majordhome.webshop_require_org_admin(v_org);

  v_reglages := majordhome.webshop_reglages(v_org);

  IF s ? 'recurrence' THEN v_rec := majordhome.webshop_check_recurrence(s -> 'recurrence'); END IF;

  IF s ? 'depot' THEN
    v_depot := majordhome.webshop_json_text(s -> 'depot', 'depot');
  ELSIF v_cur.id IS NULL THEN
    v_depot := v_reglages -> 'depots' -> 0 ->> 'code';
  END IF;
  IF v_depot IS NOT NULL AND (EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_reglages -> 'depots') d WHERE d ->> 'code' = v_depot)) IS NOT TRUE THEN
    RAISE EXCEPTION 'depot_unknown' USING ERRCODE = '22023', DETAIL = v_depot;
  END IF;
  IF v_cur.id IS NULL AND v_depot IS NULL THEN
    RAISE EXCEPTION 'depot_unknown' USING ERRCODE = '22023', DETAIL = '';
  END IF;

  IF v_cur.id IS NULL THEN
    BEGIN
      INSERT INTO majordhome.webshop_sectors
        (org_id, code, label, depot, max_stops, max_minutes, max_km, slot_price_ttc_cents, slots_per_cycle, recurrence, is_active)
      VALUES (
        v_org,
        majordhome.webshop_json_text(s -> 'code', 'code'),
        majordhome.webshop_json_text(s -> 'label', 'label'),
        v_depot,
        majordhome.webshop_json_int(s -> 'max_stops', 'max_stops', 1, 1000),
        CASE WHEN s ? 'max_minutes' THEN majordhome.webshop_json_int(s -> 'max_minutes', 'max_minutes', 1, 1440) ELSE 540 END,
        CASE WHEN s ? 'max_km' THEN majordhome.webshop_json_int(s -> 'max_km', 'max_km', 1, 5000) ELSE 350 END,
        CASE WHEN s ? 'slot_price_ttc_cents'
             THEN majordhome.webshop_json_int(s -> 'slot_price_ttc_cents', 'slot_price_ttc_cents', 0, 10000000)
             ELSE (v_reglages -> 'palette' ->> 'prix_emplacement_defaut_cents')::integer END,
        CASE WHEN s ? 'slots_per_cycle' THEN majordhome.webshop_json_int(s -> 'slots_per_cycle', 'slots_per_cycle', 1, 40) ELSE 2 END,
        COALESCE(v_rec, '[]'::jsonb),
        CASE WHEN s ? 'is_active' THEN majordhome.webshop_json_bool(s -> 'is_active', 'is_active') ELSE true END)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'code_taken' USING ERRCODE = '22023', DETAIL = btrim(s ->> 'code');
    END;
    RETURN v_id;
  END IF;

  IF s ? 'code' AND (s ->> 'code') IS DISTINCT FROM v_cur.code THEN
    RAISE EXCEPTION 'immutable_field' USING ERRCODE = '22023', DETAIL = 'code';
  END IF;

  UPDATE majordhome.webshop_sectors SET
    label                = CASE WHEN s ? 'label' THEN majordhome.webshop_json_text(s -> 'label', 'label') ELSE label END,
    depot                = COALESCE(v_depot, depot),
    max_stops            = CASE WHEN s ? 'max_stops' THEN majordhome.webshop_json_int(s -> 'max_stops', 'max_stops', 1, 1000) ELSE max_stops END,
    max_minutes          = CASE WHEN s ? 'max_minutes' THEN majordhome.webshop_json_int(s -> 'max_minutes', 'max_minutes', 1, 1440) ELSE max_minutes END,
    max_km               = CASE WHEN s ? 'max_km' THEN majordhome.webshop_json_int(s -> 'max_km', 'max_km', 1, 5000) ELSE max_km END,
    slot_price_ttc_cents = CASE WHEN s ? 'slot_price_ttc_cents'
                                THEN majordhome.webshop_json_int(s -> 'slot_price_ttc_cents', 'slot_price_ttc_cents', 0, 10000000)
                                ELSE slot_price_ttc_cents END,
    slots_per_cycle      = CASE WHEN s ? 'slots_per_cycle' THEN majordhome.webshop_json_int(s -> 'slots_per_cycle', 'slots_per_cycle', 1, 40) ELSE slots_per_cycle END,
    recurrence           = COALESCE(v_rec, recurrence),
    is_active            = CASE WHEN s ? 'is_active' THEN majordhome.webshop_json_bool(s -> 'is_active', 'is_active') ELSE is_active END,
    updated_at           = now()
  WHERE id = v_cur.id AND org_id = v_org;
  RETURN v_cur.id;
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_sector_upsert(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_sector_upsert(uuid, jsonb) TO authenticated, service_role;

-- ============================================================================
-- 3. Codes postaux d'un secteur : remplacement atomique
-- p_rows : [{ postal_code, insee_code?, commune? }]. Unicité dans l'org : par insee_code s'il est
-- renseigné, sinon par postal_code (un CP sans INSEE réserve le CP entier, dans les deux sens).
-- Un code déjà rattaché à un AUTRE secteur → postcode_taken (DETAIL = code de ce secteur), rien
-- n'est écrit. Doublons de l'entrée (même CP + INSEE) fusionnés. Renvoie le nombre de lignes.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_sector_set_postcodes(p_sector_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org uuid;
  e jsonb;
  v_norm jsonb := '[]'::jsonb;
  v_pc text; v_insee text; v_commune text;
  v_taken text;
  v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT org_id INTO v_org FROM majordhome.webshop_sectors WHERE id = p_sector_id FOR UPDATE;
  PERFORM majordhome.webshop_require_org_admin(v_org);

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'rows';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
    IF jsonb_typeof(e) <> 'object' THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'rows'; END IF;
    v_pc := btrim(COALESCE(e ->> 'postal_code', ''));
    v_insee := upper(btrim(COALESCE(e ->> 'insee_code', '')));
    v_commune := btrim(COALESCE(e ->> 'commune', ''));
    IF v_pc !~ '^[0-9]{5}$' THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'postal_code'; END IF;
    IF v_insee <> '' AND v_insee !~ '^(2A|2B|[0-9]{2})[0-9]{3}$' THEN
      RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'insee_code';
    END IF;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('postal_code', v_pc, 'insee_code', v_insee, 'commune', v_commune));
  END LOOP;

  -- Sérialise les remplacements concurrents d'une même org (deux secteurs réclamant un même code).
  PERFORM pg_advisory_xact_lock(hashtext('webshop_sector_postcodes'), hashtext(v_org::text));

  SELECT s.code INTO v_taken
    FROM jsonb_to_recordset(v_norm) AS r(postal_code text, insee_code text, commune text)
    JOIN majordhome.webshop_sector_postcodes p
      ON p.org_id = v_org AND p.sector_id <> p_sector_id
     AND (   (r.insee_code <> '' AND p.insee_code = r.insee_code)
          OR (r.insee_code = '' AND p.postal_code = r.postal_code)
          OR (p.insee_code = '' AND p.postal_code = r.postal_code))
    JOIN majordhome.webshop_sectors s ON s.id = p.sector_id
   ORDER BY s.code
   LIMIT 1;
  IF v_taken IS NOT NULL THEN
    RAISE EXCEPTION 'postcode_taken' USING ERRCODE = '22023', DETAIL = v_taken;
  END IF;

  DELETE FROM majordhome.webshop_sector_postcodes WHERE sector_id = p_sector_id AND org_id = v_org;
  INSERT INTO majordhome.webshop_sector_postcodes (org_id, postal_code, insee_code, commune, sector_id)
  SELECT DISTINCT ON (r.postal_code, r.insee_code) v_org, r.postal_code, r.insee_code, r.commune, p_sector_id
    FROM jsonb_to_recordset(v_norm) AS r(postal_code text, insee_code text, commune text)
   ORDER BY r.postal_code, r.insee_code, r.commune DESC;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_sector_set_postcodes(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_sector_set_postcodes(uuid, jsonb) TO authenticated, service_role;

-- ============================================================================
-- 4. Régénération des créneaux à venir sans commande
-- Supprime les créneaux 'open', vides (used_slots = 0), sans commande rattachée (delivery_slot_id
-- ou requested_slot_id), datés APRÈS aujourd'hui (Paris) + délai de fermeture de l'org ; puis
-- régénère à partir du même lendemain de fenêtre (horizon = réglage). Les créneaux fermés,
-- expédiés, annulés, occupés ou dans la fenêtre de fermeture ne bougent jamais.
-- Renvoie { supprimes, crees }.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_regenerate_future_slots(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_delai integer;
  v_supprimes integer;
  v_crees integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM majordhome.webshop_require_org_admin(p_org_id);

  v_delai := (majordhome.webshop_reglages(p_org_id) -> 'palette' ->> 'delai_fermeture_jours')::integer;

  WITH d AS (
    DELETE FROM majordhome.webshop_delivery_slots s
     WHERE s.org_id = p_org_id
       AND s.status = 'open'
       AND s.used_slots = 0
       AND s.delivery_date > v_today + v_delai
       AND NOT EXISTS (SELECT 1 FROM majordhome.webshop_orders o
                        WHERE o.delivery_slot_id = s.id OR o.requested_slot_id = s.id)
    RETURNING 1)
  SELECT count(*) INTO v_supprimes FROM d;

  v_crees := public.webshop_generate_slots(p_org_id, NULL, v_today + v_delai + 1);

  RETURN jsonb_build_object('supprimes', v_supprimes, 'crees', v_crees);
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_regenerate_future_slots(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_regenerate_future_slots(uuid) TO authenticated, service_role;

-- ============================================================================
-- 5. Tarifs colis (grille au poids)
-- p_rate : { id?, label, min_weight_kg, max_weight_kg (null = sans plafond), price_ttc (euros), is_active }
-- Création : label, min_weight_kg, price_ttc obligatoires. Mise à jour partielle.
-- Cohérence : max_weight_kg NULL ou > min_weight_kg.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_shipping_rate_upsert(p_org_id uuid, p_rate jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  r jsonb := COALESCE(p_rate, '{}'::jsonb);
  v_cur majordhome.webshop_shipping_rates;
  v_org uuid;
  v_label text; v_min numeric; v_max numeric; v_price numeric; v_active boolean;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(r) <> 'object' THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'rate'; END IF;

  IF NULLIF(r ->> 'id', '') IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_cur FROM majordhome.webshop_shipping_rates WHERE id = (r ->> 'id')::uuid FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
    END;
    v_org := v_cur.org_id;
  ELSE
    v_org := p_org_id;
  END IF;
  PERFORM majordhome.webshop_require_org_admin(v_org);

  v_label  := CASE WHEN r ? 'label' OR v_cur.id IS NULL THEN majordhome.webshop_json_text(r -> 'label', 'label') ELSE v_cur.label END;
  v_min    := CASE WHEN r ? 'min_weight_kg' OR v_cur.id IS NULL THEN majordhome.webshop_json_num(r -> 'min_weight_kg', 'min_weight_kg', 0) ELSE v_cur.min_weight_kg END;
  v_max    := CASE WHEN r ? 'max_weight_kg'
                   THEN CASE WHEN jsonb_typeof(r -> 'max_weight_kg') = 'null' THEN NULL
                             ELSE majordhome.webshop_json_num(r -> 'max_weight_kg', 'max_weight_kg', 0) END
                   ELSE v_cur.max_weight_kg END;
  v_price  := CASE WHEN r ? 'price_ttc' OR v_cur.id IS NULL THEN majordhome.webshop_json_num(r -> 'price_ttc', 'price_ttc', 0) ELSE v_cur.price_ttc END;
  v_active := CASE WHEN r ? 'is_active' THEN majordhome.webshop_json_bool(r -> 'is_active', 'is_active') ELSE COALESCE(v_cur.is_active, true) END;

  IF v_max IS NOT NULL AND v_max <= v_min THEN
    RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'max_weight_kg';
  END IF;
  IF v_min > 99999 OR v_max > 99999 THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'weight'; END IF;
  IF v_price > 99999999 THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'price_ttc'; END IF;

  IF v_cur.id IS NULL THEN
    INSERT INTO majordhome.webshop_shipping_rates (org_id, label, min_weight_kg, max_weight_kg, price_ttc, is_active)
    VALUES (v_org, v_label, v_min, v_max, v_price, v_active)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  UPDATE majordhome.webshop_shipping_rates
     SET label = v_label, min_weight_kg = v_min, max_weight_kg = v_max, price_ttc = v_price, is_active = v_active
   WHERE id = v_cur.id AND org_id = v_org;
  RETURN v_cur.id;
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_shipping_rate_upsert(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_shipping_rate_upsert(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.webshop_shipping_rate_delete(p_rate_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT org_id INTO v_org FROM majordhome.webshop_shipping_rates WHERE id = p_rate_id FOR UPDATE;
  PERFORM majordhome.webshop_require_org_admin(v_org);
  DELETE FROM majordhome.webshop_shipping_rates WHERE id = p_rate_id AND org_id = v_org;
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_shipping_rate_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_shipping_rate_delete(uuid) TO authenticated, service_role;

-- ============================================================================
-- 6. Points de retrait (pas de suppression : désactivation par is_active)
-- p_point : { id?, slug, name, address, opening_hours (null/'' = aucun), accepts (pallet|parcel|both), is_active }
-- Création : slug ([a-z0-9-]), name, address obligatoires. Le slug est immuable ensuite.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_pickup_point_upsert(p_org_id uuid, p_point jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  p jsonb := COALESCE(p_point, '{}'::jsonb);
  v_cur majordhome.webshop_pickup_points;
  v_org uuid;
  v_slug text; v_accepts text; v_hours text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'point'; END IF;

  IF NULLIF(p ->> 'id', '') IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_cur FROM majordhome.webshop_pickup_points WHERE id = (p ->> 'id')::uuid FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
    END;
    v_org := v_cur.org_id;
  ELSE
    v_org := p_org_id;
  END IF;
  PERFORM majordhome.webshop_require_org_admin(v_org);

  IF p ? 'accepts' THEN
    v_accepts := p ->> 'accepts';
    IF (v_accepts IN ('pallet', 'parcel', 'both')) IS NOT TRUE THEN
      RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'accepts';
    END IF;
  END IF;
  IF p ? 'opening_hours' THEN
    IF jsonb_typeof(p -> 'opening_hours') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'opening_hours';
    END IF;
    v_hours := NULLIF(btrim(p ->> 'opening_hours'), '');
  END IF;

  IF v_cur.id IS NULL THEN
    v_slug := majordhome.webshop_json_text(p -> 'slug', 'slug');
    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023', DETAIL = 'slug'; END IF;
    BEGIN
      INSERT INTO majordhome.webshop_pickup_points (org_id, slug, name, address, opening_hours, accepts, is_active)
      VALUES (v_org, v_slug,
              majordhome.webshop_json_text(p -> 'name', 'name'),
              majordhome.webshop_json_text(p -> 'address', 'address'),
              v_hours,
              COALESCE(v_accepts, 'both'),
              CASE WHEN p ? 'is_active' THEN majordhome.webshop_json_bool(p -> 'is_active', 'is_active') ELSE true END)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'slug_taken' USING ERRCODE = '22023', DETAIL = v_slug;
    END;
    RETURN v_id;
  END IF;

  IF p ? 'slug' AND (p ->> 'slug') IS DISTINCT FROM v_cur.slug THEN
    RAISE EXCEPTION 'immutable_field' USING ERRCODE = '22023', DETAIL = 'slug';
  END IF;

  UPDATE majordhome.webshop_pickup_points SET
    name          = CASE WHEN p ? 'name' THEN majordhome.webshop_json_text(p -> 'name', 'name') ELSE name END,
    address       = CASE WHEN p ? 'address' THEN majordhome.webshop_json_text(p -> 'address', 'address') ELSE address END,
    opening_hours = CASE WHEN p ? 'opening_hours' THEN v_hours ELSE opening_hours END,
    accepts       = COALESCE(v_accepts, accepts),
    is_active     = CASE WHEN p ? 'is_active' THEN majordhome.webshop_json_bool(p -> 'is_active', 'is_active') ELSE is_active END
  WHERE id = v_cur.id AND org_id = v_org;
  RETURN v_cur.id;
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_pickup_point_upsert(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_pickup_point_upsert(uuid, jsonb) TO authenticated, service_role;
