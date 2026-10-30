-- assert-secdef-rpc-anon-revoke.sql — vérifie 20261030_3_secdef_rpc_anon_revoke.sql.
-- Pour chaque fonction de la migration PRÉSENTE dans le harnais (snapshot = sous-ensemble) : anon n'a plus EXECUTE ;
-- groupe « serveur » : authenticated non plus, service_role oui ; groupe « app » : authenticated et service_role oui.
-- Témoin hors périmètre : chantier_gaillac_partage_lire reste ouverte à anon si elle est photographiée.
DO $$
DECLARE
  serveur text[] := ARRAY[
    'public.creer_commande_pellets(uuid,uuid,text,text,text,text,text,text,text,text,numeric,text,boolean,boolean)',
    'public.export_pellets_inscriptions(timestamp with time zone,timestamp with time zone)',
    'public.generate_missing_pellets_tokens()', 'public.get_client_by_pellets_token(text)',
    'public.inscrire_client_pellets(text,text,text,text,text,text)', 'public.list_clients_with_pellets_tokens()',
    'public.get_majordhome_technical_visit_raw(uuid)', 'public.link_client_auth(uuid,uuid)',
    'public.mail_campaign_mark_run(uuid)', 'public.mail_campaigns_due()', 'public.promote_lead_to_gagne(uuid)',
    'public.demote_lead_to_perdu(uuid,text)', 'public.reevaluate_lead_status_from_quotes(uuid)', 'public.verify_quote(text)'];
  app text[] := ARRAY[
    'public.chantier_reception_create(uuid,bigint,bigint,text,numeric,numeric,numeric,numeric,date,text)',
    'public.chantier_reception_delete(uuid)', 'public.chantier_recompute_order_status(uuid,jsonb)',
    'public.create_majordhome_lead(jsonb)', 'public.create_majordhome_lead_activity(jsonb)',
    'public.create_majordhome_lead_interaction(jsonb)', 'public.update_majordhome_lead_interaction(uuid,jsonb)',
    'public.delete_majordhome_lead_interaction(uuid)', 'public.delete_majordhome_task(uuid)',
    'public.delete_majordhome_task_note(uuid)', 'public.get_majordhome_lead_raw(uuid)',
    'public.mail_segment_compile(jsonb,text,uuid)', 'public.mail_segment_count(jsonb,text,uuid)',
    'public.mail_segment_preview(jsonb,text,uuid,integer)', 'majordhome.reorder_leads(uuid[])',
    'majordhome.update_majordhome_lead(uuid,jsonb)'];
  f text; p regprocedure; vus int := 0;
BEGIN
  FOREACH f IN ARRAY serveur LOOP
    p := to_regprocedure(f); CONTINUE WHEN p IS NULL; vus := vus + 1;
    IF has_function_privilege('anon', p, 'EXECUTE') THEN RAISE EXCEPTION '% encore exécutable par anon', f; END IF;
    IF has_function_privilege('authenticated', p, 'EXECUTE') THEN RAISE EXCEPTION '% encore exécutable par authenticated', f; END IF;
    IF NOT has_function_privilege('service_role', p, 'EXECUTE') THEN RAISE EXCEPTION '% : service_role a perdu EXECUTE', f; END IF;
  END LOOP;
  FOREACH f IN ARRAY app LOOP
    p := to_regprocedure(f); CONTINUE WHEN p IS NULL; vus := vus + 1;
    IF has_function_privilege('anon', p, 'EXECUTE') THEN RAISE EXCEPTION '% encore exécutable par anon', f; END IF;
    IF NOT has_function_privilege('authenticated', p, 'EXECUTE') THEN RAISE EXCEPTION '% : authenticated a perdu EXECUTE (régression)', f; END IF;
    IF NOT has_function_privilege('service_role', p, 'EXECUTE') THEN RAISE EXCEPTION '% : service_role a perdu EXECUTE', f; END IF;
  END LOOP;
  IF vus = 0 THEN RAISE EXCEPTION 'aucune fonction de la migration dans le harnais : assertion vide'; END IF;

  p := to_regprocedure('public.chantier_gaillac_partage_lire(text)');
  IF p IS NOT NULL AND NOT has_function_privilege('anon', p, 'EXECUTE') THEN
    RAISE EXCEPTION 'chantier_gaillac_partage_lire a été fermée à anon (hors périmètre, lien public)';
  END IF;

  IF to_regclass('majordhome._leads_backup_20260805') IS NOT NULL OR to_regclass('majordhome._lpq_backup_20260805') IS NOT NULL THEN
    RAISE EXCEPTION 'tables _backup_20260805 encore présentes';
  END IF;
  RAISE NOTICE 'assert-secdef-rpc-anon-revoke : % fonction(s) vérifiée(s)', vus;
END $$;
