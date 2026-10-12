-- assert-lead-search.sql — vérifie 20261012_4_lead_search.sql sur le cluster de répétition.
-- À rejouer APRÈS 20261012_3 (lead_search_for_attach) et avec assert-lead-search-attach.sql,
-- qui prouve que la tokenisation déléguée n'a pas changé le comportement de la modale.
-- leads est photographiée sans données : on pose les cartes du scénario (ROZIÈRES, incident
-- 2026-10-12) puis on interroge la RPC comme EventModal / le filet anti-doublon.

-- ── A. Structure / ACL ──────────────────────────────────────────────────────
DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.lead_search(uuid, text, uuid[], integer)',
    'majordhome.lead_search_tokens(text)',
    'public.lead_search_for_attach(uuid, text, uuid, integer)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% exécutable par anon', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% non exécutable par authenticated', v_fn;
    END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION '% doit rester SECURITY INVOKER (RLS leads)', v_fn;
    END IF;
  END LOOP;
  -- La tokenisation n'existe qu'une fois : lead_search_for_attach appelle le helper.
  IF pg_get_functiondef('public.lead_search_for_attach(uuid, text, uuid, integer)'::regprocedure) NOT LIKE '%majordhome.lead_search_tokens(%' THEN
    RAISE EXCEPTION 'lead_search_for_attach doit déléguer à majordhome.lead_search_tokens';
  END IF;
  IF pg_get_functiondef('public.lead_search_for_attach(uuid, text, uuid, integer)'::regprocedure) LIKE '%regexp_split_to_array%' THEN
    RAISE EXCEPTION 'lead_search_for_attach recopie encore la tokenisation';
  END IF;
END $$;

-- ── B. Tokenisation ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF majordhome.lead_search_tokens('  FRANÇOIS  Rozières ') <> ARRAY['francois', 'rozieres'] THEN
    RAISE EXCEPTION 'tokens attendus {francois,rozieres}, obtenu %', majordhome.lead_search_tokens('  FRANÇOIS  Rozières ');
  END IF;
  IF majordhome.lead_search_tokens('a') <> '{}'::text[] OR majordhome.lead_search_tokens(NULL) <> '{}'::text[] THEN
    RAISE EXCEPTION 'un token d''1 caractère ou une saisie NULL doivent donner un tableau vide';
  END IF;
  IF majordhome.lead_search_tokens('a_b%') <> ARRAY['a\_b\%'] THEN
    RAISE EXCEPTION '%% et _ doivent être échappés, obtenu %', majordhome.lead_search_tokens('a_b%');
  END IF;
END $$;

-- ── C. Comportement de lead_search ──────────────────────────────────────────
DO $$
DECLARE
  -- Org dédiée : assert-lead-search-attach.sql, joué avant dans le même cluster, laisse
  -- 25 homonymes récents dans la 1ʳᵉ org — ils évinceraient GAUTIER sous le plafond 10.
  v_org uuid := gen_random_uuid(); v_other_org uuid := gen_random_uuid();
  v_rdv uuid; v_nouveau uuid;
  v_rozieres uuid; v_gautier uuid; v_coeur uuid;
  v_row record; v_n int; v_ids uuid[];
BEGIN
  INSERT INTO core.organizations (id, name) VALUES (v_org, 'Org lead_search (test)');
  SELECT id INTO v_rdv FROM majordhome.statuses WHERE label = 'RDV planifié' LIMIT 1;
  SELECT id INTO v_nouveau FROM majordhome.statuses WHERE label = 'Nouveau' LIMIT 1;
  IF v_rdv IS NULL OR v_nouveau IS NULL THEN RAISE EXCEPTION 'statuts « RDV planifié » / « Nouveau » absents du snapshot'; END IF;

  -- La carte de l'incident : stockée AVEC accents, téléphone espacé, ville accentuée.
  INSERT INTO majordhome.leads (org_id, first_name, last_name, email, phone, city, status_id, is_deleted, created_at)
  VALUES (v_org, 'FRANÇOIS', 'ROZIÈRES', 'f.rozieres@example.org', '06 10 36 56 72', 'Lisle-sur-Tarn', v_rdv, false, now() - interval '20 days')
  RETURNING id INTO v_rozieres;
  -- Homonyme de prénom, sans cédille, statut Nouveau.
  INSERT INTO majordhome.leads (org_id, first_name, last_name, city, status_id, is_deleted, created_at)
  VALUES (v_org, 'FRANCOIS', 'GAUTIER', 'Albi', v_nouveau, false, now() - interval '1 day')
  RETURNING id INTO v_gautier;
  -- Ligature : unaccent ramène Œ → OE.
  INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted)
  VALUES (v_org, 'Jean', 'LŒUILLET', false) RETURNING id INTO v_coeur;
  -- Supprimé : jamais proposé.
  INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted) VALUES (v_org, 'FRANÇOIS', 'ROZIÈRES', true);
  -- Autre org : invisible même avec le bon nom.
  INSERT INTO core.organizations (id, name) VALUES (v_other_org, 'Autre org (test)');
  INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted) VALUES (v_other_org, 'FRANÇOIS', 'ROZIÈRES', false);

  -- 1. Saisie sans accent → carte accentuée trouvée, avec les colonnes qu'EventModal consomme.
  SELECT * INTO v_row FROM public.lead_search(v_org, 'rozieres', NULL, 10);
  IF v_row.id IS DISTINCT FROM v_rozieres THEN
    RAISE EXCEPTION '« rozieres » doit trouver ROZIÈRES, obtenu %', v_row.id;
  END IF;
  IF v_row.status_label <> 'RDV planifié' OR v_row.status_color IS NULL OR v_row.phone <> '06 10 36 56 72'
     OR v_row.email <> 'f.rozieres@example.org' OR v_row.city <> 'Lisle-sur-Tarn' THEN
    RAISE EXCEPTION 'ligne ROZIÈRES incomplète : statut=% couleur=% tel=% email=% ville=%',
      v_row.status_label, v_row.status_color, v_row.phone, v_row.email, v_row.city;
  END IF;
  -- Et l'inverse : saisie accentuée, carte sans accent.
  IF NOT EXISTS (SELECT 1 FROM public.lead_search(v_org, 'François', NULL, 10) WHERE id = v_gautier) THEN
    RAISE EXCEPTION '« François » ne trouve pas FRANCOIS GAUTIER';
  END IF;

  -- 2. Plusieurs mots : TOUS requis (chaque mot affine) — « francois rozieres » ne ramène
  --    que ROZIÈRES, pas les autres FRANCOIS.
  SELECT array_agg(id) INTO v_ids FROM public.lead_search(v_org, 'francois rozieres', NULL, 10);
  IF v_ids IS DISTINCT FROM ARRAY[v_rozieres] THEN
    RAISE EXCEPTION '« francois rozieres » doit ne ramener que ROZIÈRES, obtenu %', v_ids;
  END IF;
  -- Prénom + nom dans l'ordre inverse : trouvé aussi (axe nom du filet anti-doublon).
  IF NOT EXISTS (SELECT 1 FROM public.lead_search(v_org, 'ROZIERES FRANCOIS', NULL, 10) WHERE id = v_rozieres) THEN
    RAISE EXCEPTION '« ROZIERES FRANCOIS » ne trouve pas ROZIÈRES';
  END IF;
  -- Un mot qui n'y est pas : rien (pas de OR silencieux).
  IF (SELECT count(*) FROM public.lead_search(v_org, 'francois rozieres gautier', NULL, 10)) <> 0 THEN
    RAISE EXCEPTION 'un token non matché doit exclure la carte';
  END IF;

  -- 3. Email, ville, téléphone avec ou sans espaces.
  IF NOT EXISTS (SELECT 1 FROM public.lead_search(v_org, 'rozieres@example', NULL, 10) WHERE id = v_rozieres) THEN
    RAISE EXCEPTION 'recherche par email KO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_search(v_org, 'lisle sur tarn', NULL, 10) WHERE id = v_rozieres) THEN
    RAISE EXCEPTION 'recherche par ville (mots séparés) KO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_search(v_org, '06 10 36 56', NULL, 10) WHERE id = v_rozieres) THEN
    RAISE EXCEPTION 'recherche par téléphone espacé KO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_search(v_org, '0610365672', NULL, 10) WHERE id = v_rozieres) THEN
    RAISE EXCEPTION 'recherche par téléphone sans espaces KO (chiffres seuls)';
  END IF;
  -- Ligature.
  IF NOT EXISTS (SELECT 1 FROM public.lead_search(v_org, 'loeuillet', NULL, 10) WHERE id = v_coeur) THEN
    RAISE EXCEPTION '« loeuillet » ne trouve pas LŒUILLET';
  END IF;

  -- 4. Filtre statuts (RDV Bouclage : cartes bouclables uniquement).
  SELECT array_agg(id) INTO v_ids FROM public.lead_search(v_org, 'francois', ARRAY[v_rdv], 10);
  IF v_ids IS DISTINCT FROM ARRAY[v_rozieres] THEN
    RAISE EXCEPTION 'filtre statut RDV planifié : attendu ROZIÈRES seul, obtenu %', v_ids;
  END IF;
  IF (SELECT count(*) FROM public.lead_search(v_org, 'francois', ARRAY[v_rdv, v_nouveau], 10)) <> 2 THEN
    RAISE EXCEPTION 'filtre statuts {RDV planifié, Nouveau} : 2 cartes attendues';
  END IF;
  IF (SELECT count(*) FROM public.lead_search(v_org, 'francois', '{}'::uuid[], 10)) <> 0 THEN
    RAISE EXCEPTION 'un tableau de statuts vide ne doit rien ramener (≠ NULL = pas de filtre)';
  END IF;

  -- 5. Hygiène : supprimé et autre org absents ; saisie vide / 1 caractère / `%` → rien ;
  --    plafond respecté.
  IF (SELECT count(*) FROM public.lead_search(v_org, 'ROZIERES', NULL, 50)) <> 1 THEN
    RAISE EXCEPTION 'ROZIÈRES supprimé ou d''une autre org remonté';
  END IF;
  IF (SELECT count(*) FROM public.lead_search(v_org, '', NULL, 10)) <> 0
     OR (SELECT count(*) FROM public.lead_search(v_org, NULL, NULL, 10)) <> 0
     OR (SELECT count(*) FROM public.lead_search(v_org, 'a', NULL, 10)) <> 0
     OR (SELECT count(*) FROM public.lead_search(v_org, '%%', NULL, 10)) <> 0 THEN
    RAISE EXCEPTION 'saisie vide, NULL, d''1 caractère ou « %% » ne doivent rien ramener';
  END IF;
  FOR v_n IN 1..12 LOOP
    INSERT INTO majordhome.leads (org_id, first_name, last_name, is_deleted, created_at)
    VALUES (v_org, 'FRANCOIS', 'HOMONYME' || v_n, false, now() - (v_n || ' minutes')::interval);
  END LOOP;
  IF (SELECT count(*) FROM public.lead_search(v_org, 'francois', NULL, 10)) <> 10 THEN
    RAISE EXCEPTION 'plafond 10 attendu';
  END IF;

  RAISE NOTICE 'assert-lead-search OK (ROZIÈRES trouvé sans accent, tous tokens requis, statuts filtrés)';
END $$;
