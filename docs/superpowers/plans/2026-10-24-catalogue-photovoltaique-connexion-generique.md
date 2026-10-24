# Catalogue fournisseur tranche 2 — Photovoltaïque, connexion générique, enrichissement, articles communs — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importer tout le catalogue BayWa et Domos sous « Photovoltaïque » (famille de devis multi-catégories), rendre la connexion fournisseur générique par plateforme (URL, type, identifiants, correspondance des catégories, relevé nocturne réglable), aspirer photo / fiche technique / caractéristiques dans la fiche produit, filtrer par marque et gamme, et rapprocher automatiquement les articles communs entre fournisseurs par le modèle fabricant.

**Architecture:** Mêmes briques que la tranche 1 (adaptateurs PURS copiés pour Deno, RPC écrivain unique `supplier_catalog_upsert`, edge `supplier-catalog-sync`, panneau Connexion catalogue), généralisées : adaptateurs et clients nommés par plateforme (`suitecommerce`, `woocommerce`) et paramétrés par la ligne `suppliers` ; champs humains protégés à l'INSERT ; clé `model_key` posée au relevé par un module pur ; table `catalog_matches` alimentée par une RPC de proposition (confirmation automatique sur clé franche, IA en lot pour le reste, file « Tout confirmer » pour les ambigus).

**Tech Stack:** React 18 / React Query v5 / Supabase (PostgreSQL, Vault, pg_cron, edge Deno, Storage) / Claude API (edge `catalog-normalize`) / `node --test`, `deno test`, harnais `scripts/migration-rehearsal`.

**Spec:** `docs/superpowers/specs/2026-10-24-catalogue-photovoltaique-connexion-generique-design.md` (+ tranche 1 : `2026-10-24-module-batterie-catalogue-baywa-design.md`)

## Global Constraints

- Charte multi-tenant CLAUDE.md : `org_id` sur toute mutation ; RPC SECURITY DEFINER ⇒ `REVOKE FROM PUBLIC, anon` (+ `authenticated` si `org_id` dans le payload) ; gardes positives `IF auth.uid() IS NULL THEN RAISE` / `(cond) IS NOT TRUE` ; vues `security_invoker`, colonnes en fin ; `{ error }` lu sur chaque écriture d'edge ; secrets Vault seulement ; cache keys `orgId` en 1ᵉʳ ; `unwrapResult` ; `logger`.
- Modules purs `src/lib/catalogue/*.js` : aucun import React/Supabase/alias, JSDoc sur les exports, copies `_shared/catalogue/` régénérées par `npm run sync:tournee-engine`, listés dans `ALLOW_ORPHAN` (`scripts/audit-dead-code.mjs`).
- Migrations versionnées `supabase/migrations/20261025_N_*.sql`, répétées sur le harnais avec un `assert-*.sql` avant application en prod (`scripts/fumisterie/apply-sql.mjs` + inscription dans `supabase_migrations.schema_migrations`).
- Valeurs figées : catégorie `photovoltaique` libellé « Photovoltaïque » ; famille `{ key: 'photovoltaique', label: 'Photovoltaïque', categories: ['photovoltaique', 'batterie'], sections: ['PANNEAUX', 'ONDULEUR ET MONITORING', 'FIXATION', 'COFFRETS ET CÂBLAGE', 'MAIN D\'ŒUVRE'] }` ; famille Batterie → `categories: ['batterie', 'photovoltaique']` ; `connector ∈ suitecommerce | woocommerce | NULL` ; mapping cible `batterie | photovoltaique | exclure`, précédence `exclure > batterie > photovoltaique`, clé `(sans categorie)` ; `auto_sync` défaut `false` ; champs posés à l'INSERT seulement : `name, selling_price_ht, category, product_kind, brand, gamme` ; `image_url` si NULL ; `model_key` recalculé sauf `model_key_source = 'manuel'` ; confiance IA ≥ 0,9.
- Pas de preview tools : `npx vite build`, `npm run lint:errors`, `node --test`, `deno test` / `deno check`.
- Une seule session écrit dans ce checkout à la fois : commits par pathspec, jamais `git add -A`.

## Review Focus

1. Un article reclassé à la main (Photovoltaïque → Batterie) dans le drawer, puis relevé nocturne : la catégorie manuelle reste (test Task 3 assert : UPDATE category puis ré-import ⇒ inchangée).
2. Changement de la table de correspondance sans cliquer « Appliquer » : rien ne bouge jusqu'au clic ; au clic, seuls les articles de cette catégorie de site changent (test Task 3 assert sur `supplier_catalog_apply_mapping`).
3. Domos (WooCommerce, Cloudflare) avec `auto_sync` coché par erreur : la nuit échoue en `acces_bloque` mais « Relevé du … : 605 articles » reste affiché (test Task 5 : `marquerEchec` n'écrit que `catalog_sync_error`).
4. Deux articles d'un même fournisseur avec la même clé (`LUNA2000-7-E1` en deux versions chez BayWa) face à un seul Domos : pas de confirmation automatique, les deux paires vont dans la file (test Task 4 assert : `statut = 'propose'`).
5. Une famille enregistrée avec l'ancienne forme `categorie: 'poele'` : le picker continue de filtrer sur poêle (test Task 1 `buildDevisConfig` normalise en `categories: ['poele']`).

---

### Task 1 : familles multi-catégories, famille Photovoltaïque, catégorie `photovoltaique`

**Files:**
- Modify: `src/lib/devisConfig.js` (`CATEGORIES_PRODUIT`, `DEFAULT_FAMILLES`, `normaliserFamille`, `buildDevisConfig`, `categoriePourSection` → `categoriesPourSection`, `validerDevisConfig`)
- Modify: `src/shared/services/devis.service.js:55-63` (`productCategoryForSection` → renvoie `string[]`), `src/shared/services/suppliers.service.js` (`PRODUCT_CATEGORIES`, `getSuppliersByCategories(orgId, categories)`, `getDistinctGammes(supplierId, categories)`, `getFilteredProducts(supplierId, { gamme, diametre, categories })` → `.in('category', …)`)
- Modify: `src/apps/artisan/components/devis/DevisProductPicker.jsx` (prop `categories: string[]`), `DevisStepLines.jsx:457` (appelant), `src/apps/artisan/pages/settings/devis/FamillesEditor.jsx` (cases à cocher par catégorie, `CATEGORIE_LABELS` += photovoltaique)
- Create: `supabase/migrations/20261025_1_catalogue_rpc_categories.sql` (surcharges `get_suppliers_by_categories(p_org_id uuid, p_categories text[])`, `get_distinct_gammes(p_supplier_id uuid, p_categories text[])`, même corps que les versions texte avec `LOWER(sp.category) = ANY (…)`, STABLE, `REVOKE FROM PUBLIC, anon`, GRANT authenticated)
- Test: `scripts/devis-config.test.mjs` (étendre)

**Interfaces:**
- Produces: `famille.categories: string[]` (jamais `categorie` en sortie de `buildDevisConfig`) ; `categoriesPourSection(config, sectionName, keyOuLabel) → string[]` (vide = tous) ; RPC `get_suppliers_by_categories`, `get_distinct_gammes(uuid, text[])`.

- [ ] **Step 1 : tests** dans `scripts/devis-config.test.mjs` : `CATEGORIES_PRODUIT` contient `'photovoltaique'` ; famille `photovoltaique` juste après `batterie`, `categories` = `['photovoltaique','batterie']`, sections = les 5 de la spec ; famille `batterie.categories` = `['batterie','photovoltaique']` ; `buildDevisConfig({ devis: { familles: [{ key:'p', label:'P', actif:true, categorie:'poele', sections:['A'] }] } }).familles[0].categories` = `['poele']` (rétro-compat) et la propriété `categorie` absente ; `categoriesPourSection(config, 'PANNEAUX', 'photovoltaique')` = `['photovoltaique','batterie']` ; `categoriesPourSection(config, 'MAIN D\'ŒUVRE', 'autre')` = `[]`.
- [ ] **Step 2 : RED** (`node --test scripts/devis-config.test.mjs`).
- [ ] **Step 3 : implémenter** devisConfig (normalisation `categories = Array.isArray(f.categories) ? f.categories.filter(c ∈ CATEGORIES_PRODUIT) : f.categorie ∈ CATEGORIES_PRODUIT ? [f.categorie] : []`), devis.service, suppliers.service (les trois lectures prennent `categories` ; tableau vide = pas de filtre), picker (`categories` prop ; `getSuppliersByCategories` via la RPC ; gammes via `get_distinct_gammes(uuid, text[])`), FamillesEditor (cases à cocher ; enregistre `categories`), migration.
- [ ] **Step 4 : GREEN**, `npm run lint:errors`, `npx vite build` ; répéter la migration (`run.mjs --migration 20261025_1 --assert assert-baseline.sql`) puis l'appliquer en prod et l'inscrire.
- [ ] **Step 5 : commit** `feat(devis): familles multi-catégories, famille Photovoltaïque, catégorie photovoltaique`.

### Task 2 : adaptateurs par plateforme, périmètre total, mapping, clé modèle, scripts de relevé

**Files:**
- Rename: `src/lib/catalogue/baywa.js` → `suitecommerce.js`, `domos.js` → `woocommerce.js` ; tests `scripts/catalogue/{suitecommerce,woocommerce}.test.mjs` (renommés + étendus)
- Create: `src/lib/catalogue/modelKey.js` + `scripts/catalogue/model-key.test.mjs` ; `src/lib/catalogue/mapping.js` (défauts par plateforme, précédence, `(sans categorie)`) + `scripts/catalogue/mapping.test.mjs`
- Modify: `src/lib/catalogue/releve.js` (`CHAMPS`, `FIELDS_BAYWA` += `custitem_itemwatt`, `itemimages_detail`, `urlcomponent` ; clés `suitecommerce` / `woocommerce`), `scripts/catalogue/releve.test.mjs`, `scripts/sync-tournee-engine.mjs` (`CATALOGUE = ['suitecommerce','woocommerce','modelKey','mapping']`), `scripts/audit-dead-code.mjs` (`ALLOW_ORPHAN`), `package.json` (`audit:quality`)
- Rename/Modify: `scripts/catalogue/dump-baywa.browser.js` → `dump-suitecommerce.browser.js` (en-tête : `SITE`, `SCA_PATH`, `SITE_ID` à éditer ; conserve `itemimages_detail: (it.itemimages_detail && premier url) || null`, `urlcomponent`), `dump-domos.browser.js` → `dump-woocommerce.browser.js` (`SITE` en tête) ; `scripts/catalogue/import-releve.mjs` (`--fournisseur <nom en base>` : lit `connector, site_url, category_mapping` via `pq`-like requête à l'API de management, `--plateforme` en secours pour un fournisseur pas encore créé)

**Interfaces:**
- Produces: `articlesDepuisReleveSuitecommerce(releve, { version, mapping }) / articlesDepuisReleveWoocommerce(…)` → `{ lignes, retenus, exclus, releve_at, categories_vues: [{ cle, libelle, parent, nombre }] }` ; `LigneCatalogue` += `image_url, image_source_url, model_key` ; `calculerModelKey(brand, textes: string[]) → string|null` ; `categorieMajordhome(cles: string[], mapping, defauts) → 'batterie'|'photovoltaique'|null(exclu)` ; `DEFAUTS_MAPPING = { suitecommerce: {...}, woocommerce: {...} }`.

- [ ] **Step 1 : tests** — `model-key.test.mjs` : `calculerModelKey('HUAWEI', ['HUAWEI – Batterie LUNA2000-7-E1 – Module de batterie 6.9 kWh'])` = `'LUNA20007E1'` ; `('Huawei', ['LUNA2000-7-E1 Battery Module (S1)', '01076608'])` = `'LUNA20007E1'` ; `('HUAWEI', ['HUAWEI – Optimiseurs des 600W-P – SUN2000'])` = `null` (famille seule) ; `('ENPHASE', ['ENPHASE – IQController SC100G-M230ROW'])` = `'SC100GM230ROW'` ; unités ignorées (`'13,5KWH'`, `'400WC'`, `'48V'`), EAN 13 chiffres ignoré ; `mapping.test.mjs` : précédence (`['batteries-dc','destockage']` avec `destockage → exclure` ⇒ `null`), `(sans categorie)` ⇒ `photovoltaique` par défaut, surcharge `{ 'E-Mobility': 'exclure' }` ; `suitecommerce.test.mjs` : `retenus` = nombre mesuré (≈ 921 = 995 − 61 kits hors périmètre − 13 kits), 0 Kit, Powerwall toujours `batterie` 5 500, `35-013439` (BYD) `batterie`, un module PV (`cseg PV`) `photovoltaique` gamme `'Modules PV'` `product_kind 'main'` `specs.canonical.puissance_wc` renseigné, une borne E-Mobility gamme `'Bornes de recharge'` ; `mapping: { 'E-Mobility': 'exclure' }` ⇒ 0 borne et `exclus.par_mapping` = 82 ; `categories_vues` contient `{ cle:'PV', nombre:60 }` ; `image_url` null sur le relevé actuel (champ absent) mais rempli sur un item de test avec `itemimages_detail` ; `woocommerce.test.mjs` : `retenus` ≈ 605, `323052` `batterie`, un onduleur SUN2000 `photovoltaique` gamme `'Onduleur central'`, un article sans catégorie (`sku` à mesurer) `photovoltaique` et `categories_vues` contient `{ cle:'(sans categorie)', nombre:23 }`, `image_url` = `item.image`, `model_key` de `482057` = `'LUNA20007E1'`.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter** (renommages par `git mv`, mapping, model key, gammes FR de la spec § 4, nature `main` pour PV / onduleur / batterie / borne, specs PV), scripts de relevé, import, sync Deno, orphelins, `audit:quality`.
- [ ] **Step 4 : GREEN** + `npm run sync:tournee-engine` + `node --test scripts/tournee/sync-engine.test.mjs`.
- [ ] **Step 5 : commit** `feat(catalogue): adaptateurs par plateforme (suitecommerce, woocommerce), périmètre complet, correspondance des catégories, clé modèle`.

### Task 3 : migration fournisseurs + RPC upsert v3 + apply_mapping + brands ; ré-import complet

**Files:**
- Create: `supabase/migrations/20261025_2_catalogue_connexion_generique.sql` ; `scripts/migration-rehearsal/assert-catalogue-generique.sql` ; Modify: `snapshot.mjs` (TABLES += `majordhome.product_documents` data:false ; VIEWS += `public.majordhome_product_documents`, `_write`)

**Interfaces:**
- Produces: `suppliers.connector CHECK IN ('suitecommerce','woocommerce')` (backfill `baywa→suitecommerce`, `domos→woocommerce`), `site_url text`, `connector_config jsonb NOT NULL DEFAULT '{}'`, `category_mapping jsonb NOT NULL DEFAULT '{}'`, `auto_sync boolean NOT NULL DEFAULT false`, `catalog_sync_error jsonb` (vues en fin) ; backfill `site_url` BayWa `https://solarshop.baywa-re.fr` + `connector_config {"sca_path":"/sca-lux-2019-2","site_id":"6376560"}`, Domos `https://webshop.domosindustries.com`, `auto_sync = true` pour BayWa (sync réel réussi le 24/10) ; `supplier_products.model_key text`, `model_key_source text CHECK IN ('cle','ia','manuel')` ; `supplier_catalog_upsert` v3 : INSERT-only `name, selling_price_ht, category, product_kind, brand, gamme` ; `image_url/image_source_url` si NULL ; `model_key` posé sauf `model_key_source='manuel'` (source `cle` si fourni par la ligne) ; retour += `categories_vues` recopié depuis `p_meta jsonb` (5ᵉ paramètre, défaut `'{}'`) ; `public.supplier_catalog_apply_mapping(p_supplier_id uuid) RETURNS jsonb` (org_admin par `auth.uid()`, lit `category_mapping` et `specs.canonical.categories_site` de chaque article, réécrit `category` ; `exclure` ⇒ `is_active=false` + marque `desactive_par_mapping`) ; `public.get_distinct_brands(p_supplier_id uuid) RETURNS TABLE(brand text)` ; index unique `(supplier_id, reference) WHERE reference IS NOT NULL` après `DELETE` des doublons éventuels (vérifier 0 en prod).

- [ ] **Step 1 : assert** : (a) backfill connecteurs / URLs ; (b) upsert v3 : INSERT puis ré-import avec `category`, `brand`, `gamme`, `product_kind` différents ⇒ inchangés, `purchase_price_ht` et `model_key` suivis ; (c) `image_url` NULL ⇒ posé, puis manuel ⇒ gardé ; (d) `model_key_source='manuel'` ⇒ non recalculé ; (e) `apply_mapping` sous org_admin : un article `specs.canonical.categories_site = ['E-Mobility']` et mapping `{'E-Mobility':'exclure'}` ⇒ `is_active=false` ; sous membre ⇒ 42501 ; (f) privilèges (`get_distinct_brands` authenticated ; `apply_mapping` REVOKE anon) ; (g) index unique présent.
- [ ] **Step 2 : RED** (sans migration) ; **Step 3 : migration** ; **Step 4 : GREEN** (+ baseline) ; appliquer en prod, inscrire, auditer `has_function_privilege`.
- [ ] **Step 5 : ré-import complet** des deux relevés (`import-releve.mjs --fournisseur "BAYWA R.E."`, `"DOMOS INDUSTRIES"`) ; vérifier en prod : `category='photovoltaique'` ≈ 834 BayWa + ≈ 553 Domos actifs, `batterie` inchangé (87 / 52), Powerwall 5 500 conservé, `model_key` posé sur `35-117819` et `482057` = `LUNA20007E1`.
- [ ] **Step 6 : commit** `feat(catalogue): connexion générique (plateforme, URL, mapping, auto_sync), upsert v3 (champs humains protégés, photo, clé modèle), catalogue complet importé`.

### Task 4 : articles communs — `catalog_matches` et RPC de proposition / décision

**Files:**
- Create: `supabase/migrations/20261025_3_catalog_matches.sql` ; `scripts/migration-rehearsal/assert-catalog-matches.sql` ; `snapshot.mjs` (VIEWS += `public.majordhome_catalog_matches`)

**Interfaces:**
- Produces: `majordhome.catalog_matches(id, org_id, product_a_id, product_b_id, source IN ('cle','ia','manuel'), statut IN ('propose','confirme','refuse'), motif text, confirmed_by, confirmed_at, created_at)` UNIQUE `(product_a_id, product_b_id)` avec `product_a_id < product_b_id` (CHECK), RLS SELECT membre / écriture via RPC ; vue `majordhome_catalog_matches` (JOIN noms, références, prix d'achat, fournisseurs des deux produits, `ecart_pct`) ; `public.catalog_matches_propose(p_org_id uuid) RETURNS jsonb` (service_role seul : parcourt les paires de même org, fournisseurs différents, `brand` égal (insensible à la casse) et `model_key` égal non NULL, ou `code_ean` égal ; **confirme** si un seul candidat de chaque côté, sinon `propose` ; ne touche jamais une paire `refuse` ni `confirme` ; retour `{ confirmes, proposes }`) ; `public.catalog_match_set_status(p_match_ids uuid[], p_statut text) RETURNS int` (org_admin de l'org des paires, `confirme | refuse`) ; `public.catalog_match_create(p_product_a uuid, p_product_b uuid) RETURNS uuid` (org_admin, source `manuel`, statut `confirme`).

- [ ] **Step 1 : assert** : fixture 2 fournisseurs × produits (`HUAWEI`/`LUNA20007E1` ×1 chaque côté ⇒ confirme ; `HUAWEI`/`SUN2000` ×2 chez A ×1 chez B ⇒ 2 lignes `propose` ; EAN égal ⇒ confirme) ; relance ⇒ idempotent (0 nouveau) ; `set_status(refuse)` puis relance ⇒ toujours `refuse` ; membre non admin ⇒ 42501 ; privilèges ; `product_a_id < product_b_id` imposé.
- [ ] **Step 2 : RED ; Step 3 : migration ; Step 4 : GREEN + baseline ; prod + inscription + audit.**
- [ ] **Step 5 : commit** `feat(catalogue): rapprochement des articles communs (catalog_matches, proposition automatique, décisions)`.

### Task 5 : edge `supplier-catalog-sync` générique (clients par plateforme, auto_sync, erreur séparée, document, matches)

**Files:**
- Rename: `baywaClient.ts` → `suitecommerceClient.ts` (+ test) ; Create: `woocommerceClient.ts` + `woocommerceClient.test.ts` ; Modify: `index.ts`, `supabase/config.toml` (commentaire)

**Interfaces:**
- Consumes: `_shared/catalogue/{suitecommerce,woocommerce,mapping,modelKey}.js`, RPC Task 3/4.
- Produces: `connecterSuitecommerce({ siteUrl, scaPath, siteId }, creds)`, `releverCatalogueSuitecommerce(cfg, jar)` ; `connecterWoocommerce({ siteUrl }, creds)` (`GET /mon-compte/` pour les cookies, `POST /wp-login.php` form-urlencoded `log/pwd/rememberme/wp-submit`, `redirect: manual`, succès = cookie `wordpress_logged_in_*` ; HTML Cloudflare / `cf-turnstile` ⇒ `acces_bloque`), `releverCatalogueWoocommerce(cfg, jar)` (Store API paginée + categories) ; `parseWpLoginResponse(status, setCookies: string[], body)` pure testée ; actions : `sync` / `import` (comme avant, mapping du fournisseur passé à l'adaptateur, `p_meta.categories_vues`), `document` `{ product_id }` (télécharge `specs.canonical.fiche_technique_fr`, vérifie `%PDF`, upload `product-documents` `${org}/${product}/${uuid}.pdf`, INSERT `majordhome_product_documents_write` `document_type='Fiche technique'` si aucune `Fiche technique` existante ; codes `document_absent | document_illisible | document_existant`), `matches` (appelle `catalog_matches_propose(org)` — aussi exécuté automatiquement après chaque relevé réussi) ; cron : `auto_sync = true` seulement ; `marquerEchec` écrit **`catalog_sync_error`** (jamais `catalog_sync_result`).

- [ ] **Step 1 : tests Deno** : `parseWpLoginResponse(302, ['wordpress_logged_in_abc=x; Path=/'], '')` = null ; `(200, [], '<form id="loginform"…')` = `connexion_refusee` ; `(403, [], '<html>…cf-turnstile…')` = `acces_bloque` ; `buildWooProductsUrl('https://x.fr', 3)` contient `/wp-json/wc/store/v1/products?per_page=100&page=3` ; suitecommerce : `buildItemsUrl({ siteUrl, scaPath, siteId }, 100)` contient `siteUrl`, `c=6376560`, `sitepath=/sca-lux-2019-2/searchApi.ssp`.
- [ ] **Step 2 : RED ; Step 3 : implémenter ; Step 4 : `deno test` + `deno check` ; déployer (`npx supabase functions deploy supplier-catalog-sync --project-ref ejqqqwudmizqisdkxohw --no-verify-jwt`).**
- [ ] **Step 5 : smoke prod** en mode cron (net.http_post comme en tranche 1) : BayWa traité (auto_sync), Domos ignoré ; `catalog_sync_result` BayWa mis à jour avec `categories_vues`, photos (`image_url`) posées sur les nouveaux relevés.
- [ ] **Step 6 : commit** `feat(catalogue): edge générique par plateforme, relevé nocturne réglable, erreur séparée, fiche technique à la demande, rapprochements après relevé`.

### Task 6 : edge `catalog-normalize` (IA en lot)

**Files:**
- Create: `supabase/functions/catalog-normalize/index.ts`, `normalize.ts` (prompt + parse purs) + `normalize.test.ts` ; `supabase/config.toml` (`verify_jwt = true`)

**Interfaces:**
- Produces: body `{ org_id, supplier_id, limit? }` sous JWT org_admin : sélectionne jusqu'à 50 articles actifs `model_key IS NULL AND model_key_source IS DISTINCT FROM 'manuel'`, prompt Claude (`ANTHROPIC_MODEL`, pattern `company-document-extract` SDK) avec `name, brand, gamme, specs.canonical` (sans description longue), réponse JSON `[{ reference, brand, model, confiance }]` ; `parseNormalizeResponse(text) → Array<{reference, brand, model, confiance}>` (tolère le texte autour du JSON, rejette confiance hors [0,1]) ; `confiance ≥ 0.9` ⇒ `model_key = normaliser(model)`, `model_key_source = 'ia'`, `specs.canonical.modele_ia / modele_ia_confiance` (écriture via `majordhome_supplier_products_write` service_role, `.eq('org_id')`) ; puis `catalog_matches_propose(org)` ; réponse `{ traites, poses, restants }`.

- [ ] **Step 1 : tests Deno** sur `parseNormalizeResponse` (JSON propre, JSON entouré de texte, confiance invalide ignorée) et `normaliser('LUNA2000-7-E1')` = `'LUNA20007E1'` (même règle que `modelKey.js` — importer la copie `_shared/catalogue/modelKey.js`).
- [ ] **Step 2 : RED ; Step 3 : implémenter ; Step 4 : tests + check ; déployer.**
- [ ] **Step 5 : test réel** sur 50 articles BayWa : lire le retour, vérifier 3 `model_key` posées à la main en base ; noter le coût (tokens) dans le message de fin.
- [ ] **Step 6 : commit** `feat(catalogue): normalisation des modèles par IA en lot (catalog-normalize)`.

### Task 7 : application — fiche fournisseur, panneau, liste, drawer, rapprochements, picker

**Files:**
- Modify: `src/shared/services/suppliers.service.js` (`createSupplier/updateSupplier` += `siteUrl, connectorConfig, categoryMapping, autoSync` ; `getProducts(supplierId, { search, kind, brand, gamme, limit, offset })` tri `brand, name` ; `getDistinctBrands` ; `applyCategoryMapping(supplierId)` ; `fetchProductDocument(orgId, supplierId, productId)` ; `proposeMatches(orgId, supplierId)` ; `normalizeCatalog(orgId, supplierId)` ; `getMatches(orgId, { statut })`, `setMatchStatus(ids, statut)`, `createMatch(a, b)`), `src/shared/hooks/useSuppliers.js` (`useSupplierConnector` += `applyMapping, fetchDocument, normalize, proposeMatches` ; `useCatalogMatches(orgId, statut)` ; `useSupplierProducts` += `brand, gamme`), `cacheKeys.js` (`supplierKeys.matches(orgId, statut)`, `brands(orgId, supplierId)`)
- Modify: `SupplierManagement.jsx` (`SupplierFormModal` : URL, type `CONNECTOR_OPTIONS = [{ suitecommerce: 'NetSuite SuiteCommerce (compatible BayWa)' }, { woocommerce: 'WooCommerce' }]`, `sca_path` / `site_id` si SuiteCommerce ; `ProductCatalog` : sélecteurs Marque / Gamme, pastille « ×2 » si rapproché), `suppliers/CatalogConnectorPanel.jsx` (identifiants si type connu, case `auto_sync`, tableau de correspondance + « Appliquer la correspondance », deux lignes d'état, « Supprimer les identifiants », « Normaliser les modèles (IA) », « Rapprocher »)
- Create: `src/shared/specs/batterie.schema.js`, `photovoltaique.schema.js` (registre `CATEGORY_SCHEMAS`), `src/apps/artisan/pages/settings/product-detail/ProductReleveBlock.jsx` (bloc lecture seule « Relevé fournisseur » : clés `canonical` hors schéma + « Ranger la fiche technique dans Documents »), `product-detail/ProductMatchesBlock.jsx` (« Aussi chez »), `src/apps/artisan/pages/settings/suppliers/CatalogMatchesPage.jsx` (route `/settings/suppliers/rapprochements`, cases + « Tout confirmer » / « Refuser »), `src/lib/catalogue/matchesModel.js` (PUR : `ecartPct`, tri, libellés) + `scripts/catalogue/matches-model.test.mjs`
- Modify: `ProductDetailDrawer.jsx` (monte les deux blocs), `DevisProductPicker.jsx` (badge « moins cher chez X : … » depuis les matches confirmés du produit), `src/apps/artisan/routes.jsx` (route rapprochements), `src/lib/modules.js` si une tuile est ajoutée (sinon lien depuis la page Fournisseurs)

- [ ] **Step 1 : test** `matches-model.test.mjs` : `ecartPct(2001.9, 2119.94)` ≈ `5.9` ; `libelleAussiChez({ supplier_b_name:'DOMOS INDUSTRIES', purchase_b: 2119.94, ecart_pct: 5.9 })` = « DOMOS INDUSTRIES : 2 119,94 € HT (+5,9 %) » ; tri des matches par écart décroissant.
- [ ] **Step 2 : RED ; Step 3 : implémenter** service / hooks / écrans ; schémas : batterie (`mpn`, `energie_utile_kwh`, `type_batterie`, `technologie_cellules`, `garantie_produit_ans`, `garantie_perf_ans`, `dimensions_cm`, `poids_kg`, `fiche_technique_fr` ; groupes Identité / Performance / Garanties / Dimensions / Documents), photovoltaïque (`mpn`, `puissance_wc`, `garantie_produit_ans`, `garantie_perf_ans`, `dimensions_cm`, `poids_kg`, `fiche_technique_fr`) ; `supportsEnrichment` reste faux pour ces catégories (pas de variantes).
- [ ] **Step 4 : `npm run lint:errors`, `npx vite build`, `node --test` des tests catalogue ; vérification en prod à la main par Eric** : fiche BAYWA R.E. → type SuiteCommerce + URL pré-remplis ; filtres Marque/Gamme ; drawer Powerwall → bloc Relevé + « Ranger la fiche technique » → Documents ; page Rapprochements → paires LUNA2000-7-E1 confirmées automatiquement, « Tout confirmer » sur la file.
- [ ] **Step 5 : commit** `feat(settings): fiche fournisseur générique, correspondance des catégories, filtres marque/gamme, relevé dans le drawer, rapprochements`.

### Task 8 : livraison

- [ ] `npm run audit:quality` PASS ; push `main` ; Vercel READY (MCP).
- [ ] Demander à Eric : « Actualiser le catalogue » BayWa (photos + catégories vues), import Domos du relevé complet depuis l'app, « Normaliser les modèles » sur BayWa puis Domos, puis la page Rapprochements.
- [ ] Mettre à jour la proposition CLAUDE.md PENDING (plateformes, mapping, champs INSERT-only, clé modèle, matches) et la mémoire `project_catalogue_fournisseur_baywa_domos.md`.
- [ ] Message de fin : fait / décisions / reliquats (adaptateur pour un 3ᵉ fournisseur, fiche technique Domos par page produit, `catalog_sync_error` lisible par tout membre).
