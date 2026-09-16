-- ============================================================================
-- Les demandes de Conseil Solaire pour Mayer Energie
-- ============================================================================
-- Conseil Solaire (conseil-solaire.fr, dépôt C:\Dev\Lead Solaire) réserve le
-- Tarn à Mayer Energie : chaque demande de particulier du 81 qui a demandé un
-- rappel est transmise ici, dans le CRM, au dépôt, comme le formulaire de
-- mayer-energie.fr. Spécification côté Conseil Solaire :
-- docs/place-de-marche-2026-09-17.md (décision d'Eric du 17/09/2026).
--
-- Ce que cette migration pose :
--   - une source « Conseil Solaire », à part, pour que Mayer distingue ces
--     leads dans le pipeline ;
--   - une fonction SECURITY DEFINER, autonome (aucune des RPC du site
--     vitrine), qui fige l'organisation Mayer, la source, le statut Nouveau
--     et l'équipement « Panneau photovoltaïque », n'assigne personne, et
--     ne crée jamais deux fois le même lead ;
--   - un rôle de connexion `conseil_solaire_leads` qui n'a que l'exécution de
--     cette fonction. Son mot de passe est posé à part, jamais ici.
--
-- L'organisation figée est celle que portent les leads de Mayer dans
-- majordhome.leads : le core_org_id (3c68…), pas l'id de
-- majordhome.organizations (7825…). Vérifié en base le 17/09/2026.
-- ============================================================================

INSERT INTO majordhome.sources (id, name, description, is_active, color)
VALUES (
  'c0a5e11e-5011-4a1e-9e1e-202609170001'::uuid,
  'Conseil Solaire',
  'Demandes photovoltaïques de particuliers transmises par conseil-solaire.fr, avec leur étude et leur consentement',
  true,
  '#e78c08'
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION majordhome.recevoir_lead_conseil_solaire(
  p_demande_id  text,
  p_prenom      text,
  p_nom         text,
  p_email       text,
  p_telephone   text,
  p_adresse     text,
  p_code_postal text,
  p_commune     text,
  p_latitude    double precision,
  p_longitude   double precision,
  p_notes       text,
  p_donnees     jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
DECLARE
  c_org        CONSTANT uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'; -- Mayer Energie, org core
  c_source     CONSTANT uuid := 'c0a5e11e-5011-4a1e-9e1e-202609170001'; -- source « Conseil Solaire »
  c_statut     CONSTANT uuid := 'ea926b9a-521c-4012-a60b-85b6f7e5c09c'; -- statut « Nouveau »
  c_equipement CONSTANT uuid := 'cee23051-58a0-4b9b-b9a0-df881f7321fd'; -- « Panneau photovoltaïque »
  v_lead_id uuid;
BEGIN
  IF p_demande_id IS NULL OR p_demande_id = '' THEN
    RAISE EXCEPTION 'demande_id_requis' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(p_nom, '') = '' THEN
    RAISE EXCEPTION 'nom_requis' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent : un renvoi de la même demande rend le lead déjà créé.
  SELECT id INTO v_lead_id
  FROM majordhome.leads
  WHERE org_id = c_org
    AND external_source = 'conseil_solaire'
    AND external_id = p_demande_id
  LIMIT 1;
  IF v_lead_id IS NOT NULL THEN
    RETURN v_lead_id;
  END IF;

  INSERT INTO majordhome.leads (
    org_id, first_name, last_name, email, phone,
    address, postal_code, city, latitude, longitude, geocoded_at,
    notes, source_id, status_id, equipment_type_id,
    external_id, external_source, external_data
  ) VALUES (
    c_org, p_prenom, p_nom, p_email, p_telephone,
    p_adresse, p_code_postal, p_commune, p_latitude, p_longitude,
    CASE WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN now() ELSE NULL END,
    p_notes, c_source, c_statut, c_equipement,
    p_demande_id, 'conseil_solaire', coalesce(p_donnees, '{}'::jsonb)
  )
  RETURNING id INTO v_lead_id;

  RETURN v_lead_id;
END;
$function$;

-- Charte : EXECUTE est accordé à PUBLIC par défaut, le retirer explicitement.
REVOKE EXECUTE ON FUNCTION majordhome.recevoir_lead_conseil_solaire(
  text, text, text, text, text, text, text, text, double precision, double precision, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- Le rôle de Conseil Solaire : se connecter, voir le schéma, exécuter cette
-- fonction, rien d'autre. Le mot de passe est posé hors dépôt
-- (ALTER ROLE conseil_solaire_leads PASSWORD '…').
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conseil_solaire_leads') THEN
    CREATE ROLE conseil_solaire_leads LOGIN NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA majordhome TO conseil_solaire_leads;
GRANT EXECUTE ON FUNCTION majordhome.recevoir_lead_conseil_solaire(
  text, text, text, text, text, text, text, text, double precision, double precision, text, jsonb)
  TO conseil_solaire_leads;
