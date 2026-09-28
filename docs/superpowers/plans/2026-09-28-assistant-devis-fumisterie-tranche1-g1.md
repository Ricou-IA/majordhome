# Assistant de devis fumisterie — tranche 1 (G1 de bout en bout) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Philippe fait sur tablette un devis complet de poêle bois bûche avec création de conduit intérieur PTR30 (configuration CFG-24, gabarit G1) : relevé sur coupe cotée → pièces MODINOX chiffrées → devis MDH → envoi Pennylane → devis rattaché au lead, sans ressaisie.

**Architecture:** Données en base (`majordhome.fum_*` + tarif MODINOX importé dans `supplier_products`), moteur JavaScript pur `src/lib/fumisterie/` (porté de la maquette, 100 % piloté par les données, testé `node --test`), écran de métré branché dans le flux devis existant (`CreateDevisModal` → section FUMISTERIE), sortie par `pennylaneService.pushQuote` + `lead_attach_quotes_and_send`.

**Tech Stack:** React 18 + Vite, Supabase (PostgreSQL, RLS, vues `security_invoker`), TanStack Query v5, Tailwind, exceljs (script d'import), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-28-assistant-devis-fumisterie-design.md` (lire aussi `docs/devis-fumisterie/MAQUETTE_metre_svg.md` et `maquette_metre_ptr30.html`, dont le moteur est porté tel quel).

## Global Constraints

- Toute table `majordhome.*` : `org_id NOT NULL` FK `core.organizations`, RLS activée dès la création, vue publique `majordhome_fum_*` `WITH (security_invoker = true)`, `GRANT SELECT … TO service_role`, `REVOKE ALL … FROM anon`. Filtre `.eq('org_id', orgId)` explicite côté front. `org_id` = org **CORE** (`3c68193e-783b-4aa9-bc0d-fb2ce21e99b1` pour Mayer, comme `supplier_products`).
- Migration versionnée `supabase/migrations/20260929_N_*.sql`, **répétée** sur `scripts/migration-rehearsal/` (étendre `TABLES`/`VIEWS` de `snapshot.mjs`) avant `apply_migration` via le MCP Supabase (projet `ejqqqwudmizqisdkxohw`).
- Services : `{ data, error }`, jamais throw ; hooks : `unwrapResult()` dans chaque `mutationFn`, cache keys dans `cacheKeys.js` avec `orgId` en 1ᵉʳ paramètre, `enabled: !!orgId`.
- Moteur `src/lib/fumisterie/` : **aucun** import React/Supabase/alias, JSDoc sur chaque export, **aucune** valeur de tarif ni de code article en dur (tout vient des paramètres).
- Config d'org : `settings.fumisterie` via `useOrgSettings().save({ fumisterie })` avec l'objet **complet** ; défauts dans `src/lib/fumisterie/config.js` ; onglet Settings déclaré dans `src/lib/modules.js` + icône dans `ICONS` de `pages/Settings.jsx`.
- Prix : `unit_price_ht` = `tarif_public` ; `purchase_price_ht` = « Prix pour client » du tarif (prix net Mayer). Jamais recalculer une remise.
- Rien n'est avalé : article introuvable / sur-mesure → ligne visible à prix `null` + alerte `article_manquant`.
- Palette : tokens `primary-*` (jaune) / `secondary-*` (bleu-gris) ; jamais rouge/vert seuls ; couleur + icône + libellé.
- Pas de `console.*` : `logger` de `@lib/logger`. Pas de composant > 500 LOC. Commandes terminal : PowerShell (le Bash tool reste utilisable pour `git`/`node`).
- Après chaque tâche : `npm run lint:errors` propre ; avant la fin : `npm run audit:quality` et `npx vite build`.

---

## Vue d'ensemble des fichiers

**Créés**
- `supabase/migrations/20260929_1_fumisterie_tables.sql` — tables `fum_*`, vues, RLS, grants
- `scripts/migration-rehearsal/assert-fumisterie.sql` — assertions de la migration
- `scripts/fumisterie/lib/parseDesignation.mjs` — parseur pur d'une ligne du tarif → attributs
- `scripts/fumisterie/parse-designation.test.mjs`
- `scripts/fumisterie/import-tarif-modinox.mjs` — xlsx → SQL d'upsert (chunks) + rapport
- `scripts/fumisterie/seed-configurations.mjs` — JSON bibliothèque + enrichissements CFG-24 → SQL
- `scripts/fumisterie/data/gabarit-g1.json`, `scripts/fumisterie/data/cfg24-composants.json`, `scripts/fumisterie/data/cfg24-mapping.json`
- `src/lib/fumisterie/config.js` — `DEFAULTS_FUMISTERIE`, `buildFumisterieConfig(settings)`
- `src/lib/fumisterie/compose.js`, `gabarits/g1.js`, `controles.js`, `articles.js`, `nomenclature.js`, `index.js`
- `scripts/fumisterie/fixtures/g1-o150.mjs`, `compose.test.mjs`, `g1.test.mjs`, `controles.test.mjs`, `nomenclature.test.mjs`
- `src/shared/services/fumisterie.service.js`, `src/shared/hooks/useFumisterie.js`
- `src/apps/artisan/components/devis/metre/MetreFumisterie.jsx`, `QualificationStep.jsx`, `ReleveStep.jsx`, `ReleveForm.jsx`, `CoupeCotee.jsx`, `ListePieces.jsx`, `useMetreDraft.js`
- `src/apps/artisan/pages/settings/entretiens/FumisterieTab.jsx`, `src/apps/artisan/pages/settings/FumisterieSettings.jsx`

**Modifiés**
- `scripts/migration-rehearsal/snapshot.mjs` (TABLES : `suppliers`, `supplier_products` DDL seul ; VIEWS : `public.majordhome_supplier_products`)
- `package.json` (`audit:quality` : tests fumisterie)
- `src/shared/hooks/cacheKeys.js` (`fumisterieKeys`)
- `src/lib/modules.js`, `src/apps/artisan/pages/Settings.jsx` (ICONS), `src/apps/artisan/routes.jsx`
- `src/apps/artisan/components/devis/DevisStepLines.jsx` (bouton « Métré assisté » sur la section FUMISTERIE)
- `src/apps/artisan/components/devis/CreateDevisModal.jsx` (état `metre`, sauvegarde après création)
- `src/apps/artisan/components/devis/DevisStepSummary.jsx` (marge fournitures)
- `src/apps/artisan/components/devis/DevisModal.jsx` (bouton « Envoyer dans Pennylane »)
- `src/shared/services/devis.service.js` (`markPushedToPennylane`), `src/shared/hooks/useDevis.js` (mutation `pushToPennylane`)
- `.gitignore` (`scripts/fumisterie/out/`)

---

### Task 1 : Migration des tables `fum_*`

**Files:**
- Create: `supabase/migrations/20260929_1_fumisterie_tables.sql`
- Create: `scripts/migration-rehearsal/assert-fumisterie.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs:26-53` (TABLES) et `:84-98` (VIEWS)

**Interfaces:**
- Produces: tables `majordhome.fum_article_attrs`, `fum_gabarits`, `fum_configurations`, `fum_config_composants`, `fum_regles`, `fum_config_regles`, `fum_appareils_valides`, `fum_guide_choix`, `fum_composant_mapping`, `fum_metres` ; vues `public.majordhome_fum_*` (miroirs updatable) + `public.majordhome_fum_articles` (JOIN `supplier_products` × `fum_article_attrs`, lecture seule).

- [ ] **Step 1 : Écrire la migration**

```sql
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
```

- [ ] **Step 2 : Étendre le harnais de répétition**

Dans `scripts/migration-rehearsal/snapshot.mjs`, ajouter à `TABLES` (après `majordhome.organizations`) :

```js
  { schema: 'majordhome', table: 'suppliers', columns: null, data: false }, // 20260929_1 : FK fum_composant_mapping
  { schema: 'majordhome', table: 'supplier_products', columns: null, data: false }, // 20260929_1 : FK fum_article_attrs + vue majordhome_fum_articles
  { schema: 'majordhome', table: 'quotes', columns: null, data: false }, // 20260929_1 : FK fum_metres
```

`quotes` référence `leads` (déjà listée, DDL seul) et `clients` : vérifier avec `node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local` que le chargement passe ; si une FK de `quotes` vise une table absente, ajouter cette table en `data: false`.

- [ ] **Step 3 : Écrire les assertions**

```sql
-- scripts/migration-rehearsal/assert-fumisterie.sql — vérifie 20260929_1_fumisterie_tables.sql.
DO $$
DECLARE n int; r record;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relrowsecurity AND c.relname LIKE 'fum\_%';
  IF n <> 10 THEN RAISE EXCEPTION 'RLS activée sur % table(s) fum_* au lieu de 10', n; END IF;

  FOR r IN SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname LIKE 'majordhome\_fum\_%' AND c.relkind = 'v' LOOP
    IF coalesce(r.reloptions::text, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue % sans security_invoker', r.relname; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'majordhome\_fum\_%';
  IF n <> 11 THEN RAISE EXCEPTION '% vue(s) majordhome_fum_* au lieu de 11', n; END IF;

  SELECT count(*) INTO n FROM information_schema.views
   WHERE table_schema = 'public' AND table_name IN ('majordhome_fum_configurations','majordhome_fum_metres','majordhome_fum_composant_mapping')
     AND is_updatable = 'YES';
  IF n <> 3 THEN RAISE EXCEPTION '% vue(s) updatable(s) au lieu de 3', n; END IF;

  IF has_table_privilege('anon', 'majordhome.fum_metres', 'SELECT') THEN RAISE EXCEPTION 'anon lit fum_metres'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.fum_article_attrs', 'SELECT') THEN RAISE EXCEPTION 'service_role ne lit pas fum_article_attrs'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.fum_article_attrs', 'INSERT') THEN RAISE EXCEPTION 'authenticated écrit fum_article_attrs'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'fum_configurations';
  IF n <> 2 THEN RAISE EXCEPTION 'fum_configurations : % policies au lieu de 2', n; END IF;
  RAISE NOTICE 'assert-fumisterie OK';
END;
$$;
```

- [ ] **Step 4 : Répéter la migration**

Run:
```bash
node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260929_1_fumisterie_tables.sql --assert scripts/migration-rehearsal/assert-fumisterie.sql
```
Expected: `assert-fumisterie OK`. Si `relation does not exist` → une table/vue manque dans `snapshot.mjs` (l'ajouter, ne pas contourner).

- [ ] **Step 5 : Appliquer en prod**

Via le MCP Supabase `apply_migration` (project `ejqqqwudmizqisdkxohw`, name `20260929_1_fumisterie_tables`, query = contenu du fichier). Vérifier :
```sql
select count(*) from pg_views where schemaname='public' and viewname like 'majordhome\_fum\_%'; -- 11
select has_table_privilege('service_role','majordhome.fum_article_attrs','SELECT'); -- true
```

- [ ] **Step 6 : Commit**

```bash
git add supabase/migrations/20260929_1_fumisterie_tables.sql scripts/migration-rehearsal/assert-fumisterie.sql scripts/migration-rehearsal/snapshot.mjs
git commit -m "feat(fumisterie): tables fum_* (configurations, gabarits, mapping, métrés) + vue articles"
```

---

### Task 2 : Parseur de désignation du tarif (module pur)

**Files:**
- Create: `scripts/fumisterie/lib/parseDesignation.mjs`
- Test: `scripts/fumisterie/parse-designation.test.mjs`

**Interfaces:**
- Produces: `parseDesignation({ reference, designation, famille_n1 })` → `{ gamme_tarif, type_piece, diametre_int, diametre_ext, longueur_mm, longueur_max_mm, angle, pente_min, pente_max, couleur, version, sur_mesure, hors_perimetre, parse_confidence, parse_notes }` ; `normaliserGamme(texte)`.

- [ ] **Step 1 : Écrire le test**

```js
// scripts/fumisterie/parse-designation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignation, normaliserGamme } from './lib/parseDesignation.mjs';

const p = (designation, extra = {}) => parseDesignation({ reference: 'X', designation, famille_n1: '20', ...extra });

test('élément droit PTR30+ inox : gamme, type, diamètre, longueur, couleur par suffixe de gamme', () => {
  const r = p('PTR30+ I - ELT DROIT - D 150 - LG 1000');
  assert.equal(r.gamme_tarif, 'PTR30+ I');
  assert.equal(r.type_piece, 'element_droit');
  assert.equal(r.diametre_int, 150);
  assert.equal(r.longueur_mm, 1000);
  assert.equal(r.couleur, 'inox');
  assert.equal(r.parse_confidence, 1);
});

test('laqué noir : couleur noir, réglable avec plage', () => {
  const r = p('PTR30+ LAQ - ELT REGLABLE - D 150 - LG 320 A 500 - INOX NOIR');
  assert.equal(r.gamme_tarif, 'PTR30+ LAQ');
  assert.equal(r.type_piece, 'element_reglable');
  assert.equal(r.longueur_mm, 320);
  assert.equal(r.longueur_max_mm, 500);
  assert.equal(r.couleur, 'noir');
});

test('diamètre extérieur entre parenthèses, couronne coupe-feu galva', () => {
  const r = p('PTR30+ G - COURONNE COUPE FEU - D 150 ( D EXT 210 )');
  assert.equal(r.type_piece, 'couronne_coupe_feu');
  assert.equal(r.diametre_int, 150);
  assert.equal(r.diametre_ext, 210);
  assert.equal(r.couleur, 'galva');
});

test('coude : angle, avec ou sans symbole degré', () => {
  assert.equal(p('PTR30+ I - COUDE 30° - D 150').angle, 30);
  assert.equal(p('PTR30+ I - COUDE 30 - D 150').angle, 30);
  assert.equal(p('PTR30+ I - COUDE 30° - D 150').type_piece, 'coude');
});

test('solin : gamme sans la plage, pente min/max, diamètre du PTR', () => {
  const r = p('SOLIN 25 A 35° INOX - PTR D 150 - FUT HT 250 ARRIERE ', { famille_n1: '27' });
  assert.equal(r.gamme_tarif, 'SOLIN INOX');
  assert.equal(r.type_piece, 'solin');
  assert.equal(r.pente_min, 25);
  assert.equal(r.pente_max, 35);
  assert.equal(r.diametre_int, 150);
});

test('collier universel : gamme normalisée (point et espaces parasites), galva', () => {
  const a = p('COLLIER UNIVERSEL (SOUS TOIT) - D 150 (PLA100 & SP150/153) - GALVA');
  const b = p('COLLIER UNIVERSEL (SOUS TOIT.) - D 180 - GALVA');
  assert.equal(a.gamme_tarif, b.gamme_tarif);
  assert.equal(a.type_piece, 'collier_sous_toiture');
  assert.equal(a.diametre_int, 150);
  assert.equal(a.couleur, 'galva');
});

test('raccord simple paroi réduit : premier diamètre = 150', () => {
  const r = p('PTR30+ I - RACCORD SIMPLE PAROI REDUIT - D 150 / D 148 ( POUR TUYAU EMAILLE D 150 )');
  assert.equal(r.type_piece, 'raccord_simple_paroi');
  assert.equal(r.diametre_int, 150);
});

test('tuyau émaillé : type element_droit, noir, gamme avec espace final normalisée', () => {
  const r = p('EMAIL LIGNE +  - TUYAU - D 150 - LG 500 - NOIR - REF.NNO1501');
  assert.equal(r.gamme_tarif, 'EMAIL LIGNE +');
  assert.equal(r.type_piece, 'element_droit');
  assert.equal(r.couleur, 'noir');
  assert.equal(r.longueur_mm, 500);
});

test('sur mesure et hors périmètre', () => {
  assert.equal(p('PTR30+ LAQ - ELT DROIT - D 150 - LG 1000 - RAL : XXXX').sur_mesure, true);
  assert.equal(p('POLYLISSE 904L - FLEXIBLE - D 80', { famille_n1: '24' }).hors_perimetre, true);
  assert.equal(p('POLYPROP - TUYAU - D 80', { famille_n1: '22' }).hors_perimetre, true);
  assert.equal(p('PTR30+ I - ELT DROIT - D 150 - LG 1000').hors_perimetre, false);
});

test('type inconnu : confiance dégradée et note', () => {
  const r = p('DIVERS - BIDULE - D 150');
  assert.equal(r.type_piece, null);
  assert.equal(r.parse_confidence, 0.6);
  assert.match(r.parse_notes, /type_piece/);
});

test('normaliserGamme', () => {
  assert.equal(normaliserGamme(' PRH 6/10 '), 'PRH 6/10');
  assert.equal(normaliserGamme('COLLIER  UNIVERSEL (SOUS TOIT.)'), 'COLLIER UNIVERSEL (SOUS TOIT)');
});
```

- [ ] **Step 2 : Lancer le test (échec attendu)**

Run: `node --test scripts/fumisterie/parse-designation.test.mjs`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Écrire le parseur**

```js
// scripts/fumisterie/lib/parseDesignation.mjs
// ============================================================================
// Parseur PUR d'une ligne du tarif fournisseur (MAYER002, MODINOX/ALTEMA 2026) :
// « GAMME - COMPOSANT - attributs » → attributs de fum_article_attrs.
// Aucune dépendance. Testé : scripts/fumisterie/parse-designation.test.mjs.
// Tout ce qui n'est pas reconnu baisse parse_confidence et s'écrit dans parse_notes :
// le rapport d'import liste ces lignes, on ne les avale pas.
// ============================================================================

/** Ordre = priorité : première expression qui matche. */
const TYPES_PIECE = [
  ['chapeau_anti_refouleur', /CHAPEAU ANTI[ -]?REFOULEUR/],
  ['chapeau', /\bCHAPEAU\b/],
  ['element_reglable', /ELT REGLABLE|ELEMENT REGLABLE|COULISSANT/],
  ['element_droit', /ELT DROIT|ELEMENT DROIT|\bTUYAU\b|\bTUBE\b/],
  ['coude', /\bCOUDE\b/],
  ['te', /\bTE\b\s*\d*/],
  ['collier_jonction', /COLLIER DE JONCTION/],
  ['collier_sous_toiture', /COLLIER UNIVERSEL/],
  ['collier_mural', /COLLIER MURAL/],
  ['collier', /\bCOLLIER\b/],
  ['couronne_coupe_feu', /COURONNE COUPE[ -]?FEU/],
  ['plaque_proprete', /PLAQUE DE PROPRETE/],
  ['plaque_habillage', /PLAQUE (D )?HAB/],
  ['raccord_simple_paroi', /RACCORD SIMPLE PAROI/],
  ['solin', /\bSOLIN\b/],
  ['collerette', /COLLERETTE/],
  ['support_mural', /SUPPORT MURAL/],
  ['support', /\bSUPPORT\b/],
  ['purge', /\bPURGE\b/],
  ['manchon', /\bMANCHON\b/],
  ['kit', /\bKIT\b/],
  ['plaque', /\bPLAQUE\b/],
];

const HORS_PERIMETRE = /\bGAZ\b|FIOUL|CHARBON|904L|ALUMINI|POLYPROP/;
const SUR_MESURE = /RAL\s*:\s*X|A PRECISER|\.{3}|…|\bD XXX\b|SUR MESURE/i;

/** Gamme nettoyée : espaces multiples, point final de parenthèse, espaces de bord. */
export function normaliserGamme(texte) {
  return String(texte || '')
    .replace(/\s+/g, ' ')
    .replace(/\.\)/g, ')')
    .trim()
    .toUpperCase();
}

function couleurDe(segments, gamme) {
  const tout = segments.join(' ');
  if (/INOX NOIR|\bNOIR\b/.test(tout)) return 'noir';
  if (/\bBLANC\b/.test(tout)) return 'blanc';
  if (/\bRAL\b/.test(tout)) return 'ral';
  if (/\bGALVA\b/.test(tout) || /\bG\b$/.test(gamme) || /\bG LAQ$/.test(gamme)) return 'galva';
  if (/\bINOX\b/.test(tout) || /\bI$/.test(gamme) || /INOX/.test(gamme)) return 'inox';
  return null;
}

/**
 * @param {{ reference: string, designation: string, famille_n1?: string|number|null }} ligne
 */
export function parseDesignation({ designation, famille_n1 }) {
  const texte = String(designation || '').replace(/\u00A0/g, ' ');
  const segments = texte.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const notes = [];
  let gamme = normaliserGamme(segments[0] || '');
  const reste = segments.slice(1).join(' - ').toUpperCase();
  const tout = texte.toUpperCase();

  // Solin : la plage de pente est dans le 1er segment, la gamme est « SOLIN <finition> »
  let pente_min = null; let pente_max = null;
  const solin = gamme.match(/^SOLIN\s+(\d{1,2})\s*A\s*(\d{1,2})\s*°?\s*(.*)$/);
  if (solin) {
    pente_min = Number(solin[1]); pente_max = Number(solin[2]);
    gamme = normaliserGamme(`SOLIN ${solin[3]}`);
  } else {
    const pente = reste.match(/PENTE\s*(\d{1,2})\s*A\s*(\d{1,2})/);
    if (pente) { pente_min = Number(pente[1]); pente_max = Number(pente[2]); }
  }

  let type_piece = null;
  for (const [code, re] of TYPES_PIECE) { if (re.test(tout)) { type_piece = code; break; } }
  if (!type_piece) notes.push('type_piece non reconnu');

  const dInt = tout.match(/\bD\s*(\d{2,3})\b/);
  const dExt = tout.match(/D\s*EXT\s*(\d{2,3})/);
  const lg = tout.match(/\b(?:LG|L)\s*(\d{3,4})(?:\s*A\s*(\d{3,4}))?/);
  const angle = tout.match(/COUDE\s*(\d{2,3})/);
  const version = tout.match(/\bV(\d)\b/);

  const diametre_int = dInt ? Number(dInt[1]) : null;
  if (!diametre_int) notes.push('diametre absent');

  const parse_confidence = type_piece && diametre_int ? 1 : (type_piece || diametre_int ? 0.6 : 0.3);

  return {
    gamme_tarif: gamme,
    type_piece,
    diametre_int,
    diametre_ext: dExt ? Number(dExt[1]) : null,
    longueur_mm: lg ? Number(lg[1]) : null,
    longueur_max_mm: lg && lg[2] ? Number(lg[2]) : null,
    angle: angle ? Number(angle[1]) : null,
    pente_min,
    pente_max,
    couleur: couleurDe(segments.slice(1), gamme),
    version: version ? `V${version[1]}` : null,
    sur_mesure: SUR_MESURE.test(texte),
    hors_perimetre: String(famille_n1 ?? '') === '22' || HORS_PERIMETRE.test(tout),
    parse_confidence,
    parse_notes: notes.length ? notes.join(' ; ') : null,
  };
}
```

- [ ] **Step 4 : Lancer le test**

Run: `node --test scripts/fumisterie/parse-designation.test.mjs`
Expected: PASS (11 tests). Ajuster les regex si un cas échoue ; ne pas affaiblir les assertions.

- [ ] **Step 5 : Commit**

```bash
git add scripts/fumisterie/lib/parseDesignation.mjs scripts/fumisterie/parse-designation.test.mjs
git commit -m "feat(fumisterie): parseur pur des désignations du tarif MODINOX"
```

---

### Task 3 : Import du tarif MAYER002 dans le catalogue

**Files:**
- Create: `scripts/fumisterie/import-tarif-modinox.mjs`
- Modify: `.gitignore` (ajouter `scripts/fumisterie/out/`)

**Interfaces:**
- Consumes: `parseDesignation`.
- Produces: `scripts/fumisterie/out/modinox_2026_partNN.sql` (upsert `supplier_products` + `fum_article_attrs`), `scripts/fumisterie/out/rapport-import.md`. Fournisseur « MODINOX / ALTEMA » créé par la première partie.

- [ ] **Step 1 : Écrire le script**

```js
// scripts/fumisterie/import-tarif-modinox.mjs
// ============================================================================
// Tarif MODINOX/ALTEMA (docs/devis-fumisterie/MAYER002.xlsx, onglet « Tarif Juin26 »)
// → SQL d'upsert REJOUABLE dans majordhome.supplier_products (fournisseur « MODINOX / ALTEMA »)
//   + majordhome.fum_article_attrs, en morceaux appliqués via le MCP Supabase (execute_sql).
// Prix : selling_price_ht = tarif_public = « TARIF 06/26 » ; purchase_price_ht = « Prix pour client »
// (prix net Mayer, remises incluses — JAMAIS recalculé). Un article absent du fichier passe
// is_active=false (jamais supprimé). Échoue bruyamment sur colonne manquante ou prix vide.
// Usage : node scripts/fumisterie/import-tarif-modinox.mjs [--org 3c68193e-...] [--version modinox_2026-06]
// ============================================================================
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesignation } from './lib/parseDesignation.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const VERSION = opt('--version', 'modinox_2026-06');
const XLSX = path.join(racine, 'docs', 'devis-fumisterie', 'MAYER002.xlsx');
const OUT = path.join(racine, 'scripts', 'fumisterie', 'out');
const TAILLE_CHUNK = 800;

const COLONNES = ['Références articles', 'Désignation Article', 'Famille N1', 'Libellé Fam. N1', 'Famille N2',
  'Libellé Fam. N2', 'Famille N3', 'Famille N4', 'Unité de vente', 'EAN', 'TARIF 06/26', 'Remise à la famille',
  "Remise à l'article", 'Prix net', 'Prix pour client'];

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 'NULL' : String(Number(v)));
const cell = (row, i) => { const v = row.getCell(i + 1).value; return v && typeof v === 'object' && 'result' in v ? v.result : v; };

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);
const ws = wb.getWorksheet('Tarif Juin26');
if (!ws) throw new Error('Onglet « Tarif Juin26 » introuvable');
const entete = COLONNES.map((_, i) => String(cell(ws.getRow(1), i) ?? '').trim());
COLONNES.forEach((c, i) => { if (entete[i] !== c) throw new Error(`Colonne ${i + 1} attendue « ${c} », lue « ${entete[i]} »`); });

const lignes = [];
const rapport = { total: 0, horsPerimetre: 0, surMesure: 0, ml: 0, nonParse: [], sansPrix: [] };
ws.eachRow((row, idx) => {
  if (idx === 1) return;
  const ref = String(cell(row, 0) ?? '').trim();
  if (!ref) return;
  rapport.total++;
  const designation = String(cell(row, 1) ?? '').trim();
  const l = {
    reference: ref, designation,
    famille_n1: String(cell(row, 2) ?? ''), libelle_n1: cell(row, 3), famille_n2: String(cell(row, 4) ?? ''), libelle_n2: cell(row, 5),
    famille_n3: cell(row, 6) == null ? null : String(cell(row, 6)), famille_n4: cell(row, 7) == null ? null : String(cell(row, 7)),
    unite: String(cell(row, 8) ?? 'PC'), ean: cell(row, 9) == null ? null : String(cell(row, 9)),
    tarif_public: Number(cell(row, 10)), prix_client: Number(cell(row, 14)), taux_remise: cell(row, 11),
  };
  if (!Number.isFinite(l.tarif_public) || !Number.isFinite(l.prix_client)) { rapport.sansPrix.push(ref); return; }
  l.attrs = parseDesignation(l);
  if (l.attrs.hors_perimetre) rapport.horsPerimetre++;
  if (l.attrs.sur_mesure) rapport.surMesure++;
  if (l.unite === 'ML') rapport.ml++;
  if (l.attrs.parse_confidence < 1) rapport.nonParse.push(`${ref} | ${designation} | ${l.attrs.parse_notes}`);
  lignes.push(l);
});
if (rapport.sansPrix.length) throw new Error(`${rapport.sansPrix.length} lignes sans prix : ${rapport.sansPrix.slice(0, 10).join(', ')}`);

mkdirSync(OUT, { recursive: true });
const gammeAffichee = (l) => l.attrs.gamme_tarif;
const uniteApp = (u) => (u === 'ML' ? 'ml' : 'pièce');
const morceaux = [];
for (let i = 0; i < lignes.length; i += TAILLE_CHUNK) morceaux.push(lignes.slice(i, i + TAILLE_CHUNK));

morceaux.forEach((chunk, k) => {
  const sql = [];
  sql.push(`-- Import tarif ${VERSION} — partie ${k + 1}/${morceaux.length} (${chunk.length} articles). Rejouable.`);
  sql.push(`DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = 'MODINOX / ALTEMA';
  IF v_sup IS NULL THEN
    INSERT INTO majordhome.suppliers (org_id, name, notes, is_active) VALUES (v_org, 'MODINOX / ALTEMA', 'Conduits de fumée — tarif importé par scripts/fumisterie/import-tarif-modinox.mjs', true) RETURNING id INTO v_sup;
  END IF;
  CREATE TEMP TABLE t_imp (reference text, name text, code_famille text, gamme text, code_ean text, tarif_public numeric, taux_remise numeric,
    purchase_price_ht numeric, unit text, diametre text,
    famille_n1 text, libelle_n1 text, famille_n2 text, libelle_n2 text, famille_n3 text, famille_n4 text, gamme_tarif text, type_piece text,
    diametre_int int, diametre_ext int, longueur_mm int, longueur_max_mm int, angle int, pente_min int, pente_max int, couleur text, version text,
    sur_mesure bool, hors_perimetre bool, parse_confidence numeric, parse_notes text) ON COMMIT DROP;
  INSERT INTO t_imp VALUES`);
  sql.push(chunk.map((l) => `(${[q(l.reference), q(l.designation), q(l.famille_n2), q(gammeAffichee(l)), q(l.ean), n(l.tarif_public), n(l.taux_remise),
    n(l.prix_client), q(uniteApp(l.unite)), l.attrs.diametre_int == null ? 'NULL' : q(String(l.attrs.diametre_int)),
    q(l.famille_n1), q(l.libelle_n1), q(l.famille_n2), q(l.libelle_n2), q(l.famille_n3), q(l.famille_n4), q(l.attrs.gamme_tarif), q(l.attrs.type_piece),
    n(l.attrs.diametre_int), n(l.attrs.diametre_ext), n(l.attrs.longueur_mm), n(l.attrs.longueur_max_mm), n(l.attrs.angle), n(l.attrs.pente_min), n(l.attrs.pente_max),
    q(l.attrs.couleur), q(l.attrs.version), l.attrs.sur_mesure, l.attrs.hors_perimetre, n(l.attrs.parse_confidence), q(l.attrs.parse_notes)].join(',')})`).join(',\n') + ';');
  sql.push(`
  UPDATE majordhome.supplier_products p SET name = t.name, code_famille = t.code_famille, gamme = t.gamme, code_ean = t.code_ean,
    tarif_public = t.tarif_public, taux_remise = t.taux_remise, purchase_price_ht = t.purchase_price_ht, selling_price_ht = t.tarif_public,
    unit = t.unit, diametre = t.diametre, category = 'fumisterie', product_kind = 'main', is_active = NOT t.hors_perimetre, updated_at = now()
  FROM t_imp t WHERE p.supplier_id = v_sup AND p.reference = t.reference;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, category, code_famille, gamme, code_ean, tarif_public, taux_remise,
    purchase_price_ht, selling_price_ht, default_tva_rate, unit, diametre, product_kind, is_active)
  SELECT v_sup, v_org, t.reference, t.name, 'fumisterie', t.code_famille, t.gamme, t.code_ean, t.tarif_public, t.taux_remise,
    t.purchase_price_ht, t.tarif_public, 20, t.unit, t.diametre, 'main', NOT t.hors_perimetre
  FROM t_imp t WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p WHERE p.supplier_id = v_sup AND p.reference = t.reference);
  INSERT INTO majordhome.fum_article_attrs (supplier_product_id, org_id, famille_n1, libelle_n1, famille_n2, libelle_n2, famille_n3, famille_n4,
    gamme_tarif, type_piece, diametre_int, diametre_ext, longueur_mm, longueur_max_mm, angle, pente_min, pente_max, couleur, version,
    sur_mesure, hors_perimetre, parse_confidence, parse_notes, source_version)
  SELECT p.id, v_org, t.famille_n1, t.libelle_n1, t.famille_n2, t.libelle_n2, t.famille_n3, t.famille_n4,
    t.gamme_tarif, t.type_piece, t.diametre_int, t.diametre_ext, t.longueur_mm, t.longueur_max_mm, t.angle, t.pente_min, t.pente_max, t.couleur, t.version,
    t.sur_mesure, t.hors_perimetre, t.parse_confidence, t.parse_notes, '${VERSION}'
  FROM t_imp t JOIN majordhome.supplier_products p ON p.supplier_id = v_sup AND p.reference = t.reference
  ON CONFLICT (supplier_product_id) DO UPDATE SET famille_n1 = EXCLUDED.famille_n1, libelle_n1 = EXCLUDED.libelle_n1, famille_n2 = EXCLUDED.famille_n2,
    libelle_n2 = EXCLUDED.libelle_n2, famille_n3 = EXCLUDED.famille_n3, famille_n4 = EXCLUDED.famille_n4, gamme_tarif = EXCLUDED.gamme_tarif,
    type_piece = EXCLUDED.type_piece, diametre_int = EXCLUDED.diametre_int, diametre_ext = EXCLUDED.diametre_ext, longueur_mm = EXCLUDED.longueur_mm,
    longueur_max_mm = EXCLUDED.longueur_max_mm, angle = EXCLUDED.angle, pente_min = EXCLUDED.pente_min, pente_max = EXCLUDED.pente_max,
    couleur = EXCLUDED.couleur, version = EXCLUDED.version, sur_mesure = EXCLUDED.sur_mesure, hors_perimetre = EXCLUDED.hors_perimetre,
    parse_confidence = EXCLUDED.parse_confidence, parse_notes = EXCLUDED.parse_notes, source_version = EXCLUDED.source_version, updated_at = now();
END $$;`);
  writeFileSync(path.join(OUT, `modinox_2026_part${String(k + 1).padStart(2, '0')}.sql`), sql.join('\n'), 'utf8');
});

// Dernière partie : désactiver les articles MODINOX absents du fichier
writeFileSync(path.join(OUT, 'modinox_2026_part99_desactivation.sql'), `-- Articles MODINOX absents du tarif ${VERSION} → is_active=false (jamais supprimés)
UPDATE majordhome.supplier_products p SET is_active = false, updated_at = now()
FROM majordhome.suppliers s
WHERE s.id = p.supplier_id AND s.org_id = '${ORG}' AND s.name = 'MODINOX / ALTEMA' AND p.is_active
  AND NOT EXISTS (SELECT 1 FROM majordhome.fum_article_attrs a WHERE a.supplier_product_id = p.id AND a.source_version = '${VERSION}');
`, 'utf8');

writeFileSync(path.join(OUT, 'rapport-import.md'), `# Rapport d'import ${VERSION}

- Lignes lues : ${rapport.total} · morceaux SQL : ${morceaux.length}
- Hors périmètre (gaz/fioul/charbon, famille 22) → is_active=false : ${rapport.horsPerimetre}
- Sur mesure (jamais chiffrés automatiquement) : ${rapport.surMesure}
- Unité ML (prix au mètre) : ${rapport.ml}
- Lignes à confiance < 1 : ${rapport.nonParse.length}

## Lignes non entièrement parsées
${rapport.nonParse.map((l) => `- ${l}`).join('\n')}
`, 'utf8');
console.log(`${lignes.length} articles → ${morceaux.length} morceaux dans ${path.relative(racine, OUT)} ; ${rapport.nonParse.length} lignes à confiance < 1`);
```

- [ ] **Step 2 : Ajouter `scripts/fumisterie/out/` au `.gitignore`** (section BUILD OUTPUT).

- [ ] **Step 3 : Générer et lire le rapport**

Run: `node scripts/fumisterie/import-tarif-modinox.mjs`
Expected: `~12006 articles → 16 morceaux` ; ouvrir `scripts/fumisterie/out/rapport-import.md`. Si plus de 15 % des lignes sont à confiance < 1, revenir à Task 2 (ajouter les motifs manquants au parseur, avec un test par motif) avant d'importer.

- [ ] **Step 4 : Appliquer en prod, morceau par morceau**

Via le MCP `execute_sql` (project `ejqqqwudmizqisdkxohw`), le contenu de chaque `modinox_2026_partNN.sql` dans l'ordre, puis `part99`. Vérifier :
```sql
select count(*) filter (where p.is_active) actifs, count(*) total, count(a.*) attrs
from majordhome.supplier_products p join majordhome.suppliers s on s.id=p.supplier_id
left join majordhome.fum_article_attrs a on a.supplier_product_id=p.id
where s.name='MODINOX / ALTEMA';
-- total = nombre de lignes lues, attrs = total
select reference, name, purchase_price_ht, selling_price_ht from public.majordhome_fum_articles where reference in ('2PTIELDR1501000','2DIVS2535IN230KEI');
-- 108.45 / 216.9 et 87.24 / 218.1
```

- [ ] **Step 5 : Commit**

```bash
git add scripts/fumisterie/import-tarif-modinox.mjs .gitignore
git commit -m "feat(fumisterie): import du tarif MODINOX dans supplier_products + fum_article_attrs"
```

---

### Task 4 : Seed des configurations, du gabarit G1 et du mapping CFG-24

**Files:**
- Create: `scripts/fumisterie/seed-configurations.mjs`
- Create: `scripts/fumisterie/data/gabarit-g1.json`, `scripts/fumisterie/data/cfg24-composants.json`, `scripts/fumisterie/data/cfg24-mapping.json`

**Interfaces:**
- Consumes: `docs/devis-fumisterie/bibliotheque_configurations_modinox_v1.json`.
- Produces: `scripts/fumisterie/out/seed_configurations.sql` (idempotent sur `code`) ; en base : 19 `fum_configurations`, 9 `fum_regles`, 27 `fum_guide_choix`, 12 `fum_appareils_valides`, gabarit `G1`, 13 composants CFG-24, 16 lignes de mapping.

- [ ] **Step 1 : Décrire le gabarit G1**

```json
{
  "code": "G1",
  "libelle": "Création intérieure verticale",
  "description": "Conduit intérieur vertical, avec ou sans dévoiement dans les combles, sortie en toiture (CFG-24, CFG-28, CFG-32).",
  "troncons": [
    { "type": "appareil", "libelle": "Appareil", "parametres": [
      { "cle": "diametre", "libelle": "Diamètre conduit", "unite": "mm", "choix": [80, 100, 130, 150, 180], "defaut": 150 },
      { "cle": "hBuse", "libelle": "Hauteur de buse", "unite": "m", "min": 0.3, "max": 2, "pas": 0.05, "defaut": 1.05 } ] },
    { "type": "raccordement_sp", "libelle": "Raccordement simple paroi", "parametres": [
      { "cle": "hsp1", "libelle": "Hauteur sous plafond (pièce)", "unite": "m", "min": 2, "max": 5, "pas": 0.05, "defaut": 2.5 } ] },
    { "type": "traversee_plancher", "libelle": "Niveaux traversés", "parametres": [
      { "cle": "epPl", "libelle": "Épaisseur plancher", "unite": "m", "min": 0.1, "max": 0.6, "pas": 0.01, "defaut": 0.25 },
      { "cle": "nbEtages", "libelle": "Étage intermédiaire", "choix": [0, 1], "defaut": 1 },
      { "cle": "hsp2", "libelle": "Hauteur sous plafond (étage)", "unite": "m", "min": 2, "max": 5, "pas": 0.05, "defaut": 2.5, "optionnel": true, "si": { "nbEtages": 1 } } ] },
    { "type": "combles", "libelle": "Combles et toiture", "parametres": [
      { "cle": "hCombles", "libelle": "Hauteur combles au droit du conduit", "unite": "m", "min": 0.3, "max": 6, "pas": 0.05, "defaut": 1.4 },
      { "cle": "pente", "libelle": "Pente de toiture", "unite": "°", "min": 0, "max": 60, "pas": 1, "defaut": 35 },
      { "cle": "epToit", "libelle": "Épaisseur toiture", "unite": "m", "min": 0.1, "max": 0.8, "pas": 0.05, "defaut": 0.3 },
      { "cle": "dFaitage", "libelle": "Distance sortie → faîtage", "unite": "m", "min": 0, "max": 8, "pas": 0.05, "defaut": 1.6 } ] },
    { "type": "devoiement", "libelle": "Dévoiement (combles)", "parametres": [
      { "cle": "angle", "libelle": "Angle des coudes", "unite": "°", "choix": [0, 15, 30, 45], "defaut": 30 },
      { "cle": "decal", "libelle": "Décalage horizontal", "unite": "m", "min": 0.05, "max": 2, "pas": 0.05, "defaut": 0.4, "optionnel": true, "si": { "angle": ">0" } } ] },
    { "type": "sortie_toit", "libelle": "Sortie de toit", "parametres": [
      { "cle": "hSortie", "libelle": "Hauteur visée au-dessus du toit", "unite": "m", "min": 0.3, "max": 5, "pas": 0.05, "defaut": 1.6 },
      { "cle": "finition", "libelle": "Finition extérieure", "choix": ["noir", "inox"], "defaut": "noir" } ] }
  ]
}
```

- [ ] **Step 2 : Décrire la nomenclature CFG-24 (repères et règles de la maquette)**

```json
[
  { "ordre": 1, "composant_code": "chapeau_anti_refouleur", "libelle": "Chapeau anti-refouleur", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "sortie_toit", "repere": 1, "statut": "catalogue", "regle_quantite": "unitaire" },
  { "ordre": 2, "composant_code": "element_droit_exterieur", "libelle": "Élément droit extérieur (au-dessus du toit)", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "sortie_toit", "repere": 2, "statut": "catalogue", "regle_quantite": "par_longueur:sortie_toit" },
  { "ordre": 3, "composant_code": "collier_jonction_exterieur", "libelle": "Collier de jonction extérieur", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "sortie_toit", "repere": 2, "statut": "provisoire", "regle_quantite": "par_emboitement:sortie_toit", "note": "1 par emboîtement extérieur — à valider" },
  { "ordre": 4, "composant_code": "solin", "libelle": "Solin", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "traversee_toiture", "repere": 3, "statut": "catalogue", "regle_quantite": "unitaire" },
  { "ordre": 5, "composant_code": "collier_sous_toiture", "libelle": "Collier universel sous toiture", "chapitre": "ACCESSOIRES", "gammes": ["PTR30"], "troncon": "traversee_toiture", "repere": 3, "statut": "provisoire", "regle_quantite": "unitaire", "note": "Reprise de charge sous la couverture — à valider" },
  { "ordre": 6, "composant_code": "coude_devoiement", "libelle": "Coudes de dévoiement", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "devoiement", "repere": 4, "statut": "catalogue", "regle_quantite": "coudes:devoiement" },
  { "ordre": 7, "composant_code": "element_droit_interieur", "libelle": "Élément droit intérieur (plafond → toiture)", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "conduit_interieur", "repere": 4, "statut": "implicite", "regle_quantite": "par_longueur:conduit_interieur" },
  { "ordre": 8, "composant_code": "plaque_proprete_rt2012", "libelle": "Plaque de propreté RT2012 (kit RT2012)", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "traversee_plancher", "repere": 5, "statut": "provisoire", "regle_quantite": "par_plancher", "groupe_alternative": "kit_rt2012", "note": "Kit RT2012 reconstitué : composition à confirmer auprès d'Altema" },
  { "ordre": 9, "composant_code": "couronne_coupe_feu", "libelle": "Couronne coupe-feu (kit RT2012)", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "traversee_plancher", "repere": 5, "statut": "provisoire", "regle_quantite": "par_plancher", "groupe_alternative": "kit_rt2012" },
  { "ordre": 10, "composant_code": "raccord_simple_paroi", "libelle": "Raccord simple paroi / PTR sous plafond", "chapitre": "CONDUITS ISOLÉS DOUBLE PAROI", "gammes": ["PTR30"], "troncon": "raccordement_sp", "repere": 6, "statut": "implicite", "regle_quantite": "unitaire" },
  { "ordre": 11, "composant_code": "tuyau_emaille", "libelle": "Tuyau émaillé (raccordement appareil → plafond)", "chapitre": "SIMPLE PAROI", "gammes": ["ÉMAILLÉ"], "troncon": "raccordement_sp", "repere": 6, "statut": "catalogue", "regle_quantite": "par_longueur:raccordement_sp" }
]
```

(11 composants ; `groupe_alternative: kit_rt2012` sans `option` = les deux lignes sont retenues ensemble — un kit, pas un « ou ».)

- [ ] **Step 3 : Décrire le mapping CFG-24 → tarif MODINOX**

```json
[
  { "composant_code": "chapeau_anti_refouleur", "gamme_catalogue": "PTR30", "finition": "noir", "gamme_tarif": "PTR30+ LAQ", "type_piece": "chapeau_anti_refouleur" },
  { "composant_code": "chapeau_anti_refouleur", "gamme_catalogue": "PTR30", "finition": "inox", "gamme_tarif": "PTR30+ I", "type_piece": "chapeau_anti_refouleur" },
  { "composant_code": "element_droit_exterieur", "gamme_catalogue": "PTR30", "finition": "noir", "gamme_tarif": "PTR30+ LAQ", "type_piece": "element_droit" },
  { "composant_code": "element_droit_exterieur", "gamme_catalogue": "PTR30", "finition": "inox", "gamme_tarif": "PTR30+ I", "type_piece": "element_droit" },
  { "composant_code": "collier_jonction_exterieur", "gamme_catalogue": "PTR30", "finition": "noir", "gamme_tarif": "PTR30+ LAQ", "type_piece": "collier_jonction", "statut": "provisoire" },
  { "composant_code": "collier_jonction_exterieur", "gamme_catalogue": "PTR30", "finition": "inox", "gamme_tarif": "PTR30+ I", "type_piece": "collier_jonction", "statut": "provisoire" },
  { "composant_code": "solin", "gamme_catalogue": "PTR30", "finition": null, "gamme_tarif": "SOLIN INOX", "type_piece": "solin" },
  { "composant_code": "collier_sous_toiture", "gamme_catalogue": "PTR30", "finition": null, "gamme_tarif": "COLLIER UNIVERSEL (SOUS TOIT)", "type_piece": "collier_sous_toiture", "statut": "provisoire" },
  { "composant_code": "coude_devoiement", "gamme_catalogue": "PTR30", "finition": null, "gamme_tarif": "PTR30+ I", "type_piece": "coude" },
  { "composant_code": "element_droit_interieur", "gamme_catalogue": "PTR30", "finition": null, "gamme_tarif": "PTR30+ I", "type_piece": "element_droit" },
  { "composant_code": "plaque_proprete_rt2012", "gamme_catalogue": "PTR30", "finition": null, "gamme_tarif": "PTR30+ I", "type_piece": "plaque_proprete", "statut": "provisoire" },
  { "composant_code": "couronne_coupe_feu", "gamme_catalogue": "PTR30", "finition": null, "gamme_tarif": "PTR30+ G", "type_piece": "couronne_coupe_feu", "statut": "provisoire" },
  { "composant_code": "raccord_simple_paroi", "gamme_catalogue": "PTR30", "finition": null, "gamme_tarif": "PTR30+ I", "type_piece": "raccord_simple_paroi" },
  { "composant_code": "tuyau_emaille", "gamme_catalogue": "ÉMAILLÉ", "finition": null, "gamme_tarif": "EMAIL LIGNE +", "type_piece": "element_droit" }
]
```

Vérifier chaque `gamme_tarif` contre `select distinct gamme_tarif from public.majordhome_fum_articles where type_piece = '<type>' and diametre_int = 150` : l'orthographe doit être **exactement** celle produite par le parseur (Task 3).

- [ ] **Step 4 : Écrire le script de seed**

```js
// scripts/fumisterie/seed-configurations.mjs
// ============================================================================
// Bibliothèque MODINOX (docs/devis-fumisterie/bibliotheque_configurations_modinox_v1.json)
// + gabarit G1 + nomenclature/mapping CFG-24 (scripts/fumisterie/data/*.json)
// → SQL idempotent (upsert sur code) : scripts/fumisterie/out/seed_configurations.sql.
// Le JSON fait foi pour les 19 configurations (critères, règles, guide, appareils) ;
// les composants avec repère/règle de quantité ne sont posés QUE pour les configurations
// décrites dans data/ (tranche 1 : CFG-24). Les autres gardent leur nomenclature brute.
// Usage : node scripts/fumisterie/seed-configurations.mjs [--org <uuid>]
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const ORG = args[args.indexOf('--org') + 1] || '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
const lire = (p) => JSON.parse(readFileSync(p, 'utf8'));
const biblio = lire(path.join(racine, 'docs', 'devis-fumisterie', 'bibliotheque_configurations_modinox_v1.json'));
const g1 = lire(path.join(racine, 'scripts', 'fumisterie', 'data', 'gabarit-g1.json'));
const cfg24 = lire(path.join(racine, 'scripts', 'fumisterie', 'data', 'cfg24-composants.json'));
const map24 = lire(path.join(racine, 'scripts', 'fumisterie', 'data', 'cfg24-mapping.json'));
const VERSION = 'modinox_2026';
const GABARIT_PAR_CODE = { 'CFG-24': 'G1' };
const COMPOSANTS_PAR_CODE = { 'CFG-24': cfg24 };

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `ARRAY[${(a || []).map(q).join(',')}]::text[]`;
const code = (c) => c.id.split('-').slice(0, 2).join('-'); // CFG-24-CREATION-... → CFG-24
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const sql = [`-- Seed configurations ${VERSION} (généré par scripts/fumisterie/seed-configurations.mjs). Idempotent.
DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid; v_g uuid; v_c uuid; v_r uuid;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = 'MODINOX / ALTEMA';
  IF v_sup IS NULL THEN RAISE EXCEPTION 'Fournisseur MODINOX / ALTEMA absent : lancer l''import du tarif d''abord'; END IF;`];

// Gabarit G1
sql.push(`  INSERT INTO majordhome.fum_gabarits (org_id, code, libelle, description, troncons) VALUES (v_org, ${q(g1.code)}, ${q(g1.libelle)}, ${q(g1.description)}, ${q(JSON.stringify(g1.troncons))}::jsonb)
  ON CONFLICT (org_id, code) DO UPDATE SET libelle = EXCLUDED.libelle, description = EXCLUDED.description, troncons = EXCLUDED.troncons, updated_at = now();`);

// Règles
for (const r of biblio.regles_techniques) {
  sql.push(`  INSERT INTO majordhome.fum_regles (org_id, code, gamme, page, statut, texte, reference, consequence_devis, bloquante)
  VALUES (v_org, ${q(r.id)}, ${q(r.gamme)}, ${r.page ?? 'NULL'}, ${q(r.statut)}, ${q(r.regle)}, ${q(r.reference)}, ${q(r.consequence_devis)}, ${r.consequence_devis ? 'true' : 'false'})
  ON CONFLICT (org_id, code) DO UPDATE SET texte = EXCLUDED.texte, consequence_devis = EXCLUDED.consequence_devis, bloquante = EXCLUDED.bloquante;`);
}

// Configurations
for (const c of biblio.configurations) {
  const cr = c.criteres;
  const gab = GABARIT_PAR_CODE[code(c)];
  sql.push(`  ${gab ? `SELECT id INTO v_g FROM majordhome.fum_gabarits WHERE org_id = v_org AND code = ${q(gab)};` : 'v_g := NULL;'}
  INSERT INTO majordhome.fum_configurations (org_id, code, titre, page_catalogue, index_image, statut, gabarit_id, gamme_principale, principe, remarques, source_version,
    projets, appareils, combustibles, zones, prise_air, appareil_etanche_requis, conduit_existant, condition_bloquante)
  VALUES (v_org, ${q(code(c))}, ${q(c.titre)}, ${c.page_catalogue}, ${c.index_image}, ${q(c.statut)}, v_g, ${q(c.gamme_principale)}, ${q(c.principe)}, ${q(c.remarques)}, ${q(VERSION)},
    ${arr(cr.projet)}, ${arr(cr.appareils)}, ${arr(cr.combustibles)}, ${arr(cr.zones)}, ${arr(cr.prise_air)}, ${cr.appareil_etanche_requis ? 'true' : 'false'}, ${q(cr.conduit_existant)}, ${q(cr.condition_bloquante)})
  ON CONFLICT (org_id, code) DO UPDATE SET titre = EXCLUDED.titre, statut = EXCLUDED.statut, gabarit_id = EXCLUDED.gabarit_id, gamme_principale = EXCLUDED.gamme_principale,
    principe = EXCLUDED.principe, remarques = EXCLUDED.remarques, projets = EXCLUDED.projets, appareils = EXCLUDED.appareils, combustibles = EXCLUDED.combustibles,
    zones = EXCLUDED.zones, prise_air = EXCLUDED.prise_air, appareil_etanche_requis = EXCLUDED.appareil_etanche_requis, conduit_existant = EXCLUDED.conduit_existant,
    condition_bloquante = EXCLUDED.condition_bloquante, updated_at = now()
  RETURNING id INTO v_c;
  DELETE FROM majordhome.fum_config_composants WHERE configuration_id = v_c;
  DELETE FROM majordhome.fum_config_regles WHERE configuration_id = v_c;`);
  const composants = COMPOSANTS_PAR_CODE[code(c)] || c.nomenclature.map((n) => ({
    ordre: n.ordre, composant_code: slug(n.composant), libelle: n.composant, chapitre: n.chapitre || null,
    gammes: Array.isArray(n.gamme) ? n.gamme : (n.gamme ? [n.gamme] : []), troncon: null, repere: null, statut: 'catalogue',
    groupe_alternative: n.choix ? 'bas_de_conduit' : null, option: n.choix || null, regle_quantite: null, note: n.note || null,
  }));
  for (const k of composants) {
    sql.push(`  INSERT INTO majordhome.fum_config_composants (org_id, configuration_id, ordre, composant_code, libelle, chapitre, gammes, troncon, repere, statut, groupe_alternative, option, regle_quantite, note)
  VALUES (v_org, v_c, ${k.ordre}, ${q(k.composant_code)}, ${q(k.libelle)}, ${q(k.chapitre)}, ${arr(k.gammes)}, ${q(k.troncon)}, ${k.repere ?? 'NULL'}, ${q(k.statut)}, ${q(k.groupe_alternative)}, ${q(k.option)}, ${q(k.regle_quantite)}, ${q(k.note)});`);
  }
  for (const rc of c.regles_associees || []) {
    sql.push(`  SELECT id INTO v_r FROM majordhome.fum_regles WHERE org_id = v_org AND code = ${q(rc)};
  INSERT INTO majordhome.fum_config_regles (org_id, configuration_id, regle_id) VALUES (v_org, v_c, v_r) ON CONFLICT DO NOTHING;`);
  }
  for (const [marque, modeles] of Object.entries(c.modeles_preconises || {})) {
    for (const m of modeles) sql.push(`  INSERT INTO majordhome.fum_appareils_valides (org_id, gamme, marque, modele, configuration_id, source) VALUES (v_org, ${q(c.gamme_principale)}, ${q(marque)}, ${q(m)}, v_c, 'catalogue p.48') ON CONFLICT (org_id, gamme, marque, modele) DO UPDATE SET configuration_id = EXCLUDED.configuration_id;`);
  }
}

// Guide de choix
for (const [ligne, cols] of Object.entries(biblio.guide_de_choix_gammes.lignes)) {
  for (const [colonne, gammes] of Object.entries(cols)) {
    sql.push(`  INSERT INTO majordhome.fum_guide_choix (org_id, ligne, colonne, gammes, page) VALUES (v_org, ${q(ligne)}, ${q(colonne)}, ${arr(gammes)}, ${biblio.guide_de_choix_gammes.page}) ON CONFLICT (org_id, ligne, colonne) DO UPDATE SET gammes = EXCLUDED.gammes;`);
  }
}

// Mapping CFG-24 (fournisseur MODINOX)
sql.push(`  DELETE FROM majordhome.fum_composant_mapping WHERE org_id = v_org AND supplier_id = v_sup AND composant_code IN (${[...new Set(map24.map((m) => q(m.composant_code)))].join(',')});`);
for (const m of map24) {
  sql.push(`  INSERT INTO majordhome.fum_composant_mapping (org_id, supplier_id, composant_code, gamme_catalogue, finition, gamme_tarif, type_piece, quantite_par_unite, motif_code, statut)
  VALUES (v_org, v_sup, ${q(m.composant_code)}, ${q(m.gamme_catalogue)}, ${q(m.finition)}, ${q(m.gamme_tarif)}, ${q(m.type_piece)}, ${m.quantite_par_unite ?? 1}, ${q(m.motif_code)}, ${q(m.statut || 'catalogue')});`);
}
sql.push('END $$;');
mkdirSync(path.join(racine, 'scripts', 'fumisterie', 'out'), { recursive: true });
writeFileSync(path.join(racine, 'scripts', 'fumisterie', 'out', 'seed_configurations.sql'), sql.join('\n'), 'utf8');
console.log(`seed : ${biblio.configurations.length} configurations, ${biblio.regles_techniques.length} règles, ${map24.length} lignes de mapping`);
```

- [ ] **Step 5 : Générer, appliquer, vérifier**

Run: `node scripts/fumisterie/seed-configurations.mjs` puis appliquer `scripts/fumisterie/out/seed_configurations.sql` via le MCP `execute_sql`. Vérifier :
```sql
select count(*) from majordhome.fum_configurations;   -- 19
select code, gabarit_id is not null metrable, cardinality(zones) from majordhome.fum_configurations order by code; -- CFG-24 metrable=true
select count(*) from majordhome.fum_config_composants c join majordhome.fum_configurations f on f.id=c.configuration_id where f.code='CFG-24'; -- 11
select count(*) from majordhome.fum_composant_mapping; -- 14
-- Couverture Ø150 : chaque mapping résout au moins un article
select m.composant_code, m.finition, count(a.id) n
from majordhome.fum_composant_mapping m
left join public.majordhome_fum_articles a on a.gamme_tarif=m.gamme_tarif and a.type_piece=m.type_piece and a.diametre_int=150 and a.is_active
group by 1,2 order by 1,2;  -- aucun n = 0
```
Un `n = 0` = orthographe de `gamme_tarif` ou `type_piece` à corriger dans `cfg24-mapping.json` (ou motif manquant dans le parseur), puis re-seed.

- [ ] **Step 6 : Commit**

```bash
git add scripts/fumisterie/seed-configurations.mjs scripts/fumisterie/data/
git commit -m "feat(fumisterie): seed des 19 configurations, gabarit G1 et mapping CFG-24"
```

---

### Task 5 : Moteur — config par défaut et combinaison d'éléments

**Files:**
- Create: `src/lib/fumisterie/config.js`, `src/lib/fumisterie/compose.js`
- Test: `scripts/fumisterie/compose.test.mjs`

**Interfaces:**
- Produces: `DEFAULTS_FUMISTERIE`, `buildFumisterieConfig(settings)` ; `composer(longueurMm, { longueurs, reglable, avecReglable })` → `{ elements: { [longueur]: n }, reglable: { n, longueur } | null, total, surlongueur, nb }`.

- [ ] **Step 1 : Test**

```js
// scripts/fumisterie/compose.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composer } from '../../src/lib/fumisterie/compose.js';
import { buildFumisterieConfig, DEFAULTS_FUMISTERIE } from '../../src/lib/fumisterie/config.js';

const R = { longueurs: [1000, 500, 250], reglable: { min: 320, max: 500 } };

test('4807 mm : 5 × 1000, surlongueur 193 (reste 807 hors plage réglable)', () => {
  const c = composer(4807, { ...R, avecReglable: true });
  assert.deepEqual(c.elements, { 1000: 5, 500: 0, 250: 0 });
  assert.equal(c.reglable, null);
  assert.equal(c.total, 5000); assert.equal(c.surlongueur, 193); assert.equal(c.nb, 5);
});
test('1600 mm : 1000 + 500 + 250, 3 emboîtements, surlongueur 150', () => {
  const c = composer(1600, { ...R, avecReglable: true });
  assert.deepEqual(c.elements, { 1000: 1, 500: 1, 250: 1 });
  assert.equal(c.nb, 3); assert.equal(c.surlongueur, 150);
});
test('1450 mm sans réglable : 1000 + 500, surlongueur 50', () => {
  const c = composer(1450, { ...R, avecReglable: false });
  assert.deepEqual(c.elements, { 1000: 1, 500: 1, 250: 0 }); assert.equal(c.surlongueur, 50);
});
test('1400 mm avec réglable : 1000 + réglable 400, surlongueur 0', () => {
  const c = composer(1400, { ...R, avecReglable: true });
  assert.deepEqual(c.elements, { 1000: 1, 500: 0, 250: 0 });
  assert.deepEqual(c.reglable, { n: 1, longueur: 400 }); assert.equal(c.surlongueur, 0); assert.equal(c.nb, 2);
});
test('1900 mm avec réglable : 1000 + 500 + réglable 400', () => {
  const c = composer(1900, { ...R, avecReglable: true });
  assert.deepEqual(c.elements, { 1000: 1, 500: 1, 250: 0 }); assert.deepEqual(c.reglable, { n: 1, longueur: 400 });
});
test('longueur nulle ou négative : rien', () => {
  assert.equal(composer(0, R).nb, 0); assert.equal(composer(-30, R).nb, 0);
});
test('config : défauts complets et surcharge par settings', () => {
  const c = buildFumisterieConfig({ fumisterie: { finition_defaut: 'inox', zone1: { pente_m: 0.5 } } });
  assert.equal(c.finition_defaut, 'inox');
  assert.equal(c.zone1.pente_m, 0.5); assert.equal(c.zone1.plat_m, DEFAULTS_FUMISTERIE.zone1.plat_m);
  assert.deepEqual(buildFumisterieConfig(null).longueurs_elements_mm, [1000, 500, 250]);
});
```

- [ ] **Step 2 : Run** `node --test scripts/fumisterie/compose.test.mjs` → FAIL.

- [ ] **Step 3 : Implémenter**

```js
// src/lib/fumisterie/config.js
// Défauts org du module Fumisterie — module PUR. Valeurs org : core.organizations.settings.fumisterie
// (Settings → Entretiens & Contrats → Fumisterie). ⚠ org_update_settings merge niveau 1 → sauver l'objet COMPLET.
export const DEFAULTS_FUMISTERIE = Object.freeze({
  finition_defaut: 'noir',              // finition extérieure proposée (noir | inox)
  longueurs_elements_mm: Object.freeze([1000, 500, 250]), // éléments droits, du plus long au plus court
  reglable: Object.freeze({ min: 320, max: 500 }),       // plage de l'élément réglable
  reglable_interieur: true,             // utiliser un réglable pour la partie intérieure
  reglable_exterieur: true,             // idem au-dessus du toit
  colliers_par_emboitement: 1,          // colliers de jonction extérieurs
  marge_combles_m: 0.10,                // marge sous toiture pour le dévoiement
  haubanage_m: 3,                       // conduit libre au-dessus du toit avant haubanage (catalogue p.33)
  zone1: Object.freeze({ pente_m: 0.40, plat_m: 1.20, pente_plat_deg: 15 }), // catalogue p.23
  tva_fournitures: 20,
  tva_pose: 10,
});

/** Merge profond niveau 2 (objets zone1 / reglable), tableaux remplacés. */
export function buildFumisterieConfig(settings) {
  const s = settings?.fumisterie || {};
  const out = { ...DEFAULTS_FUMISTERIE, ...s };
  out.zone1 = { ...DEFAULTS_FUMISTERIE.zone1, ...(s.zone1 || {}) };
  out.reglable = { ...DEFAULTS_FUMISTERIE.reglable, ...(s.reglable || {}) };
  out.longueurs_elements_mm = [...(s.longueurs_elements_mm || DEFAULTS_FUMISTERIE.longueurs_elements_mm)].sort((a, b) => b - a);
  return out;
}
```

```js
// src/lib/fumisterie/compose.js
// Combinaison d'éléments droits pour couvrir une longueur — module PUR, règle PROVISOIRE
// portée de la maquette (docs/devis-fumisterie/MAQUETTE_metre_svg.md §5) : n × plus long,
// puis le reste par les éléments courts, un réglable quand il tombe juste, sinon un élément de plus.

/**
 * @param {number} longueurMm longueur à couvrir
 * @param {{ longueurs: number[], reglable: {min:number,max:number}, avecReglable?: boolean }} opts
 * @returns {{ elements: Record<number, number>, reglable: {n:number, longueur:number}|null, total: number, surlongueur: number, nb: number }}
 */
export function composer(longueurMm, { longueurs, reglable, avecReglable = false }) {
  const L = Math.max(0, Math.round(longueurMm));
  const [long, moyen, court] = [...longueurs].sort((a, b) => b - a);
  const elements = Object.fromEntries(longueurs.map((l) => [l, 0]));
  let reg = null;
  if (L > 0) {
    elements[long] = Math.floor(L / long);
    const r = L - elements[long] * long;
    const dansPlage = (x) => avecReglable && x >= reglable.min && x <= reglable.max;
    if (r <= 0) { /* rien */ }
    else if (r <= court) elements[court] = 1;
    else if (dansPlage(r)) reg = { n: 1, longueur: r };
    else if (r <= moyen) elements[moyen] = 1;
    else if (r <= moyen + court) { elements[moyen] = 1; elements[court] = 1; }
    else if (dansPlage(r - moyen)) { elements[moyen] = 1; reg = { n: 1, longueur: r - moyen }; }
    else elements[long] += 1;
  }
  const total = longueurs.reduce((s, l) => s + elements[l] * l, 0) + (reg ? reg.longueur : 0);
  const nb = longueurs.reduce((s, l) => s + elements[l], 0) + (reg ? 1 : 0);
  return { elements, reglable: reg, total, surlongueur: total - L, nb };
}
```

- [ ] **Step 4 : Run** → PASS (7 tests).
- [ ] **Step 5 : Commit** `git add src/lib/fumisterie scripts/fumisterie/compose.test.mjs && git commit -m "feat(fumisterie): config par défaut + combinaison d'éléments (moteur pur)"`

---

### Task 6 : Moteur — géométrie G1 et contrôles

**Files:**
- Create: `src/lib/fumisterie/gabarits/g1.js`, `src/lib/fumisterie/controles.js`
- Test: `scripts/fumisterie/g1.test.mjs`

**Interfaces:**
- Produces: `geometrieG1(releve, config)` → `{ planchers, yC, yRoofTop, yRidge, flat, yReq, reqAbove, vg, obl, yDevS, yDevE, devOK, Lsp, Lint, troncons: { raccordement_sp: {longueur_mm, composition}, conduit_interieur: {...}, sortie_toit: {...} }, topAct, hAct, minSortie }` ; `hauteurSortieMinimale(releve, config)` ; `controlesG1(geo, releve, config)` → `alertes[]`.

- [ ] **Step 1 : Test (valeurs de la maquette, Ø150)**

```js
// scripts/fumisterie/g1.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geometrieG1, hauteurSortieMinimale } from '../../src/lib/fumisterie/gabarits/g1.js';
import { controlesG1 } from '../../src/lib/fumisterie/controles.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';

const cfg = buildFumisterieConfig(null);
const RELEVE = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5,
  hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };
const pres = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} ≠ ${b}`);

test('géométrie de la maquette', () => {
  const g = geometrieG1(RELEVE, cfg);
  assert.equal(g.planchers, 2); pres(g.yC, 5.5); pres(g.yRoofTop, 7.2); pres(g.yRidge, 8.3203); pres(g.yReq, 8.7203);
  assert.equal(g.flat, false); pres(g.vg, 0.6928); pres(g.obl, 0.8); assert.equal(g.devOK, true);
  pres(g.Lsp, 1.45); pres(g.Lint, 4.8072);
  assert.equal(g.troncons.conduit_interieur.longueur_mm, 4807);
  assert.deepEqual(g.troncons.conduit_interieur.composition.elements, { 1000: 5, 500: 0, 250: 0 });
  assert.equal(g.troncons.sortie_toit.composition.nb, 3);
  assert.equal(g.troncons.raccordement_sp.composition.surlongueur, 50);
  pres(g.topAct, 9.143); pres(g.hAct, 1.943); pres(g.minSortie, 1.5203);
});
test('contrôles : conforme + infos surlongueur', () => {
  const g = geometrieG1(RELEVE, cfg);
  const a = controlesG1(g, RELEVE, cfg);
  assert.equal(a.find((x) => x.code === 'zone1').niveau, 'ok');
  assert.ok(a.some((x) => x.code === 'surlongueur_interieure'));
  assert.ok(!a.some((x) => x.niveau === 'warn'));
});
test('sortie trop basse → warn zone1 ; ajustement au minimum la rend conforme', () => {
  const bas = { ...RELEVE, hSortie: 0.5 };
  assert.equal(controlesG1(geometrieG1(bas, cfg), bas, cfg).find((x) => x.code === 'zone1').niveau, 'warn');
  const h = hauteurSortieMinimale(bas, cfg);
  assert.equal(Math.round(h * 20) / 20, h); // arrondi aux 5 cm
  const ok = { ...bas, hSortie: h };
  assert.equal(controlesG1(geometrieG1(ok, cfg), ok, cfg).find((x) => x.code === 'zone1').niveau, 'ok');
});
test('pente 12° → toit plat (+1,20 m) et info', () => {
  const r = { ...RELEVE, pente: 12 };
  const g = geometrieG1(r, cfg);
  assert.equal(g.flat, true); pres(g.yReq, g.yRoofTop + 1.2);
  assert.ok(controlesG1(g, r, cfg).some((x) => x.code === 'toit_plat'));
});
test('dévoiement trop grand pour les combles → warn', () => {
  const r = { ...RELEVE, angle: 15, decal: 0.6 };
  assert.ok(controlesG1(geometrieG1(r, cfg), r, cfg).some((x) => x.code === 'devoiement' && x.niveau === 'warn'));
});
test('buse au plafond → warn ; > 3 m au-dessus du toit → warn haubanage', () => {
  const r1 = { ...RELEVE, hBuse: 2.5 };
  assert.ok(controlesG1(geometrieG1(r1, cfg), r1, cfg).some((x) => x.code === 'buse'));
  const r2 = { ...RELEVE, hSortie: 3.5 };
  assert.ok(controlesG1(geometrieG1(r2, cfg), r2, cfg).some((x) => x.code === 'haubanage'));
});
test('sans dévoiement ni étage', () => {
  const r = { ...RELEVE, angle: 0, decal: 0, nbEtages: 0 };
  const g = geometrieG1(r, cfg);
  assert.equal(g.planchers, 1); pres(g.yC, 2.75); assert.equal(g.vg, 0); assert.equal(g.devOK, true);
});
```

- [ ] **Step 2 : Run** → FAIL.

- [ ] **Step 3 : Implémenter**

```js
// src/lib/fumisterie/gabarits/g1.js
// Gabarit G1 — création intérieure verticale (CFG-24/28/32). Géométrie PURE portée de la
// maquette maquette_metre_ptr30.html (compute()). Règles PROVISOIRES : l'encombrement des
// coudes est ignoré (cf. MAQUETTE_metre_svg.md §5). Unités : mètres, degrés, mm pour les tronçons.
import { composer } from '../compose.js';

const rad = (d) => (d * Math.PI) / 180;

/**
 * @param {{diametre:number, finition:string, hBuse:number, hsp1:number, epPl:number, nbEtages:number, hsp2:number,
 *   hCombles:number, pente:number, epToit:number, dFaitage:number, angle:number, decal:number, hSortie:number}} r relevé
 * @param {ReturnType<import('../config.js').buildFumisterieConfig>} cfg
 */
export function geometrieG1(r, cfg) {
  const planchers = 1 + (r.nbEtages ? 1 : 0);
  const yC = r.hsp1 + r.epPl + (r.nbEtages ? r.hsp2 + r.epPl : 0);
  const dec = r.angle > 0 ? r.decal : 0;
  const yRoofTop = yC + r.hCombles + r.epToit;
  const yRidge = yRoofTop + r.dFaitage * Math.tan(rad(r.pente));
  const flat = r.pente <= cfg.zone1.pente_plat_deg;
  const reqAbove = flat ? cfg.zone1.plat_m : cfg.zone1.pente_m;
  const yReq = (flat ? yRoofTop : yRidge) + reqAbove;
  const vg = r.angle > 0 ? dec / Math.tan(rad(r.angle)) : 0;
  const obl = r.angle > 0 ? dec / Math.sin(rad(r.angle)) : 0;
  const yDevS = yC + 0.30;
  const yDevE = yDevS + vg;
  const devOK = r.angle === 0 || yDevE <= yRoofTop - r.epToit - cfg.marge_combles_m;
  const Lsp = Math.max(0, r.hsp1 - r.hBuse);
  const Lint = (yRoofTop - r.hsp1) - vg + obl;
  const base = { longueurs: cfg.longueurs_elements_mm, reglable: cfg.reglable };
  const troncons = {
    raccordement_sp: { longueur_mm: Math.round(Lsp * 1000), composition: composer(Lsp * 1000, { ...base, avecReglable: false }) },
    conduit_interieur: { longueur_mm: Math.round(Lint * 1000), composition: composer(Lint * 1000, { ...base, avecReglable: cfg.reglable_interieur }) },
    sortie_toit: { longueur_mm: Math.round(r.hSortie * 1000), composition: composer(r.hSortie * 1000, { ...base, avecReglable: cfg.reglable_exterieur }) },
  };
  const topAct = yRoofTop + troncons.sortie_toit.composition.total / 1000 + troncons.conduit_interieur.composition.surlongueur / 1000;
  return { planchers, yC, dec, yRoofTop, yRidge, flat, yReq, reqAbove, vg, obl, yDevS, yDevE, devOK, Lsp, Lint, troncons,
    topAct, hAct: topAct - yRoofTop, minSortie: yReq - yRoofTop };
}

/** Hauteur de sortie minimale (arrondie aux 5 cm) qui respecte la zone, surlongueur intérieure comprise. */
export function hauteurSortieMinimale(r, cfg) {
  const g0 = geometrieG1(r, cfg);
  let h = Math.ceil((g0.minSortie - g0.troncons.conduit_interieur.composition.surlongueur / 1000) * 20 - 1e-9) / 20;
  for (let k = 0; k < 12; k++) {
    const g = geometrieG1({ ...r, hSortie: h }, cfg);
    if (g.topAct >= g.yReq - 1e-6) break;
    h += 0.05;
  }
  return Math.round(h * 100) / 100;
}
```

```js
// src/lib/fumisterie/controles.js
// Contrôles réglementaires et de cohérence d'un métré — module PUR. Chaque alerte :
// { niveau: 'ok'|'info'|'warn', code, message, source }. Jamais de rouge/vert seuls côté UI :
// le niveau porte une icône + un libellé.
const fmt = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');

/** @returns {{niveau:string, code:string, message:string, source:string}[]} */
export function controlesG1(g, r, cfg) {
  const a = [];
  const marge = (g.topAct - g.yReq) * 100;
  if (marge >= -0.5) a.push({ niveau: 'ok', code: 'zone1', source: 'catalogue p.23',
    message: `Zone 1 respectée : la sortie dépasse le minimum de ${fmt(Math.max(0, marge), 0)} cm (hauteur réelle ${fmt(g.hAct)} m au-dessus du toit).` });
  else a.push({ niveau: 'warn', code: 'zone1', source: 'catalogue p.23',
    message: `Sortie trop basse de ${fmt(-marge, 0)} cm pour la zone 1. Il faut au moins ${fmt(g.minSortie)} m au-dessus du toit (${g.flat ? `toit ≤ ${cfg.zone1.pente_plat_deg}° : ${fmt(cfg.zone1.plat_m)} m` : `faîtage + ${fmt(cfg.zone1.pente_m * 100, 0)} cm`}).` });
  if (g.flat) a.push({ niveau: 'info', code: 'toit_plat', source: 'catalogue p.23', message: `Pente ≤ ${cfg.zone1.pente_plat_deg}° : la toiture est traitée comme un toit plat.` });
  if (!g.devOK) a.push({ niveau: 'warn', code: 'devoiement', source: 'géométrie', message: `Le dévoiement ne tient pas dans les combles : il demande ${fmt(g.vg)} m de hauteur. Réduisez le décalage ou augmentez l'angle.` });
  if (g.hAct > cfg.haubanage_m) a.push({ niveau: 'warn', code: 'haubanage', source: 'catalogue p.33 (à confirmer)', message: `Plus de ${fmt(cfg.haubanage_m, 0)} m de conduit libre au-dessus du toit : prévoir un kit de non-haubanage ou un haubanage.` });
  if (g.Lsp <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: 'La buse est au niveau du plafond ou au-dessus : vérifiez la hauteur de buse.' });
  const si = g.troncons.conduit_interieur.composition.surlongueur;
  if (si > 0) a.push({ niveau: 'info', code: 'surlongueur_interieure', source: 'calcul', message: `Conduit intérieur : ${si} mm de surlongueur avec les éléments standard, reportés sur la hauteur de sortie.` });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: 'surlongueur_emaillee', source: 'calcul', message: `Raccordement émaillé : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  return a;
}
```

- [ ] **Step 4 : Run** → PASS (7 tests).
- [ ] **Step 5 : Commit** `git commit -am "feat(fumisterie): géométrie G1 et contrôles (portés de la maquette)"` (après `git add src/lib/fumisterie scripts/fumisterie/g1.test.mjs`).

---

### Task 7 : Moteur — résolution d'articles et nomenclature

**Files:**
- Create: `src/lib/fumisterie/articles.js`, `src/lib/fumisterie/nomenclature.js`, `src/lib/fumisterie/index.js`
- Create: `scripts/fumisterie/fixtures/g1-o150.mjs`
- Test: `scripts/fumisterie/nomenclature.test.mjs`

**Interfaces:**
- Produces: `resoudreArticle(articles, mappings, criteres)` ; `calculerMetre({ configuration, gabarit, composants, mapping, articles, reglages, releve })` → `{ engine_version, geometrie, lignes, alertes, totaux }` ; `ENGINE_VERSION = 'g1-2026.09'`.
- Ligne : `{ repere, composant_code, libelle, sous_libelle, troncon, statut, article_id, reference, quantite, unite, prix_vente_ht, prix_achat_ht, tva }`.

- [ ] **Step 1 : Fixture (articles Ø150 réels du tarif, prix nets / publics)**

```js
// scripts/fumisterie/fixtures/g1-o150.mjs — extrait RÉEL du tarif MAYER002 (juin 2026), Ø150.
const A = (reference, name, tarif_public, purchase_price_ht, attrs) => ({ id: reference, reference, name, unit: 'pièce', tarif_public, purchase_price_ht, is_active: true, ...attrs });
const ptrI = { gamme_tarif: 'PTR30+ I', couleur: 'inox', diametre_int: 150 };
const ptrN = { gamme_tarif: 'PTR30+ LAQ', couleur: 'noir', diametre_int: 150 };
export const ARTICLES = [
  A('2PTICHARN150', 'PTR30+ I - CHAPEAU ANTI REFOULEUR 2024 - D 150', 173.4, 86.7, { ...ptrI, type_piece: 'chapeau_anti_refouleur' }),
  A('2PTICHARN150NO', 'PTR30+ LAQ - CHAPEAU ANTI REFOULEUR 2024 - D 150 - INOX NOIR', 216.7, 108.35, { ...ptrN, type_piece: 'chapeau_anti_refouleur' }),
  A('2PTIELDR1501000', 'PTR30+ I - ELT DROIT - D 150 - LG 1000', 216.9, 108.45, { ...ptrI, type_piece: 'element_droit', longueur_mm: 1000 }),
  A('2PTIELDR150500', 'PTR30+ I - ELT DROIT - D 150 - LG 500', 154.8, 77.4, { ...ptrI, type_piece: 'element_droit', longueur_mm: 500 }),
  A('2PTIELDR150250', 'PTR30+ I - ELT DROIT - D 150 - LG 250', 125, 62.5, { ...ptrI, type_piece: 'element_droit', longueur_mm: 250 }),
  A('2PTIELDR1501000NO', 'PTR30+ LAQ - ELT DROIT - D 150 - LG 1000 - INOX NOIR', 260.3, 130.15, { ...ptrN, type_piece: 'element_droit', longueur_mm: 1000 }),
  A('2PTIELDR150500NO', 'PTR30+ LAQ - ELT DROIT - D 150 - LG 500 - INOX NOIR', 185.7, 92.85, { ...ptrN, type_piece: 'element_droit', longueur_mm: 500 }),
  A('2PTIELDR150250NO', 'PTR30+ LAQ - ELT DROIT - D 150 - LG 250 - INOX NOIR', 149.9, 74.95, { ...ptrN, type_piece: 'element_droit', longueur_mm: 250 }),
  A('2PTIELRE150500', 'PTR30+ I - ELT REGLABLE - D 150 - LG 320 A 520', 215.2, 107.6, { ...ptrI, type_piece: 'element_reglable', longueur_mm: 320, longueur_max_mm: 520 }),
  A('2PTIELRE150500NO', 'PTR30+ LAQ - ELT REGLABLE - D 150 - LG 320 A 500 - INOX NOIR', 258.3, 129.15, { ...ptrN, type_piece: 'element_reglable', longueur_mm: 320, longueur_max_mm: 500 }),
  A('2PTICO15150', 'PTR30+ I - COUDE 15° - D 150', 141.2, 70.6, { ...ptrI, type_piece: 'coude', angle: 15 }),
  A('2PTICO30150', 'PTR30+ I - COUDE 30° - D 150', 141.2, 70.6, { ...ptrI, type_piece: 'coude', angle: 30 }),
  A('2PTICO45150', 'PTR30+ I - COUDE 45° - D 150', 141.2, 70.6, { ...ptrI, type_piece: 'coude', angle: 45 }),
  A('2PTICOJO150', 'PTR30+ I - COLLIER DE JONCTION - D 150 ( D EXT 210 )', 19.6, 9.8, { ...ptrI, type_piece: 'collier_jonction', diametre_ext: 210 }),
  A('2PTICOJO150NO', 'PTR30+ LAQ - COLLIER DE JONCTION - D 150 ( D EXT 210 ) - INOX NOIR', 25.2, 12.6, { ...ptrN, type_piece: 'collier_jonction', diametre_ext: 210 }),
  A('2PTIPPDR150', 'PTR30+ I - PLAQUE DE PROPRETE RT2012 - 560 X 560 - D 150 - INOX', 97.9, 48.95, { ...ptrI, type_piece: 'plaque_proprete' }),
  A('2PTGCOCF150', 'PTR30+ G - COURONNE COUPE FEU - D 150 ( D EXT 210 )', 33.6, 16.8, { gamme_tarif: 'PTR30+ G', couleur: 'galva', diametre_int: 150, type_piece: 'couronne_coupe_feu' }),
  A('2PTIRASR150148', 'PTR30+ I - RACCORD SIMPLE PAROI REDUIT - D 150 / D 148', 110.3, 55.15, { ...ptrI, type_piece: 'raccord_simple_paroi' }),
  A('2DIVCTOS150', 'COLLIER UNIVERSEL (SOUS TOIT) - D 150 - GALVA', 66, 34.98, { gamme_tarif: 'COLLIER UNIVERSEL (SOUS TOIT)', couleur: 'galva', diametre_int: 150, type_piece: 'collier_sous_toiture' }),
  A('2DIVS1525IN230KEI', 'SOLIN 15 A 25° INOX - PTR D 150', 180.1, 72.04, { gamme_tarif: 'SOLIN INOX', couleur: 'inox', diametre_int: 150, type_piece: 'solin', pente_min: 15, pente_max: 25 }),
  A('2DIVS2535IN230KEI', 'SOLIN 25 A 35° INOX - PTR D 150', 218.1, 87.24, { gamme_tarif: 'SOLIN INOX', couleur: 'inox', diametre_int: 150, type_piece: 'solin', pente_min: 25, pente_max: 35 }),
  A('2DIVS3040IN230KEI', 'SOLIN 30 A 40° INOX - PTR D 150', 218.1, 87.24, { gamme_tarif: 'SOLIN INOX', couleur: 'inox', diametre_int: 150, type_piece: 'solin', pente_min: 30, pente_max: 40 }),
  A('2LEPTUYA1501000NO', 'EMAIL LIGNE + - TUYAU - D 150 - LG 1000 - NOIR', 67.4, 26.96, { gamme_tarif: 'EMAIL LIGNE +', couleur: 'noir', diametre_int: 150, type_piece: 'element_droit', longueur_mm: 1000 }),
  A('2LEPTUYA150500NO', 'EMAIL LIGNE + - TUYAU - D 150 - LG 500 - NOIR', 43.8, 17.52, { gamme_tarif: 'EMAIL LIGNE +', couleur: 'noir', diametre_int: 150, type_piece: 'element_droit', longueur_mm: 500 }),
  A('2LEPTUYA150250NO', 'EMAIL LIGNE + - TUYAU - D 150 - LG 250 - NOIR', 33.9, 13.56, { gamme_tarif: 'EMAIL LIGNE +', couleur: 'noir', diametre_int: 150, type_piece: 'element_droit', longueur_mm: 250 }),
];
import { readFileSync } from 'node:fs';
export const COMPOSANTS = JSON.parse(readFileSync(new URL('../data/cfg24-composants.json', import.meta.url), 'utf8'));
export const MAPPING = JSON.parse(readFileSync(new URL('../data/cfg24-mapping.json', import.meta.url), 'utf8'));
export const GABARIT = JSON.parse(readFileSync(new URL('../data/gabarit-g1.json', import.meta.url), 'utf8'));
export const CONFIGURATION = { code: 'CFG-24', gabarit_code: 'G1', gamme_principale: 'PTR30' };
export const RELEVE = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5,
  hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };
```

- [ ] **Step 2 : Test**

```js
// scripts/fumisterie/nomenclature.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerMetre, ENGINE_VERSION } from '../../src/lib/fumisterie/index.js';
import { resoudreArticle } from '../../src/lib/fumisterie/articles.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';
import { ARTICLES, COMPOSANTS, MAPPING, GABARIT, CONFIGURATION, RELEVE } from './fixtures/g1-o150.mjs';

const base = { configuration: CONFIGURATION, gabarit: GABARIT, composants: COMPOSANTS, mapping: MAPPING, articles: ARTICLES, reglages: buildFumisterieConfig(null) };
const refs = (lignes) => lignes.map((l) => `${l.reference}×${l.quantite}`);

test('cas de la maquette Ø150 noir : 14 lignes, 1 480,90 € HT d\'achat, tout résolu', () => {
  const r = calculerMetre({ ...base, releve: RELEVE });
  assert.equal(r.engine_version, ENGINE_VERSION);
  assert.equal(r.lignes.length, 14);
  assert.deepEqual(refs(r.lignes), [
    '2PTICHARN150NO×1', '2PTIELDR1501000NO×1', '2PTIELDR150500NO×1', '2PTIELDR150250NO×1', '2PTICOJO150NO×3',
    '2DIVS2535IN230KEI×1', '2DIVCTOS150×1', '2PTICO30150×2', '2PTIELDR1501000×5',
    '2PTIPPDR150×2', '2PTGCOCF150×2', '2PTIRASR150148×1', '2LEPTUYA1501000NO×1', '2LEPTUYA150500NO×1',
  ]);
  assert.equal(r.totaux.achat_ht, 1480.9);
  assert.equal(r.totaux.vente_ht, 2961.8);
  assert.equal(r.totaux.lignes_a_chiffrer, 0);
  assert.ok(r.lignes.every((l) => l.repere >= 1 && l.repere <= 6));
  assert.equal(r.lignes.find((l) => l.composant_code === 'collier_jonction_exterieur').statut, 'provisoire');
  assert.equal(r.alertes.find((a) => a.code === 'zone1').niveau, 'ok');
});
test('finition inox : chapeau et extérieur inox, intérieur inchangé', () => {
  const r = calculerMetre({ ...base, releve: { ...RELEVE, finition: 'inox' } });
  assert.ok(refs(r.lignes).includes('2PTICHARN150×1'));
  assert.ok(refs(r.lignes).includes('2PTICOJO150×3'));
  assert.ok(refs(r.lignes).includes('2PTIELDR1501000×5'));
});
test('pente 38° hors plages 25-35 → 30-40 ; pente 12° sans solin → ligne à chiffrer + alerte article_manquant', () => {
  assert.ok(refs(calculerMetre({ ...base, releve: { ...RELEVE, pente: 38 } }).lignes).includes('2DIVS3040IN230KEI×1'));
  const r = calculerMetre({ ...base, releve: { ...RELEVE, pente: 12 } });
  const solin = r.lignes.find((l) => l.composant_code === 'solin');
  assert.equal(solin.reference, null); assert.equal(solin.prix_vente_ht, null); assert.equal(solin.quantite, 1);
  assert.equal(r.totaux.lignes_a_chiffrer, 1);
  assert.ok(r.alertes.some((a) => a.code === 'article_manquant' && a.niveau === 'warn' && /solin/i.test(a.message)));
});
test('sans dévoiement : pas de coudes ; réglable intérieur quand le reste tombe dans la plage', () => {
  const r = calculerMetre({ ...base, releve: { ...RELEVE, angle: 0, decal: 0, hCombles: 1.0 } });
  assert.ok(!r.lignes.some((l) => l.composant_code === 'coude_devoiement'));
  // Lint = (6.8 − 2.5) = 4.3 m → 4 × 1000 + réglable 300 ? non (300 < 320) → 4 × 1000 + 500 ; on vérifie juste l'absence de coude et la cohérence
  assert.ok(r.lignes.find((l) => l.composant_code === 'element_droit_interieur'));
});
test('résolution directe : préférence finition exacte, puis motif de code', () => {
  const m = [{ composant_code: 'x', gamme_catalogue: 'PTR30', finition: null, gamme_tarif: 'ABSENTE', type_piece: 'chapeau', motif_code: '^2PTICHARN{D}NO$' }];
  const a = resoudreArticle(ARTICLES, m, { composant_code: 'x', gamme_catalogue: 'PTR30', diametre: 150, finition: 'noir' });
  assert.equal(a.article.reference, '2PTICHARN150NO'); assert.equal(a.via, 'motif');
  assert.equal(resoudreArticle(ARTICLES, [], { composant_code: 'x', gamme_catalogue: 'PTR30', diametre: 150 }).article, null);
});
```

- [ ] **Step 3 : Run** → FAIL.

- [ ] **Step 4 : Implémenter**

```js
// src/lib/fumisterie/articles.js
// Résolution composant générique → article du catalogue — module PUR.
// Entrées : articles (vue majordhome_fum_articles), lignes de fum_composant_mapping, critères.
// Ordre : mapping avec finition exacte > mapping sans finition ; attributs (type, gamme tarif, Ø,
// longueur, angle, pente) ; à défaut, motif de code ({D} = diamètre). null si rien : l'appelant
// crée une ligne « à chiffrer », jamais une omission silencieuse.

/**
 * @param {Array<object>} articles
 * @param {Array<object>} mappings
 * @param {{composant_code:string, gamme_catalogue:string, diametre:number, finition?:string|null, longueur?:number|null, angle?:number|null, pente?:number|null, type_piece?:string|null}} c
 * @returns {{ article: object|null, mapping: object|null, via: 'attributs'|'motif'|null }}
 */
export function resoudreArticle(articles, mappings, c) {
  const candidats = mappings
    .filter((m) => m.composant_code === c.composant_code && m.gamme_catalogue === c.gamme_catalogue)
    .filter((m) => !m.finition || m.finition === c.finition)
    .sort((a, b) => (b.finition ? 1 : 0) - (a.finition ? 1 : 0) || (a.priorite ?? 100) - (b.priorite ?? 100));
  for (const m of candidats) {
    const type = c.type_piece || m.type_piece;
    const parAttributs = articles.filter((a) => a.is_active !== false && !a.sur_mesure && !a.hors_perimetre
      && a.gamme_tarif === m.gamme_tarif && a.type_piece === type && a.diametre_int === c.diametre
      && (c.longueur == null || a.longueur_mm === c.longueur)
      && (c.angle == null || a.angle === c.angle)
      && (c.pente == null || (a.pente_min != null && a.pente_max != null && c.pente >= a.pente_min && c.pente <= a.pente_max))
      && (!m.finition || a.couleur === m.finition || a.couleur == null));
    if (parAttributs.length) {
      parAttributs.sort((a, b) => (a.pente_min ?? 0) - (b.pente_min ?? 0) || String(a.reference).localeCompare(String(b.reference)));
      return { article: parAttributs[0], mapping: m, via: 'attributs' };
    }
    if (m.motif_code) {
      const re = new RegExp(m.motif_code.replace('{D}', String(c.diametre)).replace('{LG}', String(c.longueur ?? '')));
      const parMotif = articles.find((a) => a.is_active !== false && re.test(String(a.reference)));
      if (parMotif) return { article: parMotif, mapping: m, via: 'motif' };
    }
  }
  return { article: null, mapping: candidats[0] || null, via: null };
}
```

```js
// src/lib/fumisterie/nomenclature.js
// Nomenclature chiffrée d'une configuration — module PUR. Applique regle_quantite de chaque
// composant sur la géométrie (tronçons composés) et résout les articles. Une ligne sans article
// sort à prix null + alerte `article_manquant` (rien n'est avalé). Prix : vente = tarif_public,
// achat = purchase_price_ht (prix net Mayer).
import { resoudreArticle } from './articles.js';

const r2 = (v) => Math.round(v * 100) / 100;

function ligne(comp, art, quantite, extra = {}) {
  return {
    repere: comp.repere, composant_code: comp.composant_code, libelle: art ? art.name : comp.libelle,
    sous_libelle: extra.sous_libelle || comp.note || null, troncon: comp.troncon, statut: comp.statut,
    article_id: art ? art.id : null, reference: art ? art.reference : null, quantite, unite: art?.unit || 'pièce',
    prix_vente_ht: art ? Number(art.tarif_public ?? art.selling_price_ht) : null,
    prix_achat_ht: art ? Number(art.purchase_price_ht) : null, tva: extra.tva ?? 20,
  };
}

/**
 * @param {{ composants: object[], mapping: object[], articles: object[], geometrie: object, releve: object, reglages: object }} p
 * @returns {{ lignes: object[], alertes: object[] }}
 */
export function construireNomenclature({ composants, mapping, articles, geometrie, releve, reglages }) {
  const lignes = []; const alertes = [];
  const gamme = (comp) => comp.gammes?.[0] || '';
  const manquant = (comp, criteres) => alertes.push({ niveau: 'warn', code: 'article_manquant', source: 'catalogue',
    message: `${comp.libelle} : aucun article ${criteres} au tarif — ligne à chiffrer.` });
  const resoudre = (comp, c) => resoudreArticle(articles, mapping, { composant_code: comp.composant_code, gamme_catalogue: gamme(comp), diametre: releve.diametre, finition: releve.finition, ...c });
  const qte = (m, q) => q * Number(m?.quantite_par_unite ?? 1);

  for (const comp of [...composants].sort((a, b) => a.ordre - b.ordre)) {
    const [regle, arg] = String(comp.regle_quantite || 'unitaire').split(':');
    const tr = arg ? geometrie.troncons[arg] : null;
    if (regle === 'unitaire') {
      const pente = comp.composant_code === 'solin' ? releve.pente : null;
      const { article, mapping: m } = resoudre(comp, { pente });
      if (!article) manquant(comp, pente != null ? `pour Ø${releve.diametre} et une pente de ${pente}°` : `Ø${releve.diametre}`);
      lignes.push(ligne(comp, article, qte(m, 1), { sous_libelle: pente != null && article ? `Choisi d'après la pente saisie (${pente}°)` : undefined, tva: reglages.tva_fournitures }));
    } else if (regle === 'par_longueur') {
      if (!tr) { alertes.push({ niveau: 'warn', code: 'troncon_inconnu', source: 'gabarit', message: `${comp.libelle} : tronçon ${arg} absent de la géométrie.` }); continue; }
      const comp2 = tr.composition;
      for (const l of reglages.longueurs_elements_mm) {
        if (!comp2.elements[l]) continue;
        const { article, mapping: m } = resoudre(comp, { longueur: l });
        if (!article) manquant(comp, `Lg ${l} Ø${releve.diametre}`);
        lignes.push(ligne(comp, article, qte(m, comp2.elements[l]), { sous_libelle: `Lg ${l} mm`, tva: reglages.tva_fournitures }));
      }
      if (comp2.reglable) {
        const { article, mapping: m } = resoudre(comp, { type_piece: 'element_reglable' });
        if (!article) manquant(comp, `réglable Ø${releve.diametre}`);
        lignes.push(ligne(comp, article, qte(m, comp2.reglable.n), { sous_libelle: `Réglé à ${comp2.reglable.longueur} mm`, tva: reglages.tva_fournitures }));
      }
    } else if (regle === 'par_emboitement') {
      const n = tr ? tr.composition.nb * (reglages.colliers_par_emboitement ?? 1) : 0;
      if (n > 0) {
        const { article, mapping: m } = resoudre(comp, {});
        if (!article) manquant(comp, `Ø${releve.diametre}`);
        lignes.push(ligne(comp, article, qte(m, n), { sous_libelle: '1 par emboîtement', tva: reglages.tva_fournitures }));
      }
    } else if (regle === 'par_plancher') {
      const { article, mapping: m } = resoudre(comp, {});
      if (!article) manquant(comp, `Ø${releve.diametre}`);
      lignes.push(ligne(comp, article, qte(m, geometrie.planchers), { sous_libelle: '1 par plancher traversé', tva: reglages.tva_fournitures }));
    } else if (regle === 'coudes') {
      if (releve.angle > 0) {
        const { article, mapping: m } = resoudre(comp, { angle: releve.angle });
        if (!article) manquant(comp, `${releve.angle}° Ø${releve.diametre}`);
        lignes.push(ligne(comp, article, qte(m, 2), { sous_libelle: `Dévoiement ${releve.angle}° : 2 coudes`, tva: reglages.tva_fournitures }));
      }
    } else {
      alertes.push({ niveau: 'warn', code: 'regle_inconnue', source: 'nomenclature', message: `${comp.libelle} : règle « ${comp.regle_quantite} » inconnue du moteur.` });
    }
  }
  return { lignes, alertes };
}

/** Totaux (achat / vente / marge) sur les lignes chiffrées, et compteur des lignes à chiffrer. */
export function totaliser(lignes) {
  let vente = 0; let achat = 0; let aChiffrer = 0;
  for (const l of lignes) {
    if (l.prix_vente_ht == null) { aChiffrer++; continue; }
    vente += l.prix_vente_ht * l.quantite; achat += (l.prix_achat_ht ?? 0) * l.quantite;
  }
  return { vente_ht: r2(vente), achat_ht: r2(achat), marge_ht: r2(vente - achat), lignes_a_chiffrer: aChiffrer };
}
```

```js
// src/lib/fumisterie/index.js
// Point d'entrée UNIQUE du moteur de métré (écran, edge Hermes, PDF) — module PUR.
// ENGINE_VERSION à incrémenter à tout changement de règle : fum_metres.engine_version le porte
// et l'écran affiche une bannière si le résultat enregistré vient d'une autre version.
import { geometrieG1, hauteurSortieMinimale } from './gabarits/g1.js';
import { controlesG1 } from './controles.js';
import { construireNomenclature, totaliser } from './nomenclature.js';

export const ENGINE_VERSION = 'g1-2026.09';

const GABARITS = {
  G1: { geometrie: geometrieG1, controles: controlesG1, sortieMinimale: hauteurSortieMinimale },
};

/**
 * @param {{ configuration: {code:string, gabarit_code:string}, gabarit: object, composants: object[], mapping: object[],
 *   articles: object[], reglages: object, releve: object }} p
 */
export function calculerMetre({ configuration, gabarit, composants, mapping, articles, reglages, releve }) {
  const code = gabarit?.code || configuration?.gabarit_code;
  const moteur = GABARITS[code];
  if (!moteur) throw new Error(`Gabarit ${code} non pris en charge par le moteur (${ENGINE_VERSION})`);
  const geometrie = moteur.geometrie(releve, reglages);
  const alertes = moteur.controles(geometrie, releve, reglages);
  const nomenclature = construireNomenclature({ composants, mapping, articles, geometrie, releve, reglages });
  const lignes = nomenclature.lignes;
  return { engine_version: ENGINE_VERSION, geometrie, lignes, alertes: [...alertes, ...nomenclature.alertes], totaux: totaliser(lignes) };
}

/** Hauteur de sortie minimale conforme pour le gabarit de la configuration (bouton « Ajuster »). */
export function sortieMinimale({ configuration, gabarit, reglages, releve }) {
  const code = gabarit?.code || configuration?.gabarit_code;
  return GABARITS[code].sortieMinimale(releve, reglages);
}

export { geometrieG1, controlesG1, construireNomenclature, totaliser };
```

- [ ] **Step 5 : Run** `node --test scripts/fumisterie/nomenclature.test.mjs` → PASS (5 tests). Si le total diffère de 1480.90, comparer ligne à ligne avec la liste de la maquette (§4 de `MAQUETTE_metre_svg.md`) : le moteur doit reproduire la maquette, pas l'inverse.

- [ ] **Step 6 : Ajouter les tests à `audit:quality`**

Dans `package.json`, insérer `scripts/fumisterie/parse-designation.test.mjs scripts/fumisterie/compose.test.mjs scripts/fumisterie/g1.test.mjs scripts/fumisterie/nomenclature.test.mjs` dans la liste `node --test` du script `audit:quality`.

- [ ] **Step 7 : Commit** `git add src/lib/fumisterie scripts/fumisterie package.json && git commit -m "feat(fumisterie): résolution d'articles + nomenclature chiffrée, point d'entrée calculerMetre"`

---

### Task 8 : Réglages d'org — onglet Settings → Entretiens & Contrats → Fumisterie

**Files:**
- Create: `src/apps/artisan/pages/settings/entretiens/FumisterieTab.jsx`, `src/apps/artisan/pages/settings/FumisterieSettings.jsx`
- Modify: `src/lib/modules.js:43-46` (tuile), `src/apps/artisan/pages/Settings.jsx:22,31` (icône `Flame`), `src/apps/artisan/routes.jsx` (lazy + route `settings/fumisterie`)

- [ ] **Step 1 : Tuile et route**

`src/lib/modules.js`, module `entretiens`, après la tuile `tournees` :
```js
      { key: 'fumisterie', title: 'Fumisterie', description: 'Finition par défaut, longueurs d\'éléments, fixations, règle de zone 1', icon: 'Flame', href: '/settings/fumisterie', adminOnly: true },
```
`Settings.jsx` : ajouter `Flame` à l'import lucide et à `ICONS`.
`routes.jsx` : `const FumisterieSettings = lazy(() => import('./pages/settings/FumisterieSettings'));` + route calquée sur `settings/tournees` (`RouteGuard resource="settings"`).

- [ ] **Step 2 : Page et onglet**

```jsx
// src/apps/artisan/pages/settings/FumisterieSettings.jsx
import SettingsPage from './SettingsPage';
import FumisterieTab from './entretiens/FumisterieTab';

export default function FumisterieSettings() {
  return (
    <SettingsPage title="Fumisterie" description="Réglages du métré de conduits : finition proposée, éléments disponibles, fixations, règle de zone 1. Les quantités « provisoires » se corrigent ici, pas dans le code.">
      <FumisterieTab />
    </SettingsPage>
  );
}
```

```jsx
// src/apps/artisan/pages/settings/entretiens/FumisterieTab.jsx
// Settings → Entretiens & Contrats → Fumisterie (/settings/fumisterie) : `settings.fumisterie`.
// Défauts et sémantique : src/lib/fumisterie/config.js (DEFAULTS_FUMISTERIE). ⚠ merge JSONB
// niveau 1 → on renvoie l'objet `fumisterie` COMPLET (clés existantes + formulaire).
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildFumisterieConfig } from '@/lib/fumisterie/config.js';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

function depuisSettings(settings) {
  const c = buildFumisterieConfig(settings);
  return {
    finition_defaut: c.finition_defaut,
    longueurs: c.longueurs_elements_mm.join(', '),
    reglable_min: c.reglable.min, reglable_max: c.reglable.max,
    reglable_interieur: c.reglable_interieur, reglable_exterieur: c.reglable_exterieur,
    colliers_par_emboitement: c.colliers_par_emboitement, marge_combles_cm: Math.round(c.marge_combles_m * 100),
    haubanage_m: c.haubanage_m, zone1_pente_cm: Math.round(c.zone1.pente_m * 100), zone1_plat_cm: Math.round(c.zone1.plat_m * 100),
    zone1_pente_plat_deg: c.zone1.pente_plat_deg, tva_fournitures: c.tva_fournitures, tva_pose: c.tva_pose,
  };
}

function versSettings(form, existant) {
  const longueurs = form.longueurs.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return {
    ...(existant || {}),
    finition_defaut: form.finition_defaut,
    longueurs_elements_mm: longueurs,
    reglable: { min: Number(form.reglable_min), max: Number(form.reglable_max) },
    reglable_interieur: !!form.reglable_interieur, reglable_exterieur: !!form.reglable_exterieur,
    colliers_par_emboitement: Number(form.colliers_par_emboitement), marge_combles_m: Number(form.marge_combles_cm) / 100,
    haubanage_m: Number(form.haubanage_m),
    zone1: { pente_m: Number(form.zone1_pente_cm) / 100, plat_m: Number(form.zone1_plat_cm) / 100, pente_plat_deg: Number(form.zone1_pente_plat_deg) },
    tva_fournitures: Number(form.tva_fournitures), tva_pose: Number(form.tva_pose),
  };
}

function validate(form) {
  const errors = {};
  if (!/^\d+(\s*,\s*\d+)*$/.test(form.longueurs.trim())) errors.longueurs = 'Liste de longueurs en mm, séparées par des virgules';
  if (!(Number(form.reglable_min) > 0 && Number(form.reglable_max) > Number(form.reglable_min))) errors.reglable = 'Plage min < max';
  return errors;
}

function Champ({ label, hint, error, children }) {
  return (<div><label className={LABEL_CLASS}>{label}</label>{children}{error ? <p className="mt-1 text-xs text-primary-700">⚠ {error}</p> : hint ? <p className={HINT_CLASS}>{hint}</p> : null}</div>);
}

export default function FumisterieTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => depuisSettings(null));
  const [initial, setInitial] = useState(() => depuisSettings(null));
  useEffect(() => { const p = depuisSettings(settings); setForm(p); setInitial(p); }, [settings]);
  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  const handleSave = async () => {
    try {
      await save({ fumisterie: versSettings(form, settings?.fumisterie) });
      toast.success('Réglages de fumisterie enregistrés');
      setInitial(form);
    } catch (err) { toast.error(err.message || 'Erreur lors de l\'enregistrement'); }
  };

  if (isLoading) return <div className="card text-sm text-secondary-500">Chargement…</div>;
  return (
    <div className="card space-y-8">
      <section>
        <h3 className={SECTION_TITLE}>Choix par défaut</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Champ label="Finition extérieure proposée">
            <select value={form.finition_defaut} onChange={set('finition_defaut')} className={INPUT_CLASS}><option value="noir">Laqué noir</option><option value="inox">Inox</option></select>
          </Champ>
          <Champ label="TVA fournitures / pose (%)"><div className="flex gap-2"><input type="number" value={form.tva_fournitures} onChange={set('tva_fournitures')} className={INPUT_CLASS} /><input type="number" value={form.tva_pose} onChange={set('tva_pose')} className={INPUT_CLASS} /></div></Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Éléments et fixations (règles provisoires)</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Champ label="Longueurs d'éléments droits (mm)" hint="Du plus long au plus court, ex. 1000, 500, 250" error={errors.longueurs}><input value={form.longueurs} onChange={set('longueurs')} className={INPUT_CLASS} /></Champ>
          <Champ label="Élément réglable (mm)" error={errors.reglable}><div className="flex gap-2"><input type="number" value={form.reglable_min} onChange={set('reglable_min')} className={INPUT_CLASS} /><input type="number" value={form.reglable_max} onChange={set('reglable_max')} className={INPUT_CLASS} /></div></Champ>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reglable_interieur} onChange={set('reglable_interieur')} /> Réglable sur la partie intérieure</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reglable_exterieur} onChange={set('reglable_exterieur')} /> Réglable au-dessus du toit</label>
          <Champ label="Colliers de jonction par emboîtement extérieur"><input type="number" min={0} max={3} value={form.colliers_par_emboitement} onChange={set('colliers_par_emboitement')} className={INPUT_CLASS} /></Champ>
          <Champ label="Marge sous toiture pour le dévoiement (cm)"><input type="number" min={0} max={50} value={form.marge_combles_cm} onChange={set('marge_combles_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Conduit libre au-dessus du toit avant haubanage (m)" hint="Catalogue p.33"><input type="number" step="0.5" min={1} max={6} value={form.haubanage_m} onChange={set('haubanage_m')} className={INPUT_CLASS} /></Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Zone 1 (catalogue p.23)</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <Champ label="Au-dessus du faîtage (cm)"><input type="number" value={form.zone1_pente_cm} onChange={set('zone1_pente_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Au-dessus d'un toit plat (cm)"><input type="number" value={form.zone1_plat_cm} onChange={set('zone1_plat_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Pente traitée comme toit plat (≤ °)"><input type="number" value={form.zone1_pente_plat_deg} onChange={set('zone1_pente_plat_deg')} className={INPUT_CLASS} /></Champ>
        </div>
      </section>
      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={!isDirty || !isValid || isSaving} className="btn-primary">{isSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3 : Vérifier** `node --test scripts/modules.test.mjs` (la tuile a sa route) et `npm run lint:errors`.
- [ ] **Step 4 : Commit** `git add src/lib/modules.js src/apps/artisan/pages/Settings.jsx src/apps/artisan/routes.jsx src/apps/artisan/pages/settings/FumisterieSettings.jsx src/apps/artisan/pages/settings/entretiens/FumisterieTab.jsx && git commit -m "feat(fumisterie): réglages d'org settings.fumisterie (Settings → Entretiens → Fumisterie)"`

---

### Task 9 : Service, cache keys et hooks fumisterie

**Files:**
- Create: `src/shared/services/fumisterie.service.js`, `src/shared/hooks/useFumisterie.js`
- Modify: `src/shared/hooks/cacheKeys.js` (ajouter `fumisterieKeys` après `devisKeys`)

**Interfaces:**
- Produces: `fumisterieService.getConfigurations(orgId)`, `getBundle(orgId, configurationId)` → `{ configuration, gabarit, composants, regles, mapping }`, `getArticles(orgId, supplierId, { gammesTarif, diametre })`, `getSupplierMODINOX(orgId)`, `saveMetre(payload)`, `getMetreByQuote(orgId, quoteId)` ; hooks `useFumConfigurations(orgId)`, `useFumBundle(orgId, configurationId)`, `useFumArticles(orgId, supplierId, gammesTarif, diametre)`, `useFumMetreMutations(orgId)` → `{ saveMetre }`, `useFumMetreByQuote(orgId, quoteId)`.

- [ ] **Step 1 : Cache keys**

```js
export const fumisterieKeys = {
  all: (orgId) => ['fumisterie', orgId],
  configurations: (orgId) => [...fumisterieKeys.all(orgId), 'configurations'],
  bundle: (orgId, configurationId) => [...fumisterieKeys.all(orgId), 'bundle', configurationId],
  articles: (orgId, supplierId, gammes, diametre) => [...fumisterieKeys.all(orgId), 'articles', supplierId, [...(gammes || [])].sort().join('|'), diametre],
  supplier: (orgId) => [...fumisterieKeys.all(orgId), 'supplier'],
  metreByQuote: (orgId, quoteId) => [...fumisterieKeys.all(orgId), 'metre', quoteId],
};
```

- [ ] **Step 2 : Service**

```js
// src/shared/services/fumisterie.service.js
// Données du module Fumisterie (vues majordhome_fum_*, security_invoker + filtre org explicite).
// Le moteur (src/lib/fumisterie) ne lit rien lui-même : ce service charge tout d'un coup.
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const NOM_FOURNISSEUR = 'MODINOX / ALTEMA';

export const fumisterieService = {
  getConfigurations: (orgId) => withErrorHandling(async () => {
    if (!orgId) throw new Error('[fumisterieService] orgId requis');
    const { data, error } = await supabase.from('majordhome_fum_configurations').select('*')
      .eq('org_id', orgId).eq('actif', true).order('code');
    if (error) throw error;
    return data || [];
  }, 'fumisterie.getConfigurations'),

  /** Tout ce que le moteur attend pour UNE configuration (hors articles). */
  getBundle: (orgId, configurationId) => withErrorHandling(async () => {
    if (!orgId || !configurationId) throw new Error('[fumisterieService] orgId et configurationId requis');
    const { data: configuration, error: e1 } = await supabase.from('majordhome_fum_configurations').select('*')
      .eq('org_id', orgId).eq('id', configurationId).single();
    if (e1) throw e1;
    const [gab, comps, regles] = await Promise.all([
      configuration.gabarit_id
        ? supabase.from('majordhome_fum_gabarits').select('*').eq('org_id', orgId).eq('id', configuration.gabarit_id).single()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('majordhome_fum_config_composants').select('*').eq('org_id', orgId).eq('configuration_id', configurationId).order('ordre'),
      supabase.from('majordhome_fum_config_regles').select('regle_id, majordhome_fum_regles(*)').eq('org_id', orgId).eq('configuration_id', configurationId),
    ]);
    if (gab.error) throw gab.error; if (comps.error) throw comps.error;
    const composants = comps.data || [];
    const codes = [...new Set(composants.map((c) => c.composant_code))];
    const { data: mapping, error: e4 } = codes.length
      ? await supabase.from('majordhome_fum_composant_mapping').select('*').eq('org_id', orgId).in('composant_code', codes)
      : { data: [], error: null };
    if (e4) throw e4;
    return {
      configuration: { ...configuration, gabarit_code: gab.data?.code || null },
      gabarit: gab.data, composants, mapping: mapping || [],
      regles: regles.error ? [] : (regles.data || []).map((r) => r.majordhome_fum_regles).filter(Boolean),
    };
  }, 'fumisterie.getBundle'),

  getSupplier: (orgId) => withErrorHandling(async () => {
    const { data, error } = await supabase.from('majordhome_suppliers').select('id, name').eq('org_id', orgId).eq('name', NOM_FOURNISSEUR).maybeSingle();
    if (error) throw error;
    return data;
  }, 'fumisterie.getSupplier'),

  /** Articles candidats : toutes les gammes tarif du mapping, au diamètre du relevé. */
  getArticles: (orgId, supplierId, { gammesTarif, diametre }) => withErrorHandling(async () => {
    if (!orgId || !supplierId || !diametre || !gammesTarif?.length) return [];
    const { data, error } = await supabase.from('majordhome_fum_articles').select('*')
      .eq('org_id', orgId).eq('supplier_id', supplierId).eq('is_active', true)
      .in('gamme_tarif', gammesTarif).eq('diametre_int', diametre);
    if (error) throw error;
    return data || [];
  }, 'fumisterie.getArticles'),

  saveMetre: ({ orgId, quoteId = null, leadId = null, configurationId, gabaritCode, diametre, finition, releve, resultat, engineVersion, createdBy }) =>
    withErrorHandling(async () => {
      if (!orgId || !configurationId) throw new Error('[fumisterieService] orgId et configurationId requis');
      const { data, error } = await supabase.from('majordhome_fum_metres').insert({
        org_id: orgId, quote_id: quoteId, lead_id: leadId, configuration_id: configurationId, gabarit_code: gabaritCode,
        diametre, finition, releve, resultat, engine_version: engineVersion, created_by: createdBy || null,
      }).select().single();
      if (error) throw error;
      return data;
    }, 'fumisterie.saveMetre'),

  getMetreByQuote: (orgId, quoteId) => withErrorHandling(async () => {
    const { data, error } = await supabase.from('majordhome_fum_metres').select('*').eq('org_id', orgId).eq('quote_id', quoteId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }, 'fumisterie.getMetreByQuote'),
};
```

Vérifier la signature réelle de `withErrorHandling` dans `src/lib/serviceHelpers.js` (ordre des arguments, retour `{ data, error }`) et s'y conformer.

- [ ] **Step 3 : Hooks**

```js
// src/shared/hooks/useFumisterie.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fumisterieService } from '@services/fumisterie.service';
import { fumisterieKeys } from '@hooks/cacheKeys';
import { unwrapResult } from '@/lib/serviceHelpers';

export { fumisterieKeys };

export function useFumConfigurations(orgId) {
  return useQuery({ queryKey: fumisterieKeys.configurations(orgId), queryFn: () => unwrapResult(fumisterieService.getConfigurations(orgId)), enabled: !!orgId, staleTime: 5 * 60 * 1000 });
}
export function useFumBundle(orgId, configurationId) {
  return useQuery({ queryKey: fumisterieKeys.bundle(orgId, configurationId), queryFn: () => unwrapResult(fumisterieService.getBundle(orgId, configurationId)), enabled: !!orgId && !!configurationId, staleTime: 5 * 60 * 1000 });
}
export function useFumSupplier(orgId) {
  return useQuery({ queryKey: fumisterieKeys.supplier(orgId), queryFn: () => unwrapResult(fumisterieService.getSupplier(orgId)), enabled: !!orgId, staleTime: 30 * 60 * 1000 });
}
export function useFumArticles(orgId, supplierId, gammesTarif, diametre) {
  return useQuery({
    queryKey: fumisterieKeys.articles(orgId, supplierId, gammesTarif, diametre),
    queryFn: () => unwrapResult(fumisterieService.getArticles(orgId, supplierId, { gammesTarif, diametre })),
    enabled: !!orgId && !!supplierId && !!diametre && (gammesTarif?.length || 0) > 0, staleTime: 5 * 60 * 1000,
  });
}
export function useFumMetreByQuote(orgId, quoteId) {
  return useQuery({ queryKey: fumisterieKeys.metreByQuote(orgId, quoteId), queryFn: () => unwrapResult(fumisterieService.getMetreByQuote(orgId, quoteId)), enabled: !!orgId && !!quoteId });
}
export function useFumMetreMutations(orgId) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (payload) => unwrapResult(fumisterieService.saveMetre({ orgId, ...payload })),
    onSuccess: (data) => { if (data?.quote_id) qc.invalidateQueries({ queryKey: fumisterieKeys.metreByQuote(orgId, data.quote_id) }); },
  });
  return { saveMetre: save.mutateAsync, isSaving: save.isPending };
}
```

- [ ] **Step 4 :** `npm run lint:errors` ; commit `git add src/shared/services/fumisterie.service.js src/shared/hooks/useFumisterie.js src/shared/hooks/cacheKeys.js && git commit -m "feat(fumisterie): service, cache keys et hooks (configurations, bundle, articles, métrés)"`

---

### Task 10 : Coupe cotée SVG (`CoupeCotee`)

**Files:**
- Create: `src/apps/artisan/components/devis/metre/CoupeCotee.jsx`

**Interfaces:**
- Consumes: `geometrie` de `calculerMetre`, `releve`.
- Produces: `<CoupeCotee geometrie releve onFocusChamp={(cle) => …} />` : rendu pur, cotes cliquables (clic ou Entrée → `onFocusChamp(cle)`), repères 1-6, lignes Faîtage / Minimum zone (bleu si respecté, jaune sinon, avec ✓ / ⚠).

- [ ] **Step 1 : Implémenter** — port de `draw()` de la maquette en JSX (mêmes calculs de cadrage `minX/maxX/minY/maxY`, `X()`/`Y()`, mêmes primitives : sol, murs, planchers, toiture, appareil, simple paroi, PTR intérieur/extérieur, solin, chapeau, faîtage, zone, cotes `vdim`/`hdim`, repères `call`). Classes Tailwind à la place des variables CSS : parois `fill-secondary-100 stroke-secondary-300`, planchers `fill-secondary-300`, toiture `fill-secondary-400`, PTR intérieur `stroke-secondary-500`, extérieur noir `stroke-secondary-900` / inox `stroke-secondary-500`, simple paroi `stroke-secondary-800`, appareil `fill-secondary-800` + vitre `fill-primary-400`, zone respectée `stroke-secondary-600` / non `stroke-primary-500`, repères `fill-primary-400 stroke-secondary-900`. Structure :

```jsx
// src/apps/artisan/components/devis/metre/CoupeCotee.jsx
// Coupe cotée du gabarit G1 — RENDU PUR (aucun calcul métier : tout vient de `geometrie`).
// Port de draw() de docs/devis-fumisterie/maquette_metre_ptr30.html. Une cote = <g role="button">
// : clic / Entrée → onFocusChamp(cle) et le formulaire met le champ en édition.
import { useMemo } from 'react';

const fmt = (v) => Number(v).toFixed(2).replace('.', ',');
const rad = (d) => (d * Math.PI) / 180;

export default function CoupeCotee({ geometrie: c, releve: i, onFocusChamp }) {
  const scene = useMemo(() => {
    const tp = Math.tan(rad(Math.max(i.pente, 1)));
    const dec = c.dec; const xr = dec + i.dFaitage;
    const yTop = (x) => c.yRoofTop + (x <= xr ? (x - dec) : (2 * xr - x - dec)) * tp;
    let xL = dec - (c.yRoofTop - i.epToit - c.yC) / tp; xL = Math.max(Math.min(xL, -1.1), -5.5);
    const xR = Math.min(xr + (xr - xL), xr + 6);
    const topY = Math.max(c.topAct, c.yReq, c.yRidge) + 0.55;
    const minX = xL - 3.3; const maxX = Math.max(xR, dec + 1.2) + 2.4; const minY = -0.45; const maxY = topY + 0.25;
    const sc = Math.min(760 / (maxX - minX), 980 / (maxY - minY));
    return { tp, dec, xr, yTop, xL, xR, minX, maxX, maxY, sc, VW: (maxX - minX) * sc, VH: (maxY - minY) * sc,
      X: (x) => (x - minX) * sc, Y: (y) => (maxY - y) * sc };
  }, [c, i]);
  const { dec, xr, yTop, xL, xR, maxX, sc, VW, VH, X, Y } = scene;
  const pts = (arr) => arr.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const zoneOK = c.topAct >= c.yReq - 1e-6;
  const inox = i.finition === 'inox';
  const pw = Math.max(6, (i.diametre >= 180 ? 0.24 : 0.21) * sc);
  const cote = (key, cle, label, x1, y1, x2, y2, horizontal = false, side = 'l') => {
    const tx = `${fmt(horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1))} m`; const bw = tx.length * 8.2 + 10;
    const mx = horizontal ? (X(x1) + X(x2)) / 2 : (side === 'r' ? X(x1) + 6 + bw / 2 : X(x1) - 6 - bw / 2);
    const my = horizontal ? Y(y1) - 16 : (Y(y1) + Y(y2)) / 2;
    const go = () => onFocusChamp?.(cle);
    return (
      <g key={key} role="button" tabIndex={0} aria-label={`Modifier ${label}`} className="cursor-pointer outline-none [&:focus_rect]:stroke-primary-500 [&:hover_text]:fill-secondary-700" onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
        <title>{label}</title>
        <line x1={X(x1)} y1={Y(y1)} x2={X(x2)} y2={Y(y2)} className="stroke-secondary-500" strokeWidth={1} />
        <rect x={mx - bw / 2} y={my - 11} width={bw} height={22} rx={3} className="fill-white stroke-transparent" strokeWidth={1.5} />
        <text x={mx} y={my + 4.5} textAnchor="middle" className="fill-secondary-900 font-mono text-[13px] font-semibold">{tx}</text>
      </g>
    );
  };
  const repere = (n, x, y, lx, ly) => (
    <g key={`rep${n}`}><line x1={X(x)} y1={Y(y)} x2={X(lx)} y2={Y(ly)} className="stroke-secondary-900" strokeWidth={1} />
      <circle cx={X(lx)} cy={Y(ly)} r={12} className="fill-primary-400 stroke-secondary-900" strokeWidth={1.2} />
      <text x={X(lx)} y={Y(ly)} textAnchor="middle" dominantBaseline="central" className="fill-secondary-900 text-[15px] font-bold">{n}</text></g>
  );
  const dx1 = xL - 0.55; const dx2 = xL - 1.35; const over = 0.45; const xa = xL - over; const xb = xR + over; const aw = 0.62; const cw = 0.36; const sw = 0.34;
  const slabs = [i.hsp1]; if (i.nbEtages) slabs.push(i.hsp1 + i.epPl + i.hsp2);
  const intPts = i.angle > 0 ? [[0, i.hsp1], [0, c.yDevS], [dec, c.yDevE], [dec, c.yRoofTop]] : [[0, i.hsp1], [0, c.yRoofTop]];
  return (
    <svg viewBox={`0 0 ${VW.toFixed(1)} ${VH.toFixed(1)}`} role="img" aria-label="Coupe du conduit avec cotes" className="block w-full h-auto max-h-[78vh]">
      <rect x={X(xL - 0.6)} y={Y(0)} width={(xR - xL + 1.2) * sc} height={0.35 * sc} className="fill-secondary-300" />
      <polygon points={pts([[xL, 0], [xL, yTop(xL) - i.epToit], [xr, yTop(xr) - i.epToit], [xR, yTop(xR) - i.epToit], [xR, 0]])} className="fill-secondary-100 stroke-secondary-300" />
      {slabs.map((y) => <rect key={y} x={X(xL)} y={Y(y + i.epPl)} width={(xR - xL) * sc} height={i.epPl * sc} className="fill-secondary-300" />)}
      <polygon points={pts([[xa, yTop(xa)], [xr, yTop(xr)], [xb, yTop(xb)], [xb, yTop(xb) - i.epToit], [xr, yTop(xr) - i.epToit], [xa, yTop(xa) - i.epToit]])} className="fill-secondary-400" />
      <rect x={X(-aw / 2)} y={Y(i.hBuse - 0.06)} width={aw * sc} height={(i.hBuse - 0.06) * sc} rx={4} className="fill-secondary-800" />
      <rect x={X(-aw / 2 + 0.1)} y={Y(i.hBuse * 0.62)} width={(aw - 0.2) * sc} height={i.hBuse * 0.3 * sc} rx={2} className="fill-primary-400" />
      <line x1={X(0)} y1={Y(i.hBuse - 0.06)} x2={X(0)} y2={Y(i.hsp1)} className="stroke-secondary-800" strokeWidth={Math.max(4, pw * 0.62)} />
      <polyline points={pts(intPts)} fill="none" className="stroke-secondary-500" strokeWidth={pw} strokeLinejoin="round" />
      <polyline points={pts(intPts)} fill="none" className="stroke-white" strokeWidth={Math.max(1.5, pw * 0.28)} strokeLinejoin="round" />
      <line x1={X(dec)} y1={Y(c.yRoofTop - 0.02)} x2={X(dec)} y2={Y(c.topAct)} className={inox ? 'stroke-secondary-500' : 'stroke-secondary-900'} strokeWidth={pw} />
      <polygon points={pts([[dec - sw, yTop(dec - sw) + 0.03], [dec + sw, yTop(dec + sw) + 0.03], [dec + pw / sc * 0.7, yTop(dec) + 0.28], [dec - pw / sc * 0.7, yTop(dec) + 0.22]])} className="fill-secondary-600" />
      <rect x={X(dec - cw / 2)} y={Y(c.topAct + 0.12)} width={cw * sc} height={0.045 * sc} rx={2} className={inox ? 'fill-secondary-500' : 'fill-secondary-900'} />
      <rect x={X(dec - 0.07)} y={Y(c.topAct + 0.08)} width={0.14 * sc} height={0.08 * sc} className={inox ? 'fill-secondary-500' : 'fill-secondary-900'} />
      <line x1={X(xr - 1.2)} y1={Y(c.yRidge)} x2={X(maxX - 0.2)} y2={Y(c.yRidge)} className="stroke-secondary-400" strokeDasharray="4 4" />
      <text x={X(xr) + 8} y={Y(c.yRidge) + 15} className="fill-secondary-500 text-[12px]">Faîtage</text>
      <line x1={X(dec - 0.9)} y1={Y(c.yReq)} x2={X(maxX - 0.2)} y2={Y(c.yReq)} className={zoneOK ? 'stroke-secondary-600' : 'stroke-primary-500'} strokeDasharray="8 5" strokeWidth={2.2} />
      <text x={X(maxX - 0.2)} y={Y(c.yReq) - 7} textAnchor="end" className="fill-secondary-900 text-[12.5px] font-semibold">{(zoneOK ? '✓ ' : '⚠ ') + (c.flat ? 'Toit plat : +1,20 m' : 'Faîtage + 40 cm (zone 1)')}</text>
      {cote('buse', 'hBuse', 'Hauteur de buse', dx1, 0, dx1, i.hBuse)}
      {cote('sp', 'hBuse', 'Raccordement simple paroi (calculé)', dx1, i.hBuse, dx1, i.hsp1)}
      {cote('hsp1', 'hsp1', 'Hauteur sous plafond', dx2, 0, dx2, i.hsp1)}
      {i.nbEtages ? cote('hsp2', 'hsp2', 'Hauteur étage', dx2, i.hsp1 + i.epPl, dx2, i.hsp1 + i.epPl + i.hsp2) : null}
      {cote('combles', 'hCombles', 'Hauteur combles', dx2, c.yC, dx2, c.yC + i.hCombles)}
      {cote('sortie', 'hSortie', 'Hauteur de sortie au-dessus du toit', Math.max(xR, dec + 0.6) + 0.6, c.yRoofTop, Math.max(xR, dec + 0.6) + 0.6, c.topAct, false, 'r')}
      {i.angle > 0 ? cote('decal', 'decal', 'Décalage du dévoiement', 0, c.yDevS - 0.35, dec, c.yDevS - 0.35, true) : null}
      {i.dFaitage > 0.05 ? cote('faitage', 'dFaitage', 'Distance sortie → faîtage', dec, Math.max(c.topAct, c.yReq) + 0.35, xr, Math.max(c.topAct, c.yReq) + 0.35, true) : null}
      {repere(1, dec - cw / 2, c.topAct + 0.12, dec - 0.85, c.topAct + 0.25)}
      {repere(2, dec, (c.yRoofTop + c.topAct) / 2 + 0.1, dec - 0.85, (c.yRoofTop + c.topAct) / 2 + 0.1)}
      {repere(3, dec - sw * 0.6, yTop(dec - sw * 0.6) + 0.05, dec - 1.05, yTop(dec) - 0.45)}
      {i.angle > 0 ? repere(4, dec / 2, (c.yDevS + c.yDevE) / 2, 0.8 + dec, (c.yDevS + c.yDevE) / 2 - 0.1) : repere(4, 0, (c.yC + c.yRoofTop) / 2, 0.8, (c.yC + c.yRoofTop) / 2)}
      {repere(5, 0, i.hsp1 + i.epPl / 2, 0.9, i.hsp1 + i.epPl / 2 + 0.35)}
      {repere(6, 0, (i.hBuse + i.hsp1) / 2, 0.85, (i.hBuse + i.hsp1) / 2)}
    </svg>
  );
}
```

- [ ] **Step 2 : Vérification visuelle rapide** — ouvrir `docs/devis-fumisterie/maquette_metre_ptr30.html` dans un navigateur à côté de l'écran de la Task 11 (même relevé) : mêmes proportions, mêmes repères, même ligne de zone.
- [ ] **Step 3 : Commit** `git add src/apps/artisan/components/devis/metre/CoupeCotee.jsx && git commit -m "feat(fumisterie): coupe cotée SVG (rendu pur, cotes cliquables)"`

---

### Task 11 : Écran de métré (`MetreFumisterie`) et intégration dans le devis

**Files:**
- Create: `src/apps/artisan/components/devis/metre/MetreFumisterie.jsx`, `QualificationStep.jsx`, `ReleveStep.jsx`, `ReleveForm.jsx`, `ListePieces.jsx`, `useMetreDraft.js`
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx:111-205` (SectionBlock : bouton « Métré assisté »), `:211` (props `onMetre`), `src/apps/artisan/components/devis/CreateDevisModal.jsx:31-40,216-222` (état `metre`, sauvegarde après création)

**Interfaces:**
- `<MetreFumisterie orgId leadId onClose onValidate({ lignesDevis, metre }) />`. `lignesDevis` = lignes prêtes pour `setLines` (`line_type:'product'`, `supplier_product_id`, `supplier_id`, `designation`, `description`, `reference`, `quantity`, `unit`, `purchase_price_ht`, `unit_price_ht`, `tva_rate`). `metre` = `{ configurationId, gabaritCode, diametre, finition, releve, resultat, engineVersion }` (payload de `saveMetre` sans `orgId/quoteId`).

- [ ] **Step 1 : Brouillon local**

```js
// src/apps/artisan/components/devis/metre/useMetreDraft.js
// Saisie en cours du métré, par utilisateur (réseau garanti : ce n'est qu'un filet anti-perte).
import { useCallback, useEffect, useState } from 'react';
import { logger } from '@lib/logger';

const key = (userId) => `fum-metre-draft:${userId || 'anon'}`;

export function useMetreDraft(userId) {
  const [draft, setDraft] = useState(() => {
    try { const raw = localStorage.getItem(key(userId)); return raw ? JSON.parse(raw) : null; } catch (e) { logger.warn('[useMetreDraft] lecture', e); return null; }
  });
  useEffect(() => {
    try { if (draft) localStorage.setItem(key(userId), JSON.stringify(draft)); else localStorage.removeItem(key(userId)); } catch (e) { logger.warn('[useMetreDraft] écriture', e); }
  }, [draft, userId]);
  const clear = useCallback(() => setDraft(null), []);
  return { draft, setDraft, clear };
}
```

- [ ] **Step 2 : Qualification**

```jsx
// src/apps/artisan/components/devis/metre/QualificationStep.jsx
// Étape 1 : critères → configurations compatibles (filtrage déterministe, aucune IA).
// Une configuration sans gabarit (pas encore métrable) est listée grisée avec le motif.
import { Flame, Lock, AlertTriangle } from 'lucide-react';

export const CRITERES = {
  projet: [['creation_interieur', 'Création de conduit intérieur'], ['creation_exterieur', 'Création de conduit extérieur'], ['tubage', 'Tubage d\'un conduit existant'], ['raccordement', 'Raccordement seul']],
  appareil: [['poele_cuisiniere', 'Poêle ou cuisinière'], ['foyer_insert', 'Foyer ou insert'], ['chaudiere', 'Chaudière']],
  combustible: [['bois_buches', 'Bois bûches'], ['pellets', 'Pellets / granulés']],
  zone: [['zone_1', 'Zone 1 (au-dessus du faîtage)'], ['zone_2', 'Zone 2 (entre gouttière et faîtage)'], ['zone_3', 'Zone 3 (façade / ventouse)']],
  prise_air: [['dans_piece', 'Air pris dans la pièce'], ['dans_conduit', 'Air pris dans le conduit (appareil étanche)']],
};

/** Configurations compatibles avec les critères (un critère vide = pas de filtre). */
export function filtrerConfigurations(configurations, q) {
  return configurations.filter((c) =>
    (!q.projet || c.projets.includes(q.projet))
    && (!q.appareil || c.appareils.includes(q.appareil))
    && (!q.combustible || c.combustibles.includes(q.combustible))
    && (!q.zone || c.zones.length === 0 || c.zones.includes(q.zone))
    && (!q.prise_air || c.prise_air.includes(q.prise_air)));
}

function Choix({ label, options, value, onChange }) {
  return (
    <div>
      <p className="text-xs font-medium text-secondary-600 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(value === v ? null : v)}
            className={`px-3 py-2 rounded-lg text-sm border ${value === v ? 'bg-primary-100 border-primary-400 text-primary-800 font-medium' : 'bg-white border-secondary-200 text-secondary-600 hover:border-primary-300'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export default function QualificationStep({ configurations, criteres, setCriteres, selectedId, onSelect }) {
  const compatibles = filtrerConfigurations(configurations, criteres);
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        {Object.entries(CRITERES).map(([k, opts]) => <Choix key={k} label={{ projet: 'Projet', appareil: 'Appareil', combustible: 'Combustible', zone: 'Sortie', prise_air: 'Prise d\'air' }[k]} options={opts} value={criteres[k]} onChange={(v) => setCriteres((c) => ({ ...c, [k]: v }))} />)}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-secondary-600">{compatibles.length} configuration{compatibles.length > 1 ? 's' : ''} compatible{compatibles.length > 1 ? 's' : ''}</p>
        {compatibles.map((c) => {
          const metrable = !!c.gabarit_id; const bloquee = !!c.condition_bloquante; const zoneSensible = (c.zones || []).some((z) => z !== 'zone_1');
          return (
            <button key={c.id} type="button" disabled={!metrable} onClick={() => onSelect(c.id)}
              className={`w-full text-left p-3 rounded-lg border ${selectedId === c.id ? 'border-primary-400 bg-primary-50' : 'border-secondary-200 bg-white'} ${metrable ? 'hover:border-primary-300' : 'opacity-60 cursor-not-allowed'}`}>
              <div className="flex items-start gap-2">
                <Flame className="w-4 h-4 mt-0.5 text-secondary-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-secondary-900">{c.titre}</p>
                  <p className="text-xs text-secondary-500">{c.code} · catalogue p.{c.page_catalogue} · {c.gamme_principale}</p>
                  {!metrable && <p className="text-xs text-secondary-600 mt-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Métré non disponible pour cette configuration (à venir)</p>}
                  {bloquee && <p className="text-xs text-primary-800 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Condition : {c.condition_bloquante}</p>}
                  {zoneSensible && <p className="text-xs text-primary-800 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Zones 2/3 : validation technicien obligatoire</p>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3 : Formulaire de relevé piloté par le gabarit**

```jsx
// src/apps/artisan/components/devis/metre/ReleveForm.jsx
// Formulaire généré depuis fum_gabarits.troncons (aucun champ codé en dur). `si` masque un
// paramètre conditionnel ({ nbEtages: 1 } ou { angle: '>0' }). Les inputs portent id=`fum-${cle}`
// pour le focus depuis la coupe cotée.
import { forwardRef } from 'react';

const INPUT = 'w-full px-2 py-1.5 border border-secondary-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500';

function visible(p, releve) {
  if (!p.si) return true;
  return Object.entries(p.si).every(([k, v]) => (v === '>0' ? Number(releve[k]) > 0 : releve[k] === v));
}

export default function ReleveForm({ gabarit, releve, onChange, onAjuster, minSortie }) {
  const set = (cle, v) => onChange({ ...releve, [cle]: v });
  return (
    <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="space-y-4">
      {gabarit.troncons.map((t) => (
        <fieldset key={t.type} className="border-t border-secondary-200 pt-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-secondary-500">{t.libelle}</legend>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {t.parametres.filter((p) => visible(p, releve)).map((p) => (
              <div key={p.cle} className={p.choix && p.choix.length > 2 ? 'col-span-2' : ''}>
                <label htmlFor={`fum-${p.cle}`} className="block text-xs text-secondary-600 mb-1">{p.libelle}</label>
                {p.choix ? (
                  <div className="flex border border-secondary-300 rounded-md overflow-hidden" role="group" aria-label={p.libelle}>
                    {p.choix.map((c) => (
                      <button key={String(c)} type="button" aria-pressed={releve[p.cle] === c} onClick={() => set(p.cle, c)}
                        className={`flex-1 px-2 py-1.5 text-sm font-mono border-l first:border-l-0 border-secondary-200 ${releve[p.cle] === c ? 'bg-secondary-700 text-white font-semibold' : 'bg-secondary-50 text-secondary-800'}`}>
                        {typeof c === 'number' && p.unite === '°' ? (c === 0 ? 'Aucun' : `${c}°`) : typeof c === 'number' && p.cle === 'nbEtages' ? (c === 0 ? 'Aucun' : '1 étage') : typeof c === 'number' ? `Ø ${c}` : c === 'noir' ? 'Noir' : c === 'inox' ? 'Inox' : String(c)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <input id={`fum-${p.cle}`} type="number" step={p.pas} min={p.min} max={p.max} value={releve[p.cle] ?? ''} onChange={(e) => set(p.cle, e.target.value === '' ? '' : Number(e.target.value))} className={INPUT} />
                    <span className="text-xs text-secondary-500 w-6">{p.unite}</span>
                  </div>
                )}
              </div>
            ))}
            {t.type === 'sortie_toit' && (
              <div className="col-span-2">
                <button type="button" onClick={onAjuster} className="w-full text-left px-3 py-2 rounded-md border border-secondary-400 bg-secondary-50 text-sm font-medium text-secondary-800 hover:bg-secondary-700 hover:text-white">↥ Ajuster la sortie au minimum de zone 1</button>
                {minSortie != null && <p className="text-xs text-secondary-500 mt-1">Minimum réglementaire calculé : {Number(minSortie).toFixed(2).replace('.', ',')} m au-dessus du toit.</p>}
              </div>
            )}
          </div>
        </fieldset>
      ))}
    </form>
  );
}
```

- [ ] **Step 4 : Liste de pièces et contrôles**

```jsx
// src/apps/artisan/components/devis/metre/ListePieces.jsx
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { formatEuro } from '@/lib/utils';

const STATUT = { catalogue: 'bg-secondary-100 text-secondary-700 border-secondary-300', implicite: 'bg-white text-secondary-600 border-secondary-200', provisoire: 'bg-primary-50 text-primary-800 border-primary-300' };
const NIVEAU = { ok: ['✓ Conforme', 'border-secondary-500 bg-secondary-50', CheckCircle2], warn: ['⚠ À vérifier', 'border-primary-500 bg-primary-50', AlertTriangle], info: ['ⓘ Info', 'border-secondary-300 bg-white', Info] };

export function Alertes({ alertes }) {
  return (
    <div className="space-y-2">
      {alertes.map((a, i) => { const [tag, cls, Icon] = NIVEAU[a.niveau] || NIVEAU.info; return (
        <div key={`${a.code}-${i}`} className={`flex gap-2 items-start border-l-4 px-3 py-2 text-sm ${cls}`}><Icon className="w-4 h-4 mt-0.5 shrink-0" /><span><b className="font-mono text-[11px] uppercase mr-2">{tag}</b>{a.message}{a.source ? <span className="text-xs text-secondary-500"> — {a.source}</span> : null}</span></div>
      ); })}
    </div>
  );
}

export default function ListePieces({ lignes, totaux }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-secondary-500 border-b-2 border-secondary-900">
          <th className="py-2 pr-2">Rep.</th><th className="py-2 pr-2">Désignation</th><th className="py-2 pr-2">Référence</th><th className="py-2 pr-2 text-right">Qté</th><th className="py-2 pr-2 text-right">PU vente HT</th><th className="py-2 pr-2 text-right">PU achat HT</th><th className="py-2 text-right">Total vente HT</th></tr></thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-secondary-100 align-top">
              <td className="py-2 pr-2"><span className="inline-grid place-items-center w-6 h-6 rounded-full bg-primary-400 text-secondary-900 font-bold border border-secondary-900 text-xs">{l.repere}</span></td>
              <td className="py-2 pr-2">{l.libelle}<span className={`ml-2 inline-block border rounded px-1.5 text-[10px] uppercase font-mono ${STATUT[l.statut]}`}>{l.statut}</span>{l.sous_libelle && <span className="block text-xs text-secondary-500">{l.sous_libelle}</span>}</td>
              <td className="py-2 pr-2 font-mono text-xs text-secondary-600">{l.reference || '—'}</td>
              <td className="py-2 pr-2 text-right font-mono">{l.quantite}</td>
              <td className="py-2 pr-2 text-right font-mono">{l.prix_vente_ht != null ? formatEuro(l.prix_vente_ht) : '—'}</td>
              <td className="py-2 pr-2 text-right font-mono text-secondary-500">{l.prix_achat_ht != null ? formatEuro(l.prix_achat_ht) : '—'}</td>
              <td className="py-2 text-right font-mono">{l.prix_vente_ht != null ? formatEuro(l.prix_vente_ht * l.quantite) : <span className="text-primary-800">à chiffrer</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t-2 border-secondary-900 font-semibold">
          <td colSpan={4} className="py-2">Fournitures fumisterie{totaux.lignes_a_chiffrer > 0 && <span className="text-primary-800 font-normal"> · dont {totaux.lignes_a_chiffrer} ligne{totaux.lignes_a_chiffrer > 1 ? 's' : ''} à chiffrer</span>}</td>
          <td colSpan={2} className="py-2 text-right text-xs text-secondary-500 font-normal">achat {formatEuro(totaux.achat_ht)} · marge {formatEuro(totaux.marge_ht)}</td>
          <td className="py-2 text-right text-lg">{formatEuro(totaux.vente_ht)}</td></tr></tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Step 5 : Étape relevé (calcul en direct)**

```jsx
// src/apps/artisan/components/devis/metre/ReleveStep.jsx
import { useMemo } from 'react';
import { calculerMetre, sortieMinimale } from '@/lib/fumisterie/index.js';
import CoupeCotee from './CoupeCotee';
import ReleveForm from './ReleveForm';
import ListePieces, { Alertes } from './ListePieces';

export default function ReleveStep({ bundle, articles, reglages, releve, setReleve }) {
  const resultat = useMemo(() => {
    try { return calculerMetre({ ...bundle, articles, reglages, releve }); }
    catch (e) { return { erreur: e.message, lignes: [], alertes: [{ niveau: 'warn', code: 'moteur', message: e.message, source: 'moteur' }], totaux: { vente_ht: 0, achat_ht: 0, marge_ht: 0, lignes_a_chiffrer: 0 }, geometrie: null }; }
  }, [bundle, articles, reglages, releve]);
  const minSortie = resultat.geometrie ? resultat.geometrie.minSortie : null;
  const focusChamp = (cle) => { const el = document.getElementById(`fum-${cle}`); if (el) { el.focus(); el.select?.(); } };
  const ajuster = () => setReleve({ ...releve, hSortie: sortieMinimale({ ...bundle, reglages, releve }) });
  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-[1.45fr_1fr] gap-5 items-start">
        <div className="border border-secondary-200 rounded-xl bg-white p-2 lg:sticky lg:top-2">
          <p className="px-2 py-1 text-xs uppercase tracking-wide text-secondary-500">Coupe cotée · cliquez une cote pour la modifier</p>
          {resultat.geometrie && <CoupeCotee geometrie={resultat.geometrie} releve={releve} onFocusChamp={focusChamp} />}
        </div>
        <div className="border border-secondary-200 rounded-xl bg-white p-4"><ReleveForm gabarit={bundle.gabarit} releve={releve} onChange={setReleve} onAjuster={ajuster} minSortie={minSortie} /></div>
      </div>
      <section className="border border-secondary-200 rounded-xl bg-white p-4"><h3 className="text-xs uppercase tracking-wide text-secondary-500 mb-2">Contrôles</h3><Alertes alertes={resultat.alertes} /></section>
      <section className="border border-secondary-200 rounded-xl bg-white p-4"><h3 className="text-xs uppercase tracking-wide text-secondary-500 mb-2">Liste de pièces chiffrée · {resultat.lignes.length} lignes · Ø{releve.diametre}</h3><ListePieces lignes={resultat.lignes} totaux={resultat.totaux} /></section>
    </div>
  );
}
```

- [ ] **Step 6 : Orchestrateur**

```jsx
// src/apps/artisan/components/devis/metre/MetreFumisterie.jsx
// Métré assisté (plein écran, au-dessus de CreateDevisModal) : qualification → relevé → validation.
// Les lignes validées sont injectées dans la section FUMISTERIE du devis ; le métré (relevé +
// résultat FIGÉ + engine_version) est rendu à l'appelant, qui l'enregistre après création du devis.
import { useMemo, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useFumConfigurations, useFumBundle, useFumSupplier, useFumArticles } from '@hooks/useFumisterie';
import { buildFumisterieConfig } from '@/lib/fumisterie/config.js';
import { calculerMetre } from '@/lib/fumisterie/index.js';
import QualificationStep from './QualificationStep';
import ReleveStep from './ReleveStep';
import { useMetreDraft } from './useMetreDraft';

function releveInitial(gabarit, reglages) {
  const r = {};
  for (const t of gabarit.troncons) for (const p of t.parametres) r[p.cle] = p.defaut ?? null;
  r.finition = reglages.finition_defaut;
  return r;
}

/** Lignes de devis (shape de DevisStepLines) depuis les lignes du moteur. */
export function versLignesDevis(lignes, supplierId, supplierName) {
  return lignes.map((l) => ({
    line_type: 'product', supplier_product_id: l.article_id, supplier_id: l.article_id ? supplierId : null, supplier_name: l.article_id ? supplierName : null,
    designation: l.libelle, description: [`Rep. ${l.repere}`, l.sous_libelle, l.statut === 'provisoire' ? 'quantité provisoire' : null, l.article_id ? null : 'À CHIFFRER'].filter(Boolean).join(' · '),
    reference: l.reference || '', quantity: l.quantite, unit: l.unite || 'pièce',
    purchase_price_ht: l.prix_achat_ht, unit_price_ht: l.prix_vente_ht ?? 0, tva_rate: l.tva,
  }));
}

export default function MetreFumisterie({ orgId, leadId, onClose, onValidate }) {
  const { user } = useAuth();
  const { settings } = useOrgSettings();
  const reglages = useMemo(() => buildFumisterieConfig(settings), [settings]);
  const { draft, setDraft, clear } = useMetreDraft(user?.id);
  const [etape, setEtape] = useState(draft?.etape ?? 0);
  const [criteres, setCriteres] = useState(draft?.criteres ?? { projet: null, appareil: null, combustible: null, zone: null, prise_air: null });
  const [configurationId, setConfigurationId] = useState(draft?.configurationId ?? null);
  const [releve, setReleveState] = useState(draft?.releve ?? null);
  const setReleve = (r) => { setReleveState(r); setDraft({ etape, criteres, configurationId, releve: r }); };

  const { data: configurations = [], isLoading: loadingConfs } = useFumConfigurations(orgId);
  const { data: bundle, isLoading: loadingBundle } = useFumBundle(orgId, configurationId);
  const { data: supplier } = useFumSupplier(orgId);
  const gammes = useMemo(() => [...new Set((bundle?.mapping || []).map((m) => m.gamme_tarif))], [bundle]);
  const { data: articles = [], isLoading: loadingArticles } = useFumArticles(orgId, supplier?.id, gammes, releve?.diametre);

  const allerAuReleve = () => {
    if (!bundle?.gabarit) { toast.error('Cette configuration n\'a pas encore de gabarit de métré'); return; }
    if (!releve) setReleve(releveInitial(bundle.gabarit, reglages));
    setEtape(1); setDraft({ etape: 1, criteres, configurationId, releve: releve || releveInitial(bundle.gabarit, reglages) });
  };
  const valider = () => {
    const resultat = calculerMetre({ ...bundle, articles, reglages, releve });
    if (resultat.alertes.some((a) => a.niveau === 'warn' && a.code !== 'article_manquant')) {
      if (!window.confirm('Des contrôles sont en alerte (zone, dévoiement, buse…). Injecter quand même les lignes dans le devis ?')) return;
    }
    onValidate({
      lignesDevis: versLignesDevis(resultat.lignes, supplier?.id, supplier?.name),
      metre: { configurationId, gabaritCode: bundle.gabarit.code, diametre: releve.diametre, finition: releve.finition, releve, resultat, engineVersion: resultat.engine_version, leadId },
    });
    clear();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-secondary-100 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-secondary-200">
        <div><p className="text-xs uppercase tracking-wide text-secondary-500">Métré assisté · fumisterie</p><h2 className="text-lg font-semibold text-secondary-900">{etape === 0 ? 'Qualifier le projet' : bundle?.configuration?.titre}</h2></div>
        <button type="button" onClick={() => { if (window.confirm('Quitter le métré ? La saisie en cours reste en brouillon.')) onClose(); }} className="p-2 rounded hover:bg-secondary-100" aria-label="Fermer"><X className="w-5 h-5" /></button>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        {etape === 0 && (loadingConfs ? <Loader2 className="w-6 h-6 animate-spin text-secondary-500" /> : <QualificationStep configurations={configurations} criteres={criteres} setCriteres={setCriteres} selectedId={configurationId} onSelect={setConfigurationId} />)}
        {etape === 1 && bundle && (loadingArticles && articles.length === 0 ? <Loader2 className="w-6 h-6 animate-spin text-secondary-500" /> : <ReleveStep bundle={bundle} articles={articles} reglages={reglages} releve={releve} setReleve={setReleve} />)}
      </main>
      <footer className="flex items-center justify-between px-4 py-3 bg-white border-t border-secondary-200">
        <button type="button" onClick={() => (etape === 0 ? onClose() : setEtape(0))} className="btn-secondary"><ArrowLeft className="w-4 h-4 mr-1" />{etape === 0 ? 'Annuler' : 'Qualification'}</button>
        {etape === 0
          ? <button type="button" disabled={!configurationId || loadingBundle} onClick={allerAuReleve} className="btn-primary">Relevé <ArrowRight className="w-4 h-4 ml-1" /></button>
          : <button type="button" onClick={valider} className="btn-primary"><Check className="w-4 h-4 mr-1" /> Injecter dans le devis</button>}
      </footer>
    </div>
  );
}
```

- [ ] **Step 7 : Brancher dans `DevisStepLines`**

`SectionBlock` : nouvelle prop `onMetre` ; détecter `const isFumisterie = /fumisterie/i.test(section.designation);` et, dans la barre d'actions, avant le bouton « + », rendre si `isFumisterie && onMetre` :
```jsx
<button type="button" onClick={() => onMetre(sectionIndex)} className="flex items-center gap-1 px-2 h-6 text-xs font-medium text-secondary-800 bg-primary-100 hover:bg-primary-200 rounded-full border border-primary-300" title="Métré assisté sur coupe cotée"><Ruler className="w-3.5 h-3.5" /> Métré assisté</button>
```
(`Ruler` depuis lucide). `DevisStepLines` : props `({ orgId, lines, setLines, globalDiscountPercent, leadId, onMetreValidated })`, état `const [metreForSection, setMetreForSection] = useState(null);`, handler qui insère `lignesDevis` après le dernier enfant de la section (même boucle que `handlePickerAddLines`) puis `onMetreValidated?.(metre)` et ferme ; rendu `{metreForSection != null && <MetreFumisterie orgId={orgId} leadId={leadId} onClose={() => setMetreForSection(null)} onValidate={...} />}`. Passer `onMetre={setMetreForSection}` à chaque `SectionBlock`.

- [ ] **Step 8 : Brancher dans `CreateDevisModal`**

État `const [metre, setMetre] = useState(null);` ; `useFumMetreMutations(orgId)` → `saveMetre` ; `<DevisStepLines … leadId={lead?.id} onMetreValidated={setMetre} />` ; dans `handleCreate`, après `createQuote` :
```js
if (metre) {
  try { await saveMetre({ ...metre, quoteId: created.id, createdBy: user?.id }); }
  catch (err) { logger.error('[CreateDevisModal] saveMetre', err); toast.warning('Devis créé, mais le relevé de métré n\'a pas pu être enregistré'); }
}
```
(le devis est créé quoi qu'il arrive ; l'échec du métré est signalé, pas avalé). Si `!lead?.client_id`, afficher en étape 1 un bandeau « Ce lead n'a pas de client lié : l'envoi Pennylane exigera un client » (pas bloquant).

- [ ] **Step 9 : Vérifier** `npm run lint:errors` puis `npx vite build`. Parcours manuel (Eric) : fiche lead → Nouveau devis → famille « Poêle à Bois » → section FUMISTERIE → Métré assisté → CFG-24 → relevé (valeurs de la maquette) → 14 lignes, total achat 1 480,90 € → Injecter → Récapitulatif → Créer → `select count(*) from majordhome.fum_metres` = 1 et `quote_lines` = 14 + autres.
- [ ] **Step 10 : Commit** `git add src/apps/artisan/components/devis && git commit -m "feat(fumisterie): écran de métré assisté (qualification, relevé sur coupe cotée, injection dans le devis)"`

---

### Task 12 : Marge fournitures dans le récapitulatif

**Files:**
- Modify: `src/apps/artisan/components/devis/DevisStepSummary.jsx:15-33`

- [ ] **Step 1 : Calcul et affichage** — après `DevisTvaSummary` :
```jsx
{(() => {
  const produits = lines.filter((l) => l.line_type !== 'section_title' && l.purchase_price_ht != null && l.purchase_price_ht !== '');
  if (!produits.length) return null;
  const vente = produits.reduce((s, l) => s + (parseFloat(l.unit_price_ht) || 0) * (parseFloat(l.quantity) || 0), 0);
  const achat = produits.reduce((s, l) => s + (parseFloat(l.purchase_price_ht) || 0) * (parseFloat(l.quantity) || 0), 0);
  const marge = vente - achat; const taux = vente > 0 ? (marge / vente) * 100 : 0;
  return (
    <div className="rounded-lg border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm flex items-center justify-between">
      <span className="text-secondary-600">Marge sur fournitures ({produits.length} ligne{produits.length > 1 ? 's' : ''} avec prix d'achat)</span>
      <span className="font-semibold text-secondary-900">{formatEuro(marge)} HT · {taux.toFixed(0)} %</span>
    </div>
  );
})()}
```
(importer `formatEuro` depuis `@/lib/utils`). La remise globale n'est pas déduite ici : elle s'applique au total, la marge affichée est la marge brute sur fournitures avant remise — le libellé le dit.
- [ ] **Step 2 :** lint + commit `git commit -am "feat(devis): marge brute sur fournitures dans le récapitulatif"`

---

### Task 13 : Envoi du devis dans Pennylane et rattachement au lead

**Files:**
- Modify: `src/shared/services/devis.service.js` (nouvelle méthode `markPushedToPennylane`), `src/shared/hooks/useDevis.js:133-215` (mutation `pushToPennylane`), `src/apps/artisan/components/devis/DevisModal.jsx:24-60,373-386`

**Interfaces:**
- `devisService.markPushedToPennylane(quoteId, { pennylaneQuoteId, pennylaneNumber })` → passe `status='envoye'`, `sent_at=now()`, `pennylane_quote_id`, `pennylane_synced_at`.
- `useDevisMutations(leadId).pushToPennylane({ quote, lines, client })` → `{ pennylane_id, pennylane_number, url, attached }`.

- [ ] **Step 1 : Service**

```js
  /** Après un push Pennylane réussi : le devis MDH est « envoyé » et porte l'id PL. */
  async markPushedToPennylane(quoteId, { pennylaneQuoteId, pennylaneNumber }) {
    try {
      if (!quoteId || !pennylaneQuoteId) throw new Error('[devisService] quoteId et pennylaneQuoteId requis');
      const { data, error } = await supabase.from('majordhome_quotes_write')
        .update({ status: 'envoye', sent_at: new Date().toISOString(), pennylane_quote_id: String(pennylaneQuoteId), pennylane_synced_at: new Date().toISOString(),
          subject: undefined })
        .eq('id', quoteId).select().single();
      if (error) throw error;
      return { data: { ...data, pennylane_number: pennylaneNumber }, error: null };
    } catch (error) {
      console.error('[devisService] markPushedToPennylane:', error);
      return { data: null, error };
    }
  },
```
(retirer `subject: undefined` — c'est un rappel de ne PAS toucher aux autres colonnes ; l'objet `update` ne contient que les 4 champs).

- [ ] **Step 2 : Mutation**

```js
  // Envoyer dans Pennylane (push + rattachement au lead → carte pipeline « Devis envoyé »)
  const pushMutation = useMutation({
    mutationFn: async ({ quote, lines, client }) => {
      if (!client) throw new Error('Le devis doit être lié à un client pour partir dans Pennylane');
      const pushed = await pennylaneService.pushQuote(quote, lines, client, orgId); // throw natif (fetch)
      let attached = 0;
      if (quote.lead_id) {
        const res = await pennylaneService.attachQuotesAndSendLead(orgId, quote.lead_id, [{
          quote_pl_id: pushed.pennylane_id, amount_ht: Number(quote.total_ht) || null, label: pushed.pennylane_number || quote.quote_number,
          date: new Date().toISOString().slice(0, 10), status: 'draft', pdf_url: pushed.url || null,
        }]);
        attached = res?.attached ?? 0;
      }
      await unwrapResult(devisService.markPushedToPennylane(quote.id, { pennylaneQuoteId: pushed.pennylane_id, pennylaneNumber: pushed.pennylane_number }));
      return { ...pushed, attached };
    },
    onSuccess: (_, { quote }) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(orgId, quote.id) });
      if (quote.lead_id) queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
      invalidateAll();
    },
  });
```
Ajouter `pushToPennylane: pushMutation.mutateAsync, isPushing: pushMutation.isPending` au retour ; importer `pennylaneService` et `kanbanCardKeys` (vérifier le nom exact dans `cacheKeys.js`).

- [ ] **Step 3 : Bouton dans `DevisModal`**

Charger le client : `const { data: client } = useQuery({ queryKey: clientKeys.detail(orgId, quote?.client_id), queryFn: () => unwrapResult(clientsService.getClientById(quote.client_id)), enabled: !!orgId && !!quote?.client_id });` (adapter au hook client existant s'il y en a un, ex. `useClient(quote.client_id)`). `const pennylaneEnabled = usePennylaneEnabled();`. Dans le footer, à côté de « Générer PDF », si `pennylaneEnabled && isBrouillon` :
```jsx
<button onClick={handlePush} disabled={isPushing || !client} className="btn-primary btn-sm" title={!client ? 'Lier un client au lead avant l\'envoi' : 'Créer le devis dans Pennylane et le rattacher au lead'}>
  {isPushing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />} Envoyer dans Pennylane
</button>
```
avec
```js
const handlePush = async () => {
  try {
    const res = await pushToPennylane({ quote, lines, client });
    toast.success(`Devis ${res.pennylane_number || ''} créé dans Pennylane${res.attached ? ' et rattaché au lead' : ''}`);
    onStatusChange?.();
  } catch (err) { logger.error('[DevisModal] push Pennylane', err); toast.error(err.message || 'Envoi Pennylane impossible'); }
};
```
Si `quote.pennylane_quote_id` est déjà posé : afficher un badge « Dans Pennylane · n° {…} » à la place du bouton.

- [ ] **Step 4 : Vérifier `pushQuote` sur un devis réel (Eric, org Mayer)**

Points à contrôler avant de cliquer, dans `pennylane.service.js:343-395` : `UNIT_MAPPING` couvre `pièce`, `forfait`, `ml` ; `TVA_MAPPING` couvre 20 / 10 / 5.5 ; `ledger_account_id` = `line.ledger_account_pl_id` (NULL pour les lignes fumisterie tant que le plan comptable « Devis » n'est pas câblé → Pennylane applique son compte par défaut ; noter la limite dans le toast si besoin). Puis : Envoyer → vérifier dans Pennylane (devis brouillon, sections POÊLE/FUMISTERIE/…, lignes et montants), dans MDH : `select status, pennylane_quote_id from majordhome.quotes where id=…` = `envoye`, `select * from majordhome.lead_pennylane_quotes where pennylane_quote_id=…` (1 ligne), carte du lead en « Devis envoyé ». Toute erreur PL (400/422) remonte par `apiCall` avec le message PL : corriger le payload, pas le contourner.

- [ ] **Step 5 :** lint + commit `git add src/shared/services/devis.service.js src/shared/hooks/useDevis.js src/apps/artisan/components/devis/DevisModal.jsx && git commit -m "feat(devis): envoi dans Pennylane + rattachement au lead depuis la fiche devis"`

---

### Task 14 : Vérification finale, documentation, mémoire

- [ ] **Step 1 :** `npm run audit:quality` (lint errors + tous les tests dont `scripts/fumisterie/*` + dead-code : aucun fichier créé ne doit ressortir « jamais importé ») et `npx vite build` → propres.
- [ ] **Step 2 : Critère de succès de la tranche** — Philippe (ou Eric) fait un devis réel sur tablette : qualification → relevé → 14 lignes → devis complet (appareil + fumisterie + main d'œuvre) → Envoyer dans Pennylane → devis visible dans Pennylane ET sur la carte du lead. Consigner le résultat (et les règles provisoires contestées) dans `docs/devis-fumisterie/HANDOFF_devis_fumisterie.md` § « Retours d'usage ».
- [ ] **Step 3 : Documentation** — proposer à Eric (accord explicite requis) une section « Module Fumisterie (assistant de devis) » dans `CLAUDE.md` (règles qui mordent : moteur pur `src/lib/fumisterie/` + `calculerMetre` point d'entrée unique, résultat figé `fum_metres`, prix vente = public / achat = net, rien d'avalé, `settings.fumisterie` via Settings, import tarif rejouable) et un pointeur dans `docs/devis-fumisterie/`. Mémoire : `project_assistant_devis_fumisterie.md` (état, décisions, tranche suivante = G4 tubage).
- [ ] **Step 4 :** commit final `git commit -am "docs(fumisterie): retours tranche 1 + CLAUDE.md"`.

---

## Self-review (fait à la rédaction)

- **Couverture spec** : §4.2 données → T1/T3/T4 ; §4.3 réglages → T5/T8 ; §4.4 moteur → T5-T7 ; §4.5 écran → T10-T12 ; §4.6 Pennylane → T13 ; §5 garde-fous → `article_manquant` (T7), échec `saveMetre` signalé (T11), `{ error }` lus (T13) ; §6 tests → T2, T5, T6, T7. Hors tranche : §4.7 Hermes, coupe dans le PDF, G3-G6.
- **Cohérence des noms** : `calculerMetre` / `sortieMinimale` / `ENGINE_VERSION` (T7) consommés par T11 ; `buildFumisterieConfig` (T5) par T8/T11 ; `fumisterieKeys` (T9) par `useFumisterie` ; shape de ligne moteur (T7) → `versLignesDevis` (T11) → `createQuote` (existant) ; `regle_quantite` codes identiques dans T1 (COMMENT), T4 (JSON) et T7 (`construireNomenclature`).
- **Points d'incertitude assumés** (à lever à l'exécution, pas à contourner) : orthographe exacte des `gamme_tarif` après parse (T4 step 5 le vérifie en base) ; signature de `withErrorHandling` (T9) ; nom du hook client dans `DevisModal` (T13) ; comportement réel de `pushQuote` jamais exercé en prod (T13 step 4).
