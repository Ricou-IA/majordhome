-- ============================================================================
-- 20261117_2 — majordhome_kanban_cards : les dates des devis du lead
--
-- La date affichée sur une carte du pipeline dépend de sa colonne (Eric,
-- 2026-11-17) : Devis envoyé = date du 1er devis transmis, Gagné = passage en
-- gagné, Perdu = passage en perdu. Deux de ces dates n'existaient nulle part
-- sur la carte :
--   - le 1er devis : leads.quote_sent_date est réécrite à chaque envoi, et 7
--     leads « Devis envoyé » ne l'ont pas ;
--   - le refus : 70 des 311 cartes Perdu y sont placées par Pennylane (tous les
--     devis refusés) sans que leads.status_id ait bougé — status_changed_at y
--     date alors le passage en « Devis envoyé », pas la perte.
--
-- Trois colonnes en FIN de liste (CREATE OR REPLACE VIEW n'en autorise pas
-- ailleurs), les 12 premières et les 4 branches sont inchangées :
--   first_quote_date    : plus ancienne date de devis du lead (non éjectés)
--   quotes_validated_at : 1re mise à jour Pennylane d'un devis validé (repli
--                         quand leads.won_date manque, 5 cartes)
--   quotes_refused_at   : dernière mise à jour Pennylane d'un devis refusé —
--                         le lead ne passe en Perdu qu'au DERNIER refus
-- Les deux dernières viennent du miroir majordhome.pennylane_quotes
-- (pl_updated_at) : NULL si le devis n'y est pas, l'écran retombe alors sur
-- les dates du lead. Carte sans devis Pennylane : les trois sont NULL.
--
-- Le placement des cartes ne change pas : column_key, compteurs et montants
-- sortent des mêmes expressions qu'avant.
-- ============================================================================

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
        ), lead_quote_dates AS (
         SELECT q.lead_id,
            min(q.quote_date) AS first_quote_date,
            min(pq.pl_updated_at) FILTER (WHERE majordhome.quote_status_bucket(q.quote_status) = 'validated'::text) AS quotes_validated_at,
            max(pq.pl_updated_at) FILTER (WHERE majordhome.quote_status_bucket(q.quote_status) = 'refused'::text) AS quotes_refused_at
           FROM majordhome.lead_pennylane_quotes q
             LEFT JOIN majordhome.pennylane_quotes pq ON pq.org_id = q.org_id AND pq.pennylane_quote_id = q.pennylane_quote_id
          WHERE q.ejected_at IS NULL
          GROUP BY q.lead_id
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
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv,
    lqd.first_quote_date,
    lqd.quotes_validated_at,
    lqd.quotes_refused_at
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
     LEFT JOIN lead_quote_dates lqd ON lqd.lead_id = l.id
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
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv,
    lqd.first_quote_date,
    lqd.quotes_validated_at,
    lqd.quotes_refused_at
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
     LEFT JOIN lead_quote_dates lqd ON lqd.lead_id = l.id
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
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv,
    lqd.first_quote_date,
    lqd.quotes_validated_at,
    lqd.quotes_refused_at
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
     LEFT JOIN lead_quote_dates lqd ON lqd.lead_id = l.id
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
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv,
    NULL::date AS first_quote_date,
    NULL::timestamp with time zone AS quotes_validated_at,
    NULL::timestamp with time zone AS quotes_refused_at
   FROM majordhome.leads l
     LEFT JOIN majordhome.statuses s ON s.id = l.status_id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE COALESCE(l.is_deleted, false) = false AND NOT (EXISTS ( SELECT 1
           FROM lead_quote_stats lqs
          WHERE lqs.lead_id = l.id));

-- CREATE OR REPLACE conserve l'ACL ; on la repose quand même (vue publique :
-- l'ACL par défaut du schéma public rouvrirait anon sur une vue recréée).
REVOKE ALL ON public.majordhome_kanban_cards FROM PUBLIC, anon;
GRANT SELECT ON public.majordhome_kanban_cards TO authenticated, service_role;

COMMENT ON VIEW public.majordhome_kanban_cards IS
  'Cartes du pipeline (1 lead → 1 à 2 cartes), placées par les devis Pennylane rattachés, sinon par leads.status_id. Colonnes de dates des devis (first_quote_date, quotes_validated_at, quotes_refused_at) = 20261117_2 ; la date affichée par colonne est décidée par src/lib/leadCardDate.js.';
