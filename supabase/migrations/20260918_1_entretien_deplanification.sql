-- ============================================================================
-- 20260918_1 — Déplanification d'une carte entretien : plus aucune trace
-- ============================================================================
-- Constat (2026-09-18) : la tournée du jour déplanifiée depuis le kanban
-- (« ← À planifier ») laissait (1) les 3 RDV inscrits au planning, (2) la carte
-- datée du 18/09 (`scheduled_date`) et (3) sur la fiche client, un enfant
-- « certificat par équipement » en « Planifié · Remplir » sous un parent
-- « À planifier » — l'enfant naît à l'ouverture de la modale en Planifié
-- (CertificatsSection, lazy create) et personne ne le retirait.
--
-- (1) se règle côté front : savService.unscheduleEntretien → deleteAppointment,
-- qui porte la synchro Google Calendar. (2) et (3) se règlent ICI, par trigger :
--   • pour couvrir TOUS les chemins qui ramènent une carte de Planifié à
--     À planifier (modale, drag kanban, suppression du dernier RDV depuis le
--     planning via recomputeEntretienWorkflow, repli de pose Tournées) sans
--     recopier la règle dans chacun ;
--   • parce que la policy DELETE d'`interventions` exige `clients.delete`
--     (org_admin seul) : un DELETE des enfants depuis le front serait un no-op
--     SILENCIEUX pour un team_leader (0 ligne, aucune erreur). SECURITY DEFINER,
--     owner postgres → hors RLS, comme update_client_on_intervention_change.
--
-- Règle : Planifié → À planifier sur une carte racine ⇒ `scheduled_date` NULL
-- et suppression des enfants VIERGES (tous encore 'planifie', aucun certificat,
-- brouillon compris). Dès qu'un enfant est réalisé / néant ou porte un
-- certificat, la fratrie est conservée intégralement (visite entamée ; ensemble
-- tout-ou-rien : CertificatsSection ne recrée rien s'il reste un enfant).
-- Cascades à la suppression d'un enfant vierge : certificats (aucun, par garde),
-- call_attempts, intervention_technicians ; appointments.intervention_id → SET
-- NULL (les RDV pointent le parent, jamais l'enfant). La purge est fail-safe :
-- un blocage inattendu (FK NO ACTION sms_logs / service_requests — 0 cas sur
-- 168 enfants au 2026-09-18) part en WARNING, la transition de statut passe.
--
-- Critère de succès : UPDATE workflow_status 'planifie' → 'a_planifier' sur une
-- carte à enfants vierges ⇒ scheduled_date IS NULL et 0 enfant ; sur une carte
-- avec un enfant réalisé ⇒ fratrie intacte. Rattrapage en fin de fichier pour
-- les 3 cartes du 18/09 (MONTELS CTR-00259, SONTAG CTR-00604, FEDOU CTR-00787).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fonction trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.intervention_on_unschedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
BEGIN
  -- Plus de date : elle venait de scheduleEntretien (1er créneau) ou de
  -- ensureEntretienCard (date de tournée) ; la carte repart sans trace.
  NEW.scheduled_date := NULL;

  -- Enfants vierges seulement (tous 'planifie', aucun certificat même brouillon).
  BEGIN
    IF NOT EXISTS (
         SELECT 1
           FROM majordhome.interventions c
          WHERE c.parent_id = NEW.id
            AND c.workflow_status IS DISTINCT FROM 'planifie')
       AND NOT EXISTS (
         SELECT 1
           FROM majordhome.certificats ce
           JOIN majordhome.interventions c ON c.id = ce.intervention_id
          WHERE c.parent_id = NEW.id)
    THEN
      DELETE FROM majordhome.interventions WHERE parent_id = NEW.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'intervention_on_unschedule: purge des enfants de % impossible (%)', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- Fonction trigger : jamais appelable directement (même convention que audit_row_change).
REVOKE EXECUTE ON FUNCTION majordhome.intervention_on_unschedule() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Trigger BEFORE (on réécrit NEW.scheduled_date) — cartes racines seulement
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_intervention_unschedule ON majordhome.interventions;
CREATE TRIGGER trg_intervention_unschedule
  BEFORE UPDATE OF workflow_status ON majordhome.interventions
  FOR EACH ROW
  WHEN (NEW.parent_id IS NULL
        AND OLD.workflow_status = 'planifie'
        AND NEW.workflow_status = 'a_planifier')
  EXECUTE FUNCTION majordhome.intervention_on_unschedule();

-- ----------------------------------------------------------------------------
-- 3. Rattrapage (idempotent) : cartes « À planifier » sans RDV actif qui gardent
--    une date et/ou des enfants vierges — 3 cartes au 2026-09-18, les seules.
-- ----------------------------------------------------------------------------
WITH orphelines AS (
  SELECT i.id
    FROM majordhome.interventions i
   WHERE i.parent_id IS NULL
     AND i.workflow_status = 'a_planifier'
     AND NOT EXISTS (
       SELECT 1 FROM majordhome.appointments a
        WHERE a.intervention_id = i.id
          AND a.status NOT IN ('cancelled', 'no_show'))
)
DELETE FROM majordhome.interventions c
 WHERE c.parent_id IN (SELECT id FROM orphelines)
   AND NOT EXISTS (
     SELECT 1 FROM majordhome.interventions s
      WHERE s.parent_id = c.parent_id
        AND s.workflow_status IS DISTINCT FROM 'planifie')
   AND NOT EXISTS (
     SELECT 1 FROM majordhome.certificats ce
       JOIN majordhome.interventions s ON s.id = ce.intervention_id
      WHERE s.parent_id = c.parent_id);

UPDATE majordhome.interventions i
   SET scheduled_date = NULL
 WHERE i.parent_id IS NULL
   AND i.workflow_status = 'a_planifier'
   AND i.scheduled_date IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM majordhome.appointments a
      WHERE a.intervention_id = i.id
        AND a.status NOT IN ('cancelled', 'no_show'));
