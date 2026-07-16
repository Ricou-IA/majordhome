-- ============================================================================
-- 20260716_4_chantiers_validated_quotes_count.sql
-- ----------------------------------------------------------------------------
-- Expose validated_quotes_count sur public.majordhome_chantiers.
--
-- POURQUOI : linked_quotes_amount_ht vaut 0 dans DEUX cas distincts —
--   1. aucun devis rattaché au lead (pas de ligne dans lead_quote_stats)
--   2. des devis rattachés mais aucun validé (SUM … FILTER sans match)
-- Le front ne peut pas les départager sur le seul montant : sa cascade ||
-- retombe alors sur order_amount_ht et réaffiche un montant pré-refus périmé
-- (carte chantier à l'ancien montant pendant que la section Appro annonce
-- « aucun devis validé »). Le compteur rend les deux cas distinguables.
--
-- CREATE OR REPLACE VIEW n'autorise l'ajout d'une colonne qu'EN FIN de liste
-- (sinon « cannot change name of view column ») → validated_quotes_count est
-- ajoutée après has_active_rdv, le reste est restitué verbatim.
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_chantiers
WITH (security_invoker = true) AS
 SELECT l.id,
    l.org_id,
    l.first_name,
    l.last_name,
    l.company_name,
    l.email,
    l.phone,
    l.address,
    l.postal_code,
    l.city,
    l.order_amount_ht,
    l.estimated_revenue,
    l.chantier_status,
    l.equipment_order_status,
    l.materials_order_status,
    l.estimated_date,
    l.planification_date,
    l.chantier_notes,
    l.won_date,
    l.client_id,
    l.project_id,
    l.assigned_user_id,
    l.equipment_type_id,
    l.pv_reception_path,
    l.updated_at,
    l.created_at,
    pet.label AS equipment_type_label,
    pet.category AS equipment_type_category,
    i.id AS intervention_id,
    i.status AS intervention_status,
    l.pennylane_quote_id,
    COALESCE(( SELECT lqs.accepted_sum
           FROM majordhome.lead_quote_stats lqs
          WHERE lqs.lead_id = l.id), 0::numeric) AS linked_quotes_amount_ht,
    rdv.next_rdv_date,
    COALESCE(rdv.has_active_rdv, false) AS has_active_rdv,
    COALESCE(( SELECT lqs.accepted_count
           FROM majordhome.lead_quote_stats lqs
          WHERE lqs.lead_id = l.id), 0) AS validated_quotes_count
   FROM majordhome.leads l
     LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = l.equipment_type_id
     LEFT JOIN majordhome.interventions i ON i.lead_id = l.id AND i.parent_id IS NULL
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.lead_id = l.id AND a.appointment_type = 'installation'::text AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE l.chantier_status IS NOT NULL AND l.is_deleted = false;
