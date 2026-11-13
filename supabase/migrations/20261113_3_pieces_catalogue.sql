-- 20261113_3_pieces_catalogue.sql — base de pièces : vue de recherche des catalogues de pièces relevés, indicateur
-- « nombre de pièces proposées par la base » sur les recherches de l'assistant.
-- Spec : docs/superpowers/specs/2026-11-12-base-pieces-catalogues-marchands-design.md (§ 4, § 5).
-- Plan : docs/superpowers/plans/2026-11-12-base-pieces-catalogues-marchands.md, tâche 3.
--
-- 1. public.majordhome_pieces_catalogue : lecture seule, security_invoker (RLS de suppliers / supplier_products, policies
--    de prod inchangées), sur les lignes `piece_detachee` actives d'un fournisseur actif dont le relevé est un
--    catalogue de pièces (specs.canonical.catalogue_pieces = true, posé par src/lib/catalogue/woocommercePieces.js).
--    N'expose QUE des données publiques du marchand : ni prix d'achat, ni remise, ni tarif HT, ni prix de vente, ni
--    specs, ni description brute. Chaque valeur lue dans specs.canonical est gardée par son type JSON : une valeur
--    malformée donne NULL, jamais une erreur qui casserait la vue entière.
--    `recherche` = lower(public.unaccent(concat_ws(' ', désignation, référence, marque, rayons joints, description du
--    marchand))) — à reproduire À L'IDENTIQUE côté JavaScript pour normaliser les mots saisis.
--    `marque_recherche` (DERNIÈRE colonne) = lower(public.unaccent(concat_ws(' ', brand, rayons))) — exactement les deux
--    valeurs exposées sous `brand` et `rayons`, ni désignation ni description : filtre de marque côté serveur
--    (`.ilike('marque_recherche', '%mot%')`, mot normalisé), pour qu'une marque accentuée en base (« Jøtul », « Stûv »)
--    se retrouve depuis une saisie sans accent. Le nom de colonne est un contrat avec le service du front.
--    Colonnes : id, org_id, supplier_id, supplier_name, reference, name, brand, rayons, prix_public_ttc, en_stock,
--    releve_at, fiche_url, image_url, recherche, marque_recherche.
-- 2. majordhome.assistant_recherches.nb_pieces_base (NULL ou 0..999) + vue majordhome_assistant_recherches recréée
--    avec la colonne EN FIN de liste (CREATE OR REPLACE VIEW n'autorise que l'ajout en fin) ; privilèges de 20261113_1
--    réappliqués à l'identique.
-- 3. public.assistant_recherche_noter_base(p_id, p_nb) : service_role seul, même style que les cinq RPC de 20261113_1.
-- Écrivain des lignes de catalogue : public.supplier_pieces_upsert (inchangé), UN appel par relevé sous la marque de
-- relevé 'CATALOGUE' — comportement prouvé par l'assertion 6 du harnais.
-- Répétée sur scripts/migration-rehearsal/ (assert-pieces-catalogue.sql, chaîne 20261113_1 + _2 + _3).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Vue de recherche des catalogues de pièces
-- ---------------------------------------------------------------------------------------------------------------
-- Date ISO lue dans le JSON : NULL si elle n'est pas une date valide (PostgreSQL 17 en prod ; un bloc EXCEPTION plutôt
-- que pg_input_is_valid, disponible depuis la 16, pour ne pas dépendre de la version du cluster de répétition).
CREATE OR REPLACE FUNCTION majordhome.horodatage_ou_null(p_texte text) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = majordhome, public
AS $$
BEGIN
  IF p_texte IS NULL OR p_texte !~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN NULL;
  END IF;
  RETURN p_texte::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION majordhome.horodatage_ou_null(text) IS
  'Texte → timestamptz, NULL si le texte n''est pas une date valide (jamais d''erreur). SECURITY INVOKER ; utilisée par la vue public.majordhome_pieces_catalogue.';
-- Fonction INVOKER sans effet de bord, appelée par une vue security_invoker : EXECUTE pour les lecteurs de la vue seulement.
REVOKE EXECUTE ON FUNCTION majordhome.horodatage_ou_null(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION majordhome.horodatage_ou_null(text) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_pieces_catalogue WITH (security_invoker = true) AS
  SELECT p.id,
         p.org_id,
         p.supplier_id,
         s.name AS supplier_name,
         p.reference,
         p.name,
         p.brand,
         r.rayons,
         CASE WHEN jsonb_typeof(c.canonical -> 'prix_public_ttc') = 'number'
              THEN (c.canonical ->> 'prix_public_ttc')::numeric END AS prix_public_ttc,
         CASE WHEN jsonb_typeof(c.canonical -> 'stock_releve' -> 'en_stock') = 'boolean'
              THEN (c.canonical -> 'stock_releve' ->> 'en_stock')::boolean END AS en_stock,
         CASE WHEN jsonb_typeof(c.canonical -> 'stock_releve' -> 'at') = 'string'
              THEN majordhome.horodatage_ou_null(c.canonical -> 'stock_releve' ->> 'at') END AS releve_at,
         CASE WHEN jsonb_typeof(c.canonical -> 'fiche_produit') = 'string'
              THEN c.canonical ->> 'fiche_produit' END AS fiche_url,
         p.image_url,
         lower(public.unaccent(concat_ws(' ', p.name, p.reference, p.brand, r.rayons,
               CASE WHEN jsonb_typeof(c.canonical -> 'description_marchand') = 'string'
                    THEN c.canonical ->> 'description_marchand' END))) AS recherche,
         lower(public.unaccent(concat_ws(' ', p.brand, r.rayons))) AS marque_recherche
  FROM majordhome.supplier_products p
  JOIN majordhome.suppliers s ON s.id = p.supplier_id AND s.org_id = p.org_id
  CROSS JOIN LATERAL (SELECT p.specs -> 'canonical' AS canonical) c
  CROSS JOIN LATERAL (
    -- noms des rayons, dans l'ordre du relevé, joints par « | » ; seuls les éléments texte d'un tableau comptent
    SELECT string_agg(e.valeur #>> '{}', ' | ' ORDER BY e.rang) AS rayons
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.canonical -> 'rayons') = 'array'
                                   THEN c.canonical -> 'rayons' ELSE '[]'::jsonb END) WITH ORDINALITY AS e(valeur, rang)
    WHERE jsonb_typeof(e.valeur) = 'string'
  ) r
  WHERE p.is_active
    AND s.is_active
    AND p.category = 'piece_detachee'
    AND p.specs -> 'canonical' ->> 'catalogue_pieces' = 'true';
COMMENT ON VIEW public.majordhome_pieces_catalogue IS
  'Base de pièces (lecture seule, security_invoker) : pièces des catalogues de marchands relevés (supplier_pieces_upsert, marque de relevé CATALOGUE), données publiques seulement. recherche = lower(public.unaccent(concat_ws('' '', name, reference, brand, rayons, description_marchand))) ; marque_recherche = lower(public.unaccent(concat_ws('' '', brand, rayons))).';
-- Le schéma public (partagé) accorde tout par défaut à anon et authenticated : SELECT seul, à authenticated et service_role.
REVOKE ALL ON public.majordhome_pieces_catalogue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_pieces_catalogue TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Indicateur : nombre de pièces que la base proposait au lancement d'une recherche web (déclaré par l'écran)
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.assistant_recherches ADD COLUMN IF NOT EXISTS nb_pieces_base integer NULL
  CONSTRAINT assistant_recherches_nb_pieces_base_check CHECK (nb_pieces_base IS NULL OR nb_pieces_base BETWEEN 0 AND 999);
COMMENT ON COLUMN majordhome.assistant_recherches.nb_pieces_base IS
  'Nombre de pièces « citées pour ce modèle » que la base de pièces proposait quand la recherche web a été lancée (déclaré par le navigateur, pas une preuve). NULL = inconnu. Écrit par public.assistant_recherche_noter_base seulement.';

-- Recréée à l'identique de 20261113_1, nb_pieces_base ajoutée EN FIN.
CREATE OR REPLACE VIEW public.majordhome_assistant_recherches WITH (security_invoker = true) AS
  SELECT r.id, r.org_id, r.equipment_id, r.intervention_id, r.demande, r.statut, r.run_id, r.reponse, r.texte_brut,
         r.usage, r.erreur, r.created_by, r.created_at, r.finished_at,
         (SELECT p.full_name FROM public.profiles p WHERE p.id = r.created_by) AS created_by_name,
         r.nb_pieces_base
  FROM majordhome.assistant_recherches r;
-- Privilèges de 20261113_1, réappliqués tels quels.
REVOKE ALL ON public.majordhome_assistant_recherches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_assistant_recherches TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Noter l'indicateur (service_role) : seulement tant que la recherche est en cours, seulement une valeur 0..999
-- ---------------------------------------------------------------------------------------------------------------
-- Agit par id SANS contrôler l'org, comme attacher_run / clore : l'edge relit la ligne par id + org_id avant.
-- Valeur hors borne (ou NULL), recherche close ou inconnue : rien n'est écrit, sans exception (indicateur non bloquant).
CREATE OR REPLACE FUNCTION public.assistant_recherche_noter_base(p_id uuid, p_nb integer) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  IF (p_nb BETWEEN 0 AND 999) IS NOT TRUE THEN
    RETURN;
  END IF;
  UPDATE majordhome.assistant_recherches r SET nb_pieces_base = p_nb
  WHERE r.id = p_id AND r.statut = 'en_cours';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assistant_recherche_noter_base(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_recherche_noter_base(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.assistant_recherche_noter_base(uuid, integer) IS
  'Pose nb_pieces_base (0..999) sur une recherche en_cours (service_role) ; hors borne, close ou inconnue : sans effet.';
