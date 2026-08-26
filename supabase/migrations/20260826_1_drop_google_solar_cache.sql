-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Retrait Google Solar — DROP du cache DB (2026-08-26).
--
-- Contexte : le frontend Google Solar a été purgé (commit 5782429, pivot IGN LiDAR HD validé —
-- données Google 2014 périmées + sous-détection zone Mayer, mémoire project_solaire_roof_geometry_ign).
-- L'edge function google-solar-proxy est retirée du repo dans le même commit que cette migration.
-- Appelants vérifiés le 2026-08-26 : aucun dans Frontend-Majordhome (post-purge), aucun dans le
-- site vitrine (C:\Dev\Landing Page - Mayer). Le quota Google Solar était suivi via les colonnes
-- fetched_at / flux_fetched_at de cette même table (pas de table de quota séparée, pas de RPC).
--
-- Sans risque vis-à-vis du gotcha DROP/Exposed schemas : on droppe une vue de `public` et une
-- table de `majordhome`, AUCUN schéma. Les policies RLS et index tombent avec la table.
-- Le code reste récupérable via git si l'incrément 3 (ombrage/3D) veut en reprendre un morceau.
--
-- ⚠️ À appliquer par Eric sur l'instance partagée (pas d'auto-apply).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.majordhome_google_solar_cache;
DROP TABLE IF EXISTS majordhome.google_solar_cache;
