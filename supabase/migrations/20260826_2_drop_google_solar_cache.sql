-- Purge Google Solar (pivot IGN LiDAR validé 2026-07-06, frontend purgé 2026-08-26
-- commit 5782429 : googleSolar*.js, Roof3DViewer, FluxHeatmap, useGoogleSolar,
-- googleSolar.service supprimés). La table n'était qu'un cache write-through des
-- réponses API Google (32 lignes jetables, données 2014 périmées sur la zone Mayer).
-- Vérifié avant drop : seule sa propre vue publique en dépendait, aucune fonction
-- ne la référence, aucun consommateur site vitrine. L'edge google-solar-proxy
-- (dernier écrivain) est à supprimer du déploiement séparément (dashboard).
DROP VIEW public.majordhome_google_solar_cache;
DROP TABLE majordhome.google_solar_cache;
