-- ============================================================================
-- 20261010_2 — Vue de lecture « parc sous contrat » (Dashboard Entretiens)
-- ============================================================================
-- Une ligne par (contrat, équipement lié) avec le type et la catégorie
-- (famille d'intervention) de l'équipement, et l'org + le statut du contrat
-- pour filtrer côté front (.eq('org_id', …).eq('contract_status', 'active')).
-- security_invoker : la RLS de contracts / contract_equipments / equipments
-- s'applique. Lecture seule (JOIN), aucune écriture possible.
-- Les contrats SANS équipement lié apparaissent avec equipment_id NULL
-- (LEFT JOIN) : le tableau de bord doit les compter, pas les cacher.
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_contract_parc WITH (security_invoker = true) AS
SELECT
  ct.org_id,
  ct.id                                   AS contract_id,
  ct.status                               AS contract_status,
  ct.amount                               AS contract_amount,
  e.id                                    AS equipment_id,
  e.equipment_type_id,
  COALESCE(t.category_id, e.category_id)  AS category_id
FROM majordhome.contracts ct
LEFT JOIN majordhome.contract_equipments ce ON ce.contract_id = ct.id
LEFT JOIN majordhome.equipments e            ON e.id = ce.equipment_id
LEFT JOIN majordhome.pricing_equipment_types t ON t.id = e.equipment_type_id;

COMMENT ON VIEW public.majordhome_contract_parc IS
  'Parc sous contrat : 1 ligne par (contrat, équipement lié), type + catégorie résolus. security_invoker, lecture seule. Dashboard Entretiens (2026-10-10).';

GRANT SELECT ON public.majordhome_contract_parc TO authenticated, service_role;
REVOKE ALL ON public.majordhome_contract_parc FROM anon;
