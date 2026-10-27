-- 20261028_5_equipment_documents.sql
-- Documents du MODÈLE d'appareil (notice technique, vue éclatée, autre), partagés par tous les équipements de
-- même marque + modèle dans l'org. Demande d'Eric (2026-10-27) : « la notice technique quand il y a un code
-- erreur, la vue éclatée pour commander la pièce » — ce sont des documents du modèle, pas de l'appareil d'un
-- client : déposés une fois depuis n'importe quelle fiche, visibles sur toutes les fiches qui ont le même appareil.
--   1. majordhome.equipment_model_key(text) : clé de rapprochement marque / modèle (minuscules, sans accents,
--      alphanumérique seulement : « Jøtul F 370 » et « JOTUL F-370 » se retrouvent). SOURCE UNIQUE de la
--      normalisation : le front ne calcule jamais de clé, il lit par equipment_id (vue § 4).
--   2. majordhome.equipment_documents : org, marque + modèle tels que saisis, clés dérivées par trigger, type,
--      libellé, fichier (bucket product-documents existant, chemin `${orgId}/equipment-models/…`, policies
--      Storage org déjà en place — 20260809_2).
--   3. Droits (registre : table `equipment_documents` sous la ressource `clients`) : lecture tout membre ;
--      dépôt / modification = role_can(org, 'clients', 'edit') — le technicien qui a la notice en main peut la
--      déposer ; suppression = role_can(org, 'clients', 'delete') : défaut faux pour tous, bypass org_admin.
--   4. Vues : majordhome_equipment_documents (miroir updatable, écriture du front) ;
--      majordhome_equipment_model_documents (lecture seule, 1 ligne par équipement × document, jointure par clés,
--      org dérivée du projet de l'équipement).
-- Répétée sur scripts/migration-rehearsal/ (assert-equipment-documents.sql).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Clé de rapprochement
-- ---------------------------------------------------------------------------------------------------------------
-- translate() : majuscules accentuées → lettre nue AVANT lower() (en locale C, lower() ne touche que l'ASCII :
-- le harnais de répétition est en --no-locale), puis minuscules accentuées → lettre nue. Les 3 lettres doubles
-- (ß æ œ) passent par replace(). Tout ce qui n'est pas [a-z0-9] est retiré ; vide ⇒ NULL (« - » n'est pas un modèle).
-- « À renseigner » (marque ET modèle de 556 appareils Mayer, texte de remplissage de l'import Excel 2026-02) n'est
-- pas un modèle : clé NULL, sinon une notice déposée sur l'un serait partagée par tous (vu sur le harnais).
-- Même liste côté front dans equipmentHasModel() (equipmentDocuments.service.js) pour cacher le bouton « Déposer ».
CREATE OR REPLACE FUNCTION majordhome.equipment_model_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT k FROM (SELECT nullif(regexp_replace(
    translate(
      lower(translate(
        replace(replace(replace(replace(replace(replace(p, 'ß', 'ss'), 'Æ', 'ae'), 'æ', 'ae'), 'Œ', 'oe'), 'œ', 'oe'), 'ẞ', 'ss'),
        'ÀÁÂÃÄÅĀĂĄÈÉÊËĒĖĘĚÌÍÎÏĪĮİÒÓÔÕÖØŌŐÙÚÛÜŪŮŰÝŸÇĆČÑŃŠŚŽŹŻŁĐ',
        'aaaaaaaaaeeeeeeeeiiiiiiioooooooouuuuuuuyycccnnsszzzld')),
      'àáâãäåāăąèéêëēėęěìíîïīįıòóôõöøōőùúûüūůűýÿçćčñńšśžźżłđ',
      'aaaaaaaaaeeeeeeeeiiiiiiioooooooouuuuuuuyycccnnsszzzld'),
    '[^a-z0-9]', '', 'g'), '') AS k) t
  WHERE k NOT IN ('arenseigner', 'inconnu', 'inconnue', 'nc', 'na');
$$;
COMMENT ON FUNCTION majordhome.equipment_model_key(text) IS 'Clé de rapprochement marque / modèle d''équipement : minuscules, sans accents, [a-z0-9] seulement ; NULL si rien ne reste. Source unique (front : jamais de clé calculée).';
REVOKE EXECUTE ON FUNCTION majordhome.equipment_model_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION majordhome.equipment_model_key(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.equipment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  brand text NOT NULL,
  model text NOT NULL,
  brand_key text NOT NULL,
  model_key text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('notice', 'vue_eclatee', 'autre')),
  label text,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_by uuid, -- auth.uid() du déposant (trace, sans FK : auth.users n'est pas répété par le harnais)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_documents_storage_path_org CHECK (storage_path LIKE org_id::text || '/equipment-models/%')
);
COMMENT ON TABLE majordhome.equipment_documents IS 'Document d''un MODÈLE d''appareil (notice, vue éclatée…), partagé par tous les équipements de l''org de même marque + modèle (clés dérivées par trigger de equipment_model_key).';
COMMENT ON COLUMN majordhome.equipment_documents.document_type IS 'notice | vue_eclatee | autre';
CREATE INDEX IF NOT EXISTS equipment_documents_org_model_idx ON majordhome.equipment_documents (org_id, brand_key, model_key);

CREATE OR REPLACE FUNCTION majordhome.equipment_documents_set_keys() RETURNS trigger
LANGUAGE plpgsql
SET search_path = majordhome, public
AS $$
BEGIN
  NEW.brand_key := majordhome.equipment_model_key(NEW.brand);
  NEW.model_key := majordhome.equipment_model_key(NEW.model);
  IF NEW.brand_key IS NULL OR NEW.model_key IS NULL THEN
    RAISE EXCEPTION 'equipment_document_model_required' USING ERRCODE = '22023',
      HINT = 'La marque et le modèle doivent contenir au moins une lettre ou un chiffre.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.equipment_documents_set_keys() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS equipment_documents_set_keys ON majordhome.equipment_documents;
CREATE TRIGGER equipment_documents_set_keys
  BEFORE INSERT OR UPDATE OF brand, model ON majordhome.equipment_documents
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipment_documents_set_keys();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Droits
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.equipment_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipment_documents_select ON majordhome.equipment_documents;
CREATE POLICY equipment_documents_select ON majordhome.equipment_documents FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
DROP POLICY IF EXISTS equipment_documents_insert_role_can ON majordhome.equipment_documents;
CREATE POLICY equipment_documents_insert_role_can ON majordhome.equipment_documents FOR INSERT
  WITH CHECK (majordhome.role_can(org_id, 'clients', 'edit'));
DROP POLICY IF EXISTS equipment_documents_update_role_can ON majordhome.equipment_documents;
CREATE POLICY equipment_documents_update_role_can ON majordhome.equipment_documents FOR UPDATE
  USING (majordhome.role_can(org_id, 'clients', 'edit'))
  WITH CHECK (majordhome.role_can(org_id, 'clients', 'edit'));
DROP POLICY IF EXISTS equipment_documents_delete_role_can ON majordhome.equipment_documents;
CREATE POLICY equipment_documents_delete_role_can ON majordhome.equipment_documents FOR DELETE
  USING (majordhome.role_can(org_id, 'clients', 'delete'));
REVOKE ALL ON majordhome.equipment_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.equipment_documents TO authenticated;
GRANT SELECT ON majordhome.equipment_documents TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Vues
-- ---------------------------------------------------------------------------------------------------------------
-- Miroir simple = updatable : c'est par lui que le front insère / supprime (les clés sont posées par le trigger).
CREATE OR REPLACE VIEW public.majordhome_equipment_documents WITH (security_invoker = true) AS
  SELECT id, org_id, brand, model, brand_key, model_key, document_type, label, file_name, storage_path, file_size,
         mime_type, uploaded_by, created_at
  FROM majordhome.equipment_documents;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_equipment_documents TO authenticated;
GRANT SELECT ON public.majordhome_equipment_documents TO service_role;

-- Lecture par équipement : le front filtre `.eq('org_id', …).in('equipment_id', …)`, jamais par clé.
CREATE OR REPLACE VIEW public.majordhome_equipment_model_documents WITH (security_invoker = true) AS
  SELECT e.id AS equipment_id, d.id, d.org_id, d.brand, d.model, d.document_type, d.label, d.file_name,
         d.storage_path, d.file_size, d.mime_type, d.uploaded_by, d.created_at
  FROM majordhome.equipments e
  JOIN majordhome.equipment_documents d
    ON d.org_id = majordhome.project_org_id(e.project_id)
   AND d.brand_key = majordhome.equipment_model_key(e.brand)
   AND d.model_key = majordhome.equipment_model_key(e.model);
GRANT SELECT ON public.majordhome_equipment_model_documents TO authenticated, service_role;
