-- 20261017_1_chantier_gaillac.sql
-- Chantier Gaillac (préconisations P2 – Ville de Gaillac, sous-traitance Veolia).
-- Module PROVISOIRE : retrait = bloc « NETTOYAGE » en bas de fichier (cf. CLAUDE.md, Modules provisoires).
--
-- Écarts avec le script fourni (chantier_gaillac.sql) :
--   1. Admin = om.role = 'org_admin' OU profiles.app_role = 'org_admin' : les rôles 'admin' / 'owner'
--      n'existent pas dans core.organization_members (org_admin / team_leader / member / user).
--   2. REVOKE EXECUTE … FROM PUBLIC, anon sur les 3 fonctions (règle multi-tenant : sans PUBLIC,
--      anon hérite d'EXECUTE en silence).
--   3. Vues public.majordhome_chantier_gaillac_* (security_invoker, miroirs simples donc
--      auto-updatables) : le schéma majordhome n'est pas exposé à PostgREST.
--      GRANT SELECT service_role sur les tables (règle « table lue via une vue publique »).
--   4. Techniciens rattachés par team_members.id explicite (et non par display_name : un nom
--      introuvable aurait laissé technicien_id à NULL sans aucune erreur).
--   5. Gardes écrites en positif (« IS NOT TRUE »), refus de cocher une ligne hors périmètre.
--   6. Pas de BEGIN / COMMIT : apply_migration (et le harnais) ouvrent déjà la transaction.

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.chantier_gaillac_planning (
  code            text PRIMARY KEY,              -- MER21, JEU22, VEN23, L1..L7, A1..A11
  ordre           integer NOT NULL,
  libelle         text NOT NULL,
  technicien_id   uuid REFERENCES majordhome.team_members(id),
  date_prevue     date,                          -- renseignée au fil de la programmation
  org_id          uuid NOT NULL DEFAULT '7825fe43-cacb-4feb-b783-6ea3f1ccff77'
                  REFERENCES majordhome.organizations(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS majordhome.chantier_gaillac_taches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL DEFAULT '7825fe43-cacb-4feb-b783-6ea3f1ccff77'
                      REFERENCES majordhome.organizations(id),
  numero              text NOT NULL UNIQUE,       -- n° de la liste Veolia (ex. 31b) ou R1..R13 pour les relevés
  ordre               integer NOT NULL,
  site                text NOT NULL,
  adresse             text,
  zone                text CHECK (zone IN ('Nord-Est', 'Centre-Sud')),
  action              text NOT NULL,
  theme               text,
  type_ligne          text NOT NULL DEFAULT 'action'
                      CHECK (type_ligne IN ('action', 'releve', 'hors_perimetre')),
  technicien_id       uuid REFERENCES majordhome.team_members(id),
  duree_min           integer,                    -- hors accès ; +20 min par site et par passage
  achat_requis        boolean NOT NULL DEFAULT false,
  planning_code       text REFERENCES majordhome.chantier_gaillac_planning(code),
  observations        text,
  -- suivi terrain (seuls champs modifiables par les techniciens)
  fait                boolean NOT NULL DEFAULT false,
  fait_le             timestamptz,
  fait_par            uuid,                       -- auth.uid() posé par le trigger (pas de FK auth.users : non répétable)
  commentaire_terrain text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chantier_gaillac_taches_planning_idx ON majordhome.chantier_gaillac_taches(planning_code);
CREATE INDEX IF NOT EXISTS chantier_gaillac_taches_tech_idx ON majordhome.chantier_gaillac_taches(technicien_id);

-- ---------------------------------------------------------------------
-- 2. Fonctions d'accès (membre / admin de l'organisation)
--    EXISTS ⇒ jamais NULL ; auth.uid() NULL ⇒ faux (aucune ligne ne correspond).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.cg_is_member(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM majordhome.organizations mo
    JOIN core.organization_members om ON om.org_id = mo.core_org_id
    WHERE mo.id = p_org AND om.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION majordhome.cg_is_admin(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM majordhome.organizations mo
    JOIN core.organization_members om ON om.org_id = mo.core_org_id
    LEFT JOIN core.profiles p ON p.id = om.user_id
    WHERE mo.id = p_org AND om.user_id = auth.uid()
      AND (om.role = 'org_admin' OR p.app_role = 'org_admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION majordhome.cg_is_member(uuid), majordhome.cg_is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION majordhome.cg_is_member(uuid), majordhome.cg_is_admin(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Trigger : un non-admin ne change que fait / commentaire_terrain ;
--    fait_le et fait_par sont posés automatiquement.
--    auth.uid() NULL = exécution serveur (éditeur SQL, service_role) : pas de restriction.
--    Un appel PostgREST anonyme n'arrive jamais ici (RLS : cg_is_member faux).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.cg_taches_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND majordhome.cg_is_admin(OLD.org_id) IS NOT TRUE THEN
    IF (NEW.numero, NEW.ordre, NEW.site, NEW.adresse, NEW.zone, NEW.action, NEW.theme,
        NEW.type_ligne, NEW.technicien_id, NEW.duree_min, NEW.achat_requis,
        NEW.planning_code, NEW.observations, NEW.org_id)
       IS DISTINCT FROM
       (OLD.numero, OLD.ordre, OLD.site, OLD.adresse, OLD.zone, OLD.action, OLD.theme,
        OLD.type_ligne, OLD.technicien_id, OLD.duree_min, OLD.achat_requis,
        OLD.planning_code, OLD.observations, OLD.org_id) THEN
      RAISE EXCEPTION 'Seuls le statut et le commentaire terrain sont modifiables par un technicien'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.fait IS DISTINCT FROM OLD.fait THEN
    IF NEW.fait AND NEW.type_ligne = 'hors_perimetre' THEN
      RAISE EXCEPTION 'Une tâche hors périmètre ne se valide pas' USING ERRCODE = '22023';
    END IF;
    IF NEW.fait THEN
      NEW.fait_le := now();
      NEW.fait_par := auth.uid();
    ELSE
      NEW.fait_le := NULL;
      NEW.fait_par := NULL;
    END IF;
  ELSE
    -- fait_le / fait_par ne s'écrivent qu'au changement de statut
    NEW.fait_le := OLD.fait_le;
    NEW.fait_par := OLD.fait_par;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION majordhome.cg_taches_before_update() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS cg_taches_before_update ON majordhome.chantier_gaillac_taches;
CREATE TRIGGER cg_taches_before_update
  BEFORE UPDATE ON majordhome.chantier_gaillac_taches
  FOR EACH ROW EXECUTE FUNCTION majordhome.cg_taches_before_update();

-- ---------------------------------------------------------------------
-- 4. RLS
--    Exception assumée au modèle role_can : module provisoire, tout membre de l'org lit et
--    coche (le trigger borne ce qu'un non-admin peut écrire). Pas de ressource au registre.
-- ---------------------------------------------------------------------
ALTER TABLE majordhome.chantier_gaillac_taches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.chantier_gaillac_planning ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cg_taches_select ON majordhome.chantier_gaillac_taches;
DROP POLICY IF EXISTS cg_taches_update ON majordhome.chantier_gaillac_taches;
DROP POLICY IF EXISTS cg_taches_insert ON majordhome.chantier_gaillac_taches;
DROP POLICY IF EXISTS cg_taches_delete ON majordhome.chantier_gaillac_taches;
CREATE POLICY cg_taches_select ON majordhome.chantier_gaillac_taches FOR SELECT TO authenticated
  USING (majordhome.cg_is_member(org_id));
CREATE POLICY cg_taches_update ON majordhome.chantier_gaillac_taches FOR UPDATE TO authenticated
  USING (majordhome.cg_is_member(org_id)) WITH CHECK (majordhome.cg_is_member(org_id));
CREATE POLICY cg_taches_insert ON majordhome.chantier_gaillac_taches FOR INSERT TO authenticated
  WITH CHECK (majordhome.cg_is_admin(org_id));
CREATE POLICY cg_taches_delete ON majordhome.chantier_gaillac_taches FOR DELETE TO authenticated
  USING (majordhome.cg_is_admin(org_id));

DROP POLICY IF EXISTS cg_planning_select ON majordhome.chantier_gaillac_planning;
DROP POLICY IF EXISTS cg_planning_write  ON majordhome.chantier_gaillac_planning;
CREATE POLICY cg_planning_select ON majordhome.chantier_gaillac_planning FOR SELECT TO authenticated
  USING (majordhome.cg_is_member(org_id));
CREATE POLICY cg_planning_write ON majordhome.chantier_gaillac_planning FOR ALL TO authenticated
  USING (majordhome.cg_is_admin(org_id)) WITH CHECK (majordhome.cg_is_admin(org_id));

-- ACL par défaut du schéma majordhome : anon = arwd → on ferme explicitement.
REVOKE ALL ON majordhome.chantier_gaillac_taches, majordhome.chantier_gaillac_planning FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.chantier_gaillac_taches   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.chantier_gaillac_planning TO authenticated;
GRANT SELECT ON majordhome.chantier_gaillac_taches, majordhome.chantier_gaillac_planning TO service_role;

-- ---------------------------------------------------------------------
-- 5. Vues publiques (miroirs simples ⇒ auto-updatables ; jamais de JOIN ici)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_chantier_gaillac_planning WITH (security_invoker = true) AS
SELECT code, ordre, libelle, technicien_id, date_prevue, org_id, created_at, updated_at
FROM majordhome.chantier_gaillac_planning;

CREATE OR REPLACE VIEW public.majordhome_chantier_gaillac_taches WITH (security_invoker = true) AS
SELECT id, org_id, numero, ordre, site, adresse, zone, action, theme, type_ligne, technicien_id,
       duree_min, achat_requis, planning_code, observations, fait, fait_le, fait_par,
       commentaire_terrain, created_at, updated_at
FROM majordhome.chantier_gaillac_taches;

REVOKE ALL ON public.majordhome_chantier_gaillac_planning, public.majordhome_chantier_gaillac_taches FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.majordhome_chantier_gaillac_planning, public.majordhome_chantier_gaillac_taches TO authenticated;
GRANT SELECT ON public.majordhome_chantier_gaillac_planning, public.majordhome_chantier_gaillac_taches TO service_role;

-- ---------------------------------------------------------------------
-- 6. Import des données (uniquement si les tables sont vides)
--    A = Antoine Verloo (15a68690-…), L = Ludovic Robert (87ba1ecb-…)
-- ---------------------------------------------------------------------
INSERT INTO majordhome.chantier_gaillac_planning (code, ordre, libelle, technicien_id, date_prevue)
SELECT v.code, v.ordre, v.libelle,
       CASE v.tech WHEN 'A' THEN '15a68690-1ac5-409e-8c00-c7ba19b40ff3'::uuid
                   WHEN 'L' THEN '87ba1ecb-0913-4cc0-8755-62c43c153693'::uuid END,
       v.date_prevue
FROM (VALUES
  ('MER21', 1, 'Mercredi 21 octobre – Antoine', 'A', date '2026-10-21'),
  ('JEU22', 2, 'Jeudi 22 octobre – Ludovic', 'L', date '2026-10-22'),
  ('VEN23', 3, 'Vendredi 23 octobre (matin) – Ludovic', 'L', date '2026-10-23'),
  ('L1', 4, 'L1 – Ludovic : Ossel 1 (tronçon cuivre, étiquette gaz)', 'L', NULL),
  ('L2', 5, 'L2 – Ludovic : Ossel 2 (vase, fléchage, peinture gaz)', 'L', NULL),
  ('L3', 6, 'L3 – Ludovic : Club House + Laborie', 'L', NULL),
  ('L4', 7, 'L4 – Ludovic : Château Pichery MJC', 'L', NULL),
  ('L5', 8, 'L5 – Ludovic : Gymnase Pichery + Gymnase Camus', 'L', NULL),
  ('L6', 9, 'L6 – Ludovic : Piscine Pichery', 'L', NULL),
  ('L7', 10, 'L7 – Ludovic : MCEF + Site Accueil AVF', 'L', NULL),
  ('A1', 11, 'A1 – Antoine : Ancien centre de secours + SICT', 'A', NULL),
  ('A2', 12, 'A2 – Antoine : Hôtel de Ville (signalétique, peinture, rouille)', 'A', NULL),
  ('A3', 13, 'A3 – Antoine : Hôtel de Ville, CIO, Associations, Réserves', 'A', NULL),
  ('A4', 14, 'A4 – Antoine : Rives Thomas + Maison des Artistes', 'A', NULL),
  ('A5', 15, 'A5 – Antoine : Musée Philadelphie + Maison des Vins', 'A', NULL),
  ('A6', 16, 'A6 – Antoine : Résidence CCAS', 'A', NULL),
  ('A7', 17, 'A7 – Antoine : Musée des Beaux-Arts 1 (VRV combles, gaine, relevage)', 'A', NULL),
  ('A8', 18, 'A8 – Antoine : Musée des Beaux-Arts 2 + Stade Saint-Roch', 'A', NULL),
  ('A9', 19, 'A9 – Antoine : Musée des Beaux-Arts 3 (bouches, après diagnostic d''Yvan)', 'A', NULL),
  ('A10', 20, 'A10 – Antoine : Immeuble Salvy', 'A', NULL),
  ('A11', 21, 'A11 – Antoine : crochets Nord-Est (Gym Pichery, MCEF, Laborie)', 'A', NULL)
) AS v(code, ordre, libelle, tech, date_prevue)
WHERE NOT EXISTS (SELECT 1 FROM majordhome.chantier_gaillac_planning);

INSERT INTO majordhome.chantier_gaillac_taches
  (numero, ordre, site, adresse, zone, action, theme, type_ligne, technicien_id, duree_min, achat_requis, planning_code, observations)
SELECT v.numero, v.ordre, v.site, v.adresse, v.zone, v.action, v.theme, v.type_ligne,
       CASE v.tech WHEN 'A' THEN '15a68690-1ac5-409e-8c00-c7ba19b40ff3'::uuid
                   WHEN 'L' THEN '87ba1ecb-0913-4cc0-8755-62c43c153693'::uuid END,
       v.duree_min, v.achat_requis, v.planning_code, v.observations
FROM (VALUES
  ('1', 1, 'Ancien centre de secours', '127 av. Dom Vayssette', 'Centre-Sud', 'Repérer les coupures électriques extérieures', 'Signalétique', 'action', 'A', 15, true, 'A1', NULL),
  ('2', 2, 'Ancien centre de secours', '127 av. Dom Vayssette', 'Centre-Sud', 'Repeindre la canalisation gaz (RAL 1023)', 'Peinture gaz RAL 1023', 'action', 'A', 45, true, 'A1', NULL),
  ('3', 3, 'Ancien centre de secours', '127 av. Dom Vayssette', 'Centre-Sud', 'Remplacer le purgeur auto fuyard, y compris pose d''une vanne en amont', 'Plomberie / ECS', 'action', 'A', 60, true, 'A1', NULL),
  ('4', 4, 'Ancien centre de secours', '127 av. Dom Vayssette', 'Centre-Sud', 'Brosser les tuyauteries de pénétration en caniveau, reprise antirouille', 'Antirouille', 'action', 'A', 60, true, 'A1', NULL),
  ('5', 5, 'Ancien CIO', '80 place d''Hautpoul', 'Centre-Sud', 'Repérer les coupures électriques extérieures', 'Signalétique', 'action', 'A', 15, true, 'A3', NULL),
  ('6', 6, 'Ancien CIO', '80 place d''Hautpoul', 'Centre-Sud', 'Repeindre la canalisation gaz (RAL 1023)', 'Peinture gaz RAL 1023', 'action', 'A', 45, true, 'A3', NULL),
  ('7', 7, 'Ancien CIO', '80 place d''Hautpoul', 'Centre-Sud', 'Remettre une vitre sur le coffret gaz', 'Divers', 'action', 'A', 20, true, 'A3', 'Dimensions relevées le 21/10 (R3)'),
  ('8', 8, 'Château Pichery (MJC)', '10 av. Aspirant Buffet', 'Nord-Est', 'Reprendre l''ensemble des points de corrosion (brossage et peinture)', 'Antirouille', 'action', 'L', 60, true, 'L4', NULL),
  ('10', 9, 'Château Pichery (MJC)', '10 av. Aspirant Buffet', 'Nord-Est', 'Identifier et repérer les équipements desservis par les protections de l''armoire électrique', 'Signalétique', 'action', 'L', 60, true, 'L4', NULL),
  ('11', 10, 'Château Pichery (MJC)', '10 av. Aspirant Buffet', 'Nord-Est', 'Identifier les réseaux (gaz, départ, retour, recyclage ECS…) par étiquettes', 'Signalétique', 'action', 'L', 30, true, 'L4', NULL),
  ('12', 11, 'Château Pichery (MJC)', '10 av. Aspirant Buffet', 'Nord-Est', 'Flécher le sens de circulation des fluides', 'Signalétique', 'action', 'L', 30, true, 'L4', NULL),
  ('13', 12, 'Château Pichery (MJC)', '10 av. Aspirant Buffet', 'Nord-Est', 'Fermer la boîte Plexo (remplacement)', 'Électricité', 'action', 'L', 15, true, 'L4', NULL),
  ('14', 13, 'Château Pichery (MJC)', '10 av. Aspirant Buffet', 'Nord-Est', 'Contrôler le point de déclenchement du pressostat manque d''eau', 'Contrôles chauffage', 'action', 'L', 30, false, 'JEU22', NULL),
  ('15', 14, 'Gymnase Camus', 'av. Georges Spénale', 'Nord-Est', 'Contrôler la pression de gonflage du (des) vase(s), reporter la date sur le livret', 'Contrôles chauffage', 'action', 'L', 20, false, 'VEN23', NULL),
  ('16', 15, 'Gymnase Camus', 'av. Georges Spénale', 'Nord-Est', 'Repérer les coupures électriques extérieures', 'Signalétique', 'action', 'L', 15, true, 'L5', NULL),
  ('17', 16, 'Gymnase Camus', 'av. Georges Spénale', 'Nord-Est', 'Modifier l''orientation de la chasse ECS et la canaliser vers l''égout', 'Plomberie / ECS', 'action', 'L', 45, true, 'L5', NULL),
  ('18', 17, 'Gymnase Camus', 'av. Georges Spénale', 'Nord-Est', 'Canaliser la soupape ECS en tuyau rigide', 'Plomberie / ECS', 'action', 'L', 45, true, 'L5', NULL),
  ('19', 18, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Étiqueter le coffret de coupure gaz extérieur', 'Signalétique', 'action', 'L', 10, true, 'L1', NULL),
  ('20', 19, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Contrôler la pression de gonflage du (des) vase(s), reporter la date sur le livret', 'Contrôles chauffage', 'action', 'L', 20, false, 'JEU22', NULL),
  ('21', 20, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Flécher le sens de circulation des fluides', 'Signalétique', 'action', 'L', 45, true, 'L2', NULL),
  ('22', 21, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Repeindre la canalisation gaz (RAL 1023)', 'Peinture gaz RAL 1023', 'action', 'L', 60, true, 'L2', NULL),
  ('23', 22, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Bouclage froid : contrôle urgent', 'Plomberie / ECS', 'action', 'L', 60, false, 'JEU22', 'Sécurité – priorité. Si réparation nécessaire : à commander'),
  ('24', 23, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Reprendre l''alimentation du vase d''expansion', 'Plomberie / ECS', 'action', 'L', 90, true, 'L2', NULL),
  ('26', 24, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Compléter les bouchons manquants', 'Plomberie / ECS', 'action', 'L', 20, false, 'JEU22', NULL),
  ('27', 25, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Remplacer le tronçon cuivre du circuit charge ballon', 'Plomberie / ECS', 'action', 'L', 180, true, 'L1', 'Vidange, brasure, remise en eau'),
  ('28', 26, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Remettre un presse-étoupe (câble moteur V3V ECS)', 'Électricité', 'action', 'L', 15, false, 'JEU22', NULL),
  ('31', 27, 'Gymnase Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Contrôler la pression de gonflage du (des) vase(s), reporter la date sur le livret', 'Contrôles chauffage', 'action', 'L', 20, false, 'JEU22', NULL),
  ('31b', 28, 'Gymnase Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Contrôle des thermomètres et chasses', 'Contrôles chauffage', 'action', 'L', 30, false, 'JEU22', 'Ajout depuis le devis'),
  ('32', 29, 'Gymnase Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Flécher le sens de circulation des fluides', 'Signalétique', 'action', 'L', 30, true, 'L5', NULL),
  ('33', 30, 'Gymnase Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Repérer les coupures électriques extérieures', 'Signalétique', 'action', 'L', 15, true, 'L5', NULL),
  ('34', 31, 'Gymnase Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Repeindre la canalisation gaz (RAL 1023)', 'Peinture gaz RAL 1023', 'action', 'L', 45, true, 'L5', NULL),
  ('35', 32, 'Gymnase Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Refixer le capotage du ventilo-convecteur CIAT', 'Clim / ventilation', 'action', 'A', 20, false, 'A11', NULL),
  ('36', 33, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Identifier les réseaux par étiquettes', 'Signalétique', 'action', 'A', 30, true, 'A2', NULL),
  ('37', 34, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Flécher le sens de circulation des fluides', 'Signalétique', 'action', 'A', 30, true, 'A2', NULL),
  ('38', 35, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Peindre la conduite gaz au RAL de référence (suite remplacement chaudière)', 'Peinture gaz RAL 1023', 'action', 'A', 45, true, 'A2', NULL),
  ('39', 36, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Brosser et repeindre les nombreux points de rouille', 'Antirouille', 'action', 'A', 90, true, 'A2', NULL),
  ('40', 37, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Nettoyer / remplacer la masse filtrante', 'Clim / ventilation', 'action', 'A', 30, true, 'A3', 'Référence relevée le 21/10 (R2)'),
  ('41', 38, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Fil dénudé dans l''armoire du VMT : rebrancher ou mettre un Wago', 'Électricité', 'action', 'A', 20, false, 'MER21', 'Sécurité – priorité'),
  ('42', 39, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Passer un coup de balai en chaufferie', 'Divers', 'action', 'A', 15, false, 'MER21', NULL),
  ('45', 40, 'Immeuble Salvy', '8 Contrescarpe Henri IV', 'Centre-Sud', 'Refixer le caisson et remettre les gaines', 'Clim / ventilation', 'action', 'A', 60, false, 'A10', NULL),
  ('46', 41, 'Immeuble Salvy', '8 Contrescarpe Henri IV', 'Centre-Sud', 'Nettoyer les bouches', 'Clim / ventilation', 'action', 'A', 30, false, 'A10', NULL),
  ('46b', 42, 'Immeuble Salvy', '8 Contrescarpe Henri IV', 'Centre-Sud', 'Poser le kit de neutralisation des condensats (maxi 35 kg)', 'Clim / ventilation', 'action', 'A', 60, true, 'A10', 'Ajout depuis le devis'),
  ('47', 43, 'MCEF', '510 av. François Mitterrand', 'Nord-Est', 'Traiter les points de rouille, reprise de peinture', 'Antirouille', 'action', 'L', 45, true, 'L7', 'Pas de main d''œuvre vendue au devis sur ce site'),
  ('49', 44, 'MCEF', '510 av. François Mitterrand', 'Nord-Est', 'Entretien de l''unité Fujitsu extérieure', 'Clim / ventilation', 'action', 'A', 60, false, 'A11', 'Pas de main d''œuvre vendue au devis sur ce site'),
  ('51', 45, 'Maison des Associations', '82 place d''Hautpoul', 'Centre-Sud', 'Repérer les coupures électriques extérieures', 'Signalétique', 'action', 'A', 15, true, 'A3', NULL),
  ('53', 46, 'Maison des Vins', 'place Saint-Michel', 'Centre-Sud', 'Vérifier la présence de filtres en amont des batteries (13 unités intérieures)', 'Clim / ventilation', 'action', 'A', 120, false, 'A5', 'Peut être avancée le 21/10 si Antoine a du temps (site voisin)'),
  ('56', 47, 'Maison Dom Vayssette', '2 rue Comte de Toulouse', 'Centre-Sud', 'Vérifier l''état des filtres des 11 ventilo-convecteurs CIAT (5 RDC, 6 R+1)', 'Clim / ventilation', 'action', 'A', 110, false, 'MER21', 'Signaler par écrit à Veolia le n°58 : risque d''incendie sur le sectionneur (hors périmètre)'),
  ('59', 48, 'Musée des Beaux-Arts', '2 av. Dom Vayssette', 'Centre-Sud', 'Entretien du groupe VRV et nettoyage du local', 'Clim / ventilation', 'action', 'A', 120, false, 'A8', NULL),
  ('60', 49, 'Musée des Beaux-Arts', '2 av. Dom Vayssette', 'Centre-Sud', 'Refaire les bouches d''extraction, raccorder les gaines, remettre en service', 'Clim / ventilation', 'action', 'A', 180, true, 'A9', 'En attente du diagnostic d''Yvan'),
  ('61', 50, 'Musée des Beaux-Arts', '2 av. Dom Vayssette', 'Centre-Sud', 'Refixer la gaine de refoulement de l''extracteur avec supportage, nettoyage', 'Clim / ventilation', 'action', 'A', 60, true, 'A7', NULL),
  ('62', 51, 'Musée des Beaux-Arts', '2 av. Dom Vayssette', 'Centre-Sud', 'Maintenance des unités VRV Toshiba dans les combles', 'Clim / ventilation', 'action', 'A', 120, false, 'A7', NULL),
  ('63', 52, 'Musée des Beaux-Arts', '2 av. Dom Vayssette', 'Centre-Sud', 'Nettoyer le bac de la pompe de relevage, vérifier l''écoulement', 'Plomberie / ECS', 'action', 'A', 30, false, 'A7', 'Le Stade Saint-Roch est voisin : même demi-journée'),
  ('67', 53, 'Musée Philadelphie', '2 place Philadelphie Thomas', 'Centre-Sud', 'Brosser et peindre les pénétrations vers réseaux enterrés, pose tôle de protection', 'Antirouille', 'action', 'A', 60, true, 'A5', 'Dimensions de la tôle relevées le 21/10 (R5)'),
  ('69', 54, 'Piscine Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Réaliser les chasses sur les ballons ECS', 'Plomberie / ECS', 'action', 'L', 30, false, 'VEN23', 'Photos et description non conformes à la liste – à vérifier sur place'),
  ('70', 55, 'Piscine Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Reprendre l''ensemble des points de corrosion', 'Antirouille', 'action', 'L', 120, true, 'L6', 'Photos et description non conformes à la liste – à vérifier sur place'),
  ('71', 56, 'Piscine Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Coulures sur les bouchons du ballon tampon froid', 'Plomberie / ECS', 'action', 'L', 30, false, 'VEN23', 'Photos et description non conformes à la liste – à vérifier sur place'),
  ('72', 57, 'Piscine Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Remettre les capots des sondes', 'Contrôles chauffage', 'action', 'L', 15, false, 'VEN23', 'Photos et description non conformes à la liste – à vérifier sur place'),
  ('73', 58, 'Piscine Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Identifier les réseaux et flécher le sens de circulation', 'Signalétique', 'action', 'L', 45, true, 'L6', 'Photos et description non conformes à la liste – à vérifier sur place'),
  ('75', 59, 'Réserves du Patrimoine', 'place Saint-Michel', 'Centre-Sud', 'Remplacer le purgeur auto fuyard', 'Plomberie / ECS', 'action', 'A', 30, true, 'A3', NULL),
  ('77', 60, 'Résidence Sociale – CCAS', '69 bd Gambetta', 'Centre-Sud', 'Étiqueter le coffret de coupure gaz extérieur', 'Signalétique', 'action', 'A', 10, true, 'A6', 'Pas de main d''œuvre vendue au devis sur ce site'),
  ('78', 61, 'Résidence Sociale – CCAS', '69 bd Gambetta', 'Centre-Sud', 'Contrôler la pression de gonflage du (des) vase(s), reporter la date sur le livret', 'Contrôles chauffage', 'action', 'L', 20, false, 'VEN23', 'Fait par Ludovic lors de son passage. Pas de main d''œuvre vendue au devis sur ce site'),
  ('79', 62, 'Résidence Sociale – CCAS', '69 bd Gambetta', 'Centre-Sud', 'Repeindre la canalisation gaz (RAL 1023)', 'Peinture gaz RAL 1023', 'action', 'A', 45, true, 'A6', 'Pas de main d''œuvre vendue au devis sur ce site'),
  ('80', 63, 'Résidence Sociale – CCAS', '69 bd Gambetta', 'Centre-Sud', 'Reprendre les points de corrosion sur tuyauteries chauffage', 'Antirouille', 'action', 'A', 45, true, 'A6', 'Pas de main d''œuvre vendue au devis sur ce site'),
  ('80b', 64, 'Résidence Sociale – CCAS', '69 bd Gambetta', 'Centre-Sud', 'Remplacement de tuyauterie', 'Plomberie / ECS', 'action', 'A', 90, true, 'A6', 'Ajout depuis le devis. Longueurs relevées le 23/10 (R13)'),
  ('85', 65, 'Salle Rives Thomas', 'place des Rives Thomas', 'Centre-Sud', 'Étiqueter le coffret de coupure gaz extérieur', 'Signalétique', 'action', 'A', 10, true, 'A4', NULL),
  ('86', 66, 'Salle Rives Thomas', 'place des Rives Thomas', 'Centre-Sud', 'Contrôler la pression de gonflage du (des) vase(s), reporter la date sur le livret', 'Contrôles chauffage', 'action', 'A', 20, false, 'MER21', NULL),
  ('87', 67, 'Salle Rives Thomas', 'place des Rives Thomas', 'Centre-Sud', 'Traiter les nombreux points de rouille et corrosion', 'Antirouille', 'action', 'A', 90, true, 'A4', NULL),
  ('88', 68, 'Salle Rives Thomas', 'place des Rives Thomas', 'Centre-Sud', 'Contrôler le point de corrosion sur la chaudière de droite (bas du collecteur)', 'Contrôles chauffage', 'action', 'A', 30, false, 'MER21', 'Si une reprise est nécessaire : à programmer avec Antoine'),
  ('89', 69, 'Salle Rives Thomas', 'place des Rives Thomas', 'Centre-Sud', 'Pressostat manque d''eau : contrôler le point de déclenchement', 'Contrôles chauffage', 'action', 'A', 30, false, 'MER21', NULL),
  ('89b', 70, 'Salle Rives Thomas', 'place des Rives Thomas', 'Centre-Sud', 'Nettoyage des 4 grilles', 'Clim / ventilation', 'action', 'A', 40, false, 'MER21', 'Ajout depuis le devis'),
  ('96', 71, 'Site Accueil AVF', 'rue Aristide Briand', 'Nord-Est', 'Remplacer le groupe de sécurité du ballon ECS fuyard, y compris porte-filtre', 'Plomberie / ECS', 'action', 'L', 60, true, 'L7', NULL),
  ('96b', 72, 'Site Accueil AVF', 'rue Aristide Briand', 'Nord-Est', 'Mise en place d''une coupure pour l''unité extérieure', 'Électricité', 'action', 'L', 60, true, 'L7', 'Ajout depuis le devis'),
  ('97', 73, 'SICT', '119 av. Dom Vayssette', 'Centre-Sud', 'Repérer les coupures électriques extérieures', 'Signalétique', 'action', 'A', 15, true, 'A1', 'Voisin de l''Ancien centre de secours'),
  ('98', 74, 'Laborie (tribunes et vestiaires)', 'av. Guynemer', 'Nord-Est', 'Flécher le sens de circulation des fluides', 'Signalétique', 'action', 'L', 30, true, 'L3', NULL),
  ('99', 75, 'Laborie (tribunes et vestiaires)', 'av. Guynemer', 'Nord-Est', 'Coffret électrique : identifier les protections', 'Signalétique', 'action', 'L', 45, true, 'L3', NULL),
  ('100', 76, 'Laborie (tribunes et vestiaires)', 'av. Guynemer', 'Nord-Est', 'Extracteurs vestiaires : maintenance et repérage par pastille en faux plafond', 'Clim / ventilation', 'action', 'A', 60, true, 'A11', NULL),
  ('101', 77, 'Vestiaires Stade Saint-Roch', 'Saint-Roch', 'Centre-Sud', 'Contrôler l''extracteur VMC en faux plafond', 'Clim / ventilation', 'action', 'A', 45, false, 'A8', 'Le Musée des Beaux-Arts est voisin : même demi-journée'),
  ('102', 78, 'Club House Foot Longueville', 'av. Guynemer', 'Nord-Est', 'Flécher le sens de circulation des fluides', 'Signalétique', 'action', 'L', 30, true, 'L3', NULL),
  ('104', 79, 'Club House Foot Longueville', 'av. Guynemer', 'Nord-Est', 'Lavabo vestiaire : absence de pression côté eau chaude (diagnostic)', 'Plomberie / ECS', 'action', 'L', 45, false, 'JEU22', NULL),
  ('106', 80, 'Club House Foot Longueville', 'av. Guynemer', 'Nord-Est', 'Réparer les petites fuites de joints filasse', 'Plomberie / ECS', 'action', 'L', 60, false, 'JEU22', NULL),
  ('107', 81, 'Club House Foot Longueville', 'av. Guynemer', 'Nord-Est', 'Remplacer les soupapes qui se sont déclenchées', 'Plomberie / ECS', 'action', 'L', 60, true, 'L3', 'Référence relevée le 22/10 (R8)'),
  ('108', 82, 'Maison des Artistes', '2 impasse H. de Toulouse-Lautrec', 'Centre-Sud', 'Localiser l''extracteur en faux plafond, maintenance de l''extracteur et des bouches', 'Clim / ventilation', 'action', 'A', 90, false, 'A4', NULL),
  ('R1', 83, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Relevé pour commande : étiquettes, flèches, longueur conduite gaz, surfaces de rouille (36 à 39)', 'Relevé pour commande', 'releve', 'A', 15, false, 'MER21', NULL),
  ('R2', 84, 'Hôtel de Ville', '70 place d''Hautpoul', 'Centre-Sud', 'Relever la référence de la masse filtrante (40)', 'Relevé pour commande', 'releve', 'A', 5, false, 'MER21', NULL),
  ('R3', 85, 'Ancien CIO', '80 place d''Hautpoul', 'Centre-Sud', 'Relever les dimensions de la vitre du coffret gaz (7) et les quantités d''étiquettes / peinture (5, 6)', 'Relevé pour commande', 'releve', 'A', 15, false, 'MER21', NULL),
  ('R4', 86, 'Salle Rives Thomas', 'place des Rives Thomas', 'Centre-Sud', 'Relevé pour commande : étiquette coffret gaz, surfaces de rouille (85, 87)', 'Relevé pour commande', 'releve', 'A', 10, false, 'MER21', NULL),
  ('R5', 87, 'Musée Philadelphie', '2 place Philadelphie Thomas', 'Centre-Sud', 'Relever les dimensions de la tôle et la surface à brosser (67)', 'Relevé pour commande', 'releve', 'A', 10, false, 'MER21', 'Place voisine de la Salle Rives Thomas'),
  ('R6', 88, 'Maison Dom Vayssette', '2 rue Comte de Toulouse', 'Centre-Sud', 'Relever les références des filtres à remplacer (56)', 'Relevé pour commande', 'releve', 'A', 10, false, 'MER21', NULL),
  ('R7', 89, 'Gymnase Ossel', '50 av. Guynemer', 'Nord-Est', 'Relevé : longueurs cuivre et raccords (24, 27), étiquettes et peinture (19, 21, 22)', 'Relevé pour commande', 'releve', 'L', 20, false, 'JEU22', NULL),
  ('R8', 90, 'Club House Foot Longueville', 'av. Guynemer', 'Nord-Est', 'Relever la référence des soupapes (107) et les quantités de fléchage (102)', 'Relevé pour commande', 'releve', 'L', 10, false, 'JEU22', NULL),
  ('R9', 91, 'Château Pichery (MJC)', '10 av. Aspirant Buffet', 'Nord-Est', 'Relever les dimensions de la boîte Plexo (13) et les quantités étiquettes / rouille (8, 10, 11, 12)', 'Relevé pour commande', 'releve', 'L', 10, false, 'JEU22', NULL),
  ('R10', 92, 'Gymnase Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Relevé : étiquettes, fléchage, peinture gaz (32, 33, 34)', 'Relevé pour commande', 'releve', 'L', 10, false, 'JEU22', NULL),
  ('R11', 93, 'Piscine Pichery', 'av. Aspirant Buffet', 'Nord-Est', 'Vérifier l''écart photos / liste et relever rouille et fléchage (70, 73)', 'Relevé pour commande', 'releve', 'L', 15, false, 'VEN23', 'Photos et description non conformes à la liste – à vérifier sur place'),
  ('R12', 94, 'Gymnase Camus', 'av. Georges Spénale', 'Nord-Est', 'Relevé : tubes et raccords (17, 18), étiquettes (16)', 'Relevé pour commande', 'releve', 'L', 10, false, 'VEN23', NULL),
  ('R13', 95, 'Résidence Sociale – CCAS', '69 bd Gambetta', 'Centre-Sud', 'Relevé : étiquettes, peinture, rouille, tuyauterie à remplacer (77, 79, 80, 80b)', 'Relevé pour commande', 'releve', 'L', 15, false, 'VEN23', 'Site dans la zone d''Antoine, visité par Ludovic'),
  ('68', 96, 'Musée Philadelphie', '2 place Philadelphie Thomas', 'Centre-Sud', 'Absence de schéma de principe au mur', 'Hors périmètre', 'hors_perimetre', NULL, NULL, false, NULL, 'Hors sujet – à faire par le nouvel exploitant'),
  ('103', 97, 'Club House Foot Longueville', 'av. Guynemer', 'Nord-Est', 'Mettre en place un livret de chaufferie réglementaire', 'Hors périmètre', 'hors_perimetre', NULL, NULL, false, NULL, 'Hors devis Mayer Énergie – nous n''avons pas le livret d''installation et de suivi'),
  ('105', 98, 'Club House Foot Longueville', 'av. Guynemer', 'Nord-Est', 'Remplacer le thermomètre ballon cassé', 'Hors périmètre', 'hors_perimetre', NULL, NULL, false, NULL, 'Non prévu au devis – photos absentes du dossier')
) AS v(numero, ordre, site, adresse, zone, action, theme, type_ligne, tech, duree_min, achat_requis, planning_code, observations)
WHERE NOT EXISTS (SELECT 1 FROM majordhome.chantier_gaillac_taches);

-- ---------------------------------------------------------------------
-- Contrôles attendus après exécution :
--   SELECT count(*) FROM majordhome.chantier_gaillac_taches;   -- 98
--   SELECT count(*) FROM majordhome.chantier_gaillac_planning; -- 21
--   SELECT count(*) FROM majordhome.chantier_gaillac_taches
--    WHERE type_ligne <> 'hors_perimetre' AND technicien_id IS NULL;  -- 0
-- ---------------------------------------------------------------------

-- =====================================================================
-- NETTOYAGE en fin de chantier (NE PAS exécuter maintenant ; exporter le CSV avant)
-- DROP VIEW IF EXISTS public.majordhome_chantier_gaillac_taches;
-- DROP VIEW IF EXISTS public.majordhome_chantier_gaillac_planning;
-- DROP TABLE IF EXISTS majordhome.chantier_gaillac_taches;
-- DROP TABLE IF EXISTS majordhome.chantier_gaillac_planning;
-- DROP FUNCTION IF EXISTS majordhome.cg_taches_before_update();
-- DROP FUNCTION IF EXISTS majordhome.cg_is_member(uuid);
-- DROP FUNCTION IF EXISTS majordhome.cg_is_admin(uuid);
-- =====================================================================
