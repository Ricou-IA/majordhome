-- Regroupement d'un foyer en double : BRUN NICOLE (CLI-01041) absorbe BRUN PATRICK (CLI-03384).
-- Correction de données ponctuelle, demandée par Eric le 2026-11-05.
--
-- Les deux fiches portent le même e-mail, le même téléphone et, depuis la fusion côté
-- Pennylane du 2026-09-30, le même customer (244601196). Un RDV posé sur la fiche vide
-- a créé un second lead et un RDV sans adresse.
--
-- Un seul bloc : la moindre garde en échec annule tout. La fiche absorbée est archivée,
-- jamais supprimée ; l'instantané du lead absorbé est dans l'activité `lead_merged`.
DO $$
DECLARE
  c_nicole   constant uuid := '0c6cf167-c970-4fa8-a366-48e26f08299d';
  c_patrick  constant uuid := '63f7d9dc-edea-44be-a74e-3bbf5bbcc34d';
  l_survivor constant uuid := '97c17d1a-b926-4d12-97e5-4b7fadeeb179';
  l_absorbe  constant uuid := 'cb3e0bd2-bca7-422c-88e6-b116c58e9564';
  r_visite   constant uuid := '37a67190-c476-4480-961f-8024fef0394c';
  r_entretien constant uuid := 'a845a5d6-5499-476e-a632-02f6a1b5dda7';
  u_eric     constant uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_statut uuid;
  v_nicole majordhome.clients%ROWTYPE;
  v_mails int;
  v_merge jsonb;
BEGIN
  -- ============== Gardes : l'état doit être celui du diagnostic ==============
  SELECT * INTO v_nicole FROM majordhome.clients WHERE id = c_nicole AND is_archived IS NOT TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'garde: fiche NICOLE absente ou archivée'; END IF;

  PERFORM 1 FROM majordhome.clients
   WHERE id = c_patrick AND is_archived IS NOT TRUE AND lower(email) = lower(v_nicole.email) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'garde: fiche PATRICK absente, archivée ou e-mail différent'; END IF;

  SELECT status_id INTO v_statut FROM majordhome.leads
   WHERE id = l_survivor AND client_id = c_nicole AND is_deleted IS NOT TRUE;
  IF v_statut IS NULL THEN RAISE EXCEPTION 'garde: lead survivant inattendu'; END IF;

  PERFORM 1 FROM majordhome.leads WHERE id = l_absorbe AND client_id = c_patrick AND is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'garde: lead absorbé inattendu'; END IF;

  -- Rien d'autre que ce qu'on sait déplacer sur la fiche absorbée
  IF (SELECT count(*) FROM majordhome.leads WHERE client_id = c_patrick) <> 1
     OR (SELECT count(*) FROM majordhome.appointments WHERE client_id = c_patrick) <> 1
     OR (SELECT count(*) FROM majordhome.contracts WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.interventions WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.certificats WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.quotes WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.chantiers WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.invoices WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.client_activities WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.sms_logs WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.equipments e JOIN majordhome.clients c ON c.project_id = e.project_id WHERE c.id = c_patrick) <> 0
  THEN
    RAISE EXCEPTION 'garde: la fiche absorbée porte des données imprévues';
  END IF;

  -- ============== Lead : lead_merge reste l'unique chemin de fusion ==============
  -- Fonction org_admin lue sur auth.uid() : exécutée au nom d'Eric, qui l'a demandée
  -- (réglage local à cette transaction ; le mouchard l'attribue donc à Eric).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_eric, 'role', 'authenticated')::text, true);
  v_merge := public.lead_merge(l_survivor, l_absorbe);

  -- Même numéro écrit autrement (667462657 / 06 67 46 26 57) : lead_merge l'a pris pour
  -- un second téléphone.
  UPDATE majordhome.leads SET phone_secondary = NULL WHERE id = l_survivor;

  UPDATE majordhome.leads SET client_id = c_nicole WHERE id = l_absorbe;

  -- ============== RDV du 9 novembre : la fiche, l'adresse, le secteur ==============
  UPDATE majordhome.appointments SET
    client_id = c_nicole,
    client_first_name = v_nicole.first_name,
    client_name = v_nicole.last_name,
    address = v_nicole.address,
    postal_code = v_nicole.postal_code,
    city = v_nicole.city,
    grand_secteur = (SELECT grand_secteur FROM majordhome.appointments WHERE id = r_entretien),
    subject = 'Visite Technique R1 — BRUN NICOLE',
    updated_at = now()
  WHERE id = r_visite AND lead_id = l_survivor;
  IF NOT FOUND THEN RAISE EXCEPTION 'contrôle: RDV non rattaché au lead survivant'; END IF;

  -- ============== Historique des mails ==============
  UPDATE majordhome.mailing_logs SET client_id = c_nicole WHERE client_id = c_patrick;
  GET DIAGNOSTICS v_mails = ROW_COUNT;

  -- ============== Fiche absorbée : plus de lien Pennylane, archivée ==============
  DELETE FROM majordhome.pennylane_sync WHERE entity_type = 'client' AND local_id = c_patrick;

  UPDATE majordhome.clients SET
    is_archived = true,
    archived_at = now(),
    pennylane_account_number = NULL,
    internal_notes = 'Doublon regroupé le 05/11/2026 dans BRUN NICOLE (CLI-01041). Compte Pennylane 411000118 retiré de cette fiche.'
  WHERE id = c_patrick;

  UPDATE majordhome.dedup_candidates SET
    decision = 'merge',
    decided_at = now(),
    decided_by = u_eric,
    decision_reason = 'Regroupé à la main le 05/11/2026 : même foyer, même customer Pennylane.'
  WHERE canonical_client_id = c_nicole AND duplicate_client_id = c_patrick;

  -- ============== Contrôles : rien ne doit rester à moitié fait ==============
  IF (SELECT count(*) FROM majordhome.leads WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.appointments WHERE client_id = c_patrick) <> 0
     OR (SELECT count(*) FROM majordhome.mailing_logs WHERE client_id = c_patrick) <> 0
  THEN
    RAISE EXCEPTION 'contrôle: des données pointent encore sur la fiche absorbée';
  END IF;

  IF (SELECT status_id FROM majordhome.leads WHERE id = l_survivor) IS DISTINCT FROM v_statut THEN
    RAISE EXCEPTION 'contrôle: le statut du lead survivant a changé';
  END IF;

  IF (SELECT count(*) FROM majordhome.lead_pennylane_quotes WHERE lead_id = l_survivor AND ejected_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'contrôle: le devis n''est plus rattaché au lead survivant';
  END IF;

  IF (SELECT is_deleted FROM majordhome.leads WHERE id = l_absorbe) IS NOT TRUE THEN
    RAISE EXCEPTION 'contrôle: le lead absorbé n''est pas retiré';
  END IF;

  IF (SELECT count(*) FROM majordhome.pennylane_sync WHERE entity_type = 'client' AND local_id = c_nicole AND pennylane_id = 244601196) <> 1 THEN
    RAISE EXCEPTION 'contrôle: la fiche NICOLE a perdu son lien Pennylane';
  END IF;

  RAISE NOTICE 'Regroupement BRUN : % mails déplacés, fusion %', v_mails, v_merge;
END;
$$;
