-- 20261114_3_equipment_documents_update_colonnes.sql
-- Ferme un contournement de la règle de retrait des documents d'équipement (relevé par la relecture finale de
-- 20261114_1, antérieur à ce chantier ; accord d'Eric 2026-11-14 : « Oui, ferme-le »).
-- La policy UPDATE de majordhome.equipment_documents autorise role_can(org, 'clients', 'edit') sur toute la ligne
-- d'un document déposé à la main : un appel d'API forgé (l'écran ne modifie jamais un document) pouvait réécrire
-- `brand` / `model` d'un document « modèle » ou « marque » — donc le faire disparaître de tout le parc, ou l'envoyer
-- sur un autre, sans le droit de le retirer (clients.delete, org_admin) — et aussi `storage_path`, `uploaded_by`,
-- `created_at`. La portée et l'équipement étaient déjà immuables (trigger) ; ici on ferme les autres colonnes.
--   UPDATE accordé PAR COLONNE à `authenticated` : `label` et `document_type` seulement, sur la table ET sur le
--   miroir public.majordhome_equipment_documents (vue security_invoker : les deux privilèges sont vérifiés).
--   Corriger la marque ou le modèle d'un document = le retirer et le redéposer.
-- Les écrivains serveur (equipment_models_set_files, equipment_model_merge, equipment_model_create_from_web,
-- equipment_model_review) sont SECURITY DEFINER : ils écrivent avec les droits du propriétaire, rien ne change pour eux.
-- ⚠ Ne jamais réémettre `GRANT … UPDATE ON … TO authenticated` (table ou miroir) dans une migration qui recrée la
--   vue : CREATE OR REPLACE VIEW conserve l'ACL par colonne, un GRANT de table entière la rouvrirait en silence.
-- Répétée sur scripts/migration-rehearsal/ (assert-equipment-documents-update-colonnes.sql ; chaîne : celle
-- d'assert-equipment-documents-portee.sql + 20261114_3).

REVOKE UPDATE ON majordhome.equipment_documents FROM authenticated;
GRANT UPDATE (label, document_type) ON majordhome.equipment_documents TO authenticated;

REVOKE UPDATE ON public.majordhome_equipment_documents FROM authenticated;
GRANT UPDATE (label, document_type) ON public.majordhome_equipment_documents TO authenticated;
