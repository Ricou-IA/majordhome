-- ============================================================================
-- Une seule porte d'entrée pour tout lead entrant
-- ============================================================================
-- Avant cette migration, trois chemins créaient des leads avec trois
-- comportements différents :
--   - create_lead_from_webhook (N8N / Meta Ads) : dédup e-mail/téléphone, mais
--     n'enrichissait rien (seuls external_id/external_source en COALESCE) ;
--   - create_website_lead (formulaire contact du site vitrine)  : INSERT pur ;
--   - create_aide_lead    (simulateur d'aides du site vitrine)  : INSERT pur.
--
-- Conséquence mesurée le 2026-09-01 : le résultat dépendait de qui gagnait la
-- course de quelques minutes.
--   * Site puis Meta  -> une seule carte, mais l'attribution payante est perdue
--     (external_source restait 'website_*', or les colonnes générées
--     meta_campaign_id/adset_id/ad_id exigent external_source = 'meta_ads').
--     Vécu : 4 leads portent un external_id Meta sous une source « Site Web »
--     (KINT, ALBENGE, AMAR, GALIBERT).
--   * Meta puis Site  -> DEUX cartes pour la même personne, les RPC du site
--     n'ayant aucune déduplication. Vécu : ROBARD MAIWENN (10/04 + 13/04).
--
-- Règle posée ici : une personne = une carte, et les trois portes passent par
-- la même résolution. On ENRICHIT toujours, on ne remplace jamais — à la seule
-- exception de l'attribution, où l'acquisition payante prime (cf. plus bas).
--
-- Les trois signatures publiques sont inchangées : rien à redéployer côté site
-- vitrine (C:\Dev\Landing Page - Mayer) ni côté workflow N8N.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Résolution unique (interne, schéma majordhome donc hors PostgREST)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.lead_resolve_or_create(
  p_org_id            uuid,
  p_first_name        text    DEFAULT NULL,
  p_last_name         text    DEFAULT NULL,
  p_email             text    DEFAULT NULL,
  p_phone             text    DEFAULT NULL,
  p_address           text    DEFAULT NULL,
  p_postal_code       text    DEFAULT NULL,
  p_city              text    DEFAULT NULL,
  p_notes             text    DEFAULT NULL,
  p_source_id         uuid    DEFAULT NULL,
  p_status_id         uuid    DEFAULT NULL,
  p_assigned_user_id  uuid    DEFAULT NULL,
  p_probability       integer DEFAULT NULL,
  p_created_date      date    DEFAULT NULL,
  p_external_id       text    DEFAULT NULL,
  p_external_source   text    DEFAULT NULL,
  p_external_data     jsonb   DEFAULT NULL,
  p_equipment_type_id uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core', 'pg_temp'
AS $function$
DECLARE
  v_lead_id      uuid;
  v_existing     majordhome.leads%ROWTYPE;
  v_email        text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_ext_id       text := nullif(trim(coalesce(p_external_id, '')), '');
  v_notes        text := nullif(trim(coalesce(p_notes, '')), '');
  v_data         jsonb := coalesce(p_external_data, '{}'::jsonb);
  v_phone_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone9       text;
  v_takes_attr   boolean;
  v_carry        jsonb := '{}'::jsonb;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = 'P0001';
  END IF;

  -- Le match téléphone se fait sur les 9 derniers chiffres, ce qui neutralise
  -- les écritures 06…/+336…/336…. Sous 9 chiffres on ne compare pas : un
  -- fragment apparierait n'importe qui.
  IF length(v_phone_digits) >= 9 THEN
    v_phone9 := right(v_phone_digits, 9);
  END IF;

  -- --------------------------------------------------------------------------
  -- Étape 1 — même ÉVÉNEMENT déjà ingéré (re-poll N8N sur une fenêtre glissante).
  -- Aucune écriture : c'est ce qui rend le re-poll gratuit.
  -- --------------------------------------------------------------------------
  IF v_ext_id IS NOT NULL THEN
    SELECT id INTO v_lead_id
      FROM majordhome.leads
     WHERE org_id = p_org_id
       AND external_id = v_ext_id
       AND external_source IS NOT DISTINCT FROM p_external_source
     LIMIT 1;

    IF v_lead_id IS NOT NULL THEN
      RETURN jsonb_build_object('lead_id', v_lead_id,
                                'already_existed', true,
                                'matched_by', 'external_id');
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- Étape 2 — même PERSONNE : e-mail exact, ou à défaut les 9 derniers chiffres
  -- du téléphone. La fiche la plus ancienne est celle qu'on réclame.
  -- --------------------------------------------------------------------------
  SELECT l.* INTO v_existing
    FROM majordhome.leads l
   WHERE l.org_id = p_org_id
     AND (
           (v_email IS NOT NULL AND lower(trim(coalesce(l.email, ''))) = v_email)
        OR (v_phone9 IS NOT NULL
            AND right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9) = v_phone9)
         )
   ORDER BY l.created_at ASC
   LIMIT 1;

  IF FOUND THEN
    -- L'acquisition payante prime sur l'organique, quel que soit l'ordre
    -- d'arrivée : c'est Meta qui a payé le clic amenant la personne, le site
    -- n'est que le second point de contact. Sans cette bascule, les colonnes
    -- GENERATED meta_campaign_id/adset_id/ad_id restent NULL (elles exigent
    -- external_source = 'meta_ads') et le lead est compté comme organique dans
    -- majordhome_meta_ads_leads_attribution.
    v_takes_attr := (p_external_source = 'meta_ads'
                     AND coalesce(v_existing.external_source, '') <> 'meta_ads');

    -- L'identifiant externe remplacé n'est jamais jeté : on le range dans
    -- external_data (le lien vers aide_requests, lui, vit déjà dedans).
    IF v_takes_attr AND v_existing.external_id IS NOT NULL THEN
      v_carry := jsonb_build_object(
        'previous_external',
        jsonb_build_object('id', v_existing.external_id,
                           'source', v_existing.external_source)
      );
    END IF;

    UPDATE majordhome.leads SET
      -- Identité et coordonnées : on ne comble que les trous.
      first_name        = coalesce(nullif(trim(coalesce(first_name, '')), ''),  p_first_name),
      last_name         = coalesce(nullif(trim(coalesce(last_name, '')), ''),   p_last_name),
      email             = coalesce(nullif(trim(coalesce(email, '')), ''),       p_email),
      phone             = coalesce(nullif(trim(coalesce(phone, '')), ''),       p_phone),
      address           = coalesce(nullif(trim(coalesce(address, '')), ''),     p_address),
      postal_code       = coalesce(nullif(trim(coalesce(postal_code, '')), ''), p_postal_code),
      city              = coalesce(nullif(trim(coalesce(city, '')), ''),        p_city),
      equipment_type_id = coalesce(equipment_type_id, p_equipment_type_id),

      -- Jamais rétrogradé : un second contact ne doit pas ramener une fiche
      -- « Devis envoyé » à « Nouveau », ni réassigner un commercial en place.
      assigned_user_id  = coalesce(assigned_user_id, p_assigned_user_id),
      status_id         = coalesce(status_id, p_status_id),

      -- La note s'ajoute à la suite ; un re-poll ne la duplique pas.
      notes = CASE
                WHEN v_notes IS NULL THEN notes
                WHEN coalesce(trim(notes), '') = '' THEN v_notes
                WHEN position(v_notes in notes) > 0 THEN notes
                ELSE notes || E'\n\n' || v_notes
              END,

      external_data = coalesce(external_data, '{}'::jsonb) || v_data || v_carry,

      source_id       = CASE WHEN v_takes_attr THEN coalesce(p_source_id, source_id)
                             ELSE source_id END,
      external_id     = CASE WHEN v_takes_attr THEN coalesce(v_ext_id, external_id)
                             ELSE coalesce(external_id, v_ext_id) END,
      external_source = CASE WHEN v_takes_attr THEN p_external_source
                             ELSE coalesce(external_source, p_external_source) END,

      updated_at = now()
    WHERE id = v_existing.id;

    RETURN jsonb_build_object('lead_id', v_existing.id,
                              'already_existed', true,
                              'matched_by', 'contact',
                              'took_attribution', coalesce(v_takes_attr, false));
  END IF;

  -- --------------------------------------------------------------------------
  -- Étape 3 — personne inconnue.
  -- --------------------------------------------------------------------------
  INSERT INTO majordhome.leads (
    org_id, first_name, last_name, email, phone,
    address, postal_code, city, notes,
    source_id, status_id, assigned_user_id, probability, created_date,
    external_id, external_source, external_data, equipment_type_id
  ) VALUES (
    p_org_id, p_first_name, p_last_name, p_email, p_phone,
    p_address, p_postal_code, p_city, p_notes,
    p_source_id, p_status_id, p_assigned_user_id,
    -- 50 = DEFAULT de la colonne, conservé pour les entrées site qui ne
    -- passent pas de probabilité ; le flux Meta passe 10 explicitement.
    coalesce(p_probability, 50),
    coalesce(p_created_date, CURRENT_DATE),
    v_ext_id, p_external_source,
    CASE WHEN v_data = '{}'::jsonb THEN NULL ELSE v_data END,
    p_equipment_type_id
  )
  RETURNING id INTO v_lead_id;

  RETURN jsonb_build_object('lead_id', v_lead_id,
                            'already_existed', false,
                            'matched_by', NULL);
END;
$function$;

COMMENT ON FUNCTION majordhome.lead_resolve_or_create IS
  'Résolution unique de tout lead entrant (Meta Ads, contact site, simulateur aides). '
  'Match external_id+source, sinon e-mail ou 9 derniers chiffres du téléphone. '
  'Enrichit sans écraser ; seule exception : une entrée meta_ads reprend '
  'l''attribution d''une fiche organique (source_id + external_source), sans quoi '
  'les colonnes GENERATED meta_* restent NULL. Voir 20260901_1.';

-- Prend org_id dans son payload sans le dériver d'auth.uid() -> service_role only
-- (charte multi-tenant). PUBLIC est obligatoire : sans lui le REVOKE ne retire rien.
REVOKE ALL ON FUNCTION majordhome.lead_resolve_or_create(
  uuid, text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, integer, date, text, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) Porte Meta Ads (N8N) — signature et forme de retour inchangées
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_lead_from_webhook(p_data jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'majordhome'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  v_res := majordhome.lead_resolve_or_create(
    p_org_id            := (p_data->>'org_id')::uuid,
    p_first_name        := p_data->>'first_name',
    p_last_name         := p_data->>'last_name',
    p_email             := p_data->>'email',
    p_phone             := p_data->>'phone',
    p_address           := p_data->>'address',
    p_postal_code       := p_data->>'postal_code',
    p_city              := p_data->>'city',
    p_notes             := p_data->>'notes',
    p_source_id         := (p_data->>'source_id')::uuid,
    p_status_id         := (p_data->>'status_id')::uuid,
    p_assigned_user_id  := (p_data->>'assigned_user_id')::uuid,
    p_probability       := coalesce((p_data->>'probability')::integer, 10),
    p_created_date      := (p_data->>'created_date')::date,
    p_external_id       := p_data->>'external_id',
    p_external_source   := p_data->>'external_source',
    p_external_data     := CASE WHEN p_data ? 'external_data'
                                THEN p_data->'external_data' ELSE NULL END,
    p_equipment_type_id := NULL
  );
  RETURN v_res::json;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3) Porte formulaire de contact du site vitrine — signature inchangée
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_website_lead(
  p_org_id          uuid,
  p_last_name       text,
  p_email           text,
  p_phone           text,
  p_first_name      text  DEFAULT NULL::text,
  p_address         text  DEFAULT NULL::text,
  p_postal_code     text  DEFAULT NULL::text,
  p_city            text  DEFAULT NULL::text,
  p_notes           text  DEFAULT NULL::text,
  p_source_id       uuid  DEFAULT NULL::uuid,
  p_status_id       uuid  DEFAULT NULL::uuid,
  p_external_source text  DEFAULT 'website_contact'::text,
  p_external_data   jsonb DEFAULT '{}'::jsonb,
  p_assigned_user_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $function$
BEGIN
  RETURN (majordhome.lead_resolve_or_create(
    p_org_id            := p_org_id,
    p_first_name        := p_first_name,
    p_last_name         := p_last_name,
    p_email             := p_email,
    p_phone             := p_phone,
    p_address           := p_address,
    p_postal_code       := p_postal_code,
    p_city              := p_city,
    p_notes             := p_notes,
    p_source_id         := p_source_id,
    p_status_id         := p_status_id,
    p_assigned_user_id  := p_assigned_user_id,
    p_external_source   := p_external_source,
    p_external_data     := p_external_data
  )->>'lead_id')::uuid;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4) Porte simulateur d'aides du site vitrine — signature inchangée
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_aide_lead(
  p_org_id           uuid,
  p_last_name        text,
  p_email            text,
  p_phone            text,
  p_first_name       text  DEFAULT NULL::text,
  p_address          text  DEFAULT NULL::text,
  p_postal_code      text  DEFAULT NULL::text,
  p_city             text  DEFAULT NULL::text,
  p_notes            text  DEFAULT NULL::text,
  p_source_id        uuid  DEFAULT NULL::uuid,
  p_status_id        uuid  DEFAULT NULL::uuid,
  p_assigned_user_id uuid  DEFAULT NULL::uuid,
  p_external_source  text  DEFAULT 'website_aide_simulation'::text,
  p_external_data    jsonb DEFAULT '{}'::jsonb,
  p_equipment_type_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $function$
BEGIN
  RETURN (majordhome.lead_resolve_or_create(
    p_org_id            := p_org_id,
    p_first_name        := p_first_name,
    p_last_name         := p_last_name,
    p_email             := p_email,
    p_phone             := p_phone,
    p_address           := p_address,
    p_postal_code       := p_postal_code,
    p_city              := p_city,
    p_notes             := p_notes,
    p_source_id         := p_source_id,
    p_status_id         := p_status_id,
    p_assigned_user_id  := p_assigned_user_id,
    p_external_source   := p_external_source,
    p_external_data     := p_external_data,
    p_equipment_type_id := p_equipment_type_id
  )->>'lead_id')::uuid;
END;
$function$;
