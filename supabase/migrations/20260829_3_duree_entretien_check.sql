-- 20260829_3_duree_entretien_check.sql
-- Filet en base sur les durées d'entretien.
--
-- `duration_base_minutes` NULL signifie « type non entretenu » (travaux,
-- prestations) — c'est légitime et le moteur retombe alors sur son fallback
-- par catégorie. En revanche une durée de ZÉRO est toujours une faute de saisie :
-- le moteur la prendrait au sérieux et empilerait des rendez-vous sans réserver
-- de temps, faisant déborder la journée sans qu'aucune alerte ne se déclenche.
-- L'écran borne déjà la saisie ; ce CHECK est la défense en profondeur, car les
-- écritures peuvent aussi venir d'un import ou d'une correction manuelle.

ALTER TABLE majordhome.pricing_equipment_types
  DROP CONSTRAINT IF EXISTS pricing_equipment_types_duration_base_positive;

ALTER TABLE majordhome.pricing_equipment_types
  ADD CONSTRAINT pricing_equipment_types_duration_base_positive
  CHECK (duration_base_minutes IS NULL OR duration_base_minutes > 0);

ALTER TABLE majordhome.pricing_equipment_types
  DROP CONSTRAINT IF EXISTS pricing_equipment_types_duration_per_unit_positive;

-- Zéro est ici une valeur normale (la plupart des types n'ont pas de part
-- variable) ; seul le négatif est absurde.
ALTER TABLE majordhome.pricing_equipment_types
  ADD CONSTRAINT pricing_equipment_types_duration_per_unit_positive
  CHECK (duration_per_extra_unit_minutes >= 0);
