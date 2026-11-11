-- 20261113_1_assistant_pieces.sql — assistant « Trouver une pièce » (Hermes) : recherches, plafond, RPC
-- Spec : docs/superpowers/specs/2026-11-11-assistant-pieces-sav-hermes-design.md
-- Plan : docs/superpowers/plans/2026-11-12-assistant-pieces-sav-hermes.md, tâche 7.
-- Une ligne par recherche de pièce lancée par un utilisateur sur l'appareil d'un client. L'agent externe cherche ;
-- l'edge function (service_role) écrit les lignes par les cinq RPC ci-dessous, le front les lit par la vue
-- public.majordhome_assistant_recherches. org_id = org CORE (core.organizations.id), celle de useAuth().organization.id
-- et celle que majordhome.project_org_id() rend pour un équipement.
--
-- PARTIE 1 (ce bloc) : défauts app, sortie de `node scripts/gen-app-role-permissions-sql.mjs`
--   (registre src/lib/permissionsRegistry.js = source unique), collée telle quelle. Nouvelle ressource :
--   assistant_pieces/use (les trois rôles). Idempotent (upsert sur la clé primaire role, resource, action).
-- PARTIE 2 (en fin de fichier) : table, vue, plafond journalier, RPC service_role only.
-- Répétée sur scripts/migration-rehearsal/ (assert-assistant-pieces.sql).
INSERT INTO majordhome.app_role_permissions (role, resource, action, allowed) VALUES
  ('team_leader','dashboard','view',true),
  ('commercial','dashboard','view',true),
  ('technicien','dashboard','view',true),
  ('team_leader','clients','view',true),
  ('commercial','clients','view',true),
  ('technicien','clients','view',true),
  ('team_leader','clients','create',true),
  ('commercial','clients','create',true),
  ('technicien','clients','create',false),
  ('team_leader','clients','edit',true),
  ('commercial','clients','edit',true),
  ('technicien','clients','edit',true),
  ('team_leader','clients','delete',false),
  ('commercial','clients','delete',false),
  ('technicien','clients','delete',false),
  ('team_leader','pipeline','view',true),
  ('commercial','pipeline','view',true),
  ('technicien','pipeline','view',false),
  ('team_leader','pipeline','create',true),
  ('commercial','pipeline','create',true),
  ('technicien','pipeline','create',false),
  ('team_leader','pipeline','edit',true),
  ('commercial','pipeline','edit',false),
  ('technicien','pipeline','edit',false),
  ('team_leader','pipeline','edit_own',true),
  ('commercial','pipeline','edit_own',true),
  ('technicien','pipeline','edit_own',false),
  ('team_leader','pipeline','delete',false),
  ('commercial','pipeline','delete',false),
  ('technicien','pipeline','delete',false),
  ('team_leader','pipeline','assign',true),
  ('commercial','pipeline','assign',false),
  ('technicien','pipeline','assign',false),
  ('team_leader','chantiers','view',true),
  ('commercial','chantiers','view',true),
  ('technicien','chantiers','view',true),
  ('team_leader','chantiers','edit',true),
  ('commercial','chantiers','edit',false),
  ('technicien','chantiers','edit',false),
  ('team_leader','chantiers','edit_own',true),
  ('commercial','chantiers','edit_own',true),
  ('technicien','chantiers','edit_own',true),
  ('team_leader','planning','view',true),
  ('commercial','planning','view',true),
  ('technicien','planning','view',true),
  ('team_leader','planning','create',true),
  ('commercial','planning','create',true),
  ('technicien','planning','create',false),
  ('team_leader','entretiens','view',true),
  ('commercial','entretiens','view',true),
  ('technicien','entretiens','view',true),
  ('team_leader','entretiens','create',true),
  ('commercial','entretiens','create',true),
  ('technicien','entretiens','create',true),
  ('team_leader','entretiens','edit',true),
  ('commercial','entretiens','edit',false),
  ('technicien','entretiens','edit',true),
  ('team_leader','sav','view',true),
  ('commercial','sav','view',true),
  ('technicien','sav','view',true),
  ('team_leader','sav','create',true),
  ('commercial','sav','create',false),
  ('technicien','sav','create',false),
  ('team_leader','sav','edit',true),
  ('commercial','sav','edit',false),
  ('technicien','sav','edit',false),
  ('team_leader','devis','view',true),
  ('commercial','devis','view',true),
  ('technicien','devis','view',false),
  ('team_leader','devis','create',true),
  ('commercial','devis','create',true),
  ('technicien','devis','create',false),
  ('team_leader','devis','edit',true),
  ('commercial','devis','edit',true),
  ('technicien','devis','edit',false),
  ('team_leader','devis','delete',false),
  ('commercial','devis','delete',false),
  ('technicien','devis','delete',false),
  ('team_leader','articles','view',true),
  ('commercial','articles','view',true),
  ('technicien','articles','view',true),
  ('team_leader','articles','create',true),
  ('commercial','articles','create',false),
  ('technicien','articles','create',false),
  ('team_leader','articles','edit',true),
  ('commercial','articles','edit',false),
  ('technicien','articles','edit',false),
  ('team_leader','tasks','view',true),
  ('commercial','tasks','view',true),
  ('technicien','tasks','view',true),
  ('team_leader','tasks','create',true),
  ('commercial','tasks','create',true),
  ('technicien','tasks','create',true),
  ('team_leader','tasks','edit',true),
  ('commercial','tasks','edit',false),
  ('technicien','tasks','edit',false),
  ('team_leader','tasks','edit_own',false),
  ('commercial','tasks','edit_own',true),
  ('technicien','tasks','edit_own',false),
  ('team_leader','tasks','delete',false),
  ('commercial','tasks','delete',false),
  ('technicien','tasks','delete',false),
  ('team_leader','tasks','assign',true),
  ('commercial','tasks','assign',false),
  ('technicien','tasks','assign',false),
  ('team_leader','territoire','view',true),
  ('commercial','territoire','view',true),
  ('technicien','territoire','view',true),
  ('team_leader','meta_ads','view',false),
  ('commercial','meta_ads','view',false),
  ('technicien','meta_ads','view',false),
  ('team_leader','voice_recorder','use',true),
  ('commercial','voice_recorder','use',false),
  ('technicien','voice_recorder','use',false),
  ('team_leader','pv_calculator','view',true),
  ('commercial','pv_calculator','view',true),
  ('technicien','pv_calculator','view',false),
  ('team_leader','thermal_study','view',true),
  ('commercial','thermal_study','view',true),
  ('technicien','thermal_study','view',false),
  ('team_leader','assistant_pieces','use',true),
  ('commercial','assistant_pieces','use',true),
  ('technicien','assistant_pieces','use',true),
  ('team_leader','maintenance','view',true),
  ('commercial','maintenance','view',true),
  ('technicien','maintenance','view',true),
  ('team_leader','maintenance','edit',false),
  ('commercial','maintenance','edit',false),
  ('technicien','maintenance','edit',false),
  ('team_leader','settings','view',false),
  ('commercial','settings','view',false),
  ('technicien','settings','view',false),
  ('team_leader','settings','edit',false),
  ('commercial','settings','edit',false),
  ('technicien','settings','edit',false)
ON CONFLICT (role, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- ===============================================================================================================
-- PARTIE 2 — objets de l'assistant pièces
-- ===============================================================================================================

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Recherches : lecture membre de l'org, AUCUNE écriture directe (seules les RPC SECURITY DEFINER écrivent)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.assistant_recherches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  equipment_id uuid NOT NULL REFERENCES majordhome.equipments(id) ON DELETE CASCADE,
  intervention_id uuid NULL REFERENCES majordhome.interventions(id) ON DELETE SET NULL,
  demande text NOT NULL,
  statut text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'terminee', 'echec')),
  run_id text NULL,
  reponse jsonb NULL,
  texte_brut text NULL,
  usage jsonb NULL,
  erreur text NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL
);
COMMENT ON TABLE majordhome.assistant_recherches IS 'Recherches de pièce de l''assistant (Hermes) sur l''appareil d''un client. org_id = org CORE. Écrite par les RPC public.assistant_recherche_* (service_role) seulement ; lue par la vue public.majordhome_assistant_recherches.';
COMMENT ON COLUMN majordhome.assistant_recherches.statut IS 'en_cours (agent lancé), terminee (réponse reçue), echec (erreur ou délai dépassé).';
COMMENT ON COLUMN majordhome.assistant_recherches.run_id IS 'Identifiant du run côté agent externe, posé après le lancement, pour le balayage des recherches restées en cours.';

CREATE INDEX IF NOT EXISTS assistant_recherches_org_equipment_idx
  ON majordhome.assistant_recherches (org_id, equipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_recherches_en_cours_idx
  ON majordhome.assistant_recherches (created_at) WHERE statut = 'en_cours';

ALTER TABLE majordhome.assistant_recherches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_recherches_select ON majordhome.assistant_recherches;
CREATE POLICY assistant_recherches_select ON majordhome.assistant_recherches FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
-- Pas de policy INSERT / UPDATE / DELETE : volontaire (écritures par les RPC ci-dessous, service_role).
-- L'ACL par défaut du schéma majordhome accorde arwd à authenticated : on repart de zéro, SELECT seul.
REVOKE ALL ON majordhome.assistant_recherches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.assistant_recherches TO authenticated, service_role; -- vue security_invoker : SELECT de table requis

CREATE OR REPLACE VIEW public.majordhome_assistant_recherches WITH (security_invoker = true) AS
  SELECT r.id, r.org_id, r.equipment_id, r.intervention_id, r.demande, r.statut, r.run_id, r.reponse, r.texte_brut,
         r.usage, r.erreur, r.created_by, r.created_at, r.finished_at,
         (SELECT p.full_name FROM public.profiles p WHERE p.id = r.created_by) AS created_by_name
  FROM majordhome.assistant_recherches r;
-- Le schéma public (partagé) accorde tout par défaut à anon et authenticated : SELECT seul, à authenticated et service_role.
REVOKE ALL ON public.majordhome_assistant_recherches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_assistant_recherches TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Ouvrir une recherche (service_role) : l'org est contrôlée sur l'utilisateur, l'équipement et l'intervention
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assistant_recherche_ouvrir(
  p_org_id uuid,
  p_equipment_id uuid,
  p_intervention_id uuid,
  p_demande text,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_demande text := btrim(p_demande);
  v_eq_org uuid;
  v_inter_org uuid;
  v_id uuid;
BEGIN
  IF (EXISTS (SELECT 1 FROM core.organization_members om
              WHERE om.org_id = p_org_id AND om.user_id = p_user_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- org de l'équipement = org CORE de son projet (même dérivation que les vues et RPC équipements)
  SELECT majordhome.project_org_id(e.project_id) INTO v_eq_org FROM majordhome.equipments e WHERE e.id = p_equipment_id;
  IF (v_eq_org = p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'equipement_introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- org de l'intervention = client OU contrat (une intervention peut n'être rattachée qu'à un contrat)
  IF p_intervention_id IS NOT NULL THEN
    SELECT COALESCE(c.org_id, ct.org_id) INTO v_inter_org
    FROM majordhome.interventions i
    LEFT JOIN majordhome.clients c ON c.id = i.client_id
    LEFT JOIN majordhome.contracts ct ON ct.id = i.contract_id
    WHERE i.id = p_intervention_id;
    IF (v_inter_org = p_org_id) IS NOT TRUE THEN
      RAISE EXCEPTION 'intervention_introuvable' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF (char_length(v_demande) BETWEEN 1 AND 500) IS NOT TRUE THEN
    RAISE EXCEPTION 'demande_invalide' USING ERRCODE = '22023';
  END IF;

  INSERT INTO majordhome.assistant_recherches (org_id, equipment_id, intervention_id, demande, created_by)
  VALUES (p_org_id, p_equipment_id, p_intervention_id, v_demande, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assistant_recherche_ouvrir(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_recherche_ouvrir(uuid, uuid, uuid, text, uuid) TO service_role;
COMMENT ON FUNCTION public.assistant_recherche_ouvrir(uuid, uuid, uuid, text, uuid) IS
  'Ouvre une recherche de pièce (service_role) : p_user_id membre de p_org_id (org CORE), équipement et intervention de la même org, demande de 1 à 500 caractères. Rend l''id de la recherche, en_cours.';

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Attacher le run de l'agent (service_role) : seulement tant que la recherche est en cours
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assistant_recherche_attacher_run(p_id uuid, p_run_id text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  IF (EXISTS (SELECT 1 FROM majordhome.assistant_recherches r WHERE r.id = p_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'recherche_introuvable' USING ERRCODE = 'P0002';
  END IF;
  UPDATE majordhome.assistant_recherches r SET run_id = p_run_id
  WHERE r.id = p_id AND r.statut = 'en_cours';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assistant_recherche_attacher_run(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_recherche_attacher_run(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Clore une recherche (service_role) : une seule fois ; faux si déjà close (ou inconnue), rien n'est changé
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assistant_recherche_clore(
  p_id uuid,
  p_statut text,
  p_reponse jsonb,
  p_texte text,
  p_usage jsonb,
  p_erreur text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_n int;
BEGIN
  IF (p_statut IN ('terminee', 'echec')) IS NOT TRUE THEN
    RAISE EXCEPTION 'statut_invalide' USING ERRCODE = '22023';
  END IF;
  UPDATE majordhome.assistant_recherches r
  SET statut = p_statut, reponse = p_reponse, texte_brut = p_texte, usage = p_usage, erreur = p_erreur, finished_at = now()
  WHERE r.id = p_id AND r.statut = 'en_cours';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assistant_recherche_clore(uuid, text, jsonb, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_recherche_clore(uuid, text, jsonb, text, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Recherches restées en cours (service_role, balayage) : les plus anciennes d'abord, 50 au plus
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assistant_recherches_en_cours()
RETURNS TABLE (id uuid, run_id text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
  SELECT r.id, r.run_id, r.created_at
  FROM majordhome.assistant_recherches r
  WHERE r.statut = 'en_cours'
  ORDER BY r.created_at
  LIMIT 50;
$$;
REVOKE EXECUTE ON FUNCTION public.assistant_recherches_en_cours() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_recherches_en_cours() TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Plafond de recherches par utilisateur et par jour (modèle : increment_equipment_enrich_quota, 20261112_5)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.assistant_quotas (
  user_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  count int NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id, date)
);
ALTER TABLE majordhome.assistant_quotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON majordhome.assistant_quotas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.assistant_quotas TO service_role;

CREATE OR REPLACE FUNCTION public.increment_assistant_quota(p_user_id uuid, p_org_id uuid, p_daily_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_count int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_user_id IS NULL OR p_org_id IS NULL THEN RAISE EXCEPTION 'user_and_org_required' USING ERRCODE = '22023'; END IF;
  INSERT INTO majordhome.assistant_quotas (user_id, org_id, date, count, last_at)
  VALUES (p_user_id, p_org_id, v_today, 1, now())
  ON CONFLICT (user_id, org_id, date) DO UPDATE SET count = majordhome.assistant_quotas.count + 1, last_at = now()
  RETURNING count INTO v_count;
  IF v_count > p_daily_limit THEN
    RAISE EXCEPTION 'assistant_quota_exceeded' USING ERRCODE = 'P0001', HINT = 'assistant_quota_exceeded';
  END IF;
  RETURN jsonb_build_object('count', v_count, 'limit', p_daily_limit, 'date', v_today);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.increment_assistant_quota(uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_assistant_quota(uuid, uuid, int) TO service_role;
