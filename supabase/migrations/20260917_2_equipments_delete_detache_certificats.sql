-- ============================================================================
-- 20260917_2 — Supprimer un équipement ne doit plus être bloqué par son certificat
-- ============================================================================
-- Constat (fiche client MATHIEU SYLVIE, 2026-09-17) : « Supprimer » sur un
-- équipement renvoie 409 (PostgREST ← 23503 foreign_key_violation) et l'UI
-- affiche pourtant « Équipement supprimé » (mutation qui n'unwrap pas l'erreur,
-- corrigée côté front dans le même commit). Cause : `certificats.equipment_id`
-- et `service_requests.equipment_id` référencent `equipments` en
-- ON DELETE NO ACTION (omission de `sql/migration_certificats.sql`), alors que
-- toutes les autres références « historiques » vers un équipement sont en
-- SET NULL (`interventions.equipment_id`, `contract_pricing_items.equipment_id`).
-- 56 équipements sur 912 — tout équipement passé par un entretien certifié —
-- étaient devenus insupprimables.
--
-- Règle : le certificat est une ARCHIVE (PDF en storage ; marque, modèle,
-- n° de série, puissance… snapshotés à l'émission ; 24 certificats vivent déjà
-- sans lien équipement). `equipment_id` n'y est qu'un raccourci de
-- pré-sélection dans le wizard : supprimer l'équipement le détache, ne supprime
-- rien. Même logique pour une demande SAV (sujet / description portés par la ligne).
--
-- Idempotent (DROP IF EXISTS + ADD dans un même ALTER, atomique).
-- Critère de succès : confdeltype = 'n' pour les 2 contraintes —
--   SELECT conname, confdeltype FROM pg_constraint
--   WHERE confrelid = 'majordhome.equipments'::regclass;
-- ============================================================================

-- Échouer vite plutôt que bloquer les écritures derrière une transaction longue.
SET lock_timeout = '5s';

ALTER TABLE majordhome.certificats
  DROP CONSTRAINT IF EXISTS certificats_equipment_id_fkey,
  ADD CONSTRAINT certificats_equipment_id_fkey
    FOREIGN KEY (equipment_id) REFERENCES majordhome.equipments(id) ON DELETE SET NULL;

ALTER TABLE majordhome.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_equipment_id_fkey,
  ADD CONSTRAINT service_requests_equipment_id_fkey
    FOREIGN KEY (equipment_id) REFERENCES majordhome.equipments(id) ON DELETE SET NULL;

-- Colonne FK sans index : le SET NULL en cascade parcourt la table référençante.
-- (`certificats.equipment_id` a déjà `idx_certificats_equipment_id`.)
CREATE INDEX IF NOT EXISTS idx_service_requests_equipment_id
  ON majordhome.service_requests (equipment_id);
