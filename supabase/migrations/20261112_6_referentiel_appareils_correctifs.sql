-- 20261112_6_referentiel_appareils_correctifs.sql — correctifs de la relecture finale (référentiel des appareils)
-- (1) equipment_models_set_files : le relevé ne retire que les documents RELEVÉS (source ? 'id') ; un document
--     web passé sur une fiche fabricant par equipment_model_merge n'a pas d'identifiant du site et était effacé.
-- (2) equipment_model_create_from_web : dédoublonnage aussi SANS référence fabricant (clé = référence, sinon nom du
--     modèle, comme la colonne reference stockée) et verrou transactionnel contre deux validations simultanées.
-- Répétée sur scripts/migration-rehearsal/ (assert-referentiel-appareils-correctifs.sql).

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
    AND d.source ? 'id'  -- document RELEVÉ seulement : un document web passé par une fusion n'a pas d'identifiant du site
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

CREATE OR REPLACE FUNCTION public.equipment_model_create_from_web(p_org_id uuid, p_user_id uuid, p_fiche jsonb, p_files jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_brand text;
  v_model text := NULLIF(btrim(p_fiche ->> 'model_name'), '');
  v_ref text := NULLIF(btrim(p_fiche ->> 'reference'), '');
  v_type uuid := NULLIF(p_fiche ->> 'equipment_type_id', '')::uuid;
  v_base text := p_org_id::text || '/equipment-models/web/';
  v_cle text;
  v_id uuid;
  v_doc jsonb;
  v_n int := 0;
BEGIN
  IF p_org_id IS NULL OR p_user_id IS NULL OR v_model IS NULL THEN RAISE EXCEPTION 'fiche_incomplete' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.organization_members om WHERE om.org_id = p_org_id AND om.user_id = p_user_id) THEN
    RAISE EXCEPTION 'not_member' USING ERRCODE = '42501';
  END IF;
  v_brand := majordhome.equipment_brand_ref_ensure(p_org_id, p_fiche ->> 'brand');
  IF v_brand IS NULL THEN RAISE EXCEPTION 'fiche_incomplete' USING ERRCODE = '22023'; END IF;

  -- même marque + même référence (sinon même nom de modèle, ce que porte la colonne reference d'une fiche sans
  -- référence) : la fiche existe déjà. Verrou par org + marque + clé : deux validations simultanées n'en créent qu'une.
  v_cle := majordhome.equipment_model_key(COALESCE(v_ref, v_model));
  IF v_cle IS NULL THEN RAISE EXCEPTION 'fiche_incomplete' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text || '|' || majordhome.equipment_model_key(v_brand) || '|' || v_cle));
  SELECT em.id INTO v_id FROM majordhome.equipment_models em
  WHERE em.org_id = p_org_id AND em.brand_key = majordhome.equipment_model_key(v_brand)
    AND em.reference_key = v_cle AND em.merged_into IS NULL AND em.is_active
  ORDER BY (em.origin = 'releve_fabricant') DESC, em.created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('model_id', v_id, 'created', false, 'existante', true); END IF;

  IF NULLIF(p_files ->> 'photo_path', '') IS NOT NULL AND ((p_files ->> 'photo_path') LIKE v_base || '%') IS NOT TRUE THEN
    RAISE EXCEPTION 'chemin_hors_org' USING ERRCODE = '22023';
  END IF;
  FOR v_doc IN SELECT * FROM jsonb_array_elements(COALESCE(p_files -> 'documents', '[]'::jsonb)) LOOP
    IF ((v_doc ->> 'storage_path') LIKE v_base || '%') IS NOT TRUE THEN RAISE EXCEPTION 'chemin_hors_org' USING ERRCODE = '22023'; END IF;
    IF ((v_doc ->> 'document_type') IN ('notice', 'fiche_technique')) IS NOT TRUE THEN RAISE EXCEPTION 'document_invalide' USING ERRCODE = '22023'; END IF;
  END LOOP;

  INSERT INTO majordhome.equipment_models (org_id, brand, source_id, reference, name, model_name, category, lifecycle,
                                           photo_path, origin, review_status, equipment_type_id, specs, source_urls, created_by)
  VALUES (p_org_id, v_brand, 'web:' || gen_random_uuid(), COALESCE(v_ref, v_model), v_brand || ' ' || v_model, v_model,
          NULLIF(btrim(p_fiche ->> 'category'), ''),
          CASE WHEN p_fiche ->> 'en_vente' = 'true' THEN 'en_vente' WHEN p_fiche ->> 'en_vente' = 'false' THEN 'arrete' END,
          NULLIF(p_files ->> 'photo_path', ''), 'web', 'a_controler', v_type,
          COALESCE(p_fiche -> 'specs', '{}'::jsonb), COALESCE(p_fiche -> 'source_urls', '[]'::jsonb), p_user_id)
  RETURNING id INTO v_id;

  FOR v_doc IN SELECT * FROM jsonb_array_elements(COALESCE(p_files -> 'documents', '[]'::jsonb)) LOOP
    INSERT INTO majordhome.equipment_documents (org_id, brand, model, document_type, label, file_name, storage_path,
                                                file_size, mime_type, uploaded_by, equipment_model_id, source)
    VALUES (p_org_id, v_brand, v_model, v_doc ->> 'document_type', NULLIF(v_doc ->> 'label', ''),
            COALESCE(NULLIF(v_doc ->> 'file_name', ''), 'document.pdf'), v_doc ->> 'storage_path',
            NULLIF(v_doc ->> 'file_size', '')::bigint, 'application/pdf', p_user_id, v_id,
            jsonb_build_object('origine', 'web', 'url', v_doc ->> 'url'));
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('model_id', v_id, 'created', true, 'existante', false, 'documents', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_model_create_from_web(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_model_create_from_web(uuid, uuid, jsonb, jsonb) TO service_role;
