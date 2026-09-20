-- ============================================================================
-- Etancheite Majord'home — fermeture des RPC backend exposees publiquement
-- Applique le 2026-08-24 (migration Supabase : fermeture_rpc_anon_public)
-- ============================================================================
-- Constat : 20 fonctions public.* ecrivant dans majordhome etaient appelables
-- via /rest/v1/rpc/ par un porteur de la cle anon, toutes en SECURITY DEFINER
-- (donc RLS contournee).
--
-- 12 d'entre elles sont laissees ouvertes volontairement :
--   - 8 se protegent par `AND ... = auth.uid()` dans le WHERE : appelees en
--     anonyme, auth.uid() vaut NULL et elles n'affectent aucune ligne ;
--   - create_aide_request, create_website_service_request, inscription_record
--     et creer_commande_pellets servent des formulaires publics.
--     /!\ creer_commande_pellets a un parametre `p_from_token boolean` qui
--     n'est PAS un secret verifie : fausse protection, a durcir en code.
--
-- Les 8 fermees ci-dessous n'avaient aucun controle d'appelant et ne sont
-- appelees que par des Edge Functions en service_role (verifie :
-- _shared/auth.ts:99 et gsc-sync/index.ts:78 instancient le client avec
-- SUPABASE_SERVICE_ROLE_KEY).
--
-- PIEGE POSTGRES : EXECUTE etait detenu par PUBLIC (acl '=X/postgres'), pas par
-- anon. Un `REVOKE ... FROM anon, authenticated` seul est SANS EFFET. Il faut
-- revoquer sur PUBLIC. service_role a un droit explicite et survit au revoke.
--
-- Reversible : GRANT EXECUTE ON FUNCTION ... TO PUBLIC;
-- ============================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        -- ingestion de metriques (org_id fourni par l'appelant, aucun controle)
        'gsc_upsert_metrics',
        'meta_ads_upsert_daily_stats',
        -- synchronisation Pennylane (clients/leads/devis sur org arbitraire)
        'process_pennylane_quote',
        'upsert_pennylane_lead',
        -- webhook Resend (bounces, desabonnements, archivage de clients)
        'resend_apply_webhook_event',
        -- fonctions trigger exposees en RPC par accident (RETURNS trigger)
        'trg_insert_geogrid_results',
        'trg_insert_geogrid_scans',
        'majordhome_clients_all_insert_fn'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- Verification :
--   select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'gsc_upsert_metrics';
--   -> attendu : false (et service_role -> true)
