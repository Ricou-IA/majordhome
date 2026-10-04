-- supabase/migrations/20261004_5_team_member_horaires.sql
-- ============================================================================
-- Horaires de travail des membres (majordhome.team_members.default_availability).
-- Lus par le moteur de tournées (chargerJournees : amplitude + jours travaillés),
-- scheduleConflicts.js et le planning — mais jusqu'ici éditables par AUCUN écran.
-- Décisions Eric 2026-10-04 :
--   1. Lucas Taugourdeau (technicien en tournée, créé le 2026-09-30) avait gardé le
--      DEFAULT (samedi 9-12 travaillé) → l'agent téléphonique pouvait lui proposer
--      des entretiens le samedi matin. Aligné sur Antoine Verloo / Ludovic Robert
--      (valeurs relues en prod le 2026-10-04 : lun-jeu 08:00-17:00, ven 08:00-16:00,
--      sam/dim inactifs). Ne touche la ligne QUE si elle porte encore l'ancien
--      défaut : une valeur saisie entre-temps n'est jamais écrasée.
--   2. DEFAULT de la colonne = ces mêmes horaires (samedi inactif). Aucune voie de
--      création n'écrit sa propre valeur (team_member_ensure_for_user, create-user,
--      migrations : vérifié) — elles héritent toutes du DEFAULT.
--   3. RPC team_member_set_availability(p_team_member_id, p_availability) pour
--      l'écran Settings → Équipe : SECURITY DEFINER, org_admin de l'org du membre,
--      REVOKE PUBLIC/anon. Valide et NORMALISE (7 jours exactement, HH:MM,
--      début < fin ; jour inactif stocké {"active": false}) — rien n'est avalé :
--      une saisie invalide échoue en 22023, jamais un filtrage silencieux.
-- Hors périmètre (en attente de réponse d'Eric) : les membres hors tournée qui ont
-- gardé le défaut (Mohammed, commerciaux, admin).
-- Répétée sur scripts/migration-rehearsal/ (assert-team-member-horaires.sql).
-- ============================================================================

-- 1. Lucas Taugourdeau ----------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  UPDATE majordhome.team_members
     SET default_availability = '{"monday": {"start": "08:00", "end": "17:00", "active": true}, "tuesday": {"start": "08:00", "end": "17:00", "active": true}, "wednesday": {"start": "08:00", "end": "17:00", "active": true}, "thursday": {"start": "08:00", "end": "17:00", "active": true}, "friday": {"start": "08:00", "end": "16:00", "active": true}, "saturday": {"active": false}, "sunday": {"active": false}}'::jsonb,
         updated_at = now()
   WHERE id = '1dc2dbab-ca31-4d01-a05f-0dae97443a33'
     AND display_name = 'Lucas Taugourdeau'
     AND default_availability = '{"monday": {"start": "08:00", "end": "18:00", "active": true}, "tuesday": {"start": "08:00", "end": "18:00", "active": true}, "wednesday": {"start": "08:00", "end": "18:00", "active": true}, "thursday": {"start": "08:00", "end": "18:00", "active": true}, "friday": {"start": "08:00", "end": "18:00", "active": true}, "saturday": {"start": "09:00", "end": "12:00", "active": true}, "sunday": {"active": false}}'::jsonb;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Horaires de Lucas Taugourdeau alignés : % ligne(s)', n;
END;
$$;

-- 2. DEFAULT de la colonne --------------------------------------------------------
ALTER TABLE majordhome.team_members
  ALTER COLUMN default_availability
  SET DEFAULT '{"monday": {"start": "08:00", "end": "17:00", "active": true}, "tuesday": {"start": "08:00", "end": "17:00", "active": true}, "wednesday": {"start": "08:00", "end": "17:00", "active": true}, "thursday": {"start": "08:00", "end": "17:00", "active": true}, "friday": {"start": "08:00", "end": "16:00", "active": true}, "saturday": {"active": false}, "sunday": {"active": false}}'::jsonb;

-- 3. RPC d'écriture ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_member_set_availability(
  p_team_member_id uuid,
  p_availability   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, core, public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_core_org_id uuid;
  v_jours       text[] := ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_jour        text;
  v_cfg         jsonb;
  v_start       text;
  v_end         text;
  v_norme       jsonb := '{}'::jsonb;
  v_result      jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;

  SELECT o.core_org_id INTO v_core_org_id
    FROM majordhome.team_members tm
    JOIN majordhome.organizations o ON o.id = tm.org_id
   WHERE tm.id = p_team_member_id;
  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Membre % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  -- Garde positive : seul un org_admin de l'org du membre passe.
  IF (EXISTS (
        SELECT 1 FROM core.organization_members om
         WHERE om.user_id = v_user_id AND om.org_id = v_core_org_id AND om.role = 'org_admin'
      )) IS NOT TRUE THEN
    RAISE EXCEPTION 'Seul un org_admin peut modifier les horaires de travail' USING ERRCODE = '42501';
  END IF;

  IF p_availability IS NULL OR jsonb_typeof(p_availability) <> 'object' THEN
    RAISE EXCEPTION 'Horaires attendus sous forme d''objet' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_availability) k WHERE k <> ALL (v_jours)) THEN
    RAISE EXCEPTION 'Jour inconnu dans les horaires' USING ERRCODE = '22023';
  END IF;

  FOREACH v_jour IN ARRAY v_jours LOOP
    v_cfg := p_availability -> v_jour;
    IF v_cfg IS NULL OR jsonb_typeof(v_cfg) <> 'object' OR jsonb_typeof(v_cfg -> 'active') <> 'boolean' THEN
      RAISE EXCEPTION 'Jour % absent ou incomplet', v_jour USING ERRCODE = '22023';
    END IF;

    IF (v_cfg ->> 'active')::boolean THEN
      v_start := v_cfg ->> 'start';
      v_end   := v_cfg ->> 'end';
      IF v_start IS NULL OR v_end IS NULL
         OR v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR v_end   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'Heure invalide pour % (format HH:MM attendu)', v_jour USING ERRCODE = '22023';
      END IF;
      IF (v_start < v_end) IS NOT TRUE THEN
        RAISE EXCEPTION 'Début après la fin pour %', v_jour USING ERRCODE = '22023';
      END IF;
      v_norme := v_norme || jsonb_build_object(v_jour, jsonb_build_object('start', v_start, 'end', v_end, 'active', true));
    ELSE
      v_norme := v_norme || jsonb_build_object(v_jour, jsonb_build_object('active', false));
    END IF;
  END LOOP;

  UPDATE majordhome.team_members tm
     SET default_availability = v_norme,
         updated_at = now()
   WHERE tm.id = p_team_member_id
  RETURNING tm.default_availability INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.team_member_set_availability(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_availability(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.team_member_set_availability(uuid, jsonb) IS
  'Horaires de travail d''un membre (default_availability), org_admin only. Valide et normalise les 7 jours ; renvoie la valeur stockée.';
