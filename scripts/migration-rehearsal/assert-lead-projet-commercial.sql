-- assert-lead-projet-commercial.sql — vérifie 20261028_1_lead_projet_commercial.sql sur le cluster de répétition.
-- Couvre : colonne + contrainte de format, création et mise à jour du lead par les RPC (la clé n'est pas ignorée en
-- silence, chaîne vide = NULL, absence de clé = valeur gardée), colonne en FIN de la vue publique (security_invoker
-- conservé), privilèges conservés, référentiel d'équipements inchangé. Fixture nettoyée.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid;
  v_lead uuid;
  v_key text;
  v_col text;
  v_n int;
  ok boolean;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'aucun org_admin Mayer dans le snapshot'; END IF;

  -- A. Colonne nullable + contrainte de format
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'leads'
                  AND column_name = 'project_family_key' AND data_type = 'text' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'leads.project_family_key absente ou mal typée';
  END IF;

  -- B. Vue publique : colonne en fin de liste, security_invoker conservé
  SELECT column_name INTO v_col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_leads' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_col IS DISTINCT FROM 'project_family_key' THEN RAISE EXCEPTION 'dernière colonne de majordhome_leads = %', v_col; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.majordhome_leads'::regclass AND reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'majordhome_leads a perdu security_invoker';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_leads' AND column_name = 'equipment_type_label') THEN
    RAISE EXCEPTION 'majordhome_leads a perdu equipment_type_label';
  END IF;

  -- C. Création : la clé est enregistrée (chaîne vide = NULL)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT id INTO v_lead FROM public.create_majordhome_lead(jsonb_build_object(
    'org_id', v_mayer, 'first_name', 'TEST', 'last_name', 'PROJET', 'project_family_key', 'borne_recharge'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT project_family_key INTO v_key FROM majordhome.leads WHERE id = v_lead;
  IF v_key IS DISTINCT FROM 'borne_recharge' THEN RAISE EXCEPTION 'création : project_family_key = %', v_key; END IF;
  SELECT project_family_key INTO v_key FROM public.majordhome_leads WHERE id = v_lead;
  IF v_key IS DISTINCT FROM 'borne_recharge' THEN RAISE EXCEPTION 'vue : project_family_key = %', v_key; END IF;

  -- D. Mise à jour : clé appliquée, clé absente = valeur gardée, chaîne vide = NULL
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.update_majordhome_lead(v_lead, '{"project_family_key": "photovoltaique"}'::jsonb);
  RESET ROLE;
  SELECT project_family_key INTO v_key FROM majordhome.leads WHERE id = v_lead;
  IF v_key IS DISTINCT FROM 'photovoltaique' THEN RAISE EXCEPTION 'update : project_family_key = % (ignorée en silence ?)', v_key; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM public.update_majordhome_lead(v_lead, '{"notes": "autre champ"}'::jsonb);
  RESET ROLE;
  SELECT project_family_key INTO v_key FROM majordhome.leads WHERE id = v_lead;
  IF v_key IS DISTINCT FROM 'photovoltaique' THEN RAISE EXCEPTION 'update sans la clé : valeur écrasée (%)', v_key; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM public.update_majordhome_lead(v_lead, '{"project_family_key": ""}'::jsonb);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT project_family_key INTO v_key FROM majordhome.leads WHERE id = v_lead;
  IF v_key IS NOT NULL THEN RAISE EXCEPTION 'chaîne vide : attendu NULL, trouvé %', v_key; END IF;

  -- E. Format refusé (une clé de famille est un slug)
  ok := false;
  BEGIN
    UPDATE majordhome.leads SET project_family_key = 'Borne de recharge' WHERE id = v_lead;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'clé hors format acceptée'; END IF;

  -- F. Privilèges conservés (CREATE OR REPLACE garde les ACL)
  IF has_function_privilege('anon', 'public.update_majordhome_lead(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'update_majordhome_lead exécutable par anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.create_majordhome_lead(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_majordhome_lead(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated a perdu EXECUTE sur les RPC lead';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_leads', 'SELECT') THEN
    RAISE EXCEPTION 'service_role a perdu SELECT sur majordhome_leads';
  END IF;

  -- G. Référentiel d'entretien non touché
  SELECT count(*) INTO v_n FROM majordhome.pricing_equipment_types;
  IF v_n <> 14 THEN RAISE EXCEPTION 'types d''équipement attendus 14, trouvé %', v_n; END IF;

  DELETE FROM majordhome.leads WHERE id = v_lead;
  RAISE NOTICE 'assert-lead-projet-commercial : OK';
END $$;
