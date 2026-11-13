-- 20261113_4_suppliers_connecteur_admin.sql — la connexion, le site et l'accord d'un fournisseur sont réservés à
-- l'org_admin de son organisation.
-- Spec : docs/superpowers/specs/2026-11-12-base-pieces-catalogues-marchands-design.md (relecture finale, correctif A1).
--
-- Constat (production) : les policies `suppliers_insert` / `suppliers_update` de majordhome.suppliers valent « tout
-- membre » et `authenticated` a UPDATE sur la vue majordhome_suppliers_write. Depuis le mode « boutique publique »
-- (aucun identifiant au Vault), n'importe quel membre pouvait poser par PostgREST `site_url`,
-- `connector_config.public` / `.catalogue_pieces` / `.accord` et `auto_sync`, et faire relever un site par le cron :
-- la barrière d'accord du marchand ne tenait que par l'interface.
--
-- Trigger BEFORE INSERT OR UPDATE sur majordhome.suppliers. Il ne contraint QUE les écritures faites sous le rôle
-- `authenticated` (current_user, la fonction du trigger est SECURITY INVOKER) : `service_role` (edges) et les
-- fonctions SECURITY DEFINER (supplier_catalog_upsert, supplier_pieces_upsert, supplier_catalog_apply_mapping…, qui
-- s'exécutent sous leur propriétaire) passent sans changement. `anon` n'a aucun privilège sur majordhome.*.
-- Pour un appelant `authenticated` qui n'est PAS org_admin de l'org du fournisseur (`suppliers.org_id` = org CORE,
-- même définition que org_secret_set : core.organization_members.role = 'org_admin'), refus
-- `connecteur_admin_requis` (42501) de toute modification de :
--   - connector ; auto_sync ;
--   - site_url quand l'ancien OU le nouveau connector n'est pas NULL ;
--   - connector_config -> 'public' / 'catalogue_pieces' / 'accord' (IS DISTINCT FROM clé par clé).
-- À l'INSERT : refus si connector non NULL, auto_sync vrai, public ou catalogue_pieces à true, ou accord présent.
-- Le reste de la fiche (nom, coordonnées, notes, connector_config.pieces.remise_pct, autres clés…) reste modifiable
-- par les mêmes personnes qu'avant : un enregistrement qui ne change AUCUNE valeur gardée passe, même si le front
-- réécrit connector_config en entier. Garde POSITIVE (`IF (autorisé) IS NOT TRUE`), auth.uid() NULL traité.
-- Le jeton `connecteur_admin_requis` est lu par l'écran (message français) : ne pas le renommer.
-- Répétée sur scripts/migration-rehearsal/ (assert-suppliers-connecteur-admin.sql, chaîne 20261113_1 + _2 + _3 + _4).
--
-- Retour arrière :
--   DROP TRIGGER IF EXISTS suppliers_connecteur_admin ON majordhome.suppliers;
--   DROP FUNCTION IF EXISTS majordhome.suppliers_connecteur_admin();

CREATE OR REPLACE FUNCTION majordhome.suppliers_connecteur_admin() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = majordhome, core, public
AS $$
DECLARE
  v_cfg_old jsonb;
  v_cfg_new jsonb;
  v_touche boolean;
  v_admin boolean;
BEGIN
  -- Seules les écritures directes d'un utilisateur connecté sont contraintes (service_role, propriétaire des
  -- fonctions SECURITY DEFINER : inchangés).
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_cfg_new := CASE WHEN jsonb_typeof(NEW.connector_config) = 'object' THEN NEW.connector_config ELSE '{}'::jsonb END;

  IF TG_OP = 'INSERT' THEN
    v_touche := NEW.connector IS NOT NULL
             OR NEW.auto_sync IS TRUE
             OR COALESCE(v_cfg_new -> 'public' = 'true'::jsonb, false)
             OR COALESCE(v_cfg_new -> 'catalogue_pieces' = 'true'::jsonb, false)
             OR COALESCE(jsonb_typeof(v_cfg_new -> 'accord'), 'null') <> 'null';
  ELSE
    v_cfg_old := CASE WHEN jsonb_typeof(OLD.connector_config) = 'object' THEN OLD.connector_config ELSE '{}'::jsonb END;
    v_touche := NEW.connector IS DISTINCT FROM OLD.connector
             OR NEW.auto_sync IS DISTINCT FROM OLD.auto_sync
             OR ((OLD.connector IS NOT NULL OR NEW.connector IS NOT NULL) AND NEW.site_url IS DISTINCT FROM OLD.site_url)
             OR (v_cfg_new -> 'public') IS DISTINCT FROM (v_cfg_old -> 'public')
             OR (v_cfg_new -> 'catalogue_pieces') IS DISTINCT FROM (v_cfg_old -> 'catalogue_pieces')
             OR (v_cfg_new -> 'accord') IS DISTINCT FROM (v_cfg_old -> 'accord');
  END IF;

  IF v_touche IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Une valeur gardée change : l'appelant doit être org_admin de l'org du fournisseur (ancienne ET nouvelle org).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'connecteur_admin_requis' USING ERRCODE = '42501';
  END IF;
  v_admin := EXISTS (SELECT 1 FROM core.organization_members om
                     WHERE om.user_id = auth.uid() AND om.org_id = NEW.org_id AND om.role = 'org_admin')
         AND (TG_OP = 'INSERT'
              OR EXISTS (SELECT 1 FROM core.organization_members om
                         WHERE om.user_id = auth.uid() AND om.org_id = OLD.org_id AND om.role = 'org_admin'));
  IF v_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'connecteur_admin_requis' USING ERRCODE = '42501',
      HINT = 'Seul un administrateur de l''organisation règle la connexion, le site et l''accord d''un fournisseur.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.suppliers_connecteur_admin() FROM PUBLIC, anon;
COMMENT ON FUNCTION majordhome.suppliers_connecteur_admin() IS
  'Trigger : sous authenticated, connector / auto_sync / site_url (avec connecteur) / connector_config.public, .catalogue_pieces, .accord réservés à l''org_admin (connecteur_admin_requis).';

DROP TRIGGER IF EXISTS suppliers_connecteur_admin ON majordhome.suppliers;
CREATE TRIGGER suppliers_connecteur_admin
  BEFORE INSERT OR UPDATE ON majordhome.suppliers
  FOR EACH ROW EXECUTE FUNCTION majordhome.suppliers_connecteur_admin();
