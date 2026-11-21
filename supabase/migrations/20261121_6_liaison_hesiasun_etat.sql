-- ============================================================================
-- 20261121_6 — Liaison Majord'home → HésiaSun : état de la liaison dans les réglages de l'organisation.
-- Spec : docs/superpowers/specs/2026-11-21-identite-entreprise-saisie-unique-hesiasun-design.md (lot 3).
--
-- L'identité de l'entreprise est saisie une fois dans Majord'home et envoyée à HésiaSun par l'edge
-- `hesiasun-identite`. L'état (identifiant de liaison, dernier envoi, erreur, envoi en attente) vit sous
-- `core.organizations.settings.hesiasun` ; la clé d'API HésiaSun, elle, reste au coffre (org_secret_*,
-- clé `hesiasun:api_key`) et n'y figure jamais.
--
--   - org_hesiasun_noter(p_org_id, p_etat)  remplace `settings.hesiasun` (NULL = retire la clé). service_role seul :
--                                           elle prend l'organisation en paramètre sans la dériver d'auth.uid().
--   - org_hesiasun_en_attente()             organisations dont un envoi a échoué et reste à rejouer. service_role seul.
--
-- Le cron qui rejoue les envois est dans 20261121_7 (le harnais de répétition n'a ni net ni vault).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.org_hesiasun_noter(p_org_id uuid, p_etat jsonb) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_lignes int;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'org_requise' USING ERRCODE = '22023'; END IF;
  IF p_etat IS NOT NULL AND jsonb_typeof(p_etat) <> 'object' THEN RAISE EXCEPTION 'etat_invalide' USING ERRCODE = '22023'; END IF;
  -- Une clé d'API n'a rien à faire dans les réglages : refus net plutôt qu'un secret lisible par tout membre.
  IF p_etat IS NOT NULL AND (p_etat::text ~* 'bk_live_') THEN RAISE EXCEPTION 'secret_dans_etat' USING ERRCODE = '22023'; END IF;

  UPDATE core.organizations
     SET settings = CASE WHEN p_etat IS NULL THEN COALESCE(settings, '{}'::jsonb) - 'hesiasun'
                         ELSE jsonb_set(COALESCE(settings, '{}'::jsonb), '{hesiasun}', p_etat, true) END,
         updated_at = now()
   WHERE id = p_org_id;
  GET DIAGNOSTICS v_lignes = ROW_COUNT;
  IF v_lignes <> 1 THEN RAISE EXCEPTION 'organisation_inconnue' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.org_hesiasun_noter(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_hesiasun_noter(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.org_hesiasun_noter IS 'État de la liaison HésiaSun (settings.hesiasun) — service_role seul (edge hesiasun-identite).';

CREATE OR REPLACE FUNCTION public.org_hesiasun_en_attente() RETURNS TABLE (org_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, public
AS $$
  SELECT o.id
    FROM core.organizations o
   WHERE o.settings -> 'hesiasun' ->> 'en_attente' = 'true'
   ORDER BY o.id
   LIMIT 50;
$$;
REVOKE EXECUTE ON FUNCTION public.org_hesiasun_en_attente() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_hesiasun_en_attente() TO service_role;
COMMENT ON FUNCTION public.org_hesiasun_en_attente IS 'Organisations dont un envoi d''identité vers HésiaSun reste à rejouer — service_role seul (cron).';
