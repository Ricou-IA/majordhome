-- ============================================================================
-- 20261012_4 — Recherche de lead insensible aux accents : les deux autres surfaces.
--
-- Suite de 20261012_3 (incident ROZIÈRES : « ROZIERES » saisi sans accent ne
-- trouvait pas la carte « ROZIÈRES »). La modale « Rattacher le devis » est
-- corrigée ; restaient deux recherches de lead par nom en `ILIKE` PostgREST,
-- donc sensibles aux accents :
--   1. `leadsService.searchLeads` (EventModal / champ « RDV Bouclage ») ;
--   2. l'axe nom de `leadsService.findPotentialDuplicates` (filet anti-doublon) :
--      un « Rozieres » saisi au clavier passait à côté de la carte « ROZIÈRES ».
--
-- Trois objets :
--   • `majordhome.lead_search_tokens(text)` — la tokenisation (unaccent, casse,
--     ≥ 2 caractères, `%`/`_` échappés), sortie de `lead_search_for_attach` pour
--     n'exister qu'une fois ;
--   • `public.lead_search_for_attach` — même signature et même comportement,
--     recréée pour appeler le helper (plus de copie de la tokenisation) ;
--   • `public.lead_search(p_org_id, p_term, p_status_ids, p_limit)` — la recherche
--     « typeahead » : prénom, nom, email, téléphone (avec ou sans espaces) et ville,
--     filtre statuts optionnel, mêmes colonnes que la vue `majordhome_leads` lue
--     jusqu'ici. TOUS les tokens doivent matcher (sémantique d'un champ de
--     recherche : chaque mot tapé affine), à la différence de la modale de
--     rattachement qui classe sur le nombre de tokens matchés parce qu'un libellé
--     Pennylane peut porter des mots étrangers à la carte.
--
-- SECURITY INVOKER : la RLS de `majordhome.leads` s'applique au caller, filtre
-- `org_id` explicite en plus (défense en profondeur). `public.unaccent` est
-- installée en prod (public, 1.1) et exécutable par `authenticated`.
-- Répétée sur scripts/migration-rehearsal/ (assert-lead-search-attach.sql +
-- assert-lead-search.sql, migration 20261012_3 rejouée avant).
-- ============================================================================

-- ── 1. Tokenisation partagée ───────────────────────────────────────────────
-- Tokens de la saisie, sans accent ni casse, ≥ 2 caractères (particules, initiales
-- ignorées — sinon on ramène la moitié de la base). `%` / `_` échappés : la saisie
-- est un nom, pas un motif. Saisie vide → tableau vide.
CREATE OR REPLACE FUNCTION majordhome.lead_search_tokens(p_term text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(DISTINCT t), '{}'::text[])
  FROM (
    SELECT replace(replace(lower(public.unaccent(t)), '%', '\%'), '_', '\_') AS t
    FROM unnest(regexp_split_to_array(coalesce(trim(p_term), ''), '\s+')) AS t
    WHERE length(t) >= 2
  ) s;
$function$;

REVOKE EXECUTE ON FUNCTION majordhome.lead_search_tokens(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION majordhome.lead_search_tokens(text) TO authenticated, service_role;

COMMENT ON FUNCTION majordhome.lead_search_tokens(text) IS
  'Tokens d''une saisie de recherche de lead : unaccent + minuscules, ≥ 2 caractères, % et _ échappés. Source unique pour lead_search et lead_search_for_attach.';

-- ── 2. lead_search_for_attach : même comportement, tokenisation déléguée ───
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
  SELECT t FROM unnest(majordhome.lead_search_tokens(p_term)) AS t
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

-- CREATE OR REPLACE conserve l'ACL posée par 20261012_3 ; on la réaffirme (idempotent).
REVOKE EXECUTE ON FUNCTION public.lead_search_for_attach(uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lead_search_for_attach(uuid, text, uuid, integer) TO authenticated, service_role;

-- ── 3. lead_search : typeahead (EventModal, RDV Bouclage) + axe nom du filet anti-doublon
CREATE OR REPLACE FUNCTION public.lead_search(
  p_org_id     uuid,
  p_term       text,
  p_status_ids uuid[]  DEFAULT NULL,
  p_limit      integer DEFAULT 10
)
RETURNS TABLE (
  id           uuid,
  first_name   text,
  last_name    text,
  email        text,
  phone        text,
  city         text,
  postal_code  text,
  address      text,
  client_id    uuid,
  status_id    uuid,
  status_label text,
  status_color text,
  source_name  text,
  created_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
WITH tokens AS (
  SELECT t FROM unnest(majordhome.lead_search_tokens(p_term)) AS t
),
leads AS (
  SELECT l.*,
         -- Meule de foin : identité + contact + ville, sans accent ni casse. Le téléphone
         -- est présent tel que stocké (« 06 10 36 56 72 ») ET en chiffres seuls, pour
         -- qu'une saisie « 0610365672 » le trouve aussi.
         lower(public.unaccent(concat_ws(' ',
           l.first_name, l.last_name, l.email, l.phone,
           regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'),
           l.city
         ))) AS hay
  FROM majordhome.leads l
  WHERE l.org_id = p_org_id
    AND coalesce(l.is_deleted, false) = false
    AND (p_status_ids IS NULL OR l.status_id = ANY (p_status_ids))
)
SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.city, l.postal_code, l.address,
       l.client_id, l.status_id, s.label AS status_label, s.color AS status_color,
       src.name AS source_name, l.created_at
FROM leads l
LEFT JOIN majordhome.statuses s   ON s.id = l.status_id
LEFT JOIN majordhome.sources  src ON src.id = l.source_id
WHERE EXISTS (SELECT 1 FROM tokens)
  AND NOT EXISTS (SELECT 1 FROM tokens WHERE l.hay NOT LIKE '%' || tokens.t || '%')
ORDER BY l.created_at DESC
LIMIT greatest(1, least(coalesce(p_limit, 10), 50));
$function$;

-- `PUBLIC` obligatoire (cf. CLAUDE.md) : sans lui le REVOKE FROM anon ne retire rien.
REVOKE EXECUTE ON FUNCTION public.lead_search(uuid, text, uuid[], integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lead_search(uuid, text, uuid[], integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.lead_search(uuid, text, uuid[], integer) IS
  'Recherche de lead (typeahead EventModal / RDV Bouclage, axe nom du filet anti-doublon) : prénom, nom, email, téléphone, ville sans accent (unaccent), tous les tokens requis, filtre statuts optionnel. SECURITY INVOKER (RLS leads).';
