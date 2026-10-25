-- 20261028_2_lead_projet_rattrapage.sql
-- Rattrapage du « Projet » commercial (leads.project_family_key, migration 20261028_1) — décision d'Eric 2026-10-25 :
-- dupliquer l'information existante pour ne rien perdre, la liste commerciale vivant ensuite sa vie (Settings → Devis).
-- Données seulement, aucun objet créé. Ne remplit QUE les leads non supprimés sans projet (rejouable, n'écrase rien),
-- et seulement vers une famille que l'org connaît (défauts DEFAULT_FAMILLES si settings.devis.familles est vide).
-- Ordre = priorité, chaque étape ne remplit que ce qui reste vide :
--   1. équipement concerné du lead (code du type d'équipement, table validée par Eric) ;
--   2. libellé du devis Pennylane rattaché, écrit par l'entreprise : liste EXPLICITE relue le 2026-10-25 (leads Mayer
--      sans équipement dont tous les devis désignent un seul projet) — sans effet ailleurs ;
--   3. champ « service » du formulaire du site (« poele » exclu : bois ou granulés, à valider à la main) ;
--   4. formulaire Tesla (projet powerwall / wall_connector) ; 5. sources « Web/PAC » / « Web/Clim ».
-- Les indices « probables » (réponses libres Meta, notes) ne sont PAS écrits ici : liste à valider par Eric.
-- updated_at est PRÉSERVÉ (trigger_leads_updated_at désactivé le temps du rattrapage) : il alimente le compteur
-- « X jours » des cartes et l'ordre des colonnes du Kanban. Le journal d'audit trace chaque écriture.

CREATE TEMP TABLE _projet_rattrapage (lead_id uuid PRIMARY KEY, project_family_key text NOT NULL) ON COMMIT DROP;

-- 1. Équipement concerné
INSERT INTO _projet_rattrapage
SELECT l.id, m.cle
  FROM majordhome.leads l
  JOIN majordhome.pricing_equipment_types pet ON pet.id = l.equipment_type_id
  JOIN (VALUES
    ('poele_granules_elec', 'poele_granules'), ('poele_hydro', 'poele_granules'),
    ('poele_bois_insert', 'poele_bois'),
    ('pac_air_air', 'climatisation'), ('gainable', 'climatisation'),
    ('pac_air_eau', 'chauffage_pac'), ('chaudiere_bois', 'chauffage_pac'), ('chaudiere_granules', 'chauffage_pac'),
    ('ballon_thermo', 'chauffage_pac'),
    ('TRAV_ELEC', 'electricite'), ('prestation_diverses', 'autre'),
    ('irve', 'borne_recharge'), ('panneau_photovoltaique', 'photovoltaique')
  ) AS m(code, cle) ON m.code = pet.code
 WHERE l.project_family_key IS NULL AND NOT l.is_deleted;

-- 2. Libellé du devis Pennylane rattaché (liste relue)
INSERT INTO _projet_rattrapage
SELECT v.lead_id, v.cle
  FROM (VALUES
    ('bd4c5dc1-8b48-40e3-a352-67e5de2ee6f0'::uuid, 'climatisation'),
    ('f29a99eb-d569-43d5-9820-3712271b3f4f'::uuid, 'borne_recharge'),
    ('fb7ed84b-029b-4962-9386-d89020aa88f2'::uuid, 'poele_granules'),
    ('310e1568-60e7-4159-baa8-5344c8a5b521'::uuid, 'borne_recharge'),
    ('d71b88fa-b675-4849-9615-e3e043163314'::uuid, 'photovoltaique'),
    ('c4031a5c-3aea-4ea4-80ee-0cc145707a90'::uuid, 'poele_bois'),
    ('eb55bee4-d6ca-417f-af46-a3c477a2d8ed'::uuid, 'poele_bois'),
    ('d77ab671-0baa-45a2-a043-f8856e787b16'::uuid, 'chauffage_pac'),
    ('45a2dda2-3d0b-47c6-9eef-0a0b50695749'::uuid, 'poele_bois'),
    ('ec8c1884-d9f4-49b9-8454-a235fc29750a'::uuid, 'chauffage_pac'),
    ('37e56856-c1b8-4a41-90f8-c898c45f6a16'::uuid, 'borne_recharge'),
    ('0885d58c-c208-4c56-9e87-da78d4f4f92f'::uuid, 'borne_recharge'),
    ('72b30115-d0c2-4a60-bc80-9ca601a125bd'::uuid, 'borne_recharge'),
    ('7bd91e36-6b33-4e85-992e-7d9befc348ba'::uuid, 'poele_granules'),
    ('2f98e375-bebb-4c66-a120-b42f733a67ec'::uuid, 'climatisation'),
    ('af672711-9158-4ad3-8192-fb71dd420465'::uuid, 'photovoltaique'),
    ('e22c38da-22e9-4d24-baa7-7dd6eb44d0a3'::uuid, 'poele_granules'),
    ('db65490c-b7d7-4435-9fab-47bbb9985087'::uuid, 'climatisation'),
    ('c124fac8-a9fd-4539-8549-27b238ab4b8a'::uuid, 'chauffage_pac'),
    ('510378ec-173e-40f4-9acd-58c72358f7db'::uuid, 'poele_bois'),
    ('69ce6e7d-fcdc-4e6b-b145-fb3aa5e64955'::uuid, 'borne_recharge'),
    ('c2acc732-35ba-4598-8594-02650f2153f8'::uuid, 'chauffage_pac'),
    ('d2e043bf-bc49-40d3-8cc1-4a04a8134033'::uuid, 'poele_granules'),
    ('660b3782-7240-4cd8-8f79-1d2c4c68a9da'::uuid, 'chauffage_pac'),
    ('212c9c6c-96aa-4784-8d19-7387e7d3d990'::uuid, 'photovoltaique'),
    ('f972e86e-b8ea-4295-b46b-e35d711f7ea4'::uuid, 'climatisation'),
    ('57547c1c-465f-49f2-a874-81a35f1e3448'::uuid, 'chauffage_pac'),
    ('ae66f94d-3e07-442f-b954-68dfdebde3ed'::uuid, 'poele_bois'),
    ('76b05f75-35c1-4802-b4c6-a8f40db5cc86'::uuid, 'chauffage_pac'),
    ('746a572d-a5d8-4203-9607-933464f2f089'::uuid, 'climatisation'),
    ('bfbb3dab-d2cf-4333-95bb-e71a6323d543'::uuid, 'photovoltaique'),
    ('884b4f81-fd11-4aeb-8423-2ec79d01418d'::uuid, 'poele_granules'),
    ('b6610d2c-5a6a-4989-bc04-e685c610a4d9'::uuid, 'poele_granules'),
    ('464007d7-98b5-4065-a85d-68519e2be054'::uuid, 'borne_recharge'),
    ('ed8d85ff-5fe7-402c-9765-5b715c3abddd'::uuid, 'poele_granules'),
    ('ac4ceca2-123a-4762-bcd8-ec83c5ab91fd'::uuid, 'poele_granules'),
    ('0a9a8500-450d-497a-afa5-5e540ce46962'::uuid, 'borne_recharge'),
    ('9f76b126-d8f8-4b81-8d90-acd5c6a712c9'::uuid, 'climatisation'),
    ('c2992fcf-5187-4174-8180-c7f8a3add22b'::uuid, 'climatisation')
  ) AS v(lead_id, cle)
  JOIN majordhome.leads l ON l.id = v.lead_id
 WHERE l.project_family_key IS NULL AND NOT l.is_deleted
ON CONFLICT (lead_id) DO NOTHING;

-- 3. Formulaire du site (service), 4. formulaire Tesla, 5. source
INSERT INTO _projet_rattrapage
SELECT l.id, COALESCE(
         CASE l.external_data->>'service'
           WHEN 'clim' THEN 'climatisation' WHEN 'pac' THEN 'chauffage_pac' WHEN 'chaudiere' THEN 'chauffage_pac'
           WHEN 'elec' THEN 'electricite' WHEN 'pv' THEN 'photovoltaique' WHEN 'autre' THEN 'autre' END,
         CASE l.external_data->>'projet' WHEN 'powerwall' THEN 'batterie' WHEN 'wall_connector' THEN 'borne_recharge' END,
         CASE src.name WHEN 'Web/PAC' THEN 'chauffage_pac' WHEN 'Web/Clim' THEN 'climatisation' END)
  FROM majordhome.leads l
  LEFT JOIN majordhome.sources src ON src.id = l.source_id
 WHERE l.project_family_key IS NULL AND NOT l.is_deleted
   AND jsonb_typeof(COALESCE(l.external_data, '{}'::jsonb)) = 'object'
   AND COALESCE(
         CASE l.external_data->>'service'
           WHEN 'clim' THEN 'climatisation' WHEN 'pac' THEN 'chauffage_pac' WHEN 'chaudiere' THEN 'chauffage_pac'
           WHEN 'elec' THEN 'electricite' WHEN 'pv' THEN 'photovoltaique' WHEN 'autre' THEN 'autre' END,
         CASE l.external_data->>'projet' WHEN 'powerwall' THEN 'batterie' WHEN 'wall_connector' THEN 'borne_recharge' END,
         CASE src.name WHEN 'Web/PAC' THEN 'chauffage_pac' WHEN 'Web/Clim' THEN 'climatisation' END) IS NOT NULL
ON CONFLICT (lead_id) DO NOTHING;

-- Seulement vers une famille que l'org connaît (settings.devis.familles, sinon les défauts du code)
DELETE FROM _projet_rattrapage r
 USING majordhome.leads l
  JOIN core.organizations o ON o.id = l.org_id
 WHERE l.id = r.lead_id
   AND jsonb_typeof(o.settings->'devis'->'familles') = 'array'
   AND jsonb_array_length(o.settings->'devis'->'familles') > 0
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o.settings->'devis'->'familles') f WHERE f->>'key' = r.project_family_key);

ALTER TABLE majordhome.leads DISABLE TRIGGER trigger_leads_updated_at;

UPDATE majordhome.leads l
   SET project_family_key = r.project_family_key
  FROM _projet_rattrapage r
 WHERE l.id = r.lead_id AND l.project_family_key IS NULL;

ALTER TABLE majordhome.leads ENABLE TRIGGER trigger_leads_updated_at;
