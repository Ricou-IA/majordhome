-- supabase/migrations/20260526_8_pennylane_customer_lookup.sql
-- D.5 — Cache table write-through pour les customers Pennylane.
-- Alimentée à chaque fetch /customers/{id} via pennylane.service.js
-- (fire-and-forget après le retour live).
--
-- Usage prévu :
--   1. Search "Client existant" sur création lead (bug #5 ROGERO) : la modale
--      interroge cette table EN PLUS de majordhome_clients pour trouver les
--      clients qui existent côté PL mais pas (encore) côté MDH.
--   2. Diagnostic : remonter une fiche client PL sans hit live (instant).
--   3. Évolution future : seed batch des customers fréquents par cron.
--
-- Pattern PK composite (org_id, pennylane_id) : isole le cache par org
-- (défense en profondeur contre cross-tenant même si 2 orgs MDH se
-- connectaient par erreur au même compte PL).
--
-- Brief : docs/PROMPT_PENNYLANE_MATCHING_REFACTOR.md — D.5 write-through

CREATE TABLE IF NOT EXISTS majordhome.pennylane_customer_lookup (
  org_id           UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  pennylane_id     BIGINT NOT NULL,
  name             TEXT,
  first_name       TEXT,
  last_name        TEXT,
  customer_type    TEXT,
  email            TEXT,
  phone            TEXT,
  address          TEXT,
  postal_code      TEXT,
  city             TEXT,
  external_reference TEXT,
  raw_payload      JSONB,
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, pennylane_id)
);

COMMENT ON TABLE majordhome.pennylane_customer_lookup IS
  'Cache write-through des customers Pennylane (D.5, brief PROMPT_PENNYLANE_MATCHING_REFACTOR.md). Alimenté à chaque fetch /customers/{id} via pennylane.service.js fire-and-forget.';

-- Indexes pour la recherche par nom / email / external_reference (lower() est
-- IMMUTABLE, unaccent ne l'est pas → unaccent en runtime dans la query).
CREATE INDEX IF NOT EXISTS idx_pennylane_customer_lookup_name_search
  ON majordhome.pennylane_customer_lookup (org_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_pennylane_customer_lookup_last_name_search
  ON majordhome.pennylane_customer_lookup (org_id, lower(last_name));
CREATE INDEX IF NOT EXISTS idx_pennylane_customer_lookup_email
  ON majordhome.pennylane_customer_lookup (org_id, lower(email))
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pennylane_customer_lookup_external_ref
  ON majordhome.pennylane_customer_lookup (org_id, external_reference)
  WHERE external_reference IS NOT NULL;

-- RLS
ALTER TABLE majordhome.pennylane_customer_lookup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pennylane_customer_lookup_org_members
  ON majordhome.pennylane_customer_lookup;
CREATE POLICY pennylane_customer_lookup_org_members
  ON majordhome.pennylane_customer_lookup
  FOR ALL
  USING (org_id IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  ))
  WITH CHECK (org_id IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  ));

-- Vue publique pour accès frontend (PostgREST n'expose pas majordhome)
DROP VIEW IF EXISTS public.majordhome_pennylane_customer_lookup;
CREATE VIEW public.majordhome_pennylane_customer_lookup
WITH (security_invoker = true) AS
SELECT
  pcl.org_id,
  pcl.pennylane_id,
  pcl.name,
  pcl.first_name,
  pcl.last_name,
  pcl.customer_type,
  pcl.email,
  pcl.phone,
  pcl.address,
  pcl.postal_code,
  pcl.city,
  pcl.external_reference,
  pcl.last_seen,
  pcl.created_at
FROM majordhome.pennylane_customer_lookup pcl;

COMMENT ON VIEW public.majordhome_pennylane_customer_lookup IS
  'Vue publique du cache lookup customers PL (D.5). RLS via security_invoker hérite des policies de la table source.';

GRANT SELECT ON public.majordhome_pennylane_customer_lookup TO authenticated;
