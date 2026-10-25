-- assert-remise-ligne-devis.sql — vérifie 20261027_8_remise_ligne_devis.sql.
-- Couvre : colonne discount_percent (défaut 0, bornée 0..100) en DERNIÈRE colonne des deux vues ; la vue d'écriture
-- reste insérable.
DO $$
DECLARE v_p record; ok boolean;
BEGIN
  SELECT column_name INTO v_p FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_quote_lines' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_p.column_name <> 'discount_percent' THEN RAISE EXCEPTION 'discount_percent n''est pas la dernière colonne de majordhome_quote_lines (%)', v_p.column_name; END IF;
  SELECT column_name INTO v_p FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_quote_lines_write' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_p.column_name <> 'discount_percent' THEN RAISE EXCEPTION 'discount_percent n''est pas la dernière colonne de majordhome_quote_lines_write (%)', v_p.column_name; END IF;
  IF (SELECT is_insertable_into FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_quote_lines_write') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_quote_lines_write n''est plus insérable';
  END IF;
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'quote_lines' AND column_name = 'discount_percent') NOT LIKE '0%' THEN
    RAISE EXCEPTION 'discount_percent sans défaut 0';
  END IF;
  -- la photo ne porte pas de lignes de devis : on vérifie la contrainte elle-même
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_lines_discount_percent_check'
                 AND pg_get_constraintdef(oid) LIKE '%discount_percent >= %0%' AND pg_get_constraintdef(oid) LIKE '%discount_percent <= %100%') THEN
    RAISE EXCEPTION 'borne 0..100 de discount_percent absente';
  END IF;
  RAISE NOTICE 'assert-remise-ligne-devis : OK';
END $$;
