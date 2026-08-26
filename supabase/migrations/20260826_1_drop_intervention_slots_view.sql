-- Stage 5 Bloc B (refonte RDV↔Kanban) — fin du nettoyage post-convergence chantier.
-- Le frontend n'a plus aucun lecteur (chantierSlots.service.js et les méthodes slots
-- supprimés le 2026-08-26, commit fa3bd30). Les 5 slots historiques ne sont pas migrés
-- (décision Eric : repartir propre) — les lignes majordhome.interventions restent.
-- Vérifié avant drop : aucune vue dépendante, aucune fonction ne référence la vue,
-- aucun consommateur côté site vitrine ni edge functions.
DROP VIEW public.majordhome_intervention_slots;
