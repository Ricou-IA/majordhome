-- assert-chantiers-next-rdv.sql — vérifie 20261115_4 (next_rdv_date = prochaine pose à venir) sur le
-- cluster de répétition. Autonome : crée son lead, ses chantiers et leurs RDV, datés par rapport à
-- CURRENT_DATE (ne vieillit pas). Un écart lève une exception.
DO $$
DECLARE
  v_org    uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_mh_org uuid;
  v_lead   uuid := '66666666-6666-6666-6666-666666666666';
  v_mixte  uuid := '66666666-6666-6666-6666-000000000001'; -- jours passés + poses à venir (cas DJAFOUR)
  v_passe  uuid := '66666666-6666-6666-6666-000000000002'; -- jours passés seulement
  v_jour   uuid := '66666666-6666-6666-6666-000000000003'; -- pose aujourd'hui
  v_vide   uuid := '66666666-6666-6666-6666-000000000004'; -- aucun RDV
  v_today  date := CURRENT_DATE;
  r record;
  n int;
BEGIN
  -- Structure : option, ACL, colonnes inchangées
  IF (SELECT (reloptions::text LIKE '%security_invoker=true%') FROM pg_class WHERE oid = 'public.majordhome_chantiers'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'majordhome_chantiers sans security_invoker';
  END IF;
  IF has_table_privilege('anon', 'public.majordhome_chantiers', 'SELECT') THEN
    RAISE EXCEPTION 'majordhome_chantiers lisible par anon';
  END IF;
  IF has_table_privilege('authenticated', 'public.majordhome_chantiers', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION 'majordhome_chantiers illisible par authenticated';
  END IF;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers';
  IF n <> 41 THEN RAISE EXCEPTION 'majordhome_chantiers : 41 colonnes attendues, % trouvées', n; END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers' AND column_name = 'next_rdv_date') <> 'date' THEN
    RAISE EXCEPTION 'next_rdv_date n''est plus une date';
  END IF;

  -- Données
  SELECT id INTO v_mh_org FROM majordhome.organizations WHERE core_org_id = v_org;
  IF v_mh_org IS NULL THEN RAISE EXCEPTION 'org majordhome introuvable'; END IF;
  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, is_deleted)
  VALUES (v_lead, v_org, 'TEST', 'NEXTRDV', false);
  INSERT INTO majordhome.chantiers (id, org_id, lead_id, chantier_status, won_date, equipment_order_status, materials_order_status)
  VALUES (v_mixte, v_org, v_lead, 'planification', v_today - 200, 'recu', 'recu'),
         (v_passe, v_org, v_lead, 'planification', v_today - 200, 'recu', 'recu'),
         (v_jour,  v_org, v_lead, 'planification', v_today - 200, 'recu', 'recu'),
         (v_vide,  v_org, v_lead, 'commande_recue', v_today - 200, 'recu', 'recu');
  INSERT INTO majordhome.appointments (id, org_id, lead_id, chantier_id, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name)
  VALUES
    -- mixte : deux jours passés restés « planifié », un jour annulé plus proche, deux poses à venir
    ('66666666-6666-6666-6666-000000000011', v_mh_org, v_lead, v_mixte, 'installation', v_today - 53, TIME '08:00', TIME '17:00', 540, 'scheduled', 'NEXTRDV'),
    ('66666666-6666-6666-6666-000000000012', v_mh_org, v_lead, v_mixte, 'installation', v_today - 53, TIME '08:00', TIME '17:00', 540, 'scheduled', 'NEXTRDV'),
    ('66666666-6666-6666-6666-000000000013', v_mh_org, v_lead, v_mixte, 'installation', v_today + 1,  TIME '08:00', TIME '17:00', 540, 'cancelled', 'NEXTRDV'),
    ('66666666-6666-6666-6666-000000000014', v_mh_org, v_lead, v_mixte, 'installation', v_today + 18, TIME '08:00', TIME '17:00', 540, 'scheduled', 'NEXTRDV'),
    ('66666666-6666-6666-6666-000000000015', v_mh_org, v_lead, v_mixte, 'installation', v_today + 16, TIME '08:00', TIME '17:00', 540, 'scheduled', 'NEXTRDV'),
    -- passé seulement
    ('66666666-6666-6666-6666-000000000021', v_mh_org, v_lead, v_passe, 'installation', v_today - 30, TIME '08:00', TIME '17:00', 540, 'scheduled', 'NEXTRDV'),
    ('66666666-6666-6666-6666-000000000022', v_mh_org, v_lead, v_passe, 'installation', v_today - 20, TIME '08:00', TIME '17:00', 540, 'scheduled', 'NEXTRDV'),
    -- pose du jour, précédée d'un jour passé
    ('66666666-6666-6666-6666-000000000031', v_mh_org, v_lead, v_jour,  'installation', v_today - 1,  TIME '08:00', TIME '17:00', 540, 'scheduled', 'NEXTRDV'),
    ('66666666-6666-6666-6666-000000000032', v_mh_org, v_lead, v_jour,  'installation', v_today,      TIME '08:00', TIME '17:00', 540, 'scheduled', 'NEXTRDV');

  -- Cas DJAFOUR : la carte porte la plus proche des poses À VENIR, pas le jour passé
  SELECT next_rdv_date, has_active_rdv, realized_date INTO r FROM public.majordhome_chantiers WHERE id = v_mixte;
  IF r.next_rdv_date IS DISTINCT FROM v_today + 16 THEN
    RAISE EXCEPTION 'jours passés + poses à venir : next_rdv_date attendu % (prochaine pose), trouvé %', v_today + 16, r.next_rdv_date;
  END IF;
  IF r.has_active_rdv IS NOT TRUE THEN RAISE EXCEPTION 'mixte : has_active_rdv doit rester vrai'; END IF;
  IF r.realized_date IS DISTINCT FROM v_today + 18 THEN RAISE EXCEPTION 'mixte : realized_date (repli = dernier jour) attendu %, trouvé %', v_today + 18, r.realized_date; END IF;

  -- Jours passés seulement : comportement inchangé (plus ancien jour actif)
  SELECT next_rdv_date, has_active_rdv INTO r FROM public.majordhome_chantiers WHERE id = v_passe;
  IF r.next_rdv_date IS DISTINCT FROM v_today - 30 OR r.has_active_rdv IS NOT TRUE THEN
    RAISE EXCEPTION 'jours passés seulement : attendu % et has_active_rdv, trouvé % / %', v_today - 30, r.next_rdv_date, r.has_active_rdv;
  END IF;

  -- Une pose du jour même est « à venir »
  SELECT next_rdv_date INTO r FROM public.majordhome_chantiers WHERE id = v_jour;
  IF r.next_rdv_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'pose du jour : attendu %, trouvé %', v_today, r.next_rdv_date;
  END IF;

  -- Aucun RDV : rien, et has_active_rdv faux (jamais NULL)
  SELECT next_rdv_date, has_active_rdv INTO r FROM public.majordhome_chantiers WHERE id = v_vide;
  IF r.next_rdv_date IS NOT NULL OR r.has_active_rdv IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'sans RDV : attendu NULL / false, trouvé % / %', r.next_rdv_date, r.has_active_rdv;
  END IF;

  RAISE NOTICE 'assert-chantiers-next-rdv : OK (prochaine pose à venir, repli sur le plus ancien jour actif)';
END $$;
