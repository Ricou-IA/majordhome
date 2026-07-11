-- Module consentement & signature (dossier PV) — bloc jsonb par dossier.
-- La vue publique majordhome_pv_dossiers est SELECT * mono-table (auto-updatable) :
-- la colonne ajoutée en fin de table y remonte sans recréation. NE PAS recréer la vue.
-- Aucune RLS/GRANT à ajouter : héritées de la table (RLS owner-or-admin, GRANT SELECT service_role).
ALTER TABLE majordhome.pv_dossiers ADD COLUMN IF NOT EXISTS consent jsonb;

-- Vérification :
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='majordhome' AND table_name='pv_dossiers' AND column_name='consent';
