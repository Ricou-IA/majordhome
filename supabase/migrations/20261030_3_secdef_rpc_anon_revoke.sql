-- 20261030_3_secdef_rpc_anon_revoke.sql
-- Suite de 20261029_1 : les RPC SECURITY DEFINER de Majord'home encore exécutables par `anon` (nettoyage
-- pré-prod du 2026-10-30, accord d'Eric). Répétée sur le harnais : scripts/migration-rehearsal/assert-secdef-rpc-anon-revoke.sql
--
-- Constat mesuré en prod le 2026-10-30 (has_function_privilege('anon', …)) : 30 fonctions + 12 fonctions de trigger
-- de Majord'home ouvertes à anon (EXECUTE accordé à PUBLIC par défaut). Dont 14 SANS AUCUNE GARDE, appelables avec la
-- clé publique ET par tout utilisateur connecté de n'importe quelle app de l'instance partagée — ex.
-- list_clients_with_pellets_tokens (noms + e-mails + jetons), mail_campaigns_due (corps des campagnes de toutes les
-- orgs), link_client_auth (rattache un compte auth à n'importe quel client).
--
-- Appelants vérifiés avant d'écrire (2026-10-30) :
--   - site vitrine C:\Dev\Landing Page - Mayer : verify_quote, creer_commande_pellets (et ses autres RPC hors liste)
--     passent toutes par createServiceClient / supabase-admin (service_role) ;
--   - edges : mailing-scheduler (mail_campaigns_due, mail_campaign_mark_run, mail_segment_count) et invite-client
--     (link_client_auth) en service_role ;
--   - pg_stat_statements : ces fonctions n'ont été appelées qu'en service_role, sauf mail_segment_count (authenticated,
--     écran Mailing) ; aucun cron ni vue ne les cite ; les seuls appels imbriqués viennent de fonctions SECURITY
--     DEFINER (droits du propriétaire, non concernés par ce REVOKE).
--
-- Hors périmètre, volontairement :
--   - chantier_gaillac_partage_lire : lien public /gaillac/:token, ouvert à anon par décision (20261017_2) ;
--   - pv_* / cosette_* : fonctions des apps cohabitantes (search_path pack_vendeur…), signalées à Eric, non touchées.
--
-- Fonctions de trigger : PostgreSQL ne vérifie EXECUTE qu'au CREATE TRIGGER, jamais au déclenchement — le REVOKE
-- ne change rien à leur fonctionnement, il ferme seulement l'appel direct.

DO $$
DECLARE
  -- A. Sans garde, appelants serveur uniquement → service_role seul
  serveur text[] := ARRAY[
    'public.creer_commande_pellets(uuid,uuid,text,text,text,text,text,text,text,text,numeric,text,boolean,boolean)',
    'public.export_pellets_inscriptions(timestamp with time zone,timestamp with time zone)',
    'public.generate_missing_pellets_tokens()',
    'public.get_client_by_pellets_token(text)',
    'public.inscrire_client_pellets(text,text,text,text,text,text)',
    'public.list_clients_with_pellets_tokens()',
    'public.get_majordhome_technical_visit_raw(uuid)',
    'public.link_client_auth(uuid,uuid)',
    'public.mail_campaign_mark_run(uuid)',
    'public.mail_campaigns_due()',
    'public.promote_lead_to_gagne(uuid)',
    'public.demote_lead_to_perdu(uuid,text)',
    'public.reevaluate_lead_status_from_quotes(uuid)',
    'public.verify_quote(text)'
  ];
  -- B. Appelées par l'app connectée (garde auth.uid()) → authenticated + service_role, plus anon.
  --    GRANT explicite : retirer PUBLIC retirerait aussi le droit d'authenticated s'il n'en héritait que par là.
  app text[] := ARRAY[
    'public.chantier_reception_create(uuid,bigint,bigint,text,numeric,numeric,numeric,numeric,date,text)',
    'public.chantier_reception_delete(uuid)',
    'public.chantier_recompute_order_status(uuid,jsonb)',
    'public.create_majordhome_lead(jsonb)',
    'public.create_majordhome_lead_activity(jsonb)',
    'public.create_majordhome_lead_interaction(jsonb)',
    'public.update_majordhome_lead_interaction(uuid,jsonb)',
    'public.delete_majordhome_lead_interaction(uuid)',
    'public.delete_majordhome_task(uuid)',
    'public.delete_majordhome_task_note(uuid)',
    'public.get_majordhome_lead_raw(uuid)',
    'public.mail_segment_compile(jsonb,text,uuid)',
    'public.mail_segment_count(jsonb,text,uuid)',
    'public.mail_segment_preview(jsonb,text,uuid,integer)',
    'majordhome.reorder_leads(uuid[])',
    'majordhome.update_majordhome_lead(uuid,jsonb)'
  ];
  -- C. Fonctions de trigger → plus d'appel direct
  triggers text[] := ARRAY[
    'public.majordhome_clients_all_update_fn()',
    'public.majordhome_contracts_write_update_fn()',
    'public.sync_intervention_from_visit()',
    'majordhome.cascade_client_archive_to_contract()',
    'majordhome.chantier_ensure_for_quote()',
    'majordhome.equipments_sync_category()',
    'majordhome.pricing_equipment_types_sync_category_code()',
    'majordhome.update_client_on_contract_change()',
    'majordhome.update_client_on_contract_equipment_change()',
    'majordhome.update_client_on_equipment_change()',
    'majordhome.update_client_on_intervention_change()',
    'majordhome.update_client_on_visit()'
  ];
  f text;
  n int := 0;
BEGIN
  -- to_regprocedure : le harnais ne photographie qu'un sous-ensemble des fonctions ; en prod toutes existent.
  FOREACH f IN ARRAY serveur LOOP
    CONTINUE WHEN to_regprocedure(f) IS NULL;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    n := n + 1;
  END LOOP;
  FOREACH f IN ARRAY app LOOP
    CONTINUE WHEN to_regprocedure(f) IS NULL;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    n := n + 1;
  END LOOP;
  FOREACH f IN ARRAY triggers LOOP
    CONTINUE WHEN to_regprocedure(f) IS NULL;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '20261030_3 : % fonctions fermées à anon', n;
END $$;

-- D. Sauvegardes de la refonte Pennylane du 2026-08-05 (391 + 314 lignes) : l'historique des révisions vit dans
--    lead_quote_revisions ; copie JSON prise le 2026-10-30 hors dépôt (C:\Dev\backups-majordhome\).
DROP TABLE IF EXISTS majordhome._leads_backup_20260805;
DROP TABLE IF EXISTS majordhome._lpq_backup_20260805;
