-- 20261018_1_webshop_listes_ecriture_admin.sql
-- Webshop — paramétrage, étape 1 : les listes de livraison ne s'écrivent plus en direct.
--
-- Constat (relecture finale, vérifié en prod le 2026-10-18 par pg_policies / relacl) : sur les
-- 5 tables ci-dessous, la seule policy est `<table>_org` FOR ALL TO PUBLIC
-- USING/WITH CHECK (org_id IN org_members), et `anon` / `authenticated` ont arwd. Les vues
-- publiques étant des miroirs `SELECT *` en security_invoker, n'importe quel membre (technicien
-- compris) pouvait écrire via PostgREST en contournant les RPC org_admin (20261017_2) et la garde
-- `webshop_slot_guard` (gestes de tournée, team_leader+).
--
-- Correctif :
--   - REVOKE INSERT, UPDATE, DELETE FROM anon, authenticated (SELECT conservé : lectures front) ;
--   - policy FOR ALL remplacée par une policy SELECT réservée aux membres de l'org.
-- Écritures restantes, toutes hors RLS / hors droits authenticated :
--   - RPC SECURITY DEFINER (propriétaire postgres) : 20261017_2 (org_admin), 20261013_2
--     (webshop_slot_set_status, webshop_slot_cancel, webshop_order_move_slot…), triggers de recomptage ;
--   - le site (clé service_role, BYPASSRLS ; droits arwd de service_role inchangés).
-- Aucun appel direct en écriture côté Majord'home (src/) ni côté site avec un client authenticated.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webshop_sectors', 'webshop_sector_postcodes', 'webshop_shipping_rates',
                           'webshop_pickup_points', 'webshop_delivery_slots'] LOOP
    EXECUTE format('ALTER TABLE majordhome.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON majordhome.%I FROM anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON majordhome.%I', t || '_org', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON majordhome.%I', t || '_select_org_members', t);
    EXECUTE format($p$CREATE POLICY %I ON majordhome.%I FOR SELECT TO authenticated
                       USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()))$p$,
                   t || '_select_org_members', t);
  END LOOP;
END $$;
