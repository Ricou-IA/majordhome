-- 20260621_campaign_inscriptions.sql
-- Système générique d'inscriptions par campagne (offres) -> dashboard Webshop.
-- Charte multi-tenant : RLS + GRANT service_role + vue security_invoker + RPC SECDEF (org derivee de la campagne).
-- Org alignee sur CORE (comme majordhome.clients / mail_campaigns), PAS getMajordhomeOrgId().

-- 1) Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.campaign_inscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES core.organizations(id),
  campaign_key         text NOT NULL,
  client_id            uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  lead_id              uuid,
  first_name           text,
  last_name            text,
  email                text,
  phone                text,
  address              text,
  postal_code          text,
  city                 text,
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  parrainage_code_used text,
  parrain_id           uuid,
  source               text,
  from_token           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_inscriptions_org_campaign
  ON majordhome.campaign_inscriptions (org_id, campaign_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_inscriptions_email
  ON majordhome.campaign_inscriptions (email);

-- 2) RLS ---------------------------------------------------------------------
ALTER TABLE majordhome.campaign_inscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_inscriptions_select_org_members ON majordhome.campaign_inscriptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM core.organization_members om
                 WHERE om.org_id = campaign_inscriptions.org_id AND om.user_id = auth.uid()));

CREATE POLICY campaign_inscriptions_delete_org_members ON majordhome.campaign_inscriptions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM core.organization_members om
                 WHERE om.org_id = campaign_inscriptions.org_id AND om.user_id = auth.uid()));
-- Pas de policy INSERT/UPDATE -> ecriture uniquement via la RPC SECURITY DEFINER.

-- 3) Grants ------------------------------------------------------------------
-- Lecture front via la vue security_invoker -> authenticated a besoin de SELECT sur la table.
GRANT SELECT, DELETE ON majordhome.campaign_inscriptions TO authenticated;
-- Charte : table lue via vue publique -> service_role SELECT explicite (edge functions).
GRANT SELECT ON majordhome.campaign_inscriptions TO service_role;

-- 4) Vue publique (miroir simple + JOIN label campagne / nom client) ---------
CREATE OR REPLACE VIEW public.majordhome_campaign_inscriptions
WITH (security_invoker = true) AS
SELECT
  i.id, i.org_id, i.campaign_key, i.client_id, i.lead_id,
  i.first_name, i.last_name, i.email, i.phone,
  i.address, i.postal_code, i.city,
  i.data, i.parrainage_code_used, i.parrain_id, i.source, i.from_token, i.created_at,
  mc.label        AS campaign_label,
  c.display_name  AS client_display_name,
  c.client_number AS client_number
FROM majordhome.campaign_inscriptions i
LEFT JOIN majordhome.mail_campaigns mc ON mc.key = i.campaign_key AND mc.org_id = i.org_id
LEFT JOIN majordhome.clients c        ON c.id  = i.client_id;

GRANT SELECT ON public.majordhome_campaign_inscriptions TO anon, authenticated, service_role;

-- 5) RPC de capture (endpoint public ; org derivee de la campagne, jamais du payload) --
CREATE OR REPLACE FUNCTION public.inscription_record(
  p_campaign_key text,
  p_payload      jsonb,
  p_token        text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'core', 'extensions'
AS $function$
DECLARE
  v_org         uuid;
  v_org_count   int;
  v_first       text := NULLIF(trim(p_payload->>'first_name'), '');
  v_last        text := NULLIF(trim(p_payload->>'last_name'), '');
  v_email       text := NULLIF(lower(trim(p_payload->>'email')), '');
  v_phone       text := NULLIF(trim(p_payload->>'phone'), '');
  v_address     text := NULLIF(trim(p_payload->>'address'), '');
  v_postal      text := NULLIF(trim(p_payload->>'postal_code'), '');
  v_city        text := NULLIF(trim(p_payload->>'city'), '');
  v_source      text := NULLIF(trim(p_payload->>'source'), '');
  v_parr_code   text := NULLIF(trim(p_payload->>'parrainage_code'), '');
  v_data        jsonb;
  v_clean_phone text;
  v_client_id   uuid;
  v_is_new      boolean := false;
  v_parrain_id  uuid;
  v_project_id  uuid;
  v_display     text;
  v_insc_id     uuid;
  v_now         timestamptz := now();
BEGIN
  -- 1) org derivee de la campagne (jamais du payload -> anon-safe)
  SELECT count(*) INTO v_org_count FROM majordhome.mail_campaigns WHERE key = p_campaign_key;
  IF v_org_count = 0 THEN
    RETURN json_build_object('success', false, 'error', 'campagne_inconnue');
  ELSIF v_org_count > 1 THEN
    RETURN json_build_object('success', false, 'error', 'campagne_ambigue');
  END IF;
  SELECT org_id INTO v_org FROM majordhome.mail_campaigns WHERE key = p_campaign_key;

  -- 2) validation minimale
  IF v_first IS NULL OR v_last IS NULL OR (v_email IS NULL AND v_phone IS NULL) THEN
    RETURN json_build_object('success', false, 'error', 'champs_obligatoires_manquants');
  END IF;

  -- 3) data = payload moins les cles de contact connues
  v_data := (p_payload - 'first_name' - 'last_name' - 'email' - 'phone'
                       - 'address' - 'postal_code' - 'city' - 'source' - 'parrainage_code');

  -- 4) parrainage (optionnel)
  IF v_parr_code IS NOT NULL THEN
    SELECT id INTO v_parrain_id FROM majordhome.clients
    WHERE upper(parrainage_code) = upper(v_parr_code) AND org_id = v_org AND is_archived = false
    LIMIT 1;
  END IF;

  -- 5) resolution client : dedoublonnage email/phone, sinon creation (parite pellets)
  --    (Lot 2 : si p_token fourni, resoudre le client via clients.campaign_link_token ici.)
  v_clean_phone := regexp_replace(COALESCE(v_phone, ''), '[^0-9+]', '', 'g');

  SELECT id INTO v_client_id FROM majordhome.clients
  WHERE org_id = v_org AND is_archived = false
    AND ((v_email IS NOT NULL AND lower(email) = v_email)
      OR (v_clean_phone <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = v_clean_phone))
  LIMIT 1;

  IF v_client_id IS NULL THEN
    v_is_new := true;
    v_display := upper(v_first || ' ' || v_last);

    INSERT INTO core.projects (org_id, name, status, created_at, updated_at)
    VALUES (v_org, v_display, 'active', v_now, v_now)
    RETURNING id INTO v_project_id;

    -- NOTE: client_number OMIS volontairement -> DEFAULT sequence (gotcha DB).
    INSERT INTO majordhome.clients (
      first_name, last_name, email, phone, address, postal_code, city,
      org_id, project_id, display_name, parrain_id, parrainage_code, created_at, updated_at
    ) VALUES (
      v_first, v_last, v_email, v_phone, v_address, v_postal, v_city,
      v_org, v_project_id, v_display, v_parrain_id,
      upper(substring(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6)),
      v_now, v_now
    ) RETURNING id INTO v_client_id;
  END IF;

  -- 6) insert inscription (TOUJOURS)
  INSERT INTO majordhome.campaign_inscriptions (
    org_id, campaign_key, client_id, first_name, last_name, email, phone,
    address, postal_code, city, data, parrainage_code_used, parrain_id, source, from_token
  ) VALUES (
    v_org, p_campaign_key, v_client_id, v_first, v_last, v_email, v_phone,
    v_address, v_postal, v_city, COALESCE(v_data, '{}'::jsonb), v_parr_code, v_parrain_id, v_source,
    (p_token IS NOT NULL)
  ) RETURNING id INTO v_insc_id;

  RETURN json_build_object(
    'success', true,
    'inscription_id', v_insc_id,
    'client_id', v_client_id,
    'is_new_client', v_is_new,
    'parrain_found', v_parrain_id IS NOT NULL
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inscription_record(text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.inscription_record(text, jsonb, text) TO anon, authenticated;

-- 6) reload PostgREST (nouvelle table + vue exposees)
NOTIFY pgrst, 'reload schema';
