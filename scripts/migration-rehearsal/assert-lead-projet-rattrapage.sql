-- assert-lead-projet-rattrapage.sql — vérifie 20261030_2_lead_projet_rattrapage.sql sur les leads de
-- fixture-lead-projet-rattrapage.sql (passée en --migration entre 20261030_1 et 20261030_2). Fixture nettoyée.
DO $$
DECLARE
  v_attendu record;
  v_key text;
  v_upd timestamptz;
  v_n int;
BEGIN
  FOR v_attendu IN SELECT * FROM (VALUES
    ('TEST PROJET 1 type', 'poele_bois'),              -- équipement concerné
    ('TEST PROJET 2 deja renseigne', 'autre'),         -- projet déjà saisi : jamais écrasé
    ('TEST PROJET 3 supprime', NULL),                  -- lead supprimé : ignoré
    ('TEST PROJET 4 devis', 'climatisation'),          -- liste explicite des devis relus
    ('TEST PROJET 5 site poele', NULL),                -- « poêle » sans précision : à valider à la main
    ('TEST PROJET 6 site clim', 'climatisation'),      -- formulaire du site
    ('TEST PROJET 7 tesla', 'batterie'),               -- formulaire Tesla
    ('TEST PROJET 8 rien', NULL),                      -- aucun indice
    ('TEST PROJET 9 tableau', NULL)                    -- external_data non objet : sans erreur
  ) AS t(nom, cle) LOOP
    SELECT project_family_key INTO v_key FROM majordhome.leads WHERE last_name = v_attendu.nom;
    IF NOT FOUND THEN RAISE EXCEPTION 'fixture absente : %', v_attendu.nom; END IF;
    IF v_key IS DISTINCT FROM v_attendu.cle THEN
      RAISE EXCEPTION '% : projet attendu %, trouvé %', v_attendu.nom, coalesce(v_attendu.cle, 'NULL'), coalesce(v_key, 'NULL');
    END IF;
  END LOOP;

  -- updated_at préservé (compteur « X jours » des cartes, ordre du Kanban)
  SELECT updated_at INTO v_upd FROM majordhome.leads WHERE last_name = 'TEST PROJET 1 type';
  IF v_upd <> '2026-01-01 08:00+00'::timestamptz THEN RAISE EXCEPTION 'updated_at modifié par le rattrapage : %', v_upd; END IF;

  -- le trigger updated_at est bien réactivé
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'majordhome.leads'::regclass AND tgname = 'trigger_leads_updated_at' AND tgenabled = 'O';
  IF v_n <> 1 THEN RAISE EXCEPTION 'trigger_leads_updated_at non réactivé'; END IF;

  -- chaque écriture du rattrapage est tracée par le journal d'audit
  SELECT count(*) INTO v_n FROM majordhome.audit_log a JOIN majordhome.leads l ON l.id = a.record_id
   WHERE l.last_name LIKE 'TEST PROJET %' AND a.action = 'UPDATE' AND a.changed_fields = ARRAY['project_family_key'];
  IF v_n <> 4 THEN RAISE EXCEPTION 'lignes d''audit du rattrapage attendues 4, trouvé %', v_n; END IF;

  DELETE FROM majordhome.leads WHERE last_name LIKE 'TEST PROJET %';
  RAISE NOTICE 'assert-lead-projet-rattrapage : OK';
END $$;
