-- ============================================================================
-- 20261115_1 — planning_ca_affaires : données du CA HT programmé en UN appel
-- ============================================================================
-- Le Planning affiche le CA HT des affaires programmées (un chiffre par jour, la
-- part de chaque technicien). Le chargement faisait trois allers-retours en
-- cascade APRÈS l'arrivée des RDV (chantiers / interventions → contrats →
-- équipements) : le chiffre arrivait 0,5 s après les blocs (mesuré 2026-11-15).
-- Cette fonction rend tout en un appel, paramétré par la PLAGE affichée : le
-- front la lance en parallèle des RDV.
--
-- LECTURE SEULE, SECURITY INVOKER : la RLS de l'appelant s'applique à chaque
-- table lue, comme pour les vues publiques (security_invoker). Aucune règle de
-- calcul ici — la fonction rend des lignes brutes, src/lib/planningCa.js et
-- getChantierAmount restent les seules définitions du chiffre :
--   rdvs      : TOUS les RDV des affaires affichées (leurs journées hors plage
--               comprises — prorata des journées posées)
--   chantiers : colonnes de montant de la vue majordhome_chantiers
--   contrats  : montant du contrat (TTC) + taux de TVA de ses équipements
-- ============================================================================

CREATE OR REPLACE FUNCTION public.planning_ca_affaires(p_core_org_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = majordhome, public
AS $$
  WITH org AS (
    SELECT o.id FROM majordhome.organizations o WHERE o.core_org_id = p_core_org_id
  ),
  affiches AS (
    SELECT DISTINCT a.appointment_type, a.chantier_id, a.intervention_id
    FROM majordhome.appointments a
    JOIN org ON org.id = a.org_id
    WHERE a.scheduled_date BETWEEN p_from AND p_to
      AND a.status NOT IN ('cancelled', 'no_show')
      AND ((a.appointment_type = 'installation' AND a.chantier_id IS NOT NULL)
        OR (a.appointment_type = 'maintenance' AND a.intervention_id IS NOT NULL))
  ),
  rdvs AS (
    SELECT a.id, a.appointment_type, a.scheduled_date, a.status, a.chantier_id, a.intervention_id
    FROM majordhome.appointments a
    JOIN org ON org.id = a.org_id
    WHERE (a.appointment_type = 'installation'
           AND a.chantier_id IN (SELECT f.chantier_id FROM affiches f WHERE f.appointment_type = 'installation'))
       OR (a.appointment_type = 'maintenance'
           AND a.intervention_id IN (SELECT f.intervention_id FROM affiches f WHERE f.appointment_type = 'maintenance'))
  ),
  chantiers AS (
    SELECT c.id, c.validated_quotes_count, c.linked_quotes_amount_ht, c.order_amount_ht, c.estimated_revenue
    FROM public.majordhome_chantiers c
    WHERE c.org_id = p_core_org_id
      AND c.id IN (SELECT f.chantier_id FROM affiches f WHERE f.appointment_type = 'installation')
  ),
  contrats AS (
    SELECT i.id AS intervention_id, ct.amount,
           COALESCE((SELECT jsonb_agg(cat.default_vat_rate)
                     FROM majordhome.contract_equipments x
                     JOIN majordhome.equipments e ON e.id = x.equipment_id
                     LEFT JOIN majordhome.equipment_categories cat ON cat.id = e.category_id
                     WHERE x.contract_id = ct.id), '[]'::jsonb) AS taux
    FROM majordhome.interventions i
    JOIN majordhome.contracts ct ON ct.id = i.contract_id
    WHERE ct.org_id = p_core_org_id
      AND i.id IN (SELECT f.intervention_id FROM affiches f WHERE f.appointment_type = 'maintenance')
  )
  SELECT jsonb_build_object(
    'rdvs', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM rdvs r), '[]'::jsonb),
    'chantiers', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM chantiers c), '[]'::jsonb),
    'contrats', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM contrats c), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.planning_ca_affaires(uuid, date, date) IS
  'CA HT programmé du Planning : RDV, chantiers et contrats des affaires de la plage, en un appel. Lecture seule, SECURITY INVOKER (RLS de l''appelant). Règles de calcul : src/lib/planningCa.js.';

-- PUBLIC obligatoire : sans lui, anon garde EXECUTE par héritage.
REVOKE ALL ON FUNCTION public.planning_ca_affaires(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planning_ca_affaires(uuid, date, date) TO authenticated, service_role;
