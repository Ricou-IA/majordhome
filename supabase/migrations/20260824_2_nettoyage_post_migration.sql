-- ============================================================================
-- Nettoyage post-migration du projet dedie Majord'home (ejqqqwudmizqisdkxohw)
-- Audit du 2026-08-24. Appliquee le 2026-08-24 (schema_migrations :
-- nettoyage_post_migration, versionnee dans le repo le 2026-09-21).
-- ============================================================================
-- Contexte : le projet a ete cree le 2026-08-09 par restauration depuis le
-- projet partage odspcxgafcqxjzrarsqf. La restauration a embarque des objets
-- et des donnees qui ne concernent pas Majord'home.
--
-- Verifications faites avant d'ecrire ce fichier :
--   - aucune replication sortante (0 subscription, 0 foreign server/table ;
--     seule publication : supabase_realtime, interne) ;
--   - les triggers de core ne se declenchent qu'en INSERT/UPDATE, jamais en
--     DELETE, et aucun ne fait d'appel HTTP ;
--   - AUCUNE ligne de majordhome/sources/config ne reference les 5 organisations
--     etrangeres ni leurs 12 projets ;
--   - les seules lignes pointant les 8 profils etrangers sont 11 lignes de
--     core.project_members, en ON DELETE CASCADE ;
--   - les 5 organisations existent a l'identique dans le projet partage (memes
--     identifiants, memes effectifs) : rien n'est perdu pour ARPET/LinkTrack.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. CORRECTIF — bug actif, a appliquer meme si le reste est reporte
-- ----------------------------------------------------------------------------
-- config.apps est VIDE alors que core.organizations.app_id et
-- core.profiles.app_id la referencent par une FK validee. Etat impossible en
-- fonctionnement normal : la restauration s'est faite contraintes desactivees.
-- Consequence : toute creation d'utilisateur echoue, car l'Edge Function
-- create-user pose app_id = org.app_id ('majordhome') sur le nouveau profil
-- et la FK profiles_app_id_fkey n'a aucune ligne parente.

-- Le trigger vient du RAG (il cree un concept "documents cles") et casse les
-- insertions d'app ; config.concepts est supprimee plus bas de toute facon.
DROP TRIGGER IF EXISTS tr_create_documents_cles_on_app_insert ON config.apps;

INSERT INTO config.apps (id, name, is_active)
VALUES ('majordhome', 'Majord''home', true)
ON CONFLICT (id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 1. Retrait des donnees appartenant a d'autres produits
-- ----------------------------------------------------------------------------
-- 4 organisations ARPET (Demathieu Bard, Effidm, Envelion, Roudie) et 1
-- LinkTrack (NEWP), avec 8 profils et 12 projets.
-- Ordre impose : projets -> profils -> organisations.
-- (profiles_org_id_fkey est en RESTRICT : supprimer l'organisation d'abord
--  echouerait.)

DELETE FROM core.projects
WHERE org_id IN (
  '50c496ef-3af2-4aba-8950-e14680ceb895',  -- Demathieu Bard (arpet)
  '606b58fc-9f50-4639-918d-b0fe9c07b0b9',  -- Effidm         (arpet)
  '99569460-1c72-406c-9667-33a5c32c3dc3',  -- Envelion       (arpet)
  'bcfa4a1d-c133-4139-8911-f15241699466',  -- Roudie         (arpet)
  '0ec3057c-a662-4406-b500-94bf97d6e38e'   -- NEWP           (linktrack)
);

DELETE FROM core.profiles
WHERE org_id IN (
  '50c496ef-3af2-4aba-8950-e14680ceb895',
  '606b58fc-9f50-4639-918d-b0fe9c07b0b9',
  '99569460-1c72-406c-9667-33a5c32c3dc3',
  'bcfa4a1d-c133-4139-8911-f15241699466',
  '0ec3057c-a662-4406-b500-94bf97d6e38e'
);

DELETE FROM core.organizations
WHERE id IN (
  '50c496ef-3af2-4aba-8950-e14680ceb895',
  '606b58fc-9f50-4639-918d-b0fe9c07b0b9',
  '99569460-1c72-406c-9667-33a5c32c3dc3',
  'bcfa4a1d-c133-4139-8911-f15241699466',
  '0ec3057c-a662-4406-b500-94bf97d6e38e'
);


-- ----------------------------------------------------------------------------
-- 2. Suppression des tables vides d'autres produits (0 ligne, verifie)
-- ----------------------------------------------------------------------------
-- GTM et TowerControl n'ont aucun rapport avec Majord'home.
DROP TABLE IF EXISTS public.gtm_events         CASCADE;
DROP TABLE IF EXISTS public.gtm_sequence_steps CASCADE;
DROP TABLE IF EXISTS public.gtm_suppressions   CASCADE;
DROP TABLE IF EXISTS public.gtm_leads          CASCADE;
DROP TABLE IF EXISTS public.gtm_saas_config    CASCADE;
DROP TABLE IF EXISTS public.towercontrol_campaigns CASCADE;

-- Reliquats du RAG Baikal. config.apps est CONSERVEE : core.organizations et
-- core.profiles la referencent (cf. section 0).
DROP TABLE IF EXISTS config.document_categories CASCADE;
DROP TABLE IF EXISTS config.concepts            CASCADE;
DROP TABLE IF EXISTS config.agent_prompts       CASCADE;

-- Table DPE vide, heritee du produit MonsieurDPE.
DROP TABLE IF EXISTS majordhome.dpe_data CASCADE;

-- NON SUPPRIME volontairement : sources.files et sources.ingestion_queue.
-- Vides, mais majordhome.equipments les reference par deux FK
-- (equipments_manual_file_id_fkey, equipments_invoice_file_id_fkey).
-- Les retirer imposerait de toucher une table vivante.


-- ----------------------------------------------------------------------------
-- 3. Fonctions pointant encore sur l'ancien projet
-- ----------------------------------------------------------------------------
-- Toutes deux appartiennent a Baikal (RAG et ingestion n8n) et contiennent en
-- dur l'URL de odspcxgafcqxjzrarsqf.
-- /!\ send_to_n8n prend un argument : un DROP sans signature ne trouve rien et
-- IF EXISTS le passe en silence. Toujours donner les types.
DROP FUNCTION IF EXISTS public.keep_alive_librarian() CASCADE;
DROP FUNCTION IF EXISTS sources.send_to_n8n(uuid) CASCADE;


-- ============================================================================
-- BLOCS OPTIONNELS — decommenter selon la decision
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4. (OPTIONNEL) Sauvegardes prises le 2026-08-05 lors de la migration
-- ----------------------------------------------------------------------------
-- 391 et 314 lignes. Seules tables du schema sans RLS, alors que anon detient
-- SELECT dessus. Non atteignables aujourd'hui (le schema majordhome n'est pas
-- expose en API), mais le risque se reveillerait s'il l'etait un jour.
--
-- DROP TABLE IF EXISTS majordhome._leads_backup_20260805;
-- DROP TABLE IF EXISTS majordhome._lpq_backup_20260805;
--
-- Variante prudente si tu veux les garder : activer la RLS sans policy, ce qui
-- ferme tout sauf service_role.
-- ALTER TABLE majordhome._leads_backup_20260805 ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE majordhome._lpq_backup_20260805   ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. (OPTIONNEL) Comptes d'authentification des 8 personnes etrangeres
-- ----------------------------------------------------------------------------
-- La section 1 supprime leurs profils mais pas leurs comptes auth. Aucun ne
-- s'est connecte ici (leur last_sign_in_at du 2026-05-29 precede la creation
-- du projet le 2026-08-09 : c'est une date recopiee). Aucun projet Majord'home
-- n'a ete cree par eux, aucune invitation n'emane d'eux : rien ne bloque.
-- A executer APRES la section 1.
--
-- DELETE FROM auth.users
-- WHERE id IN (
--   SELECT u.id FROM auth.users u
--   WHERE NOT EXISTS (SELECT 1 FROM core.profiles p WHERE p.id = u.id)
--     AND u.created_at < '2026-08-09'
-- );
-- /!\ Cette formulation viserait aussi les 5 comptes auth deja sans profil
--     avant nettoyage. A restreindre a la liste nominative des 8 avant
--     execution — je la produirai au moment de l'application.
