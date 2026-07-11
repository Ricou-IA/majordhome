-- Module consentement & signature (dossier PV) — bloc jsonb par dossier.
-- ⚠️ La vue publique majordhome_pv_dossiers est CREATE VIEW … AS SELECT * : le `*` est FIGÉ à la
-- création (expansion stockée dans pg_rewrite). Une colonne ajoutée ensuite à la table de base
-- N'APPARAÎT PAS dans la vue tant qu'on ne fait pas CREATE OR REPLACE VIEW … AS SELECT *
-- (gotcha maison, cf. grand_secteur : ajout autorisé uniquement EN FIN de liste, ce qui est le cas).
-- Sans cette recréation, patchBlock({consent}) échoue « column consent does not exist » et
-- getBySimulation ne renvoie jamais le bloc → module non-fonctionnel en prod.
ALTER TABLE majordhome.pv_dossiers ADD COLUMN IF NOT EXISTS consent jsonb;

CREATE OR REPLACE VIEW public.majordhome_pv_dossiers
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.pv_dossiers;

NOTIFY pgrst, 'reload schema';

-- Vérification :
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='majordhome_pv_dossiers' AND column_name='consent';
