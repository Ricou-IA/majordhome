-- fixture-chantiers.sql — données de répétition pour 20260930_11..13 (jouée via --migration AVANT la migration).
-- Reproduit GOUIN (borne facturée + PAC acceptée + variante refusée, 4 RDV), un lead gagné SANS devis,
-- et RENOU (Perdu, vieux devis facturé, chantier_status NULL → ne doit produire aucun chantier).
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_mh_org uuid;
BEGIN
  SELECT id INTO v_mh_org FROM majordhome.organizations WHERE core_org_id = v_org;
  IF v_mh_org IS NULL THEN RAISE EXCEPTION 'org majordhome introuvable pour %', v_org; END IF;

  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, chantier_status, planned_team_size, planned_days,
                                won_date, equipment_order_status, materials_order_status, is_deleted)
  VALUES ('11111111-1111-1111-1111-111111111111', v_org, 'BATISTE', 'GOUIN', 'planification', 2, 3,
          DATE '2026-09-01', 'recu', 'recu', false),
         ('22222222-2222-2222-2222-222222222222', v_org, 'SANS', 'DEVIS', NULL, NULL, NULL, DATE '2026-09-20', NULL, NULL, false),
         ('33333333-3333-3333-3333-333333333333', v_org, 'FATHIA', 'RENOU', NULL, NULL, NULL, NULL, NULL, NULL, false),
         ('44444444-4444-4444-4444-444444444444', v_org, 'GAGNE', 'SANSQUOTE', 'gagne', NULL, NULL, DATE '2026-09-25', NULL, NULL, false);

  INSERT INTO majordhome.pennylane_quotes (org_id, pennylane_quote_id, quote_number, label, status, quote_date, pdf_invoice_subject)
  VALUES (v_org, 28548694261760, 'D-2026-09430', 'D-2026-09430', 'invoiced', DATE '2026-09-03', 'Installation d''une Borne V2C Monophasé'),
         (v_org, 29572673601536, 'D-2026-09466', 'D-2026-09466', 'accepted', DATE '2026-09-30', 'Installation d''une pompe à chaleur DAIKIN'),
         (v_org, 30343886917632, 'D-2026-09483', 'D-2026-09483', 'denied',   DATE '2026-09-30', 'Variante PAC'),
         (v_org, 40000000000001, 'D-2026-09999', 'D-2026-09999', 'pending',  DATE '2026-10-01', 'Poêle à granulés'),
         (v_org, 50000000000001, 'D-2026-09500', 'D-2026-09500', 'accepted', DATE '2026-09-10', 'Devis éjecté'),
         (v_org, 20000000000001, 'D-2026-07336', 'D-2026-07336', 'invoiced', DATE '2026-07-01', 'Ramonage');

  INSERT INTO majordhome.lead_pennylane_quotes (id, org_id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, assigned_at)
  VALUES ('aaaa0001-0000-0000-0000-000000000001', v_org, '11111111-1111-1111-1111-111111111111', 28548694261760, 1447384297472, 1260.76,  'D-2026-09430', DATE '2026-09-03', 'invoiced', true,  now()),
         ('aaaa0001-0000-0000-0000-000000000002', v_org, '11111111-1111-1111-1111-111111111111', 29572673601536, 1447384297472, 11540,    'D-2026-09466', DATE '2026-09-30', 'accepted', false, now()),
         ('aaaa0001-0000-0000-0000-000000000003', v_org, '11111111-1111-1111-1111-111111111111', 30343886917632, 1447384297472, 10240.34, 'D-2026-09483', DATE '2026-09-30', 'denied',   false, now()),
         ('aaaa0003-0000-0000-0000-000000000001', v_org, '33333333-3333-3333-3333-333333333333', 20000000000001, 99, 400, 'D-2026-07336', DATE '2026-07-01', 'invoiced', true, now());

  -- Devis EN ATTENTE sur GOUIN (non validé → jamais rattaché) ; la tâche 2 réutilise cet id pour tester le trigger.
  INSERT INTO majordhome.lead_pennylane_quotes (id, org_id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, assigned_at)
  VALUES ('aaaa0001-0000-0000-0000-000000000009', v_org, '11111111-1111-1111-1111-111111111111', 40000000000001, 1447384297472, 4500, 'D-2026-09999', DATE '2026-10-01', 'pending', false, now());
  -- Devis validé mais ÉJECTÉ sur GOUIN : le filtre ejected_at IS NULL de la reprise doit l'écarter.
  INSERT INTO majordhome.lead_pennylane_quotes (id, org_id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, assigned_at, ejected_at, ejected_reason)
  VALUES ('aaaa0001-0000-0000-0000-000000000004', v_org, '11111111-1111-1111-1111-111111111111', 50000000000001, 1447384297472, 999, 'D-2026-09500', DATE '2026-09-10', 'accepted', false, now(), now(), 'manual_ui');

  INSERT INTO majordhome.appointments (id, org_id, lead_id, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name)
  VALUES ('bbbb0001-0000-0000-0000-000000000001', v_mh_org, '11111111-1111-1111-1111-111111111111', 'installation', DATE '2026-09-18', TIME '08:00', TIME '13:30', 330, 'completed', 'GOUIN'),
         ('bbbb0001-0000-0000-0000-000000000005', v_mh_org, '11111111-1111-1111-1111-111111111111', 'rdv_technical', DATE '2026-08-20', TIME '09:00', TIME '10:00', 60, 'completed', 'GOUIN'),
         ('bbbb0001-0000-0000-0000-000000000002', v_mh_org, '11111111-1111-1111-1111-111111111111', 'installation', DATE '2026-11-03', TIME '08:00', TIME '17:00', 540, 'scheduled', 'GOUIN'),
         ('bbbb0001-0000-0000-0000-000000000003', v_mh_org, '11111111-1111-1111-1111-111111111111', 'installation', DATE '2026-11-04', TIME '08:00', TIME '17:00', 540, 'scheduled', 'GOUIN'),
         ('bbbb0001-0000-0000-0000-000000000004', v_mh_org, '11111111-1111-1111-1111-111111111111', 'installation', DATE '2026-11-05', TIME '08:00', TIME '17:00', 540, 'scheduled', 'GOUIN');

  INSERT INTO majordhome.chantier_line_receptions (id, org_id, chantier_id, pennylane_quote_id, pennylane_line_id, line_label, line_quantity_total, quantity_received)
  VALUES ('cccc0001-0000-0000-0000-000000000001', v_org, '11111111-1111-1111-1111-111111111111', 29572673601536, 1, 'Unité extérieure', 1, 1);
END $$;
