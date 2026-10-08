-- Module Démarches administratives PV (spec 2026-10-08) — bloc jsonb par dossier :
--   demarches = { inputs, resultat (figé, engine_version), pieces_statut, mis_a_jour_le }
-- ⚠️ La vue publique majordhome_pv_dossiers est CREATE VIEW … AS SELECT * : le `*` est FIGÉ à la
-- création (expansion stockée dans pg_rewrite). Une colonne ajoutée ensuite à la table de base
-- N'APPARAÎT PAS dans la vue tant qu'on ne fait pas CREATE OR REPLACE VIEW … AS SELECT *
-- (gotcha vécu avec `consent`, cf. sql/migration_pv_dossiers_consent.sql). Colonne ajoutée EN FIN
-- de liste, ce qu'exige CREATE OR REPLACE VIEW.
ALTER TABLE majordhome.pv_dossiers ADD COLUMN IF NOT EXISTS demarches jsonb;

CREATE OR REPLACE VIEW public.majordhome_pv_dossiers
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.pv_dossiers;

NOTIFY pgrst, 'reload schema';

-- Vérification :
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='majordhome_pv_dossiers' AND column_name='demarches';
