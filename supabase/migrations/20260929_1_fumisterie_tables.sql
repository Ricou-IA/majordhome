-- supabase/migrations/20260929_1_fumisterie_tables.sql
-- ============================================================================
-- Assistant de devis fumisterie — données (spec 2026-09-28-assistant-devis-fumisterie-design.md).
--   - fum_article_attrs : attributs fumisterie d'un article du catalogue (1-1 supplier_products).
--   - fum_gabarits / fum_configurations / fum_config_composants / fum_regles / fum_config_regles /
--     fum_appareils_valides / fum_guide_choix : connaissance métier (catalogue MODINOX 2026).
--   - fum_composant_mapping : composant générique → (gamme tarif, type de pièce) d'un fournisseur.
--   - fum_metres : relevé + résultat FIGÉ d'un métré rattaché à un devis (engine_version).
--   org_id = org CORE. Lecture membre, écriture org_admin (fum_metres : membre, comme quotes).
-- Répétée sur scripts/migration-rehearsal/ (assert-fumisterie.sql).
-- ============================================================================

CREATE TABLE IF NOT EXISTS majordhome.fum_article_attrs (
  supplier_product_id uuid PRIMARY KEY REFERENCES majordhome.supplier_products(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES core.organizations(id),
  famille_n1       text, libelle_n1 text, famille_n2 text, libelle_n2 text, famille_n3 text, famille_n4 text,
  gamme_tarif      text NOT NULL,
  type_piece       text,
  diametre_int     integer,
  diametre_ext     integer,
  longueur_mm      integer,
  longueur_max_mm  integer,
  angle            integer,
  pente_min        integer,
  pente_max        integer,
  couleur          text CHECK (couleur IS NULL OR couleur IN ('inox', 'noir', 'blanc', 'galva', 'ral', 'autre')),
  version          text,
  sur_mesure       boolean NOT NULL DEFAULT false,
  hors_perimetre   boolean NOT NULL DEFAULT false,
  parse_confidence numeric(3,2) NOT NULL DEFAULT 0,
  parse_notes      text,
  source_version   text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fum_article_attrs_lookup
  ON majordhome.fum_article_attrs (org_id, gamme_tarif, type_piece, diametre_int);
COMMENT ON TABLE majordhome.fum_article_attrs IS
  'Fumisterie : attributs parsés depuis la désignation du tarif (scripts/fumisterie/import-tarif-modinox.mjs). Lecture seule côté app ; regénérés à chaque import de tarif.';

CREATE TABLE IF NOT EXISTS majordhome.fum_gabarits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id),
  code        text NOT NULL CHECK (code ~ '^G[0-9]+[A-Z_]*$'),
  libelle     text NOT NULL,
  description text,
  troncons    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fum_gabarits_org_code_key UNIQUE (org_id, code),
  CONSTRAINT fum_gabarits_id_org_key UNIQUE (id, org_id)
);
COMMENT ON TABLE majordhome.fum_gabarits IS
  'Fumisterie : gabarit de métré = suite ordonnée de tronçons paramétrés (JSONB {type, libelle, parametres:[{cle,libelle,unite,min,max,defaut,optionnel}]}). Le moteur src/lib/fumisterie/gabarits/<code>.js porte la géométrie.';

CREATE TABLE IF NOT EXISTS majordhome.fum_configurations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES core.organizations(id),
  code                    text NOT NULL,
  titre                   text NOT NULL,
  page_catalogue          integer,
  index_image             integer,
  statut                  text NOT NULL DEFAULT 'catalogue' CHECK (statut IN ('catalogue', 'deduit', 'propose', 'a_completer')),
  gabarit_id              uuid,
  gamme_principale        text,
  principe                text,
  remarques               text,
  source_version          text NOT NULL,
  projets                 text[] NOT NULL DEFAULT '{}' CHECK (projets <@ ARRAY['creation_interieur','creation_exterieur','tubage','raccordement']),
  appareils               text[] NOT NULL DEFAULT '{}' CHECK (appareils <@ ARRAY['chaudiere','foyer_insert','poele_cuisiniere']),
  combustibles            text[] NOT NULL DEFAULT '{}' CHECK (combustibles <@ ARRAY['bois_buches','pellets']),
  zones                   text[] NOT NULL DEFAULT '{}' CHECK (zones <@ ARRAY['zone_1','zone_2','zone_3']),
  prise_air               text[] NOT NULL DEFAULT '{}' CHECK (prise_air <@ ARRAY['dans_piece','dans_conduit']),
  appareil_etanche_requis boolean NOT NULL DEFAULT false,
  conduit_existant        text,
  condition_bloquante     text,
  actif                   boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fum_configurations_org_code_key UNIQUE (org_id, code),
  CONSTRAINT fum_configurations_id_org_key UNIQUE (id, org_id),
  CONSTRAINT fum_configurations_gabarit_fk FOREIGN KEY (gabarit_id, org_id) REFERENCES majordhome.fum_gabarits (id, org_id)
);
COMMENT ON TABLE majordhome.fum_configurations IS
  'Fumisterie : configuration type du catalogue (critères en tableaux, filtrage déterministe @>/&&). zones = {} ⇒ sans objet (raccordement seul). gabarit_id NULL ⇒ pas encore métrable.';

CREATE TABLE IF NOT EXISTS majordhome.fum_config_composants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES core.organizations(id),
  configuration_id   uuid NOT NULL,
  ordre              integer NOT NULL,
  composant_code     text NOT NULL CHECK (composant_code ~ '^[a-z0-9_]+$'),
  libelle            text NOT NULL,
  chapitre           text,
  gammes             text[] NOT NULL DEFAULT '{}',
  troncon            text,
  repere             integer,
  statut             text NOT NULL DEFAULT 'catalogue' CHECK (statut IN ('catalogue', 'implicite', 'provisoire')),
  groupe_alternative text,
  option             text,
  regle_quantite     text,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fum_config_composants_config_fk FOREIGN KEY (configuration_id, org_id) REFERENCES majordhome.fum_configurations (id, org_id) ON DELETE CASCADE,
  CONSTRAINT fum_config_composants_config_ordre_key UNIQUE (configuration_id, ordre)
);
COMMENT ON TABLE majordhome.fum_config_composants IS
  'Fumisterie : nomenclature d''une configuration. regle_quantite ∈ unitaire | par_longueur:<troncon> | par_emboitement:<troncon> | par_plancher | coudes:<troncon> (src/lib/fumisterie/nomenclature.js). Un groupe_alternative regroupe des « ou » : une seule option est retenue.';

CREATE TABLE IF NOT EXISTS majordhome.fum_regles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES core.organizations(id),
  code              text NOT NULL,
  gamme             text,
  page              integer,
  statut            text NOT NULL DEFAULT 'catalogue' CHECK (statut IN ('catalogue', 'deduit', 'propose', 'a_completer')),
  texte             text NOT NULL,
  reference         text,
  consequence_devis text,
  bloquante         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fum_regles_org_code_key UNIQUE (org_id, code),
  CONSTRAINT fum_regles_id_org_key UNIQUE (id, org_id)
);

CREATE TABLE IF NOT EXISTS majordhome.fum_config_regles (
  org_id           uuid NOT NULL REFERENCES core.organizations(id),
  configuration_id uuid NOT NULL,
  regle_id         uuid NOT NULL,
  PRIMARY KEY (configuration_id, regle_id),
  CONSTRAINT fum_config_regles_config_fk FOREIGN KEY (configuration_id, org_id) REFERENCES majordhome.fum_configurations (id, org_id) ON DELETE CASCADE,
  CONSTRAINT fum_config_regles_regle_fk FOREIGN KEY (regle_id, org_id) REFERENCES majordhome.fum_regles (id, org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS majordhome.fum_appareils_valides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES core.organizations(id),
  gamme            text NOT NULL,
  marque           text NOT NULL,
  modele           text NOT NULL,
  configuration_id uuid,
  source           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fum_appareils_valides_config_fk FOREIGN KEY (configuration_id, org_id) REFERENCES majordhome.fum_configurations (id, org_id) ON DELETE SET NULL,
  CONSTRAINT fum_appareils_valides_key UNIQUE (org_id, gamme, marque, modele)
);

CREATE TABLE IF NOT EXISTS majordhome.fum_guide_choix (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL REFERENCES core.organizations(id),
  ligne   text NOT NULL,
  colonne text NOT NULL,
  gammes  text[] NOT NULL DEFAULT '{}',
  page    integer,
  CONSTRAINT fum_guide_choix_key UNIQUE (org_id, ligne, colonne)
);

CREATE TABLE IF NOT EXISTS majordhome.fum_composant_mapping (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES core.organizations(id),
  supplier_id         uuid NOT NULL REFERENCES majordhome.suppliers(id),
  composant_code      text NOT NULL CHECK (composant_code ~ '^[a-z0-9_]+$'),
  gamme_catalogue     text NOT NULL,
  finition            text CHECK (finition IS NULL OR finition IN ('noir', 'inox')),
  gamme_tarif         text NOT NULL,
  type_piece          text NOT NULL,
  quantite_par_unite  numeric NOT NULL DEFAULT 1 CHECK (quantite_par_unite > 0),
  motif_code          text,
  priorite            integer NOT NULL DEFAULT 100,
  statut              text NOT NULL DEFAULT 'catalogue' CHECK (statut IN ('catalogue', 'implicite', 'provisoire')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fum_composant_mapping_lookup
  ON majordhome.fum_composant_mapping (org_id, supplier_id, composant_code, gamme_catalogue);
COMMENT ON TABLE majordhome.fum_composant_mapping IS
  'Fumisterie : composant générique d''une configuration → (gamme tarif, type de pièce) chez un fournisseur. finition NULL = quelle que soit la finition. Un second fournisseur = les mêmes composants avec un autre supplier_id.';

CREATE TABLE IF NOT EXISTS majordhome.fum_metres (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES core.organizations(id),
  quote_id         uuid REFERENCES majordhome.quotes(id) ON DELETE CASCADE,
  lead_id          uuid REFERENCES majordhome.leads(id) ON DELETE SET NULL,
  configuration_id uuid NOT NULL,
  gabarit_code     text NOT NULL,
  diametre         integer NOT NULL,
  finition         text NOT NULL CHECK (finition IN ('noir', 'inox')),
  releve           jsonb NOT NULL,
  resultat         jsonb NOT NULL,
  engine_version   text NOT NULL,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fum_metres_config_fk FOREIGN KEY (configuration_id, org_id) REFERENCES majordhome.fum_configurations (id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_fum_metres_quote ON majordhome.fum_metres (quote_id);
COMMENT ON TABLE majordhome.fum_metres IS
  'Fumisterie : relevé + résultat FIGÉ d''un métré (lignes, alertes, géométrie, engine_version). Un devis rouvert relit resultat, ne recalcule pas (même règle que thermal_studies.results).';

-- updated_at
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fum_article_attrs','fum_gabarits','fum_configurations','fum_composant_mapping','fum_metres'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON majordhome.%1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON majordhome.%1$s FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at()', t);
  END LOOP;
END;
$$;

-- RLS : lecture membre partout ; écriture org_admin sur le paramétrage ; fum_metres écrit par tout membre.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fum_article_attrs','fum_gabarits','fum_configurations','fum_config_composants','fum_regles',
                           'fum_config_regles','fum_appareils_valides','fum_guide_choix','fum_composant_mapping','fum_metres'] LOOP
    EXECUTE format('ALTER TABLE majordhome.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON majordhome.%1$s', t);
    EXECUTE format($p$CREATE POLICY %1$s_select ON majordhome.%1$s FOR SELECT TO authenticated
      USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())))$p$, t);
    EXECUTE format('REVOKE ALL ON majordhome.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON majordhome.%I TO authenticated, service_role', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['fum_gabarits','fum_configurations','fum_config_composants','fum_regles',
                           'fum_config_regles','fum_appareils_valides','fum_guide_choix','fum_composant_mapping'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write_admin ON majordhome.%1$s', t);
    EXECUTE format($p$CREATE POLICY %1$s_write_admin ON majordhome.%1$s FOR ALL TO authenticated
      USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid()) AND om.role = 'org_admin'))
      WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid()) AND om.role = 'org_admin'))$p$, t);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON majordhome.%I TO authenticated', t);
  END LOOP;
END;
$$;
DROP POLICY IF EXISTS fum_metres_write_member ON majordhome.fum_metres;
CREATE POLICY fum_metres_write_member ON majordhome.fum_metres FOR ALL TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
GRANT INSERT, UPDATE, DELETE ON majordhome.fum_metres TO authenticated;
-- fum_article_attrs : écrit par l'import (service_role / SQL), jamais par l'app.

-- Vues publiques : miroirs updatable
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fum_article_attrs','fum_gabarits','fum_configurations','fum_config_composants','fum_regles',
                           'fum_config_regles','fum_appareils_valides','fum_guide_choix','fum_composant_mapping','fum_metres'] LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.majordhome_%I', t);
    EXECUTE format('CREATE VIEW public.majordhome_%1$I WITH (security_invoker = true) AS SELECT * FROM majordhome.%1$I', t);
    EXECUTE format('REVOKE ALL ON public.majordhome_%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_%I TO authenticated', t);
    EXECUTE format('GRANT SELECT ON public.majordhome_%I TO service_role', t);
  END LOOP;
END;
$$;

-- Articles de fumisterie = catalogue × attributs (lecture seule, c'est ce que le moteur consomme)
DROP VIEW IF EXISTS public.majordhome_fum_articles;
CREATE VIEW public.majordhome_fum_articles WITH (security_invoker = true) AS
  SELECT p.id, p.org_id, p.supplier_id, p.reference, p.name, p.unit, p.is_active,
         p.tarif_public, p.purchase_price_ht, p.selling_price_ht, p.default_tva_rate, p.ledger_account_pl_id,
         a.gamme_tarif, a.type_piece, a.diametre_int, a.diametre_ext, a.longueur_mm, a.longueur_max_mm,
         a.angle, a.pente_min, a.pente_max, a.couleur, a.version, a.sur_mesure, a.hors_perimetre,
         a.parse_confidence, a.source_version
    FROM majordhome.supplier_products p
    JOIN majordhome.fum_article_attrs a ON a.supplier_product_id = p.id;
REVOKE ALL ON public.majordhome_fum_articles FROM anon;
GRANT SELECT ON public.majordhome_fum_articles TO authenticated, service_role;
