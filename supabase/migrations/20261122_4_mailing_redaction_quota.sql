-- 20261122_4_mailing_redaction_quota.sql
-- ============================================================================
-- Plafond de la rédaction assistée des e-mails (edge `mailing-rediger`) : au plus N rédactions par
-- utilisateur, par organisation et par jour (UTC), N valant 50 par défaut (secret MAILING_REDACTION_DAILY_LIMIT).
-- Pourquoi : chaque rédaction est un appel payant au modèle de langage ; sans plafond, un compte (ou un script
-- avec le jeton d'un compte) peut vider le budget de la plateforme. Même forme que
-- `increment_equipment_enrich_quota` (20261112_5).
--
-- Écrivain unique : la fonction ci-dessous, réservée à `service_role` (l'edge l'appelle pour un utilisateur déjà
-- validé par `requireOrgMembership`). La table n'a aucune policy : RLS activée, aucun droit pour les rôles
-- applicatifs. Garde positive : une limite NULL ou négative retombe sur le défaut (un `count > NULL` vaut NULL
-- et ouvrirait le plafond en grand).
--
-- Vérifier : node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261122_4_mailing_redaction_quota.sql \
--            --assert scripts/migration-rehearsal/assert-mailing-redaction-quota.sql
-- En prod : has_function_privilege('anon', 'public.increment_mailing_redaction_quota(uuid, uuid, int)', 'EXECUTE')
--           (et 'authenticated') doit rendre faux, 'service_role' vrai.
-- ============================================================================

CREATE TABLE IF NOT EXISTS majordhome.mailing_redaction_quotas (
  user_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  count int NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id, date)
);
ALTER TABLE majordhome.mailing_redaction_quotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON majordhome.mailing_redaction_quotas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.mailing_redaction_quotas TO service_role;

CREATE OR REPLACE FUNCTION public.increment_mailing_redaction_quota(p_user_id uuid, p_org_id uuid, p_daily_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_count int;
  v_limit int := CASE WHEN p_daily_limit IS NULL OR p_daily_limit < 0 THEN 50 ELSE p_daily_limit END;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_user_id IS NULL OR p_org_id IS NULL THEN RAISE EXCEPTION 'user_and_org_required' USING ERRCODE = '22023'; END IF;
  INSERT INTO majordhome.mailing_redaction_quotas (user_id, org_id, date, count, last_at)
  VALUES (p_user_id, p_org_id, v_today, 1, now())
  ON CONFLICT (user_id, org_id, date) DO UPDATE SET count = majordhome.mailing_redaction_quotas.count + 1, last_at = now()
  RETURNING count INTO v_count;
  IF v_count > v_limit THEN
    RAISE EXCEPTION 'mailing_redaction_quota_exceeded' USING ERRCODE = 'P0001', HINT = 'mailing_redaction_quota_exceeded';
  END IF;
  RETURN jsonb_build_object('count', v_count, 'limit', v_limit, 'date', v_today);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.increment_mailing_redaction_quota(uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_mailing_redaction_quota(uuid, uuid, int) TO service_role;
