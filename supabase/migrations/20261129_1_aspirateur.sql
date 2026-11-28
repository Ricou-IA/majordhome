-- 20261129_1_aspirateur.sql — Aspirateur de sites fournisseurs, tranche 1
-- Spec : docs/superpowers/specs/2026-11-28-aspirateur-sites-fournisseurs-recettes-communes-design.md
-- Plan : docs/superpowers/plans/2026-11-28-aspirateur-tranche-1.md (Task 4)
--
-- 1. majordhome.site_recettes        : recettes COMMUNES à la plateforme (pas d'org_id), lues/écrites par service_role seul.
-- 2. majordhome.aspirations          : journal des travaux (apprentissage, aspiration) par entreprise ; lecture membre.
-- 3. majordhome.catalogue_propositions : propositions à valider par entreprise ; lecture membre.
-- Aucune écriture directe : les RPC SECURITY DEFINER ci-dessous sont les seuls écrivains.
-- RPC qui reçoivent un org_id : service_role seul (REVOKE … FROM PUBLIC, anon, authenticated).
-- Les deux RPC appelées par l'écran (aspiration_recette_etat, catalogue_propositions_decider) dérivent l'appelant
-- d'auth.uid() et vérifient son appartenance active / son droit (garde positive, IS NOT TRUE).
-- Une recette ne contient JAMAIS l'identifiant, le mot de passe ni le numéro de compte client (contrôlé ici aussi).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Recettes communes
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.site_recettes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domaine text NOT NULL CHECK (domaine = lower(domaine) AND domaine <> ''),
  version int NOT NULL CHECK (version >= 1),
  statut text NOT NULL DEFAULT 'essai' CHECK (statut IN ('essai', 'active', 'retiree')),
  contenu jsonb NOT NULL,
  schema_version int NOT NULL DEFAULT 1,
  appris_le timestamptz NOT NULL DEFAULT now(),
  appris_par_org uuid NULL REFERENCES core.organizations(id) ON DELETE SET NULL,
  essais jsonb NOT NULL DEFAULT '{}'::jsonb,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domaine, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS site_recettes_une_active_par_domaine ON majordhome.site_recettes (domaine) WHERE statut = 'active';
COMMENT ON TABLE majordhome.site_recettes IS 'Recettes de sites fournisseurs, COMMUNES à la plateforme (aspirateur). Aucun secret dedans. service_role seul ; appris_par_org n''est jamais exposé aux autres entreprises.';

ALTER TABLE majordhome.site_recettes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON majordhome.site_recettes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.site_recettes TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Journal des travaux
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.aspirations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  supplier_id uuid NOT NULL REFERENCES majordhome.suppliers(id) ON DELETE CASCADE,
  domaine text NOT NULL,
  recette_id uuid NULL REFERENCES majordhome.site_recettes(id) ON DELETE SET NULL,
  genre text NOT NULL CHECK (genre IN ('apprentissage', 'aspiration')),
  statut text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'attente_confirmation', 'termine', 'echec')),
  code_erreur text NULL,
  compteurs jsonb NOT NULL DEFAULT '{}'::jsonb,
  echecs jsonb NOT NULL DEFAULT '[]'::jsonb,
  cout_usd numeric NOT NULL DEFAULT 0,
  plafond_usd numeric NOT NULL,
  essai jsonb NULL,
  lance_par uuid NULL,
  lance_le timestamptz NOT NULL DEFAULT now(),
  termine_le timestamptz NULL
);
CREATE INDEX IF NOT EXISTS aspirations_org_supplier_idx ON majordhome.aspirations (org_id, supplier_id, lance_le DESC);
CREATE INDEX IF NOT EXISTS aspirations_en_cours_idx ON majordhome.aspirations (domaine) WHERE statut = 'en_cours';
COMMENT ON TABLE majordhome.aspirations IS 'Travaux de l''aspirateur (apprentissage d''un site, aspiration). org_id = org CORE. Écrite par les RPC public.aspiration_* (service_role) seulement.';

ALTER TABLE majordhome.aspirations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aspirations_select ON majordhome.aspirations;
CREATE POLICY aspirations_select ON majordhome.aspirations FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.status = 'active'));
REVOKE ALL ON majordhome.aspirations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.aspirations TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_aspirations WITH (security_invoker = true) AS
  SELECT a.id, a.org_id, a.supplier_id, a.domaine, a.genre, a.statut, a.code_erreur, a.compteurs, a.echecs,
         a.cout_usd, a.plafond_usd, a.essai, a.lance_par, a.lance_le, a.termine_le
  FROM majordhome.aspirations a;
REVOKE ALL ON public.majordhome_aspirations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_aspirations TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Propositions
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.catalogue_propositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  supplier_id uuid NOT NULL REFERENCES majordhome.suppliers(id) ON DELETE CASCADE,
  aspiration_id uuid NOT NULL REFERENCES majordhome.aspirations(id) ON DELETE CASCADE,
  reference text NOT NULL,
  catalog_item_id uuid NULL,
  genre text NOT NULL CHECK (genre IN ('nouvel_article', 'caracteristique', 'document', 'photo', 'prix_achat')),
  cle text NULL,
  valeur jsonb NULL,
  ancienne_valeur jsonb NULL,
  cochee boolean NOT NULL DEFAULT false,
  source_url text NULL,
  provenance text NOT NULL CHECK (provenance IN ('public', 'compte')),
  statut text NOT NULL DEFAULT 'a_valider' CHECK (statut IN ('a_valider', 'appliquee', 'ecartee')),
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalogue_propositions_org_supplier_idx ON majordhome.catalogue_propositions (org_id, supplier_id, statut, cree_le);
COMMENT ON TABLE majordhome.catalogue_propositions IS 'Propositions de l''aspirateur à valider par l''entreprise (article, caractéristique, document, photo, prix). Écrite par RPC seulement.';

ALTER TABLE majordhome.catalogue_propositions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalogue_propositions_select ON majordhome.catalogue_propositions;
CREATE POLICY catalogue_propositions_select ON majordhome.catalogue_propositions FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.status = 'active'));
REVOKE ALL ON majordhome.catalogue_propositions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.catalogue_propositions TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_catalogue_propositions WITH (security_invoker = true) AS
  SELECT p.id, p.org_id, p.supplier_id, p.aspiration_id, p.reference, p.catalog_item_id, p.genre, p.cle, p.valeur,
         p.ancienne_valeur, p.cochee, p.source_url, p.provenance, p.statut, p.cree_le
  FROM majordhome.catalogue_propositions p;
REVOKE ALL ON public.majordhome_catalogue_propositions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_catalogue_propositions TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. RPC service_role
-- ---------------------------------------------------------------------------------------------------------------

-- Ouvre un travail. Un seul travail en cours par domaine, toutes entreprises confondues (politesse envers le site) ;
-- un travail resté « en cours » plus de 8 h (service tombé) est clos en échec d'abord, pour ne pas bloquer le site.
-- Un lot arrivé après cette libération est refusé (travail_inconnu) et le service arrête le travail (relecture I1).
CREATE OR REPLACE FUNCTION public.aspiration_ouvrir(
  p_org_id uuid, p_supplier_id uuid, p_domaine text, p_genre text, p_lance_par uuid, p_plafond_usd numeric,
  p_recette_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
DECLARE
  v_id uuid;
  v_domaine text := lower(btrim(coalesce(p_domaine, '')));
BEGIN
  IF v_domaine = '' THEN RAISE EXCEPTION 'site_absent' USING ERRCODE = '22023'; END IF;
  IF p_genre IS NULL OR p_genre NOT IN ('apprentissage', 'aspiration') THEN RAISE EXCEPTION 'requete_invalide' USING ERRCODE = '22023'; END IF;
  IF (SELECT EXISTS (SELECT 1 FROM majordhome.suppliers s WHERE s.id = p_supplier_id AND s.org_id = p_org_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'non_autorise' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aspiration:' || v_domaine));
  UPDATE majordhome.aspirations SET statut = 'echec', code_erreur = 'service_indisponible', termine_le = now()
   WHERE domaine = v_domaine AND statut = 'en_cours' AND lance_le < now() - interval '8 hours';
  IF EXISTS (SELECT 1 FROM majordhome.aspirations WHERE domaine = v_domaine AND statut = 'en_cours') THEN
    RAISE EXCEPTION 'deja_en_cours' USING ERRCODE = '55P03';
  END IF;
  INSERT INTO majordhome.aspirations (org_id, supplier_id, domaine, genre, lance_par, plafond_usd, recette_id)
  VALUES (p_org_id, p_supplier_id, v_domaine, p_genre, p_lance_par, coalesce(p_plafond_usd, 0), p_recette_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_ouvrir(uuid, uuid, text, text, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_ouvrir(uuid, uuid, text, text, uuid, numeric, uuid) TO service_role;

-- Vrai si l'entreprise peut encore lancer un travail aujourd'hui (jour UTC).
CREATE OR REPLACE FUNCTION public.aspiration_quota(p_org_id uuid, p_limite int) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = majordhome, public AS $$
  SELECT count(*) < greatest(coalesce(p_limite, 0), 0)
    FROM majordhome.aspirations
   WHERE org_id = p_org_id AND lance_le >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
$$;
REVOKE EXECUTE ON FUNCTION public.aspiration_quota(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_quota(uuid, int) TO service_role;

-- Ajoute un coût d'IA au travail EN COURS ; rend le cumul et si le plafond est atteint. Le relais RÉSERVE le coût maximal
-- d'un appel avant de le faire, puis régularise (montant négatif) : des appels simultanés ne dépassent pas le plafond
-- (relecture I6). Le cumul ne descend jamais sous zéro. Un travail en attente de confirmation ne dépense plus rien.
CREATE OR REPLACE FUNCTION public.aspiration_cout_ajouter(p_aspiration_id uuid, p_usd numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
DECLARE
  v_row majordhome.aspirations%ROWTYPE;
BEGIN
  IF p_usd IS NULL THEN RAISE EXCEPTION 'requete_invalide' USING ERRCODE = '22023'; END IF;
  UPDATE majordhome.aspirations SET cout_usd = greatest(cout_usd + p_usd, 0)
   WHERE id = p_aspiration_id AND statut = 'en_cours'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'travail_inconnu' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('cout_usd', v_row.cout_usd, 'depasse', v_row.cout_usd >= v_row.plafond_usd);
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_cout_ajouter(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_cout_ajouter(uuid, numeric) TO service_role;

-- Enregistre la recette apprise par un travail (nouvelle version « essai » du domaine). Refus si elle contient l'un
-- des secrets passés par l'edge (identifiant, mot de passe, numéro de compte client), comparés sans casse.
CREATE OR REPLACE FUNCTION public.aspiration_recette_enregistrer(p_aspiration_id uuid, p_contenu jsonb, p_interdits text[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
DECLARE
  v_asp majordhome.aspirations%ROWTYPE;
  v_texte text := lower(coalesce(p_contenu::text, ''));
  v_secret text;
  v_version int;
  v_id uuid;
BEGIN
  IF p_contenu IS NULL OR jsonb_typeof(p_contenu) <> 'object' THEN RAISE EXCEPTION 'requete_invalide' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_asp FROM majordhome.aspirations WHERE id = p_aspiration_id AND statut = 'en_cours' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'travail_inconnu' USING ERRCODE = 'P0002'; END IF;
  FOREACH v_secret IN ARRAY coalesce(p_interdits, ARRAY[]::text[]) LOOP
    IF length(btrim(coalesce(v_secret, ''))) >= 3 AND position(lower(btrim(v_secret)) IN v_texte) > 0 THEN
      RAISE EXCEPTION 'recette_contient_secret' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext('recette:' || v_asp.domaine));
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM majordhome.site_recettes WHERE domaine = v_asp.domaine;
  INSERT INTO majordhome.site_recettes (domaine, version, statut, contenu, schema_version, appris_par_org)
  VALUES (v_asp.domaine, v_version, 'essai', p_contenu, coalesce((p_contenu->>'schema')::int, 1), v_asp.org_id)
  RETURNING id INTO v_id;
  UPDATE majordhome.aspirations SET recette_id = v_id WHERE id = p_aspiration_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_recette_enregistrer(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_recette_enregistrer(uuid, jsonb, text[]) TO service_role;

-- Recette qu'un travail doit utiliser : celle qui lui est liée (version en essai d'une confirmation), sinon l'active
-- du domaine ; null s'il n'y en a pas (⇒ apprentissage).
CREATE OR REPLACE FUNCTION public.aspiration_recette_a_utiliser(p_aspiration_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = majordhome, public AS $$
DECLARE
  v_asp majordhome.aspirations%ROWTYPE;
  v_rec majordhome.site_recettes%ROWTYPE;
BEGIN
  SELECT * INTO v_asp FROM majordhome.aspirations WHERE id = p_aspiration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'travail_inconnu' USING ERRCODE = 'P0002'; END IF;
  IF v_asp.recette_id IS NOT NULL THEN
    SELECT * INTO v_rec FROM majordhome.site_recettes WHERE id = v_asp.recette_id AND statut <> 'retiree';
  ELSE
    SELECT * INTO v_rec FROM majordhome.site_recettes WHERE domaine = v_asp.domaine AND statut = 'active';
  END IF;
  IF v_rec.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('recette_id', v_rec.id, 'version', v_rec.version, 'contenu', v_rec.contenu);
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_recette_a_utiliser(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_recette_a_utiliser(uuid) TO service_role;

-- Fin d'apprentissage : les produits d'essai sont rangés et le travail attend la confirmation de l'administrateur.
CREATE OR REPLACE FUNCTION public.aspiration_essai(p_aspiration_id uuid, p_essai jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
BEGIN
  UPDATE majordhome.aspirations SET essai = p_essai, statut = 'attente_confirmation'
   WHERE id = p_aspiration_id AND statut = 'en_cours' AND genre = 'apprentissage' AND recette_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'travail_inconnu' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_essai(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_essai(uuid, jsonb) TO service_role;

-- Range un lot de propositions ; org et fournisseur dérivés du travail, jamais du lot.
CREATE OR REPLACE FUNCTION public.aspiration_propositions_ajouter(p_aspiration_id uuid, p_lignes jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
DECLARE
  v_asp majordhome.aspirations%ROWTYPE;
  v_n int;
BEGIN
  IF p_lignes IS NULL OR jsonb_typeof(p_lignes) <> 'array' THEN RAISE EXCEPTION 'requete_invalide' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_asp FROM majordhome.aspirations WHERE id = p_aspiration_id AND statut = 'en_cours';
  IF NOT FOUND THEN RAISE EXCEPTION 'travail_inconnu' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO majordhome.catalogue_propositions
    (org_id, supplier_id, aspiration_id, reference, catalog_item_id, genre, cle, valeur, ancienne_valeur, cochee, source_url, provenance)
  SELECT v_asp.org_id, v_asp.supplier_id, v_asp.id, l.reference, l.catalog_item_id, l.genre, l.cle, l.valeur,
         l.ancienne_valeur, coalesce(l.cochee, false), l.source_url, l.provenance
    FROM jsonb_to_recordset(p_lignes) AS l(reference text, catalog_item_id uuid, genre text, cle text, valeur jsonb,
                                            ancienne_valeur jsonb, cochee boolean, source_url text, provenance text);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_propositions_ajouter(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_propositions_ajouter(uuid, jsonb) TO service_role;

-- Clôt un travail (en cours ou en attente de confirmation).
CREATE OR REPLACE FUNCTION public.aspiration_clore(p_aspiration_id uuid, p_statut text, p_code text, p_compteurs jsonb, p_echecs jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
BEGIN
  IF p_statut IS NULL OR p_statut NOT IN ('termine', 'echec') THEN RAISE EXCEPTION 'requete_invalide' USING ERRCODE = '22023'; END IF;
  UPDATE majordhome.aspirations
     SET statut = p_statut, code_erreur = p_code, compteurs = coalesce(p_compteurs, compteurs),
         echecs = coalesce(p_echecs, echecs), termine_le = now()
   WHERE id = p_aspiration_id AND statut IN ('en_cours', 'attente_confirmation');
  IF NOT FOUND THEN RAISE EXCEPTION 'travail_inconnu' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_clore(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_clore(uuid, text, text, jsonb, jsonb) TO service_role;

-- Après une aspiration complète réussie (au plus une moitié de produits en échec), la recette en essai du travail
-- devient l'active du domaine ; l'ancienne active est retirée. Rend vrai si une promotion a eu lieu.
CREATE OR REPLACE FUNCTION public.aspiration_recette_promouvoir(p_aspiration_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
DECLARE
  v_asp majordhome.aspirations%ROWTYPE;
  v_rec majordhome.site_recettes%ROWTYPE;
  v_lus numeric;
  v_echecs numeric;
BEGIN
  SELECT * INTO v_asp FROM majordhome.aspirations WHERE id = p_aspiration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'travail_inconnu' USING ERRCODE = 'P0002'; END IF;
  IF v_asp.statut <> 'termine' OR v_asp.genre <> 'aspiration' OR v_asp.recette_id IS NULL THEN RETURN false; END IF;
  v_lus := coalesce((v_asp.compteurs->>'lus')::numeric, 0);
  v_echecs := coalesce((v_asp.compteurs->>'echecs')::numeric, 0);
  IF v_lus <= 0 OR v_echecs > v_lus / 2 THEN RETURN false; END IF;
  SELECT * INTO v_rec FROM majordhome.site_recettes WHERE id = v_asp.recette_id FOR UPDATE;
  IF v_rec.statut <> 'essai' THEN RETURN false; END IF;
  UPDATE majordhome.site_recettes SET statut = 'retiree' WHERE domaine = v_rec.domaine AND statut = 'active';
  UPDATE majordhome.site_recettes SET statut = 'active' WHERE id = v_rec.id;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_recette_promouvoir(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aspiration_recette_promouvoir(uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. RPC de l'écran (authenticated)
-- ---------------------------------------------------------------------------------------------------------------

-- « Recette connue ? Travail en cours ? » pour un membre actif de l'org. Ne rend RIEN d'autre (ni date, ni version,
-- ni entreprise) : une entreprise ne doit pas savoir qu'une autre se fournit chez ce fournisseur.
CREATE OR REPLACE FUNCTION public.aspiration_recette_etat(p_org_id uuid, p_domaine text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = majordhome, core, public AS $$
DECLARE
  v_domaine text := lower(btrim(coalesce(p_domaine, '')));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'non_autorise' USING ERRCODE = '42501'; END IF;
  IF (SELECT EXISTS (SELECT 1 FROM core.organization_members om
                      WHERE om.user_id = auth.uid() AND om.org_id = p_org_id AND om.status = 'active')) IS NOT TRUE THEN
    RAISE EXCEPTION 'non_autorise' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'connue', EXISTS (SELECT 1 FROM majordhome.site_recettes WHERE domaine = v_domaine AND statut = 'active'),
    'en_cours', EXISTS (SELECT 1 FROM majordhome.aspirations WHERE domaine = v_domaine AND statut = 'en_cours' AND org_id = p_org_id));
END $$;
REVOKE EXECUTE ON FUNCTION public.aspiration_recette_etat(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aspiration_recette_etat(uuid, text) TO authenticated, service_role;

-- Marque des propositions appliquées ou écartées. Droit articles.edit (grille des droits), lignes de l'org seulement.
CREATE OR REPLACE FUNCTION public.catalogue_propositions_decider(p_org_id uuid, p_ids uuid[], p_statut text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public AS $$
DECLARE
  v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'non_autorise' USING ERRCODE = '42501'; END IF;
  IF public.user_can(p_org_id, 'articles', 'edit') IS NOT TRUE THEN RAISE EXCEPTION 'non_autorise' USING ERRCODE = '42501'; END IF;
  IF p_statut IS NULL OR p_statut NOT IN ('appliquee', 'ecartee') THEN RAISE EXCEPTION 'requete_invalide' USING ERRCODE = '22023'; END IF;
  UPDATE majordhome.catalogue_propositions SET statut = p_statut
   WHERE org_id = p_org_id AND id = ANY (coalesce(p_ids, ARRAY[]::uuid[])) AND statut = 'a_valider';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE EXECUTE ON FUNCTION public.catalogue_propositions_decider(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalogue_propositions_decider(uuid, uuid[], text) TO authenticated, service_role;
