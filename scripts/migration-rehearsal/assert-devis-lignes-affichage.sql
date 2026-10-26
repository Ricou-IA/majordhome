-- assert-devis-lignes-affichage.sql — vérifie 20261028_1_devis_lignes_affichage.sql (après 20261027_8).
-- Couvre : hide_prices / show_specs (boolean NOT NULL défaut false) et caracteristiques (text[] NOT NULL défaut '{}') sur
-- majordhome.quote_lines ; les trois EN FIN des deux vues, après discount_percent ; vue d'écriture toujours insérable ;
-- aller-retour d'un INSERT via la vue d'écriture (valeurs explicites puis défauts). Fixture nettoyée.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_quote uuid; v_l1 uuid; v_l2 uuid; v_cols text[]; r record;
BEGIN
  -- (1) structure de la table : types, NOT NULL, défauts
  FOR r IN SELECT * FROM (VALUES ('hide_prices','boolean','false'), ('show_specs','boolean','false'), ('caracteristiques','ARRAY','''{}''::text[]')) AS t(c, ty, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'majordhome' AND table_name = 'quote_lines' AND column_name = r.c
                     AND data_type = r.ty AND is_nullable = 'NO' AND column_default = r.def) THEN
      RAISE EXCEPTION 'colonne % absente ou mal définie (type %, NOT NULL, défaut %)', r.c, r.ty, r.def;
    END IF;
  END LOOP;

  -- (2) les trois colonnes sont les trois dernières des deux vues, dans l'ordre, après discount_percent
  FOR r IN SELECT * FROM (VALUES ('majordhome_quote_lines'), ('majordhome_quote_lines_write')) AS t(v) LOOP
    SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO v_cols
    FROM (SELECT column_name, ordinal_position FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = r.v ORDER BY ordinal_position DESC LIMIT 4) x;
    IF v_cols <> ARRAY['discount_percent','hide_prices','show_specs','caracteristiques'] THEN
      RAISE EXCEPTION '% : fin de liste inattendue %', r.v, v_cols;
    END IF;
  END LOOP;
  IF (SELECT is_insertable_into FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_quote_lines_write') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_quote_lines_write n''est plus insérable';
  END IF;

  -- (3) aller-retour : INSERT par la vue d'écriture, valeurs explicites puis défauts
  INSERT INTO majordhome.quotes (org_id, quote_number) VALUES (v_mayer, 'TEST-LIGNES-AFF') RETURNING id INTO v_quote;
  INSERT INTO public.majordhome_quote_lines_write (quote_id, designation, hide_prices, show_specs, caracteristiques)
  VALUES (v_quote, 'TEST ligne caracs', true, true, ARRAY['Puissance : 8 kW', 'Classe : A+++']) RETURNING id INTO v_l1;
  INSERT INTO public.majordhome_quote_lines_write (quote_id, designation) VALUES (v_quote, 'TEST ligne défauts') RETURNING id INTO v_l2;

  SELECT hide_prices, show_specs, caracteristiques INTO r FROM public.majordhome_quote_lines WHERE id = v_l1;
  IF r.hide_prices IS NOT TRUE OR r.show_specs IS NOT TRUE OR r.caracteristiques IS DISTINCT FROM ARRAY['Puissance : 8 kW', 'Classe : A+++'] THEN
    RAISE EXCEPTION 'aller-retour des valeurs explicites incorrect : %', r;
  END IF;
  SELECT hide_prices, show_specs, caracteristiques INTO r FROM public.majordhome_quote_lines_write WHERE id = v_l2;
  IF r.hide_prices IS NOT FALSE OR r.show_specs IS NOT FALSE OR r.caracteristiques IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION 'défauts incorrects : %', r;
  END IF;
  UPDATE public.majordhome_quote_lines_write SET caracteristiques = ARRAY['Modifié'] WHERE id = v_l2;
  IF (SELECT caracteristiques FROM public.majordhome_quote_lines WHERE id = v_l2) IS DISTINCT FROM ARRAY['Modifié'] THEN
    RAISE EXCEPTION 'UPDATE de caracteristiques via la vue d''écriture sans effet';
  END IF;

  -- nettoyage (cascade sur les lignes)
  DELETE FROM majordhome.quotes WHERE id = v_quote;
  IF EXISTS (SELECT 1 FROM majordhome.quote_lines WHERE id IN (v_l1, v_l2)) THEN RAISE EXCEPTION 'fixture non nettoyée'; END IF;

  RAISE NOTICE 'assert-devis-lignes-affichage : OK';
END $$;
