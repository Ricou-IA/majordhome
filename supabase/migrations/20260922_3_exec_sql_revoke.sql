-- supabase/migrations/20260922_3_exec_sql_revoke.sql
-- ============================================================================
-- `public.exec_sql(text)` : retirer l'EXECUTE à la clé publique et aux
-- utilisateurs authentifiés — service_role uniquement.
--
-- Constat prod (2026-09-22, `has_function_privilege` sur pg_proc, jamais le
-- texte des migrations) : la fonction est bien SECURITY INVOKER (P0.0.1), mais
-- son ACL porte des GRANT EXPLICITES `anon=X`, `authenticated=X`,
-- `service_role=X` (pas d'entrée PUBLIC). Sa garde textuelle ne refuse que
-- INSERT/UPDATE/DELETE/DDL : un `SELECT pg_sleep(600)` (DoS anonyme), un
-- `SELECT set_config(…)` (GUC de session posé sur une connexion poolée, cf.
-- le repère `majordhome.invoice_issue_id` lu par `invoices_guard_immutable`)
-- ou la lecture de tout ce que le rôle voit passent — avec la seule clé anon.
--
-- Inventaire des appelants (grep repo + site vitrine + 60 workflows N8N du
-- KVM2) : un seul, `scripts/migration-rehearsal/snapshot.mjs`, en clé
-- service_role. Aucun appel front, edge function, N8N ni site vitrine.
-- Le connecteur MCP `execute_sql` passe par l'API Management (rôle postgres),
-- pas par cette RPC.
--
-- Le mot PUBLIC est obligatoire (cf. CLAUDE.md § Multi-tenant) : un
-- `REVOKE … FROM anon` seul ne retire rien si le privilège vient de PUBLIC.
-- Ici les GRANT sont explicites ET on couvre PUBLIC : les deux voies fermées.
-- Répétée sur scripts/migration-rehearsal/ (assert-exec-sql-revoke.sql).
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;

-- Vérification dans la transaction : l'effet réel, pas le texte.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.exec_sql(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_sql reste exécutable par anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.exec_sql(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_sql reste exécutable par authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.exec_sql(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_sql plus exécutable par service_role';
  END IF;
END $$;

COMMENT ON FUNCTION public.exec_sql(text) IS
  'Lecture SQL brute (SELECT/WITH) — service_role uniquement depuis 20260922_3 (REVOKE PUBLIC/anon/authenticated). Jamais depuis le frontend ni une edge exposée.';
