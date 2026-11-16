-- ============================================================================
-- 20261116_2 — Un lead renommé emmène ses RDV avec lui
-- ============================================================================
-- Constat (2026-11-16, lead CANDOM → CONDOM) : quand un lead change de nom, ses
-- RDV gardent l'ancien. `appointments.client_name` / `client_first_name` sont
-- une copie prise à la création du RDV, que rien ne tient à jour. Le planning
-- affiche donc un nom que la recherche du pipeline ne connaît plus.
-- Deux voies renomment un lead (mouchard, depuis le 2026-09-16) :
--   - `pennylane_sync_overwrite_lead_fields` (cron, « Pennylane fait foi » après
--     rattachement d'un devis) : 48 renommages ;
--   - `update_majordhome_lead` (fiche lead, saisie humaine) : 59 renommages.
-- Un trigger sur `leads` couvre les deux, et toute voie future, en un seul endroit.
--
-- Règle : seuls les RDV qui portaient ENCORE l'ancien nom du lead suivent
-- (même nom, et prénom identique ou absent — casse et espaces ignorés). Un RDV
-- du même lead saisi au nom d'une autre personne (conjoint, société, contact
-- sur place) n'est pas touché. L'objet du RDV ne suit que s'il contient
-- l'ancien « prénom nom » ou « nom prénom » tel quel.
--
-- Échec : un avertissement dans les journaux Postgres, jamais un refus. Le pire
-- qui arrive est l'état d'avant (RDV à l'ancien nom) ; bloquer l'enregistrement
-- du lead ou la synchronisation Pennylane pour une copie de libellé serait une
-- régression. Chaque RDV renommé laisse une ligne dans `majordhome.audit_log`
-- (trigger `trg_audit_appointments`).
--
-- Non couvert : les RDV déjà décalés avant cette migration (rattrapage à part),
-- et le titre d'un évènement déjà poussé dans Google Agenda.
-- ============================================================================

CREATE OR REPLACE FUNCTION majordhome.lead_rename_sync_appointments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_old_last  text := btrim(coalesce(OLD.last_name, ''));
  v_old_first text := btrim(coalesce(OLD.first_name, ''));
  v_new_last  text := btrim(coalesce(NEW.last_name, ''));
  v_new_first text := btrim(coalesce(NEW.first_name, ''));
BEGIN
  -- Sans ancien nom, aucun RDV à reconnaître ; sans nouveau nom, rien à recopier.
  IF v_old_last = '' OR v_new_last = '' THEN
    RETURN NULL;
  END IF;

  UPDATE majordhome.appointments a
     SET client_name       = v_new_last,
         client_first_name = NULLIF(v_new_first, ''),
         subject = CASE
           WHEN a.subject IS NULL OR v_old_first = '' THEN a.subject
           WHEN position(v_old_first || ' ' || v_old_last IN a.subject) > 0
             THEN replace(a.subject, v_old_first || ' ' || v_old_last, btrim(v_new_first || ' ' || v_new_last))
           WHEN position(v_old_last || ' ' || v_old_first IN a.subject) > 0
             THEN replace(a.subject, v_old_last || ' ' || v_old_first, btrim(v_new_last || ' ' || v_new_first))
           ELSE a.subject
         END,
         updated_at = now()
   WHERE a.lead_id = NEW.id
     -- `appointments.org_id` porte l'org majordhome, `leads.org_id` l'org core.
     AND a.org_id IN (SELECT o.id FROM majordhome.organizations o WHERE o.core_org_id = NEW.org_id)
     AND lower(btrim(a.client_name)) = lower(v_old_last)
     AND (
       btrim(coalesce(a.client_first_name, '')) = ''
       OR lower(btrim(a.client_first_name)) = lower(v_old_first)
     );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead_rename_sync_appointments: lead % — % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION majordhome.lead_rename_sync_appointments() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_rename_sync_appointments ON majordhome.leads;
CREATE TRIGGER trg_lead_rename_sync_appointments
  AFTER UPDATE OF first_name, last_name ON majordhome.leads
  FOR EACH ROW
  WHEN (OLD.last_name IS DISTINCT FROM NEW.last_name OR OLD.first_name IS DISTINCT FROM NEW.first_name)
  EXECUTE FUNCTION majordhome.lead_rename_sync_appointments();

-- ----------------------------------------------------------------------------
-- Vérification post-apply :
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'majordhome.leads'::regclass AND tgname = 'trg_lead_rename_sync_appointments';      -- 1 ligne, 'O'
--   SELECT has_function_privilege('anon', 'majordhome.lead_rename_sync_appointments()', 'EXECUTE'),
--          has_function_privilege('authenticated', 'majordhome.lead_rename_sync_appointments()', 'EXECUTE'); -- false, false
--   puis, au prochain renommage d'un lead qui a un RDV :
--   SELECT changed_at, source, old_values, new_values FROM majordhome.audit_log
--    WHERE table_name = 'appointments' AND changed_fields @> ARRAY['client_name'] ORDER BY id DESC LIMIT 5;
-- ----------------------------------------------------------------------------
