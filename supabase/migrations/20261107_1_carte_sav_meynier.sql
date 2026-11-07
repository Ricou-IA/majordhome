-- Carte SAV manquante : MEYNIER LAURENT, RDV du 05/11/2026 à 12:00.
-- Correction de données ponctuelle, demandée par Eric le 2026-11-07.
--
-- Le RDV a été posé en choisissant le lead dans la recherche unifiée : il est parti avec
-- `lead_id` et sans intervention, donc sans carte dans le suivi d'entretien (corrigé pour
-- les RDV à venir par 033410b1). Le RDV porte le nom « MENEYER LAURENS » : même téléphone,
-- e-mail et adresse que la fiche, faute de frappe laissée telle quelle.
--
-- Mêmes valeurs qu'`ensureEntretienCard`, carte en « Planifié ». Un seul bloc : la moindre
-- garde en échec annule tout. L'ancien `lead_id` du RDV reste lisible dans `audit_log`.
DO $$
DECLARE
  r_sav    constant uuid := '16083db2-3f59-46c9-b25d-15d7dd674538';
  c_client constant uuid := '2892b683-abeb-42a8-a295-a7b5818d0053';
  l_lead   constant uuid := 'f0da6507-233c-4d1e-add0-3017e1839f40';
  v_rdv majordhome.appointments%ROWTYPE;
  v_project uuid;
  v_carte uuid;
BEGIN
  -- ============== Gardes : l'état doit être celui du diagnostic ==============
  SELECT * INTO v_rdv FROM majordhome.appointments
   WHERE id = r_sav AND appointment_type = 'service' AND status = 'scheduled'
     AND client_id = c_client AND lead_id = l_lead AND intervention_id IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'garde: RDV absent ou déjà modifié'; END IF;

  SELECT project_id INTO v_project FROM majordhome.clients WHERE id = c_client;
  IF v_project IS NULL THEN RAISE EXCEPTION 'garde: client sans projet'; END IF;

  IF EXISTS (SELECT 1 FROM majordhome.interventions WHERE client_id = c_client) THEN
    RAISE EXCEPTION 'garde: une intervention existe déjà pour ce client';
  END IF;

  -- ============== Carte SAV ==============
  INSERT INTO majordhome.interventions (
    project_id, client_id, contract_id, intervention_type, workflow_status,
    scheduled_date, status, created_by, tags
  ) VALUES (
    v_project, c_client, NULL, 'sav', 'planifie',
    v_rdv.scheduled_date, 'scheduled', v_rdv.created_by::uuid, '{}'
  )
  RETURNING id INTO v_carte;

  -- ============== RDV : porté par la carte, plus par le lead ==============
  UPDATE majordhome.appointments
     SET intervention_id = v_carte, lead_id = NULL, updated_at = now()
   WHERE id = r_sav AND intervention_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'contrôle: RDV non relié à la carte'; END IF;

  RAISE NOTICE 'Carte SAV % créée pour le RDV %', v_carte, r_sav;
END;
$$;
