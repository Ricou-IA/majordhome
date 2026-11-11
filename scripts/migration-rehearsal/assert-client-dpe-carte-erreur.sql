-- assert-client-dpe-carte-erreur.sql — vérifie 20261112_3_client_dpe_carte_erreur.sql (après 20261112_2).
-- Couvre : colonne carte_erreur (table + vue, en fin) ; `actualiser` en échec garde le numéro, vide la carte et
-- enregistre le code ; une lecture réussie efface le code ; `detacher` refusé quand le numéro de la fiche n'est pas
-- celui de la ligne (sinon un numéro tapé était effacé en silence).
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_client uuid;
  v_r jsonb;
  v_fiche text;
  v_last text;
  ok boolean;
  carte jsonb := '{"carte": {"dpeLabel": "A"}, "version_carte": 1, "etiquette_dpe": "A", "rapport_complet": true}';
BEGIN
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_client_dpe' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'carte_erreur' THEN RAISE EXCEPTION 'carte_erreur absente ou pas en fin de vue (dernière : %)', v_last; END IF;

  SELECT id INTO v_client FROM majordhome.clients WHERE org_id = v_mayer AND dpe_number IS NULL LIMIT 1;
  DELETE FROM majordhome.client_dpe WHERE client_id = v_client;

  -- (1) numéro tapé, corpus refuse : la ligne porte le numéro, pas de carte, le code
  v_r := public.client_dpe_record(v_mayer, v_client, 'actualiser',
    '{"dpe_number": "2131E0000001A", "origine": "saisi", "carte_erreur": "numero_absent"}', NULL);
  SELECT dpe_number INTO v_fiche FROM majordhome.clients WHERE id = v_client;
  IF v_r->>'dpe_number' <> '2131E0000001A' OR v_r->>'carte_erreur' <> 'numero_absent' OR v_r->'carte' <> 'null'::jsonb AND v_r->'carte' IS NOT NULL
     OR v_r->>'etat' <> 'rattache' OR v_fiche <> '2131E0000001A' OR v_r->>'tente_le' IS NULL THEN
    RAISE EXCEPTION 'échec de lecture mal enregistré : % / fiche %', v_r, v_fiche;
  END IF;

  -- (2) relecture réussie : le code s'efface
  v_r := public.client_dpe_record(v_mayer, v_client, 'actualiser', '{"dpe_number": "2131E0000001A", "origine": "saisi"}'::jsonb || carte, NULL);
  IF v_r->>'carte_erreur' IS NOT NULL OR v_r->'carte' IS NULL THEN RAISE EXCEPTION 'code non effacé : %', v_r; END IF;

  -- (3) la fiche porte un autre numéro (saisi, pas encore relu) : detacher refusé, rien n'est effacé
  UPDATE majordhome.clients SET dpe_number = '2481E2082752C' WHERE id = v_client;
  ok := false;
  BEGIN
    PERFORM public.client_dpe_record(v_mayer, v_client, 'detacher', '{}', NULL);
  EXCEPTION WHEN OTHERS THEN ok := (SQLERRM = 'client_dpe_desynchronise');
  END;
  SELECT dpe_number INTO v_fiche FROM majordhome.clients WHERE id = v_client;
  IF NOT ok OR v_fiche <> '2481E2082752C' THEN RAISE EXCEPTION 'detacher désynchronisé accepté (fiche %)', v_fiche; END IF;

  -- (4) numéros alignés : detacher passe
  UPDATE majordhome.clients SET dpe_number = '2131E0000001A' WHERE id = v_client;
  v_r := public.client_dpe_record(v_mayer, v_client, 'detacher', '{}', NULL);
  IF v_r->>'etat' <> 'detache' THEN RAISE EXCEPTION 'detacher aligné refusé : %', v_r; END IF;

  DELETE FROM majordhome.client_dpe WHERE client_id = v_client;
  UPDATE majordhome.clients SET dpe_number = NULL WHERE id = v_client;
  RAISE NOTICE 'assert-client-dpe-carte-erreur : OK';
END $$;
