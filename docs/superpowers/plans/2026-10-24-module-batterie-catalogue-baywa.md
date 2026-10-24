# Module Batterie + connexion fournisseur BayWa — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une famille de devis « Batterie » adossée à un catalogue BayWa r.e. relevé automatiquement (ou importé d'un fichier), avec les prix publics Tesla comme prix de vente par défaut.

**Architecture:** Un module PUR par fournisseur transforme son relevé brut en lignes de catalogue ; une RPC `service_role` est l'unique écrivain de `supplier_products` ; elle est appelée par un script Node (relevé fichier) et par l'edge `supplier-catalog-sync` (bouton, import de fichier, cron). Les identifiants fournisseur vivent dans le Vault derrière des RPC `org_secret_*`. Côté app : une catégorie `batterie`, une famille par défaut, la ligne libre ouverte sur MATÉRIEL, et un panneau « Connexion catalogue » dans la fiche fournisseur.

**Tech Stack:** React 18 / React Query v5 / Supabase (PostgreSQL, Vault, pg_cron, edge functions Deno) / `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-module-batterie-catalogue-baywa-design.md`

## Global Constraints

- Toute mutation filtre `org_id` ; toute RPC SECURITY DEFINER : `REVOKE EXECUTE FROM PUBLIC, anon` (+ `authenticated` si `org_id` est dans le payload) ; garde positive (`IF auth.uid() IS NULL THEN RAISE` en tête). Auditer via `has_function_privilege`.
- Vues `public.majordhome_*` : `security_invoker=true` ; colonnes ajoutées **en fin** de liste (`CREATE OR REPLACE VIEW`).
- Services : `{ data, error }` ; hooks : `unwrapResult`, cache keys de `cacheKeys.js` avec `orgId` en 1ᵉʳ ; `logger` au lieu de `console`.
- Modules purs `src/lib/catalogue/*.js` : aucun import React/Supabase/alias, JSDoc sur chaque export (Deno type-check), copies `_shared/` régénérées par `npm run sync:tournee-engine`, jamais éditées.
- Edge : helper `_shared/auth.ts` (`requireOrgMembership` pour l'utilisateur, `requireSharedSecret(req, MDH_CRON_SECRET)` pour le cron) ; lire `{ error }` de chaque écriture ; `sanitizeError`.
- Migration versionnée `supabase/migrations/20261024_2_*.sql`, répétée sur `scripts/migration-rehearsal/` avec un `assert-*.sql` avant application en prod.
- Valeurs figées : prix publics Tesla **HT** Powerwall 3 `5500`, Backup Gateway 2 `1150`, extension DC `4780` ; catégorie `batterie` ; famille `{ key: 'batterie', label: 'Batterie', sections: ['ÉQUIPEMENT', 'MATÉRIEL', 'MAIN D\'ŒUVRE'] }` ; fournisseur « BAYWA R.E. » ; clé Vault `org:<org_id>:supplier:<supplier_id>:credentials`.
- Pas de preview tools (Eric a son serveur) : vérifier par `npx vite build`, `npm run lint:errors`, `node --test`.

## Review Focus

1. Relevé BayWa où un article change de libellé ou de prix BayWa : le libellé corrigé dans le drawer et le prix de vente saisi à la main doivent survivre (test Task 3 : second appel de la RPC avec `name` et prix modifiés ⇒ `name` et `selling_price_ht` inchangés, `purchase_price_ht` mis à jour).
2. Article Tesla déjà en base à `selling_price_ht = 0` : le ré-import doit le mettre au prix public (test Task 3).
3. Connexion BayWa refusée (403 Akamai, identifiants faux, HTML au lieu de JSON) : l'edge répond un code d'erreur lisible, rien n'est écrit, `catalog_sync_result` porte l'erreur (test Task 5 sur réponse simulée).
4. Relevé tronqué (page vide avant `total`) : refus d'écrire, sinon tous les articles manquants seraient désactivés (test Task 2 : `articlesDepuisReleveBaywa` lève si `items.length < total`).
5. Un non-admin qui appelle `org_secret_set`, ou `service_role` absent sur `org_secret_read` : refus (assert Task 3 par impersonation).

---

### Task 1 : catégorie `batterie`, famille « Batterie », ligne libre MATÉRIEL

**Files:**
- Modify: `src/shared/services/suppliers.service.js:19-24` (`PRODUCT_CATEGORIES`)
- Modify: `src/lib/devisConfig.js:13` (`CATEGORIES_PRODUIT`), `:16-24` (`DEFAULT_FAMILLES`)
- Modify: `src/apps/artisan/pages/settings/devis/FamillesEditor.jsx:9` (`CATEGORIE_LABELS`)
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx:120` (regex `isFreeformSection`)
- Create: `scripts/devis-config.test.mjs` ; Modify: `package.json` (`audit:quality` : ajouter le test)

**Interfaces:**
- Produces: valeur de catégorie `'batterie'` (texte libre en base, aucune contrainte) ; famille par défaut `batterie`.

- [ ] **Step 1 : test** `scripts/devis-config.test.mjs` (`node --test`), imports `CATEGORIES_PRODUIT`, `DEFAULT_FAMILLES`, `buildDevisConfig` :
  - `CATEGORIES_PRODUIT` contient `'batterie'` ;
  - `DEFAULT_FAMILLES.find(f => f.key === 'batterie')` a `categorie: 'batterie'`, `actif: true`, `sections` égal à `['ÉQUIPEMENT', 'MATÉRIEL', 'MAIN D\'ŒUVRE']`, et se trouve juste après `chauffage_pac` ;
  - `buildDevisConfig({})` renvoie la famille `batterie` ; `buildDevisConfig({ devis: { familles: [{ key: 'x', label: 'X', actif: true, categorie: null, sections: ['A'] }] } })` ne la renvoie **pas** (une liste enregistrée prime, gotcha de la spec § 6).
- [ ] **Step 2 : lancer, vérifier l'échec** (`'batterie'` absent).
- [ ] **Step 3 : implémenter** les trois listes (libellé « Batterie ») et la famille ; dans `DevisStepLines.jsx` remplacer la regex par `/^(autre|prestations?|mat[ée]riel)$/i` et conserver, pour cette section, le bouton catalogue **en plus** du bouton ligne libre (aujourd'hui le `? :` est exclusif : rendre les deux boutons quand `isFreeformSection && /mat[ée]riel/i`).
- [ ] **Step 4 : lancer le test (PASS), `npm run lint:errors`, `npx vite build`.**
- [ ] **Step 5 : vérifier Mayer** : `settings.devis.familles` est NULL en prod (lu le 2026-10-24) ⇒ les défauts s'appliquent, rien à faire. Le noter dans le message de commit.
- [ ] **Step 6 : commit** `feat(devis): famille Batterie, catégorie catalogue batterie, ligne libre sur MATÉRIEL`.

### Task 2 : module PUR `src/lib/catalogue/baywa.js` + test sur le relevé réel + copie Deno

**Files:**
- Create: `src/lib/catalogue/baywa.js`
- Create: `scripts/catalogue/baywa.test.mjs` (lit `scripts/catalogue/data/baywa-2026-10.json`) ; Modify: `package.json` (`audit:quality`)
- Modify: `scripts/sync-tournee-engine.mjs` (liste `CATALOGUE = ['baywa']` copiée vers `supabase/functions/_shared/catalogue/`)

**Interfaces:**
- Produces: `articlesDepuisReleveBaywa(releve, { version }) → { lignes: LigneCatalogue[], retenus: number, exclus: { kits: number, sans_prix: number, non_achetable: number, hors_perimetre: number }, releve_at: string }` où `LigneCatalogue = { reference, name, brand, gamme, product_kind: 'main'|'accessory', purchase_price_ht, selling_price_ht_defaut, default_tva_rate: 20, unit: 'pièce', category: 'batterie', specs: { canonical: {...}, source_version } }` (clés exactement celles que la RPC de Task 3 lit). Exports aussi `PRIX_PUBLIC_TESLA_HT`, `LIBELLES_FR_TESLA`, `estRetenu(item)`, `nommer(item)`, `gammeDe(item)`.

- [ ] **Step 1 : test** `scripts/catalogue/baywa.test.mjs` sur le relevé réel :
  - `retenus === 87`, `exclus.kits === 13`, aucune ligne avec `itemtype === 'Kit'` ;
  - Powerwall 3 (`reference '35-119503'`) : `purchase_price_ht 4773.29`, `selling_price_ht_defaut 5500`, `product_kind 'main'`, `brand 'Tesla'`, `specs.canonical.mpn '1707000-30-L'`, `energie_utile_kwh 13.5`, `name` français (ne contient pas « Battery ») ;
  - extension `'35-120026'` : `3969.76 / 4780` ; Gateway V2 `'36-122569'` : `835.32 / 1150` ; Gateway `'36-117955'` : `952.97 / 1150` ;
  - Remote Meter mono `'37-122388'` (mpn `2083764-00-C`) : `purchase_price_ht 103.67`, `selling_price_ht_defaut 0`, `product_kind 'accessory'`, `gamme 'Compteur'` ; 19 lignes en gamme « Stockage tertiaire » ;
  - aucune ligne à `purchase_price_ht >= 5000` dont `product_kind !== 'main'` ; `fiche_technique_fr` commence par `https://solarshop.baywa-re.fr/` quand présente ; `stock_releve` = `{ qty, at }` ;
  - `nommer({ displayname: 'TESLA-REMOTE-METER-TRI-KIT-CABLE-RS485', storedisplayname2: 'Tesla Remote Meter Three Phase Kit' })` → le libellé de `LIBELLES_FR_TESLA` ; `nommer({ displayname: 'Vitre frontale pour Powerwall 3', … })` → `'Vitre frontale pour Powerwall 3'` ;
  - relevé tronqué `{ total: 995, items: [...10] }` ⇒ lève `releve_incomplet`.
- [ ] **Step 2 : lancer, vérifier l'échec** (module absent).
- [ ] **Step 3 : implémenter** `src/lib/catalogue/baywa.js`. Périmètre : `fields.cseg_itemcategory === 'Battery Storage'` ou fabricant `Tesla` ou `/tesla|powerwall/i` sur les libellés ; exclusions : `itemtype === 'Kit'`, prix non numérique, `ispurchasable === false`. Gamme : « Stockage tertiaire » si `energie_utile_kwh >= 20`, « Batterie » si énergie utile, sinon par mots-clés (`gateway|passerelle` → « Passerelle / Gateway », `meter|compteur|CT ` → « Compteur », `box|coffret` → « Coffret », `cable|câble` → « Câble », sinon « Accessoire »). Libellé : `displayname` s'il contient une espace et n'est pas `^[A-Z0-9 ._/-]+$`, sinon `storedisplayname2` ; `LIBELLES_FR_TESLA` par préfixe de `mpn` (Powerwall 3, extension DC, Backup Gateway 2, Remote Meter mono/tri). Prix public : `PRIX_PUBLIC_TESLA_HT = { '1707000': 5500, '1152100': 1150, '1807000': 4780 }` sur les 7 premiers caractères du `mpn`.
- [ ] **Step 4 : test PASS** ; ajouter le test à `audit:quality` ; `npm run sync:tournee-engine` puis vérifier que `supabase/functions/_shared/catalogue/baywa.js` existe et que le test de synchro (`scripts/tournee/sync-engine.test.mjs`) passe.
- [ ] **Step 5 : commit** `feat(catalogue): adaptateur BayWa (relevé → lignes de catalogue) testé sur le relevé réel`.
- [ ] **Step 6 : adaptateur Domos** — Create `src/lib/catalogue/domos.js` (`articlesDepuisReleveDomos(releve, { version })`, même forme de retour ; règles de la spec § 7 « Domos » ; prix = `Number(prices.price) / 10 ** currency_minor_unit`) et `scripts/catalogue/domos.test.mjs` sur `scripts/catalogue/data/domos-2026-10.json` : aucun `type !== 'simple'` retenu, SKU `323052` (ATMOCE BattBank 16 kWh) → `purchase_price_ht 3039.6`, `product_kind 'main'`, `brand 'ATMOCE'`, `gamme 'Batterie AC'`, `selling_price_ht_defaut 0` ; SKU `482057` (Huawei LUNA2000-7-E1) → `2119.94`, `'main'`, `'Batterie DC'` ; SKU `392092` (EcoFlow Smart Meter) → `'accessory'`, `'Accessoire stockage'` ; `retenus` = nombre mesuré au premier passage (le figer dans le test) ; relevé tronqué ⇒ `releve_incomplet`. Ajouter `'domos'` à la liste `CATALOGUE` du script de synchro. Commit `feat(catalogue): adaptateur Domos`.

### Task 3 : migration — connecteur fournisseur, RPC d'upsert, secrets par org

**Files:**
- Create: `supabase/migrations/20261024_2_catalogue_connexion_fournisseur.sql`
- Create: `scripts/migration-rehearsal/assert-catalogue-connexion.sql` ; Modify: `scripts/migration-rehearsal/snapshot.mjs` (VIEWS : `public.majordhome_suppliers`, `public.majordhome_suppliers_write` ; TABLES : `majordhome.suppliers` déjà listée)

**Interfaces:**
- Produces:
  - colonnes `majordhome.suppliers.connector text CHECK (connector IN ('baywa','domos'))`, `catalog_sync_at timestamptz`, `catalog_sync_result jsonb` ; exposées en fin des vues `majordhome_suppliers` et `majordhome_suppliers_write`.
  - `public.supplier_catalog_upsert(p_org_id uuid, p_supplier_id uuid, p_source_version text, p_rows jsonb) RETURNS jsonb` — `{ inseres, mis_a_jour, desactives, total }` ; SECURITY DEFINER, `SET search_path = majordhome, public`, `REVOKE FROM PUBLIC, anon, authenticated`, `GRANT service_role`. Lève `supplier_not_in_org` si le fournisseur n'appartient pas à `p_org_id`, `rows_empty` si `p_rows` est vide (jamais désactiver tout un catalogue sur un relevé vide).
  - `public.org_secret_set(p_org_id uuid, p_key text, p_value text) RETURNS void` (org_admin via `auth.uid()`, `vault.create_secret` ou `vault.update_secret` par nom `org:<org_id>:<key>`), `public.org_secret_status(p_org_id uuid, p_key text) RETURNS jsonb` `{ exists, updated_at }` (membre), `public.org_secret_delete(p_org_id, p_key)` (org_admin), `public.org_secret_read(p_org_id uuid, p_key text) RETURNS text` (`service_role` seul, `REVOKE FROM PUBLIC, anon, authenticated`).

- [ ] **Step 1 : assert** `assert-catalogue-connexion.sql` : (a) après un premier appel de `supplier_catalog_upsert` avec 2 lignes (une Tesla `selling_price_ht_defaut 5500`, une à 0) : 2 insérées, `name` et `selling_price_ht` = valeurs du payload ; (b) second appel avec `name` différent, `purchase_price_ht` différent, après `UPDATE … SET selling_price_ht = 4900` à la main : `name` inchangé, `selling_price_ht 4900` inchangé, `purchase_price_ht` mis à jour ; (c) ligne Tesla mise à 0 à la main puis ré-import ⇒ `5500` ; (d) relevé sans la 2ᵉ ligne ⇒ `is_active = false` sur elle, `desactives = 1` ; (e) `p_rows = '[]'` ⇒ exception `rows_empty` ; (f) `has_function_privilege('anon', …)` et `('authenticated', …)` FALSE sur `supplier_catalog_upsert` et `org_secret_read` ; (g) `org_secret_set` sous `set role authenticated` + `request.jwt.claims` d'un membre non admin ⇒ exception ; (h) `catalog_sync_at` renseigné et `catalog_sync_result ->> 'total'` = `'2'` après (a).
- [ ] **Step 2 : rejouer sans migration** : `node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-catalogue-connexion.sql` ⇒ échec (fonctions absentes).
- [ ] **Step 3 : écrire la migration** (pattern `org_update_settings` pour la garde org_admin ; `vault.create_secret(p_value, name)` / `vault.update_secret(id, p_value)` ; upsert = `CREATE TEMP TABLE` depuis `jsonb_to_recordset(p_rows)` puis UPDATE / INSERT / désactivation comme le script Solipac, avec `name` et `selling_price_ht` seulement à l'INSERT et `selling_price_ht = CASE WHEN p.selling_price_ht = 0 AND t.selling_price_ht_defaut > 0 THEN t.selling_price_ht_defaut ELSE p.selling_price_ht END` à l'UPDATE ; `specs = COALESCE(p.specs,'{}') || t.specs`).
- [ ] **Step 4 : rejouer avec migration** (`--migration … --assert …`) ⇒ PASS ; puis `--assert assert-baseline.sql` ⇒ PASS.
- [ ] **Step 5 : appliquer en prod** via `node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw supabase/migrations/20261024_2_catalogue_connexion_fournisseur.sql` et inscrire la migration dans `supabase_migrations.schema_migrations` comme les précédentes (lire comment `20261024_1` l'a été) ; auditer `has_function_privilege` en prod pour les 5 RPC.
- [ ] **Step 6 : commit** `feat(catalogue): connecteur fournisseur, RPC supplier_catalog_upsert, secrets par org (Vault)`.

### Task 4 : script Node d'import d'un relevé + script de console + premier chargement Mayer

**Files:**
- Create: `scripts/catalogue/import-releve.mjs`, `scripts/catalogue/dump-baywa.browser.js`, `scripts/catalogue/out/` (gitignoré comme `scripts/clim/out`)

**Interfaces:**
- Consumes: `articlesDepuisReleveBaywa` (Task 2), `public.supplier_catalog_upsert` (Task 3).
- Produces: `node scripts/catalogue/import-releve.mjs --fournisseur baywa --fichier scripts/catalogue/data/baywa-2026-10.json [--org …] [--version baywa_2026-10]` → `scripts/catalogue/out/<version>.sql` = `DO $$ … v_sup := (SELECT id … name = 'BAYWA R.E.') sinon INSERT … PERFORM public.supplier_catalog_upsert(v_org, v_sup, '<version>', $rows$<json>$rows$::jsonb); END $$;`, appliqué par `apply-sql.mjs`.

- [ ] **Step 1 : écrire `dump-baywa.browser.js`** = le code de la spec § 4, enveloppé dans une IIFE async qui termine par un `<a download="baywa-AAAA-MM.json">` cliqué ; en-tête : « coller dans la console de `solarshop.baywa-re.fr` une fois connecté ». Même chose pour `dump-domos.browser.js` (API Store paginée, spec § 7, fichier `domos-AAAA-MM.json`).
- [ ] **Step 2 : écrire `import-releve.mjs`** (squelette Solipac : `--fournisseur baywa|domos` choisit l'adaptateur et le nom du fournisseur « BAYWA R.E. » / « DOMOS INDUSTRIES », affiche `retenus / exclus` et une table par gamme, échoue si `exclus` ou `retenus` sont incohérents avec `releve.total`).
- [ ] **Step 3 : générer puis appliquer** sur Mayer pour les deux relevés ; vérifier en prod : `select supplier, count(*) from majordhome.supplier_products where category='batterie' and is_active` = 87 BayWa + N Domos ; Powerwall 3 `purchase 4773.29 / selling 5500` ; ATMOCE 16 kWh `3039.6 / 0` ; `suppliers.catalog_sync_result` renseigné pour les deux.
- [ ] **Step 4 : rejouer les imports** une seconde fois ⇒ `inseres 0, desactives 0` pour chacun.
- [ ] **Step 5 : commit** `feat(catalogue): import d'un relevé fournisseur (BayWa, Domos) et premier chargement du catalogue batterie`.

### Task 5 : edge `supplier-catalog-sync` + cron

**Files:**
- Create: `supabase/functions/supplier-catalog-sync/index.ts`, `supabase/functions/supplier-catalog-sync/baywaClient.ts` (connexion + pagination, fonctions pures testables : `parseLoginResponse(status, contentType, body)`, `buildItemsUrl(offset)`)
- Create: `supabase/functions/supplier-catalog-sync/baywaClient.test.ts` (`deno test`)
- Modify: `supabase/config.toml` (`[functions.supplier-catalog-sync] verify_jwt = false`)
- Create: `supabase/migrations/20261024_3_supplier_catalog_sync_cron.sql` (pattern `20260930_6_auto_rdv_crons.sql`, URL `ejqqqwudmizqisdkxohw`, `0 4 * * *`, body `{ "mode": "cron" }`)

**Interfaces:**
- Consumes: `_shared/catalogue/baywa.js` (Task 2), `org_secret_read`, `supplier_catalog_upsert` (Task 3).
- Produces: body `{ action: 'sync' | 'import', org_id, supplier_id, releve? }` sous JWT user (`requireOrgMembership({ orgId, requiredRole: 'org_admin' })`) ; `{ mode: 'cron' }` sous `requireSharedSecret(MDH_CRON_SECRET)` → boucle `suppliers WHERE connector='baywa' AND is_active`. Réponse `{ ok: true, resultat: { inseres, mis_a_jour, desactives, total, retenus, exclus } }` ou `{ ok: false, code }` avec `code ∈ 'identifiants_absents' | 'connexion_refusee' | 'acces_bloque' | 'releve_incomplet' | 'connector_inconnu'`. Dans tous les cas d'échec, `catalog_sync_result` = `{ ok: false, code, at }` (écrit via une mise à jour `majordhome_suppliers_write` par le client admin).

- [ ] **Step 1 : test Deno** `baywaClient.test.ts` : `parseLoginResponse(403, 'text/html', '<html…')` → `'acces_bloque'` ; `(200, 'application/json', '{"errorCode":…}')` → `'connexion_refusee'` ; `(200, 'application/json', '{"user":…}')` → `null` (OK) ; `buildItemsUrl(100)` contient `offset=100`, `limit=100`, `fieldset=search`, pas de `pricelevel` (la session fixe le niveau de prix).
- [ ] **Step 2 : `deno test`** ⇒ échec (fichier absent).
- [ ] **Step 3 : implémenter** `baywaClient.ts` (GET `/sca-lux-2019-2/checkout.ssp?is=login&login=T` pour les cookies initiaux, `POST /sca-lux-2019-2/services/Account.Login.Service.ss` JSON `{ email, password, redirect: 'true' }` avec `Content-Type: application/json`, `X-SC-Touchpoint: checkout`, cookies rejoués à la main ; puis pages `/api/items` comme la spec § 4 sans `pricelevel`) et `index.ts` (auth selon l'en-tête ; `action 'import'` : `releve` du body → adaptateur → RPC ; `action 'sync'` : secret → client → adaptateur → RPC).
- [ ] **Step 4 : `deno test` PASS, `deno check`** ; déployer via MCP `deploy_edge_function` (fichiers : `index.ts`, `baywaClient.ts`, `../_shared/auth.ts`, `../_shared/catalogue/baywa.js`).
- [ ] **Step 5 : test réel** : après Task 6 (identifiants saisis par Eric), un appel `sync` doit renvoyer `retenus 87` et un Powerwall à `4773.29` ; si `acces_bloque`, le noter dans le message de fin (le repli `import` reste fonctionnel) — ne pas tenter de contourner.
- [ ] **Step 6 : appliquer la migration cron** (apply-sql + `select jobname, schedule from cron.job`), commit `feat(catalogue): edge supplier-catalog-sync (connexion BayWa, import de relevé, cron quotidien)`.

### Task 6 : Settings → Fournisseurs — connexion catalogue

**Files:**
- Modify: `src/shared/services/suppliers.service.js` (ajouter `setConnectorCredentials(orgId, supplierId, { email, password })` → `org_secret_set` ; `getConnectorStatus(orgId, supplierId)` → `org_secret_status` ; `syncCatalog(orgId, supplierId)` et `importCatalogReleve(orgId, supplierId, releve)` → `supabase.functions.invoke('supplier-catalog-sync')` ; `connector` accepté par `createSupplier` / `updateSupplier`)
- Modify: `src/shared/hooks/useSuppliers.js` (`useSupplierConnector(orgId, supplierId)` → `{ status, isLoading, saveCredentials, sync, importReleve, isWorking }`, invalidation `supplierKeys.all(orgId)` après sync) ; `src/shared/hooks/cacheKeys.js` (`supplierKeys.connector(orgId, supplierId)`)
- Modify: `src/apps/artisan/pages/settings/SupplierManagement.jsx` (`SupplierFormModal` : select « Connexion catalogue » Aucune / BayWa r.e. (automatique) / Domos (relevé manuel)) ; Create: `src/apps/artisan/pages/settings/suppliers/CatalogConnectorPanel.jsx` (monté en tête de `ProductCatalog` quand `supplier.connector`)
- Create: `src/lib/catalogue/syncResult.js` (PUR : `libelleResultat(result) → string` « Relevé du 24/10/2026 à 04:00 : 87 articles, 2 nouveaux, 1 désactivé » / « Échec : accès bloqué par BayWa… ») + `scripts/catalogue/sync-result.test.mjs`

**Interfaces:**
- Consumes: RPC `org_secret_*` (Task 3), edge (Task 5), colonnes `connector` / `catalog_sync_*` exposées par les vues.

- [ ] **Step 1 : test** `sync-result.test.mjs` : `libelleResultat({ ok: true, at, total: 87, inseres: 2, desactives: 1 })` et chaque `code` d'échec a un libellé FR ; `null` → « Jamais relevé ».
- [ ] **Step 2 : test KO, implémenter le module, test PASS.**
- [ ] **Step 3 : service + hook + cache key** (mutations déballées par `unwrapResult`, `enabled: !!orgId && !!supplierId && supplier.connector === 'baywa'` pour le statut).
- [ ] **Step 4 : UI** : panneau à trois états : (a) `baywa` sans identifiants → formulaire e-mail + mot de passe (`type="password"`, jamais ré-affiché) + « Enregistrer » ; (b) `baywa` avec identifiants → « Identifiants enregistrés le … », « Actualiser le catalogue », « Remplacer les identifiants », et, en repli, « Importer un relevé » (input `file` JSON) ; (c) `domos` → « Importer un relevé » seul + lien vers le script de console du fournisseur. Sous le panneau : `libelleResultat(supplier.catalog_sync_result)`. Visible org_admin seul (`useAuth().isOrgAdmin`).
- [ ] **Step 5 : vérifier** `npm run lint:errors`, `npx vite build`, `node --test scripts/catalogue/*.test.mjs scripts/devis-config.test.mjs` ; puis poser `connector='baywa'` sur BAYWA R.E. en prod (via la fiche) et faire saisir les identifiants à Eric pour le test réel de Task 5 Step 5.
- [ ] **Step 6 : commit** `feat(settings): connexion catalogue dans la fiche fournisseur (identifiants, actualisation, import de relevé)`.

### Task 7 : livraison

- [ ] `npm run audit:quality` PASS (inclut les nouveaux tests et la synchro Deno).
- [ ] Relecture CLAUDE.md : signaler (sans l'intégrer soi-même) un ajout « Module Catalogue fournisseur » dans `.claude/proposed-updates.md` (PENDING) : un seul écrivain `supplier_catalog_upsert`, modules purs `src/lib/catalogue/`, secrets Vault `org_secret_*`, Domos = relevé manuel (Turnstile), catégorie `batterie`.
- [ ] Push `main`, suivre le déploiement Vercel jusqu'à READY (MCP), vérifier en prod l'ouverture d'un devis « Batterie » avec la Powerwall dans le picker ÉQUIPEMENT et la ligne libre dans MATÉRIEL.
- [ ] Message de fin : ce qui est fait, résultat du test de connexion BayWa réel (ou `acces_bloque`), ce qui reste (catégorie `solaire` pour les 840 + ~600 articles PV / onduleurs / fixation des deux relevés ; prix de vente Domos à poser à la main).
