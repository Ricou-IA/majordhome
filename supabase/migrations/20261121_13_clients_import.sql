-- 20261121_13 — Import des clients d'un autre logiciel : table des imports, écriture par lots, retrait.
--
-- Une entreprise qui arrive sur Majord'home dépose le fichier de clients de son ancien logiciel ; l'écran le lit
-- (modules purs `src/lib/importClients/`, tâches 1-4) puis envoie les fiches par lots à `clients_import_batch`.
-- Chaque import est une ligne de `majordhome.client_imports` ; chaque fiche créée porte `import_id` et le numéro de
-- sa ligne dans le fichier (`import_line`) : un lot renvoyé (réseau coupé, double clic) ne recrée rien, et l'import
-- se retire d'un geste tant que ses fiches n'ont servi à rien.
--
-- Charte multi-tenant :
--   - écritures par cinq RPC SECURITY DEFINER, `authenticated` seulement (jamais anon ni PUBLIC) ; l'organisation de
--     `batch` / `finish` / `preview` / `remove` est dérivée de l'IMPORT, jamais d'un paramètre ; `start` vérifie que
--     l'appelant est org_admin actif de `p_org_id` ;
--   - aucune clé `org_id` d'une ligne du fichier n'est lue : liste FERMÉE des colonnes écrites ;
--   - le retrait lit les clés étrangères dans `pg_constraint` à l'exécution (une table ajoutée plus tard est couverte
--     sans migration), identifiants cités par %I / regclass, aucun texte venu de l'appelant, pas de table temporaire.
--
-- Mesuré sur le harnais le 2026-11-21 (`assert-clients-import.sql`, trigger d'audit de `clients` actif, 17 clés
-- étrangères vers clients / projects photographiées sur ~40 en prod) : lot de 200 lignes 70 à 215 ms ; retrait de
-- 200 fiches 330 à 1 010 ms (les retirables sont calculés deux fois : avant et après la suppression). Plafond PostgREST : 8 s ; cible : < 2 s — TAILLE_LOT = 200 tient la marge.
--
-- Codes d'erreur (message de l'exception, à traduire par l'écran) : `unauthenticated` et `org_admin_required`
-- (42501), `import_not_found` (P0002), `import_closed` (55000), `rows_invalid` (forme du lot : pas un tableau de 1 à
-- 500 objets, ou deux lignes du même numéro), `row_invalid` (contenu d'une ligne), `file_name_required`,
-- `removal_incomplete` (le retrait n'a pas supprimé autant de fiches ou de projets que visé : tout est annulé).

-- Base partagée : la pose de colonnes sur `clients` demande un verrou exclusif ; mieux vaut échouer et rejouer
-- que faire attendre toutes les requêtes de l'instance derrière une longue lecture.
SET lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. Table des imports
-- ----------------------------------------------------------------------------
CREATE TABLE majordhome.client_imports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES core.organizations(id),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  file_name    text NOT NULL,
  source_label text,
  mapping      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mapping) = 'array'),
  counts       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  status       text NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours', 'termine', 'retire')),
  removed_at   timestamptz,
  removed_by   uuid
);

COMMENT ON TABLE majordhome.client_imports IS
  'Un import de fichier clients (autre logiciel). Écrit seulement par les RPC clients_import_* ; lu par un org_admin de l''organisation.';
COMMENT ON COLUMN majordhome.client_imports.mapping IS 'Correspondance colonnes du fichier → champs, telle que validée à l''écran.';
COMMENT ON COLUMN majordhome.client_imports.counts IS 'Bilan de l''import (lignes, créées, ignorées…), écrit au départ puis à la fin.';
COMMENT ON COLUMN majordhome.client_imports.status IS 'en_cours → termine (clients_import_finish) ; retire quand toutes les fiches retirables ont été supprimées.';

CREATE INDEX client_imports_org_created_idx ON majordhome.client_imports (org_id, created_at DESC);

ALTER TABLE majordhome.client_imports ENABLE ROW LEVEL SECURITY;

-- Lecture : administrateur ACTIF de l'organisation. Aucune policy d'écriture : les RPC sont les seules à écrire.
CREATE POLICY client_imports_select_org_admin ON majordhome.client_imports
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM core.organization_members m
     WHERE m.org_id = client_imports.org_id
       AND m.user_id = auth.uid()
       AND m.status = 'active'
       AND m.role = 'org_admin'
  ));

-- Le schéma majordhome accorde arwd à authenticated par défaut : on ne garde que la lecture (la vue en a besoin).
REVOKE ALL ON majordhome.client_imports FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON majordhome.client_imports FROM authenticated;
GRANT SELECT ON majordhome.client_imports TO authenticated;
GRANT SELECT ON majordhome.client_imports TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Colonnes de majordhome.clients
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.clients
  ADD COLUMN import_id    uuid REFERENCES majordhome.client_imports(id) ON DELETE SET NULL,
  ADD COLUMN import_line  integer,
  ADD COLUMN external_ref text;

COMMENT ON COLUMN majordhome.clients.import_id IS 'Import de fichier qui a créé la fiche (NULL pour une fiche saisie).';
COMMENT ON COLUMN majordhome.clients.import_line IS 'Numéro de la ligne dans le fichier importé : (import_id, import_line) est unique, un lot renvoyé ne recrée rien.';
COMMENT ON COLUMN majordhome.clients.external_ref IS 'Référence du client dans l''ancien logiciel (numéro de client, code…).';

CREATE UNIQUE INDEX clients_import_line_key ON majordhome.clients (import_id, import_line) WHERE import_id IS NOT NULL;
CREATE INDEX clients_org_external_ref_idx ON majordhome.clients (org_id, external_ref) WHERE external_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Vues clients : définition de production + external_ref en fin
--    (CREATE OR REPLACE efface security_invoker si le WITH est omis : il est réécrit)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_clients WITH (security_invoker = true) AS
 SELECT id, project_id, org_id, first_name, last_name, display_name, company_name, email, phone, phone_secondary,
    address, address_complement, postal_code, city, country, housing_type, surface, floor_count, construction_year,
    dpe_number, dpe_rating, access_instructions, lead_source, tags, is_reliable, import_source, notes, internal_notes,
    created_by, created_at, updated_at, is_archived, archived_at, client_category, client_number, siren, latitude,
    longitude, geocoded_at, is_web_draft, owner_client_id, mail_optin, sms_optin, email_unsubscribed_at,
    email_unsubscribe_reason, auth_user_id, pennylane_account_number,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM majordhome.contracts ct
              WHERE ct.client_id = c.id AND ct.status = 'active'::majordhome.contract_status)) THEN true
            ELSE false
        END AS has_active_contract,
    external_ref
   FROM majordhome.clients c
  WHERE is_web_draft IS NOT TRUE;

CREATE OR REPLACE VIEW public.majordhome_clients_all WITH (security_invoker = true) AS
 SELECT id, project_id, org_id, first_name, last_name, display_name, company_name, email, phone, phone_secondary,
    address, address_complement, postal_code, city, country, housing_type, surface, floor_count, construction_year,
    dpe_number, dpe_rating, access_instructions, lead_source, tags, is_reliable, import_source, notes, internal_notes,
    created_by, created_at, updated_at, is_archived, archived_at, client_category, client_number, siren, latitude,
    longitude, geocoded_at, is_web_draft, owner_client_id, mail_optin, sms_optin, email_unsubscribed_at,
    email_unsubscribe_reason, auth_user_id, pennylane_account_number,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM majordhome.contracts ct
              WHERE ct.client_id = c.id AND ct.status = 'active'::majordhome.contract_status)) THEN true
            ELSE false
        END AS has_active_contract,
    external_ref
   FROM majordhome.clients c;

REVOKE ALL ON public.majordhome_clients FROM PUBLIC, anon;
REVOKE ALL ON public.majordhome_clients_all FROM PUBLIC, anon;

-- Vue des imports (lecture de l'écran « Imports »). Nom de l'auteur par sous-requête sur core.profiles
-- (security_invoker : la RLS de profiles et de client_imports s'applique au lecteur).
CREATE VIEW public.majordhome_client_imports WITH (security_invoker = true) AS
 SELECT i.id, i.org_id, i.created_by,
        (SELECT p.full_name FROM core.profiles p WHERE p.id = i.created_by) AS created_by_name,
        i.created_at, i.file_name, i.source_label, i.counts, i.status, i.removed_at
   FROM majordhome.client_imports i;

REVOKE ALL ON public.majordhome_client_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_client_imports TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Fonctions internes (jamais appelables par PUBLIC, anon, authenticated)
-- ----------------------------------------------------------------------------

-- L'appelant est administrateur ACTIF de l'organisation (même condition que update_member_role, 20261121_3).
CREATE FUNCTION majordhome.clients_import_admin_de(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM core.organization_members
     WHERE org_id = p_org_id AND user_id = auth.uid() AND status = 'active' AND role = 'org_admin'
  ) INTO v_admin;
  IF v_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Rend l'organisation de l'import si l'appelant en est administrateur actif ; lève sinon.
CREATE FUNCTION majordhome.clients_import_org_admin(p_import_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT org_id INTO v_org FROM majordhome.client_imports WHERE id = p_import_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM majordhome.clients_import_admin_de(v_org);
  RETURN v_org;
END;
$$;

-- Texte d'une ligne du fichier : chaîne ou nombre, espaces de bord retirés, vide ⇒ NULL ; tout autre type est refusé.
CREATE FUNCTION majordhome.clients_import_texte(p_row jsonb, p_cle text, p_ligne integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_type text := jsonb_typeof(p_row -> p_cle);
BEGIN
  IF v_type IS NULL OR v_type = 'null' THEN
    RETURN NULL;
  END IF;
  IF v_type IN ('string', 'number') THEN
    RETURN NULLIF(btrim(p_row ->> p_cle), '');
  END IF;
  RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : %s', p_ligne, p_cle);
END;
$$;

-- Fiches de l'import qui ne sont référencées par RIEN : ni une clé étrangère vers la fiche, ni une clé étrangère
-- vers son projet. Lu dans pg_constraint à l'exécution. Exclusions : la fiche elle-même (clients.project_id) et
-- majordhome.client_dpe (la carte du logement se refait). Les auto-références de clients (parrain, propriétaire)
-- comptent : une AUTRE fiche qui pointe vers celle-ci la retient.
CREATE FUNCTION majordhome.clients_import_retirables(p_import_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_candidats uuid[];
  v_retenues  uuid[] := '{}';
  v_ids       uuid[];
  v_jointure  text;
  v_sql       text;
  r record;
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_candidats FROM majordhome.clients WHERE import_id = p_import_id;
  IF cardinality(v_candidats) = 0 THEN
    RETURN '{}';
  END IF;

  FOR r IN
    SELECT c.conrelid::regclass AS source, c.confrelid::regclass AS cible, c.conkey, c.confkey
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid IN ('majordhome.clients'::regclass, 'core.projects'::regclass)
       AND c.conrelid <> 'majordhome.client_dpe'::regclass
       AND NOT (c.conrelid = 'majordhome.clients'::regclass AND c.confrelid = 'core.projects'::regclass)
  LOOP
    SELECT string_agg(format('r.%I = t.%I', a.attname, b.attname), ' AND ' ORDER BY k.ord)
      INTO v_jointure
      FROM unnest(r.conkey, r.confkey) WITH ORDINALITY AS k(col_source, col_cible, ord)
      JOIN pg_attribute a ON a.attrelid = r.source AND a.attnum = k.col_source
      JOIN pg_attribute b ON b.attrelid = r.cible AND b.attnum = k.col_cible;

    IF r.cible = 'majordhome.clients'::regclass THEN
      v_sql := format(
        'SELECT array_agg(t.id) FROM majordhome.clients t WHERE t.id = ANY ($1) AND EXISTS (SELECT 1 FROM %s r WHERE %s%s)',
        r.source, v_jointure,
        CASE WHEN r.source = 'majordhome.clients'::regclass THEN ' AND r.id <> t.id' ELSE '' END);
    ELSE
      v_sql := format(
        'SELECT array_agg(f.id) FROM majordhome.clients f JOIN core.projects t ON t.id = f.project_id'
        ' WHERE f.id = ANY ($1) AND EXISTS (SELECT 1 FROM %s r WHERE %s)',
        r.source, v_jointure);
    END IF;

    EXECUTE v_sql INTO v_ids USING v_candidats;
    v_retenues := v_retenues || coalesce(v_ids, '{}');
  END LOOP;

  RETURN ARRAY(SELECT x FROM unnest(v_candidats) AS x WHERE x <> ALL (v_retenues) ORDER BY x);
END;
$$;

REVOKE ALL ON FUNCTION majordhome.clients_import_admin_de(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION majordhome.clients_import_org_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION majordhome.clients_import_texte(jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION majordhome.clients_import_retirables(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RPC publiques
-- ----------------------------------------------------------------------------

-- Ouvre un import. Rend son identifiant.
CREATE FUNCTION public.clients_import_start(
  p_org_id uuid, p_file_name text, p_source_label text, p_mapping jsonb, p_counts jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_file text;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM majordhome.clients_import_admin_de(p_org_id);

  v_file := left(btrim(coalesce(p_file_name, '')), 255);
  IF v_file = '' THEN
    RAISE EXCEPTION 'file_name_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO majordhome.client_imports (org_id, created_by, file_name, source_label, mapping, counts)
  VALUES (p_org_id, v_uid, v_file, NULLIF(left(btrim(coalesce(p_source_label, '')), 255), ''),
          coalesce(p_mapping, '[]'::jsonb), coalesce(p_counts, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Écrit un lot de 1 à 500 fiches, tout ou rien. Une ligne déjà écrite pour (import, import_line) est comptée
-- « skipped ». Rend { created, skipped }.
CREATE FUNCTION public.clients_import_batch(p_import_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_status  text;
  v_source  text;
  v_row     jsonb;
  v_line    integer;
  v_name    text;
  v_txt     text;
  v_type    text;
  v_cat     majordhome.client_category;
  v_housing majordhome.housing_type;
  v_surface numeric;
  v_year    integer;
  v_mail    boolean;
  v_sms     boolean;
  v_slug    text;
  v_project uuid;
  v_created integer := 0;
  v_skipped integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.clients_import_org_admin(p_import_id);

  -- Verrou : un lot à la fois par import, et ni clôture ni retrait pendant l'écriture.
  SELECT status, source_label INTO v_status, v_source
    FROM majordhome.client_imports WHERE id = p_import_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'en_cours' THEN
    RAISE EXCEPTION 'import_closed' USING ERRCODE = '55000';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023';
  END IF;
  IF (jsonb_array_length(p_rows) BETWEEN 1 AND 500) IS NOT TRUE THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = format('%s lignes (1 à 500)', jsonb_array_length(p_rows));
  END IF;

  -- Forme du lot : que des objets, et jamais deux fois le même numéro de ligne (sinon la seconde serait prise
  -- pour un rejeu de la première et disparaîtrait sans erreur).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS e(v) WHERE jsonb_typeof(e.v) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = 'élément qui n''est pas un objet';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS e(v)
              WHERE jsonb_typeof(e.v -> 'import_line') IS NOT NULL AND jsonb_typeof(e.v -> 'import_line') <> 'null'
              GROUP BY e.v -> 'import_line' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = 'numéro de ligne en double dans le lot';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP

    -- Numéro de ligne : entier positif (nombre JSON)
    IF jsonb_typeof(v_row -> 'import_line') IS DISTINCT FROM 'number'
       OR ((v_row ->> 'import_line') ~ '^[1-9][0-9]{0,8}$') IS NOT TRUE THEN
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = 'import_line';
    END IF;
    v_line := (v_row ->> 'import_line')::integer;

    v_name := majordhome.clients_import_texte(v_row, 'display_name', v_line);
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : display_name', v_line);
    END IF;

    -- Catégorie (énumération ; défaut particulier)
    v_txt := majordhome.clients_import_texte(v_row, 'client_category', v_line);
    IF v_txt IS NULL THEN
      v_cat := 'particulier';
    ELSIF (v_txt = ANY (enum_range(NULL::majordhome.client_category)::text[])) IS TRUE THEN
      v_cat := v_txt::majordhome.client_category;
    ELSE
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : client_category', v_line);
    END IF;

    -- Type de logement (énumération ou rien)
    v_txt := majordhome.clients_import_texte(v_row, 'housing_type', v_line);
    IF v_txt IS NULL THEN
      v_housing := NULL;
    ELSIF (v_txt = ANY (enum_range(NULL::majordhome.housing_type)::text[])) IS TRUE THEN
      v_housing := v_txt::majordhome.housing_type;
    ELSE
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : housing_type', v_line);
    END IF;

    -- Surface : nombre positif (virgule décimale acceptée dans une chaîne)
    v_txt := majordhome.clients_import_texte(v_row, 'surface', v_line);
    IF v_txt IS NULL THEN
      v_surface := NULL;
    ELSIF (v_txt ~ '^[0-9]{1,9}([.,][0-9]{1,4})?$') IS TRUE THEN
      v_surface := replace(v_txt, ',', '.')::numeric;
    ELSE
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : surface', v_line);
    END IF;

    -- Année de construction : entier de 1 à 4 chiffres
    v_txt := majordhome.clients_import_texte(v_row, 'construction_year', v_line);
    IF v_txt IS NULL THEN
      v_year := NULL;
    ELSIF (v_txt ~ '^[0-9]{1,4}$') IS TRUE THEN
      v_year := v_txt::integer;
    ELSE
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : construction_year', v_line);
    END IF;

    -- Consentements : booléen JSON ; absent ou null ⇒ true
    v_type := jsonb_typeof(v_row -> 'mail_optin');
    IF v_type IS NULL OR v_type = 'null' THEN
      v_mail := true;
    ELSIF v_type = 'boolean' THEN
      v_mail := (v_row ->> 'mail_optin')::boolean;
    ELSE
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : mail_optin', v_line);
    END IF;
    v_type := jsonb_typeof(v_row -> 'sms_optin');
    IF v_type IS NULL OR v_type = 'null' THEN
      v_sms := true;
    ELSIF v_type = 'boolean' THEN
      v_sms := (v_row ->> 'sms_optin')::boolean;
    ELSE
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : sms_optin', v_line);
    END IF;

    -- Ligne déjà écrite (lot renvoyé) : rien n'est recréé
    IF EXISTS (SELECT 1 FROM majordhome.clients WHERE import_id = p_import_id AND import_line = v_line) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Projet (même forme que clientsService.createClient ; description NULL : tr_sync_majordhome_project reste inerte)
    v_slug := btrim(regexp_replace(lower(public.unaccent(v_name)), '[^a-z0-9]+', '-', 'g'), '-');
    v_slug := coalesce(NULLIF(v_slug, ''), 'client') || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

    INSERT INTO core.projects (org_id, name, slug, status, identity, created_by)
    VALUES (v_org, v_name, v_slug, 'active',
            jsonb_build_object(
              'first_name',      majordhome.clients_import_texte(v_row, 'first_name', v_line),
              'last_name',       majordhome.clients_import_texte(v_row, 'last_name', v_line),
              'email',           majordhome.clients_import_texte(v_row, 'email', v_line),
              'phone',           majordhome.clients_import_texte(v_row, 'phone', v_line),
              'address',         majordhome.clients_import_texte(v_row, 'address', v_line),
              'postal_code',     majordhome.clients_import_texte(v_row, 'postal_code', v_line),
              'city',            majordhome.clients_import_texte(v_row, 'city', v_line),
              'client_category', v_cat,
              'created_from',    'import_clients'),
            v_uid)
    RETURNING id INTO v_project;

    -- Liste FERMÉE : aucune autre clé de la ligne n'est lue (ni org_id, ni client_number, ni project_id…)
    INSERT INTO majordhome.clients (
      org_id, project_id, display_name, client_category, last_name, first_name, company_name, email, phone,
      phone_secondary, address, address_complement, postal_code, city, housing_type, surface, construction_year,
      access_instructions, notes, internal_notes, mail_optin, sms_optin, external_ref,
      import_id, import_line, import_source, created_by)
    VALUES (
      v_org, v_project, v_name, v_cat,
      majordhome.clients_import_texte(v_row, 'last_name', v_line),
      majordhome.clients_import_texte(v_row, 'first_name', v_line),
      majordhome.clients_import_texte(v_row, 'company_name', v_line),
      majordhome.clients_import_texte(v_row, 'email', v_line),
      majordhome.clients_import_texte(v_row, 'phone', v_line),
      majordhome.clients_import_texte(v_row, 'phone_secondary', v_line),
      majordhome.clients_import_texte(v_row, 'address', v_line),
      majordhome.clients_import_texte(v_row, 'address_complement', v_line),
      majordhome.clients_import_texte(v_row, 'postal_code', v_line),
      majordhome.clients_import_texte(v_row, 'city', v_line),
      v_housing, v_surface, v_year,
      majordhome.clients_import_texte(v_row, 'access_instructions', v_line),
      majordhome.clients_import_texte(v_row, 'notes', v_line),
      majordhome.clients_import_texte(v_row, 'internal_notes', v_line),
      v_mail, v_sms,
      majordhome.clients_import_texte(v_row, 'external_ref', v_line),
      p_import_id, v_line, v_source, v_uid);

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped);
END;
$$;

-- Clôt un import en cours (bilan final).
CREATE FUNCTION public.clients_import_finish(p_import_id uuid, p_counts jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.clients_import_org_admin(p_import_id);

  SELECT status INTO v_status FROM majordhome.client_imports WHERE id = p_import_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'en_cours' THEN
    RAISE EXCEPTION 'import_closed' USING ERRCODE = '55000';
  END IF;

  UPDATE majordhome.client_imports
     SET status = 'termine', counts = coalesce(p_counts, counts)
   WHERE id = p_import_id AND org_id = v_org;
END;
$$;

-- Ce que le retrait ferait : fiches retirables / fiches conservées (référencées ailleurs).
CREATE FUNCTION public.clients_import_removal_preview(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org   uuid;
  v_total integer;
  v_ret   uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.clients_import_org_admin(p_import_id);

  SELECT count(*) INTO v_total FROM majordhome.clients WHERE import_id = p_import_id AND org_id = v_org;
  v_ret := majordhome.clients_import_retirables(p_import_id);
  RETURN jsonb_build_object('retirables', cardinality(v_ret), 'conservees', v_total - cardinality(v_ret));
END;
$$;

-- Retire au plus p_limit (1 à 500) fiches retirables et leurs projets ; à appeler en boucle tant que restantes > 0
-- (PostgREST coupe un appel à 8 s). Ne passe pas par client_hard_delete : pas d'instantané, le fichier fait foi.
CREATE FUNCTION public.clients_import_remove(p_import_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_org       uuid;
  v_limit     integer := LEAST(GREATEST(coalesce(p_limit, 200), 1), 500);
  v_ret       uuid[];
  v_lot       uuid[];
  v_projets   uuid[];
  v_vises     integer;
  v_n         integer;
  v_total     integer;
  v_restantes integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.clients_import_org_admin(p_import_id);

  -- Verrous : l'import (pas de lot en parallèle) puis ses fiches et leurs projets — une écriture concurrente qui
  -- voudrait y rattacher un contrat, un lead… attend la fin du retrait (puis échoue sur la clé étrangère) au lieu
  -- d'être emportée en silence par une suppression en cascade.
  PERFORM 1 FROM majordhome.client_imports WHERE id = p_import_id FOR UPDATE;
  PERFORM 1 FROM majordhome.clients c JOIN core.projects p ON p.id = c.project_id
    WHERE c.import_id = p_import_id FOR UPDATE OF c, p;

  v_ret := majordhome.clients_import_retirables(p_import_id);
  v_lot := coalesce(v_ret[1:v_limit], '{}');
  v_vises := cardinality(v_lot);
  SELECT coalesce(array_agg(project_id), '{}') INTO v_projets
    FROM majordhome.clients WHERE id = ANY (v_lot) AND import_id = p_import_id AND org_id = v_org;

  -- Chaque suppression doit toucher exactement ce qui est visé : sinon tout est annulé (jamais un succès annoncé
  -- sur des fiches ou des projets restés en place).
  DELETE FROM majordhome.clients WHERE id = ANY (v_lot) AND import_id = p_import_id AND org_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM v_vises THEN
    RAISE EXCEPTION 'removal_incomplete' USING ERRCODE = 'P0001', DETAIL = format('fiches : %s supprimées sur %s', v_n, v_vises);
  END IF;
  DELETE FROM core.projects WHERE id = ANY (v_projets) AND org_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM v_vises THEN
    RAISE EXCEPTION 'removal_incomplete' USING ERRCODE = 'P0001', DETAIL = format('projets : %s supprimés sur %s', v_n, v_vises);
  END IF;

  -- Recompté APRÈS la suppression : une fiche que retenait une fiche qui vient de partir (parrain) devient
  -- retirable, et l'import ne passe à « retire » que s'il ne reste vraiment plus rien à retirer.
  SELECT count(*) INTO v_total FROM majordhome.clients WHERE import_id = p_import_id AND org_id = v_org;
  v_restantes := cardinality(majordhome.clients_import_retirables(p_import_id));
  IF v_restantes = 0 THEN
    UPDATE majordhome.client_imports
       SET status = 'retire', removed_at = coalesce(removed_at, now()), removed_by = coalesce(removed_by, v_uid)
     WHERE id = p_import_id AND org_id = v_org;
  END IF;

  RETURN jsonb_build_object('retirees', v_vises, 'conservees', v_total - v_restantes, 'restantes', v_restantes);
END;
$$;

REVOKE ALL ON FUNCTION public.clients_import_start(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clients_import_batch(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clients_import_finish(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clients_import_removal_preview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clients_import_remove(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clients_import_start(uuid, text, text, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clients_import_batch(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clients_import_finish(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clients_import_removal_preview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clients_import_remove(uuid, integer) TO authenticated, service_role;
