-- 20261029_1_anon_revoke_majordhome.sql
-- Fin de la dette « anon » du schéma majordhome — décision d'Eric du 2026-10-27 (point 3 de la relecture du plan
-- « Devis — référence interne, caractéristiques, détail par chapitre, éditer l'article »).
-- Répétée sur le harnais : scripts/migration-rehearsal/assert-anon-revoke-majordhome.sql
--
-- Constat mesuré en prod le 2026-10-26 : l'ACL PAR DÉFAUT du schéma majordhome (pg_default_acl, grantor postgres)
-- accordait arwd à `anon` sur toute table créée ; 92 tables, 7 vues internes et 2 séquences de majordhome, et 102 des
-- 143 vues public.majordhome_* (ACL par défaut de public) portaient encore ces privilèges. Rien ne fuyait : aucune
-- policy ne cite anon, les 143 vues sont security_invoker, le schéma n'est pas exposé par PostgREST — la RLS était
-- la seule serrure. La charte (CLAUDE.md § Multi-tenant) en veut deux : REVOKE … FROM PUBLIC, anon sur chaque objet.
--
-- Appelants vérifiés avant d'écrire (2026-10-27) :
--   - site vitrine C:\Dev\Landing Page - Mayer : toute lecture de vue majordhome_* passe par createServiceClient /
--     adminClient (service_role) ; la clé anon ne sert qu'à l'auth, au portail client (session authenticated) et à
--     l'edge google-reviews ; ses 11 RPC sont SECURITY DEFINER (hors périmètre, inchangées) ;
--   - pages publiques de l'app (/rdv/:token, /gaillac/:token, unsubscribe, webhooks) : edges service_role ou RPC
--     SECURITY DEFINER ; ContractSign et le portail client sont authentifiés.
--
-- Périmètre : (1) tables, vues et séquences du schéma majordhome + ACL par défaut du schéma (plus besoin d'un REVOKE
-- par table à la création) ; (2) vues public.majordhome_* par liste NOMINATIVE (le schéma public est partagé avec les
-- apps cohabitantes : on ne touche pas à ses ACL par défaut). Hors périmètre, volontairement : USAGE sur le schéma
-- majordhome (gardé), les RPC SECURITY DEFINER exécutables par anon (audit dédié avec le site vitrine), les deux
-- tables _backup_20260805 (couvertes par le REVOKE, pas supprimées).
-- Mesure : scripts/permissions-coherence.mjs § 6.

-- 1. Schéma majordhome : objets existants + défauts
REVOKE ALL ON ALL TABLES IN SCHEMA majordhome FROM PUBLIC, anon;       -- tables, vues, vues matérialisées
REVOKE ALL ON ALL SEQUENCES IN SCHEMA majordhome FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA majordhome REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA majordhome REVOKE ALL ON SEQUENCES FROM anon;

-- 2. Vues public.majordhome_* (liste lue au moment de l'exécution ; toute vue créée ensuite doit porter son propre
--    REVOKE ALL … FROM PUBLIC, anon — la charte ne change pas, § 6 de permissions-coherence le vérifie)
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind IN ('v', 'm') AND c.relname LIKE 'majordhome\_%'
    ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'anon retiré de % vue(s) public.majordhome_*', n;
END $$;
