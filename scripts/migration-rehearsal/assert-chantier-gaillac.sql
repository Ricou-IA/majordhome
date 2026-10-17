-- assert-chantier-gaillac.sql — vérifie 20261017_1_chantier_gaillac.sql sur le cluster de répétition.
-- Couvre : import (98 / 21, techniciens posés), structure (vues security_invoker, ACL effectives),
-- RLS (anonyme, technicien, admin), trigger (champs figés pour un non-admin, fait_le / fait_par,
-- hors périmètre non cochable), planning en écriture admin seul.
CREATE OR REPLACE FUNCTION pg_temp.expect_err(p_label text, p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION '% : aucune erreur levée', p_label;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_code THEN
    RAISE EXCEPTION '% : SQLSTATE % attendu, % reçu (%)', p_label, p_code, SQLSTATE, SQLERRM;
  END IF;
END;
$f$;

DO $$
DECLARE
  v_antoine uuid := '8b2891e0-2894-4580-a4ec-89004a72e755';
  v_admin   uuid;
  r         record;
  n         int;
BEGIN
  -- 1. Import --------------------------------------------------------------------------------
  SELECT count(*) INTO n FROM majordhome.chantier_gaillac_taches;
  IF n <> 98 THEN RAISE EXCEPTION 'tâches : 98 attendues, % trouvées', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantier_gaillac_planning;
  IF n <> 21 THEN RAISE EXCEPTION 'planning : 21 attendus, % trouvés', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantier_gaillac_taches
   WHERE type_ligne <> 'hors_perimetre' AND technicien_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% tâches sans technicien', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantier_gaillac_taches t
   WHERE t.technicien_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM majordhome.team_members tm WHERE tm.id = t.technicien_id);
  IF n <> 0 THEN RAISE EXCEPTION '% tâches sur un technicien inconnu', n; END IF;
  -- Contrôle de la maquette : MER21 = 330 min de tâches + 5 sites × 20 = 7 h 10
  SELECT sum(duree_min) + 20 * count(DISTINCT site) INTO n
    FROM majordhome.chantier_gaillac_taches WHERE planning_code = 'MER21';
  IF n <> 430 THEN RAISE EXCEPTION 'MER21 : 430 min attendues, % calculées', n; END IF;

  -- 2. Structure et ACL effectives -------------------------------------------------------------
  SELECT count(*) INTO n FROM pg_class
   WHERE oid IN ('public.majordhome_chantier_gaillac_taches'::regclass, 'public.majordhome_chantier_gaillac_planning'::regclass)
     AND 'security_invoker=true' = ANY (reloptions);
  IF n <> 2 THEN RAISE EXCEPTION 'vues : security_invoker manquant'; END IF;
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'majordhome' AND p.proname IN ('cg_is_member', 'cg_is_admin', 'cg_taches_before_update') LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute %', r.proname; END IF;
  END LOOP;
  IF has_table_privilege('anon', 'majordhome.chantier_gaillac_taches', 'SELECT')
     OR has_table_privilege('anon', 'public.majordhome_chantier_gaillac_taches', 'SELECT')
     OR has_table_privilege('anon', 'public.majordhome_chantier_gaillac_planning', 'SELECT') THEN
    RAISE EXCEPTION 'anon lit le chantier';
  END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.chantier_gaillac_taches', 'SELECT')
     OR NOT has_table_privilege('service_role', 'majordhome.chantier_gaillac_planning', 'SELECT') THEN
    RAISE EXCEPTION 'service_role ne lit pas les tables';
  END IF;

  SELECT om.user_id INTO v_admin FROM core.organization_members om
   WHERE om.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' AND om.role = 'org_admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture admin absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.organization_members WHERE user_id = v_antoine) THEN
    RAISE EXCEPTION 'fixture Antoine absente';
  END IF;

  -- 3. Membre authentifié sans adhésion : ne voit rien ----------------------------------------
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  SELECT count(*) INTO n FROM public.majordhome_chantier_gaillac_taches;
  IF n <> 0 THEN RAISE EXCEPTION 'non-membre : % lignes visibles', n; END IF;

  -- 4. Technicien : lit tout, coche, commente, rien d'autre --------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_antoine::text, true);
  SELECT count(*) INTO n FROM public.majordhome_chantier_gaillac_taches;
  IF n <> 98 THEN RAISE EXCEPTION 'technicien : 98 lignes attendues, % visibles', n; END IF;

  UPDATE public.majordhome_chantier_gaillac_taches
     SET fait = true, commentaire_terrain = 'Wago posé' WHERE numero = '41';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'technicien : coche non écrite'; END IF;
  SELECT * INTO r FROM public.majordhome_chantier_gaillac_taches WHERE numero = '41';
  IF r.fait IS NOT TRUE OR r.fait_le IS NULL OR r.fait_par IS DISTINCT FROM v_antoine OR r.commentaire_terrain <> 'Wago posé' THEN
    RAISE EXCEPTION 'technicien : suivi incorrect %', r;
  END IF;

  PERFORM pg_temp.expect_err('technicien change l''action',
    $q$UPDATE public.majordhome_chantier_gaillac_taches SET action = 'x' WHERE numero = '42'$q$, '42501');
  -- fait_le / fait_par ne s'écrivent qu'au changement de statut : une écriture directe est ignorée
  UPDATE public.majordhome_chantier_gaillac_taches SET fait_par = gen_random_uuid(), fait_le = now() - interval '9 days'
   WHERE numero = '41';
  SELECT * INTO r FROM public.majordhome_chantier_gaillac_taches WHERE numero = '41';
  IF r.fait_par IS DISTINCT FROM v_antoine OR r.fait_le < now() - interval '1 day' THEN
    RAISE EXCEPTION 'fait_le / fait_par falsifiables %', r;
  END IF;
  PERFORM pg_temp.expect_err('hors périmètre coché',
    $q$UPDATE public.majordhome_chantier_gaillac_taches SET fait = true WHERE numero = '68'$q$, '22023');
  PERFORM pg_temp.expect_err('technicien insère',
    $q$INSERT INTO public.majordhome_chantier_gaillac_taches (numero, ordre, site, action) VALUES ('Z1', 99, 's', 'a')$q$, '42501');

  UPDATE public.majordhome_chantier_gaillac_planning SET date_prevue = '2026-10-27' WHERE code = 'A1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'technicien : planning modifiable'; END IF;

  UPDATE public.majordhome_chantier_gaillac_taches SET fait = false WHERE numero = '41';
  SELECT * INTO r FROM public.majordhome_chantier_gaillac_taches WHERE numero = '41';
  IF r.fait OR r.fait_le IS NOT NULL OR r.fait_par IS NOT NULL THEN
    RAISE EXCEPTION 'décocher : suivi non remis à zéro %', r;
  END IF;

  -- 5. Admin : planifie et corrige ------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  UPDATE public.majordhome_chantier_gaillac_planning SET date_prevue = '2026-10-27' WHERE code = 'L1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'admin : date prévue non écrite'; END IF;
  UPDATE public.majordhome_chantier_gaillac_taches SET observations = 'test' WHERE numero = '42';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'admin : observation non écrite'; END IF;

  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'chantier gaillac : OK';
END $$;
