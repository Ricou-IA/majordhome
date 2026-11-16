-- assert-certificats-mode.sql — vérifie 20261116_1_certificats_mode_allege.sql.
-- Un écart lève une exception → run.mjs sort en ECHEC.

DO $$
DECLARE v_last text; n int; v_id uuid; v_ecrit boolean; v_refuse boolean;
BEGIN
  -- ── A. Structure ─────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='certificats'
                 AND column_name='mode' AND is_nullable='NO' AND column_default LIKE '%complet%') THEN
    RAISE EXCEPTION 'certificats.mode absente, nullable ou sans défaut ''complet'''; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='majordhome.certificats'::regclass AND conname='certificats_mode_check') THEN
    RAISE EXCEPTION 'contrainte certificats_mode_check absente'; END IF;

  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema='public' AND table_name='majordhome_certificats' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'mode' THEN RAISE EXCEPTION 'majordhome_certificats : dernière colonne % au lieu de mode', v_last; END IF;
  IF (SELECT is_insertable_into FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_certificats') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_certificats n''est plus insérable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.majordhome_certificats'::regclass AND 'security_invoker=true' = ANY(reloptions)) THEN
    RAISE EXCEPTION 'majordhome_certificats a perdu security_invoker'; END IF;

  -- ── B. Droits (inchangés par CREATE OR REPLACE) ──────────────────────────
  IF has_table_privilege('anon', 'public.majordhome_certificats', 'SELECT') THEN RAISE EXCEPTION 'majordhome_certificats lisible par anon'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_certificats', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.majordhome_certificats', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.majordhome_certificats', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.majordhome_certificats', 'DELETE') THEN
    RAISE EXCEPTION 'majordhome_certificats : un droit authenticated a été perdu'; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_certificats', 'SELECT') THEN
    RAISE EXCEPTION 'majordhome_certificats : SELECT service_role perdu (invoice-send lit cette vue)'; END IF;

  -- ── C. Données : l'existant est « complet », la contrainte tient ─────────
  SELECT count(*) INTO n FROM majordhome.certificats WHERE mode <> 'complet';
  IF n <> 0 THEN RAISE EXCEPTION '% certificat(s) existant(s) hors mode complet', n; END IF;

  SELECT id INTO v_id FROM majordhome.certificats LIMIT 1;
  IF v_id IS NOT NULL THEN
    -- Écriture au travers de la vue, annulée par le sous-bloc (les variables PL/pgSQL, elles,
    -- survivent à l'annulation). Un seul UPDATE par ligne : un second, dans la même transaction,
    -- re-vérifie les clés étrangères contre un harnais qui ne charge qu'une partie des contrats.
    BEGIN
      UPDATE public.majordhome_certificats SET mode = 'allege' WHERE id = v_id;
      v_ecrit := (SELECT mode FROM majordhome.certificats WHERE id = v_id) = 'allege';
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'annulation voulue';
    EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
    END;
    IF v_ecrit IS NOT TRUE THEN RAISE EXCEPTION 'écriture de mode au travers de la vue sans effet'; END IF;

    BEGIN
      UPDATE public.majordhome_certificats SET mode = 'autre' WHERE id = v_id;
      v_refuse := false;
    EXCEPTION WHEN check_violation THEN v_refuse := true;
    END;
    IF v_refuse IS NOT TRUE THEN RAISE EXCEPTION 'mode = ''autre'' accepté : la contrainte ne tient pas'; END IF;
  END IF;

  RAISE NOTICE 'assert-certificats-mode : OK';
END $$;
