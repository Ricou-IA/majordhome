-- ============================================================================
-- 20260930_3 — auto_rdv_poser : la borne « mois en cours » se prolonge au mois
-- suivant quand il reste moins de 7 jours (même règle que auto-rdv.js::bornesMois
-- et que l'expiration du lien). Vécu le 2026-09-29 : lien ouvert le 29, aucune
-- demi-journée proposable (le délai de 2 jours sortait du mois). L'offre reste
-- limitée aux journées déjà amorcées ou étiquetées : aucune journée vierge du
-- mois suivant n'est jamais proposée (journeesProposables).
-- Seule la garde `hors_mois` change ; le reste du corps est identique à 20260930_2.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_rdv_poser(
  p_contract_id    uuid,
  p_team_member_id uuid,
  p_date           date,
  p_demi           text,
  p_start          time,
  p_end            time,
  p_duration       int,
  p_empreinte      text,
  p_grand_secteur  text,
  p_source         text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_ct        record;
  v_cl        record;
  v_core      uuid;
  v_mdh       uuid;
  v_tm_id     uuid;
  v_empreinte text;
  v_card      uuid;
  v_created   boolean := false;
  v_appt      uuid;
  v_now       timestamptz := now();
  v_fin_mois  date;
  v_borne     date;
BEGIN
  IF p_contract_id IS NULL OR p_team_member_id IS NULL OR p_date IS NULL
     OR p_demi IS NULL OR p_demi NOT IN ('matin', 'apres_midi')
     OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start
     OR p_duration IS NULL OR p_duration <= 0 THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;

  -- Horizon = mois en cours, prolongé au mois suivant s'il reste moins de 7 jours
  -- (bornesMois côté moteur : prolongerSiResteMoins = 7).
  v_fin_mois := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_borne := CASE WHEN v_fin_mois - current_date < 7
                  THEN (date_trunc('month', current_date) + interval '2 month - 1 day')::date
                  ELSE v_fin_mois END;
  IF p_date < current_date OR p_date > v_borne THEN
    RAISE EXCEPTION 'hors_mois';
  END IF;

  SELECT c.id, c.org_id, c.client_id, c.status INTO v_ct
    FROM majordhome.contracts c WHERE c.id = p_contract_id;
  IF v_ct.id IS NULL THEN RAISE EXCEPTION 'contrat_introuvable'; END IF;
  IF v_ct.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'contrat_inactif'; END IF;
  v_core := v_ct.org_id;

  SELECT o.id INTO v_mdh FROM majordhome.organizations o WHERE o.core_org_id = v_core;
  IF v_mdh IS NULL THEN RAISE EXCEPTION 'org_majordhome_introuvable'; END IF;

  SELECT cl.id, cl.project_id, cl.first_name, cl.last_name, cl.display_name,
         cl.phone, cl.email, cl.address, cl.city, cl.postal_code
    INTO v_cl
    FROM majordhome.clients cl WHERE cl.id = v_ct.client_id AND cl.org_id = v_core;
  IF v_cl.id IS NULL THEN RAISE EXCEPTION 'contrat_introuvable'; END IF;
  IF v_cl.project_id IS NULL THEN RAISE EXCEPTION 'client_sans_projet'; END IF;

  SELECT tm.id INTO v_tm_id
    FROM majordhome.team_members tm
   WHERE tm.id = p_team_member_id AND tm.org_id = v_mdh
     AND tm.is_active IS TRUE AND tm.include_in_routing IS TRUE AND tm.role = 'technician';
  IF v_tm_id IS NULL THEN RAISE EXCEPTION 'technicien_invalide'; END IF;

  IF EXISTS (
    SELECT 1 FROM majordhome.journees_secteur js
     WHERE js.org_id = v_core AND js.team_member_id = p_team_member_id
       AND js.date = p_date AND js.figee_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'journee_figee';
  END IF;

  SELECT coalesce(string_agg(a.id::text || '@' || to_char(a.scheduled_start, 'HH24:MI'), ',' ORDER BY a.id::text), '')
    INTO v_empreinte
    FROM majordhome.appointments a
    JOIN majordhome.appointment_technicians at
      ON at.appointment_id = a.id AND at.technician_id = p_team_member_id
   WHERE a.org_id = v_mdh AND a.scheduled_date = p_date
     AND a.status NOT IN ('cancelled', 'no_show');
  IF v_empreinte IS DISTINCT FROM coalesce(p_empreinte, '') THEN
    RAISE EXCEPTION 'journee_modifiee';
  END IF;

  SELECT i.id INTO v_card
    FROM majordhome.interventions i
   WHERE i.client_id = v_cl.id AND i.intervention_type = 'entretien' AND i.parent_id IS NULL
     AND i.workflow_status NOT IN ('realise', 'facture')
   ORDER BY i.created_at DESC LIMIT 1;
  IF v_card IS NOT NULL AND EXISTS (
    SELECT 1 FROM majordhome.appointments a
     WHERE a.intervention_id = v_card AND a.scheduled_date >= current_date
       AND a.status NOT IN ('cancelled', 'no_show')
  ) THEN
    RAISE EXCEPTION 'deja_planifie';
  END IF;

  IF v_card IS NULL THEN
    INSERT INTO majordhome.interventions
      (project_id, client_id, contract_id, intervention_type, workflow_status, scheduled_date, status, tags)
    VALUES
      (v_cl.project_id, v_cl.id, v_ct.id, 'entretien', 'planifie', p_date, 'scheduled', ARRAY['Contrat']::text[])
    RETURNING id INTO v_card;
    v_created := true;
  ELSE
    UPDATE majordhome.interventions
       SET workflow_status = 'planifie', scheduled_date = p_date,
           contract_id = coalesce(contract_id, v_ct.id), updated_at = v_now
     WHERE id = v_card;
  END IF;

  INSERT INTO majordhome.appointments (
    org_id, appointment_type, subject, scheduled_date, scheduled_start, scheduled_end, duration_minutes,
    intervention_id, client_id, client_name, client_first_name, client_phone, client_email,
    address, city, postal_code, status, priority, source,
    time_flex_minutes, hour_confirmed_at, announced_start, grand_secteur
  ) VALUES (
    v_mdh, 'maintenance', 'Entretien', p_date, p_start, p_end, p_duration,
    v_card, v_cl.id, coalesce(v_cl.last_name, v_cl.display_name), v_cl.first_name, v_cl.phone, v_cl.email,
    v_cl.address, v_cl.city, v_cl.postal_code, 'scheduled', 'normal', coalesce(p_source, 'auto_rdv'),
    240, NULL, p_start, p_grand_secteur
  ) RETURNING id INTO v_appt;

  INSERT INTO majordhome.appointment_technicians (appointment_id, technician_id, role)
  VALUES (v_appt, p_team_member_id, 'lead');

  INSERT INTO majordhome.journees_secteur (org_id, date, team_member_id, grand_secteur, origine)
  VALUES (v_core, p_date, p_team_member_id, p_grand_secteur, 'deduite')
  ON CONFLICT (org_id, team_member_id, date) DO UPDATE
    SET grand_secteur = coalesce(majordhome.journees_secteur.grand_secteur, EXCLUDED.grand_secteur),
        updated_at = v_now;

  RETURN jsonb_build_object('appointment_id', v_appt, 'intervention_id', v_card, 'carte_creee', v_created);
END
$$;

REVOKE EXECUTE ON FUNCTION public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text)
  TO service_role;
