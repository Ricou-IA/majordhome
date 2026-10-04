-- assert-agent-accueil.sql — vérifie 20261004_6 (accueil par le numéro appelant) sur le
-- cluster de répétition, APRÈS 20261004_1 et _2. Autonome : crée ses fiches et ses accueils
-- (numéros fictifs 06 99 99 06 0x).
DO $$
DECLARE
  v_org  uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_proj uuid := 'a5a5a5a5-0000-4000-8000-000000000001';
  v_cli  uuid := 'a5a5a5a5-0000-4000-8000-000000000011';
  r      jsonb;
  f      text;
BEGIN
  -- Droits effectifs (jamais la lecture du texte de la migration)
  FOREACH f IN ARRAY ARRAY[
    'public.agent_accueil_enregistrer(uuid, text, text, text, text, integer)',
    'public.agent_verifier_client_candidats(uuid, text, text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'droits inattendus sur %', f;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'majordhome.agent_accueils', 'INSERT')
     OR has_table_privilege('anon', 'majordhome.agent_accueils', 'SELECT')
     OR NOT has_table_privilege('service_role', 'majordhome.agent_accueils', 'SELECT') THEN
    RAISE EXCEPTION 'droits de table agent_accueils inattendus';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.agent_accueils'::regclass) THEN
    RAISE EXCEPTION 'RLS non activée sur agent_accueils';
  END IF;

  INSERT INTO core.projects (id, org_id, name, status) VALUES (v_proj, v_org, 'TEST AGENT ACCUEIL', 'active');
  INSERT INTO majordhome.clients (id, org_id, project_id, last_name, first_name, display_name, phone, address, city, is_archived, client_number)
  VALUES (v_cli, v_org, v_proj, 'ACCUEILTEST', 'Jean', 'ACCUEILTEST', '06 99 99 06 01', '7 rue Basse', 'Gaillac', false, 'AGENT-A1');

  -- Numéro dicté : comme avant, prénom en plus, numero_appelant faux
  r := public.agent_verifier_client_candidats(v_org, 'conv_acc', '0699990601');
  IF jsonb_array_length(r->'candidats') <> 1 OR r->'candidats'->0->>'first_name' <> 'Jean' THEN
    RAISE EXCEPTION 'numéro dicté : candidats inattendus %', r;
  END IF;
  IF (r->>'numero_appelant')::boolean THEN RAISE EXCEPTION 'numéro dicté pris pour le numéro appelant'; END IF;

  -- Sans numéro et sans accueil : aucun candidat (pas d'erreur)
  r := public.agent_verifier_client_candidats(v_org, 'conv_acc', NULL);
  IF jsonb_array_length(r->'candidats') <> 0 OR (r->>'numero_appelant')::boolean THEN
    RAISE EXCEPTION 'sans accueil : %', r;
  END IF;

  -- Accueil relevé : sans numéro, le numéro appelant est relu ; un rejeu ne remplace rien
  PERFORM public.agent_accueil_enregistrer(v_org, 'conv_acc', 'agent_x', '0699990601', 'nom', 1);
  PERFORM public.agent_accueil_enregistrer(v_org, 'conv_acc', 'agent_x', '0699990699', 'neutre', 0);
  IF (SELECT count(*) FROM majordhome.agent_accueils WHERE conversation_id = 'conv_acc') <> 1
     OR (SELECT telephone_appelant FROM majordhome.agent_accueils WHERE conversation_id = 'conv_acc') <> '0699990601' THEN
    RAISE EXCEPTION 'rejeu de l''accueil : la première ligne doit rester';
  END IF;
  r := public.agent_verifier_client_candidats(v_org, 'conv_acc', NULL);
  IF jsonb_array_length(r->'candidats') <> 1 OR NOT (r->>'numero_appelant')::boolean THEN
    RAISE EXCEPTION 'numéro appelant non relu : %', r;
  END IF;
  -- Le même numéro DICTÉ dans la conversation accueillie reste le numéro appelant
  r := public.agent_verifier_client_candidats(v_org, 'conv_acc', '0699990601');
  IF NOT (r->>'numero_appelant')::boolean THEN RAISE EXCEPTION 'numéro dicté identique non reconnu'; END IF;
  -- Un AUTRE numéro dicté n'hérite pas de l'authentification
  r := public.agent_verifier_client_candidats(v_org, 'conv_acc', '0699990602');
  IF (r->>'numero_appelant')::boolean THEN RAISE EXCEPTION 'autre numéro dicté pris pour le numéro appelant'; END IF;
  -- Une autre conversation ne voit pas l'accueil de la première
  r := public.agent_verifier_client_candidats(v_org, 'conv_autre', NULL);
  IF jsonb_array_length(r->'candidats') <> 0 THEN RAISE EXCEPTION 'accueil d''une autre conversation relu'; END IF;
  -- Une autre org non plus
  r := public.agent_verifier_client_candidats('00000000-0000-0000-0000-000000000000', 'conv_acc', NULL);
  IF jsonb_array_length(r->'candidats') <> 0 THEN RAISE EXCEPTION 'accueil relu depuis une autre org'; END IF;

  -- Arguments invalides
  BEGIN
    PERFORM public.agent_verifier_client_candidats(v_org, 'conv_acc', '12');
    RAISE EXCEPTION 'numéro invalide accepté';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.agent_accueil_enregistrer(v_org, 'conv_x', 'agent_x', '12', 'nom', 1);
    RAISE EXCEPTION 'numéro appelant invalide accepté';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'assert-agent-accueil : OK';
END $$;
