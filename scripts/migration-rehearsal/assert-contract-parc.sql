-- Assertions 20261010_2 — vue majordhome_contract_parc
DO $$
DECLARE v_inv text; v_n int;
BEGIN
  SELECT (SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name='security_invoker')
    INTO v_inv FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='majordhome_contract_parc';
  IF v_inv IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'majordhome_contract_parc sans security_invoker (%)', v_inv; END IF;
  IF has_table_privilege('anon', 'public.majordhome_contract_parc', 'SELECT') THEN RAISE EXCEPTION 'anon lit majordhome_contract_parc'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_contract_parc', 'SELECT') THEN RAISE EXCEPTION 'authenticated ne lit pas la vue'; END IF;
  -- Les contrats sans équipement restent présents (LEFT JOIN)
  SELECT count(*) INTO v_n FROM public.majordhome_contract_parc p
   WHERE p.equipment_id IS NULL AND EXISTS (SELECT 1 FROM majordhome.contracts c WHERE c.id = p.contract_id);
  RAISE NOTICE 'contrats sans équipement visibles : %', v_n;
  RAISE NOTICE 'assert-contract-parc OK';
END $$;
