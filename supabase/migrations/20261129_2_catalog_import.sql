-- 20261129_2 — Import d'une base d'articles depuis un fichier : table des imports, écriture par lots, écrivain étendu.
--
-- Une entreprise qui arrive sur Majord'home dépose le fichier d'articles de son ancien logiciel ; l'écran le lit
-- (modules purs `src/lib/importArticles/`) puis envoie les articles par lots à `catalog_items_import_batch`.
-- Spec : docs/superpowers/specs/2026-11-28-import-articles-fichier-design.md (§ 6.2, 6.3, 7).
--
-- 1. `majordhome.catalog_imports` (calquée sur client_imports) : un import par ligne, lu par un org_admin de l'org,
--    écrit seulement par les RPC. `fournisseurs_crees` = fournisseurs créés à l'ouverture (jamais supprimés au retrait).
-- 2. `catalog_items.import_id` / `import_line` : (import_id, import_line) est unique — un lot renvoyé ne recrée rien.
--    La vue `majordhome_catalog_items` n'est PAS modifiée (droits par colonne de 20261028_4 intacts ; `authenticated`
--    n'a aucun droit UPDATE sur les nouvelles colonnes).
-- 3. `supplier_catalog_upsert` (écrivain unique) recréée depuis la définition de PRODUCTION (lue le 2026-11-28, égale
--    à 20261111_2) avec deux clés FACULTATIVES, sans effet quand elles manquent (les relevés ne changent pas) :
--      - ligne `catalog_item_id` : posée À L'INSERTION SEULEMENT, si l'article est de la même org, actif et non
--        fusionné ; la ligne naît alors rattachée (`catalog_item_link_source = 'import'`), donc `catalog_items_ensure`
--        (appelé en fin d'upsert, qui ne traite que les lignes sans article) ne la voit jamais et ne crée pas de second
--        article. Une ligne qui existe déjà garde son article (la clé est ignorée à la mise à jour). Un article
--        inconnu, d'une autre org ou fusionné est ignoré : la ligne suit alors le chemin d'un relevé (ensure).
--      - `p_meta.prix_sans_date` : si vraie, une `purchase_price_at` absente reste NULL À L'INSERTION au lieu de now()
--        (« date inconnue », décision d'Eric 2026-11-28, option B). La mise à jour d'une ligne existante garde la
--        règle d'avant (date absente ⇒ now()) : le relevé suivant date la ligne importée.
--    CHECK `supplier_products_catalog_item_link_source_check` : ajout de `import`.
-- 4. RPC `catalog_items_import_start` / `_batch` / `_finish` (SECURITY DEFINER, org_admin ACTIF, même condition que
--    update_member_role) ; l'organisation de batch / finish est dérivée de l'IMPORT ; aucune clé `org_id` d'une ligne
--    n'est lue (liste FERMÉE). Le retrait (`_removal_preview`, `_remove`) viendra dans une migration à part.
--
-- `catalog_items_import_batch` : 1 à 500 lignes (l'écran en envoie 200), tout ou rien. Par ligne : les règles de
-- `verifierLigneArticle` (src/lib/importArticles/lots.js, miroir à tenir aligné), puis rejeu ⇒ `skipped`, puis
-- référence interne déjà prise (`code_pris`), puis pour une ligne avec fournisseur : fournisseur de l'org
-- (`supplier_not_in_org`) et (fournisseur, référence) absente de la base, active ou non (`ligne_fournisseur_existante`,
-- la ligne existante n'est jamais envoyée à l'écrivain). Article créé `origin = 'manuel'`, `specs.canonical` =
-- { modele_import, ancien_numero } non vides. Puis UN appel à `supplier_catalog_upsert` par fournisseur du lot,
-- `source_version = 'import-articles_<import_id>'` (la ligne entre dans l'index unique des lignes relevées : le relevé
-- suivant la met à jour EN PLACE), `desactiver_absents = false`, `prix_sans_date = true`. Contrôlé après coup : autant
-- de lignes insérées que de lignes envoyées, chacune rattachée à son article — sinon tout est annulé.
-- Une ligne fournisseur d'un article de nature `stock` ou `main_oeuvre` prend la nature `main` (le CHECK de
-- supplier_products ne connaît que main / accessory / consumable) ; l'article garde la sienne.
-- Effet de bord connu (comme l'import d'offre) : l'écrivain remplace `suppliers.catalog_sync_result` du fournisseur
-- par le bilan du lot (« dernier relevé » affiché sur la fiche fournisseur).
--
-- Mesuré sur le harnais le 2026-11-28 (assert-catalog-import.sql, chaîne 20261028_4 → 20261124_2 → 20261129_2,
-- déclencheurs `recherche` actifs, index de production recréés, 27 000 articles et 31 000 lignes fournisseur dans
-- l'org) : lot de 200 lignes dont 100 avec fournisseur 141 à 212 ms, rejeu du même lot 4 à 10 ms. Plafond PostgREST :
-- 8 s ; cible : < 2 s — les lots de 200 de l'écran (`decouperEnLots`, importClients/lots.js) tiennent la marge.
--
-- Codes d'erreur (message de l'exception, traduits par `messageErreurImportArticles`) : `unauthenticated` et
-- `org_admin_required` (42501), `import_not_found` (P0002), `import_closed` (55000), `rows_invalid` (22023 : forme du
-- lot ou de la liste des fournisseurs), `row_invalid` (22023, DETAIL « ligne N : colonne »), `code_pris` (23505,
-- DETAIL « ligne N »), `ligne_fournisseur_existante` (23505, DETAIL « ligne N »), `supplier_not_in_org` (42501),
-- `file_name_required` (22023), `rattachement_incomplet` (P0001, ne doit jamais arriver).
--
-- Retour arrière : DROP des trois RPC et des fonctions catalog_import_*, DROP VIEW majordhome_catalog_imports,
-- ALTER TABLE catalog_items DROP COLUMN import_id, import_line ; DROP TABLE catalog_imports ; recréer
-- supplier_catalog_upsert depuis 20261111_2 ; remettre le CHECK sans `import` (après avoir requalifié les lignes).

-- Base partagée : la pose de colonnes sur catalog_items demande un verrou exclusif ; échouer et rejouer plutôt que
-- faire attendre toutes les requêtes de l'instance.
SET lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. Table des imports
-- ----------------------------------------------------------------------------
CREATE TABLE majordhome.catalog_imports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES core.organizations(id),
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  file_name          text NOT NULL,
  mapping            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(mapping) IN ('object', 'array')),
  counts             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  status             text NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours', 'termine', 'retire')),
  fournisseurs_crees uuid[] NOT NULL DEFAULT '{}',
  removed_at         timestamptz,
  removed_by         uuid
);

COMMENT ON TABLE majordhome.catalog_imports IS
  'Un import de fichier d''articles (autre logiciel). Écrit seulement par les RPC catalog_items_import_* ; lu par un org_admin de l''organisation.';
COMMENT ON COLUMN majordhome.catalog_imports.mapping IS 'Correspondance des colonnes et des valeurs du fichier, telle que validée à l''écran.';
COMMENT ON COLUMN majordhome.catalog_imports.counts IS 'Bilan de l''import (lues, importées, doublons, écartées…), écrit au départ puis à la fin.';
COMMENT ON COLUMN majordhome.catalog_imports.status IS 'en_cours → termine (catalog_items_import_finish) ; retire quand tous les articles retirables ont été supprimés.';
COMMENT ON COLUMN majordhome.catalog_imports.fournisseurs_crees IS 'Fournisseurs créés à l''ouverture de l''import (jamais supprimés par un retrait).';

CREATE INDEX catalog_imports_org_created_idx ON majordhome.catalog_imports (org_id, created_at DESC);

ALTER TABLE majordhome.catalog_imports ENABLE ROW LEVEL SECURITY;

-- Lecture : administrateur ACTIF de l'organisation. Aucune policy d'écriture : les RPC sont les seules à écrire.
CREATE POLICY catalog_imports_select_org_admin ON majordhome.catalog_imports
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM core.organization_members m
     WHERE m.org_id = catalog_imports.org_id
       AND m.user_id = auth.uid()
       AND m.status = 'active'
       AND m.role = 'org_admin'
  ));

-- Le schéma majordhome accorde arwd à authenticated par défaut : on ne garde que la lecture (la vue en a besoin).
REVOKE ALL ON majordhome.catalog_imports FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON majordhome.catalog_imports FROM authenticated;
GRANT SELECT ON majordhome.catalog_imports TO authenticated;
GRANT SELECT ON majordhome.catalog_imports TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Colonnes de majordhome.catalog_items (la vue majordhome_catalog_items n'est pas touchée)
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.catalog_items
  ADD COLUMN import_id   uuid REFERENCES majordhome.catalog_imports(id) ON DELETE SET NULL,
  ADD COLUMN import_line integer;

COMMENT ON COLUMN majordhome.catalog_items.import_id IS 'Import de fichier qui a créé l''article (NULL pour un article saisi ou relevé). Écrit seulement par catalog_items_import_batch.';
COMMENT ON COLUMN majordhome.catalog_items.import_line IS 'Numéro de la ligne dans le fichier importé : (import_id, import_line) est unique, un lot renvoyé ne recrée rien.';

CREATE UNIQUE INDEX catalog_items_import_line_key ON majordhome.catalog_items (import_id, import_line) WHERE import_id IS NOT NULL;

-- Vue des imports (écran « Imports »). Nom de l'auteur par sous-requête sur core.profiles (security_invoker : la RLS
-- de profiles et de catalog_imports s'applique au lecteur).
CREATE VIEW public.majordhome_catalog_imports WITH (security_invoker = true) AS
 SELECT i.id, i.org_id, i.created_by,
        (SELECT p.full_name FROM core.profiles p WHERE p.id = i.created_by) AS created_by_name,
        i.created_at, i.file_name, i.counts, i.status, i.removed_at
   FROM majordhome.catalog_imports i;

REVOKE ALL ON public.majordhome_catalog_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_catalog_imports TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Lien posé par l'import + écrivain unique étendu
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.supplier_products DROP CONSTRAINT supplier_products_catalog_item_link_source_check;
ALTER TABLE majordhome.supplier_products ADD CONSTRAINT supplier_products_catalog_item_link_source_check
  CHECK (catalog_item_link_source IS NULL OR catalog_item_link_source = ANY (ARRAY['auto', 'cle', 'ean', 'ia', 'manuel', 'import']));

-- Définition de production (= 20261111_2) ; changements marqués « 20261129_2 ».
CREATE OR REPLACE FUNCTION public.supplier_catalog_upsert(p_org_id uuid, p_supplier_id uuid, p_source_version text, p_rows jsonb, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_des int := 0;
  v_ign int := 0;
  v_total int := 0;
  v_res jsonb;
  v_art jsonb;
  v_desactiver boolean := COALESCE((p_meta ->> 'desactiver_absents')::boolean, true);
  -- 20261129_2 : import d'articles — une date absente reste NULL à l'insertion (« date inconnue »)
  v_sans_date boolean := COALESCE((p_meta ->> 'prix_sans_date')::boolean, false);
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows_empty' USING ERRCODE = '22023';
  END IF;
  IF p_org_id IS NULL OR p_supplier_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM majordhome.suppliers s WHERE s.id = p_supplier_id AND s.org_id = p_org_id) THEN
    RAISE EXCEPTION 'supplier_not_in_org' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('pg_temp.t_imp') IS NOT NULL THEN DROP TABLE pg_temp.t_imp; END IF;
  CREATE TEMP TABLE t_imp ON COMMIT DROP AS
    SELECT r.reference, r.name, r.brand, r.gamme, r.product_kind, r.purchase_price_ht, r.selling_price_ht_defaut,
           r.default_tva_rate, r.unit, r.category,
           COALESCE(r.specs, '{}'::jsonb)
             || CASE WHEN r.category IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('categorie_releve', r.category) END AS specs,
           r.image_url, r.image_source_url, r.model_key,
           -- date du prix : fournie par l'appelant (import d'achats : date de la facture), sinon le relevé = maintenant
           COALESCE(r.purchase_price_at, now()) AS purchase_price_at,
           -- prix public et taux de remise = faits fournisseur (« Prix de base » Soditelem), rafraîchis à chaque relevé
           r.tarif_public, r.taux_remise,
           -- 20261129_2 : date telle que fournie (NULL si absente) et article à rattacher à l'insertion
           r.purchase_price_at AS purchase_price_at_fourni,
           r.catalog_item_id
    FROM jsonb_to_recordset(p_rows) AS r(
      reference text, name text, brand text, gamme text, product_kind text, purchase_price_ht numeric,
      selling_price_ht_defaut numeric, default_tva_rate numeric, unit text, category text, specs jsonb,
      image_url text, image_source_url text, model_key text, purchase_price_at timestamptz,
      tarif_public numeric, taux_remise numeric, catalog_item_id uuid);

  IF EXISTS (SELECT 1 FROM t_imp WHERE reference IS NULL OR reference = '' OR name IS NULL OR name = '' OR purchase_price_ht IS NULL) THEN
    RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) - count(DISTINCT reference) FROM t_imp) > 0 THEN
    RAISE EXCEPTION 'reference_en_double' USING ERRCODE = '22023';
  END IF;

  UPDATE majordhome.supplier_products p SET
    purchase_price_ht = t.purchase_price_ht,
    purchase_price_at = t.purchase_price_at,
    tarif_public = COALESCE(t.tarif_public, p.tarif_public),
    taux_remise = COALESCE(t.taux_remise, p.taux_remise),
    selling_price_ht = CASE WHEN p.selling_price_ht = 0 AND COALESCE(t.selling_price_ht_defaut, 0) > 0
                            THEN t.selling_price_ht_defaut ELSE p.selling_price_ht END,
    default_tva_rate = COALESCE(t.default_tva_rate, p.default_tva_rate),
    unit = COALESCE(t.unit, p.unit),
    image_url = COALESCE(p.image_url, t.image_url),
    image_source_url = CASE WHEN p.image_url IS NULL THEN COALESCE(t.image_source_url, p.image_source_url) ELSE p.image_source_url END,
    model_key = CASE WHEN p.model_key_source = 'manuel' THEN p.model_key
                     WHEN t.model_key IS NOT NULL THEN t.model_key
                     WHEN p.model_key_source = 'ia' THEN p.model_key
                     ELSE NULL END,
    model_key_source = CASE WHEN p.model_key_source = 'manuel' THEN 'manuel'
                            WHEN t.model_key IS NOT NULL THEN 'cle'
                            WHEN p.model_key_source = 'ia' THEN 'ia'
                            ELSE NULL END,
    specs = (COALESCE(p.specs, '{}'::jsonb) || t.specs
             || jsonb_build_object('canonical', COALESCE(p.specs -> 'canonical', '{}'::jsonb) || COALESCE(t.specs -> 'canonical', '{}'::jsonb))
            ) - 'desactive_par_releve',
    is_active = CASE WHEN p.is_active THEN true
                     WHEN (p.specs ->> 'desactive_par_releve')::boolean IS TRUE THEN true
                     ELSE false END,
    updated_at = now()
  FROM t_imp t
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference;
  GET DIAGNOSTICS v_upd = ROW_COUNT;

  SELECT count(*) INTO v_ign FROM majordhome.supplier_products p JOIN t_imp t ON t.reference = p.reference
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND NOT p.is_active;

  INSERT INTO majordhome.supplier_products
    (supplier_id, org_id, reference, name, category, gamme, brand, purchase_price_ht, purchase_price_at, selling_price_ht,
     default_tva_rate, unit, specs, product_kind, is_active, image_url, image_source_url, model_key, model_key_source,
     tarif_public, taux_remise,
     catalog_item_id, catalog_item_link_source, catalog_item_linked_at)
  SELECT p_supplier_id, p_org_id, t.reference, t.name, t.category, t.gamme, t.brand, t.purchase_price_ht,
         -- 20261129_2 : prix_sans_date ⇒ la date fournie, NULL comprise
         CASE WHEN v_sans_date THEN t.purchase_price_at_fourni ELSE t.purchase_price_at END,
         COALESCE(t.selling_price_ht_defaut, 0), COALESCE(t.default_tva_rate, 20), COALESCE(t.unit, 'pièce'),
         t.specs, COALESCE(t.product_kind, 'main'), true, t.image_url, t.image_source_url, t.model_key,
         CASE WHEN t.model_key IS NOT NULL THEN 'cle' ELSE NULL END,
         t.tarif_public, COALESCE(t.taux_remise, 0),
         -- 20261129_2 : article fourni par l'appelant, seulement s'il est de la même org, actif et non fusionné
         ci.id, CASE WHEN ci.id IS NOT NULL THEN 'import' END, CASE WHEN ci.id IS NOT NULL THEN now() END
  FROM t_imp t
  LEFT JOIN LATERAL (SELECT i.id FROM majordhome.catalog_items i
                      WHERE i.id = t.catalog_item_id AND i.org_id = p_org_id AND i.is_active AND i.merged_into IS NULL) ci ON true
  WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p
                    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  IF v_desactiver THEN
    UPDATE majordhome.supplier_products p
    SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_releve": true}'::jsonb, updated_at = now()
    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active
      -- 20261111_2 : un relevé du tarif ne désactive jamais les pièces détachées (écrites par supplier_pieces_upsert)
      AND p.category IS DISTINCT FROM 'piece_detachee'
      AND NOT EXISTS (SELECT 1 FROM t_imp t WHERE t.reference = p.reference);
    GET DIAGNOSTICS v_des = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_total FROM majordhome.supplier_products p
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active;

  -- Articles Majord'home : chaque ligne active sans article en reçoit un (rattachement franc ou création).
  v_art := public.catalog_items_ensure(p_org_id);

  v_res := jsonb_build_object('ok', true, 'at', now(), 'version', p_source_version,
                              'inseres', v_ins, 'mis_a_jour', v_upd - v_ign, 'desactives', v_des,
                              'ignores_inactifs', v_ign, 'total', v_total,
                              'categories_vues', COALESCE(p_meta -> 'categories_vues', '[]'::jsonb),
                              'desactiver_absents', v_desactiver,
                              'articles', v_art);
  UPDATE majordhome.suppliers SET catalog_sync_at = now(), catalog_sync_result = v_res, catalog_sync_error = NULL, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Fonctions internes (jamais appelables par PUBLIC, anon, authenticated)
-- ----------------------------------------------------------------------------

-- L'appelant est administrateur ACTIF de l'organisation (même condition que update_member_role, 20261121_3).
CREATE FUNCTION majordhome.catalog_import_admin_de(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM core.organization_members
     WHERE org_id = p_org_id AND user_id = auth.uid() AND status = 'active' AND role = 'org_admin'
  ) INTO v_admin;
  IF v_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Rend l'organisation de l'import si l'appelant en est administrateur actif ; lève sinon.
CREATE FUNCTION majordhome.catalog_import_org_admin(p_import_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT org_id INTO v_org FROM majordhome.catalog_imports WHERE id = p_import_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM majordhome.catalog_import_admin_de(v_org);
  RETURN v_org;
END;
$$;

-- Texte d'une clé : chaîne ou nombre, espaces de bord retirés, vide ⇒ NULL ; tout autre type est refusé
-- (`row_invalid`, DETAIL « ligne N : <p_colonne> »).
CREATE FUNCTION majordhome.catalog_import_texte(p_obj jsonb, p_cle text, p_ligne integer, p_colonne text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_type text := jsonb_typeof(p_obj -> p_cle);
BEGIN
  IF v_type IS NULL OR v_type = 'null' THEN
    RETURN NULL;
  END IF;
  IF v_type IN ('string', 'number') THEN
    RETURN NULLIF(btrim(p_obj ->> p_cle), '');
  END IF;
  RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : %s', p_ligne, p_colonne);
END;
$$;

-- Nombre JSON (jamais une chaîne), ou NULL si la clé est absente / null ; tout autre type est refusé.
CREATE FUNCTION majordhome.catalog_import_nombre(p_obj jsonb, p_cle text, p_ligne integer, p_colonne text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_type text := jsonb_typeof(p_obj -> p_cle);
BEGIN
  IF v_type IS NULL OR v_type = 'null' THEN
    RETURN NULL;
  END IF;
  IF v_type = 'number' THEN
    RETURN (p_obj ->> p_cle)::numeric;
  END IF;
  RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : %s', p_ligne, p_colonne);
END;
$$;

-- Date réelle au format aaaa-mm-jj (« 2026-02-30 » est refusée, jamais reportée au mois suivant).
CREATE FUNCTION majordhome.catalog_import_date_valide(p_texte text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = majordhome, public, pg_temp
AS $$
BEGIN
  IF (p_texte ~ '^\d{4}-\d{2}-\d{2}$') IS NOT TRUE THEN
    RETURN false;
  END IF;
  RETURN to_char(p_texte::date, 'YYYY-MM-DD') = p_texte;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION majordhome.catalog_import_date_valide(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION majordhome.catalog_import_admin_de(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION majordhome.catalog_import_org_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION majordhome.catalog_import_texte(jsonb, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION majordhome.catalog_import_nombre(jsonb, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RPC publiques
-- ----------------------------------------------------------------------------

-- Ouvre un import et résout ses fournisseurs. `p_fournisseurs = [{ nom, supplier_id | null }]` : un supplier_id doit
-- être un fournisseur de l'org ; null crée le fournisseur (nom tel qu'écrit dans le fichier, actif). Un fournisseur
-- qui porte déjà exactement ce nom dans l'org (contrainte unique org × nom) est repris, `cree = false`.
-- Rend { import_id, fournisseurs: [{ nom, supplier_id, cree }] } dans l'ordre reçu.
CREATE FUNCTION public.catalog_items_import_start(
  p_org_id uuid, p_file_name text, p_mapping jsonb, p_counts jsonb, p_fournisseurs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_file   text;
  v_id     uuid;
  v_four   jsonb := coalesce(p_fournisseurs, '[]'::jsonb);
  v_elem   jsonb;
  v_n      integer;
  v_nom    text;
  v_sid    uuid;
  v_cree   boolean;
  v_crees  uuid[] := '{}';
  v_sortie jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM majordhome.catalog_import_admin_de(p_org_id);

  v_file := left(btrim(coalesce(p_file_name, '')), 255);
  IF v_file = '' THEN
    RAISE EXCEPTION 'file_name_required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_four) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = 'fournisseurs : un tableau est attendu';
  END IF;

  INSERT INTO majordhome.catalog_imports (org_id, created_by, file_name, mapping, counts)
  VALUES (p_org_id, v_uid, v_file,
          CASE WHEN jsonb_typeof(p_mapping) IN ('object', 'array') THEN p_mapping ELSE '{}'::jsonb END,
          CASE WHEN jsonb_typeof(p_counts) = 'object' THEN p_counts ELSE '{}'::jsonb END)
  RETURNING id INTO v_id;

  FOR v_elem, v_n IN SELECT e.value, e.ordinality::integer FROM jsonb_array_elements(v_four) WITH ORDINALITY AS e LOOP
    IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' OR jsonb_typeof(v_elem -> 'nom') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = format('fournisseur %s', v_n);
    END IF;
    v_nom := left(btrim(v_elem ->> 'nom'), 255);
    v_cree := false;

    IF jsonb_typeof(v_elem -> 'supplier_id') IS NOT NULL AND jsonb_typeof(v_elem -> 'supplier_id') <> 'null' THEN
      -- Fournisseur existant : de l'organisation de l'import, jamais d'une autre
      IF jsonb_typeof(v_elem -> 'supplier_id') <> 'string'
         OR ((v_elem ->> 'supplier_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE THEN
        RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = format('fournisseur %s', v_n);
      END IF;
      SELECT s.id INTO v_sid FROM majordhome.suppliers s WHERE s.id = (v_elem ->> 'supplier_id')::uuid AND s.org_id = p_org_id;
      IF v_sid IS NULL THEN
        RAISE EXCEPTION 'supplier_not_in_org' USING ERRCODE = '42501', DETAIL = format('fournisseur %s', v_n);
      END IF;
    ELSE
      IF v_nom = '' THEN
        RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = format('fournisseur %s : nom', v_n);
      END IF;
      v_sid := NULL;
      INSERT INTO majordhome.suppliers (org_id, name, is_active)
      VALUES (p_org_id, v_nom, true)
      ON CONFLICT (org_id, name) DO NOTHING
      RETURNING id INTO v_sid;
      IF v_sid IS NOT NULL THEN
        v_cree := true;
        v_crees := v_crees || v_sid;
      ELSE
        SELECT s.id INTO v_sid FROM majordhome.suppliers s WHERE s.org_id = p_org_id AND s.name = v_nom;
      END IF;
    END IF;

    v_sortie := v_sortie || jsonb_build_array(jsonb_build_object('nom', v_elem ->> 'nom', 'supplier_id', v_sid, 'cree', v_cree));
  END LOOP;

  UPDATE majordhome.catalog_imports SET fournisseurs_crees = v_crees WHERE id = v_id AND org_id = p_org_id;
  RETURN jsonb_build_object('import_id', v_id, 'fournisseurs', v_sortie);
END;
$$;

-- Écrit un lot de 1 à 500 articles (et leurs lignes fournisseur), tout ou rien. Une ligne déjà écrite pour
-- (import, import_line) est comptée « skipped ». Rend { created, skipped, lignes_fournisseur }.
CREATE FUNCTION public.catalog_items_import_batch(p_import_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_org      uuid;
  v_status   text;
  v_version  text;
  v_row      jsonb;
  v_four     jsonb;
  v_line     integer;
  v_name     text;
  v_kind     text;
  v_tva      numeric;
  v_prix     numeric;
  v_ean      text;
  v_code     text;
  v_sid      uuid;
  v_ref      text;
  v_achat    numeric;
  v_public   numeric;
  v_date     text;
  v_item     uuid;
  v_lignes   jsonb := '{}'::jsonb;
  v_cle      text;
  v_envoi    jsonb;
  v_res      jsonb;
  v_n        integer;
  v_created  integer := 0;
  v_skipped  integer := 0;
  v_fourn    integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.catalog_import_org_admin(p_import_id);

  -- Verrou : un lot à la fois par import, et ni clôture ni retrait pendant l'écriture.
  SELECT status INTO v_status FROM majordhome.catalog_imports WHERE id = p_import_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'en_cours' THEN
    RAISE EXCEPTION 'import_closed' USING ERRCODE = '55000';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023';
  END IF;
  IF (jsonb_array_length(p_rows) BETWEEN 1 AND 500) IS NOT TRUE THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = format('%s lignes (1 à 500)', jsonb_array_length(p_rows));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS e(v) WHERE jsonb_typeof(e.v) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = 'élément qui n''est pas un objet';
  END IF;
  -- Jamais deux fois le même numéro de ligne (la seconde passerait pour un rejeu de la première et disparaîtrait)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS e(v)
              WHERE jsonb_typeof(e.v -> 'import_line') IS NOT NULL AND jsonb_typeof(e.v -> 'import_line') <> 'null'
              GROUP BY e.v -> 'import_line' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = 'numéro de ligne en double dans le lot';
  END IF;
  -- Jamais deux fois la même ligne fournisseur dans le lot (l'écrivain la refuserait en « reference_en_double »)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS e(v)
              WHERE jsonb_typeof(e.v -> 'fournisseur') = 'object'
              GROUP BY e.v -> 'fournisseur' ->> 'supplier_id', btrim(e.v -> 'fournisseur' ->> 'reference') HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'rows_invalid' USING ERRCODE = '22023', DETAIL = 'ligne fournisseur en double dans le lot';
  END IF;

  v_version := 'import-articles_' || p_import_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP

    -- Contrôles de verifierLigneArticle (src/lib/importArticles/lots.js), dans le même ordre.
    IF jsonb_typeof(v_row -> 'import_line') IS DISTINCT FROM 'number'
       OR ((v_row ->> 'import_line') ~ '^[1-9][0-9]{0,8}$') IS NOT TRUE THEN
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = 'import_line';
    END IF;
    v_line := (v_row ->> 'import_line')::integer;

    IF jsonb_typeof(v_row -> 'name') IS DISTINCT FROM 'string' OR btrim(v_row ->> 'name') = '' THEN
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : name', v_line);
    END IF;
    v_name := btrim(v_row ->> 'name');

    IF jsonb_typeof(v_row -> 'product_kind') IS DISTINCT FROM 'string'
       OR ((v_row ->> 'product_kind') = ANY (ARRAY['main', 'accessory', 'stock', 'main_oeuvre'])) IS NOT TRUE THEN
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : product_kind', v_line);
    END IF;
    v_kind := v_row ->> 'product_kind';

    IF jsonb_typeof(v_row -> 'default_tva_rate') IS DISTINCT FROM 'number'
       OR ((v_row ->> 'default_tva_rate')::numeric = ANY (ARRAY[0, 5.5, 10, 20]::numeric[])) IS NOT TRUE THEN
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : default_tva_rate', v_line);
    END IF;
    v_tva := (v_row ->> 'default_tva_rate')::numeric;

    -- Prix de vente : nombre ≥ 0, sous 100 millions (numeric(10,2) de la ligne fournisseur)
    IF jsonb_typeof(v_row -> 'selling_price_ht') IS DISTINCT FROM 'number'
       OR ((v_row ->> 'selling_price_ht')::numeric >= 0 AND (v_row ->> 'selling_price_ht')::numeric < 100000000) IS NOT TRUE THEN
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : selling_price_ht', v_line);
    END IF;
    v_prix := (v_row ->> 'selling_price_ht')::numeric;

    IF jsonb_typeof(v_row -> 'code_ean') IS NULL OR jsonb_typeof(v_row -> 'code_ean') = 'null' THEN
      v_ean := NULL;
    ELSIF jsonb_typeof(v_row -> 'code_ean') = 'string' AND (v_row ->> 'code_ean') ~ '^[0-9]{8,14}$' THEN
      v_ean := v_row ->> 'code_ean';
    ELSE
      RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : code_ean', v_line);
    END IF;

    v_four := v_row -> 'fournisseur';
    IF v_four IS NULL OR jsonb_typeof(v_four) = 'null' THEN
      v_four := NULL;
    ELSE
      IF jsonb_typeof(v_four) <> 'object'
         OR jsonb_typeof(v_four -> 'supplier_id') IS DISTINCT FROM 'string'
         OR ((v_four ->> 'supplier_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE
         OR jsonb_typeof(v_four -> 'reference') IS DISTINCT FROM 'string' OR btrim(v_four ->> 'reference') = ''
         OR jsonb_typeof(v_four -> 'purchase_price_ht') IS DISTINCT FROM 'number'
         OR ((v_four ->> 'purchase_price_ht')::numeric >= 0.005 AND (v_four ->> 'purchase_price_ht')::numeric < 100000000) IS NOT TRUE THEN
        RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : fournisseur', v_line);
      END IF;
      -- Prix public : absent, null ou nombre de 0 à 100 millions (plus strict que lots.js, qui ne le contrôle pas)
      IF jsonb_typeof(v_four -> 'tarif_public') IS NOT NULL AND jsonb_typeof(v_four -> 'tarif_public') <> 'null'
         AND (jsonb_typeof(v_four -> 'tarif_public') <> 'number'
              OR ((v_four ->> 'tarif_public')::numeric >= 0 AND (v_four ->> 'tarif_public')::numeric < 100000000) IS NOT TRUE) THEN
        RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : fournisseur', v_line);
      END IF;
      -- Date du prix : absente, null ou aaaa-mm-jj et date réelle
      IF jsonb_typeof(v_four -> 'purchase_price_at') IS NULL OR jsonb_typeof(v_four -> 'purchase_price_at') = 'null' THEN
        v_date := NULL;
      ELSIF jsonb_typeof(v_four -> 'purchase_price_at') = 'string' AND (v_four ->> 'purchase_price_at') ~ '^\d{4}-\d{2}-\d{2}$'
            AND majordhome.catalog_import_date_valide(v_four ->> 'purchase_price_at') THEN
        v_date := v_four ->> 'purchase_price_at';
      ELSE
        RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023', DETAIL = format('ligne %s : fournisseur', v_line);
      END IF;
      v_sid    := (v_four ->> 'supplier_id')::uuid;
      v_ref    := btrim(v_four ->> 'reference');
      v_achat  := (v_four ->> 'purchase_price_ht')::numeric;
      v_public := (v_four ->> 'tarif_public')::numeric;
    END IF;

    -- Textes : chaîne ou nombre (contrôle du type, absent de lots.js)
    v_code := majordhome.catalog_import_texte(v_row, 'code', v_line, 'code');

    -- Ligne déjà écrite (lot renvoyé) : rien n'est recréé. Avant les contrôles de la base : au rejeu, la référence
    -- interne et la ligne fournisseur de la ligne existent déjà… parce que c'est elle qui les a écrites.
    IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE import_id = p_import_id AND import_line = v_line AND org_id = v_org) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Référence interne déjà prise dans l'organisation (même règle que l'index catalog_items_code_org_unique)
    IF v_code IS NOT NULL AND EXISTS (
         SELECT 1 FROM majordhome.catalog_items i
          WHERE i.org_id = v_org AND lower(i.code) = lower(v_code) AND i.code IS NOT NULL AND i.merged_into IS NULL) THEN
      RAISE EXCEPTION 'code_pris' USING ERRCODE = '23505', DETAIL = format('ligne %s', v_line);
    END IF;

    IF v_four IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM majordhome.suppliers s WHERE s.id = v_sid AND s.org_id = v_org) THEN
        RAISE EXCEPTION 'supplier_not_in_org' USING ERRCODE = '42501', DETAIL = format('ligne %s', v_line);
      END IF;
      -- Une ligne fournisseur existante (active ou non, rattachée ou non) n'est jamais envoyée à l'écrivain : il en
      -- modifierait le prix, la date ou l'état.
      IF EXISTS (SELECT 1 FROM majordhome.supplier_products p WHERE p.supplier_id = v_sid AND p.reference = v_ref) THEN
        RAISE EXCEPTION 'ligne_fournisseur_existante' USING ERRCODE = '23505', DETAIL = format('ligne %s', v_line);
      END IF;
    END IF;

    -- Liste FERMÉE : aucune autre clé de la ligne n'est lue (ni org_id, ni origin, ni import_id…)
    INSERT INTO majordhome.catalog_items (
      org_id, name, code, brand, model_key, code_ean, category, gamme, product_kind, unit, default_tva_rate,
      selling_price_ht, description, specs, origin, is_active, import_id, import_line)
    VALUES (
      v_org, v_name, v_code,
      majordhome.catalog_import_texte(v_row, 'brand', v_line, 'brand'),
      majordhome.catalog_import_texte(v_row, 'model_key', v_line, 'model_key'),
      v_ean,
      majordhome.catalog_import_texte(v_row, 'category', v_line, 'category'),
      majordhome.catalog_import_texte(v_row, 'gamme', v_line, 'gamme'),
      v_kind,
      coalesce(majordhome.catalog_import_texte(v_row, 'unit', v_line, 'unit'), 'pièce'),
      v_tva, v_prix,
      majordhome.catalog_import_texte(v_row, 'description', v_line, 'description'),
      jsonb_build_object('canonical', jsonb_strip_nulls(jsonb_build_object(
        'modele_import', majordhome.catalog_import_texte(v_row, 'modele_brut', v_line, 'modele_brut'),
        'ancien_numero', majordhome.catalog_import_texte(v_row, 'ancien_numero', v_line, 'ancien_numero')))),
      'manuel', true, p_import_id, v_line)
    RETURNING id INTO v_item;
    v_created := v_created + 1;

    -- Ligne fournisseur, envoyée plus bas à l'écrivain avec SON article
    IF v_four IS NOT NULL THEN
      v_cle := v_sid::text;
      v_lignes := jsonb_set(v_lignes, ARRAY[v_cle], coalesce(v_lignes -> v_cle, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'reference', v_ref, 'name', v_name,
        'brand', majordhome.catalog_import_texte(v_row, 'brand', v_line, 'brand'),
        -- supplier_products ne connaît que main / accessory / consumable
        'product_kind', CASE WHEN v_kind IN ('main', 'accessory') THEN v_kind ELSE 'main' END,
        'category', majordhome.catalog_import_texte(v_row, 'category', v_line, 'category'),
        'gamme', majordhome.catalog_import_texte(v_row, 'gamme', v_line, 'gamme'),
        'unit', coalesce(majordhome.catalog_import_texte(v_row, 'unit', v_line, 'unit'), 'pièce'),
        'default_tva_rate', v_tva,
        'purchase_price_ht', v_achat,
        'purchase_price_at', v_date,
        'tarif_public', v_public,
        'selling_price_ht_defaut', v_prix,
        'model_key', majordhome.catalog_import_texte(v_row, 'model_key', v_line, 'model_key'),
        'catalog_item_id', v_item,
        'specs', jsonb_build_object('source_version', v_version))));
    END IF;
  END LOOP;

  -- Un appel à l'écrivain unique par fournisseur du lot ; contrôle : chaque ligne envoyée est INSÉRÉE et rattachée à
  -- son article (sinon une écriture concurrente l'a créée entre-temps, ou l'article a été refusé : tout est annulé).
  FOR v_cle, v_envoi IN SELECT key, value FROM jsonb_each(v_lignes) LOOP
    v_res := public.supplier_catalog_upsert(v_org, v_cle::uuid, v_version, v_envoi,
                                            '{"desactiver_absents": false, "prix_sans_date": true}'::jsonb);
    IF (v_res ->> 'inseres')::integer IS DISTINCT FROM jsonb_array_length(v_envoi) THEN
      RAISE EXCEPTION 'ligne_fournisseur_existante' USING ERRCODE = '23505',
        DETAIL = format('fournisseur %s : %s lignes insérées sur %s', v_cle, v_res ->> 'inseres', jsonb_array_length(v_envoi));
    END IF;
    SELECT count(*) INTO v_n
      FROM jsonb_to_recordset(v_envoi) AS x(reference text, catalog_item_id uuid)
      JOIN majordhome.supplier_products p
        ON p.supplier_id = v_cle::uuid AND p.org_id = v_org AND p.reference = x.reference
       AND p.catalog_item_id = x.catalog_item_id AND p.catalog_item_link_source = 'import';
    IF v_n IS DISTINCT FROM jsonb_array_length(v_envoi) THEN
      RAISE EXCEPTION 'rattachement_incomplet' USING ERRCODE = 'P0001',
        DETAIL = format('fournisseur %s : %s lignes rattachées sur %s', v_cle, v_n, jsonb_array_length(v_envoi));
    END IF;
    v_fourn := v_fourn + jsonb_array_length(v_envoi);
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped, 'lignes_fournisseur', v_fourn);
END;
$$;

-- Clôt un import en cours (bilan final).
CREATE FUNCTION public.catalog_items_import_finish(p_import_id uuid, p_counts jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.catalog_import_org_admin(p_import_id);

  SELECT status INTO v_status FROM majordhome.catalog_imports WHERE id = p_import_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'en_cours' THEN
    RAISE EXCEPTION 'import_closed' USING ERRCODE = '55000';
  END IF;

  UPDATE majordhome.catalog_imports
     SET status = 'termine', counts = CASE WHEN jsonb_typeof(p_counts) = 'object' THEN p_counts ELSE counts END
   WHERE id = p_import_id AND org_id = v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.catalog_items_import_start(uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.catalog_items_import_batch(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.catalog_items_import_finish(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_items_import_start(uuid, text, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_items_import_batch(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_items_import_finish(uuid, jsonb) TO authenticated;
