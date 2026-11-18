-- assert-chantier-pv-points.sql — vérifie 20261118_1 (PV complété : préparation par l'entreprise,
-- points du client, photo des devis, réponse aux réserves, levée des réserves, gabarit par type,
-- dossier Storage `interventions`) et 20261118_2 (signature liée à la version de la déclaration
-- lue, `prepare_at`). Chaîne : 20261117_3, 20261118_1, 20261118_2.
-- Autonome : crée son lead, ses chantiers, un devis validé D-TEST-1 et un devis refusé D-TEST-2.
-- Un écart lève une exception.
DO $$
DECLARE
  v_org      uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre    uuid := '88888888-8888-8888-8888-0000000000bb'; -- org dont l'utilisateur n'est pas membre
  v_lead     uuid := '88888888-8888-8888-8888-888888888888';
  v_c1       uuid := '88888888-8888-8888-8888-000000000001'; -- typé, deux devis, signé avec réserves puis levée
  v_c2       uuid := '88888888-8888-8888-8888-000000000002'; -- sans type, sans devis, signé sans réserves
  v_absent   uuid := '88888888-8888-8888-8888-0000000000ff';
  v_type     uuid;
  v_user     uuid;
  v_today    date := CURRENT_DATE;
  v_jour     date;
  v_sig      text := 'data:image/png;base64,' || repeat('A', 400);
  v_points   jsonb := jsonb_build_array(
               jsonb_build_object('cle', 'e_mise_en_service', 'texte', 'L''installation a été mise en service et essayée.', 'reponse', 'oui'),
               jsonb_build_object('cle', 'e_conforme_devis',  'texte', 'Les travaux réalisés correspondent au devis.',     'reponse', 'sans_objet'));
  v_signer   jsonb := jsonb_build_object(
               'reception_type', 'sans_reserves', 'signataire_nom', 'Paul MARTIN', 'signature_png',
               'data:image/png;base64,' || repeat('A', 400),
               'info_recues', true, 'notices_recues', true, 'entretien_recues', true);
  v_levee    jsonb := jsonb_build_object('signataire_nom', '  Paul MARTIN ', 'signature_png', 'data:image/png;base64,' || repeat('B', 400));
  v_attendu  jsonb := jsonb_build_object(
               'poele_granules_elec', 'poele_granules', 'poele_bois_insert', 'poele_buches', 'poele_hydro', 'generique',
               'pac_air_air', 'pac_air_air', 'gainable', 'pac_air_air', 'pac_air_eau', 'pac_air_eau',
               'ballon_thermo', 'chauffe_eau', 'chauffe_eau_solaire', 'chauffe_eau',
               'chaudiere_bois', 'generique', 'chaudiere_granules', 'generique',
               'irve', 'generique', 'panneau_photovoltaique', 'generique', 'prestation_diverses', 'generique', 'TRAV_ELEC', 'generique');
  v_code     text;
  v_profil   text;
  r          jsonb;
  ligne      record;
  avant      record;
  n          int;
  f          text;
BEGIN
  -- ── 0. Gabarit de départ par type (règle sur le code et le profil de certificat) ──
  FOR v_code, v_profil IN SELECT key, value #>> '{}' FROM jsonb_each(v_attendu) LOOP
    SELECT t.reception_profile INTO f FROM majordhome.pricing_equipment_types t WHERE t.org_id = v_org AND t.code = v_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'type % absent de la photographie', v_code; END IF;
    IF f IS DISTINCT FROM v_profil THEN RAISE EXCEPTION 'type % : gabarit % attendu, % trouvé', v_code, v_profil, f; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM majordhome.pricing_equipment_types WHERE org_id = v_org;
  IF n <> 14 THEN RAISE EXCEPTION '14 types attendus pour l''org, % trouvés (table de vérification à revoir)', n; END IF;
  BEGIN
    UPDATE majordhome.pricing_equipment_types SET reception_profile = 'chaudiere' WHERE org_id = v_org AND code = 'chaudiere_bois';
    RAISE EXCEPTION 'un gabarit hors liste a été accepté';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_pricing_equipment_types'
       ORDER BY ordinal_position DESC LIMIT 1) <> 'reception_profile' THEN
    RAISE EXCEPTION 'majordhome_pricing_equipment_types : reception_profile doit être la dernière colonne';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_pricing_equipment_types' AND column_name = 'equipment_category') THEN
    RAISE EXCEPTION 'majordhome_pricing_equipment_types : equipment_category (encore en prod) a disparu';
  END IF;

  -- ── Données ────────────────────────────────────────────────────────────
  SELECT id INTO v_type FROM majordhome.pricing_equipment_types WHERE org_id = v_org AND code = 'poele_granules_elec';
  SELECT om.user_id INTO v_user FROM core.organization_members om WHERE om.org_id = v_org LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'aucun membre de l''org dans la photographie'; END IF;
  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, email, address, postal_code, city, is_deleted)
  VALUES (v_lead, v_org, 'Paul', 'MARTIN', 'paul@example.test', '3 rue du Pont', '81600', 'Gaillac', false);
  INSERT INTO majordhome.chantiers (id, org_id, lead_id, chantier_status, won_date, label, equipment_type_id, equipment_order_status, materials_order_status)
  VALUES (v_c1, v_org, v_lead, 'planification', v_today - 30, 'Pose d''un poêle', v_type, 'recu', 'recu'),
         (v_c2, v_org, v_lead, 'planification', v_today - 30, NULL, NULL, 'recu', 'recu');
  INSERT INTO majordhome.lead_pennylane_quotes (org_id, lead_id, pennylane_quote_id, quote_label, quote_date, quote_status, chantier_id, quote_amount_ht)
  VALUES (v_org, v_lead, 990000001, 'D-TEST-1', v_today - 10, 'accepted', v_c1, 5000),
         (v_org, v_lead, 990000002, 'D-TEST-2', v_today - 12, 'refused',  v_c1, 6000);

  -- ── 1. Signer sans préparation ──────────────────────────────────────────
  r := public.chantier_pv_signer(v_c1, v_signer);
  IF r->>'code' IS DISTINCT FROM 'pv_non_prepare' THEN RAISE EXCEPTION '1. signature sans préparation : %', r; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.chantier_pv WHERE chantier_id = v_c1) THEN RAISE EXCEPTION '1. un refus a créé une ligne'; END IF;

  -- ── 2. Préparation ─────────────────────────────────────────────────────
  r := public.chantier_pv_preparer(v_absent, 'generique', v_points, v_user);
  IF r->>'code' IS DISTINCT FROM 'chantier_introuvable' THEN RAISE EXCEPTION '2. chantier inconnu : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, 'poele_granules', '[]'::jsonb, v_user);
  IF r->>'code' IS DISTINCT FROM 'declaration_incomplete' THEN RAISE EXCEPTION '2. déclaration vide acceptée : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, 'poele_granules', NULL, v_user);
  IF r->>'code' IS DISTINCT FROM 'declaration_incomplete' THEN RAISE EXCEPTION '2. déclaration nulle acceptée : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, 'poele_granules', '{"cle":"e_mise_en_service"}'::jsonb, v_user);
  IF r->>'code' IS DISTINCT FROM 'declaration_incomplete' THEN RAISE EXCEPTION '2. déclaration non tableau acceptée : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, 'poele_granules', v_points || jsonb_build_array(jsonb_build_object('cle', 'e_conduit', 'texte', 'Conduit', 'reponse', 'peut-etre')), v_user);
  IF r->>'code' IS DISTINCT FROM 'declaration_incomplete' THEN RAISE EXCEPTION '2. réponse « peut-etre » acceptée : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, 'poele_granules', v_points || jsonb_build_array(jsonb_build_object('cle', 'e_conduit', 'texte', '  ', 'reponse', 'oui')), v_user);
  IF r->>'code' IS DISTINCT FROM 'declaration_incomplete' THEN RAISE EXCEPTION '2. point sans texte accepté : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, 'poele_granules', v_points || jsonb_build_array(jsonb_build_object('texte', 'Conduit', 'reponse', 'oui')), v_user);
  IF r->>'code' IS DISTINCT FROM 'declaration_incomplete' THEN RAISE EXCEPTION '2. point sans clé accepté : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, 'inconnu', v_points, v_user);
  IF r->>'code' IS DISTINCT FROM 'gabarit_inconnu' THEN RAISE EXCEPTION '2. gabarit inconnu accepté : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, NULL, v_points, v_user);
  IF r->>'code' IS DISTINCT FROM 'gabarit_inconnu' THEN RAISE EXCEPTION '2. gabarit nul accepté : %', r; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.chantier_pv WHERE chantier_id = v_c1) THEN RAISE EXCEPTION '2. un refus a créé une ligne'; END IF;
  -- Première version (reprise ensuite : le client lit toujours la dernière)
  r := public.chantier_pv_preparer(v_c1, 'generique', v_points, NULL);
  IF (r->>'ok')::boolean IS NOT TRUE OR r->>'prepare_at' IS NULL THEN RAISE EXCEPTION '2. préparation refusée : %', r; END IF;
  r := public.chantier_pv_preparer(v_c1, 'poele_granules',
         v_points || jsonb_build_array(jsonb_build_object('cle', 'e_conduit', 'texte', 'Le conduit de fumée a été contrôlé.', 'reponse', 'non', 'intrus', 1)), v_user);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '2. reprise de la préparation refusée : %', r; END IF;
  SELECT * INTO ligne FROM majordhome.chantier_pv WHERE chantier_id = v_c1;
  IF ligne.org_id <> v_org OR ligne.gabarit <> 'poele_granules' OR ligne.prepare_par IS DISTINCT FROM v_user OR ligne.prepare_at IS NULL
     OR jsonb_array_length(ligne.points_entreprise) <> 3 OR ligne.points_entreprise->2->>'reponse' <> 'non'
     OR ligne.points_entreprise->0->>'cle' <> 'e_mise_en_service' OR ligne.points_entreprise->2 ? 'intrus'
     OR ligne.signed_at IS NOT NULL OR ligne.levee_sent_count <> 0 THEN
    RAISE EXCEPTION '2. préparation mal enregistrée : gabarit %, par %, points %', ligne.gabarit, ligne.prepare_par, ligne.points_entreprise;
  END IF;

  -- ── 2b. La signature est liée à la version lue (20261118_2) ─────────────
  -- La valeur à renvoyer est exactement le texte rendu par le contexte : l'edge la repasse telle quelle.
  r := public.chantier_pv_contexte(v_c1);
  IF r->'pv'->>'prepare_at' IS DISTINCT FROM (SELECT to_jsonb(prepare_at) #>> '{}' FROM majordhome.chantier_pv WHERE chantier_id = v_c1) THEN
    RAISE EXCEPTION '2b. prepare_at du contexte (%) ≠ to_jsonb(prepare_at) de la ligne', r->'pv'->>'prepare_at';
  END IF;
  r := public.chantier_pv_signer(v_c1, v_signer);
  IF r->>'code' IS DISTINCT FROM 'pv_modifie' THEN RAISE EXCEPTION '2b. signature sans prepare_at : %', r; END IF;
  r := public.chantier_pv_signer(v_c1, v_signer || '{"prepare_at":null}');
  IF r->>'code' IS DISTINCT FROM 'pv_modifie' THEN RAISE EXCEPTION '2b. signature avec prepare_at nul : %', r; END IF;
  r := public.chantier_pv_signer(v_c1, v_signer || '{"prepare_at":"2000-01-01T00:00:00+00:00"}');
  IF r->>'code' IS DISTINCT FROM 'pv_modifie' THEN RAISE EXCEPTION '2b. signature avec un autre prepare_at : %', r; END IF;
  r := public.chantier_pv_signer(v_c1, v_signer || '{"prepare_at":"n-importe-quoi"}');
  IF r->>'code' IS DISTINCT FROM 'pv_modifie' THEN RAISE EXCEPTION '2b. signature avec prepare_at mal formé : %', r; END IF;
  IF (SELECT signed_at FROM majordhome.chantier_pv WHERE chantier_id = v_c1) IS NOT NULL THEN RAISE EXCEPTION '2b. un refus pv_modifie a signé'; END IF;
  -- Le bureau prépare à nouveau après la lecture du client. Toute l'assertion tient dans une
  -- transaction (now() constant) : la lecture « ancienne » est vieillie d'une minute pour simuler
  -- le temps écoulé entre les deux préparations.
  UPDATE majordhome.chantier_pv SET prepare_at = prepare_at - interval '1 minute' WHERE chantier_id = v_c1;
  f := public.chantier_pv_contexte(v_c1)->'pv'->>'prepare_at'; -- version lue par le client
  r := public.chantier_pv_preparer(v_c1, 'poele_granules',
         v_points || jsonb_build_array(jsonb_build_object('cle', 'e_conduit', 'texte', 'Le conduit de fumée a été contrôlé.', 'reponse', 'non')), v_user);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '2b. nouvelle préparation refusée : %', r; END IF;
  IF (public.chantier_pv_contexte(v_c1)->'pv'->>'prepare_at') = f THEN RAISE EXCEPTION '2b. la nouvelle préparation n''a pas changé prepare_at'; END IF;
  r := public.chantier_pv_signer(v_c1, v_signer || jsonb_build_object('prepare_at', f));
  IF r->>'code' IS DISTINCT FROM 'pv_modifie' THEN RAISE EXCEPTION '2b. signature contre une déclaration remplacée : %', r; END IF;
  IF (SELECT signed_at FROM majordhome.chantier_pv WHERE chantier_id = v_c1) IS NOT NULL THEN RAISE EXCEPTION '2b. un refus pv_modifie a signé'; END IF;
  -- (la signature avec la valeur relue du contexte est faite au § 4)

  -- ── 3. Contexte : devis validés, gabarit du type ───────────────────────
  r := public.chantier_pv_contexte(v_c1);
  IF jsonb_typeof(r->'devis') <> 'array' OR jsonb_array_length(r->'devis') <> 1
     OR r->'devis'->0->>'libelle' <> 'D-TEST-1' OR r->'devis'->0->>'date' <> (v_today - 10)::text THEN
    RAISE EXCEPTION '3. devis du contexte inattendus : %', r->'devis';
  END IF;
  IF r->>'gabarit_type' IS DISTINCT FROM 'poele_granules' THEN RAISE EXCEPTION '3. gabarit du type inattendu : %', r->'gabarit_type'; END IF;
  IF r->'pv'->>'gabarit' <> 'poele_granules' OR jsonb_array_length(r->'pv'->'points_entreprise') <> 3
     OR NOT (r->'pv' ?& ARRAY['prepare_at', 'prepare_par', 'devis', 'points_client', 'reserves_reponse', 'reserves_echeance',
                              'reserves_repondu_at', 'reserves_repondu_par', 'levee_demandee_at', 'levee_sent_to', 'levee_sent_count',
                              'levee_signed_at', 'levee_signataire_nom', 'levee_signature_png']) THEN
    RAISE EXCEPTION '3. pv du contexte incomplet : %', r->'pv';
  END IF;
  r := public.chantier_pv_contexte(v_c2);
  IF r->'gabarit_type' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION '3. chantier sans type : gabarit_type doit être nul, trouvé %', r->'gabarit_type'; END IF;
  IF r->'devis' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION '3. chantier sans devis : [] attendu, trouvé %', r->'devis'; END IF;
  -- Chantier sans devis : la signature passe
  r := public.chantier_pv_preparer(v_c2, 'generique', v_points, v_user);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '3. préparation sans devis : %', r; END IF;
  r := public.chantier_pv_signer(v_c2, v_signer || jsonb_build_object('prepare_at', public.chantier_pv_contexte(v_c2)->'pv'->>'prepare_at'));
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '3. signature sans devis refusée : %', r; END IF;
  SELECT * INTO ligne FROM majordhome.chantier_pv WHERE chantier_id = v_c2;
  IF ligne.devis IS DISTINCT FROM '[]'::jsonb OR ligne.points_client IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION '3. signature sans devis : devis % / points_client % au lieu de []', ligne.devis, ligne.points_client;
  END IF;

  -- ── 4. Signature avec points du client ─────────────────────────────────
  -- Signée avec la valeur RELUE du contexte après la nouvelle préparation (§ 2b) : acceptée.
  r := public.chantier_pv_signer(v_c1, v_signer || jsonb_build_object(
         'prepare_at', public.chantier_pv_contexte(v_c1)->'pv'->>'prepare_at',
         'reception_type', 'avec_reserves', 'reserves_nature', 'Habillage rayé',
         'points_client', jsonb_build_array(
           jsonb_build_object('cle', 'c_notice', 'texte', 'J''ai reçu la notice d''utilisation en français.', 'confirme', true),
           jsonb_build_object('cle', 'c_entretien', 'texte', 'On m''a expliqué l''entretien à prévoir et sa fréquence.', 'confirme', false))));
  IF (r->>'ok')::boolean IS NOT TRUE OR (r->>'avec_reserves')::boolean IS NOT TRUE THEN RAISE EXCEPTION '4. signature refusée : %', r; END IF;
  SELECT * INTO ligne FROM majordhome.chantier_pv WHERE chantier_id = v_c1;
  IF jsonb_array_length(ligne.points_client) <> 2 OR ligne.points_client->0->>'cle' <> 'c_notice'
     OR (ligne.points_client->0->'confirme') <> 'true'::jsonb OR (ligne.points_client->1->'confirme') <> 'false'::jsonb THEN
    RAISE EXCEPTION '4. points du client mal enregistrés : %', ligne.points_client;
  END IF;
  IF jsonb_array_length(ligne.devis) <> 1 OR ligne.devis->0->>'libelle' <> 'D-TEST-1' THEN RAISE EXCEPTION '4. photo des devis inattendue : %', ligne.devis; END IF;
  IF ligne.info_recues IS NOT NULL OR ligne.notices_recues IS NOT NULL OR ligne.entretien_recues IS NOT NULL THEN
    RAISE EXCEPTION '4. les trois booléens ne doivent plus être écrits';
  END IF;

  -- ── 5. Après signature, la préparation et les photos sont figées ───────
  FOREACH f IN ARRAY ARRAY[
    'UPDATE majordhome.chantier_pv SET points_entreprise = ''[]''::jsonb WHERE chantier_id = $1',
    'UPDATE majordhome.chantier_pv SET points_client = ''[]''::jsonb WHERE chantier_id = $1',
    'UPDATE majordhome.chantier_pv SET devis = ''[]''::jsonb WHERE chantier_id = $1',
    'UPDATE majordhome.chantier_pv SET gabarit = ''generique'' WHERE chantier_id = $1'
  ] LOOP
    BEGIN
      EXECUTE f USING v_c1;
      RAISE EXCEPTION '5. modifié après signature : %', f;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'pv_signe' THEN RAISE; END IF;
    END;
  END LOOP;
  r := public.chantier_pv_preparer(v_c1, 'poele_granules', v_points, v_user);
  IF r->>'code' IS DISTINCT FROM 'deja_signe' THEN RAISE EXCEPTION '5. préparation après signature : %', r; END IF;

  -- ── 6. Réponse aux réserves ────────────────────────────────────────────
  r := public.chantier_pv_repondre_reserves(v_absent, 'x', NULL, v_user);
  IF r->>'code' IS DISTINCT FROM 'chantier_introuvable' THEN RAISE EXCEPTION '6. chantier inconnu : %', r; END IF;
  r := public.chantier_pv_repondre_reserves(v_c2, 'Rien à faire', NULL, v_user);
  IF r->>'code' IS DISTINCT FROM 'pas_de_reserves' THEN RAISE EXCEPTION '6. PV sans réserves : %', r; END IF;
  r := public.chantier_pv_repondre_reserves(v_c1, '   ', NULL, v_user);
  IF r->>'code' IS DISTINCT FROM 'reponse_vide' THEN RAISE EXCEPTION '6. réponse vide acceptée : %', r; END IF;
  r := public.chantier_pv_repondre_reserves(v_c1, repeat('x', 2001), NULL, v_user);
  IF r->>'code' IS DISTINCT FROM 'texte_trop_long' THEN RAISE EXCEPTION '6. texte trop long accepté : %', r; END IF;
  SELECT (signed_at AT TIME ZONE 'Europe/Paris')::date INTO v_jour FROM majordhome.chantier_pv WHERE chantier_id = v_c1;
  r := public.chantier_pv_repondre_reserves(v_c1, 'Habillage remplacé', v_jour - 1, v_user);
  IF r->>'code' IS DISTINCT FROM 'echeance_invalide' THEN RAISE EXCEPTION '6. échéance la veille de la signature acceptée : %', r; END IF;
  IF (SELECT reserves_repondu_at FROM majordhome.chantier_pv WHERE chantier_id = v_c1) IS NOT NULL THEN RAISE EXCEPTION '6. un refus a laissé une trace'; END IF;
  r := public.chantier_pv_repondre_reserves(v_c1, NULL, v_jour, v_user); -- la date seule suffit
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '6. échéance seule refusée : %', r; END IF;
  r := public.chantier_pv_repondre_reserves(v_c1, '  Habillage remplacé le 20 ', v_jour, v_user);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '6. réponse le jour de la signature refusée : %', r; END IF;
  SELECT * INTO ligne FROM majordhome.chantier_pv WHERE chantier_id = v_c1;
  IF ligne.reserves_reponse <> 'Habillage remplacé le 20' OR ligne.reserves_echeance <> v_jour
     OR ligne.reserves_repondu_at IS NULL OR ligne.reserves_repondu_par IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION '6. réponse mal enregistrée : %, %, %', ligne.reserves_reponse, ligne.reserves_echeance, ligne.reserves_repondu_par;
  END IF;

  -- ── 7. Levée des réserves ──────────────────────────────────────────────
  r := public.chantier_pv_signer_levee(v_absent, v_levee);
  IF r->>'code' IS DISTINCT FROM 'chantier_introuvable' THEN RAISE EXCEPTION '7. levée chantier inconnu : %', r; END IF;
  r := public.chantier_pv_signer_levee(v_c2, v_levee);
  IF r->>'code' IS DISTINCT FROM 'pas_de_reserves' THEN RAISE EXCEPTION '7. levée sans réserves : %', r; END IF;
  r := public.chantier_pv_signer_levee(v_c1, v_levee);
  IF r->>'code' IS DISTINCT FROM 'levee_non_demandee' THEN RAISE EXCEPTION '7. levée non demandée acceptée : %', r; END IF;
  r := public.chantier_pv_marquer_levee(v_absent, 'x@example.test', v_user);
  IF r->>'code' IS DISTINCT FROM 'chantier_introuvable' THEN RAISE EXCEPTION '7. demande chantier inconnu : %', r; END IF;
  r := public.chantier_pv_marquer_levee(v_c2, 'x@example.test', v_user);
  IF r->>'code' IS DISTINCT FROM 'pas_de_reserves' THEN RAISE EXCEPTION '7. demande sans réserves : %', r; END IF;
  r := public.chantier_pv_marquer_levee(v_c1, ' paul@example.test ', v_user);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '7. demande de levée refusée : %', r; END IF;
  SELECT * INTO avant FROM majordhome.chantier_pv WHERE chantier_id = v_c1;
  IF avant.levee_demandee_at IS NULL OR avant.levee_sent_to <> 'paul@example.test' OR avant.levee_sent_count <> 1 THEN
    RAISE EXCEPTION '7. demande mal enregistrée : %, %, %', avant.levee_demandee_at, avant.levee_sent_to, avant.levee_sent_count;
  END IF;
  r := public.chantier_pv_marquer_levee(v_c1, '  ', v_user); -- « Copier le lien » : demande notée, aucun envoi
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '7. demande sans envoi refusée : %', r; END IF;
  SELECT * INTO ligne FROM majordhome.chantier_pv WHERE chantier_id = v_c1;
  IF ligne.levee_demandee_at <> avant.levee_demandee_at OR ligne.levee_sent_count <> 1 OR ligne.levee_sent_to <> 'paul@example.test' THEN
    RAISE EXCEPTION '7. une demande sans envoi a compté un envoi ou déplacé la date';
  END IF;
  r := public.chantier_pv_signer_levee(v_c1, v_levee || '{"signataire_nom":"  "}');
  IF r->>'code' IS DISTINCT FROM 'nom_requis' THEN RAISE EXCEPTION '7. levée sans nom acceptée : %', r; END IF;
  r := public.chantier_pv_signer_levee(v_c1, v_levee || '{"signature_png":"data:image/jpeg;base64,AAAA"}');
  IF r->>'code' IS DISTINCT FROM 'signature_requise' THEN RAISE EXCEPTION '7. levée sans signature PNG acceptée : %', r; END IF;
  r := public.chantier_pv_signer_levee(v_c1, v_levee);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '7. levée refusée : %', r; END IF;
  SELECT * INTO ligne FROM majordhome.chantier_pv WHERE chantier_id = v_c1;
  IF ligne.levee_signed_at IS NULL OR ligne.levee_signataire_nom <> 'Paul MARTIN' OR ligne.levee_signature_png NOT LIKE 'data:image/png;base64,B%' THEN
    RAISE EXCEPTION '7. levée mal enregistrée : %, %', ligne.levee_signed_at, ligne.levee_signataire_nom;
  END IF;
  r := public.chantier_pv_signer_levee(v_c1, v_levee);
  IF r->>'code' IS DISTINCT FROM 'levee_deja_signee' THEN RAISE EXCEPTION '7. seconde levée acceptée : %', r; END IF;
  r := public.chantier_pv_repondre_reserves(v_c1, 'Autre réponse', NULL, v_user);
  IF r->>'code' IS DISTINCT FROM 'levee_deja_signee' THEN RAISE EXCEPTION '7. réponse après levée acceptée : %', r; END IF;
  r := public.chantier_pv_marquer_levee(v_c1, 'x@example.test', v_user);
  IF r->>'code' IS DISTINCT FROM 'levee_deja_signee' THEN RAISE EXCEPTION '7. demande après levée acceptée : %', r; END IF;
  FOREACH f IN ARRAY ARRAY[
    'UPDATE majordhome.chantier_pv SET levee_signature_png = ''data:image/png;base64,C'' WHERE chantier_id = $1',
    'UPDATE majordhome.chantier_pv SET reserves_reponse = ''Autre'' WHERE chantier_id = $1',
    'UPDATE majordhome.chantier_pv SET reserves_echeance = reserves_echeance + 1 WHERE chantier_id = $1',
    'UPDATE majordhome.chantier_pv SET levee_signataire_nom = ''Autre'' WHERE chantier_id = $1'
  ] LOOP
    BEGIN
      EXECUTE f USING v_c1;
      RAISE EXCEPTION '7. modifié après la levée : %', f;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'pv_signe' THEN RAISE; END IF;
    END;
  END LOOP;
  -- CHECK : une levée exige une réception avec réserves signée
  BEGIN
    UPDATE majordhome.chantier_pv SET levee_signed_at = now(), levee_signataire_nom = 'X', levee_signature_png = v_sig WHERE chantier_id = v_c2;
    RAISE EXCEPTION '7. levée posée sur un PV sans réserves';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── 8. Vues ────────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_c1 AND pv_reserves_levees_at IS NOT NULL AND pv_levee_path IS NULL AND pv_avec_reserves;
  IF n <> 1 THEN RAISE EXCEPTION '8. majordhome_chantiers : levée non reflétée'; END IF;
  IF (SELECT pv_reserves_levees_at FROM public.majordhome_chantiers WHERE id = v_c2) IS NOT NULL THEN RAISE EXCEPTION '8. levée à tort sur un PV sans réserves'; END IF;
  IF (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM (
        SELECT column_name, ordinal_position FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers' ORDER BY ordinal_position DESC LIMIT 2) x)
     <> 'pv_reserves_levees_at,pv_levee_path' THEN
    RAISE EXCEPTION '8. majordhome_chantiers : pv_reserves_levees_at puis pv_levee_path attendus en fin de liste';
  END IF;
  IF (SELECT is_insertable_into FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers_write') <> 'YES' THEN
    RAISE EXCEPTION '8. majordhome_chantiers_write n''est plus insérable';
  END IF;
  IF (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers_write'
       ORDER BY ordinal_position DESC LIMIT 1) <> 'pv_levee_path' THEN
    RAISE EXCEPTION '8. majordhome_chantiers_write : pv_levee_path attendu en fin de liste';
  END IF;
  IF (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_chantier_pv'
       ORDER BY ordinal_position DESC LIMIT 1) <> 'levee_signature_png' THEN
    RAISE EXCEPTION '8. majordhome_chantier_pv : nouvelles colonnes attendues en fin de liste';
  END IF;
  FOREACH f IN ARRAY ARRAY['public.majordhome_chantier_pv', 'public.majordhome_chantiers', 'public.majordhome_chantiers_write',
                           'public.majordhome_pricing_equipment_types'] LOOP
    IF (SELECT (reloptions::text LIKE '%security_invoker=true%') FROM pg_class WHERE oid = f::regclass) IS NOT TRUE THEN
      RAISE EXCEPTION '8. % sans security_invoker', f;
    END IF;
    IF has_table_privilege('anon', f, 'SELECT') THEN RAISE EXCEPTION '8. % lisible par anon', f; END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.majordhome_chantier_pv', 'UPDATE') THEN
    RAISE EXCEPTION '8. majordhome_chantier_pv : authenticated ne doit pas pouvoir écrire';
  END IF;

  -- ── 9. Droits des six RPC ──────────────────────────────────────────────
  FOREACH f IN ARRAY ARRAY[
    'public.chantier_pv_contexte(uuid, boolean)',
    'public.chantier_pv_signer(uuid, jsonb)',
    'public.chantier_pv_preparer(uuid, text, jsonb, uuid)',
    'public.chantier_pv_repondre_reserves(uuid, text, date, uuid)',
    'public.chantier_pv_marquer_levee(uuid, text, uuid)',
    'public.chantier_pv_signer_levee(uuid, jsonb)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '9. % exécutable par anon', f; END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '9. % exécutable par authenticated', f; END IF;
    IF has_function_privilege('service_role', f, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION '9. % non exécutable par service_role', f; END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '9. % doit être SECURITY DEFINER', f; END IF;
  END LOOP;

  -- ── 10. Dossier Storage `interventions` ────────────────────────────────
  -- Le stub storage.objects du harnais a RLS et foldername ; la migration y pose ses règles.
  -- Filet (gotcha harnais) : si elles manquent, on les recrée pour éprouver le motif.
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'org_members_%_interventions';
  IF n <> 0 THEN RAISE EXCEPTION '10. % ancienne(s) règle(s) org_members_*_interventions restante(s)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'interventions_org_insert') THEN
    EXECUTE $p$CREATE POLICY interventions_org_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'interventions' AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()))$p$;
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('interventions_org_select', 'interventions_org_insert', 'interventions_org_update', 'interventions_org_delete')
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%interventions%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%foldername%';
  IF n <> 4 THEN RAISE EXCEPTION '10. 4 règles interventions_org_* attendues, % trouvée(s)', n; END IF;

  GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated; -- stub du harnais : seules les règles sont éprouvées
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', v_org || '/pv-reception/x.pdf');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', v_autre || '/pv-reception/x.pdf');
    RAISE EXCEPTION '10. objet rangé dans le dossier d''une autre org';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', 'pv-reception/x.pdf');
    RAISE EXCEPTION '10. objet rangé sans dossier d''org';
  EXCEPTION WHEN insufficient_privilege OR invalid_text_representation THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  DELETE FROM storage.objects WHERE bucket_id = 'interventions' AND name = v_org || '/pv-reception/x.pdf';
  REVOKE ALL ON storage.objects FROM authenticated; REVOKE USAGE ON SCHEMA storage FROM authenticated;

  RAISE NOTICE 'assert-chantier-pv-points : OK (gabarits par type, préparation, devis, points du client, figeage, réponse aux réserves, levée, vues, droits, dossier interventions)';
END $$;
