-- 20261010_4 — Effacer une visite d'entretien saisie par erreur (fiche client → Contrat).
--
-- Demande Eric 2026-10-10 : la ligne de l'année en cours doit être « nullable ». Une date
-- ou un refus posé par erreur ne pouvait plus être retiré : seuls « Réalisé » et « Refusé »
-- étaient proposés, et une visite `completed` de l'année avait déjà basculé la carte Kanban
-- en Réalisé via `sync_intervention_from_visit` (report_date, scheduled_date, status).
--
-- Un DELETE depuis le front ne suffisait pas : le trigger ne joue pas sur DELETE, la carte
-- restait Réalisé sans visite (l'invariant du 2026-09-11 : Réalisé ⇒ visite datée de l'année).
-- D'où une RPC unique, atomique, qui défait exactement ce que la saisie a fait :
--   1. visite `completed` de l'ANNÉE EN COURS → la carte entretien du contrat est remise à sa
--      place : « Planifié » si un RDV planning lui est encore lié (date = ce RDV), sinon
--      « À planifier » ; `report_date` effacé. Refus si la carte est facturée
--      (`visite_facturee`) ou porte un certificat signé (`certificat_signe`) : dans ces deux cas
--      la visite n'est pas une faute de frappe, elle vient du terrain, et se défait ailleurs.
--   2. visite refusée, ou d'une année passée → aucune carte touchée (le trigger n'avait rien fait).
--   3. DELETE de la ligne → la ligne repasse « En attente » ; `current_year_visit_status` des
--      vues contrats se recalcule seul (dérivé de maintenance_visits).
-- Droit : `role_can(org, 'clients', 'edit')` — même garde que l'UPDATE d'interventions,
-- le contrat faisant partie de la fiche client.

CREATE OR REPLACE FUNCTION public.maintenance_visit_clear(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_visit        majordhome.maintenance_visits%ROWTYPE;
  v_card_id      uuid;
  v_card_wf      text;
  v_card_type    text;
  v_rdv_date     date;
  v_reverted_to  text := NULL;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_visit_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_visit FROM majordhome.maintenance_visits WHERE id = p_visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Autoriser positivement (cf. CLAUDE.md) : NULL = refus.
  IF majordhome.role_can(v_visit.org_id, 'clients', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- ── 1. Carte Kanban : seule une visite réalisée de l'année en cours l'a fait bouger ───
  IF v_visit.status = 'completed'
     AND v_visit.visit_year = date_part('year', (now() AT TIME ZONE 'Europe/Paris'))::int
  THEN
    -- Même cible que sync_intervention_from_visit (racine la plus récente du contrat),
    -- restreinte aux entretiens ; la visite peut aussi porter sa carte (recordRootVisit).
    IF v_visit.intervention_id IS NOT NULL THEN
      SELECT id, workflow_status, intervention_type INTO v_card_id, v_card_wf, v_card_type
      FROM majordhome.interventions WHERE id = v_visit.intervention_id AND parent_id IS NULL;
    END IF;
    IF v_card_id IS NULL THEN
      SELECT id, workflow_status, intervention_type INTO v_card_id, v_card_wf, v_card_type
      FROM majordhome.interventions
      WHERE contract_id = v_visit.contract_id
        AND parent_id IS NULL
        AND intervention_type = 'entretien'
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    IF v_card_id IS NOT NULL AND v_card_type = 'entretien' THEN
      IF v_card_wf = 'facture' THEN
        RAISE EXCEPTION 'visite_facturee' USING ERRCODE = 'P0001';
      END IF;

      IF v_card_wf = 'realise' THEN
        IF EXISTS (
          SELECT 1
          FROM majordhome.certificats ce
          JOIN majordhome.interventions c ON c.id = ce.intervention_id
          WHERE (c.id = v_card_id OR c.parent_id = v_card_id)
            AND ce.statut = 'signe'
        ) THEN
          RAISE EXCEPTION 'certificat_signe' USING ERRCODE = 'P0001';
        END IF;

        -- Un RDV planning encore lié ⇒ la carte était « Planifié » ; sinon « À planifier ».
        SELECT max(a.scheduled_date::date) INTO v_rdv_date
        FROM majordhome.appointments a
        WHERE a.intervention_id = v_card_id
          AND a.status IS DISTINCT FROM 'cancelled';

        IF v_rdv_date IS NOT NULL THEN
          v_reverted_to := 'planifie';
          UPDATE majordhome.interventions
             SET workflow_status = 'planifie',
                 status          = 'scheduled',
                 scheduled_date  = v_rdv_date,
                 report_date     = NULL,
                 updated_at      = now()
           WHERE id = v_card_id;
        ELSE
          v_reverted_to := 'a_planifier';
          UPDATE majordhome.interventions
             SET workflow_status = 'a_planifier',
                 status          = 'scheduled',
                 scheduled_date  = NULL,
                 report_date     = NULL,
                 updated_at      = now()
           WHERE id = v_card_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── 2. La visite elle-même ───────────────────────────────────────────────────────
  DELETE FROM majordhome.maintenance_visits WHERE id = p_visit_id;

  RETURN jsonb_build_object(
    'visit_id',         p_visit_id,
    'visit_year',       v_visit.visit_year,
    'card_id',          CASE WHEN v_reverted_to IS NULL THEN NULL ELSE v_card_id END,
    'card_reverted_to', v_reverted_to
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.maintenance_visit_clear(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maintenance_visit_clear(uuid) TO authenticated, service_role;
