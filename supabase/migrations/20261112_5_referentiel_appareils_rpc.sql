-- 20261112_5_referentiel_appareils_rpc.sql — créer, contrôler, fusionner les fiches d'appareil ; plafond de recherches
-- Spec : docs/superpowers/specs/2026-11-11-referentiel-appareils-installes-saisie-terrain-design.md § 4-6.
-- Plan : docs/superpowers/plans/2026-11-11-referentiel-appareils-installes-saisie-terrain.md, tâche 4.
-- Répétée sur scripts/migration-rehearsal/ (assert-referentiel-appareils-rpc.sql), après 20261112_4.

-- ---------------------------------------------------------------------------------------------------------------
-- Garde org_admin (vrai seulement si l'utilisateur connecté est org_admin de l'org ; NULL ⇒ faux)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.equipment_models_is_admin(p_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = majordhome, public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.org_id = p_org_id AND om.user_id = auth.uid() AND om.role = 'org_admin');
$$;
REVOKE EXECUTE ON FUNCTION majordhome.equipment_models_is_admin(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Fiche depuis un article du catalogue (saisie terrain, droit clients.edit)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equipment_model_create_from_catalog(p_catalog_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_item record;
  v_id uuid;
  v_brand text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT ci.id, ci.org_id, ci.name, ci.code, ci.brand, ci.specs, ci.merged_into INTO v_item
  FROM majordhome.catalog_items ci WHERE ci.id = p_catalog_item_id;
  IF v_item.id IS NULL OR v_item.merged_into IS NOT NULL THEN RAISE EXCEPTION 'article_introuvable' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.role_can(v_item.org_id, 'clients', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'clients_edit_required' USING ERRCODE = '42501';
  END IF;

  SELECT em.id INTO v_id FROM majordhome.equipment_models em
  WHERE em.org_id = v_item.org_id AND em.catalog_item_id = v_item.id AND em.merged_into IS NULL
  ORDER BY em.created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('model_id', v_id, 'created', false); END IF;

  v_brand := majordhome.equipment_brand_ref_ensure(v_item.org_id, v_item.brand);
  IF v_brand IS NULL THEN RAISE EXCEPTION 'article_sans_marque' USING ERRCODE = '22023'; END IF;
  INSERT INTO majordhome.equipment_models (org_id, brand, source_id, reference, name, model_name, origin, review_status,
                                           catalog_item_id, specs, created_by, lifecycle)
  VALUES (v_item.org_id, v_brand, 'catalogue:' || v_item.id, COALESCE(NULLIF(btrim(v_item.code), ''), v_item.name), v_item.name,
          v_item.name, 'catalogue', 'controle', v_item.id, COALESCE(v_item.specs -> 'canonical', '{}'::jsonb), auth.uid(), 'en_vente')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('model_id', v_id, 'created', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_model_create_from_catalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_model_create_from_catalog(uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Fiche depuis la recherche web (edge equipment-model-enrich, service_role SEUL : org_id dans le payload)
-- ---------------------------------------------------------------------------------------------------------------
-- p_fiche : { brand, model_name, reference, category, en_vente, equipment_type_id, specs, source_urls }
-- p_files : { photo_path, documents: [{ storage_path, document_type, label, file_name, file_size, url }] }
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

  -- même marque + même référence fabricant : la fiche existe déjà, on la renvoie sans rien écrire
  IF v_ref IS NOT NULL THEN
    SELECT em.id INTO v_id FROM majordhome.equipment_models em
    WHERE em.org_id = p_org_id AND em.brand_key = majordhome.equipment_model_key(v_brand)
      AND em.reference_key = majordhome.equipment_model_key(v_ref) AND em.merged_into IS NULL AND em.is_active
    ORDER BY (em.origin = 'releve_fabricant') DESC, em.created_at LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('model_id', v_id, 'created', false, 'existante', true); END IF;
  END IF;

  IF NULLIF(p_files ->> 'photo_path', '') IS NOT NULL AND (p_files ->> 'photo_path') NOT LIKE v_base || '%' THEN
    RAISE EXCEPTION 'chemin_hors_org' USING ERRCODE = '22023';
  END IF;
  FOR v_doc IN SELECT * FROM jsonb_array_elements(COALESCE(p_files -> 'documents', '[]'::jsonb)) LOOP
    IF COALESCE(v_doc ->> 'storage_path', '') NOT LIKE v_base || '%' THEN RAISE EXCEPTION 'chemin_hors_org' USING ERRCODE = '22023'; END IF;
    IF (v_doc ->> 'document_type') NOT IN ('notice', 'fiche_technique') THEN RAISE EXCEPTION 'document_invalide' USING ERRCODE = '22023'; END IF;
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

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Contrôle : valider (patch vide) ou corriger puis valider — org_admin
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equipment_model_review(p_model_id uuid, p_patch jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_m record;
  v_p jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_brand text;
  v_retires int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT em.* INTO v_m FROM majordhome.equipment_models em WHERE em.id = p_model_id;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'fiche_introuvable' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.equipment_models_is_admin(v_m.org_id) IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;
  IF v_m.origin = 'releve_fabricant' THEN RAISE EXCEPTION 'fiche_fabricant' USING ERRCODE = '22023'; END IF;
  IF v_m.merged_into IS NOT NULL THEN RAISE EXCEPTION 'fiche_fusionnee' USING ERRCODE = '22023'; END IF;

  IF v_p ? 'brand' THEN
    v_brand := majordhome.equipment_brand_ref_ensure(v_m.org_id, v_p ->> 'brand');
    IF v_brand IS NULL THEN RAISE EXCEPTION 'marque_vide' USING ERRCODE = '22023'; END IF;
  END IF;

  UPDATE majordhome.equipment_models em SET
    brand = COALESCE(v_brand, em.brand),
    model_name = CASE WHEN v_p ? 'model_name' AND NULLIF(btrim(v_p ->> 'model_name'), '') IS NOT NULL THEN btrim(v_p ->> 'model_name') ELSE em.model_name END,
    name = CASE WHEN v_p ? 'name' AND NULLIF(btrim(v_p ->> 'name'), '') IS NOT NULL THEN btrim(v_p ->> 'name') ELSE em.name END,
    reference = CASE WHEN v_p ? 'reference' AND NULLIF(btrim(v_p ->> 'reference'), '') IS NOT NULL THEN btrim(v_p ->> 'reference') ELSE em.reference END,
    equipment_type_id = CASE WHEN v_p ? 'equipment_type_id' THEN NULLIF(v_p ->> 'equipment_type_id', '')::uuid ELSE em.equipment_type_id END,
    catalog_item_id = CASE WHEN v_p ? 'catalog_item_id' THEN NULLIF(v_p ->> 'catalog_item_id', '')::uuid ELSE em.catalog_item_id END,
    specs = CASE WHEN jsonb_typeof(v_p -> 'specs') = 'object' THEN v_p -> 'specs' ELSE em.specs END,
    photo_path = CASE WHEN (v_p ->> 'retirer_photo') = 'true' THEN NULL ELSE em.photo_path END,
    review_status = 'controle', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE em.id = p_model_id;

  IF jsonb_typeof(v_p -> 'documents_retires') = 'array' THEN
    DELETE FROM majordhome.equipment_documents d
    WHERE d.equipment_model_id = p_model_id
      AND d.id IN (SELECT (x ->> 0)::uuid FROM jsonb_array_elements(v_p -> 'documents_retires') x);
    GET DIAGNOSTICS v_retires = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('ok', true, 'documents_retires', v_retires);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_model_review(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_model_review(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Fusion : la fiche absorbée passe ses équipements et ses documents à la fiche gardée — org_admin
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equipment_model_merge(p_absorbed_id uuid, p_survivor_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_a record;
  v_s record;
  v_eq int := 0;
  v_docs int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_absorbed_id IS NULL OR p_survivor_id IS NULL OR p_absorbed_id = p_survivor_id THEN
    RAISE EXCEPTION 'fusion_invalide' USING ERRCODE = '22023';
  END IF;
  SELECT em.* INTO v_a FROM majordhome.equipment_models em WHERE em.id = p_absorbed_id FOR UPDATE;
  SELECT em.* INTO v_s FROM majordhome.equipment_models em WHERE em.id = p_survivor_id FOR UPDATE;
  IF v_a.id IS NULL OR v_s.id IS NULL OR v_a.org_id <> v_s.org_id THEN RAISE EXCEPTION 'fiche_introuvable' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.equipment_models_is_admin(v_a.org_id) IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;
  IF v_a.merged_into IS NOT NULL OR v_s.merged_into IS NOT NULL THEN RAISE EXCEPTION 'fiche_fusionnee' USING ERRCODE = '22023'; END IF;
  IF v_a.origin = 'releve_fabricant' THEN RAISE EXCEPTION 'fiche_fabricant_survit' USING ERRCODE = '22023'; END IF;

  UPDATE majordhome.equipments e SET equipment_model_id = p_survivor_id WHERE e.equipment_model_id = p_absorbed_id;
  GET DIAGNOSTICS v_eq = ROW_COUNT;

  DELETE FROM majordhome.equipment_documents d
  WHERE d.equipment_model_id = p_absorbed_id
    AND EXISTS (SELECT 1 FROM majordhome.equipment_documents s WHERE s.equipment_model_id = p_survivor_id AND s.storage_path = d.storage_path);
  UPDATE majordhome.equipment_documents d SET equipment_model_id = p_survivor_id, brand = v_s.brand, model = v_s.model_name
  WHERE d.equipment_model_id = p_absorbed_id;
  GET DIAGNOSTICS v_docs = ROW_COUNT;

  UPDATE majordhome.equipment_models em SET merged_into = p_survivor_id, is_active = false, review_status = 'controle',
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE em.id = p_absorbed_id;
  RETURN jsonb_build_object('ok', true, 'equipements', v_eq, 'documents', v_docs);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_model_merge(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_model_merge(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Plafond de recherches web par utilisateur et par jour (modèle : increment_voice_quota)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.equipment_enrich_quotas (
  user_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  count int NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id, date)
);
ALTER TABLE majordhome.equipment_enrich_quotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON majordhome.equipment_enrich_quotas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.equipment_enrich_quotas TO service_role;

CREATE OR REPLACE FUNCTION public.increment_equipment_enrich_quota(p_user_id uuid, p_org_id uuid, p_daily_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_count int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_user_id IS NULL OR p_org_id IS NULL THEN RAISE EXCEPTION 'user_and_org_required' USING ERRCODE = '22023'; END IF;
  INSERT INTO majordhome.equipment_enrich_quotas (user_id, org_id, date, count, last_at)
  VALUES (p_user_id, p_org_id, v_today, 1, now())
  ON CONFLICT (user_id, org_id, date) DO UPDATE SET count = majordhome.equipment_enrich_quotas.count + 1, last_at = now()
  RETURNING count INTO v_count;
  IF v_count > p_daily_limit THEN
    RAISE EXCEPTION 'equipment_enrich_quota_exceeded' USING ERRCODE = 'P0001', HINT = 'equipment_enrich_quota_exceeded';
  END IF;
  RETURN jsonb_build_object('count', v_count, 'limit', p_daily_limit, 'date', v_today);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.increment_equipment_enrich_quota(uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_equipment_enrich_quota(uuid, uuid, int) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. File de contrôle (lecture)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_equipment_models_a_controler WITH (security_invoker = true) AS
  SELECT em.id, em.org_id, em.brand, em.reference, em.name, em.model_name, em.category, em.lifecycle, em.photo_path,
         em.origin, em.review_status, em.catalog_item_id, em.equipment_type_id, em.specs, em.source_urls,
         em.created_by, em.created_at,
         (SELECT p.full_name FROM core.profiles p WHERE p.id = em.created_by) AS created_by_name,
         (SELECT count(*) FROM majordhome.equipments e WHERE e.equipment_model_id = em.id) AS nb_equipements,
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('client_id', x.id, 'client_number', x.client_number, 'display_name', x.display_name)), '[]'::jsonb)
            FROM (SELECT DISTINCT c.id, c.client_number, c.display_name
                  FROM majordhome.equipments e JOIN majordhome.clients c ON c.project_id = e.project_id
                  WHERE e.equipment_model_id = em.id ORDER BY c.client_number LIMIT 10) x) AS clients
  FROM majordhome.equipment_models em
  WHERE em.review_status = 'a_controler' AND em.merged_into IS NULL;
REVOKE ALL ON public.majordhome_equipment_models_a_controler FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_equipment_models_a_controler TO authenticated, service_role;
