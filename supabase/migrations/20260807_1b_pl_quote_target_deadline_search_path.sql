-- 20260807_1b_pl_quote_target_deadline_search_path.sql
-- Ferme le WARN linter function_search_path_mutable sur
-- majordhome.pl_quote_target_deadline (20260807_1_pennylane_quotes_twin.sql).
-- Risque réel nul (IMMUTABLE, arithmétique pure, aucune référence à un objet,
-- pas de SECURITY DEFINER, appelant qualifié) mais un WARN permanent dans
-- get_advisors apprend à ignorer les advisors. Corps et signature strictement
-- inchangés : seul l'ajout de SET search_path change.

CREATE OR REPLACE FUNCTION majordhome.pl_quote_target_deadline(p_quote_date date)
RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT (p_quote_date + INTERVAL '3 months')::date $$;
