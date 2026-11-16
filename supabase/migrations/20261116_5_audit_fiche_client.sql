-- ============================================================================
-- 20261116_5 — Mouchard : la fiche client entre dans le journal d'audit
-- ============================================================================
-- Pourquoi : la Timeline de la fiche client ne montrait que ce que le front
-- pensait à déclarer (`client_activities` : création, équipement ajouté). Une
-- fiche « mise à jour le 11 novembre » affichait « Aucune activité » : ni
-- l'adresse corrigée, ni le téléphone changé, ni le contrat modifié n'y
-- figuraient. Eric, 2026-11-16 : « il faut enregistrer toutes les
-- modifications, ça servira de traceur ».
--
-- Principe : on étend le mouchard existant (20260916_3) au lieu d'inventer un
-- second mécanisme. Même fonction générique `majordhome.audit_row_change()`,
-- même table append-only `majordhome.audit_log`.
--
-- Ce que cette migration ajoute :
--   1. `audit_log.client_id` — rattache une écriture à la fiche client qu'elle
--      concerne, comme `lead_id` le fait pour un lead. Résolu côté serveur :
--        clients             → id de la ligne
--        ligne avec client_id → cette valeur (contracts, appointments, leads…)
--        contract_equipments → client du contrat
--        ligne avec project_id (equipments) → client de ce projet
--   2. `org_id` dérivé de la fiche client quand la table n'en porte pas
--      (`equipments`, `contract_equipments`) — sans lui la ligne serait
--      invisible (la RLS du journal filtre sur l'org).
--   3. Quatre triggers : clients, equipments, contracts, contract_equipments.
--   4. Reprise : `client_id` posé sur les lignes de RDV déjà au journal (depuis
--      le 2026-09-16), pour que la Timeline montre aussi les RDV du client.
--   5. Vue `majordhome_audit_log` : colonne `client_id` (ajoutée EN FIN de liste).
--
-- Colonnes écartées (argument du trigger) : techniques, dérivées par un autre
-- trigger, ou qui n'ont rien à faire dans un journal lisible par l'équipe :
--   clients   — updated_at (touché à chaque écriture d'un équipement, d'un
--               contrat ou d'une intervention), géocodage (latitude, longitude,
--               geocoded_at, geocode_attempts, address_precision : écrits par le
--               balayage), jetons et marqueurs de campagne (pellets_total_*,
--               emailing_reprise_*).
--   equipments — updated_at, dates d'entretien calculées par trigger, `category`
--               (ancien enum, plus écrit).
--   contracts — updated_at, `signature_client_base64` (image de plusieurs
--               centaines de Ko : la signature se lit par signed_at /
--               signature_client_nom, qui restent tracés).
--
-- Hors périmètre, à décider avec Eric : `interventions` (cartes Entretien / SAV).
-- Les RDV, eux, sont déjà tracés.
--
-- Invariants conservés : table append-only (aucun GRANT d'écriture), fail-safe
-- (une erreur du trigger part en WARNING et ne bloque jamais l'écriture métier),
-- UPDATE sans champ utile → aucune ligne, org normalisée sur l'org core.
-- Pas de rétroactif : rien sur la fiche, les équipements et le contrat avant
-- l'application de cette migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colonne + index
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.audit_log ADD COLUMN IF NOT EXISTS client_id uuid;

COMMENT ON COLUMN majordhome.audit_log.client_id IS
  'Fiche client concernée par l''écriture (clients.id), résolue par le trigger. NULL = écriture sans client.';

CREATE INDEX IF NOT EXISTS idx_audit_log_client
  ON majordhome.audit_log (org_id, client_id, changed_at DESC)
  WHERE client_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Fonction trigger générique (remplace 20260916_3 — même corps, plus le
--    rattachement au client et l'org dérivée)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_ignored   text[] := CASE WHEN TG_NARGS > 0 THEN string_to_array(TG_ARGV[0], ',') ELSE '{}'::text[] END;
  v_old       jsonb  := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new       jsonb  := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row       jsonb  := COALESCE(v_new, v_old);
  v_changed   text[];
  v_old_diff  jsonb;
  v_new_diff  jsonb;
  v_claims    jsonb;
  v_uid       uuid;
  v_role      text;
  v_source    text;
  v_org       uuid;
  v_core_org  uuid;
  v_lead_id   uuid;
  v_client_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(n.key ORDER BY n.key), '{}'::text[])
      INTO v_changed
      FROM jsonb_each(v_new) n
     WHERE NOT (n.key = ANY (v_ignored))
       AND n.value IS DISTINCT FROM (v_old -> n.key);

    -- Rien d'utile n'a bougé (ex. updated_at seul) → pas de ligne.
    IF COALESCE(array_length(v_changed, 1), 0) = 0 THEN
      RETURN NULL;
    END IF;

    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_old_diff, v_new_diff
      FROM unnest(v_changed) AS k;

  ELSIF TG_OP = 'INSERT' THEN
    v_new_diff := jsonb_strip_nulls(v_new - v_ignored);
    v_changed  := ARRAY(SELECT jsonb_object_keys(v_new_diff) ORDER BY 1);

  ELSE -- DELETE
    v_old_diff := jsonb_strip_nulls(v_old - v_ignored);
    v_changed  := ARRAY(SELECT jsonb_object_keys(v_old_diff) ORDER BY 1);
  END IF;

  -- QUI : claims JWT posés par PostgREST (absents en pg_cron / SQL direct).
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_claims := NULL;
  END;
  v_uid  := auth.uid();
  v_role := COALESCE(v_claims ->> 'role', session_user::text);

  -- PAR OÙ : première référence public.xxx / majordhome.xxx de la requête
  -- racine (RPC PostgREST, vue publique, table en SQL direct).
  v_source := substring(current_query() FROM '(?:public|majordhome)"?\."?([A-Za-z_][A-Za-z0-9_]*)');

  -- CLIENT : la fiche que l'écriture concerne (NULL si aucune).
  IF TG_TABLE_NAME = 'clients' THEN
    v_client_id := (v_row ->> 'id')::uuid;
  ELSIF NULLIF(v_row ->> 'client_id', '') IS NOT NULL THEN
    v_client_id := (v_row ->> 'client_id')::uuid;
  ELSIF TG_TABLE_NAME = 'contract_equipments' THEN
    SELECT ct.client_id INTO v_client_id
      FROM majordhome.contracts ct
     WHERE ct.id = NULLIF(v_row ->> 'contract_id', '')::uuid;
  ELSIF NULLIF(v_row ->> 'project_id', '') IS NOT NULL THEN
    SELECT c.id INTO v_client_id
      FROM majordhome.clients c
     WHERE c.project_id = (v_row ->> 'project_id')::uuid;
  END IF;

  -- ORG : celle de la ligne ; à défaut (equipments, contract_equipments) celle
  -- de la fiche client. Puis normalisation sur l'org core (appointments porte
  -- l'org majordhome).
  v_org := NULLIF(v_row ->> 'org_id', '')::uuid;
  IF v_org IS NULL AND v_client_id IS NOT NULL THEN
    SELECT c.org_id INTO v_org FROM majordhome.clients c WHERE c.id = v_client_id;
  END IF;
  IF v_org IS NOT NULL THEN
    SELECT o.core_org_id INTO v_core_org FROM majordhome.organizations o WHERE o.id = v_org;
    v_org := COALESCE(v_core_org, v_org);
  END IF;

  v_lead_id := CASE
    WHEN TG_TABLE_NAME = 'leads' THEN (v_row ->> 'id')::uuid
    ELSE NULLIF(COALESCE(v_new ->> 'lead_id', v_old ->> 'lead_id'), '')::uuid
  END;

  INSERT INTO majordhome.audit_log (
    org_id, table_name, record_id, lead_id, client_id, action, changed_fields,
    old_values, new_values, changed_by, changed_by_role, source
  ) VALUES (
    v_org, TG_TABLE_NAME, (v_row ->> 'id')::uuid, v_lead_id, v_client_id, TG_OP, v_changed,
    v_old_diff, v_new_diff, v_uid, v_role, v_source
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Fail-safe : le mouchard ne bloque jamais l'écriture métier.
  RAISE WARNING 'audit_row_change(%.%) failed: % [%]', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;

-- Fonction trigger : non appelable directement, mais on ferme par hygiène
-- (PUBLIC obligatoire : sans lui le REVOKE ne retire rien).
REVOKE ALL ON FUNCTION majordhome.audit_row_change() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Triggers
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_clients ON majordhome.clients;
CREATE TRIGGER trg_audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON majordhome.clients
  FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change(
    'updated_at,latitude,longitude,geocoded_at,geocode_attempts,address_precision,pellets_total_token,pellets_total_token_used_at,pellets_total_inscrit_at,emailing_reprise_sent_at,emailing_reprise_type'
  );

DROP TRIGGER IF EXISTS trg_audit_equipments ON majordhome.equipments;
CREATE TRIGGER trg_audit_equipments
  AFTER INSERT OR UPDATE OR DELETE ON majordhome.equipments
  FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change(
    'updated_at,last_maintenance_date,next_maintenance_due,category'
  );

DROP TRIGGER IF EXISTS trg_audit_contracts ON majordhome.contracts;
CREATE TRIGGER trg_audit_contracts
  AFTER INSERT OR UPDATE OR DELETE ON majordhome.contracts
  FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change(
    'updated_at,signature_client_base64'
  );

DROP TRIGGER IF EXISTS trg_audit_contract_equipments ON majordhome.contract_equipments;
CREATE TRIGGER trg_audit_contract_equipments
  AFTER INSERT OR UPDATE OR DELETE ON majordhome.contract_equipments
  FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change('created_at');

-- ----------------------------------------------------------------------------
-- 4. Reprise : rattacher au client les RDV déjà au journal
--    (idempotent : ne touche que les lignes encore sans client)
-- ----------------------------------------------------------------------------
UPDATE majordhome.audit_log a
   SET client_id = ap.client_id
  FROM majordhome.appointments ap
 WHERE a.table_name = 'appointments'
   AND a.record_id = ap.id
   AND a.client_id IS NULL
   AND ap.client_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. Vue publique : `client_id` en fin de liste (CREATE OR REPLACE n'accepte
--    un ajout qu'à la fin). security_invoker réaffirmé : un CREATE OR REPLACE
--    sans la clause WITH remet les options à zéro.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_audit_log
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.org_id,
  a.table_name,
  a.record_id,
  a.lead_id,
  a.action,
  a.changed_fields,
  a.old_values,
  a.new_values,
  a.changed_by,
  a.changed_by_role,
  a.source,
  a.changed_at,
  p.full_name AS changed_by_name,
  a.client_id
FROM majordhome.audit_log a
LEFT JOIN public.profiles p ON p.id = a.changed_by;

REVOKE ALL ON public.majordhome_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.majordhome_audit_log TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Vérification post-apply (à exécuter, ne pas se fier au texte) :
--   SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE 'trg_audit_%' ORDER BY 1;
--   SELECT has_table_privilege('anon', 'public.majordhome_audit_log', 'SELECT');          -- false
--   SELECT has_table_privilege('authenticated', 'majordhome.audit_log', 'INSERT');        -- false
--   SELECT reloptions FROM pg_class WHERE oid = 'public.majordhome_audit_log'::regclass;  -- {security_invoker=true}
--   puis une écriture depuis l'app (téléphone d'une fiche) →
--   SELECT * FROM majordhome.audit_log WHERE table_name = 'clients' ORDER BY id DESC LIMIT 1;
-- ----------------------------------------------------------------------------
