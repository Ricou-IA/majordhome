-- assert-audit-fiche-client.sql — vérifie 20261116_5_audit_fiche_client.sql sur le cluster de répétition.
--
--   node scripts/migration-rehearsal/run.mjs \
--     --migration scripts/migration-rehearsal/fixture-audit-fiche-client.sql \
--     --migration supabase/migrations/20261116_5_audit_fiche_client.sql \
--     --assert scripts/migration-rehearsal/assert-audit-fiche-client.sql
--
-- Les ACL par objet de `majordhome.audit_log` (REVOKE de 20260916_3) ne sont pas photographiées : on ne vérifie
-- ici que ce que CETTE migration pose (vue, fonction, triggers) et le comportement du journal.

-- ── A. Structure et droits ──────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  v_last text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'majordhome' AND table_name = 'audit_log' AND column_name = 'client_id') THEN
    RAISE EXCEPTION 'colonne audit_log.client_id absente';
  END IF;
  IF to_regclass('majordhome.idx_audit_log_client') IS NULL THEN
    RAISE EXCEPTION 'index idx_audit_log_client absent';
  END IF;

  FOREACH t IN ARRAY ARRAY['clients', 'equipments', 'contracts', 'contract_equipments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = ('majordhome.' || t)::regclass AND tgname = 'trg_audit_' || t AND tgenabled = 'O'
    ) THEN
      RAISE EXCEPTION 'trigger trg_audit_% absent ou inactif', t;
    END IF;
  END LOOP;
  -- Le trigger des leads (prod, photographié) doit toujours pointer la fonction remplacée.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'majordhome.leads'::regclass AND tgname = 'trg_audit_leads') THEN
    RAISE EXCEPTION 'trigger trg_audit_leads disparu';
  END IF;

  -- Vue : client_id en DERNIÈRE colonne, security_invoker conservé, fermée à anon, lecture seule.
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_audit_log'
   ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'client_id' THEN RAISE EXCEPTION 'dernière colonne de la vue = % (attendu client_id)', v_last; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.majordhome_audit_log'::regclass
                    AND reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION 'vue majordhome_audit_log sans security_invoker';
  END IF;
  IF has_table_privilege('anon', 'public.majordhome_audit_log', 'SELECT') THEN
    RAISE EXCEPTION 'vue majordhome_audit_log lisible par anon';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_audit_log', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.majordhome_audit_log', 'SELECT') THEN
    RAISE EXCEPTION 'vue majordhome_audit_log illisible par authenticated / service_role';
  END IF;
  IF has_table_privilege('authenticated', 'public.majordhome_audit_log', 'INSERT')
     OR has_table_privilege('authenticated', 'public.majordhome_audit_log', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.majordhome_audit_log', 'DELETE') THEN
    RAISE EXCEPTION 'vue majordhome_audit_log inscriptible par authenticated';
  END IF;
  IF has_function_privilege('anon', 'majordhome.audit_row_change()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'majordhome.audit_row_change()', 'EXECUTE') THEN
    RAISE EXCEPTION 'audit_row_change exécutable par anon / authenticated';
  END IF;
END $$;

-- ── B. Reprise des RDV déjà au journal (fixture) ────────────────────────────
DO $$
DECLARE v_client uuid; v_got uuid;
BEGIN
  SELECT client_id INTO v_client FROM majordhome.appointments WHERE id = 'a0d17000-0000-4000-8000-000000000001';
  SELECT client_id INTO v_got FROM majordhome.audit_log
   WHERE table_name = 'appointments' AND record_id = 'a0d17000-0000-4000-8000-000000000001' AND source = 'fixture';
  IF v_client IS NULL OR v_got IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'reprise : ligne du RDV non rattachée au client (% au lieu de %)', v_got, v_client;
  END IF;
  SELECT client_id INTO v_got FROM majordhome.audit_log
   WHERE table_name = 'appointments' AND record_id = 'a0d17000-0000-4000-8000-000000000002' AND source = 'fixture';
  IF v_got IS NOT NULL THEN RAISE EXCEPTION 'reprise : un RDV sans client a reçu un client (%)', v_got; END IF;
END $$;

-- ── C. Comportement du journal ──────────────────────────────────────────────
DO $$
DECLARE
  v_client uuid; v_project uuid; v_core uuid; v_phone text;
  v_eq uuid := gen_random_uuid();
  v_ct uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_before bigint;
  r record;
  v_member uuid; v_stranger uuid := gen_random_uuid();
  v_n integer;
BEGIN
  SELECT c.id, c.project_id, c.org_id, c.phone INTO v_client, v_project, v_core, v_phone
    FROM majordhome.clients c
    JOIN majordhome.organizations o ON o.core_org_id = c.org_id
   WHERE c.project_id IS NOT NULL
   ORDER BY c.created_at
   LIMIT 1;
  IF v_client IS NULL THEN RAISE EXCEPTION 'aucun client avec projet dans le snapshot'; END IF;

  -- 1. Fiche client : un champ utile → une ligne, rattachée au client et à son org.
  SELECT COALESCE(max(id), 0) INTO v_before FROM majordhome.audit_log;
  UPDATE majordhome.clients SET phone = '0600000000' WHERE id = v_client;
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'clients';
  IF NOT FOUND THEN RAISE EXCEPTION 'clients : aucune ligne après modification du téléphone'; END IF;
  IF r.action <> 'UPDATE' OR r.client_id <> v_client OR r.record_id <> v_client OR r.org_id <> v_core
     OR r.changed_fields <> ARRAY['phone'] OR r.new_values ->> 'phone' <> '0600000000'
     OR (r.old_values ->> 'phone') IS DISTINCT FROM v_phone THEN
    RAISE EXCEPTION 'clients : ligne inattendue %', to_jsonb(r);
  END IF;

  -- 2. Une écriture qui ne touche que des colonnes écartées ne laisse rien.
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  UPDATE majordhome.clients SET updated_at = now() WHERE id = v_client;
  IF EXISTS (SELECT 1 FROM majordhome.audit_log WHERE id > v_before AND table_name = 'clients') THEN
    RAISE EXCEPTION 'clients : une ligne pour updated_at seul';
  END IF;

  -- 3. Équipement : pas d'org_id ni de client_id sur la table → dérivés du projet.
  --    (l'insertion touche clients.updated_at par trigger : aucune ligne « clients » attendue)
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  INSERT INTO majordhome.equipments (id, project_id, brand, model) VALUES (v_eq, v_project, 'ESSAI', 'AUDIT');
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'equipments';
  IF NOT FOUND THEN RAISE EXCEPTION 'equipments : aucune ligne à la création'; END IF;
  IF r.action <> 'INSERT' OR r.record_id <> v_eq OR r.client_id IS DISTINCT FROM v_client OR r.org_id IS DISTINCT FROM v_core
     OR r.new_values ->> 'brand' <> 'ESSAI' OR r.new_values ? 'updated_at' THEN
    RAISE EXCEPTION 'equipments : ligne de création inattendue %', to_jsonb(r);
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.audit_log WHERE id > v_before AND table_name = 'clients') THEN
    RAISE EXCEPTION 'equipments : la création a laissé une ligne « clients » (updated_at par trigger)';
  END IF;

  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  UPDATE majordhome.equipments SET model = 'AUDIT 2' WHERE id = v_eq;
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'equipments';
  IF NOT FOUND OR r.changed_fields <> ARRAY['model'] OR r.client_id IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'equipments : ligne de modification inattendue %', to_jsonb(r);
  END IF;

  -- 4. Contrat : rattaché par client_id ; l'image de la signature n'entre jamais au journal.
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, amount, signature_client_base64)
  VALUES (v_ct, v_core, v_client, 'pending', 190, 'IMAGE-EN-BASE64');
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'contracts';
  IF NOT FOUND THEN RAISE EXCEPTION 'contracts : aucune ligne à la création'; END IF;
  IF r.action <> 'INSERT' OR r.client_id IS DISTINCT FROM v_client OR r.org_id IS DISTINCT FROM v_core
     OR r.new_values ? 'signature_client_base64' OR 'signature_client_base64' = ANY (r.changed_fields) THEN
    RAISE EXCEPTION 'contracts : ligne de création inattendue %', to_jsonb(r) - 'new_values';
  END IF;

  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  UPDATE majordhome.contracts SET signature_client_base64 = 'AUTRE-IMAGE' WHERE id = v_ct;
  IF EXISTS (SELECT 1 FROM majordhome.audit_log WHERE id > v_before AND table_name = 'contracts') THEN
    RAISE EXCEPTION 'contracts : une ligne pour la seule image de signature';
  END IF;
  UPDATE majordhome.contracts SET amount = 210, signature_client_nom = 'ESSAI' WHERE id = v_ct;
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'contracts';
  IF NOT FOUND OR r.changed_fields <> ARRAY['amount', 'signature_client_nom'] OR r.client_id IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'contracts : ligne de modification inattendue %', to_jsonb(r);
  END IF;

  -- 5. Lien contrat ↔ équipement : client et org viennent du contrat ; le retrait laisse aussi une ligne.
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  INSERT INTO majordhome.contract_equipments (contract_id, equipment_id) VALUES (v_ct, v_eq);
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'contract_equipments';
  IF NOT FOUND OR r.action <> 'INSERT' OR r.client_id IS DISTINCT FROM v_client OR r.org_id IS DISTINCT FROM v_core
     OR (r.new_values ->> 'equipment_id')::uuid <> v_eq THEN
    RAISE EXCEPTION 'contract_equipments : ligne d''ajout inattendue %', to_jsonb(r);
  END IF;
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  DELETE FROM majordhome.contract_equipments WHERE contract_id = v_ct AND equipment_id = v_eq;
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'contract_equipments';
  IF NOT FOUND OR r.action <> 'DELETE' OR r.client_id IS DISTINCT FROM v_client
     OR (r.old_values ->> 'equipment_id')::uuid <> v_eq THEN
    RAISE EXCEPTION 'contract_equipments : ligne de retrait inattendue %', to_jsonb(r);
  END IF;

  -- 6. Lead : `lead_id` reste posé (non-régression de 20260916_3), `client_id` s'y ajoute.
  SELECT max(id) INTO v_before FROM majordhome.audit_log;
  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, client_id) VALUES (v_lead, v_core, 'ESSAI', 'AUDIT', v_client);
  SELECT * INTO r FROM majordhome.audit_log WHERE id > v_before AND table_name = 'leads' AND action = 'INSERT';
  IF NOT FOUND OR r.lead_id IS DISTINCT FROM v_lead OR r.client_id IS DISTINCT FROM v_client OR r.org_id IS DISTINCT FROM v_core THEN
    RAISE EXCEPTION 'leads : ligne de création inattendue %', to_jsonb(r) - 'new_values';
  END IF;

  -- 7. Isolement : un membre de l'org lit les lignes du client par la vue, un inconnu n'en lit aucune
  --    — y compris celles dont l'org a été DÉRIVÉE de la fiche (équipement, lien contrat).
  SELECT om.user_id INTO v_member FROM core.organization_members om WHERE om.org_id = v_core LIMIT 1;
  IF v_member IS NULL THEN RAISE EXCEPTION 'aucun membre pour l''org %', v_core; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_audit_log
   WHERE client_id = v_client AND table_name IN ('clients', 'equipments', 'contracts', 'contract_equipments');
  IF v_n < 6 THEN RAISE EXCEPTION 'membre : % lignes lues pour le client (6 attendues au moins)', v_n; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_audit_log WHERE client_id = v_client;
  IF v_n <> 0 THEN RAISE EXCEPTION 'inconnu : % lignes lues pour le client d''une autre org', v_n; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- Ménage (le journal, lui, garde ses lignes : il est append-only).
  DELETE FROM majordhome.leads WHERE id = v_lead;
  DELETE FROM majordhome.contracts WHERE id = v_ct;
  DELETE FROM majordhome.equipments WHERE id = v_eq;
  UPDATE majordhome.clients SET phone = v_phone WHERE id = v_client;

  RAISE NOTICE 'audit fiche client : OK (client %, org %)', v_client, v_core;
END $$;
