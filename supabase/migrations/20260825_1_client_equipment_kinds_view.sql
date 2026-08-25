-- 20260825_1_client_equipment_kinds_view.sql
-- Vue read-only : équipements par client pour l'identité visuelle entretien
-- (icônes bûche/flamme/flocon sur cartes clients, cartes contrats, Programmation,
-- planning). Le classement en « kind » est fait côté front (src/lib/equipmentIcons.js,
-- source unique du mapping) — la vue expose seulement les données brutes.
--
-- Lecture seule assumée (JOIN → non updatable, aucune écriture prévue).
-- security_invoker : RLS clients + equipments + pricing_equipment_types s'applique.

DROP VIEW IF EXISTS public.majordhome_client_equipment_kinds;
CREATE VIEW public.majordhome_client_equipment_kinds
  WITH (security_invoker = true) AS
  SELECT
    c.id            AS client_id,
    c.org_id,
    e.id            AS equipment_id,
    e.category::text AS category,
    pet.code        AS type_code,
    pet.label       AS type_label
  FROM majordhome.clients c
  JOIN majordhome.equipments e ON e.project_id = c.project_id
  LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = e.equipment_type_id
  WHERE e.status = 'active';

GRANT SELECT ON public.majordhome_client_equipment_kinds TO authenticated;
