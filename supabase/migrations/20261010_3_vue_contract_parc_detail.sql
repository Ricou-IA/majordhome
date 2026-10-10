-- ============================================================================
-- 20261010_3 — Vue « parc sous contrat » : descente jusqu'au client
-- ============================================================================
-- Ajoute (EN FIN de liste, CREATE OR REPLACE l'exige) le n° de contrat, le
-- client (id, nom, ville) et la marque / le modèle de l'équipement, pour
-- l'arborescence Famille → Type → Marque → Modèle → Contrat du Dashboard.
-- Toujours security_invoker, lecture seule.
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_contract_parc WITH (security_invoker = true) AS
SELECT
  ct.org_id,
  ct.id                                   AS contract_id,
  ct.status                               AS contract_status,
  ct.amount                               AS contract_amount,
  e.id                                    AS equipment_id,
  e.equipment_type_id,
  COALESCE(t.category_id, e.category_id)  AS category_id,
  ct.contract_number,
  ct.client_id,
  cl.display_name                         AS client_name,
  cl.city                                 AS client_city,
  e.brand,
  e.model
FROM majordhome.contracts ct
LEFT JOIN majordhome.clients cl              ON cl.id = ct.client_id
LEFT JOIN majordhome.contract_equipments ce  ON ce.contract_id = ct.id
LEFT JOIN majordhome.equipments e            ON e.id = ce.equipment_id
LEFT JOIN majordhome.pricing_equipment_types t ON t.id = e.equipment_type_id;

COMMENT ON VIEW public.majordhome_contract_parc IS
  'Parc sous contrat : 1 ligne par (contrat, équipement lié), type + catégorie résolus, client, marque, modèle. security_invoker, lecture seule. Dashboard Entretiens (2026-10-10).';
