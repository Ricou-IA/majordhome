-- 20261112_8_referentiel_appareils_liens.sql — une fiche web garde les liens (photo, notice, fiche technique)
-- Décision d'Eric (2026-11-11) : un site qui refuse les téléchargements automatiques (jolly-mec.it coupe la connexion)
-- n'est pas contourné ; la fiche garde les liens trouvés, que la carte équipement propose d'ouvrir dans le navigateur.
-- Rangés dans equipment_models.source.liens = { photo: url, notice: { url, label }, fiche: { url, label } }.
-- Répétée sur scripts/migration-rehearsal/ (assert-referentiel-appareils-liens.sql).

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
                                           photo_path, origin, review_status, equipment_type_id, specs, source_urls, created_by, source)
  VALUES (p_org_id, v_brand, 'web:' || gen_random_uuid(), COALESCE(v_ref, v_model), v_brand || ' ' || v_model, v_model,
          NULLIF(btrim(p_fiche ->> 'category'), ''),
          CASE WHEN p_fiche ->> 'en_vente' = 'true' THEN 'en_vente' WHEN p_fiche ->> 'en_vente' = 'false' THEN 'arrete' END,
          NULLIF(p_files ->> 'photo_path', ''), 'web', 'a_controler', v_type,
          COALESCE(p_fiche -> 'specs', '{}'::jsonb), COALESCE(p_fiche -> 'source_urls', '[]'::jsonb), p_user_id,
          -- liens trouvés mais non copiés (site qui refuse les téléchargements automatiques) : ouverts dans le navigateur
          CASE WHEN jsonb_typeof(p_fiche -> 'liens') = 'object' THEN jsonb_build_object('liens', jsonb_strip_nulls(p_fiche -> 'liens')) ELSE '{}'::jsonb END)
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
