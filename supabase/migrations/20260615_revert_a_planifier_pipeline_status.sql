-- supabase/migrations/20260615_revert_a_planifier_pipeline_status.sql
-- ============================================================================
-- Revert du statut pipeline "À planifier" (regression module Webshop)
-- ============================================================================
-- La migration 20260612190136_webshop_module_bornes_irve avait inséré un statut
-- de lead "À planifier" (display_order=5) dans majordhome.statuses, en décalant
-- Gagné(->6) et Perdu(->7). Deux régressions sur le Pipeline Kanban commercial :
--   1. Colonne fantôme "À planifier" (0 lead) — ce statut de planification n'a
--      pas sa place dans le funnel commercial (relève du chantier/entretien).
--   2. SILENCIEUSE : la vue public.majordhome_kanban_cards dérive la colonne des
--      leads SANS devis Pennylane via un CASE codé en dur sur display_order
--      (WHEN 5 THEN 'gagne', WHEN 6 THEN 'perdu'). Le décalage a donc mappé
--      Gagné(6)->'perdu' et Perdu(7)->'unknown' : 75 leads "Perdu" devenus
--      invisibles au Kanban + 1 "Gagné" affiché en "Perdu".
--
-- Fix : supprimer le statut "À planifier" et restaurer Gagné=5 / Perdu=6.
-- Restaurer les positions répare la vue automatiquement (pas de modif de vue).
-- Idempotent : re-jouable sans effet de bord (DELETE 0 row / UPDATE no-op).
-- ============================================================================

-- 1. Supprimer le lead de test rattaché à ce statut (sinon la FK bloque le DELETE du statut)
DELETE FROM majordhome.leads
WHERE id = 'bb5f6f37-a6ff-4557-a236-6e230a9021ba';

-- 2. Supprimer le statut "À planifier"
DELETE FROM majordhome.statuses
WHERE id = 'b7e6a3d2-4c0f-4e8a-9d21-3f5b8c7a1e90';

-- 3. Restaurer l'ordre d'origine du pipeline commercial
UPDATE majordhome.statuses SET display_order = 5 WHERE label = 'Gagné';
UPDATE majordhome.statuses SET display_order = 6 WHERE label = 'Perdu';
