-- ============================================================================
-- 20261012_1 — Photo de la plaque signalétique sur le certificat d'entretien.
-- Prise à l'étape Bilan quand le bilan n'est pas conforme ; exigée (shunt possible,
-- motif dans photo_plaque_absence) quand l'action est « Devis à établir », c'est-à-dire
-- quand une demande SAV s'ouvre. La photo SUIT la carte SAV par le lien déjà en place
-- (interventions.source_certificat_id → certificat) : la vue Kanban l'expose dans
-- chaque élément de `anomalies`, rien n'est recopié dans l'intervention.
-- Fichier : bucket `certificats` existant (jpeg/png déjà autorisés, policies org),
-- chemin ${org_id}/${client_id}/${annee}/${certificat_id}-plaque.jpg.
--
-- 1. certificats.photo_plaque_path / photo_plaque_absence
-- 2. vue miroir majordhome_certificats (CREATE OR REPLACE : colonnes EN FIN, reste updatable —
--    le wizard upsert au travers)
-- 3. vue majordhome_entretien_sav : deux clés de plus dans le jsonb `anomalies` (mêmes colonnes)
-- Répétée sur scripts/migration-rehearsal/ (assert-photo-plaque.sql).
-- ============================================================================

-- ── 1. Colonnes ────────────────────────────────────────────────────────────
ALTER TABLE majordhome.certificats
  ADD COLUMN IF NOT EXISTS photo_plaque_path text,
  ADD COLUMN IF NOT EXISTS photo_plaque_absence text;

COMMENT ON COLUMN majordhome.certificats.photo_plaque_path IS
  'Photo de la plaque signalétique (bucket certificats, préfixe org_id). Prise à l''étape Bilan ; lue par la carte SAV via la vue majordhome_entretien_sav.';
COMMENT ON COLUMN majordhome.certificats.photo_plaque_absence IS
  'Motif saisi quand le technicien n''a pas pu photographier la plaque (NULL = pas de shunt). « Non précisé » si coché sans motif.';

-- ── 2. Vue miroir (liste explicite en prod : ajout EN FIN, sinon « cannot change name of view column ») ──
CREATE OR REPLACE VIEW public.majordhome_certificats WITH (security_invoker = true) AS
 SELECT id, intervention_id, client_id, equipment_id, contract_id, org_id, reference, type_document,
    equipement_type, equipement_marque, equipement_modele, equipement_numero_serie, equipement_annee,
    equipement_puissance_kw, equipement_fluide, equipement_charge_kg, combustible,
    donnees_entretien, donnees_ramonage, mesures, pieces_remplacees,
    bilan_conformite, anomalies_detail, action_corrective, recommandations, prochaine_intervention, tva_taux,
    technicien_id, technicien_nom, technicien_certifications, technicien_num_fgaz,
    signature_client_base64, signature_client_nom, signed_at,
    pdf_storage_path, pdf_generated_at, pdf_url, statut, date_intervention, created_by, created_at, updated_at,
    photo_plaque_path, photo_plaque_absence
   FROM majordhome.certificats;

-- ── 3. Vue Kanban Entretien : la photo suit la carte ───────────────────────
-- Corps identique à 20261010_1 ; seules deux clés s'ajoutent dans jsonb_build_object (la liste
-- des colonnes de la vue ne change pas, CREATE OR REPLACE suffit).
CREATE OR REPLACE VIEW public.majordhome_entretien_sav WITH (security_invoker = true) AS
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
    c.id AS effective_contract_id,
    i.planned_team_size,
    i.planned_days,
        CASE
            WHEN i.invoice_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN ( SELECT inv.import_status
               FROM majordhome.invoices inv
              WHERE inv.id = i.invoice_id::uuid)
            ELSE NULL::text
        END AS invoice_import_status,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object(
                'certificat_id', cert.id,
                'intervention_id', cert.intervention_id,
                'equipment_id', cert.equipment_id,
                'equipement', NULLIF(btrim(concat_ws(' '::text, cert.equipement_marque, cert.equipement_modele)), ''::text),
                'equipement_type', cert.equipement_type,
                'bilan', cert.bilan_conformite,
                'detail', cert.anomalies_detail,
                'action', cert.action_corrective,
                'date', cert.date_intervention,
                'sav_id', sav.id,
                'photo_plaque_path', cert.photo_plaque_path,
                'photo_plaque_absence', cert.photo_plaque_absence) ORDER BY cert.date_intervention, cert.created_at)
           FROM majordhome.certificats cert
             LEFT JOIN majordhome.interventions sav ON sav.source_certificat_id = cert.id
          WHERE (cert.intervention_id = i.id OR (cert.intervention_id IN ( SELECT ch.id
                   FROM majordhome.interventions ch
                  WHERE ch.parent_id = i.id)))
            AND cert.bilan_conformite = ANY (ARRAY['anomalie'::text, 'arret_urgence'::text])), '[]'::jsonb) AS anomalies
   FROM majordhome.interventions i
     LEFT JOIN majordhome.clients cl ON cl.id = i.client_id
     LEFT JOIN LATERAL ( SELECT ct.id,
            ct.org_id,
            ct.client_id,
            ct.contract_number,
            ct.status,
            ct.frequency,
            ct.start_date,
            ct.end_date,
            ct.renewal_date,
            ct.next_maintenance_date,
            ct.amount,
            ct.notes,
            ct.created_at,
            ct.updated_at,
            ct.maintenance_month,
            ct.estimated_time,
            ct.zone_id,
            ct.subtotal,
            ct.discount_percent,
            ct.source,
            ct.contract_pdf_path,
            ct.signed_at,
            ct.signature_client_base64,
            ct.signature_client_nom,
            ct.cancellation_reason,
            ct.cancelled_at,
            ct.workflow_status,
            ct.amount_forced
           FROM majordhome.contracts ct
          WHERE ct.id = i.contract_id OR i.contract_id IS NULL AND ct.client_id = i.client_id AND ct.status = 'active'::majordhome.contract_status
          ORDER BY (ct.id = i.contract_id) DESC, ct.created_at DESC
         LIMIT 1) c ON true
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.intervention_id = i.id AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE (i.intervention_type = ANY (ARRAY['entretien'::majordhome.intervention_type, 'sav'::majordhome.intervention_type])) AND i.parent_id IS NULL AND (c.status IS NULL OR (c.status <> ALL (ARRAY['cancelled'::majordhome.contract_status, 'archived'::majordhome.contract_status])));
