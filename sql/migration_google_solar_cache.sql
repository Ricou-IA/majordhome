-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Google Solar — cache write-through (tranche 1, plan 2/4). Spec §5.3.
-- Un toit est stable → coût marginal 0 pour toute ré-simulation sur la même adresse.
-- Cache partagé PAR ORG (pas par dossier). Écrit par l'edge google-solar-proxy (service_role),
-- lu par le front pour le quota (vue security_invoker). Pas de TTL (donnée quasi statique).
-- Pattern : miroir RLS/vue de majordhome.pv_dossiers (charte multi-tenant CLAUDE.md).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Migration 1 : google_solar_cache_create ─────────────────────────────────────────────────────
CREATE TABLE majordhome.google_solar_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),

  -- clé de cache = coord arrondies 5 décimales "lat_lon" (lookup AVANT tout appel Google).
  building_key text NOT NULL,
  building_name text,               -- solarPotential name Google (traçabilité), nullable

  building_insights jsonb,          -- réponse parsée { imageryQuality, segments:[...], dominant:{...} }
  imagery_quality text,             -- HIGH|MEDIUM|LOW|BASE (valeur réelle Google, cf. spike Task 1)
  flux_image_path text,             -- chemin Storage product-documents du PNG flux, nullable

  fetched_at timestamptz,           -- dernier fetch Building Insights (compteur quota SKU BI)
  flux_fetched_at timestamptz,      -- dernier fetch Data Layers/flux (compteur quota SKU DL)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT google_solar_cache_org_key_uq UNIQUE (org_id, building_key)
);

CREATE INDEX idx_gsc_org_fetched ON majordhome.google_solar_cache(org_id, fetched_at);
CREATE INDEX idx_gsc_org_flux    ON majordhome.google_solar_cache(org_id, flux_fetched_at);

ALTER TABLE majordhome.google_solar_cache ENABLE ROW LEVEL SECURITY;

-- SELECT = membre de l'org (le front lit pour le quota ; l'edge service_role bypasse la RLS).
CREATE POLICY gsc_select ON majordhome.google_solar_cache
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

-- Pas d'écriture directe depuis le front : INSERT/UPDATE réservés au service_role (edge write-through).
GRANT SELECT ON majordhome.google_solar_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE ON majordhome.google_solar_cache TO service_role;

-- ── Migration 2 : google_solar_cache_public_view ────────────────────────────────────────────────
-- Miroir simple mono-table (pas de JOIN) → auto-updatable ; l'edge écrit via cette vue.
CREATE VIEW public.majordhome_google_solar_cache
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.google_solar_cache;

GRANT SELECT ON public.majordhome_google_solar_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.majordhome_google_solar_cache TO service_role;
