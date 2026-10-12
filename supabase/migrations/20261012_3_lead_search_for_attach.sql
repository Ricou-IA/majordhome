-- ============================================================================
-- 20261012_3 — Rattacher un devis Pennylane : recherche de lead insensible aux accents
-- + lead du client Pennylane ponté en tête.
--
-- Incident 2026-10-12 (Eric) : les devis D-2026-10536 / 10538 « FRANCOIS ROZIERES »
-- ne trouvaient aucun lead dans « Rattacher le devis », alors que la carte
-- « FRANÇOIS ROZIÈRES » (RDV planifié) existe. Deux causes dans la modale :
--   1. recherche par nom en `ILIKE` PostgREST : Pennylane envoie le nom SANS accent,
--      la carte est stockée AVEC (È ≠ E) → 0 résultat sur ROZIÈRES ; seuls les
--      4 « FRANCOIS » sans cédille remontaient, ce qui faisait croire que la carte
--      n'existait pas ;
--   2. le pont client Pennylane ↔ client Majord'home (`pennylane_sync`) et le
--      `leads.client_id` qui en découle étaient ignorés, alors que c'est l'axe
--      déterministe (celui du cron `upsert_pennylane_lead` et de
--      `findPotentialDuplicates`).
--
-- Un filtre PostgREST ne peut pas appliquer `unaccent` à une colonne → RPC.
-- SECURITY INVOKER : la RLS de `majordhome.leads` s'applique au caller, filtre
-- `org_id` explicite en plus (défense en profondeur). `public.unaccent` est
-- installée en prod (public, 1.1) et exécutable par `authenticated`.
--
-- Classement : lead du client ponté d'abord, puis nombre de tokens de la saisie
-- qui matchent (« FRANCOIS ROZIERES » : 2 tokens > 1), puis le plus récent —
-- un nom courant ne peut plus évincer la bonne carte sous le plafond.
-- Répétée sur scripts/migration-rehearsal/ (assert-lead-search-attach.sql).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_search_for_attach(
  p_org_id    uuid,
  p_term      text    DEFAULT NULL,
  p_client_id uuid    DEFAULT NULL,
  p_limit     integer DEFAULT 20
)
RETURNS TABLE (
  id             uuid,
  first_name     text,
  last_name      text,
  city           text,
  status_label   text,
  client_match   boolean,
  matched_tokens integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
WITH tokens AS (
  -- Tokens de la saisie, sans accent ni casse, ≥ 2 caractères (particules, initiales
  -- ignorées — sinon on ramène la moitié de la base). `%` / `_` échappés : la saisie
  -- est un nom, pas un motif.
  SELECT DISTINCT replace(replace(lower(public.unaccent(t)), '%', '\%'), '_', '\_') AS t
  FROM unnest(regexp_split_to_array(coalesce(trim(p_term), ''), '\s+')) AS t
  WHERE length(t) >= 2
),
leads AS (
  SELECT l.id, l.first_name, l.last_name, l.city, l.client_id, l.status_id, l.created_at,
         lower(public.unaccent(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, ''))) AS nm
  FROM majordhome.leads l
  WHERE l.org_id = p_org_id
    AND coalesce(l.is_deleted, false) = false
),
scored AS (
  SELECT l.id, l.first_name, l.last_name, l.city, s.label AS status_label, l.created_at,
         -- IS TRUE : un lead sans client_id donnerait NULL, trié AVANT true en DESC.
         (p_client_id IS NOT NULL AND l.client_id = p_client_id) IS TRUE AS client_match,
         (SELECT count(*) FROM tokens WHERE l.nm LIKE '%' || tokens.t || '%')::integer AS matched_tokens
  FROM leads l
  LEFT JOIN majordhome.statuses s ON s.id = l.status_id
)
SELECT id, first_name, last_name, city, status_label, client_match, matched_tokens
FROM scored
WHERE client_match OR matched_tokens > 0
ORDER BY client_match DESC, matched_tokens DESC, created_at DESC
LIMIT greatest(1, least(coalesce(p_limit, 20), 50));
$function$;

-- `PUBLIC` obligatoire (cf. CLAUDE.md) : sans lui le REVOKE FROM anon ne retire rien.
REVOKE EXECUTE ON FUNCTION public.lead_search_for_attach(uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lead_search_for_attach(uuid, text, uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.lead_search_for_attach(uuid, text, uuid, integer) IS
  'Recherche de lead pour rattacher un devis Pennylane : nom sans accent (unaccent), lead du client ponté (p_client_id) en tête, classement par tokens matchés. SECURITY INVOKER (RLS leads).';
