-- ============================================================================
-- 20261012_2 — La photo de la plaque signalétique rejoint l'équipement (fiche client).
-- Suite de 20261012_1 : la photo prise sur le certificat (photo_plaque_path) est
-- recopiée par trigger sur l'équipement lié (equipments.nameplate_photo_path), pour
-- que la fiche client la montre et qu'elle serve à tous les devis futurs de
-- l'appareil. La fiche équipement peut aussi la prendre / remplacer directement
-- (même bucket `certificats`, chemin ${org_id}/${client_id}/equipements/${equipment_id}-plaque.jpg).
-- Une photo retirée du certificat ne retire celle de l'équipement que si c'est la même.
--
-- 1. equipments.nameplate_photo_path + vue miroir majordhome_equipments (colonne EN FIN)
-- 2. trigger certificats → equipments (SECURITY DEFINER : la RLS d'equipments est sous
--    role_can(equipments, edit) ; un technicien sans ce droit verrait sinon la recopie
--    refusée en silence — UPDATE 0 ligne)
-- 3. reprise des certificats déjà photographiés
-- Répétée sur scripts/migration-rehearsal/ (assert-photo-plaque-equipement.sql).
-- ============================================================================

-- ── 1. Colonne + vue miroir ────────────────────────────────────────────────
ALTER TABLE majordhome.equipments
  ADD COLUMN IF NOT EXISTS nameplate_photo_path text;
COMMENT ON COLUMN majordhome.equipments.nameplate_photo_path IS
  'Photo de la plaque signalétique (bucket certificats, préfixe org_id). Recopiée depuis le dernier certificat photographié (trigger certificats_sync_nameplate_photo) ou prise depuis la fiche équipement.';

CREATE OR REPLACE VIEW public.majordhome_equipments WITH (security_invoker = true) AS
 SELECT id, project_id, category, brand, model, serial_number, install_date, warranty_end_date, maintenance_frequency_months, last_maintenance_date, next_maintenance_due, contract_type, contract_tarif, contract_start_date, contract_status, invoice_file_id, manual_file_id, status, notes, metadata, created_by, created_at, updated_at, installation_year, equipment_type_id, installation_type, supplier_product_id, unit_count, category_id,
    nameplate_photo_path
   FROM majordhome.equipments;

-- ── 2. Trigger certificat → équipement ─────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.certificat_sync_nameplate_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  IF NEW.equipment_id IS NOT NULL AND NEW.photo_plaque_path IS NOT NULL THEN
    UPDATE majordhome.equipments
       SET nameplate_photo_path = NEW.photo_plaque_path
     WHERE id = NEW.equipment_id
       AND nameplate_photo_path IS DISTINCT FROM NEW.photo_plaque_path;
  ELSIF TG_OP = 'UPDATE' AND OLD.photo_plaque_path IS NOT NULL AND NEW.photo_plaque_path IS NULL
        AND OLD.equipment_id IS NOT NULL THEN
    -- Photo retirée du certificat : on ne retire que la MÊME photo de l'équipement
    UPDATE majordhome.equipments
       SET nameplate_photo_path = NULL
     WHERE id = OLD.equipment_id
       AND nameplate_photo_path = OLD.photo_plaque_path;
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION majordhome.certificat_sync_nameplate_photo() IS
  'La photo de plaque du certificat suit l''équipement lié (20261012_2). Trigger AFTER sur certificats, jamais appelée directement.';
-- PUBLIC obligatoire (EXECUTE accordé par défaut) ; un trigger n'a pas besoin de l'EXECUTE de l'appelant.
REVOKE EXECUTE ON FUNCTION majordhome.certificat_sync_nameplate_photo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS certificats_sync_nameplate_photo ON majordhome.certificats;
CREATE TRIGGER certificats_sync_nameplate_photo
  AFTER INSERT OR UPDATE OF photo_plaque_path, equipment_id ON majordhome.certificats
  FOR EACH ROW EXECUTE FUNCTION majordhome.certificat_sync_nameplate_photo();

-- ── 3. Reprise ─────────────────────────────────────────────────────────────
UPDATE majordhome.equipments e
   SET nameplate_photo_path = c.photo_plaque_path
  FROM majordhome.certificats c
 WHERE c.equipment_id = e.id
   AND c.photo_plaque_path IS NOT NULL
   AND e.nameplate_photo_path IS NULL;
