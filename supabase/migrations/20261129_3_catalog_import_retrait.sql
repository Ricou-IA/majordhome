-- 20261129_3 — Import d'une base d'articles : aperçu et retrait d'un import (suite de 20261129_2).
--
-- Spec : docs/superpowers/specs/2026-11-28-import-articles-fichier-design.md (§ 6.6). Modèle : retrait des clients
-- (20261121_13, revu par 20261122_1).
--
-- Un article de l'import est RETIRABLE quand rien ne le référence, lu dans pg_constraint à l'exécution (toute clé
-- étrangère vers majordhome.catalog_items, de n'importe quelle table : lignes de devis, documents, propositions
-- d'harmonisation, modèles d'appareil, fusions `merged_into`, lignes fournisseur…), SAUF ses propres lignes
-- fournisseur créées par l'import et JAMAIS reprises par un relevé :
--   catalog_item_link_source = 'import' ET specs->>'source_version' = 'import-articles_<import_id>'.
-- Ces lignes n'existent que par l'import : elles partent avec l'article — à condition que rien ne les référence
-- elles-mêmes (clé étrangère vers supplier_products : devis, documents, équipements, pièces, fumisterie…). Une ligne
-- reprise par un relevé (source_version réécrite) prouve que le fournisseur vend le produit : l'article est CONSERVÉ.
-- Les fournisseurs créés par l'import ne sont jamais supprimés.
-- Une ligne tolérée corrigée à la main (prix, libellé) reste tolérée : sa source_version ne change pas, seul un relevé
-- la réécrit.
-- Références SANS clé étrangère (relues en production le 2026-11-28) :
--   - majordhome.catalogue_propositions.catalog_item_id (aspirateur, 20261129_1) : lue explicitement si la table
--     existe ; un article cité par une proposition est conservé.
--   - majordhome.sav_part_selections.supplier_product_id : sans clé étrangère par conception (la sélection garde une
--     photo de la ligne) ; une ligne tolérée qu'elle cite part quand même, c'est voulu.
-- L'aperçu calcule le point fixe (toutes les couches que les retraits successifs supprimeront : fusion dans le même
-- import) ; un appel de retrait supprime la première couche, puis recompte quand elle est vide.
--
-- public.catalog_items_import_removal_preview(p_import_id) → { retirables, conservees }
-- public.catalog_items_import_remove(p_import_id, p_limit DEFAULT 100) → { retirees, conservees, restantes }
--   (mêmes clés que le retrait des clients : `lireReponseRetrait` de src/lib/importClients/lots.js). Par lots (1 à 500),
--   à rappeler tant que restantes > 0 ; chaque suppression doit toucher exactement ce qui est visé, sinon tout est
--   annulé (`removal_incomplete`, DETAIL). `counts` reçoit `retirees` (cumul) et `conservees`. status = 'retire',
--   removed_at, removed_by seulement quand il ne reste AUCUN article de l'import (spec § 6.6, comme les clients après
--   20261122_1) ; un import qui garde des articles conservés reste `termine` (ou `en_cours`) et reste rappelable : un
--   article conservé qui se libère plus tard pourra encore partir.
--
-- Garde : auth.uid() NULL refusé en premier, puis majordhome.catalog_import_org_admin (org_admin ACTIF de
-- l'organisation de l'IMPORT, 20261129_2). Codes : `unauthenticated` / `org_admin_required` (42501),
-- `import_not_found` (P0002), `removal_incomplete` (P0001, DETAIL).
--
-- Mesuré sur le harnais le 2026-11-28 (assert-catalog-import-retrait.sql, chaîne 20261028_4 → 20261124_2 →
-- 20261129_2 → 20261129_3, déclencheurs `recherche` actifs, index et clés étrangères de production recréés, 47 000
-- articles et 41 000 lignes fournisseur dans l'org, import de 20 000 articles dont 10 000 avec ligne) : aperçu 116 à
-- 181 ms ; remove(…, 100) 149 à 215 ms (sans les index du § 0 : 0,9 à 2,2 s). Plafond PostgREST : 8 s ; cible : < 2 s.
-- Revue finale, même jeu : aperçu 300 ms, remove(…, 300) 397 à 411 ms ⇒ l'écran retire par lots de
-- TAILLE_LOT_RETRAIT_ARTICLES = 300 (src/lib/importArticles/lots.js ; le retrait des clients garde ses lots de 100).
--
-- Retour arrière : DROP INDEX majordhome.catalog_items_merged_into_idx, majordhome.catalog_items_source_product_idx,
-- majordhome.supplier_products_variant_of_idx ; DROP FUNCTION public.catalog_items_import_remove(uuid, integer),
-- public.catalog_items_import_removal_preview(uuid), majordhome.catalog_import_retirables(uuid, boolean).

SET lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 0. Index des trois clés étrangères qui n'en avaient pas
-- ----------------------------------------------------------------------------
-- Supprimer un article ou une ligne fournisseur déclenche l'action de chaque clé étrangère qui pointe vers eux. Sans
-- index, catalog_items.merged_into, catalog_items.source_product_id et supplier_products.variant_of font chacune un
-- parcours complet de la table PAR ligne supprimée (mesuré : ≈ 3,7 ms par ligne et par clé sur 47 000 articles,
-- 0,9 à 2,2 s pour 100 articles). Index partiels (colonnes presque toujours NULL) : le planificateur les prend pour
-- `col = $1`. Ils servent aussi à toute suppression d'article ou de ligne hors import (fusion, suppression manuelle).
CREATE INDEX IF NOT EXISTS catalog_items_merged_into_idx ON majordhome.catalog_items (merged_into) WHERE merged_into IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_items_source_product_idx ON majordhome.catalog_items (source_product_id) WHERE source_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_products_variant_of_idx ON majordhome.supplier_products (variant_of) WHERE variant_of IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 1. Fonction interne : articles retirables d'un import
-- ----------------------------------------------------------------------------
-- p_point_fixe = false : la première couche, celle qu'un appel de retrait peut supprimer d'un coup.
-- p_point_fixe = true : tout ce que les retraits successifs finiront par supprimer (aperçu). Un article qui n'est retenu
-- que par un article ou une ligne de l'import qui part (fusion dans le même import, `variant_of`, `source_product_id`)
-- devient retirable à la couche suivante ; on itère tant qu'une couche en libère une autre.
CREATE FUNCTION majordhome.catalog_import_retirables(p_import_id uuid, p_point_fixe boolean DEFAULT false)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org       uuid;
  v_version   text := 'import-articles_' || p_import_id::text;
  v_restants  uuid[];
  v_lignes    uuid[];
  v_partis    uuid[] := '{}';
  v_total     uuid[] := '{}';
  v_couche    uuid[];
  v_retenus   uuid[];
  v_ids       uuid[];
  v_interne   boolean;
  v_jointure  text;
  v_sql       text;
  r record;
BEGIN
  SELECT org_id INTO v_org FROM majordhome.catalog_imports WHERE id = p_import_id;
  IF v_org IS NULL THEN
    RETURN '{}';
  END IF;
  SELECT coalesce(array_agg(id), '{}') INTO v_restants
    FROM majordhome.catalog_items WHERE import_id = p_import_id AND org_id = v_org;
  IF cardinality(v_restants) = 0 THEN
    RETURN '{}';
  END IF;

  -- Lignes fournisseur créées par l'import et jamais reprises : les seules références tolérées (et seulement venant
  -- de l'article qui les porte, ou d'un article déjà parti)
  SELECT coalesce(array_agg(p.id), '{}') INTO v_lignes
    FROM majordhome.supplier_products p
   WHERE p.catalog_item_id = ANY (v_restants) AND p.org_id = v_org
     AND p.catalog_item_link_source = 'import' AND p.specs ->> 'source_version' = v_version;

  LOOP
    v_retenus := '{}';
    v_interne := false;
    -- $1 = articles encore en lice, $2 = lignes tolérées, $3 = articles déjà partis (couches précédentes)
    FOR r IN
      SELECT c.conrelid::regclass AS source, c.confrelid::regclass AS cible, c.conkey, c.confkey
        FROM pg_constraint c
       WHERE c.contype = 'f'
         AND c.confrelid IN ('majordhome.catalog_items'::regclass, 'majordhome.supplier_products'::regclass)
    LOOP
      SELECT string_agg(format('r.%I = t.%I', a.attname, b.attname), ' AND ' ORDER BY k.ord)
        INTO v_jointure
        FROM unnest(r.conkey, r.confkey) WITH ORDINALITY AS k(col_source, col_cible, ord)
        JOIN pg_attribute a ON a.attrelid = r.source AND a.attnum = k.col_source
        JOIN pg_attribute b ON b.attrelid = r.cible AND b.attnum = k.col_cible;

      IF r.cible = 'majordhome.catalog_items'::regclass THEN
        -- Référence à l'article ; ne retient pas : ses propres lignes tolérées, une ligne tolérée d'un article parti,
        -- l'article lui-même, un article parti.
        v_sql := format(
          'SELECT array_agg(DISTINCT t.id) FROM majordhome.catalog_items t WHERE t.id = ANY ($1) AND EXISTS (SELECT 1 FROM %s r WHERE %s%s)',
          r.source, v_jointure,
          CASE r.source
            WHEN 'majordhome.supplier_products'::regclass
              THEN ' AND NOT (r.id = ANY ($2) AND (r.catalog_item_id = t.id OR r.catalog_item_id = ANY ($3)))'
            WHEN 'majordhome.catalog_items'::regclass THEN ' AND r.id <> t.id AND r.id <> ALL ($3)'
            ELSE '' END);
      ELSE
        -- Référence à une ligne tolérée : l'article qui la porte est retenu (la ligne ne peut pas partir). Ne retient
        -- pas : une ligne tolérée du même article ou d'un article parti, l'article qui porte la ligne, un article parti.
        IF cardinality(v_lignes) = 0 THEN
          CONTINUE;
        END IF;
        v_sql := format(
          'SELECT array_agg(DISTINCT t.catalog_item_id) FROM majordhome.supplier_products t'
          ' WHERE t.id = ANY ($2) AND t.catalog_item_id = ANY ($1) AND EXISTS (SELECT 1 FROM %s r WHERE %s%s)',
          r.source, v_jointure,
          CASE r.source
            WHEN 'majordhome.supplier_products'::regclass
              THEN ' AND NOT (r.id = ANY ($2) AND (r.catalog_item_id = t.catalog_item_id OR r.catalog_item_id = ANY ($3)))'
            WHEN 'majordhome.catalog_items'::regclass THEN ' AND r.id <> t.catalog_item_id AND r.id <> ALL ($3)'
            ELSE '' END);
      END IF;

      EXECUTE v_sql INTO v_ids USING v_restants, v_lignes, v_partis;
      IF cardinality(v_ids) > 0 AND r.source IN ('majordhome.catalog_items'::regclass, 'majordhome.supplier_products'::regclass) THEN
        v_interne := true;  -- retenu par un article ou une ligne : peut se libérer à la couche suivante
      END IF;
      v_retenus := v_retenus || coalesce(v_ids, '{}');
    END LOOP;

    -- Référence SANS clé étrangère : propositions de l'aspirateur (20261129_1), lues si la table existe
    IF to_regclass('majordhome.catalogue_propositions') IS NOT NULL THEN
      EXECUTE 'SELECT array_agg(DISTINCT c.catalog_item_id) FROM majordhome.catalogue_propositions c WHERE c.catalog_item_id = ANY ($1)'
        INTO v_ids USING v_restants;
      v_retenus := v_retenus || coalesce(v_ids, '{}');
    END IF;

    v_couche := ARRAY(SELECT x FROM unnest(v_restants) AS x WHERE x <> ALL (v_retenus));
    v_total := v_total || v_couche;
    EXIT WHEN p_point_fixe IS NOT TRUE OR v_interne IS NOT TRUE OR cardinality(v_couche) = 0;
    v_partis := v_partis || v_couche;
    v_restants := ARRAY(SELECT x FROM unnest(v_restants) AS x WHERE x <> ALL (v_couche));
  END LOOP;

  RETURN ARRAY(SELECT x FROM unnest(v_total) AS x ORDER BY x);
END;
$$;

REVOKE ALL ON FUNCTION majordhome.catalog_import_retirables(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. RPC publiques
-- ----------------------------------------------------------------------------

-- Ce que le retrait ferait : articles retirables / articles conservés (référencés ailleurs ou repris par un relevé).
CREATE FUNCTION public.catalog_items_import_removal_preview(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_org   uuid;
  v_total integer;
  v_ret   uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.catalog_import_org_admin(p_import_id);

  SELECT count(*) INTO v_total FROM majordhome.catalog_items WHERE import_id = p_import_id AND org_id = v_org;
  -- Point fixe : le même nombre que les appels de retrait successifs supprimeront au total
  v_ret := majordhome.catalog_import_retirables(p_import_id, true);
  RETURN jsonb_build_object('retirables', cardinality(v_ret), 'conservees', v_total - cardinality(v_ret));
END;
$$;

-- Retire au plus p_limit (1 à 500) articles retirables et leurs lignes fournisseur jamais reprises ; à appeler en
-- boucle tant que restantes > 0 (PostgREST coupe un appel à 8 s).
CREATE FUNCTION public.catalog_items_import_remove(p_import_id uuid, p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_org       uuid;
  v_version   text := 'import-articles_' || p_import_id::text;
  v_limit     integer := LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
  v_ret       uuid[];
  v_lot       uuid[];
  v_vises     integer;
  v_lignes    integer;
  v_n         integer;
  v_total     integer;
  v_restantes integer;
  v_cumul     numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.catalog_import_org_admin(p_import_id);

  -- Verrous : l'import (pas de retrait ni de lot en parallèle), puis ses articles et leurs lignes fournisseur — une
  -- écriture concurrente qui voudrait citer un article dans un devis, ou un relevé qui voudrait reprendre une ligne,
  -- attend la fin du retrait au lieu d'être défaite en silence par un ON DELETE SET NULL / CASCADE.
  PERFORM 1 FROM majordhome.catalog_imports WHERE id = p_import_id FOR UPDATE;
  PERFORM 1 FROM majordhome.catalog_items WHERE import_id = p_import_id AND org_id = v_org FOR UPDATE;
  PERFORM 1 FROM majordhome.supplier_products p JOIN majordhome.catalog_items i ON i.id = p.catalog_item_id
    WHERE i.import_id = p_import_id AND i.org_id = v_org FOR UPDATE OF p;

  v_ret := majordhome.catalog_import_retirables(p_import_id);
  v_lot := coalesce(v_ret[1:v_limit], '{}');
  v_vises := cardinality(v_lot);

  -- Lignes fournisseur jamais reprises du lot, puis les articles. Chaque suppression doit toucher exactement ce qui
  -- est visé : sinon tout est annulé (jamais un succès annoncé sur des articles restés en place).
  SELECT count(*) INTO v_lignes FROM majordhome.supplier_products
   WHERE catalog_item_id = ANY (v_lot) AND org_id = v_org
     AND catalog_item_link_source = 'import' AND specs ->> 'source_version' = v_version;
  DELETE FROM majordhome.supplier_products
   WHERE catalog_item_id = ANY (v_lot) AND org_id = v_org
     AND catalog_item_link_source = 'import' AND specs ->> 'source_version' = v_version;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM v_lignes THEN
    RAISE EXCEPTION 'removal_incomplete' USING ERRCODE = 'P0001', DETAIL = format('lignes fournisseur : %s supprimées sur %s', v_n, v_lignes);
  END IF;
  -- Filet : aucune autre ligne fournisseur ne doit encore pointer vers le lot (elle serait détachée en silence)
  IF EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE catalog_item_id = ANY (v_lot)) THEN
    RAISE EXCEPTION 'removal_incomplete' USING ERRCODE = 'P0001', DETAIL = 'une ligne fournisseur reste rattachée à un article du lot';
  END IF;
  DELETE FROM majordhome.catalog_items WHERE id = ANY (v_lot) AND import_id = p_import_id AND org_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM v_vises THEN
    RAISE EXCEPTION 'removal_incomplete' USING ERRCODE = 'P0001', DETAIL = format('articles : %s supprimés sur %s', v_n, v_vises);
  END IF;

  -- Reste à retirer = retirables d'avant moins ce qui vient de partir. À 0 seulement, on recompte : un article que
  -- retenait un article qui vient de partir (fusion dans le même import) est devenu retirable.
  v_restantes := cardinality(v_ret) - v_vises;
  IF v_restantes = 0 THEN
    v_restantes := cardinality(majordhome.catalog_import_retirables(p_import_id));
  END IF;
  SELECT count(*) INTO v_total FROM majordhome.catalog_items WHERE import_id = p_import_id AND org_id = v_org;

  -- Bilan du retrait dans counts (cumul des appels) ; « retire » seulement quand il ne reste AUCUN article de l'import
  -- (comme les clients après 20261122_1) : un import qui garde des articles conservés reste dans son statut.
  SELECT CASE WHEN jsonb_typeof(counts -> 'retirees') = 'number' THEN (counts ->> 'retirees')::numeric ELSE 0 END
    INTO v_cumul FROM majordhome.catalog_imports WHERE id = p_import_id;
  UPDATE majordhome.catalog_imports
     SET counts     = counts || jsonb_build_object('retirees', coalesce(v_cumul, 0) + v_vises, 'conservees', v_total - v_restantes),
         status     = CASE WHEN v_total = 0 THEN 'retire' ELSE status END,
         removed_at = CASE WHEN v_total = 0 THEN coalesce(removed_at, now()) ELSE removed_at END,
         removed_by = CASE WHEN v_total = 0 THEN coalesce(removed_by, v_uid) ELSE removed_by END
   WHERE id = p_import_id AND org_id = v_org;

  RETURN jsonb_build_object('retirees', v_vises, 'conservees', v_total - v_restantes, 'restantes', v_restantes);
END;
$$;

REVOKE ALL ON FUNCTION public.catalog_items_import_removal_preview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.catalog_items_import_remove(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_items_import_removal_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_items_import_remove(uuid, integer) TO authenticated;

COMMENT ON COLUMN majordhome.catalog_imports.status IS
  'en_cours → termine (catalog_items_import_finish) ; retire quand il ne reste plus aucun article de l''import (catalog_items_import_remove).';
COMMENT ON COLUMN majordhome.catalog_imports.counts IS
  'Bilan de l''import (lues, importées, doublons, écartées…), écrit au départ puis à la fin ; après un retrait retirees (cumul) et conservees.';

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
