-- 20261114_1_equipment_documents_portee.sql
-- Documents d'un équipement en trois tiroirs : MARQUE · MODÈLE · CET APPAREIL. Demande d'Eric (2026-11-14, recette du
-- mode atelier) : un document déposé sur une carte équipement n'est plus forcément partagé par tous les appareils de
-- même marque + modèle ; au dépôt on choisit à qui il s'applique — toute la marque (documentation commune, cartes
-- électroniques), le modèle (comportement d'avant), ou cet appareil seulement (« quelque chose de particulier » :
-- photo de l'installation, façon de le faire fonctionner). Anti-objectif : un document propre à un client qui
-- s'affiche sur tout le parc par mégarde. Spec : docs/superpowers/specs/2026-11-14-documents-equipement-trois-tiroirs-design.md
--   1. equipment_documents.scope (marque | modele | appareil, défaut `modele` : un ancien écran en cache qui n'envoie
--      pas la portée garde le comportement d'avant) et equipment_id (portée `appareil` seulement, ON DELETE CASCADE).
--      brand / model / brand_key / model_key deviennent facultatifs : `marque` n'a pas de modèle, `appareil` peut
--      n'avoir ni l'un ni l'autre. Un document RELEVÉ (equipment_model_id non nul) est toujours `modele`.
--   2. Chemin Storage : `appareil` ⇒ `${org}/equipments/${equipment_id}/…` ; sinon `${org}/equipment-models/…`
--      (inchangé). Aucune policy Storage nouvelle (bucket product-documents déjà ouvert aux membres de l'org).
--   3. Trigger equipment_documents_set_keys : clés dérivées, puis exigences par portée ; un document `appareil` ne
--      pointe qu'un équipement de sa propre org (lu avec les droits de l'appelant : équipement invisible ⇒ refus) ;
--      portée et équipement IMMUABLES après dépôt (sinon un document « cet appareil » pourrait passer à tout le parc).
--   4. Retrait : `appareil` ⇒ role_can(org, 'clients', 'edit') (comme modifier la fiche) ; `marque` / `modele` ⇒
--      role_can(org, 'clients', 'delete') (inchangé : ils touchent tout le parc). Dépôt : clients.edit (inchangé).
--   5. Vues recréées, nouvelles colonnes EN FIN de liste : miroir + scope, equipment_id ; vue par équipement + scope,
--      quatre branches (modèle manuel, relevé, marque, appareil).
-- Codes d'erreur : equipment_document_model_required (existant), equipment_document_brand_required,
-- equipment_document_equipment_required, equipment_document_scope_immutable (tous ERRCODE 22023).
-- Répétée sur scripts/migration-rehearsal/ (assert-equipment-documents.sql + assert-equipment-documents-portee.sql ;
-- chaîne : 20261028_5 → 20261111_1 … _6 → 20261112_4 … _8 → 20261114_1 ; equipment_documents n'est pas photographiée).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Colonnes et contraintes
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.equipment_documents
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'modele',
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES majordhome.equipments(id) ON DELETE CASCADE;
ALTER TABLE majordhome.equipment_documents
  ALTER COLUMN brand DROP NOT NULL,
  ALTER COLUMN model DROP NOT NULL,
  ALTER COLUMN brand_key DROP NOT NULL,
  ALTER COLUMN model_key DROP NOT NULL;
COMMENT ON COLUMN majordhome.equipment_documents.scope IS 'Portée du document : marque (tous les appareils de la marque) | modele (marque + modèle, défaut) | appareil (cet équipement seulement, equipment_id). Immuable après dépôt.';
COMMENT ON COLUMN majordhome.equipment_documents.equipment_id IS 'Équipement d''un document de portée appareil (NULL sinon). Immuable après dépôt.';
COMMENT ON TABLE majordhome.equipment_documents IS 'Document d''appareil (notice, vue éclatée…) rangé par portée : toute la marque, le modèle (marque + modèle, clés dérivées par trigger de equipment_model_key) ou un seul équipement.';

ALTER TABLE majordhome.equipment_documents DROP CONSTRAINT IF EXISTS equipment_documents_scope_check;
ALTER TABLE majordhome.equipment_documents ADD CONSTRAINT equipment_documents_scope_check
  CHECK (scope IN ('marque', 'modele', 'appareil'));
ALTER TABLE majordhome.equipment_documents DROP CONSTRAINT IF EXISTS equipment_documents_scope_equipment;
ALTER TABLE majordhome.equipment_documents ADD CONSTRAINT equipment_documents_scope_equipment
  CHECK ((scope = 'appareil') = (equipment_id IS NOT NULL));
ALTER TABLE majordhome.equipment_documents DROP CONSTRAINT IF EXISTS equipment_documents_scope_releve;
ALTER TABLE majordhome.equipment_documents ADD CONSTRAINT equipment_documents_scope_releve
  CHECK (equipment_model_id IS NULL OR scope = 'modele');
-- Filet sous le trigger (qui force model / model_key à NULL) : un document de marque n'a jamais de modèle.
ALTER TABLE majordhome.equipment_documents DROP CONSTRAINT IF EXISTS equipment_documents_scope_marque;
ALTER TABLE majordhome.equipment_documents ADD CONSTRAINT equipment_documents_scope_marque
  CHECK (scope <> 'marque' OR (model IS NULL AND model_key IS NULL));

-- Chemin Storage à deux cas. COALESCE : un CHECK évalué à NULL passerait (equipment_id NULL sur une portée appareil
-- est déjà refusé par equipment_documents_scope_equipment, ce filet ne repose pas sur lui).
ALTER TABLE majordhome.equipment_documents DROP CONSTRAINT IF EXISTS equipment_documents_storage_path_org;
ALTER TABLE majordhome.equipment_documents ADD CONSTRAINT equipment_documents_storage_path_org
  CHECK (COALESCE(CASE WHEN scope = 'appareil'
                       THEN storage_path LIKE org_id::text || '/equipments/' || equipment_id::text || '/%'
                       ELSE storage_path LIKE org_id::text || '/equipment-models/%' END, false));

CREATE INDEX IF NOT EXISTS equipment_documents_equipment_idx
  ON majordhome.equipment_documents (equipment_id) WHERE equipment_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Trigger : clés, exigences par portée, garde d'org, immuabilité
-- ---------------------------------------------------------------------------------------------------------------
-- Les écrivains serveur (equipment_models_set_files, equipment_model_create_from_web, equipment_model_merge) insèrent
-- marque + modèle sans portée ⇒ `modele` par défaut, deux clés exigées : comportement inchangé pour eux.
CREATE OR REPLACE FUNCTION majordhome.equipment_documents_set_keys() RETURNS trigger
LANGUAGE plpgsql
SET search_path = majordhome, public
AS $$
DECLARE
  v_eq_org uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.scope IS DISTINCT FROM OLD.scope OR NEW.equipment_id IS DISTINCT FROM OLD.equipment_id) THEN
    RAISE EXCEPTION 'equipment_document_scope_immutable' USING ERRCODE = '22023',
      HINT = 'La portée et l''équipement d''un document ne changent pas après dépôt : retirer puis redéposer.';
  END IF;

  -- equipment_model_key est STRICT : NULL sur NULL.
  NEW.brand_key := majordhome.equipment_model_key(NEW.brand);
  NEW.model_key := majordhome.equipment_model_key(NEW.model);

  IF NEW.scope = 'marque' THEN
    IF NEW.brand_key IS NULL THEN
      RAISE EXCEPTION 'equipment_document_brand_required' USING ERRCODE = '22023',
        HINT = 'La marque doit contenir au moins une lettre ou un chiffre.';
    END IF;
    NEW.model := NULL;
    NEW.model_key := NULL;
  ELSIF NEW.scope = 'appareil' THEN
    -- Clés facultatives. Sans equipment_id, la contrainte equipment_documents_scope_equipment refuse la ligne.
    IF NEW.equipment_id IS NOT NULL THEN
      SELECT majordhome.project_org_id(e.project_id) INTO v_eq_org
      FROM majordhome.equipments e WHERE e.id = NEW.equipment_id;
      -- Garde positive : équipement introuvable, invisible pour l'appelant ou d'une autre org ⇒ refus.
      IF (v_eq_org = NEW.org_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'equipment_document_equipment_required' USING ERRCODE = '22023',
          HINT = 'Le document doit être rattaché à un équipement existant de la même organisation.';
      END IF;
    END IF;
  ELSE
    -- `modele` (et toute valeur inconnue, refusée ensuite par equipment_documents_scope_check).
    IF NEW.brand_key IS NULL OR NEW.model_key IS NULL THEN
      RAISE EXCEPTION 'equipment_document_model_required' USING ERRCODE = '22023',
        HINT = 'La marque et le modèle doivent contenir au moins une lettre ou un chiffre.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.equipment_documents_set_keys() FROM PUBLIC, anon, authenticated;
-- Toute mise à jour passe par le trigger (et plus seulement celles de brand / model) : c'est lui qui tient l'immuabilité.
DROP TRIGGER IF EXISTS equipment_documents_set_keys ON majordhome.equipment_documents;
CREATE TRIGGER equipment_documents_set_keys
  BEFORE INSERT OR UPDATE ON majordhome.equipment_documents
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipment_documents_set_keys();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Retrait selon la portée (dépôt et modification inchangés)
-- ---------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS equipment_documents_delete_role_can ON majordhome.equipment_documents;
CREATE POLICY equipment_documents_delete_role_can ON majordhome.equipment_documents FOR DELETE
  USING (equipment_model_id IS NULL
         AND (majordhome.role_can(org_id, 'clients', 'delete')
              OR (scope = 'appareil' AND majordhome.role_can(org_id, 'clients', 'edit'))));

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Vues (nouvelles colonnes en fin de liste : CREATE OR REPLACE VIEW refuse sinon)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_equipment_documents WITH (security_invoker = true) AS
  SELECT id, org_id, brand, model, brand_key, model_key, document_type, label, file_name, storage_path, file_size,
         mime_type, uploaded_by, created_at, equipment_model_id, source, scope, equipment_id
  FROM majordhome.equipment_documents;
REVOKE ALL ON public.majordhome_equipment_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_equipment_documents TO authenticated;
GRANT SELECT ON public.majordhome_equipment_documents TO service_role;

-- Lecture par équipement : 1 ligne par équipement × document. Chaque document n'entre que par UNE branche (sa portée,
-- ou le rattachement pour un relevé) : jamais en double, et un document `appareil` ne sort jamais de son équipement.
CREATE OR REPLACE VIEW public.majordhome_equipment_model_documents WITH (security_invoker = true) AS
  -- modèle : dépôt manuel, clé marque + modèle
  SELECT e.id AS equipment_id, d.id, d.org_id, d.brand, d.model, d.document_type, d.label, d.file_name,
         d.storage_path, d.file_size, d.mime_type, d.uploaded_by, d.created_at,
         d.equipment_model_id, false AS from_site, d.scope
  FROM majordhome.equipments e
  JOIN majordhome.equipment_documents d
    ON d.equipment_model_id IS NULL
   AND d.scope = 'modele'
   AND d.org_id = majordhome.project_org_id(e.project_id)
   AND d.brand_key = majordhome.equipment_model_key(e.brand)
   AND d.model_key = majordhome.equipment_model_key(e.model)
  UNION ALL
  -- modèle : document relevé, par le rattachement de l'équipement au modèle fabricant (toujours `modele`)
  SELECT e.id AS equipment_id, d.id, d.org_id, d.brand, d.model, d.document_type, d.label, d.file_name,
         d.storage_path, d.file_size, d.mime_type, d.uploaded_by, d.created_at,
         d.equipment_model_id, true AS from_site, 'modele'::text AS scope
  FROM majordhome.equipments e
  JOIN majordhome.equipment_documents d
    ON d.equipment_model_id = e.equipment_model_id
   AND d.org_id = majordhome.project_org_id(e.project_id)
  UNION ALL
  -- marque : clé de marque seule
  SELECT e.id AS equipment_id, d.id, d.org_id, d.brand, d.model, d.document_type, d.label, d.file_name,
         d.storage_path, d.file_size, d.mime_type, d.uploaded_by, d.created_at,
         d.equipment_model_id, false AS from_site, d.scope
  FROM majordhome.equipments e
  JOIN majordhome.equipment_documents d
    ON d.equipment_model_id IS NULL
   AND d.scope = 'marque'
   AND d.org_id = majordhome.project_org_id(e.project_id)
   AND d.brand_key = majordhome.equipment_model_key(e.brand)
  UNION ALL
  -- appareil : cet équipement seulement
  SELECT e.id AS equipment_id, d.id, d.org_id, d.brand, d.model, d.document_type, d.label, d.file_name,
         d.storage_path, d.file_size, d.mime_type, d.uploaded_by, d.created_at,
         d.equipment_model_id, false AS from_site, d.scope
  FROM majordhome.equipments e
  JOIN majordhome.equipment_documents d
    ON d.scope = 'appareil'
   AND d.equipment_id = e.id
   AND d.org_id = majordhome.project_org_id(e.project_id);
REVOKE ALL ON public.majordhome_equipment_model_documents FROM PUBLIC, anon;
GRANT SELECT ON public.majordhome_equipment_model_documents TO authenticated, service_role;
