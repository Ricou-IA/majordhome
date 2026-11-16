-- assert-lead-rename-rdv.sql — vérifie 20261116_2_lead_rename_suit_les_rdv.sql
-- sur le cluster de répétition (leads / appointments photographiées SANS données :
-- le jeu d'essai est créé ici, puis retiré).

-- ── A. Structure et droits ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'majordhome.leads'::regclass
       AND tgname = 'trg_lead_rename_sync_appointments' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'trigger trg_lead_rename_sync_appointments absent ou inactif';
  END IF;
  IF has_function_privilege('anon', 'majordhome.lead_rename_sync_appointments()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lead_rename_sync_appointments exécutable par anon';
  END IF;
  IF has_function_privilege('authenticated', 'majordhome.lead_rename_sync_appointments()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lead_rename_sync_appointments exécutable par authenticated';
  END IF;
END $$;

-- ── B. Comportement ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_core uuid; v_mdh uuid;
  v_lead uuid := gen_random_uuid();
  v_autre_lead uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid();  -- copie du lead, objet « prénom nom »
  r2 uuid := gen_random_uuid();  -- même lead, autre personne
  r3 uuid := gen_random_uuid();  -- copie du lead sans prénom, casse et espaces différents
  r4 uuid := gen_random_uuid();  -- copie du lead, objet « nom prénom »
  r5 uuid := gen_random_uuid();  -- homonyme rattaché à un AUTRE lead
  v record;
BEGIN
  SELECT o.core_org_id, o.id INTO v_core, v_mdh
    FROM majordhome.organizations o WHERE o.core_org_id IS NOT NULL LIMIT 1;
  IF v_mdh IS NULL THEN RAISE EXCEPTION 'aucune organisation majordhome dans le snapshot'; END IF;

  INSERT INTO majordhome.leads (id, org_id, first_name, last_name) VALUES
    (v_lead, v_core, 'MME', 'CANDOM'),
    (v_autre_lead, v_core, 'MME', 'CANDOM');

  INSERT INTO majordhome.appointments
    (id, org_id, lead_id, scheduled_date, scheduled_start, client_name, client_first_name, subject) VALUES
    (r1, v_mdh, v_lead,       '2026-10-09', '10:30', 'CANDOM',   'MME',   'Visite technique - MME CANDOM'),
    (r2, v_mdh, v_lead,       '2026-10-10', '10:30', 'PERRY',    'DAVID', 'Visite technique - DAVID PERRY'),
    (r3, v_mdh, v_lead,       '2026-10-11', '10:30', ' candom ', NULL,    'Visite technique - CANDOM'),
    (r4, v_mdh, v_lead,       '2026-10-12', '10:30', 'CANDOM',   'MME',   'Visite Technique R1 — CANDOM MME'),
    (r5, v_mdh, v_autre_lead, '2026-10-13', '10:30', 'CANDOM',   'MME',   'Visite technique - MME CANDOM');

  -- 1. Une écriture qui ne touche pas au nom ne touche à aucun RDV.
  UPDATE majordhome.leads SET email = 'essai@example.invalid' WHERE id = v_lead;
  IF (SELECT client_name FROM majordhome.appointments WHERE id = r1) <> 'CANDOM' THEN
    RAISE EXCEPTION 'RDV renommé sans changement de nom du lead';
  END IF;

  -- 2. Renommage (même écriture que pennylane_sync_overwrite_lead_fields et update_majordhome_lead).
  UPDATE majordhome.leads SET first_name = 'KLOE', last_name = 'CONDOM' WHERE id = v_lead;

  SELECT * INTO v FROM majordhome.appointments WHERE id = r1;
  IF v.client_name <> 'CONDOM' OR v.client_first_name <> 'KLOE' THEN
    RAISE EXCEPTION 'r1 : nom non suivi (% %)', v.client_name, v.client_first_name;
  END IF;
  IF v.subject <> 'Visite technique - KLOE CONDOM' THEN RAISE EXCEPTION 'r1 : objet « % »', v.subject; END IF;

  SELECT * INTO v FROM majordhome.appointments WHERE id = r2;
  IF v.client_name <> 'PERRY' OR v.client_first_name <> 'DAVID' OR v.subject <> 'Visite technique - DAVID PERRY' THEN
    RAISE EXCEPTION 'r2 : RDV d''une autre personne modifié (% % / %)', v.client_name, v.client_first_name, v.subject;
  END IF;

  SELECT * INTO v FROM majordhome.appointments WHERE id = r3;
  IF v.client_name <> 'CONDOM' OR v.client_first_name <> 'KLOE' THEN
    RAISE EXCEPTION 'r3 : nom non suivi (% %)', v.client_name, v.client_first_name;
  END IF;
  IF v.subject <> 'Visite technique - CANDOM' THEN RAISE EXCEPTION 'r3 : objet réécrit sans motif exact (« % »)', v.subject; END IF;

  SELECT * INTO v FROM majordhome.appointments WHERE id = r4;
  IF v.subject <> 'Visite Technique R1 — CONDOM KLOE' THEN RAISE EXCEPTION 'r4 : objet « % »', v.subject; END IF;

  SELECT * INTO v FROM majordhome.appointments WHERE id = r5;
  IF v.client_name <> 'CANDOM' OR v.client_first_name <> 'MME' THEN
    RAISE EXCEPTION 'r5 : RDV d''un autre lead modifié (% %)', v.client_name, v.client_first_name;
  END IF;

  -- 3. Un nom vidé n'efface pas le nom des RDV.
  UPDATE majordhome.leads SET last_name = NULL WHERE id = v_lead;
  IF (SELECT client_name FROM majordhome.appointments WHERE id = r1) <> 'CONDOM' THEN
    RAISE EXCEPTION 'nom du RDV effacé par un nom de lead vidé';
  END IF;

  DELETE FROM majordhome.appointments WHERE id IN (r1, r2, r3, r4, r5);
  DELETE FROM majordhome.leads WHERE id IN (v_lead, v_autre_lead);
  RAISE NOTICE 'lead_rename_sync_appointments : 5 RDV d''essai, comportement conforme';
END $$;
