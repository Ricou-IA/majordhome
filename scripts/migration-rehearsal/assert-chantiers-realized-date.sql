-- assert-chantiers-realized-date.sql — vérifie 20261001_2 (realized_date figée) sur le cluster de
-- répétition. Autonome : crée son lead, son chantier et ses RDV. Un écart lève une exception.
DO $$
DECLARE
  v_org    uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_mh_org uuid;
  v_lead   uuid := '55555555-5555-5555-5555-555555555555';
  v_ch     uuid := '55555555-5555-5555-5555-000000000001';
  v_date   date;
  v_view   date;
  n int;
BEGIN
  -- Structure
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'chantiers' AND column_name = 'realized_date') THEN
    RAISE EXCEPTION 'chantiers.realized_date absente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_chantiers_freeze_realized_date' AND tgrelid = 'majordhome.chantiers'::regclass) THEN
    RAISE EXCEPTION 'trigger trg_chantiers_freeze_realized_date absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers' AND column_name = 'realized_date') THEN
    RAISE EXCEPTION 'vue majordhome_chantiers sans realized_date';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers_write' AND column_name = 'realized_date') THEN
    RAISE EXCEPTION 'vue majordhome_chantiers_write sans realized_date (SELECT * non recréé)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'majordhome_chantiers_write' AND definition IS NOT NULL)
     OR (SELECT (reloptions::text LIKE '%security_invoker=true%') FROM pg_class WHERE oid = 'public.majordhome_chantiers_write'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'majordhome_chantiers_write sans security_invoker';
  END IF;

  -- Données
  SELECT id INTO v_mh_org FROM majordhome.organizations WHERE core_org_id = v_org;
  IF v_mh_org IS NULL THEN RAISE EXCEPTION 'org majordhome introuvable'; END IF;
  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, is_deleted)
  VALUES (v_lead, v_org, 'TEST', 'REALIZED', false);
  INSERT INTO majordhome.chantiers (id, org_id, lead_id, chantier_status, won_date, equipment_order_status, materials_order_status)
  VALUES (v_ch, v_org, v_lead, 'planification', DATE '2026-09-01', 'recu', 'recu');
  INSERT INTO majordhome.appointments (id, org_id, lead_id, chantier_id, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name)
  VALUES ('55555555-5555-5555-5555-000000000011', v_mh_org, v_lead, v_ch, 'installation', DATE '2026-10-06', TIME '08:00', TIME '17:00', 540, 'scheduled', 'REALIZED'),
         ('55555555-5555-5555-5555-000000000012', v_mh_org, v_lead, v_ch, 'installation', DATE '2026-10-07', TIME '08:00', TIME '17:00', 540, 'scheduled', 'REALIZED'),
         ('55555555-5555-5555-5555-000000000013', v_mh_org, v_lead, v_ch, 'installation', DATE '2026-10-20', TIME '08:00', TIME '17:00', 540, 'cancelled', 'REALIZED');

  -- En planification : rien de figé, la vue montre le dernier jour posé (repli)
  SELECT realized_date INTO v_date FROM majordhome.chantiers WHERE id = v_ch;
  IF v_date IS NOT NULL THEN RAISE EXCEPTION 'realized_date figée trop tôt (%)', v_date; END IF;
  SELECT realized_date INTO v_view FROM public.majordhome_chantiers WHERE id = v_ch;
  IF v_view <> DATE '2026-10-07' THEN RAISE EXCEPTION 'repli vue attendu 2026-10-07 (RDV annulé exclu), trouvé %', v_view; END IF;

  -- Passage en Réceptionné : figeage = dernier jour d'installation actif
  UPDATE majordhome.chantiers SET chantier_status = 'realise' WHERE id = v_ch;
  SELECT realized_date INTO v_date FROM majordhome.chantiers WHERE id = v_ch;
  IF v_date <> DATE '2026-10-07' THEN RAISE EXCEPTION 'figeage attendu 2026-10-07, trouvé %', v_date; END IF;

  -- Un RDV qui bouge ensuite ne change rien (figé)
  UPDATE majordhome.appointments SET scheduled_date = DATE '2026-12-15' WHERE id = '55555555-5555-5555-5555-000000000012';
  UPDATE majordhome.chantiers SET chantier_status = 'facture' WHERE id = v_ch;
  SELECT realized_date INTO v_date FROM majordhome.chantiers WHERE id = v_ch;
  IF v_date <> DATE '2026-10-07' THEN RAISE EXCEPTION 'realized_date réécrite après figeage : %', v_date; END IF;
  SELECT realized_date INTO v_view FROM public.majordhome_chantiers WHERE id = v_ch;
  IF v_view <> DATE '2026-10-07' THEN RAISE EXCEPTION 'la vue doit lire la date figée, trouvé %', v_view; END IF;

  -- Né en Réceptionné sans RDV (devis déjà facturé) : NULL, pas d'erreur
  INSERT INTO majordhome.chantiers (id, org_id, lead_id, chantier_status, won_date)
  VALUES ('55555555-5555-5555-5555-000000000002', v_org, v_lead, 'realise', DATE '2026-09-01');
  SELECT realized_date INTO v_date FROM majordhome.chantiers WHERE id = '55555555-5555-5555-5555-000000000002';
  IF v_date IS NOT NULL THEN RAISE EXCEPTION 'chantier né réceptionné sans RDV : realized_date attendue NULL'; END IF;

  -- Reprise : aucun chantier réceptionné/facturé AVEC RDV d'installation ne reste sans date
  SELECT count(*) INTO n
    FROM majordhome.chantiers c
   WHERE c.chantier_status IN ('realise', 'facture') AND c.realized_date IS NULL
     AND EXISTS (SELECT 1 FROM majordhome.appointments a WHERE a.chantier_id = c.id AND a.appointment_type = 'installation'
                   AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]));
  IF n <> 0 THEN RAISE EXCEPTION 'reprise incomplète : % chantier(s) réceptionné(s) avec RDV sans realized_date', n; END IF;

  IF has_function_privilege('anon', 'majordhome.chantiers_freeze_realized_date()', 'EXECUTE') THEN
    RAISE EXCEPTION 'chantiers_freeze_realized_date exécutable par anon';
  END IF;
  RAISE NOTICE 'assert-chantiers-realized-date : OK';
END $$;
