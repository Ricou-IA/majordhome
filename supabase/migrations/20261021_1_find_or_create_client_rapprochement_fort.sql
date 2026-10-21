-- ============================================================================
-- 20261021_1 — find_or_create_client : rapprochement fort avant toute création
-- ============================================================================
-- CONSTAT (2026-10-21, org Mayer) : `pennylane-sync-cron` (PL → MDH, horaire)
-- appelle `find_or_create_client` pour chaque customer Pennylane sans mapping.
-- Sur 132 fiches créées par ce flux (`client_creation_audit.source =
-- 'cron_pennylane'`, action `created`), 11 doublonnent une fiche PLUS ANCIENNE
-- de même téléphone ou même e-mail (JEAN GOMES ↔ GOMES JEAN, ROBERT AMSELLEM,
-- AUDREY POULARD, MME VALMACO, MME RAYNAUD, VAN ZWYNSVOORDE…).
--
-- CAUSE : le rapprochement « strict » ne tenait jamais sur ces cas :
--   (a) téléphones comparés chiffre à chiffre — « +33 6 86 47 22 16 »
--       (Pennylane) donne 33686472216, « 06 86 47 22 16 » (MDH) 0686472216 :
--       jamais égaux, l'axe téléphone était mort pour tout numéro PL ;
--   (b) l'axe téléphone exigeait en plus prénom ET nom identiques, champ par
--       champ — or le cron découpe « Prénom NOM » (1er mot = prénom) là où la
--       fiche MDH porte souvent « NOM Prénom » ou une civilité (« MME ») ;
--   (c) l'axe e-mail exigeait aussi ce téléphone ou ce nom.
--
-- CORRECTIF : avant de créer, nouvelle étape « rapprochement fort », même
-- définition que le filet front (`src/lib/clientDuplicateMatch.js`) :
--   - FORT = même téléphone (principal ou secondaire, 9 derniers chiffres) ou
--     même e-mail (trim + minuscules), fiches non archivées ;
--   - on ne rattache que si UN SEUL candidat fort a des noms COMPATIBLES
--     (mots significatifs, sans civilité ni forme juridique, ordre
--     indifférent, l'un inclus dans l'autre : « MME RAYNAUD » ⊆ « FABIEN
--     RAYNAUD », « JEAN GOMES » = « GOMES JEAN ») ;
--   - fort mais pas compatible (VIGROUX JEROME ↔ VIGROUX ISABELLE, une SCI ↔
--     sa gérante) ou plusieurs compatibles = AMBIGU. Avec
--     `p_refuse_ambiguous = true` (flux serveur), la RPC ne crée RIEN et
--     renvoie `action = 'ambiguous'` + les candidats ; tracé dans
--     `client_creation_audit` (au plus une ligne par jour et par entrée).
--     Sans le drapeau (mémos vocaux : un humain a demandé la création),
--     comportement inchangé.
-- L'axe lead par téléphone passe aussi aux 9 derniers chiffres (même bug (a)).
--
-- Signature : + `p_refuse_ambiguous boolean DEFAULT false` en fin de liste →
-- DROP + CREATE (sinon deux surcharges). Appelants : edge
-- `pennylane-sync-cron` (service_role, passe true) et `voiceMemos.service.js`
-- (authenticated, paramètres nommés, inchangé).
-- ============================================================================

-- Mots significatifs d'une identité (nom, prénom, raison sociale) : majuscules
-- sans accent, découpés sur tout ce qui n'est ni lettre ni chiffre, sans
-- civilité, forme juridique ni particule.
CREATE OR REPLACE FUNCTION majordhome.client_identity_tokens(VARIADIC p_parts text[])
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = majordhome, public
AS $$
  SELECT COALESCE(array_agg(DISTINCT t), '{}'::text[])
  FROM unnest(p_parts) AS part,
       regexp_split_to_table(upper(public.unaccent(COALESCE(part, ''))), '[^A-Z0-9]+') AS t
  WHERE length(t) >= 2
    AND t NOT IN ('MR', 'MME', 'MLLE', 'MM', 'MMES', 'MONSIEUR', 'MADAME', 'MADEMOISELLE',
                  'SARL', 'SAS', 'SASU', 'SCI', 'EURL', 'EARL', 'GAEC', 'SA', 'SNC', 'SCEA',
                  'STE', 'SOCIETE', 'ET', 'DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'EPOUX', 'EP');
$$;

-- Deux identités désignent-elles plausiblement la même personne ? Vrai si les
-- deux jeux de mots sont non vides et que l'un est inclus dans l'autre.
CREATE OR REPLACE FUNCTION majordhome.client_names_compatible(p_a text[], p_b text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT cardinality(p_a) > 0 AND cardinality(p_b) > 0 AND (p_a <@ p_b OR p_b <@ p_a);
$$;

-- Clé téléphone comparable entre formats : 9 derniers chiffres (≡ phoneTailKey).
CREATE OR REPLACE FUNCTION majordhome.phone_tail_key(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN length(d) >= 9 THEN right(d, 9) END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS d) s;
$$;

REVOKE ALL ON FUNCTION majordhome.client_identity_tokens(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION majordhome.client_names_compatible(text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION majordhome.phone_tail_key(text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.find_or_create_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text);

CREATE FUNCTION public.find_or_create_client(
  p_org_id uuid,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_first_name text DEFAULT NULL::text,
  p_last_name text DEFAULT NULL::text,
  p_display_name text DEFAULT NULL::text,
  p_company_name text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_postal_code text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_client_category text DEFAULT 'particulier'::text,
  p_pennylane_account_number text DEFAULT NULL::text,
  p_source text DEFAULT 'unknown'::text,
  p_refuse_ambiguous boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_email_norm text;
  v_phone_norm text;
  v_phone_tail text;
  v_first_norm text;
  v_last_norm text;
  v_match_id uuid;
  v_match_type text := 'none';
  v_lead_id uuid;
  v_lead_client_id uuid;
  v_action text;
  v_new_project_id uuid;
  v_fuzzy_id uuid;
  v_input_tokens text[];
  v_strong_ids uuid[];
  v_compat_ids uuid[];
  v_payload jsonb;
BEGIN
  -- ===== SECURITY CHECK (P0.0.9) =====
  -- auth.uid() NULL = service_role (anon n'a pas EXECUTE) ; un appelant
  -- authentifié doit être membre de l'org visée.
  IF auth.uid() IS NOT NULL AND (EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.org_id = p_org_id AND om.user_id = auth.uid()
  )) IS NOT TRUE THEN
    RAISE EXCEPTION 'Acces refuse';
  END IF;
  -- ===================================

  v_email_norm := NULLIF(LOWER(TRIM(p_email)), '');
  IF v_email_norm IS NOT NULL AND position('@' in v_email_norm) = 0 THEN v_email_norm := NULL; END IF;
  v_phone_norm := regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g');
  IF LENGTH(v_phone_norm) < 8 THEN v_phone_norm := NULL; END IF;
  v_phone_tail := majordhome.phone_tail_key(p_phone);
  v_first_norm := NULLIF(LOWER(unaccent(TRIM(COALESCE(p_first_name,'')))), '');
  v_last_norm := NULLIF(LOWER(unaccent(TRIM(COALESCE(p_last_name,'')))), '');

  v_payload := jsonb_build_object(
    'email', p_email, 'phone', p_phone,
    'first_name', p_first_name, 'last_name', p_last_name,
    'display_name', p_display_name, 'company_name', p_company_name,
    'pl_num', p_pennylane_account_number);

  IF v_email_norm IS NOT NULL THEN
    SELECT id INTO v_match_id FROM majordhome.clients
    WHERE org_id = p_org_id AND LOWER(TRIM(email)) = v_email_norm
      AND ((v_phone_norm IS NOT NULL AND regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') = v_phone_norm)
        OR (v_last_norm IS NOT NULL AND v_first_norm IS NOT NULL
            AND LOWER(unaccent(TRIM(COALESCE(last_name,'')))) = v_last_norm
            AND LOWER(unaccent(TRIM(COALESCE(first_name,'')))) = v_first_norm))
    LIMIT 1;
    IF v_match_id IS NOT NULL THEN v_match_type := 'client_email_plus'; v_action := 'matched_strict'; END IF;
  END IF;

  IF v_match_id IS NULL AND v_phone_norm IS NOT NULL AND v_last_norm IS NOT NULL AND v_first_norm IS NOT NULL THEN
    SELECT id INTO v_match_id FROM majordhome.clients
    WHERE org_id = p_org_id AND regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') = v_phone_norm
      AND LOWER(unaccent(TRIM(COALESCE(last_name,'')))) = v_last_norm
      AND LOWER(unaccent(TRIM(COALESCE(first_name,'')))) = v_first_norm
    LIMIT 1;
    IF v_match_id IS NOT NULL THEN v_match_type := 'client_phone_plus_name'; v_action := 'matched_strict'; END IF;
  END IF;

  -- ===== RAPPROCHEMENT FORT (20261021_1) =====
  IF v_match_id IS NULL AND (v_phone_tail IS NOT NULL OR v_email_norm IS NOT NULL) THEN
    v_input_tokens := majordhome.client_identity_tokens(p_first_name, p_last_name, p_display_name, p_company_name);

    SELECT array_agg(s.id ORDER BY s.created_at),
           array_agg(s.id ORDER BY s.created_at) FILTER (WHERE s.compatible)
      INTO v_strong_ids, v_compat_ids
    FROM (
      SELECT c.id, c.created_at,
             majordhome.client_names_compatible(
               v_input_tokens,
               majordhome.client_identity_tokens(c.first_name, c.last_name, c.display_name, c.company_name)
             ) AS compatible
      FROM majordhome.clients c
      WHERE c.org_id = p_org_id
        AND COALESCE(c.is_archived, false) = false
        AND ((v_phone_tail IS NOT NULL AND v_phone_tail IN (majordhome.phone_tail_key(c.phone), majordhome.phone_tail_key(c.phone_secondary)))
          OR (v_email_norm IS NOT NULL AND LOWER(TRIM(c.email)) = v_email_norm))
    ) s;

    IF cardinality(v_compat_ids) = 1 THEN
      v_match_id := v_compat_ids[1];
      v_match_type := 'client_strong_unique';
      v_action := 'matched_strict';
    ELSIF cardinality(v_strong_ids) > 0 AND p_refuse_ambiguous THEN
      -- Ambigu : rien n'est créé ni rattaché. Une ligne d'audit par jour et
      -- par entrée (le cron rejoue le customer non mappé toutes les heures).
      IF NOT EXISTS (
        SELECT 1 FROM majordhome.client_creation_audit a
        WHERE a.org_id = p_org_id AND a.action = 'ambiguous' AND a.source = p_source
          AND a.input_payload - 'candidate_client_ids' = v_payload
          AND a.created_at > now() - interval '1 day'
      ) THEN
        INSERT INTO majordhome.client_creation_audit (
          org_id, source, action, match_type, client_id, lead_id, fuzzy_candidate_id, input_payload
        ) VALUES (
          p_org_id, p_source, 'ambiguous',
          CASE WHEN cardinality(v_compat_ids) > 1 THEN 'client_strong_several' ELSE 'client_strong_name_mismatch' END,
          NULL, NULL, v_strong_ids[1],
          v_payload || jsonb_build_object('candidate_client_ids', to_jsonb(v_strong_ids))
        );
      END IF;

      RETURN jsonb_build_object(
        'client_id', NULL, 'action', 'ambiguous',
        'match_type', CASE WHEN cardinality(v_compat_ids) > 1 THEN 'client_strong_several' ELSE 'client_strong_name_mismatch' END,
        'candidate_client_ids', to_jsonb(v_strong_ids),
        'lead_id', NULL, 'fuzzy_candidate_id', NULL);
    END IF;
  END IF;
  -- ===========================================

  IF v_match_id IS NULL AND v_email_norm IS NOT NULL THEN
    SELECT l.id, l.client_id INTO v_lead_id, v_lead_client_id FROM majordhome.leads l
    WHERE l.org_id = p_org_id AND COALESCE(l.is_deleted, false) = false
      AND LOWER(TRIM(COALESCE(l.email,''))) = v_email_norm
    ORDER BY l.created_at DESC LIMIT 1;
    IF v_lead_id IS NOT NULL THEN
      v_match_type := 'lead_email';
      IF v_lead_client_id IS NOT NULL THEN v_match_id := v_lead_client_id; v_action := 'matched_via_lead'; END IF;
    END IF;
  END IF;

  IF v_match_id IS NULL AND v_lead_id IS NULL AND v_phone_tail IS NOT NULL THEN
    SELECT l.id, l.client_id INTO v_lead_id, v_lead_client_id FROM majordhome.leads l
    WHERE l.org_id = p_org_id AND COALESCE(l.is_deleted, false) = false
      AND majordhome.phone_tail_key(l.phone) = v_phone_tail
    ORDER BY l.created_at DESC LIMIT 1;
    IF v_lead_id IS NOT NULL THEN
      v_match_type := 'lead_phone';
      IF v_lead_client_id IS NOT NULL THEN v_match_id := v_lead_client_id; v_action := 'matched_via_lead'; END IF;
    END IF;
  END IF;

  IF v_match_id IS NOT NULL THEN
    UPDATE majordhome.clients SET
      email = COALESCE(NULLIF(TRIM(email),''), NULLIF(TRIM(p_email),'')),
      phone = COALESCE(NULLIF(TRIM(phone),''), NULLIF(TRIM(p_phone),'')),
      first_name = COALESCE(NULLIF(TRIM(first_name),''), NULLIF(TRIM(UPPER(p_first_name)),'')),
      last_name = COALESCE(NULLIF(TRIM(last_name),''), NULLIF(TRIM(UPPER(p_last_name)),'')),
      company_name = COALESCE(NULLIF(TRIM(company_name),''), NULLIF(TRIM(p_company_name),'')),
      address = COALESCE(NULLIF(TRIM(address),''), NULLIF(TRIM(p_address),'')),
      postal_code = COALESCE(NULLIF(TRIM(postal_code),''), NULLIF(TRIM(p_postal_code),'')),
      city = COALESCE(NULLIF(TRIM(city),''), NULLIF(TRIM(p_city),'')),
      pennylane_account_number = COALESCE(pennylane_account_number, p_pennylane_account_number),
      updated_at = now()
    WHERE id = v_match_id;
  END IF;

  IF v_match_id IS NULL THEN
    v_new_project_id := gen_random_uuid();
    INSERT INTO core.projects (id, org_id, name) VALUES (
      v_new_project_id, p_org_id,
      COALESCE(NULLIF(TRIM(p_display_name),''),
               UPPER(TRIM(COALESCE(p_last_name,'') || ' ' || COALESCE(p_first_name,''))), 'Client'));

    INSERT INTO majordhome.clients (
      project_id, org_id, display_name, first_name, last_name, company_name,
      email, phone, address, postal_code, city, client_category, pennylane_account_number
    ) VALUES (
      v_new_project_id, p_org_id,
      COALESCE(NULLIF(TRIM(p_display_name),''), UPPER(TRIM(COALESCE(p_last_name,'') || ' ' || COALESCE(p_first_name,'')))),
      UPPER(TRIM(COALESCE(p_first_name,''))), UPPER(TRIM(COALESCE(p_last_name,''))),
      p_company_name, p_email, p_phone, p_address, p_postal_code, p_city,
      COALESCE(p_client_category, 'particulier')::majordhome.client_category, p_pennylane_account_number
    ) RETURNING id INTO v_match_id;

    v_action := 'created';

    IF v_lead_id IS NOT NULL AND v_lead_client_id IS NULL THEN
      UPDATE majordhome.leads SET client_id = v_match_id WHERE id = v_lead_id;
      v_action := 'created_linked_lead';
    END IF;
  END IF;

  IF v_action IN ('created', 'created_linked_lead') AND v_email_norm IS NOT NULL THEN
    SELECT id INTO v_fuzzy_id FROM majordhome.clients
    WHERE org_id = p_org_id AND id <> v_match_id AND LOWER(TRIM(email)) = v_email_norm LIMIT 1;

    IF v_fuzzy_id IS NOT NULL THEN
      INSERT INTO majordhome.dedup_candidates (
        org_id, canonical_client_id, duplicate_client_id,
        match_criteria, confidence_score, auto_classification, metadata
      ) VALUES (
        p_org_id, v_fuzzy_id, v_match_id,
        ARRAY['email_exact','from_create_runtime'], 30, 'arbitrate',
        jsonb_build_object('source', p_source, 'detected_at_create', true)
      ) ON CONFLICT (canonical_client_id, duplicate_client_id) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO majordhome.client_creation_audit (
    org_id, source, action, match_type, client_id, lead_id, fuzzy_candidate_id, input_payload
  ) VALUES (
    p_org_id, p_source, v_action, v_match_type, v_match_id, v_lead_id, v_fuzzy_id, v_payload
  );

  RETURN jsonb_build_object(
    'client_id', v_match_id, 'action', v_action, 'match_type', v_match_type,
    'lead_id', v_lead_id, 'fuzzy_candidate_id', v_fuzzy_id);
END
$function$;

REVOKE ALL ON FUNCTION public.find_or_create_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean) TO authenticated, service_role;
