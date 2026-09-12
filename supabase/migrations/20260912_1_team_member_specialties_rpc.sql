-- 20260912_1_team_member_specialties_rpc.sql
-- ============================================================================
-- Compétences des techniciens = catégories d'équipement qu'ils entretiennent.
-- Réutilise la colonne EXISTANTE majordhome.team_members.specialties (text[],
-- déjà exposée par la vue majordhome_team_members) — pas de nouvelle colonne.
-- Sémantique : '{}' (ou NULL) = polyvalent, aucune restriction. Consommé par
-- src/lib/tournee/proposer-contrat.js::techniciensEligibles (catégories du
-- contrat ⊆ specialties). Pas de CHECK sur les valeurs : les chips de
-- Settings → Équipe proposent les catégories réellement présentes dans
-- majordhome_pricing_equipment_types de l'org.
--
-- Signature ÉTENDUE d'une RPC existante (20260829_2) : on DROP l'ancienne —
-- PostgREST ne sait pas choisir entre deux surcharges dont les paramètres
-- ont des valeurs par défaut (« Could not choose the best candidate function »).
-- Spec : docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md §4.2
-- ============================================================================

DROP FUNCTION IF EXISTS public.team_member_set_routing_settings(uuid, integer, boolean);

CREATE OR REPLACE FUNCTION public.team_member_set_routing_settings(
  p_team_member_id      uuid,
  p_daily_work_minutes  integer DEFAULT NULL,
  p_include_in_routing  boolean DEFAULT NULL,
  p_specialties         text[]  DEFAULT NULL
)
RETURNS TABLE (daily_work_minutes integer, include_in_routing boolean, specialties text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id     uuid := auth.uid();
  v_core_org_id uuid;
  v_role        text;
BEGIN
  -- Posture frontend : pas d'appelant anonyme, traité en première instruction.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;

  -- Une journée de travail hors de ces bornes est une faute de saisie, pas un
  -- réglage : la laisser passer produirait des tournées absurdes en silence.
  IF p_daily_work_minutes IS NOT NULL
     AND (p_daily_work_minutes < 60 OR p_daily_work_minutes > 1440) THEN
    RAISE EXCEPTION 'Budget journalier hors bornes (60-1440 min): %', p_daily_work_minutes
      USING ERRCODE = '22023';
  END IF;

  SELECT o.core_org_id INTO v_core_org_id
  FROM majordhome.team_members tm
  JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;

  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  SELECT role INTO v_role
  FROM core.organization_members
  WHERE user_id = v_user_id AND org_id = v_core_org_id;

  -- Garde en autorisation positive : `IS DISTINCT FROM` refuse aussi un rôle NULL
  -- (utilisateur sans appartenance), là où `!=` laisserait passer.
  IF v_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un org_admin peut modifier les reglages de tournee (role=%)', v_role
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE majordhome.team_members tm
     SET daily_work_minutes = COALESCE(p_daily_work_minutes, tm.daily_work_minutes),
         include_in_routing = COALESCE(p_include_in_routing, tm.include_in_routing),
         specialties        = COALESCE(p_specialties, tm.specialties),
         updated_at         = NOW()
   WHERE tm.id = p_team_member_id
  RETURNING tm.daily_work_minutes, tm.include_in_routing, tm.specialties;
END;
$function$;

-- PUBLIC n'est PAS optionnel : PostgreSQL accorde EXECUTE à PUBLIC par défaut sur
-- toute fonction créée, et anon en hérite. Un REVOKE … FROM anon seul réussirait
-- sans rien retirer.
REVOKE EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[])
  TO authenticated;

-- Vérification (à exécuter après application, doit renvoyer false) :
-- SELECT has_function_privilege('anon',
--   'public.team_member_set_routing_settings(uuid, integer, boolean, text[])', 'EXECUTE');
