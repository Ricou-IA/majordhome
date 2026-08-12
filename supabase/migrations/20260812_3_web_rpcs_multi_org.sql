-- ============================================================================
-- Les 3 dernieres RPC du site vitrine passent en multi-org
-- ============================================================================
--
-- Suite de 20260812_1 (process_web_entretien). Ces trois-la portaient encore
-- Mayer en dur et couvrent l'essentiel du trafic du site :
--
--   create_website_lead        7 routes (contact, devis PAC, Tesla, 2 bornes,
--                              pellets, bricafeu)
--   create_aide_lead           1 route
--   inscrire_prospect_pellets  2 routes
--
-- CE QUI SORT DU CODE
--   - l'org, remplacee par p_org_id (obligatoire)
--   - les valeurs par defaut Mayer de p_source_id / p_status_id : le site les
--     transmet TOUJOURS depuis ses propres variables d'environnement, ces
--     defauts ne servaient donc jamais — ils n'etaient qu'un repli silencieux
--     vers Mayer si un appelant les omettait
--   - le commercial Mayer par defaut de create_aide_lead
--
-- DEUX FUITES CROSS-ORG CORRIGEES DANS inscrire_prospect_pellets
--   1. La recherche du client existant n'etait filtree par AUCUNE org : une
--      personne cliente de l'org A qui s'inscrivait depuis le site de l'org B
--      etait retrouvee et MODIFIEE dans l'org A.
--   2. Le code de parrainage se resolvait de meme sur toutes les orgs.
--   Consequence directe : `RETURNING ... org_id INTO v_org_id` devient inutile
--   (le client trouve appartient desormais forcement a p_org_id) — retire pour
--   qu'aucune branche ne puisse plus reassigner l'org en cours de route.
--
-- Anciennes signatures conservees le temps du redeploiement du site.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_website_lead(
  p_org_id uuid,
  p_last_name text,
  p_email text,
  p_phone text,
  p_first_name text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_status_id uuid DEFAULT NULL,
  p_external_source text DEFAULT 'website_contact',
  p_external_data jsonb DEFAULT '{}'::jsonb,
  p_assigned_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $function$
DECLARE
  v_lead_id UUID;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO majordhome.leads (
    first_name, last_name, email, phone, address, postal_code, city, notes,
    source_id, status_id, external_source, external_data, assigned_user_id, org_id
  ) VALUES (
    p_first_name, p_last_name, p_email, p_phone, p_address, p_postal_code,
    p_city, p_notes, p_source_id, p_status_id, p_external_source,
    p_external_data, p_assigned_user_id, p_org_id
  )
  RETURNING id INTO v_lead_id;

  RETURN v_lead_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_aide_lead(
  p_org_id uuid,
  p_last_name text,
  p_email text,
  p_phone text,
  p_first_name text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_status_id uuid DEFAULT NULL,
  p_assigned_user_id uuid DEFAULT NULL,
  p_external_source text DEFAULT 'website_aide_simulation',
  p_external_data jsonb DEFAULT '{}'::jsonb,
  p_equipment_type_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $function$
DECLARE
  v_lead_id UUID;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO majordhome.leads (
    first_name, last_name, email, phone, address, postal_code, city, notes,
    source_id, status_id, assigned_user_id, external_source, external_data,
    equipment_type_id, org_id
  ) VALUES (
    p_first_name, p_last_name, p_email, p_phone, p_address, p_postal_code,
    p_city, p_notes, p_source_id, p_status_id, p_assigned_user_id,
    p_external_source, p_external_data, p_equipment_type_id, p_org_id
  )
  RETURNING id INTO v_lead_id;

  RETURN v_lead_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.inscrire_prospect_pellets(
  p_org_id uuid,
  p_first_name text,
  p_last_name text,
  p_address text,
  p_phone text,
  p_email text,
  p_parrainage_code text DEFAULT NULL,
  p_mark_total_inscrit boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'core', 'extensions'
AS $function$
DECLARE
  v_parrain_id UUID;
  v_parrain_name TEXT;
  v_client_id UUID;
  v_parrainage_code_new TEXT;
  v_is_new BOOLEAN := TRUE;
  v_now TIMESTAMPTZ := NOW();
  v_clean_phone TEXT;
  v_display_name TEXT;
  v_project_id UUID;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_first_name IS NULL OR p_last_name IS NULL OR p_email IS NULL OR p_phone IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'champs_obligatoires_manquants');
  END IF;

  -- Parrain cherche DANS L'ORG : un code de parrainage ne traverse pas les orgs.
  IF p_parrainage_code IS NOT NULL AND trim(p_parrainage_code) <> '' THEN
    SELECT id, COALESCE(first_name || ' ' || last_name, last_name, email)
      INTO v_parrain_id, v_parrain_name
      FROM majordhome.clients
     WHERE org_id = p_org_id
       AND upper(parrainage_code) = upper(trim(p_parrainage_code))
       AND is_archived = false
     LIMIT 1;
  END IF;

  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g');

  -- Idem : sans ce filtre, un client de l'org A s'inscrivant depuis le site de
  -- l'org B etait retrouve et modifie dans l'org A.
  SELECT id, parrainage_code INTO v_client_id, v_parrainage_code_new
    FROM majordhome.clients
   WHERE org_id = p_org_id
     AND is_archived = false
     AND (
       (p_email IS NOT NULL AND lower(email) = lower(trim(p_email)))
       OR (v_clean_phone <> '' AND regexp_replace(COALESCE(phone,''), '[^0-9+]', '', 'g') = v_clean_phone)
     )
   LIMIT 1;

  IF v_client_id IS NOT NULL THEN
    v_is_new := FALSE;
    UPDATE majordhome.clients SET
      first_name = COALESCE(NULLIF(trim(p_first_name), ''), first_name),
      last_name  = COALESCE(NULLIF(trim(p_last_name),  ''), last_name),
      address    = COALESCE(NULLIF(trim(p_address),    ''), address),
      phone      = COALESCE(NULLIF(trim(p_phone),      ''), phone),
      email      = COALESCE(NULLIF(trim(p_email),      ''), email),
      parrain_id = COALESCE(parrain_id, v_parrain_id),
      pellets_total_inscrit_at = CASE
        WHEN p_mark_total_inscrit THEN COALESCE(pellets_total_inscrit_at, v_now)
        ELSE pellets_total_inscrit_at
      END,
      updated_at = v_now
    WHERE id = v_client_id
    RETURNING parrainage_code INTO v_parrainage_code_new;
  ELSE
    -- Pattern CRM : chaque client a son propre projet dans core.projects.
    v_display_name := upper(trim(p_first_name) || ' ' || trim(p_last_name));

    INSERT INTO core.projects (org_id, name, status, created_at, updated_at)
    VALUES (p_org_id, v_display_name, 'active', v_now, v_now)
    RETURNING id INTO v_project_id;

    INSERT INTO majordhome.clients (
      first_name, last_name, email, phone, address,
      org_id, project_id, display_name, parrain_id,
      pellets_total_inscrit_at, parrainage_code, created_at, updated_at
    ) VALUES (
      trim(p_first_name), trim(p_last_name),
      NULLIF(trim(p_email), ''), NULLIF(trim(p_phone), ''), NULLIF(trim(p_address), ''),
      p_org_id, v_project_id, v_display_name, v_parrain_id,
      CASE WHEN p_mark_total_inscrit THEN v_now ELSE NULL END,
      upper(substring(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6)),
      v_now, v_now
    )
    RETURNING id, parrainage_code INTO v_client_id, v_parrainage_code_new;
  END IF;

  RETURN json_build_object(
    'success', true,
    'client_id', v_client_id,
    'is_new_client', v_is_new,
    'parrain_found', v_parrain_id IS NOT NULL,
    'parrain_id', v_parrain_id,
    'parrain_name', v_parrain_name,
    'parrainage_code', v_parrainage_code_new,
    'org_id', p_org_id
  );
END;
$function$;

-- Charte multi-tenant : p_org_id vient du payload sans etre derive d'auth.uid()
-- => service_role uniquement. Le site appelle avec createServiceClient().
REVOKE EXECUTE ON FUNCTION public.create_website_lead(
  uuid, text, text, text, text, text, text, text, text, uuid, uuid, text, jsonb, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_website_lead(
  uuid, text, text, text, text, text, text, text, text, uuid, uuid, text, jsonb, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_aide_lead(
  uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, text, jsonb, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_aide_lead(
  uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, text, jsonb, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.inscrire_prospect_pellets(
  uuid, text, text, text, text, text, text, boolean)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inscrire_prospect_pellets(
  uuid, text, text, text, text, text, text, boolean)
  TO service_role;
