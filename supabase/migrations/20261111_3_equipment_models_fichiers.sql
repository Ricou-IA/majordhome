-- 20261111_3_equipment_models_fichiers.sql
-- Pièces détachées par modèle d'appareil — tranche 2 : photos, vues éclatées et documents du site du fabricant,
-- copiés dans notre Storage (bucket product-documents, `${orgId}/equipment-models/site/…`). Spec :
-- docs/superpowers/specs/2026-11-11-pieces-detachees-invicta-releve-nomenclature-design.md § 5.3, § 5.4.
--   1. equipment_documents : un document RELEVÉ est rattaché au modèle fabricant (equipment_model_id) et porte sa
--      provenance (`source` : identifiant du document sur le site) ; types `fiche_technique` et `procedure`.
--      Les documents déposés à la main (clé marque + modèle saisis) fonctionnent à l'identique.
--   2. Un fichier du site est stocké UNE fois par contenu (1 396 Mo de documents pour 477 Mo de contenus distincts
--      au relevé du 2026-11-11) : plusieurs lignes peuvent donc pointer le même objet Storage. Conséquence tenue
--      côté application : retirer un document relevé retire la LIGNE, jamais l'objet.
--   3. Vue par équipement : documents de la clé marque + modèle (dépôts manuels) UNION documents du modèle
--      fabricant auquel l'équipement est rattaché (relevés) — jamais les deux pour une même ligne.
--   4. Garde « même organisation » sur equipments.equipment_model_id (mineur reporté de la relecture de la tranche 1).
--   5. public.equipment_models_set_files : seul écrivain des fichiers d'un modèle (service_role).
-- Répétée sur scripts/migration-rehearsal/ (assert-equipment-models-fichiers.sql, après 20261111_1 et _2).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Documents rattachés au modèle fabricant
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.equipment_documents
  ADD COLUMN IF NOT EXISTS equipment_model_id uuid REFERENCES majordhome.equipment_models(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source jsonb;
COMMENT ON COLUMN majordhome.equipment_documents.equipment_model_id IS 'Modèle fabricant du document RELEVÉ sur le site du fabricant (NULL = document déposé à la main, partagé par la clé marque + modèle).';
COMMENT ON COLUMN majordhome.equipment_documents.source IS 'Provenance d''un document relevé : { site, id, fileKey, type, version }. Son objet Storage peut être partagé par plusieurs lignes : ne jamais le supprimer avec la ligne.';

ALTER TABLE majordhome.equipment_documents DROP CONSTRAINT IF EXISTS equipment_documents_document_type_check;
ALTER TABLE majordhome.equipment_documents ADD CONSTRAINT equipment_documents_document_type_check
  CHECK (document_type IN ('notice', 'vue_eclatee', 'fiche_technique', 'procedure', 'autre'));
COMMENT ON COLUMN majordhome.equipment_documents.document_type IS 'notice | vue_eclatee | fiche_technique | procedure | autre';

ALTER TABLE majordhome.equipment_documents DROP CONSTRAINT IF EXISTS equipment_documents_source_model;
ALTER TABLE majordhome.equipment_documents ADD CONSTRAINT equipment_documents_source_model
  CHECK ((source IS NULL) = (equipment_model_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS equipment_documents_model_source_unique
  ON majordhome.equipment_documents (equipment_model_id, (source ->> 'id')) WHERE equipment_model_id IS NOT NULL;

-- Le front n'écrit jamais un document relevé : les deux colonnes ne sont pas ouvertes à l'écriture par la vue miroir
-- (elles y sont en lecture, en fin de liste), et la policy d'insertion refuse une ligne rattachée à un modèle.
DROP POLICY IF EXISTS equipment_documents_insert_role_can ON majordhome.equipment_documents;
CREATE POLICY equipment_documents_insert_role_can ON majordhome.equipment_documents FOR INSERT
  WITH CHECK (majordhome.role_can(org_id, 'clients', 'edit') AND equipment_model_id IS NULL AND source IS NULL);
DROP POLICY IF EXISTS equipment_documents_update_role_can ON majordhome.equipment_documents;
CREATE POLICY equipment_documents_update_role_can ON majordhome.equipment_documents FOR UPDATE
  USING (majordhome.role_can(org_id, 'clients', 'edit') AND equipment_model_id IS NULL)
  WITH CHECK (majordhome.role_can(org_id, 'clients', 'edit') AND equipment_model_id IS NULL AND source IS NULL);

CREATE OR REPLACE VIEW public.majordhome_equipment_documents WITH (security_invoker = true) AS
  SELECT id, org_id, brand, model, brand_key, model_key, document_type, label, file_name, storage_path, file_size,
         mime_type, uploaded_by, created_at, equipment_model_id, source
  FROM majordhome.equipment_documents;
REVOKE ALL ON public.majordhome_equipment_documents FROM PUBLIC, anon;

-- Lecture par équipement. `from_site` = document relevé (objet Storage partagé, non supprimable avec la ligne).
CREATE OR REPLACE VIEW public.majordhome_equipment_model_documents WITH (security_invoker = true) AS
  SELECT e.id AS equipment_id, d.id, d.org_id, d.brand, d.model, d.document_type, d.label, d.file_name,
         d.storage_path, d.file_size, d.mime_type, d.uploaded_by, d.created_at,
         d.equipment_model_id, false AS from_site
  FROM majordhome.equipments e
  JOIN majordhome.equipment_documents d
    ON d.equipment_model_id IS NULL
   AND d.org_id = majordhome.project_org_id(e.project_id)
   AND d.brand_key = majordhome.equipment_model_key(e.brand)
   AND d.model_key = majordhome.equipment_model_key(e.model)
  UNION ALL
  SELECT e.id AS equipment_id, d.id, d.org_id, d.brand, d.model, d.document_type, d.label, d.file_name,
         d.storage_path, d.file_size, d.mime_type, d.uploaded_by, d.created_at,
         d.equipment_model_id, true AS from_site
  FROM majordhome.equipments e
  JOIN majordhome.equipment_documents d
    ON d.equipment_model_id = e.equipment_model_id
   AND d.org_id = majordhome.project_org_id(e.project_id);
REVOKE ALL ON public.majordhome_equipment_model_documents FROM PUBLIC, anon;
GRANT SELECT ON public.majordhome_equipment_model_documents TO authenticated, service_role;

-- Lecture par modèle fabricant (tranche 3 : bloc « Pièces détachées », fiche article).
CREATE OR REPLACE VIEW public.majordhome_equipment_model_files WITH (security_invoker = true) AS
  SELECT d.id, d.org_id, d.equipment_model_id, d.document_type, d.label, d.file_name, d.storage_path, d.file_size,
         d.mime_type, d.created_at
  FROM majordhome.equipment_documents d
  WHERE d.equipment_model_id IS NOT NULL;
REVOKE ALL ON public.majordhome_equipment_model_files FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_equipment_model_files TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Garde « même organisation » sur le rattachement d'un équipement à un modèle
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.equipments_check_model_org() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  IF NEW.equipment_model_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.equipment_model_id IS DISTINCT FROM OLD.equipment_model_id OR NEW.project_id IS DISTINCT FROM OLD.project_id)
     AND (SELECT em.org_id FROM majordhome.equipment_models em WHERE em.id = NEW.equipment_model_id)
           IS DISTINCT FROM majordhome.project_org_id(NEW.project_id) THEN
    RAISE EXCEPTION 'equipment_model_other_org' USING ERRCODE = '42501',
      HINT = 'Le modèle fabricant doit appartenir à la même organisation que l''équipement.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.equipments_check_model_org() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tr_equipments_check_model_org ON majordhome.equipments;
CREATE TRIGGER tr_equipments_check_model_org
  BEFORE INSERT OR UPDATE OF equipment_model_id, project_id ON majordhome.equipments
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipments_check_model_org();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Écrivain des fichiers d'un modèle
-- ---------------------------------------------------------------------------------------------------------------
-- p_files : [{ source_id, photo_path, exploded_views: [{ path, width, height }],
--              documents: [{ id, type, label, file_name, storage_path, file_size, mime_type, fileKey }] }]
-- Par modèle reçu : photo et vues éclatées posées si fournies (jamais vidées par une liste vide ou absente) ;
-- documents relevés REMPLACÉS par la liste quand la clé `documents` est un tableau (lignes seulement : les objets
-- Storage, partagés, restent) ; clé absente ou null = documents non touchés (copie incomplète pour ce modèle).
CREATE OR REPLACE FUNCTION public.equipment_models_set_files(
  p_org_id uuid,
  p_brand text,
  p_source_version text,
  p_files jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_bk text := majordhome.equipment_model_key(p_brand);
  v_prefix text := p_org_id::text || '/equipment-models/';
  v_ref text;
  v_models int := 0;
  v_docs int := 0;
  v_retires int := 0;
BEGIN
  IF p_org_id IS NULL OR v_bk IS NULL THEN
    RAISE EXCEPTION 'org_and_brand_required' USING ERRCODE = '22023';
  END IF;
  IF p_files IS NULL OR jsonb_typeof(p_files) <> 'array' OR jsonb_array_length(p_files) = 0 THEN
    RAISE EXCEPTION 'files_empty' USING ERRCODE = '22023';
  END IF;

  IF to_regclass('pg_temp.t_files') IS NOT NULL THEN DROP TABLE pg_temp.t_files; END IF;
  CREATE TEMP TABLE t_files ON COMMIT DROP AS
    SELECT f.source_id, f.photo_path,
           CASE WHEN jsonb_typeof(f.exploded_views) = 'array' THEN f.exploded_views ELSE '[]'::jsonb END AS exploded_views,
           CASE WHEN jsonb_typeof(f.documents) = 'array' THEN f.documents ELSE '[]'::jsonb END AS documents,
           COALESCE(jsonb_typeof(f.documents) = 'array', false) AS documents_fournis,
           NULL::uuid AS model_id
    FROM jsonb_to_recordset(p_files) AS f(source_id text, photo_path text, exploded_views jsonb, documents jsonb);
  CREATE INDEX ON t_files (source_id);
  ANALYZE t_files;
  IF (SELECT count(*) - count(DISTINCT source_id) FROM t_files) > 0 THEN
    RAISE EXCEPTION 'model_en_double' USING ERRCODE = '22023';
  END IF;

  UPDATE t_files f SET model_id = em.id
  FROM majordhome.equipment_models em
  WHERE em.org_id = p_org_id AND em.brand_key = v_bk AND em.source_id = f.source_id;
  SELECT f.source_id INTO v_ref FROM t_files f WHERE f.model_id IS NULL LIMIT 1;
  IF v_ref IS NOT NULL THEN
    RAISE EXCEPTION 'modele_introuvable: %', v_ref USING ERRCODE = '22023';
  END IF;

  IF to_regclass('pg_temp.t_docs') IS NOT NULL THEN DROP TABLE pg_temp.t_docs; END IF;
  CREATE TEMP TABLE t_docs ON COMMIT DROP AS
    SELECT f.model_id, d.id AS source_doc_id, d.type, d.label, d.file_name, d.storage_path, d.file_size, d.mime_type, d."fileKey" AS file_key
    FROM t_files f
    CROSS JOIN LATERAL jsonb_to_recordset(f.documents)
      AS d(id text, type text, label text, file_name text, storage_path text, file_size bigint, mime_type text, "fileKey" text);
  CREATE INDEX ON t_docs (model_id, source_doc_id);
  ANALYZE t_docs;

  -- Tout chemin écrit doit être sous le dossier de l'org (les colonnes texte de equipment_models n'ont pas de CHECK).
  SELECT x.p INTO v_ref FROM (
    SELECT photo_path AS p FROM t_files WHERE photo_path IS NOT NULL
    UNION ALL SELECT v ->> 'path' FROM t_files, jsonb_array_elements(exploded_views) v
    UNION ALL SELECT storage_path FROM t_docs
  ) x WHERE x.p IS NULL OR x.p NOT LIKE v_prefix || '%' LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'chemin_hors_org: %', COALESCE(v_ref, '(vide)') USING ERRCODE = '22023';
  END IF;
  SELECT source_doc_id INTO v_ref FROM t_docs
  WHERE COALESCE(source_doc_id, '') = '' OR COALESCE(file_name, '') = ''
     OR type IS NULL OR type NOT IN ('notice', 'vue_eclatee', 'fiche_technique', 'procedure', 'autre') LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'document_invalide: %', COALESCE(v_ref, '(sans identifiant)') USING ERRCODE = '22023';
  END IF;

  UPDATE majordhome.equipment_models em SET
    photo_path = COALESCE(f.photo_path, em.photo_path),
    exploded_views = CASE WHEN jsonb_array_length(f.exploded_views) > 0 THEN f.exploded_views ELSE em.exploded_views END,
    updated_at = now()
  FROM t_files f WHERE em.id = f.model_id;
  GET DIAGNOSTICS v_models = ROW_COUNT;

  DELETE FROM majordhome.equipment_documents d
  USING t_files f
  WHERE d.equipment_model_id = f.model_id AND f.documents_fournis
    AND NOT EXISTS (SELECT 1 FROM t_docs t WHERE t.model_id = f.model_id AND t.source_doc_id = d.source ->> 'id');
  GET DIAGNOSTICS v_retires = ROW_COUNT;

  INSERT INTO majordhome.equipment_documents
    (org_id, brand, model, document_type, label, file_name, storage_path, file_size, mime_type, equipment_model_id, source)
  SELECT p_org_id, em.brand, em.reference, t.type, NULLIF(btrim(t.label), ''), t.file_name, t.storage_path, t.file_size::integer, t.mime_type,
         em.id, jsonb_build_object('site', em.source ->> 'site', 'id', t.source_doc_id, 'fileKey', t.file_key, 'version', p_source_version)
  FROM t_docs t JOIN majordhome.equipment_models em ON em.id = t.model_id
  ON CONFLICT (equipment_model_id, (source ->> 'id')) WHERE equipment_model_id IS NOT NULL DO UPDATE SET
    document_type = EXCLUDED.document_type, label = EXCLUDED.label, file_name = EXCLUDED.file_name,
    storage_path = EXCLUDED.storage_path, file_size = EXCLUDED.file_size, mime_type = EXCLUDED.mime_type, source = EXCLUDED.source;
  GET DIAGNOSTICS v_docs = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'modeles', v_models, 'documents', v_docs, 'documents_retires', v_retires);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_models_set_files(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_models_set_files(uuid, text, text, jsonb) TO service_role;
COMMENT ON FUNCTION public.equipment_models_set_files(uuid, text, text, jsonb) IS
  'Seul écrivain des fichiers d''un modèle d''appareil (service_role) : photo et vues éclatées posées si fournies, documents relevés remplacés par la liste (lignes seulement — les objets Storage, partagés par contenu, restent). Refuse un chemin hors du dossier de l''org.';
