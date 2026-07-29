-- ============================================================================
-- 20260728_1 — Kanban entretien : dériver le contrat depuis le client
-- ----------------------------------------------------------------------------
-- PROBLÈME
--   `interventions.contract_id` est une PHOTO prise à l'instant où la carte
--   entretien est matérialisée (prise de RDV via `resolveCardForAppointment`).
--   Si le client n'a pas encore de contrat actif à cet instant — contrat saisi
--   APRÈS le RDV, ou pas encore passé en `active` — la photo est prise à vide
--   et plus rien ne la rejoue. Échec SILENCIEUX : la carte s'affiche
--   normalement, mais la section Certificats de la modale (conditionnée sur
--   `contract_id`) reste vide le jour de l'intervention.
--   Vécu : CTR-00791 / PAGE PATRICK (RDV 06/07, carte 07/07, contrat 28/07).
--
-- CORRECTION
--   Le lien est DÉRIVABLE : le client est le dénominateur commun du contrat et
--   du RDV. La vue joignait pourtant `clients` et `contracts` en PARALLÈLE
--   (`c.id = i.contract_id`), sans jamais retomber sur `ct.client_id = i.client_id`.
--   On remplace ce LEFT JOIN par un LEFT JOIN LATERAL qui, à défaut de photo,
--   résout le contrat ACTIF du client. `contract_number` / `contract_amount` /
--   `contract_status` se réparent donc aussi, et la colonne `effective_contract_id`
--   (ajoutée EN FIN de liste — `CREATE OR REPLACE VIEW` n'autorise que ça)
--   donne au frontend le contrat à consommer.
--
--   Hypothèse métier validée (Eric, 2026-07-28) : un client = un contrat
--   d'entretien global couvrant l'ensemble des équipements. La dérivation est
--   donc déterministe. Le tri `ORDER BY (ct.id = i.contract_id) DESC, created_at DESC`
--   garde malgré tout la photo explicite prioritaire, et reste stable si un
--   client venait à porter 2 contrats actifs.
--
--   `i.contract_id` reste la source de vérité quand elle est renseignée : la
--   dérivation n'écrase jamais un rattachement explicite.
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_entretien_sav
WITH (security_invoker = true) AS
 SELECT i.id,
    i.project_id,
    i.equipment_id,
    i.intervention_type,
    i.scheduled_date,
    i.scheduled_time_start,
    i.scheduled_time_end,
    i.technician_id,
    i.technician_name,
    i.status,
    i.report_date,
    i.report_notes,
    i.work_performed,
    i.parts_replaced,
    i.photo_before_url,
    i.photo_after_url,
    i.photos_extra,
    i.signature_url,
    i.signed_at,
    i.signed_by_name,
    i.duration_minutes,
    i.is_billable,
    i.invoice_id,
    i.location_lat,
    i.location_lng,
    i.metadata,
    i.created_by,
    i.created_at,
    i.updated_at,
    i.tags,
    i.lead_id,
    i.parent_id,
    i.slot_date,
    i.slot_start_time,
    i.slot_end_time,
    i.slot_notes,
    i.client_id,
    i.contract_id,
    i.workflow_status,
    i.sav_description,
    i.parts_order_status,
    i.devis_amount,
    i.devis_status,
    i.sav_origin,
    i.includes_entretien,
    majordhome.project_org_id(i.project_id) AS org_id,
    cl.display_name AS client_name,
    cl.first_name AS client_first_name,
    cl.last_name AS client_last_name,
    cl.address AS client_address,
    cl.postal_code AS client_postal_code,
    cl.city AS client_city,
    cl.phone AS client_phone,
    cl.phone_secondary AS client_phone_secondary,
    cl.email AS client_email,
    cl.sms_optin AS client_sms_optin,
    c.contract_number,
    c.amount AS contract_amount,
    c.estimated_time,
    c.maintenance_month,
    c.status AS contract_status,
    cl.project_id AS client_project_id,
    (EXISTS ( SELECT 1
           FROM majordhome.sms_logs sl
          WHERE sl.intervention_id = i.id AND sl.campaign_name = 'avis_j1'::text)) AS sms_avis_sent,
    rdv.next_rdv_date,
    COALESCE(rdv.has_active_rdv, false) AS has_active_rdv,
    COALESCE(( SELECT sum(
                CASE
                    WHEN COALESCE((elem.piece ->> 'offert'::text)::boolean, false) THEN 0::numeric
                    ELSE COALESCE((elem.piece ->> 'prix_ht'::text)::numeric, 0::numeric) * COALESCE(NULLIF(elem.piece ->> 'quantite'::text, ''::text)::numeric, 1::numeric)
                END) AS sum
           FROM majordhome.certificats cert
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cert.pieces_remplacees, '[]'::jsonb)) elem(piece)
          WHERE cert.intervention_id = i.id OR (cert.intervention_id IN ( SELECT ch.id
                   FROM majordhome.interventions ch
                  WHERE ch.parent_id = i.id))), 0::numeric) AS parts_total_ttc,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('intervention_id', cert.intervention_id, 'idx', elem.ord - 1, 'designation', elem.piece ->> 'designation'::text, 'reference', elem.piece ->> 'reference'::text, 'quantite', COALESCE(NULLIF(elem.piece ->> 'quantite'::text, ''::text)::numeric, 1::numeric), 'prix_ht', COALESCE((elem.piece ->> 'prix_ht'::text)::numeric, 0::numeric), 'offert', COALESCE((elem.piece ->> 'offert'::text)::boolean, false)) ORDER BY cert.intervention_id, elem.ord) AS jsonb_agg
           FROM majordhome.certificats cert
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cert.pieces_remplacees, '[]'::jsonb)) WITH ORDINALITY elem(piece, ord)
          WHERE (cert.intervention_id = i.id OR (cert.intervention_id IN ( SELECT ch.id
                   FROM majordhome.interventions ch
                  WHERE ch.parent_id = i.id))) AND (COALESCE(elem.piece ->> 'designation'::text, ''::text) <> ''::text OR COALESCE((elem.piece ->> 'prix_ht'::text)::numeric, 0::numeric) > 0::numeric)), '[]'::jsonb) AS parts_detail,
    i.invoiced_at,
    -- NOUVEAU (fin de liste obligatoire) : contrat effectif = photo si présente,
    -- sinon contrat actif du client. C'est CETTE colonne que le frontend consomme
    -- pour les certificats ; `i.contract_id` reste exposée telle quelle.
    c.id AS effective_contract_id
   FROM majordhome.interventions i
     LEFT JOIN majordhome.clients cl ON cl.id = i.client_id
     LEFT JOIN LATERAL ( SELECT ct.*
           FROM majordhome.contracts ct
          WHERE ct.id = i.contract_id
             OR (i.contract_id IS NULL
                 AND ct.client_id = i.client_id
                 AND ct.status = 'active'::majordhome.contract_status)
          ORDER BY (ct.id = i.contract_id) DESC, ct.created_at DESC
         LIMIT 1) c ON true
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.intervention_id = i.id AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE (i.intervention_type = ANY (ARRAY['entretien'::majordhome.intervention_type, 'sav'::majordhome.intervention_type]))
    AND i.parent_id IS NULL
    AND (c.status IS NULL OR (c.status <> ALL (ARRAY['cancelled'::majordhome.contract_status, 'archived'::majordhome.contract_status])));

COMMENT ON VIEW public.majordhome_entretien_sav IS
  'Kanban entretien/SAV (cartes parent). `effective_contract_id` = COALESCE(photo contract_id, contrat actif du client) — répare les cartes créées avant la saisie du contrat. Voir migration 20260728_1.';
