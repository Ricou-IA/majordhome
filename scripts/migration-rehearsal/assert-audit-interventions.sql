-- assert-audit-interventions.sql — vérifie 20261117_1_audit_interventions.sql sur le cluster de répétition.
--
--   node scripts/migration-rehearsal/run.mjs \
--     --migration supabase/migrations/20261117_1_audit_interventions.sql \
--     --assert scripts/migration-rehearsal/assert-audit-interventions.sql
--
-- Photo prise APRÈS 20261116_5 (colonne audit_log.client_id et fonction à jour en prod). `interventions` est
-- photographiée sans données ni triggers de prod : le jeu d'essai est créé ici, puis retiré.

-- ── A. Structure ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'majordhome.interventions'::regclass AND tgname = 'trg_audit_interventions' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'trigger trg_audit_interventions absent ou inactif';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'majordhome' AND table_name = 'audit_log' AND column_name = 'client_id') THEN
    RAISE EXCEPTION 'photo antérieure à 20261116_5 : audit_log.client_id absente (reprendre snapshot.mjs)';
  END IF;
END $$;

-- ── B. Comportement ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_client uuid; v_project uuid; v_core uuid;
  v_sav uuid := gen_random_uuid();      -- demande SAV rattachée par client_id
  v_ent uuid := gen_random_uuid();      -- entretien rattaché par project_id seul
  v_enfant uuid := gen_random_uuid();   -- ligne enfant (un certificat par équipement)
  v_before bigint;
  r record;
  v_member uuid; v_stranger uuid := gen_random_uuid();
  v_n integer;
BEGIN
  SELECT c.id, c.project_id, c.org_id INTO v_client, v_project, v_core
    FROM majordhome.clients c
    JOIN majordhome.organizations o ON o.core_org_id = c.org_id
   WHERE c.project_id IS NOT NULL
   ORDER BY c.created_at
   LIMIT 1;
  IF v_client IS NULL THEN RAISE EXCEPTION 'aucun client avec projet dans le snapshot'; END IF;

  -- 1. Demande SAV avec client_id : une ligne de création, rattachée à la fiche, org dérivée de la fiche.
  SELECT COALESCE(max(id), 0) INTO v_before FROM majordhome.audit_log;
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, workflow_status, sav_description, sav_urgency)
  VALUES (v_sav, v_project, v_client, 'sav', 'demande', 'Essai du journal', 'urgent');
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'interventions';
  IF NOT FOUND THEN RAISE EXCEPTION 'interventions : aucune ligne à la création'; END IF;
  IF r.action <> 'INSERT' OR r.record_id <> v_sav OR r.client_id IS DISTINCT FROM v_client OR r.org_id IS DISTINCT FROM v_core
     OR r.new_values ->> 'sav_description' <> 'Essai du journal' OR r.new_values ? 'updated_at' THEN
    RAISE EXCEPTION 'interventions : ligne de création inattendue %', to_jsonb(r);
  END IF;

  -- 2. Changement d'état : seuls les champs modifiés, avant et après.
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  UPDATE majordhome.interventions SET workflow_status = 'realise', sav_urgency = 'normal' WHERE id = v_sav;
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'interventions';
  IF NOT FOUND OR r.action <> 'UPDATE' OR r.changed_fields <> ARRAY['sav_urgency', 'workflow_status']
     OR r.old_values ->> 'workflow_status' <> 'demande' OR r.new_values ->> 'workflow_status' <> 'realise'
     OR r.client_id IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'interventions : ligne de modification inattendue %', to_jsonb(r);
  END IF;

  -- 3. updated_at seul : rien.
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  UPDATE majordhome.interventions SET updated_at = now() WHERE id = v_sav;
  IF EXISTS (SELECT 1 FROM majordhome.audit_log WHERE id > v_before AND table_name = 'interventions') THEN
    RAISE EXCEPTION 'interventions : une ligne pour updated_at seul';
  END IF;

  -- 4. Entretien SANS client_id (401 lignes en prod) : rattaché par le projet.
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  INSERT INTO majordhome.interventions (id, project_id, intervention_type, workflow_status)
  VALUES (v_ent, v_project, 'entretien', 'a_planifier');
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'interventions';
  IF NOT FOUND OR r.client_id IS DISTINCT FROM v_client OR r.org_id IS DISTINCT FROM v_core THEN
    RAISE EXCEPTION 'interventions : entretien sans client_id non rattaché par le projet %', to_jsonb(r);
  END IF;

  -- 5. Ligne enfant : tracée aussi, avec son parent lisible (c'est l'écran qui masque création et purge).
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  INSERT INTO majordhome.interventions (id, project_id, intervention_type, workflow_status, parent_id)
  VALUES (v_enfant, v_project, 'entretien', 'planifie', v_ent);
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'interventions';
  IF NOT FOUND OR (r.new_values ->> 'parent_id')::uuid <> v_ent OR r.client_id IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'interventions : ligne enfant inattendue %', to_jsonb(r);
  END IF;
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  DELETE FROM majordhome.interventions WHERE id = v_enfant;
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'interventions';
  IF NOT FOUND OR r.action <> 'DELETE' OR (r.old_values ->> 'parent_id')::uuid <> v_ent THEN
    RAISE EXCEPTION 'interventions : purge d''une ligne enfant non tracée %', to_jsonb(r);
  END IF;

  -- 6. Isolement : un membre de l'org lit ces lignes par la vue, un inconnu n'en lit aucune.
  SELECT om.user_id INTO v_member FROM core.organization_members om WHERE om.org_id = v_core LIMIT 1;
  IF v_member IS NULL THEN RAISE EXCEPTION 'aucun membre pour l''org %', v_core; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_audit_log WHERE client_id = v_client AND table_name = 'interventions';
  IF v_n < 5 THEN RAISE EXCEPTION 'membre : % lignes lues (5 attendues au moins)', v_n; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_audit_log WHERE client_id = v_client AND table_name = 'interventions';
  IF v_n <> 0 THEN RAISE EXCEPTION 'inconnu : % lignes lues pour le client d''une autre org', v_n; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- Ménage (le journal garde ses lignes : il est append-only).
  DELETE FROM majordhome.interventions WHERE id IN (v_sav, v_ent);

  RAISE NOTICE 'audit interventions : OK (client %, org %)', v_client, v_core;
END $$;
