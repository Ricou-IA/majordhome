-- 20260928_1 — Une visite d'entretien est un fait passé : sa date ne peut pas être dans le futur.
--
-- Incident : le bloc « Visites d'entretien » (fiche client → Contrat) a servi à « programmer »
-- des entretiens (AUGISTROU CTR-00434 au 30/09, MAZIEL CTR-00808 au 01/10, saisis les 24-26/08).
-- Statut « Réalisé » + date future ⇒ le trigger sync_intervention_from_visit basculait la carte
-- en Réalisé, le contrat comptait comme entretien 2026 fait (hors Programmation / Tournées / SMS)
-- et aucun RDV n'existait : rien au planning. Diagnostic 2026-09-01, règle posée par Eric le
-- 2026-09-28 : « la date saisie ne peut pas être dans le futur ».
--
-- 1. Garde en base (tous écrans) : INSERT, ou UPDATE qui change la date, refusé si la date est
--    postérieure à aujourd'hui (heure de Paris — CURRENT_DATE est en UTC côté serveur).
-- 2. sync_intervention_from_visit ne propage plus qu'une visite datée d'aujourd'hui ou avant
--    (seconde ligne, au cas où une ligne future existerait déjà).
-- 3. Données : suppression des 2 visites 2026 erronées (rejouable : ne supprime que si la ligne
--    est toujours dans son état fautif). Les 2 fautes de frappe « 2029 » (FOURNIER CTR-00075,
--    CABANNES CTR-00526, visites 2019) ne sont pas touchées : la vraie date est inconnue, elles
--    seront corrigées depuis la fiche (la garde oblige à saisir une date passée).

-- ── 1. Garde ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.maintenance_visit_date_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.visit_date IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.visit_date IS NOT DISTINCT FROM OLD.visit_date THEN
    RETURN NEW;
  END IF;
  -- Autoriser positivement (cf. CLAUDE.md) : tout ce qui n'est pas « aujourd'hui ou avant » est refusé.
  IF (NEW.visit_date <= (now() AT TIME ZONE 'Europe/Paris')::date) IS NOT TRUE THEN
    RAISE EXCEPTION 'La date de passage ne peut pas être dans le futur (%). Pour programmer un entretien, planifiez un RDV.',
      to_char(NEW.visit_date, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION majordhome.maintenance_visit_date_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_maintenance_visit_date_guard ON majordhome.maintenance_visits;
CREATE TRIGGER trg_maintenance_visit_date_guard
  BEFORE INSERT OR UPDATE OF visit_date ON majordhome.maintenance_visits
  FOR EACH ROW EXECUTE FUNCTION majordhome.maintenance_visit_date_guard();

-- ── 2. Propagation carte : visite passée uniquement ─────────────────────────
CREATE OR REPLACE FUNCTION public.sync_intervention_from_visit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_intervention_id uuid;
  current_wf text;
  current_status text;
  current_scheduled date;
  current_report timestamptz;
BEGIN
  -- Ne propage que les visites completed de l'année courante
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.visit_year IS DISTINCT FROM date_part('year', CURRENT_DATE)::int THEN
    RETURN NEW;
  END IF;

  -- Une visite datée dans le futur n'est pas un entretien réalisé (20260928_1)
  IF (NEW.visit_date <= (now() AT TIME ZONE 'Europe/Paris')::date) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Intervention parente (la plus récente si plusieurs)
  SELECT id, workflow_status, status, scheduled_date, report_date
    INTO target_intervention_id, current_wf, current_status, current_scheduled, current_report
  FROM majordhome.interventions
  WHERE contract_id = NEW.contract_id
    AND parent_id IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF target_intervention_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Propage uniquement si les valeurs diffèrent (anti-boucle + pas de no-op)
  IF current_wf IS DISTINCT FROM 'realise'
     OR current_status IS DISTINCT FROM 'completed'
     OR current_scheduled IS DISTINCT FROM NEW.visit_date
     OR current_report IS DISTINCT FROM NEW.visit_date::timestamptz
  THEN
    UPDATE majordhome.interventions
       SET workflow_status = 'realise',
           status          = 'completed',
           scheduled_date  = NEW.visit_date,
           report_date     = NEW.visit_date::timestamptz,
           updated_at      = NOW()
     WHERE id = target_intervention_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 3. Données : les 2 visites 2026 « programmées » par erreur ──────────────
DELETE FROM majordhome.maintenance_visits
 WHERE status = 'completed'
   AND (id, visit_date) IN (
     ('bd28c91f-abf2-41f2-b064-c47f1bedd7d6'::uuid, DATE '2026-09-30'),  -- AUGISTROU CTR-00434
     ('eecbe523-bf22-4dc9-a801-d0e1edfc052d'::uuid, DATE '2026-10-01')   -- MAZIEL CTR-00808
   );
