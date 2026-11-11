-- 20261112_7_referentiel_appareils_file.sql — file de contrôle : seulement les fiches rattachées à un équipement
-- Décision d'Eric (2026-11-11) : « il faut faire le check admin après la validation de l'équipement, sinon je vais
-- me retrouver avec plein de validations à faire sur des équipements pas validés ». Une fiche web validée sur place
-- mais dont le formulaire a été abandonné reste dans le référentiel (« à contrôler », proposée aux recherches
-- suivantes) ; elle n'entre dans la file qu'une fois un équipement enregistré dessus.
-- Répétée sur scripts/migration-rehearsal/ (assert-referentiel-appareils-file.sql).

CREATE OR REPLACE VIEW public.majordhome_equipment_models_a_controler WITH (security_invoker = true) AS
  SELECT em.id, em.org_id, em.brand, em.reference, em.name, em.model_name, em.category, em.lifecycle, em.photo_path,
         em.origin, em.review_status, em.catalog_item_id, em.equipment_type_id, em.specs, em.source_urls,
         em.created_by, em.created_at,
         (SELECT p.full_name FROM core.profiles p WHERE p.id = em.created_by) AS created_by_name,
         (SELECT count(*) FROM majordhome.equipments e WHERE e.equipment_model_id = em.id) AS nb_equipements,
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('client_id', x.id, 'client_number', x.client_number, 'display_name', x.display_name)), '[]'::jsonb)
            FROM (SELECT DISTINCT c.id, c.client_number, c.display_name
                  FROM majordhome.equipments e JOIN majordhome.clients c ON c.project_id = e.project_id
                  WHERE e.equipment_model_id = em.id ORDER BY c.client_number LIMIT 10) x) AS clients
  FROM majordhome.equipment_models em
  WHERE em.review_status = 'a_controler' AND em.merged_into IS NULL
    AND EXISTS (SELECT 1 FROM majordhome.equipments e WHERE e.equipment_model_id = em.id);
REVOKE ALL ON public.majordhome_equipment_models_a_controler FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_equipment_models_a_controler TO authenticated, service_role;
