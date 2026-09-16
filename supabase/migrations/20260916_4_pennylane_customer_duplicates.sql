-- ============================================================================
-- 20260916_4 — Doublons de fiches client Pennylane, remontés à l'org_admin
-- ============================================================================
--
-- Contexte (incident 2026-09-16) : 10 fiches customer Pennylane en double
-- (créées à la main dans l'UI PL) pointaient sur 9 clients MDH déjà liés à
-- une autre fiche. Le cron `pennylane-sync-cron` écrasait le lien chaque
-- heure (bascule perpétuelle). Il conserve désormais le lien en place et
-- SIGNALE le doublon — ici, pour que le tableau de bord de l'admin l'affiche
-- au lieu d'un journal que personne ne lit.
--
-- Table = projection écrite par le cron uniquement (RPC service_role only,
-- remplacement de la liste de l'org d'un bloc : une fiche fusionnée dans
-- Pennylane disparaît toute seule au passage suivant). Lecture membre via la
-- vue publique majordhome_pennylane_customer_duplicates (security_invoker).
-- ============================================================================

CREATE TABLE IF NOT EXISTS majordhome.pennylane_customer_duplicates (
  org_id               uuid        NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  pennylane_id         bigint      NOT NULL,           -- la fiche PL en double (non liée)
  client_id            uuid        NOT NULL,           -- le client MDH qu'elle a matché
  mapped_pennylane_id  bigint      NOT NULL,           -- la fiche PL déjà liée à ce client
  pl_name              text,
  pl_email             text,
  pl_phone             text,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, pennylane_id)
);

CREATE INDEX IF NOT EXISTS idx_pl_customer_duplicates_client
  ON majordhome.pennylane_customer_duplicates (org_id, client_id);

ALTER TABLE majordhome.pennylane_customer_duplicates ENABLE ROW LEVEL SECURITY;

-- Lecture au niveau membre. Aucune policy d'écriture : seul le cron écrit,
-- via la RPC SECURITY DEFINER ci-dessous.
DROP POLICY IF EXISTS plcd_select ON majordhome.pennylane_customer_duplicates;
CREATE POLICY plcd_select ON majordhome.pennylane_customer_duplicates
  FOR SELECT USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

-- Vue publique : miroir simple, pas de JOIN (gotcha majordhome_appointments).
-- Le nom du client MDH est résolu côté front (useClient / liste clients).
DROP VIEW IF EXISTS public.majordhome_pennylane_customer_duplicates;
CREATE VIEW public.majordhome_pennylane_customer_duplicates
  WITH (security_invoker = true) AS
  SELECT org_id, pennylane_id, client_id, mapped_pennylane_id,
         pl_name, pl_email, pl_phone, first_seen_at, last_seen_at
  FROM majordhome.pennylane_customer_duplicates;

GRANT SELECT ON majordhome.pennylane_customer_duplicates TO service_role;
GRANT SELECT ON public.majordhome_pennylane_customer_duplicates TO authenticated;
REVOKE ALL ON public.majordhome_pennylane_customer_duplicates FROM anon;

-- ----------------------------------------------------------------------------
-- RPC : remplace la liste des doublons de l'org par celle du passage courant.
-- p_rows : [{ pennylane_id, client_id, mapped_pennylane_id, pl_name, pl_email, pl_phone }]
-- Retour : { inserted, updated, removed }.
-- service_role ONLY : p_org_id vient du payload, sans auth.uid() (posture serveur).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pennylane_customer_duplicates_replace(p_org_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_inserted int := 0;
  v_updated  int := 0;
  v_removed  int := 0;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows_must_be_array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE tmp_pl_dups ON COMMIT DROP AS
    SELECT DISTINCT ON ((r->>'pennylane_id')::bigint)
           (r->>'pennylane_id')::bigint        AS pennylane_id,
           (r->>'client_id')::uuid             AS client_id,
           (r->>'mapped_pennylane_id')::bigint AS mapped_pennylane_id,
           NULLIF(r->>'pl_name', '')           AS pl_name,
           NULLIF(r->>'pl_email', '')          AS pl_email,
           NULLIF(r->>'pl_phone', '')          AS pl_phone
    FROM jsonb_array_elements(p_rows) r
    WHERE r->>'pennylane_id' IS NOT NULL
      AND r->>'client_id' IS NOT NULL
      AND r->>'mapped_pennylane_id' IS NOT NULL;

  -- Disparus du passage courant (fusionnés / supprimés dans Pennylane) → retirés.
  WITH del AS (
    DELETE FROM majordhome.pennylane_customer_duplicates d
    WHERE d.org_id = p_org_id
      AND NOT EXISTS (SELECT 1 FROM tmp_pl_dups t WHERE t.pennylane_id = d.pennylane_id)
    RETURNING 1
  ) SELECT count(*) INTO v_removed FROM del;

  WITH up AS (
    INSERT INTO majordhome.pennylane_customer_duplicates AS d
      (org_id, pennylane_id, client_id, mapped_pennylane_id, pl_name, pl_email, pl_phone)
    SELECT p_org_id, pennylane_id, client_id, mapped_pennylane_id, pl_name, pl_email, pl_phone
    FROM tmp_pl_dups
    ON CONFLICT (org_id, pennylane_id) DO UPDATE SET
      client_id           = EXCLUDED.client_id,
      mapped_pennylane_id = EXCLUDED.mapped_pennylane_id,
      pl_name             = COALESCE(EXCLUDED.pl_name, d.pl_name),
      pl_email            = COALESCE(EXCLUDED.pl_email, d.pl_email),
      pl_phone            = COALESCE(EXCLUDED.pl_phone, d.pl_phone),
      last_seen_at        = now()
    RETURNING (xmax = 0) AS is_insert
  )
  SELECT count(*) FILTER (WHERE is_insert), count(*) FILTER (WHERE NOT is_insert)
    INTO v_inserted, v_updated
  FROM up;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'removed', v_removed);
END;
$function$;

REVOKE ALL ON FUNCTION public.pennylane_customer_duplicates_replace(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_customer_duplicates_replace(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.pennylane_customer_duplicates_replace(uuid, jsonb) IS
  'Remplace d''un bloc la liste des fiches Pennylane en double de l''org (edge pennylane-sync-cron). service_role only.';
