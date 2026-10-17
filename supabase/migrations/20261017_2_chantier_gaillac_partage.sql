-- 20261017_2_chantier_gaillac_partage.sql
-- Chantier Gaillac (module PROVISOIRE) : lien de partage externe en LECTURE SEULE.
--
-- Un lien secret /gaillac/<token> ouvre le suivi sans compte. L'externe voit : n°, site, adresse,
-- action, thème, technicien, journée, statut (fait / date de validation). Masqué (décision Eric
-- 2026-10-17) : durées, achat / stock, observations, commentaires terrain, auteur de la validation.
--
-- Sécurité :
--   - un seul lien actif ; régénérer révoque l'ancien ;
--   - table sans aucun accès direct (ni anon, ni authenticated) : tout passe par deux RPC ;
--   - chantier_gaillac_partage_lire : SEULE fonction ouverte à anon, lecture, garde positive sur le
--     token (64 hex, 2 × gen_random_uuid) ; ne renvoie que les colonnes ci-dessus ;
--   - chantier_gaillac_partage_gerer : org_admin Mayer seul (auth.uid() NULL ⇒ refus).

CREATE TABLE IF NOT EXISTS majordhome.chantier_gaillac_partage (
  token       text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);

ALTER TABLE majordhome.chantier_gaillac_partage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON majordhome.chantier_gaillac_partage FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Lecture externe
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_gaillac_partage_lire(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ok boolean;
BEGIN
  v_ok := p_token IS NOT NULL
      AND EXISTS (SELECT 1 FROM majordhome.chantier_gaillac_partage WHERE token = p_token);
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'techniciens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', tm.id, 'display_name', tm.display_name, 'first_name', tm.first_name)
                       ORDER BY tm.display_name)
      FROM majordhome.team_members tm
      WHERE tm.id IN (SELECT DISTINCT technicien_id FROM majordhome.chantier_gaillac_planning WHERE technicien_id IS NOT NULL)
    ), '[]'::jsonb),
    'planning', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', p.code, 'ordre', p.ordre, 'libelle', p.libelle,
                                          'technicien_id', p.technicien_id, 'date_prevue', p.date_prevue)
                       ORDER BY p.ordre)
      FROM majordhome.chantier_gaillac_planning p
    ), '[]'::jsonb),
    'taches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'numero', t.numero, 'ordre', t.ordre, 'site', t.site,
                                          'adresse', t.adresse, 'zone', t.zone, 'action', t.action, 'theme', t.theme,
                                          'type_ligne', t.type_ligne, 'technicien_id', t.technicien_id,
                                          'planning_code', t.planning_code, 'fait', t.fait, 'fait_le', t.fait_le)
                       ORDER BY t.ordre)
      FROM majordhome.chantier_gaillac_taches t
    ), '[]'::jsonb),
    'lu_le', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.chantier_gaillac_partage_lire(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chantier_gaillac_partage_lire(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Gestion du lien (admin) : 'lire' | 'generer' | 'revoquer' → token actif ou NULL
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_gaillac_partage_gerer(p_action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF majordhome.cg_is_admin('7825fe43-cacb-4feb-b783-6ea3f1ccff77') IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'generer' THEN
    DELETE FROM majordhome.chantier_gaillac_partage WHERE true;
    v_token := replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO majordhome.chantier_gaillac_partage (token, created_by) VALUES (v_token, auth.uid());
    RETURN v_token;
  ELSIF p_action = 'revoquer' THEN
    DELETE FROM majordhome.chantier_gaillac_partage WHERE true;
    RETURN NULL;
  ELSIF p_action = 'lire' THEN
    SELECT token INTO v_token FROM majordhome.chantier_gaillac_partage ORDER BY created_at DESC LIMIT 1;
    RETURN v_token;
  END IF;
  RAISE EXCEPTION 'action_inconnue' USING ERRCODE = '22023';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.chantier_gaillac_partage_gerer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_gaillac_partage_gerer(text) TO authenticated;

-- =====================================================================
-- NETTOYAGE en fin de chantier (avec celui de 20261017_1)
-- DROP FUNCTION IF EXISTS public.chantier_gaillac_partage_lire(text);
-- DROP FUNCTION IF EXISTS public.chantier_gaillac_partage_gerer(text);
-- DROP TABLE IF EXISTS majordhome.chantier_gaillac_partage;
-- =====================================================================
