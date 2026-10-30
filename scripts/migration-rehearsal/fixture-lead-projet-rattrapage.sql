-- fixture-lead-projet-rattrapage.sql — jeu de leads de test pour répéter 20261030_2_lead_projet_rattrapage.sql.
-- À passer en --migration ENTRE 20261030_1 et 20261030_2 (le snapshot ne charge pas les données de leads) ;
-- vérifié puis nettoyé par assert-lead-projet-rattrapage.sql. Préfixe « TEST PROJET » sur last_name.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_type  uuid;
BEGIN
  SELECT id INTO v_type FROM majordhome.pricing_equipment_types WHERE org_id = v_mayer AND code = 'poele_bois_insert';
  INSERT INTO majordhome.leads (org_id, last_name, equipment_type_id, updated_at)
  VALUES (v_mayer, 'TEST PROJET 1 type', v_type, '2026-01-01 08:00+00');

  SELECT id INTO v_type FROM majordhome.pricing_equipment_types WHERE org_id = v_mayer AND code = 'pac_air_eau';
  INSERT INTO majordhome.leads (org_id, last_name, equipment_type_id, project_family_key)
  VALUES (v_mayer, 'TEST PROJET 2 deja renseigne', v_type, 'autre');
  INSERT INTO majordhome.leads (org_id, last_name, equipment_type_id, is_deleted)
  VALUES (v_mayer, 'TEST PROJET 3 supprime', v_type, true);

  -- lead de la liste explicite des devis relus (premier élément : climatisation)
  INSERT INTO majordhome.leads (id, org_id, last_name)
  VALUES ('bd4c5dc1-8b48-40e3-a352-67e5de2ee6f0', v_mayer, 'TEST PROJET 4 devis');

  INSERT INTO majordhome.leads (org_id, last_name, external_data) VALUES
    (v_mayer, 'TEST PROJET 5 site poele', '{"service": "poele"}'::jsonb),
    (v_mayer, 'TEST PROJET 6 site clim', '{"service": "clim"}'::jsonb),
    (v_mayer, 'TEST PROJET 7 tesla', '{"projet": "powerwall"}'::jsonb),
    (v_mayer, 'TEST PROJET 9 tableau', '[{"name": "x"}]'::jsonb);
  INSERT INTO majordhome.leads (org_id, last_name) VALUES (v_mayer, 'TEST PROJET 8 rien');
END $$;
