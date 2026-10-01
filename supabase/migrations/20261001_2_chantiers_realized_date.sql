-- supabase/migrations/20261001_2_chantiers_realized_date.sql
-- ============================================================================
-- Décision Eric 2026-10-01 : la colonne « Réceptionné » du kanban affiche la DATE DE RÉALISATION,
-- c'est-à-dire la date posée au planning (dernier jour d'installation), FIGÉE au passage en
-- Réceptionné — même si le PV est signé six mois plus tard et même si un RDV bouge ensuite.
--   1. chantiers.realized_date (date, NULL tant que le chantier n'est pas réceptionné)
--   2. trigger BEFORE INSERT / UPDATE OF chantier_status : au passage en realise / facture,
--      realized_date := max(scheduled_date) des RDV d'installation actifs du chantier, une seule
--      fois (jamais réécrite). Né en Réceptionné sans RDV (devis déjà facturé) → reste NULL.
--   3. reprise des chantiers déjà réceptionnés / facturés
--   4. vue majordhome_chantiers : colonne realized_date EN FIN (COALESCE(figée, dernier RDV posé) :
--      le repli ne sert qu'aux chantiers nés réceptionnés sans date figée) ; vue _write recréée (SELECT *)
-- Répétée sur scripts/migration-rehearsal/ (assert-chantiers-realized-date.sql).
-- ============================================================================

-- 1. Colonne
ALTER TABLE majordhome.chantiers ADD COLUMN IF NOT EXISTS realized_date date;
COMMENT ON COLUMN majordhome.chantiers.realized_date IS
  'Date de réalisation figée au passage en Réceptionné = dernier jour d''installation posé au planning (trigger chantiers_freeze_realized_date). Jamais réécrite.';

-- 2. Trigger de figeage
CREATE OR REPLACE FUNCTION majordhome.chantiers_freeze_realized_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
BEGIN
  IF NEW.chantier_status IN ('realise', 'facture') AND NEW.realized_date IS NULL THEN
    SELECT max(a.scheduled_date) INTO NEW.realized_date
      FROM majordhome.appointments a
     WHERE a.chantier_id = NEW.id
       AND a.appointment_type = 'installation'
       AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION majordhome.chantiers_freeze_realized_date() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chantiers_freeze_realized_date ON majordhome.chantiers;
CREATE TRIGGER trg_chantiers_freeze_realized_date
  BEFORE INSERT OR UPDATE OF chantier_status ON majordhome.chantiers
  FOR EACH ROW EXECUTE FUNCTION majordhome.chantiers_freeze_realized_date();

-- 3. Reprise : chantiers déjà réceptionnés / facturés → dernier jour d'installation posé
UPDATE majordhome.chantiers c
   SET realized_date = sub.last_day
  FROM (SELECT a.chantier_id, max(a.scheduled_date) AS last_day
          FROM majordhome.appointments a
         WHERE a.appointment_type = 'installation'
           AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])
         GROUP BY a.chantier_id) sub
 WHERE sub.chantier_id = c.id
   AND c.chantier_status IN ('realise', 'facture')
   AND c.realized_date IS NULL;

-- 4. Vues (colonne EN FIN de liste : CREATE OR REPLACE n'autorise que l'ajout en queue)
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
    SELECT min(a.scheduled_date) AS next_rdv_date, max(a.scheduled_date) AS last_rdv_date, bool_or(true) AS has_active_rdv
      FROM majordhome.appointments a
     WHERE a.chantier_id = c.id AND a.appointment_type = 'installation'
       AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])
  ) rdv ON true;

DROP VIEW IF EXISTS public.majordhome_chantiers_write;
CREATE VIEW public.majordhome_chantiers_write WITH (security_invoker = true) AS
  SELECT * FROM majordhome.chantiers;
REVOKE ALL ON public.majordhome_chantiers_write FROM anon;
GRANT SELECT, UPDATE ON public.majordhome_chantiers_write TO authenticated;
GRANT SELECT ON public.majordhome_chantiers_write TO service_role;
COMMENT ON VIEW public.majordhome_chantiers_write IS
  'Miroir auto-updatable de majordhome.chantiers (security_invoker, RLS role_can chantiers.edit|edit_own). UPDATE front ; INSERT/DELETE par RPC.';
