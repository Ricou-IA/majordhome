-- majordhome_chantiers.next_rdv_date = prochaine pose À VENIR, plus le plus ancien RDV actif.
--
-- Avant : next_rdv_date = min(scheduled_date) des RDV d'installation actifs, passés compris.
-- Un chantier dont un premier jour est passé (resté « planifié ») et dont la suite est posée
-- plus tard affichait donc la date PASSÉE sur sa carte et se triait dessus. Vécu DJAFOUR,
-- 2026-11-02 : carte « 23 SEPT » en Planification alors que la pose était au 1er décembre —
-- lue comme une pose non faite, la carte a été renvoyée en « À planifier ».
--
-- Après : la plus proche des poses à venir (aujourd'hui compris) ; à défaut — tous les jours
-- sont passés — le plus ancien jour actif, comme avant (comportement inchangé pour ces cartes).
-- has_active_rdv et realized_date ne changent pas. CURRENT_DATE est la date UTC du serveur :
-- entre minuit et 1 h ou 2 h à Paris, la pose de la veille compte encore comme « à venir ».
--
-- Même liste de colonnes, même ordre, mêmes types (CREATE OR REPLACE VIEW l'exige) ;
-- security_invoker répété : un REPLACE sans WITH efface l'option.

CREATE OR REPLACE VIEW public.majordhome_chantiers WITH (security_invoker = true) AS
SELECT c.id, c.org_id,
       l.first_name, l.last_name, l.company_name, l.email, l.phone, l.address, l.postal_code, l.city,
       l.order_amount_ht, l.estimated_revenue,
       c.chantier_status, c.equipment_order_status, c.materials_order_status,
       c.estimated_date, c.planification_date, c.chantier_notes, c.won_date,
       l.client_id, l.project_id, l.assigned_user_id, c.equipment_type_id, c.pv_reception_path,
       c.updated_at, c.created_at,
       pet.label    AS equipment_type_label,
       pet.category AS equipment_type_category,
       l.pennylane_quote_id,
       COALESCE(s.validated_sum, 0::numeric) AS linked_quotes_amount_ht,
       rdv.next_rdv_date,
       COALESCE(rdv.has_active_rdv, false)   AS has_active_rdv,
       COALESCE(s.validated_count, 0::bigint) AS validated_quotes_count,
       c.planned_team_size, c.planned_days,
       c.lead_id, c.label,
       COALESCE(s.quotes_count, 0::bigint)   AS quotes_count,
       COALESCE(s.validated_count > 0 AND s.invoiced_count = s.validated_count, false) AS is_invoiced,
       (SELECT count(*) FROM majordhome.chantiers c2 WHERE c2.lead_id = c.lead_id) AS lead_chantiers_count,
       COALESCE(c.realized_date, rdv.last_rdv_date) AS realized_date
  FROM majordhome.chantiers c
  JOIN majordhome.leads l ON l.id = c.lead_id AND l.is_deleted = false
  LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = c.equipment_type_id
  LEFT JOIN majordhome.chantier_quote_stats s ON s.chantier_id = c.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(min(a.scheduled_date) FILTER (WHERE a.scheduled_date >= CURRENT_DATE),
                    min(a.scheduled_date)) AS next_rdv_date,
           max(a.scheduled_date) AS last_rdv_date,
           bool_or(true) AS has_active_rdv
      FROM majordhome.appointments a
     WHERE a.chantier_id = c.id AND a.appointment_type = 'installation'
       AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])
  ) rdv ON true;

-- Charte : aucune vue majordhome_* ouverte à anon (le REPLACE conserve l'ACL ; filet).
REVOKE ALL ON public.majordhome_chantiers FROM PUBLIC, anon;
