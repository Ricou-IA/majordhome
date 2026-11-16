-- fixture-audit-fiche-client.sql — données de répétition pour 20261116_5 (jouée via --migration AVANT la migration).
-- Un RDV rattaché à un client et sa ligne de journal écrite AVANT la colonne `client_id` : la reprise de la
-- migration doit la rattacher à la fiche. Un second RDV sans client : sa ligne doit rester sans client.
DO $$
DECLARE
  v_mdh uuid; v_core uuid; v_client uuid;
BEGIN
  SELECT c.id, c.org_id, o.id INTO v_client, v_core, v_mdh
    FROM majordhome.clients c
    JOIN majordhome.organizations o ON o.core_org_id = c.org_id
   WHERE c.project_id IS NOT NULL
   ORDER BY c.created_at
   LIMIT 1;
  IF v_client IS NULL THEN RAISE EXCEPTION 'aucun client avec projet dans le snapshot'; END IF;

  INSERT INTO majordhome.appointments (id, org_id, client_id, scheduled_date, scheduled_start, client_name, subject) VALUES
    ('a0d17000-0000-4000-8000-000000000001', v_mdh, v_client, '2026-10-09', '10:30', 'REPRISE', 'RDV avec client'),
    ('a0d17000-0000-4000-8000-000000000002', v_mdh, NULL,     '2026-10-10', '10:30', 'REPRISE', 'RDV sans client');

  INSERT INTO majordhome.audit_log (org_id, table_name, record_id, action, changed_fields, new_values, source) VALUES
    (v_core, 'appointments', 'a0d17000-0000-4000-8000-000000000001', 'UPDATE', ARRAY['scheduled_date'], '{"scheduled_date":"2026-10-09"}', 'fixture'),
    (v_core, 'appointments', 'a0d17000-0000-4000-8000-000000000002', 'UPDATE', ARRAY['scheduled_date'], '{"scheduled_date":"2026-10-10"}', 'fixture');
END $$;
