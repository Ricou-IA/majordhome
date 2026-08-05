-- 20260805_1_pennylane_quote_dismissals.sql
-- Écartement manuel d'un devis Pennylane de l'explorateur (« hors pipeline »).
-- Réversible : réintégrer = supprimer la ligne.
-- Spec : docs/superpowers/specs/2026-08-05-devis-pl-non-rattaches-design.md

CREATE TABLE IF NOT EXISTS majordhome.pennylane_quote_dismissals (
  org_id             uuid        NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  pennylane_quote_id bigint      NOT NULL,  -- aligné sur lead_pennylane_quotes.pennylane_quote_id
  reason             text,
  dismissed_by       uuid,
  dismissed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, pennylane_quote_id)
);

ALTER TABLE majordhome.pennylane_quote_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pqd_select ON majordhome.pennylane_quote_dismissals;
CREATE POLICY pqd_select ON majordhome.pennylane_quote_dismissals
  FOR SELECT USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

DROP POLICY IF EXISTS pqd_insert ON majordhome.pennylane_quote_dismissals;
CREATE POLICY pqd_insert ON majordhome.pennylane_quote_dismissals
  FOR INSERT WITH CHECK (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

DROP POLICY IF EXISTS pqd_delete ON majordhome.pennylane_quote_dismissals;
CREATE POLICY pqd_delete ON majordhome.pennylane_quote_dismissals
  FOR DELETE USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

-- Vue publique : miroir simple => auto-updatable (INSERT/DELETE via PostgREST,
-- pas de RPC). NE PAS y ajouter de JOIN/LATERAL : la vue perdrait
-- is_insertable_into (cf. gotcha majordhome_appointments dans CLAUDE.md).
DROP VIEW IF EXISTS public.majordhome_pennylane_quote_dismissals;
CREATE VIEW public.majordhome_pennylane_quote_dismissals
  WITH (security_invoker = true) AS
  SELECT org_id, pennylane_quote_id, reason, dismissed_by, dismissed_at
  FROM majordhome.pennylane_quote_dismissals;

-- Règle CLAUDE.md : sans ce GRANT, toute edge function lisant la vue plante en
-- 42501 permission denied SILENCIEUX (la vue est security_invoker).
GRANT SELECT ON majordhome.pennylane_quote_dismissals TO service_role;
GRANT SELECT, INSERT, DELETE ON public.majordhome_pennylane_quote_dismissals TO authenticated;
