-- supabase/migrations/20260716_2_lead_quote_stats_shared_view.sql
-- ============================================================================
-- Bug B — le chantier ne comptait pas comme le pipeline.
--
-- majordhome_kanban_cards ne somme que les devis accepted|invoiced (accepted_sum)
-- ; majordhome_chantiers sommait TOUS les devis non éjectés, sans filtre de
-- statut. Pour le même lead : RENOU 5600 EUR côté pipeline, 21190 EUR côté
-- chantier. 12 chantiers divergeaient de leur propre carte Gagné.
--
-- Steer Eric : « une carte en chantier vient forcément d'un devis marqué gagné
-- sur pipeline, c'est la suite logique, pas un traitement différent. »
--
-- Le CTE lead_quote_stats de majordhome_kanban_cards devient une vue partagée
-- que les DEUX vues consomment. L'allowlist n'existe qu'une fois, dans
-- majordhome.quote_status_bucket().
-- ============================================================================

-- 1. Vue partagée : stats devis PL par lead (source unique)
CREATE OR REPLACE VIEW majordhome.lead_quote_stats
WITH (security_invoker = true) AS
SELECT
  lpq.lead_id,
  lpq.org_id,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'pending')   AS pending_count,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'validated') AS accepted_count,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'refused')   AS refused_count,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'pending')   AS pending_sum,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'validated') AS accepted_sum,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'refused')   AS refused_sum
FROM majordhome.lead_pennylane_quotes lpq
WHERE lpq.ejected_at IS NULL
GROUP BY lpq.lead_id, lpq.org_id;

COMMENT ON VIEW majordhome.lead_quote_stats IS
  'Stats devis Pennylane par lead (non éjectés). Source UNIQUE de la notion « devis validé », consommée par majordhome_kanban_cards (colonne Gagné) ET majordhome_chantiers (linked_quotes_amount_ht). Ne pas recopier l''agrégation ailleurs.';

-- security_invoker=true -> RLS de lead_pennylane_quotes s'applique au caller.
-- GRANT indispensable : sans lui, les vues publiques qui la lisent plantent en
-- 42501 permission denied SILENCIEUX côté edge functions.
GRANT SELECT ON majordhome.lead_quote_stats TO authenticated, service_role;

-- 2. Kanban : le CTE devient un passe-plat vers la vue partagée.
--    Les 4 branches UNION ALL sont inchangées (diff minimal, zéro risque).
CREATE OR REPLACE VIEW public.majordhome_kanban_cards
WITH (security_invoker = true) AS
 WITH lead_quote_stats AS (
         SELECT * FROM majordhome.lead_quote_stats
        ), lead_rdv AS (
         SELECT a.lead_id,
            min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.lead_id IS NOT NULL AND (a.appointment_type = ANY (ARRAY['rdv_technical'::text, 'rdv_agency'::text])) AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))
          GROUP BY a.lead_id
        )
 SELECT l.id::text || ':devis_envoye'::text AS card_key,
    l.id AS lead_id,
    l.org_id,
    'lead'::text AS card_type,
    'devis_envoye'::text AS column_key,
    lqs.pending_count AS devis_count,
    round(lqs.pending_sum) AS total_amount,
    lqs.pending_count,
    lqs.accepted_count,
    lqs.refused_count,
    lr.next_rdv_date,
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE lqs.pending_count > 0 AND COALESCE(l.is_deleted, false) = false
UNION ALL
 SELECT l.id::text || ':gagne'::text AS card_key,
    l.id AS lead_id,
    l.org_id,
    'lead'::text AS card_type,
    'gagne'::text AS column_key,
    lqs.accepted_count AS devis_count,
    round(lqs.accepted_sum) AS total_amount,
    lqs.pending_count,
    lqs.accepted_count,
    lqs.refused_count,
    lr.next_rdv_date,
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE lqs.accepted_count > 0 AND COALESCE(l.is_deleted, false) = false
UNION ALL
 SELECT l.id::text || ':perdu'::text AS card_key,
    l.id AS lead_id,
    l.org_id,
    'lead'::text AS card_type,
    'perdu'::text AS column_key,
    lqs.refused_count AS devis_count,
    round(lqs.refused_sum) AS total_amount,
    lqs.pending_count,
    lqs.accepted_count,
    lqs.refused_count,
    lr.next_rdv_date,
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE lqs.refused_count > 0 AND lqs.accepted_count = 0 AND lqs.pending_count = 0 AND COALESCE(l.is_deleted, false) = false
UNION ALL
 SELECT l.id::text || ':classic'::text AS card_key,
    l.id AS lead_id,
    l.org_id,
    'lead'::text AS card_type,
        CASE s.display_order
            WHEN 1 THEN 'nouveau'::text
            WHEN 2 THEN 'contacte'::text
            WHEN 3 THEN 'rdv_planifie'::text
            WHEN 4 THEN 'devis_envoye'::text
            WHEN 5 THEN 'gagne'::text
            WHEN 6 THEN 'perdu'::text
            ELSE 'unknown'::text
        END AS column_key,
    0 AS devis_count,
    COALESCE(l.order_amount_ht, 0::numeric) AS total_amount,
    0 AS pending_count,
    0 AS accepted_count,
    0 AS refused_count,
    lr.next_rdv_date,
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     LEFT JOIN majordhome.statuses s ON s.id = l.status_id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE COALESCE(l.is_deleted, false) = false AND NOT (EXISTS ( SELECT 1
           FROM lead_quote_stats lqs
          WHERE lqs.lead_id = l.id));

-- 3. Chantiers : linked_quotes_amount_ht = accepted_sum de la vue partagée.
--    Seule cette expression change ; nom, type (numeric) et position de la
--    colonne sont préservés -> pas de « cannot change name of view column ».
--    La vue est déjà non-updatable (is_insertable_into=NO), les écritures
--    passent par update_majordhome_lead -> aucun risque type Bloc B.
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
    COALESCE(rdv.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = l.equipment_type_id
     LEFT JOIN majordhome.interventions i ON i.lead_id = l.id AND i.parent_id IS NULL
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.lead_id = l.id AND a.appointment_type = 'installation'::text AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE l.chantier_status IS NOT NULL AND l.is_deleted = false;
