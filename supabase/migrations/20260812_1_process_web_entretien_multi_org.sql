-- ============================================================================
-- process_web_entretien — multi-org + arret de la destruction de contrats
-- ============================================================================
--
-- CONTEXTE (2026-08-12)
-- Cette fonction, appelee par la route /api/entretien du site vitrine, portait
-- Mayer en dur a quatre endroits : l'org, les trois zones tarifaires, le mapping
-- departement -> zone, et un type d'equipement de repli. Un 2e client aurait
-- donc vu ses souscriptions web atterrir chez Mayer.
--
-- TROIS BUGS CORRIGES AU PASSAGE :
--
-- 1. DESTRUCTION DE CONTRAT. La fonction supprimait les lignes tarifaires et les
--    equipements de TOUS les contrats du client avant de reinserer. Or elle
--    retrouve les clients par email et `contracts` porte un UNIQUE(client_id) :
--    un client existant qui resoumettait le formulaire public voyait donc le
--    detail tarifaire de son contrat — signe ou non — efface et remplace par
--    l'estimation web. Desormais : un contrat qui n'est pas `pending` n'est PAS
--    touche. La demande n'est pas perdue pour autant, l'intervention
--    « a planifier » etant creee dans tous les cas — c'est elle qui remonte
--    dans le kanban et porte le geste a faire.
--
-- 2. AVEYRON SUR-FACTURE. Le CASE en dur testait `v_dept IN ('82','31')` alors
--    que la Zone 2 couvre `['82','12','31']` en base. Un client du 12 tombait
--    en « Hors Zone » : 60 EUR de supplement au lieu de 30. Le CASE avait derive
--    de la configuration qu'il etait cense refleter — d'ou la resolution par
--    les donnees, qui rend cette derive impossible.
--
-- 3. FUITE CROSS-ORG. `SELECT id FROM pricing_equipment_types WHERE code = ...`
--    n'etait pas filtre par org : avec deux orgs partageant un meme code, la
--    ligne retenue etait arbitraire.
--
-- La categorie d'equipement vient elle aussi des donnees desormais
-- (`pricing_equipment_types.equipment_category`) au lieu d'un CASE sur les
-- libelles du formulaire de Mayer.
-- ============================================================================

CREATE OR REPLACE FUNCTION majordhome.process_web_entretien(
  p_org_id          uuid,
  p_prenom          text,
  p_nom             text,
  p_email           text,
  p_telephone       text,
  p_adresse         text,
  p_code_postal     text,
  p_ville           text,
  p_zone            text    DEFAULT NULL,
  p_equipements     jsonb   DEFAULT '[]'::jsonb,
  p_estimation_ttc  numeric DEFAULT 0,
  p_sous_total      numeric DEFAULT 0,
  p_discount        integer DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_label  text    DEFAULT NULL,
  p_details         jsonb   DEFAULT '[]'::jsonb,
  p_message         text    DEFAULT NULL
)
RETURNS TABLE(
  out_client_id       uuid,
  out_contract_id     uuid,
  out_contract_number character varying,
  out_intervention_id uuid,
  out_contract_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core', 'pg_temp'
AS $function$
DECLARE
  v_client_id       UUID;
  v_project_id      UUID;
  v_contract_id     UUID;
  v_contract_number VARCHAR;
  v_contract_status majordhome.contract_status;
  v_locked          BOOLEAN := false;
  v_intervention_id UUID;
  v_zone_id         UUID;
  v_display_name    TEXT;
  v_eq              JSONB;
  v_eq_id           UUID;
  v_eq_type_id      UUID;
  v_eq_category     majordhome.equipment_category;
  v_fallback_type   UUID;
  v_detail          JSONB;
  v_dept            TEXT;
  v_new_eq_ids      UUID[] := '{}';
  v_i               INTEGER;
  v_count           INTEGER;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = 'P0001';
  END IF;

  v_display_name := btrim(coalesce(p_prenom,'') || ' ' || coalesce(p_nom,''));

  -- ═══ 1. ZONE — resolue depuis pricing_zones, jamais en dur ═══
  -- Ordre : code exact, puis p_zone lu comme un departement, puis le
  -- departement deduit du code postal, puis la zone par defaut de l'org.
  SELECT z.id INTO v_zone_id
    FROM majordhome.pricing_zones z
   WHERE z.org_id = p_org_id AND z.is_active
     AND upper(z.code) = upper(btrim(coalesce(p_zone,'')))
   ORDER BY z.sort_order LIMIT 1;

  IF v_zone_id IS NULL AND coalesce(btrim(p_zone),'') <> '' THEN
    SELECT z.id INTO v_zone_id
      FROM majordhome.pricing_zones z
     WHERE z.org_id = p_org_id AND z.is_active
       AND btrim(p_zone) = ANY(z.departments)
     ORDER BY z.sort_order LIMIT 1;
  END IF;

  IF v_zone_id IS NULL THEN
    v_dept := left(nullif(btrim(coalesce(p_code_postal,'')), ''), 2);
    IF v_dept IS NOT NULL THEN
      SELECT z.id INTO v_zone_id
        FROM majordhome.pricing_zones z
       WHERE z.org_id = p_org_id AND z.is_active
         AND v_dept = ANY(z.departments)
       ORDER BY z.sort_order LIMIT 1;
    END IF;
  END IF;

  IF v_zone_id IS NULL THEN
    SELECT z.id INTO v_zone_id
      FROM majordhome.pricing_zones z
     WHERE z.org_id = p_org_id AND z.is_active AND z.is_default
     ORDER BY z.sort_order LIMIT 1;
  END IF;

  IF v_zone_id IS NULL THEN
    RAISE EXCEPTION 'no_pricing_zone_for_org' USING ERRCODE = 'P0001';
  END IF;

  -- ═══ 2. UPSERT CLIENT ═══
  SELECT c.id, c.project_id INTO v_client_id, v_project_id
    FROM majordhome.clients c
   WHERE c.email = p_email AND c.org_id = p_org_id
   LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO core.projects (org_id, name, status)
    VALUES (p_org_id, v_display_name, 'active')
    RETURNING id INTO v_project_id;

    INSERT INTO majordhome.clients (
      project_id, org_id, first_name, last_name, display_name,
      email, phone, address, postal_code, city, lead_source, is_web_draft
    )
    VALUES (
      v_project_id, p_org_id, p_prenom, p_nom, v_display_name,
      p_email, p_telephone, p_adresse, p_code_postal, p_ville, 'web', true
    )
    RETURNING id INTO v_client_id;
  ELSE
    -- Un client deja etabli n'est pas retrograde en brouillon web.
    UPDATE majordhome.clients SET
      phone       = coalesce(nullif(btrim(p_telephone),''), phone),
      address     = coalesce(nullif(btrim(p_adresse),''), address),
      postal_code = coalesce(nullif(btrim(p_code_postal),''), postal_code),
      city        = coalesce(nullif(btrim(p_ville),''), city),
      updated_at  = NOW()
    WHERE id = v_client_id;
  END IF;

  -- ═══ 3. CONTRAT EXISTANT : verrouille s'il n'est plus a l'etat de demande ═══
  SELECT ct.id, ct.contract_number, ct.status
    INTO v_contract_id, v_contract_number, v_contract_status
    FROM majordhome.contracts ct
   WHERE ct.client_id = v_client_id;

  v_locked := v_contract_id IS NOT NULL AND v_contract_status <> 'pending';

  -- ═══ 4. EQUIPEMENTS ═══
  -- Crees seulement si le contrat est modifiable : sinon on ajouterait des
  -- equipements orphelins a un contrat qu'on ne rattachera pas.
  IF NOT v_locked THEN
    v_count := jsonb_array_length(coalesce(p_equipements, '[]'::jsonb));

    FOR v_i IN 0 .. v_count - 1 LOOP
      v_eq := p_equipements -> v_i;

      SELECT pet.id, pet.equipment_category
        INTO v_eq_type_id, v_eq_category
        FROM majordhome.pricing_equipment_types pet
       WHERE pet.org_id = p_org_id
         AND pet.code = v_eq ->> 'type'
       LIMIT 1;

      INSERT INTO majordhome.equipments (
        project_id, category, equipment_type_id, notes, metadata
      )
      VALUES (
        v_project_id,
        coalesce(v_eq_category, 'autre'::majordhome.equipment_category),
        v_eq_type_id,
        v_eq ->> 'label',
        jsonb_build_object(
          'quantity',  coalesce((v_eq ->> 'quantity')::int, 1),
          'source',    'web',
          'form_type', v_eq ->> 'type'
        )
      )
      RETURNING id INTO v_eq_id;

      v_new_eq_ids := v_new_eq_ids || v_eq_id;
    END LOOP;
  END IF;

  -- ═══ 5. CONTRAT ═══
  IF v_locked THEN
    -- On ne touche NI au contrat NI a ses lignes. Un contrat signe n'est pas
    -- modifiable depuis un formulaire public : l'intervention creee plus bas
    -- porte la demande, et l'equipe arbitre.
    NULL;
  ELSE
    DELETE FROM majordhome.contract_pricing_items
     WHERE contract_id = v_contract_id;
    DELETE FROM majordhome.contract_equipments
     WHERE contract_id = v_contract_id;

    INSERT INTO majordhome.contracts (
      org_id, client_id, status, start_date, zone_id,
      amount, subtotal, discount_percent, source, notes
    )
    VALUES (
      p_org_id, v_client_id, 'pending', CURRENT_DATE, v_zone_id,
      p_estimation_ttc, p_sous_total, p_discount, 'web', p_message
    )
    ON CONFLICT (client_id) DO UPDATE SET
      status           = 'pending',
      zone_id          = EXCLUDED.zone_id,
      amount           = EXCLUDED.amount,
      subtotal         = EXCLUDED.subtotal,
      discount_percent = EXCLUDED.discount_percent,
      source           = EXCLUDED.source,
      notes            = EXCLUDED.notes,
      updated_at       = NOW()
    RETURNING id, contract_number INTO v_contract_id, v_contract_number;

    IF array_length(v_new_eq_ids, 1) > 0 THEN
      INSERT INTO majordhome.contract_equipments (contract_id, equipment_id)
      SELECT v_contract_id, unnest(v_new_eq_ids);
    END IF;

    -- ═══ 6. LIGNES TARIFAIRES ═══
    -- equipment_type_id est NOT NULL : il faut un repli, mais tire des donnees
    -- de l'org (1er type d'entretien actif), plus un UUID grave dans le code.
    SELECT pet.id INTO v_fallback_type
      FROM majordhome.pricing_equipment_types pet
     WHERE pet.org_id = p_org_id AND pet.is_active AND pet.is_entretien
     ORDER BY pet.sort_order LIMIT 1;

    IF v_fallback_type IS NULL THEN
      SELECT pet.id INTO v_fallback_type
        FROM majordhome.pricing_equipment_types pet
       WHERE pet.org_id = p_org_id AND pet.is_active
       ORDER BY pet.sort_order LIMIT 1;
    END IF;

    v_count := jsonb_array_length(coalesce(p_details, '[]'::jsonb));

    FOR v_i IN 0 .. v_count - 1 LOOP
      v_detail := p_details -> v_i;
      v_eq_type_id := NULL;

      SELECT e.equipment_type_id INTO v_eq_type_id
        FROM majordhome.equipments e
       WHERE e.id = ANY(v_new_eq_ids)
         AND e.equipment_type_id IS NOT NULL
         AND coalesce(e.notes,'') <> ''
         AND (v_detail ->> 'label') ILIKE '%' || e.notes || '%'
       LIMIT 1;

      IF v_eq_type_id IS NULL THEN
        SELECT e.equipment_type_id INTO v_eq_type_id
          FROM majordhome.equipments e
         WHERE e.id = ANY(v_new_eq_ids) AND e.equipment_type_id IS NOT NULL
         LIMIT 1;
      END IF;

      v_eq_type_id := coalesce(v_eq_type_id, v_fallback_type);

      -- Sans aucun type d'equipement configure, on ne peut pas ecrire la ligne
      -- (NOT NULL). On saute plutot que d'echouer : le contrat et son montant
      -- restent justes, seul le detail manque.
      IF v_eq_type_id IS NOT NULL THEN
        INSERT INTO majordhome.contract_pricing_items (
          contract_id, equipment_type_id, zone_id,
          quantity, base_price, unit_price, line_total
        )
        VALUES (
          v_contract_id, v_eq_type_id, v_zone_id,
          1,
          coalesce((v_detail ->> 'price')::numeric, 0),
          0,
          coalesce((v_detail ->> 'price')::numeric, 0)
        );
      END IF;
    END LOOP;
  END IF;

  -- ═══ 7. INTERVENTION — creee dans TOUS les cas ═══
  -- Y compris contrat verrouille : c'est elle qui porte la demande du visiteur
  -- et la fait remonter dans le kanban « a planifier ».
  INSERT INTO majordhome.interventions (
    project_id, client_id, contract_id, intervention_type,
    status, workflow_status, includes_entretien, tags, metadata
  )
  VALUES (
    v_project_id, v_client_id, v_contract_id, 'entretien',
    'scheduled', 'a_planifier', true,
    CASE WHEN v_locked THEN ARRAY['Web','Contrat existant'] ELSE ARRAY['Web'] END,
    jsonb_build_object(
      'source',          'web',
      'equipements',     p_equipements,
      'zone',            p_zone,
      'estimation',      p_estimation_ttc,
      'contract_locked', v_locked,
      'message',         p_message
    )
  )
  RETURNING id INTO v_intervention_id;

  RETURN QUERY SELECT v_client_id, v_contract_id, v_contract_number,
                      v_intervention_id, v_locked;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Relais public (PostgREST n'expose pas le schema majordhome)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_web_entretien(
  p_org_id          uuid,
  p_prenom          text,
  p_nom             text,
  p_email           text,
  p_telephone       text,
  p_adresse         text,
  p_code_postal     text,
  p_ville           text,
  p_zone            text    DEFAULT NULL,
  p_equipements     jsonb   DEFAULT '[]'::jsonb,
  p_estimation_ttc  numeric DEFAULT 0,
  p_sous_total      numeric DEFAULT 0,
  p_discount        integer DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_label  text    DEFAULT NULL,
  p_details         jsonb   DEFAULT '[]'::jsonb,
  p_message         text    DEFAULT NULL
)
RETURNS TABLE(
  out_client_id       uuid,
  out_contract_id     uuid,
  out_contract_number character varying,
  out_intervention_id uuid,
  out_contract_locked boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core', 'pg_temp'
AS $function$
  SELECT * FROM majordhome.process_web_entretien(
    p_org_id, p_prenom, p_nom, p_email, p_telephone, p_adresse,
    p_code_postal, p_ville, p_zone, p_equipements, p_estimation_ttc,
    p_sous_total, p_discount, p_discount_amount, p_discount_label,
    p_details, p_message
  );
$function$;

-- Charte multi-tenant : p_org_id vient du payload sans etre derive d'auth.uid()
-- => service_role uniquement. Le site appelle deja avec createServiceClient().
REVOKE EXECUTE ON FUNCTION majordhome.process_web_entretien(
  uuid, text, text, text, text, text, text, text, text, jsonb,
  numeric, numeric, integer, numeric, text, jsonb, text
) FROM public, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.process_web_entretien(
  uuid, text, text, text, text, text, text, text, text, jsonb,
  numeric, numeric, integer, numeric, text, jsonb, text
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_web_entretien(
  uuid, text, text, text, text, text, text, text, text, jsonb,
  numeric, numeric, integer, numeric, text, jsonb, text
) TO service_role;

-- ⚠ Les anciennes signatures SANS p_org_id sont CONSERVEES le temps que le site
-- soit redeploye avec le nouvel appel — sinon le formulaire casserait dans
-- l'intervalle. A supprimer une fois la bascule du site verifiee.
