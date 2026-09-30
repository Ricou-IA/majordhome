-- supabase/migrations/20260930_11_chantiers_entite.sql
-- ============================================================================
-- Chantier = entité (spec 2026-09-30-chantier-entite-par-devis-design.md).
-- Règle Eric 2026-09-30 : un lead = N devis ; chaque devis accepté = 1 chantier,
-- regroupable. Cette migration pose la structure et REPREND l'existant tel quel
-- (1 chantier par lead à chantier_status, tous ses devis dessus) ; la règle
-- « un devis = un chantier » s'applique aux devis validés APRÈS (20260930_12).
--   1. majordhome.chantiers (RLS org, UPDATE via role_can chantiers.edit|edit_own)
--   2. lead_pennylane_quotes.chantier_id, appointments.chantier_id,
--      chantier_line_receptions.chantier_id → FK chantiers
--   3. reprise : 1 chantier par lead, devis validés + RDV installation rattachés
--   4. vues : chantier_quote_stats (quote_status_bucket, aucune allowlist),
--      majordhome_chantiers (DROP + CREATE, id = chantier), majordhome_chantiers_write
--      (miroir updatable), majordhome_appointments (target_invoiced par chantier,
--      chantier_id en fin), majordhome_lead_pennylane_quotes (chantier_id en fin)
--   5. audit (trigger mouchard si la fonction existe), grants service_role
-- Les colonnes chantier de `leads` restent en place (contraction ultérieure).
-- Répétée sur scripts/migration-rehearsal/ (fixture-chantiers.sql + assert-chantiers.sql §A).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.chantiers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES core.organizations(id),
  lead_id                uuid NOT NULL REFERENCES majordhome.leads(id) ON DELETE CASCADE,
  client_id              uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  label                  text,
  chantier_status        text NOT NULL DEFAULT 'gagne'
                         CHECK (chantier_status IN ('gagne', 'commande_a_faire', 'commande_recue', 'planification', 'realise', 'facture')),
  equipment_order_status text CHECK (equipment_order_status IN ('na', 'commande', 'recu')),
  materials_order_status text CHECK (materials_order_status IN ('na', 'commande', 'recu')),
  estimated_date         date,
  planification_date     date,
  won_date               date,
  chantier_notes         text,
  pv_reception_path      text,
  planned_team_size      smallint CHECK (planned_team_size BETWEEN 1 AND 20),
  planned_days           smallint CHECK (planned_days BETWEEN 1 AND 60),
  equipment_type_id      uuid REFERENCES majordhome.pricing_equipment_types(id) ON DELETE SET NULL,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chantiers_org_status ON majordhome.chantiers (org_id, chantier_status);
CREATE INDEX IF NOT EXISTS idx_chantiers_lead ON majordhome.chantiers (lead_id);
COMMENT ON TABLE majordhome.chantiers IS
  'Un chantier = une commande à exécuter (devis validés + jours d''installation). N chantiers par lead. Création par trigger chantier_ensure_for_quote / RPC chantier_ensure_for_lead ; gestes chantier_group / chantier_detach / chantier_delete. Écriture front via public.majordhome_chantiers_write.';

DROP TRIGGER IF EXISTS trg_chantiers_updated_at ON majordhome.chantiers;
CREATE TRIGGER trg_chantiers_updated_at
  BEFORE UPDATE ON majordhome.chantiers
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Colonnes de rattachement
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.lead_pennylane_quotes
  ADD COLUMN IF NOT EXISTS chantier_id uuid REFERENCES majordhome.chantiers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lead_pennylane_quotes_chantier ON majordhome.lead_pennylane_quotes (chantier_id) WHERE chantier_id IS NOT NULL;
COMMENT ON COLUMN majordhome.lead_pennylane_quotes.chantier_id IS
  'Chantier auquel le devis appartient. NULL = attaché au lead sans chantier (devis en attente / refusé, ou antérieur à la migration sur un lead sans chantier).';

ALTER TABLE majordhome.appointments
  ADD COLUMN IF NOT EXISTS chantier_id uuid REFERENCES majordhome.chantiers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_chantier ON majordhome.appointments (chantier_id) WHERE chantier_id IS NOT NULL;
COMMENT ON COLUMN majordhome.appointments.chantier_id IS
  'Chantier d''un RDV installation. lead_id reste renseigné (dérivé) pour les lecteurs historiques.';

-- ----------------------------------------------------------------------------
-- 3. Reprise : un chantier par lead à chantier_status, tout dessus
-- ----------------------------------------------------------------------------
INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, chantier_status, equipment_order_status, materials_order_status,
  estimated_date, planification_date, won_date, chantier_notes, pv_reception_path, planned_team_size, planned_days,
  equipment_type_id, sort_order, created_at, updated_at)
SELECT l.org_id, l.id, l.client_id, l.chantier_status, l.equipment_order_status, l.materials_order_status,
  l.estimated_date, l.planification_date, l.won_date, l.chantier_notes, l.pv_reception_path, l.planned_team_size, l.planned_days,
  l.equipment_type_id, COALESCE(l.sort_order, 0), COALESCE(l.won_date::timestamptz, l.created_at, now()), now()
FROM majordhome.leads l
WHERE l.chantier_status IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM majordhome.chantiers c WHERE c.lead_id = l.id);

UPDATE majordhome.lead_pennylane_quotes q
   SET chantier_id = c.id
  FROM majordhome.chantiers c
 WHERE c.lead_id = q.lead_id AND q.chantier_id IS NULL AND q.ejected_at IS NULL
   AND majordhome.quote_status_bucket(q.quote_status) = 'validated';

UPDATE majordhome.appointments a
   SET chantier_id = c.id
  FROM majordhome.chantiers c
 WHERE c.lead_id = a.lead_id AND a.chantier_id IS NULL AND a.appointment_type = 'installation';

-- chantier_line_receptions.chantier_id contenait des ids de LEAD → id du chantier.
-- L'ancienne FK (→ leads) doit tomber AVANT la re-parentalité, sinon l'UPDATE la viole.
-- La colonne est NOT NULL : une réception dont le lead n'a pas de chantier (0 en prod au 2026-09-30)
-- ferait échouer la FK ci-dessous — on le constate avant, bruyamment, plutôt que de la perdre ou de l'ignorer.
ALTER TABLE majordhome.chantier_line_receptions
  DROP CONSTRAINT IF EXISTS chantier_line_receptions_chantier_id_fkey;
UPDATE majordhome.chantier_line_receptions r
   SET chantier_id = c.id
  FROM majordhome.chantiers c
 WHERE c.lead_id = r.chantier_id;
DO $$
DECLARE n_orph int;
BEGIN
  SELECT count(*) INTO n_orph FROM majordhome.chantier_line_receptions r
   WHERE NOT EXISTS (SELECT 1 FROM majordhome.chantiers c WHERE c.id = r.chantier_id);
  IF n_orph > 0 THEN RAISE EXCEPTION 'reprise : % réceptions de ligne sans chantier correspondant', n_orph; END IF;
END $$;
ALTER TABLE majordhome.chantier_line_receptions
  ADD CONSTRAINT chantier_line_receptions_chantier_id_fkey
    FOREIGN KEY (chantier_id) REFERENCES majordhome.chantiers(id) ON DELETE CASCADE;

DO $$
DECLARE n_leads int; n_ch int; n_orph int;
BEGIN
  SELECT count(*) INTO n_leads FROM majordhome.leads WHERE chantier_status IS NOT NULL;
  SELECT count(*) INTO n_ch FROM majordhome.chantiers;
  IF n_ch < n_leads THEN RAISE EXCEPTION 'reprise : % chantiers pour % leads à chantier_status', n_ch, n_leads; END IF;
  SELECT count(*) INTO n_orph FROM majordhome.appointments a JOIN majordhome.leads l ON l.id = a.lead_id
   WHERE a.appointment_type = 'installation' AND l.chantier_status IS NOT NULL AND a.chantier_id IS NULL;
  IF n_orph > 0 THEN RAISE EXCEPTION 'reprise : % RDV installation sans chantier_id', n_orph; END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Vues
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW majordhome.chantier_quote_stats AS
SELECT chantier_id, org_id,
       count(*)                                                                             AS quotes_count,
       count(*) FILTER (WHERE majordhome.quote_status_bucket(quote_status) = 'validated')   AS validated_count,
       count(*) FILTER (WHERE quote_status = 'invoiced')                                    AS invoiced_count,
       count(*) FILTER (WHERE majordhome.quote_status_bucket(quote_status) = 'pending')     AS pending_count,
       sum(quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(quote_status) = 'validated') AS validated_sum
  FROM majordhome.lead_pennylane_quotes
 WHERE ejected_at IS NULL AND chantier_id IS NOT NULL
 GROUP BY chantier_id, org_id;
GRANT SELECT ON majordhome.chantier_quote_stats TO authenticated, service_role;

DROP VIEW IF EXISTS public.majordhome_chantiers;
CREATE VIEW public.majordhome_chantiers WITH (security_invoker = true) AS
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
       (SELECT count(*) FROM majordhome.chantiers c2 WHERE c2.lead_id = c.lead_id) AS lead_chantiers_count
  FROM majordhome.chantiers c
  JOIN majordhome.leads l ON l.id = c.lead_id AND l.is_deleted = false
  LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = c.equipment_type_id
  LEFT JOIN majordhome.chantier_quote_stats s ON s.chantier_id = c.id
  LEFT JOIN LATERAL (
    SELECT min(a.scheduled_date) AS next_rdv_date, bool_or(true) AS has_active_rdv
      FROM majordhome.appointments a
     WHERE a.chantier_id = c.id AND a.appointment_type = 'installation'
       AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])
  ) rdv ON true;
GRANT SELECT ON public.majordhome_chantiers TO authenticated, service_role;
COMMENT ON VIEW public.majordhome_chantiers IS
  'Chantiers (majordhome.chantiers × identité du lead). id = CHANTIER (plus le lead). Montant = devis validés du chantier (chantier_quote_stats). Lecture seule : écrire via majordhome_chantiers_write.';

DROP VIEW IF EXISTS public.majordhome_chantiers_write;
CREATE VIEW public.majordhome_chantiers_write WITH (security_invoker = true) AS
  SELECT * FROM majordhome.chantiers;
REVOKE ALL ON public.majordhome_chantiers_write FROM anon;
GRANT SELECT, UPDATE ON public.majordhome_chantiers_write TO authenticated;
GRANT SELECT ON public.majordhome_chantiers_write TO service_role;
COMMENT ON VIEW public.majordhome_chantiers_write IS
  'Miroir auto-updatable de majordhome.chantiers (security_invoker, RLS role_can chantiers.edit|edit_own). UPDATE front ; INSERT/DELETE par RPC.';

CREATE OR REPLACE VIEW public.majordhome_appointments WITH (security_invoker = true) AS
SELECT id, org_id, service_request_id, lead_id, client_name, client_phone, client_email, address, postal_code, city,
       scheduled_date, scheduled_start, scheduled_end, duration_minutes, scheduled_at, appointment_type, equipment_type,
       priority, status, subject, description, internal_notes, completion_notes, parts_used, photos_urls, signature_url,
       completed_at, is_billable, estimated_amount, final_amount, invoice_id, invoice_status, is_recurring, recurrence_rule,
       parent_appointment_id, google_event_id, google_calendar_id, google_synced_at, slack_message_ts, slack_channel_id,
       client_notified_at, reminder_24h_sent, reminder_1h_sent, source, created_at, updated_at, created_by, cancelled_at,
       cancellation_reason, client_id, client_first_name, assigned_commercial_id, intervention_id,
       CASE
         WHEN intervention_id IS NOT NULL THEN COALESCE((SELECT i.invoiced_at IS NOT NULL OR i.workflow_status = 'facture'::text
                                                            FROM majordhome.interventions i WHERE i.id = a.intervention_id), false)
         WHEN appointment_type = 'installation'::text AND chantier_id IS NOT NULL THEN EXISTS (
              SELECT 1 FROM majordhome.chantier_quote_stats s
               WHERE s.chantier_id = a.chantier_id AND s.validated_count > 0 AND s.invoiced_count = s.validated_count)
         ELSE false
       END AS target_invoiced,
       grand_secteur, time_flex_minutes, hour_confirmed_at, announced_start,
       chantier_id
  FROM majordhome.appointments a;

CREATE OR REPLACE VIEW public.majordhome_lead_pennylane_quotes WITH (security_invoker = true) AS
SELECT lpq.id, lpq.org_id, lpq.lead_id, lpq.pennylane_quote_id, lpq.pennylane_customer_id, lpq.pennylane_client_id,
       lpq.quote_amount_ht, lpq.quote_label, lpq.quote_date, lpq.quote_status,
       COALESCE(pq.pdf_url, lpq.pdf_url) AS pdf_url,
       lpq.assigned_at, lpq.ejected_at, lpq.ejected_reason, lpq.created_at, lpq.is_winning_quote,
       l.last_name AS lead_last_name, l.first_name AS lead_first_name, l.status_id AS lead_status_id, l.client_id,
       c.client_number, c.last_name AS client_last_name, c.first_name AS client_first_name,
       c.pennylane_account_number AS client_pl_number,
       majordhome.quote_status_bucket(lpq.quote_status) = 'validated'::text AS is_validated,
       lpq.chantier_id
  FROM majordhome.lead_pennylane_quotes lpq
  JOIN majordhome.leads l ON l.id = lpq.lead_id
  LEFT JOIN majordhome.clients c ON c.id = l.client_id
  LEFT JOIN majordhome.pennylane_quotes pq ON pq.org_id = lpq.org_id AND pq.pennylane_quote_id = lpq.pennylane_quote_id;

-- ----------------------------------------------------------------------------
-- 5. RLS, grants, audit
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.chantiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chantiers_select_org_members ON majordhome.chantiers;
CREATE POLICY chantiers_select_org_members ON majordhome.chantiers
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS chantiers_update_role_can ON majordhome.chantiers;
CREATE POLICY chantiers_update_role_can ON majordhome.chantiers
  FOR UPDATE TO authenticated
  USING (majordhome.role_can(org_id, 'chantiers', 'edit') OR majordhome.role_can(org_id, 'chantiers', 'edit_own'))
  WITH CHECK (majordhome.role_can(org_id, 'chantiers', 'edit') OR majordhome.role_can(org_id, 'chantiers', 'edit_own'));
-- Pas de policy INSERT / DELETE : création par trigger et RPC SECURITY DEFINER, suppression par RPC.

REVOKE ALL ON majordhome.chantiers FROM anon, authenticated;
GRANT SELECT, UPDATE ON majordhome.chantiers TO authenticated;
GRANT SELECT ON majordhome.chantiers TO service_role;

-- Mouchard : seulement si la fonction existe (absente du harnais de répétition, fail-safe en prod).
DO $$
BEGIN
  IF to_regprocedure('majordhome.audit_row_change()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_chantiers ON majordhome.chantiers';
    EXECUTE $t$CREATE TRIGGER trg_audit_chantiers AFTER INSERT OR DELETE OR UPDATE ON majordhome.chantiers
             FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change('updated_at,sort_order')$t$;
  END IF;
END $$;
