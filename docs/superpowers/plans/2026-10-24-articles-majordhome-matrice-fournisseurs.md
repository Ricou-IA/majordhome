# Articles Majord'home et matrice fournisseurs — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à chaque org une base d'articles Majord'home (un article par ligne fournisseur, fusionnés quand ils sont communs) rattachée aux lignes fournisseur, et faire choisir au devis l'offre la moins chère parmi les prix frais.

**Architecture:** Une table `majordhome.catalog_items` + une colonne `supplier_products.catalog_item_id` (la matrice) + `quote_lines.catalog_item_id`. Toute écriture de lien passe par des RPC SECURITY DEFINER (org_admin) ; la création d'articles est faite par la base en fin de relevé. Le choix du fournisseur est un module pur `src/lib/catalogue/meilleureOffre.js` consommé par le picker et par la ligne de devis. Deux tranches : A (matrice, fiche article, harmonisation générale, retrait de `catalog_matches`), B (devis).

**Tech Stack:** React 18 / Vite / React Query v5 / Supabase (PostgreSQL, RLS, pg vues `security_invoker`) / Deno edge `catalog-normalize` / harnais `scripts/migration-rehearsal`.

**Spec:** `docs/superpowers/specs/2026-10-24-articles-majordhome-matrice-fournisseurs-design.md`

## Global Constraints

- Charte multi-tenant : `org_id` sur toute mutation ; RLS scopée org sur toute table `majordhome.*` ; vues `public.majordhome_*` `WITH (security_invoker=true)`, colonnes ajoutées **en fin** ; RPC SECURITY DEFINER `SET search_path = majordhome, public`, `REVOKE EXECUTE FROM PUBLIC, anon` (+ `authenticated` quand `org_id` est dans le payload) ; gardes positives (`IF auth.uid() IS NULL THEN RAISE`, `(cond) IS NOT TRUE`) ; `GRANT SELECT … TO service_role` sur chaque nouvelle table.
- **Édition d'un article = org_admin seul** (décision Eric) : policies UPDATE de `catalog_items` et toutes les RPC d'écriture vérifient `role = 'org_admin'` dans `core.organization_members`. Lecture = tout membre.
- La base fournisseur n'est jamais réécrite : sur `supplier_products` seules trois colonnes s'ajoutent (`catalog_item_id`, `catalog_item_link_source`, `catalog_item_linked_at`) plus `purchase_price_at`, posée uniquement par l'upsert / l'import d'achats.
- Les devis existants ne changent ni de contenu ni de prix.
- Miroir simple = updatable ; agrégat = vue de lecture séparée (jamais de LATERAL dans un miroir).
- Modules purs sans import React/Supabase, testés `node --test`, listés dans `audit:quality` ; `logger` et non `console` ; cache keys avec `orgId` en premier ; mutations via `unwrapResult`.
- Toute migration répétée sur le harnais, **liste de `snapshot.mjs` étendue** (pas de chaîne de rejeu).
- Commits par chemins explicites (session concurrente possible sur `main`), jamais `git add -A`.
- Pas de composant > 500 lignes.

## Review Focus

1. Un article dont la seule ligne fournisseur est désactivée par le relevé suivant ne doit plus apparaître au devis, sans être supprimé → assert Task 1 (`offres_actives = 0`, article toujours présent).
2. Fusionner deux articles dont chacun est cité par des lignes de devis doit re-pointer toutes ces lignes sur le survivant → assert Task 2.
3. Une offre au prix d'achat nul ou NULL ne doit jamais être retenue d'office → test Task 8.
4. Deux lignes du même fournisseur sur un article (doublons legacy) doivent compter pour une seule offre de ce fournisseur (la moins chère) → test Task 8 (`offresParFournisseur`).
5. Enregistrer un devis existant après la migration ne doit pas perdre `catalog_item_id` (les lignes sont supprimées puis réinsérées) → vérification Task 3.

---

## Tranche A — la matrice

### Task 1 : Schéma, création automatique des articles, upsert v6

**Files:**
- Create: `supabase/migrations/20261026_1_catalog_items.sql`
- Create: `scripts/migration-rehearsal/assert-catalog-items.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (TABLES : `majordhome.quote_lines`, `majordhome.catalog_matches` ; FUNCTIONS : `public.supplier_catalog_apply_mapping(uuid)`, `public.get_distinct_brands(uuid)`, `public.catalog_matches_propose(uuid)`, `public.catalog_match_set_status(uuid[], text)`, `public.catalog_match_create(uuid, uuid)` ; VIEWS : `public.majordhome_catalog_matches`, `public.majordhome_quote_lines`, `public.majordhome_quote_lines_write`)
- Modify: `scripts/catalogue/achats.js` (chaque ligne émise porte `purchase_price_at: reference.date`)
- Test: `scripts/catalogue/achats.test.mjs` (existant : ajouter l'assertion `purchase_price_at`)

**Interfaces:**
- Produces (DB) :
  - `majordhome.catalog_items(id, org_id, name, brand, model_key, code_ean, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht, description, image_url, specs jsonb, is_active, source_product_id, origin, merged_into, created_at, updated_at)` ; CHECK `origin IN ('auto','manuel')`.
  - `supplier_products.catalog_item_id uuid REFERENCES catalog_items ON DELETE SET NULL`, `catalog_item_link_source text CHECK IN ('auto','cle','ean','ia','manuel')`, `catalog_item_linked_at timestamptz`, `purchase_price_at timestamptz`.
  - `quote_lines.catalog_item_id uuid REFERENCES catalog_items ON DELETE SET NULL`.
  - Vues : `public.majordhome_catalog_items` (miroir simple updatable, security_invoker), `public.majordhome_catalog_items_list` (lecture : colonnes du miroir + `offres_actives int`, `offres_total int`, `meilleur_prix_achat numeric`, `fournisseurs text[]`), `public.majordhome_catalog_item_offers` (lecture : `item_id, product_id, supplier_id, supplier_name, supplier_auto_sync, reference, name, purchase_price_ht, purchase_price_at, selling_price_ht, stock_qty int, en_stock boolean, is_active, link_source, image_url`) ; `majordhome_supplier_products` / `_write` et `majordhome_quote_lines` / `_write` reçoivent leurs nouvelles colonnes **en fin**.
  - RPC `public.catalog_items_ensure(p_org_id uuid) RETURNS jsonb {crees, rattaches}` — service_role only.
  - `public.supplier_catalog_upsert` v6 : `t_imp.purchase_price_at` (colonne optionnelle de `p_rows`, défaut `now()`), écrite à l'UPDATE et à l'INSERT ; appelle `catalog_items_ensure(p_org_id)` en fin ; résultat += `articles: {crees, rattaches}`.
  - `public.supplier_catalog_apply_mapping` v3 : après le reclassement des lignes, reclasse l'article quand il n'a que cette ligne et que `catalog_items.category` était égale à l'ancienne catégorie de la ligne.
  - RLS `catalog_items` : SELECT membre ; INSERT/UPDATE/DELETE `org_admin` ; `GRANT SELECT TO service_role` ; `REVOKE ALL FROM PUBLIC, anon`.

- [ ] **Step 1 : Étendre `snapshot.mjs` et rafraîchir le snapshot**

Ajouter les entrées listées ci-dessus (commentaire `// 20261026_1 : articles Majord'home`), puis :
Run : `node scripts/migration-rehearsal/snapshot.mjs --env .env.local`
Expected : dernière ligne `Écrit : …schema-generated.sql, data.json`, aucune erreur « does not exist ».

- [ ] **Step 2 : Écrire les assertions (RED)**

`assert-catalog-items.sql`, bloc `DO $$` sur l'org Mayer, fixture : un fournisseur `TEST ITEMS A` (connector `suitecommerce`) et un `TEST ITEMS B` (`woocommerce`) créés dans le bloc, puis `supplier_catalog_upsert` en `service_role` avec :
- A : `A1` Powerwall 3 (brand Tesla, model_key `170700030L`, kind main, 4773.29, category batterie) ; `A2` câble (brand Tesla, model_key NULL, kind accessory, 30) ; `A3` LUNA (brand Huawei, model_key `LUNA20007E1`, main, 1200).
- B : `B1` Powerwall 3 (brand TESLA, model_key `170700030L`, main, 4900, `purchase_price_at` fourni = `'2026-09-01'`) ; `B3` LUNA (brand huawei, `LUNA20007E1`, main, 3000 — rapport > 2) ; `B4` compteur (brand Kamase, model_key NULL, accessory, 25).
Assertions :
1. Après l'upsert de A : 3 articles créés (`origin='auto'`, `source_product_id` = la ligne), chaque ligne a `catalog_item_id`, `link_source='auto'`, `purchase_price_at` ≈ `now()`.
2. Après l'upsert de B : `B1` **rattachée** à l'article de `A1` (`link_source='cle'`), `B3` crée un article (rapport de prix > 2), `B4` crée un article ; résultat `articles.rattaches = 1`, `articles.crees = 2` ; `B1.purchase_price_at = '2026-09-01'`.
3. `majordhome_catalog_items_list` : l'article Powerwall a `offres_actives = 2`, `fournisseurs` contient les deux noms, `meilleur_prix_achat = 4773.29`.
4. `majordhome_catalog_item_offers` : 2 lignes pour la Powerwall, `stock_qty` / `en_stock` lus depuis `specs.canonical.stock_releve` (poser `{"qty": 3}` sur A1 et `{"en_stock": true}` sur B1 dans les specs des rows).
5. Review Focus 1 : second relevé de A **sans** `A3` → la ligne `A3` est désactivée, son article existe toujours (`is_active = true`, `merged_into IS NULL`) avec `offres_actives = 0`.
6. `apply_mapping` v3 : poser `category_mapping` `{"Battery Storage": "photovoltaique"}` sur A avec `categories_site ['Battery Storage']` sur A2 seule (article à une ligne, catégorie `batterie` égale à celle de la ligne) → l'article de A2 passe en `photovoltaique` ; l'article Powerwall (2 lignes) ne bouge pas.
7. Droits : `has_function_privilege('authenticated', 'public.catalog_items_ensure(uuid)', 'EXECUTE')` faux ; `anon` sans SELECT sur `majordhome.catalog_items` ; `service_role` SELECT vrai ; en rôle `authenticated` non admin, `UPDATE majordhome_catalog_items SET name = 'x'` affecte 0 ligne ; en admin, 1 ligne.
8. Idempotence : un second appel de `catalog_items_ensure` renvoie `{crees: 0, rattaches: 0}`.
9. Doublon legacy : insérer directement deux lignes `supplier_products` même fournisseur, même référence `DUP-1`, sans `source_version` ; `ensure` leur donne **un seul** article.
10. Vues `majordhome_quote_lines_write` et `majordhome_supplier_products_write` : `catalog_item_id` est la **dernière** colonne (`ordinal_position = max`).
Termine par `RAISE NOTICE 'assert-catalog-items : OK'`.

- [ ] **Step 3 : Vérifier l'échec**

Run : `node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-catalog-items.sql`
Expected : `ECHEC` sur `relation "majordhome.catalog_items" does not exist`.

- [ ] **Step 4 : Écrire la migration `20261026_1_catalog_items.sql`**

Dans l'ordre : table + index `(org_id, lower(brand), model_key) WHERE model_key IS NOT NULL`, `(org_id, code_ean) WHERE code_ean IS NOT NULL`, `(org_id, is_active)` ; RLS + policies + grants ; colonnes `supplier_products` (+ index `(catalog_item_id)`) et `quote_lines` ; `CREATE OR REPLACE VIEW` des quatre vues existantes avec les colonnes en fin ; les trois vues nouvelles ; `catalog_items_ensure` ; `supplier_catalog_upsert` v6 (corps de `20261025_5`) ; `supplier_catalog_apply_mapping` v3 (corps de `20261025_5`) ; backfill `UPDATE supplier_products SET purchase_price_at = COALESCE((specs->'canonical'->'stock_releve'->>'at')::timestamptz, (specs->'canonical'->>'prix_du')::date, updated_at) WHERE purchase_price_at IS NULL` ; backfill `SELECT catalog_items_ensure(org_id)` pour chaque org distincte de `supplier_products` ; backfill `quote_lines.catalog_item_id` depuis `supplier_products.catalog_item_id`.

Algorithme de `catalog_items_ensure` (le seul que le test ne détermine pas) : pour chaque ligne active sans article, dans l'ordre `created_at` :
1. S'il existe déjà une ligne du même fournisseur et même `reference` rattachée → même article (`link_source='auto'`).
2. Candidats = articles actifs de l'org, `merged_into IS NULL`, sans ligne de ce fournisseur, de même `product_kind`, qui partagent (`lower(brand)`, `model_key`) **ou** `code_ean` avec la ligne, et dont `min(purchase_price_ht)` des offres actives vérifie `greatest(a,b) <= 2 * least(a,b)` avec le prix de la ligne. Exactement un candidat → rattacher (`link_source` = `'cle'` ou `'ean'`).
3. Sinon créer l'article (copie des champs humains, `specs = jsonb_build_object('canonical', ligne.specs->'canonical')`, `origin='auto'`, `source_product_id`) et rattacher (`'auto'`).
Traitement ligne par ligne dans une boucle PL/pgSQL (les rattachements dépendent des créations précédentes).

- [ ] **Step 5 : Répéter**

Run : `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261026_1_catalog_items.sql --assert scripts/migration-rehearsal/assert-catalog-items.sql --assert scripts/migration-rehearsal/assert-catalogue-generique.sql --assert scripts/migration-rehearsal/assert-catalog-matches.sql`
Expected : `[rehearsal] OK` (les deux anciens asserts restent verts : l'upsert v6 et l'apply_mapping v3 n'enlèvent rien).

- [ ] **Step 6 : `achats.js` — date du prix**

Test (dans `scripts/catalogue/achats.test.mjs`, test existant qui vérifie `prix_du`) : ajouter `assert.equal(ligne.purchase_price_at, ligne.specs.canonical.prix_du)`. Run `node --test scripts/catalogue/achats.test.mjs` → FAIL ; ajouter `purchase_price_at: reference.date` à la ligne émise ; → PASS.

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20261026_1_catalog_items.sql scripts/migration-rehearsal/assert-catalog-items.sql scripts/migration-rehearsal/snapshot.mjs scripts/catalogue/achats.js scripts/catalogue/achats.test.mjs
git commit -m "feat(catalogue): articles Majord'home — table, matrice supplier_products.catalog_item_id, création automatique en fin de relevé, date du prix d'achat"
```

### Task 2 : Harmonisation côté base — propositions, fusion, rattachement manuel, conversion de `catalog_matches`

**Files:**
- Create: `supabase/migrations/20261026_2_catalog_items_harmonisation.sql`
- Create: `scripts/migration-rehearsal/assert-catalog-items-harmonisation.sql`
- Delete: `scripts/migration-rehearsal/assert-catalog-matches.sql` (la table disparaît)

**Interfaces:**
- Produces (DB) :
  - `majordhome.catalog_item_proposals(id, org_id, item_a_id, item_b_id, source, motif, statut, decided_by, decided_at, created_at, updated_at)` ; CHECK `item_a_id < item_b_id`, `source IN ('cle','ean','ia')`, `statut IN ('propose','fusionne','refuse')`, UNIQUE `(item_a_id, item_b_id)` ; RLS SELECT membre, aucune policy d'écriture ; `REVOKE ALL FROM PUBLIC, anon` ; `GRANT SELECT TO service_role`.
  - Vue `public.majordhome_catalog_item_proposals` (lecture : la proposition + `item_a_name, item_a_brand, item_a_category, item_a_offres int, item_a_prix numeric, item_b_*`, `ecart_pct`).
  - `public.catalog_item_proposals_propose(p_org_id) RETURNS jsonb {fusionnes, proposes, nouvelles}` — service_role.
  - `public.catalog_item_merge(p_survivor_id uuid, p_absorbed_id uuid) RETURNS jsonb {lignes, lignes_devis}` — org_admin.
  - `public.catalog_item_proposals_decide(p_ids uuid[], p_statut text) RETURNS int` — org_admin ; `'fusionne'` appelle `catalog_item_merge(a, b)` (survivant = le plus ancien `created_at`), `'refuse'` marque.
  - `public.catalog_item_attach(p_product_id uuid, p_item_id uuid) RETURNS void` — org_admin.
  - `public.catalog_item_detach(p_product_id uuid) RETURNS uuid` (id du nouvel article) — org_admin.
  - `DROP` : `public.catalog_matches_propose`, `catalog_match_set_status`, `catalog_match_create`, vue `majordhome_catalog_matches`, table `majordhome.catalog_matches` (après conversion).

- [ ] **Step 1 : Assertions (RED)** — `assert-catalog-items-harmonisation.sql`, même fixture que Task 1 (recréée dans le bloc) plus : `A5`/`B5` même marque + clé `SUN2000X` chez A **deux fois** (deux produits distincts, `A5` et `A6`) et une fois chez B → ambigu ; `A7`/`B7` même EAN `6971234567890`, prix 880 / 900.
1. `propose` : la paire `A7/B7` (EAN, un seul candidat) est **fusionnée d'office** (`statut='fusionne'`, un seul article actif reste, l'absorbé a `merged_into`) ; `A5/B5` et `A6/B5` sont `propose` ; `A3/B3` (rapport > 2) `propose` ; résultat `{fusionnes: 1, proposes: 3}`.
2. Review Focus 2 : insérer une `quotes` + 2 `quote_lines` citant l'article de `A5` et l'article de `B5` ; `decide([{A5,B5}], 'fusionne')` en admin → les deux lignes de devis pointent le survivant ; `A6/B5` est automatiquement `refuse`? **Non** : elle reste `propose` (B5 a changé d'article : la proposition est rafraîchie au prochain `propose`, qui la recrée sur le nouveau couple ou la supprime si le fournisseur est désormais commun — l'assert vérifie qu'après un second `propose`, aucune proposition `propose` ne cite un article absorbé).
3. Refus : `decide([{A3,B3}], 'refuse')` puis `propose` → pas de nouvelle ligne, statut toujours `refuse`.
4. Membre non admin : `decide` et `merge` lèvent `42501`.
5. `detach(B1)` (B1 était rattachée à la Powerwall de A1) → nouvel article pour B1, l'article Powerwall garde A1 ; `attach(B1, article Powerwall)` → de retour, `link_source='manuel'`, le nouvel article (plus aucune ligne, aucune ligne de devis) est `is_active=false`.
6. Conversion : avant la migration, l'assert ne peut pas poser de `catalog_matches` (table droppée) → la conversion est vérifiée en prod par la requête du Step 5 ; l'assert vérifie seulement que `to_regclass('majordhome.catalog_matches') IS NULL` et que les trois RPC n'existent plus.
7. Droits : `anon` sans SELECT sur `catalog_item_proposals` ; `authenticated` sans EXECUTE sur `propose`.

- [ ] **Step 2 : Vérifier l'échec** — Run `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261026_1_catalog_items.sql --assert scripts/migration-rehearsal/assert-catalog-items-harmonisation.sql` → `ECHEC` (`catalog_item_proposals` n'existe pas).

- [ ] **Step 3 : Écrire la migration** — ordre : table + vue + droits ; les cinq RPC ; **conversion** : pour chaque `catalog_matches` `confirme` → `catalog_item_merge(article de product_a, article de product_b)` avec survivant = article dont la ligne source est la plus ancienne ; `propose` → ligne `catalog_item_proposals` (`source` = `'ean'` si `motif LIKE 'code EAN%'` sinon `'cle'`) ; `refuse` → `refuse` ; puis `DROP FUNCTION` ×3, `DROP VIEW`, `DROP TABLE`.

Algorithme de `propose` : paires d'articles actifs (`merged_into IS NULL`) de l'org, `a < b`, **sans fournisseur commun** parmi leurs lignes actives, qui partagent via leurs lignes actives (`lower(brand)`, `model_key`) non NULL ou `code_ean` non NULL ; `franche` = un seul article candidat de chaque côté pour cette clé, même `product_kind`, `min(prix)` des deux dans un rapport ≤ 2 ; `DISTINCT ON (a, b)` avec la ligne franche d'abord ; une paire existante (quel que soit le statut) n'est pas réinsérée ; les franches sont fusionnées dans la foulée (`merge`), les autres insérées `propose`. En fin, supprimer les propositions `propose` dont un article a `merged_into IS NOT NULL`.

- [ ] **Step 4 : Répéter** — Run `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261026_1_catalog_items.sql --migration supabase/migrations/20261026_2_catalog_items_harmonisation.sql --assert scripts/migration-rehearsal/assert-catalog-items.sql --assert scripts/migration-rehearsal/assert-catalog-items-harmonisation.sql --assert scripts/migration-rehearsal/assert-catalogue-generique.sql` → `[rehearsal] OK`. Supprimer `assert-catalog-matches.sql` (et sa mention dans `assert-catalogue-generique.sql` si elle existe).

- [ ] **Step 5 : Requête de contrôle prod à conserver dans l'en-tête de la migration** — `SELECT count(*) FILTER (WHERE statut='confirme'), count(*) FILTER (WHERE statut='propose') FROM majordhome.catalog_matches` **avant** (attendu 15 / 3) et, après : `SELECT count(*) FROM majordhome.catalog_items WHERE merged_into IS NOT NULL` = 15, `SELECT count(*) FROM majordhome.catalog_item_proposals WHERE statut='propose'` = 3.

- [ ] **Step 6 : Commit**

```bash
git add supabase/migrations/20261026_2_catalog_items_harmonisation.sql scripts/migration-rehearsal/assert-catalog-items-harmonisation.sql scripts/migration-rehearsal/assert-catalog-matches.sql
git commit -m "feat(catalogue): harmonisation des articles — propositions, fusion, rattachement manuel ; conversion et retrait de catalog_matches"
```

### Task 3 : Service, hooks, cache keys ; lignes de devis qui portent l'article ; retrait du front `catalog_matches`

**Files:**
- Create: `src/shared/services/catalogItems.service.js`
- Create: `src/shared/hooks/useCatalogItems.js`
- Modify: `src/shared/hooks/cacheKeys.js` (famille `catalogItemKeys`, retrait de `supplierKeys.matches` / `productMatches`)
- Modify: `src/shared/services/suppliers.service.js` (retrait `proposeMatches`, `getMatches`, `getProductMatches`, `setMatchStatus`, `createMatch` ; `normalizeCatalog(orgId, supplierId = null, limit = 50)`)
- Modify: `src/shared/hooks/useSuppliers.js` (retrait `useCatalogMatches`, `useProductMatches` ; `useSupplierConnector.normalize` inchangé)
- Modify: `src/shared/services/devis.service.js:283-354, 388-454, 568-651` (`catalog_item_id: line.catalog_item_id || null` dans les trois mappages de lignes)
- Modify: `src/apps/artisan/components/devis/DevisProductPicker.jsx` (retrait de `useCatalogMatches` / `moinsCherAilleurs` / badge ; `catalog_item_id: p.catalog_item_id` dans la ligne posée)
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx:345, 373` (`catalog_item_id: null` dans les lignes libres et main d'œuvre)
- Delete: `src/lib/catalogue/matchesModel.js`, `scripts/catalogue/matches-model.test.mjs`, `src/apps/artisan/pages/settings/product-detail/ProductMatchesBlock.jsx` (retiré de `ProductDetailDrawer.jsx:37, 358`), `src/apps/artisan/pages/settings/suppliers/CatalogMatchesPage.jsx` (route `settings/suppliers/rapprochements` retirée de `routes.jsx:27, 328-335`)
- Modify: `package.json` (`audit:quality` : retrait de `matches-model.test.mjs`), `scripts/audit-dead-code.mjs` si `matchesModel` y est listé

**Interfaces:**
- Produces :
  - `catalogItemsService` : `listItems(orgId, { search, categories, brand, gamme, sansCategorie, sansOffreFraiche, page, pageSize })` → `{ data, count, error }` sur `majordhome_catalog_items_list` ; `getItem(orgId, itemId)` ; `getOffers(orgId, itemIds: string[])` → lignes de `majordhome_catalog_item_offers` ; `updateItem(orgId, itemId, { name, brand, category, gamme, productKind, unit, defaultTvaRate, sellingPriceHt, description, imageUrl, specs })` via `majordhome_catalog_items` ; `listProposals(orgId, statut)` ; `propose(orgId)` (edge `supplier-catalog-sync` action `matches` → voir Task 5) ; `decideProposals(ids, statut)` (RPC) ; `merge(survivorId, absorbedId)` ; `attach(productId, itemId)` ; `detach(productId)` ; `getDistinctBrands(orgId)` / `getDistinctGammes(orgId, categories)` sur la vue liste ; `searchItems(orgId, query, limit)` (pour le rattachement manuel, `escapePostgrestSearchTerm`).
  - `catalogItemKeys` : `all(orgId)`, `lists(orgId)`, `list(orgId, filtres)`, `detail(orgId, id)`, `offers(orgId, idsKey)`, `proposals(orgId, statut)`, `brands(orgId)`, `gammes(orgId, categoriesKey)`.
  - Hooks : `useCatalogItems(orgId, filtres)`, `useCatalogItem(orgId, id)`, `useCatalogItemOffers(orgId, itemIds)`, `useCatalogItemMutations(orgId)` → `{ updateItem, merge, attach, detach, decide, propose, isSaving }` (chaque mutation `unwrapResult`, invalide `catalogItemKeys.all(orgId)` **et** `supplierKeys.all(orgId)`), `useCatalogProposals(orgId, statut)`.
  - Toute ligne de devis porte `catalog_item_id` (null autorisé).

- [ ] **Step 1 : Service + keys + hooks** (pas de test unitaire : service d'accès ; vérification au build).
- [ ] **Step 2 : `devis.service.js`** — ajouter `catalog_item_id` aux trois mappages. Vérification (Review Focus 5) : `grep -c "catalog_item_id" src/shared/services/devis.service.js` → `3`.
- [ ] **Step 3 : Retraits** — fichiers, imports, route, `audit:quality`. Run `npm run audit:quality` → `pass`, `fail 0`, aucun fichier mort nouveau ; `npx vite build` → OK.
- [ ] **Step 4 : Commit**

```bash
git add src/shared/services/catalogItems.service.js src/shared/hooks/useCatalogItems.js src/shared/hooks/cacheKeys.js src/shared/services/suppliers.service.js src/shared/hooks/useSuppliers.js src/shared/services/devis.service.js src/apps/artisan/components/devis/DevisProductPicker.jsx src/apps/artisan/components/devis/DevisStepLines.jsx src/apps/artisan/pages/settings/ProductDetailDrawer.jsx src/apps/artisan/routes.jsx package.json scripts/audit-dead-code.mjs
git rm src/lib/catalogue/matchesModel.js scripts/catalogue/matches-model.test.mjs src/apps/artisan/pages/settings/product-detail/ProductMatchesBlock.jsx src/apps/artisan/pages/settings/suppliers/CatalogMatchesPage.jsx
git commit -m "feat(catalogue): service et hooks des articles Majord'home, lignes de devis rattachées à l'article, retrait des rapprochements deux à deux"
```

### Task 4 : Page Articles et fiche article

**Files:**
- Create: `src/apps/artisan/pages/settings/catalogue/ArticlesPage.jsx` (liste, filtres, pagination ; < 300 lignes)
- Create: `src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx` (fiche : champs humains + photo + specs + offres + documents + rattacher/détacher ; orchestrateur < 300 lignes)
- Create: `src/apps/artisan/pages/settings/catalogue/ArticleOffersTable.jsx` (offres : fournisseur, référence, prix, âge, stock, lien drawer ligne, « Détacher »)
- Create: `src/apps/artisan/pages/settings/catalogue/ArticleAttachModal.jsx` (recherche d'une ligne fournisseur par référence / libellé → `attach`)
- Create: `src/lib/catalogue/ageDePrix.js` (pur : `ageJours(prixDate, now)`, `libelleAge(prixDate, now)` → « relevé d'hier », « il y a 12 jours », « il y a 3 mois », « jamais » ; `estFrais(prixDate, now, seuilJours = 30)`) + test `scripts/catalogue/age-de-prix.test.mjs` (ajouté à `audit:quality`)
- Modify: `src/apps/artisan/routes.jsx` (route `settings/suppliers/articles`, `RouteGuard resource="settings"`)
- Modify: `src/apps/artisan/pages/settings/SupplierManagement.jsx:899-` (en-tête : liens « Articles » et « Harmoniser les bases » ; la liste des fournisseurs reste la page d'entrée)
- Modify: `src/apps/artisan/pages/settings/ProductDetailDrawer.jsx` (bloc « Article Majord'home » à la place de l'ancien bloc rapprochements : nom de l'article, nombre d'offres, lien « Ouvrir l'article » ; les champs humains **restent éditables** en tranche A)

**Interfaces:**
- Consumes : hooks de Task 3 ; `ProductDocumentsInline` existant (documents = union des `product_documents` des lignes : `useProductDocumentsByProductIds(ids des offres)`) ; `ProductSpecsForm` existant (`category`, `specs.canonical`) ; `getSchemaForCategory`.
- Produces : `ArticleDrawer({ orgId, itemId, onClose })` réutilisé par le picker (Task 9) et la page d'harmonisation (Task 5).

- [ ] **Step 1 : `ageDePrix.js` (RED → GREEN)** — tests : `estFrais('2026-10-01', '2026-10-24')` vrai ; `estFrais('2026-09-01', '2026-10-24')` faux ; `estFrais(null)` faux ; `libelleAge` « relevé d'hier » / « relevé aujourd'hui » / « il y a 23 jours » / « il y a 3 mois » / « jamais ».
- [ ] **Step 2 : Page, drawer, table, modale** — règles : badge « plus au catalogue » si `offres_actives = 0`, « sans catégorie » si `category IS NULL` ; filtre « sans offre fraîche » = aucune offre avec `estFrais(purchase_price_at)` ; édition désactivée si `!isOrgAdmin` (lecture possible) ; photo : liste des `image_url` des offres + téléversement (bucket `product-documents`, chemin `${orgId}/articles/${itemId}/`) ; sauvegarde via `updateItem`.
- [ ] **Step 3 : Build + lint** — `npx vite build` OK ; `npm run lint` sans nouveau warning.
- [ ] **Step 4 : Commit**

```bash
git add src/apps/artisan/pages/settings/catalogue src/lib/catalogue/ageDePrix.js scripts/catalogue/age-de-prix.test.mjs package.json src/apps/artisan/routes.jsx src/apps/artisan/pages/settings/SupplierManagement.jsx src/apps/artisan/pages/settings/ProductDetailDrawer.jsx
git commit -m "feat(catalogue): page Articles Majord'home et fiche article (offres, documents, rattacher / détacher)"
```

### Task 5 : Page « Harmoniser les bases » et edge `catalog-normalize` org-wide

**Files:**
- Create: `src/apps/artisan/pages/settings/catalogue/HarmonisationPage.jsx` (compteurs, boutons, onglets Proposées / Fusionnées / Refusées, « Tout fusionner », fusion manuelle)
- Create: `src/apps/artisan/pages/settings/catalogue/ProposalRow.jsx` (deux articles côte à côte, offres, écart, Fusionner / Refuser, « Garder l'autre comme survivant »)
- Modify: `supabase/functions/catalog-normalize/index.ts` (`supplier_id` optionnel ; sans lui, filtre org seulement ; en fin `catalog_item_proposals_propose` au lieu de `catalog_matches_propose`)
- Modify: `supabase/functions/supplier-catalog-sync/index.ts` (action `matches` → `catalog_item_proposals_propose(p_org_id)` ; le relevé cron appelle la même RPC après l'upsert)
- Modify: `src/apps/artisan/pages/settings/suppliers/CatalogConnectorPanel.jsx` (retrait des boutons Normaliser / Rapprocher et du lien Rapprochements)
- Modify: `src/apps/artisan/routes.jsx` (route `settings/suppliers/harmoniser`)
- Modify: `supabase/functions/catalog-normalize/normalize.test.ts` (inchangé sauf si une signature bouge)

**Interfaces:**
- Consumes : `useCatalogProposals`, `useCatalogItemMutations` (Task 3) ; `catalogItemsService.propose(orgId)` = `supabase.functions.invoke('supplier-catalog-sync', { body: { action: 'matches', org_id } })` ; `suppliersService.normalizeCatalog(orgId, null, limit)`.
- Produces : réponse de `catalog-normalize` inchangée (`{ traites, poses, restants, sans_cle_apres_ia, matches }`), `matches` = `{ fusionnes, proposes, nouvelles }`.

- [ ] **Step 1 : Edges** — `deno test` dans `supabase/functions` → verts ; déployer `catalog-normalize` et `supplier-catalog-sync` (`npx supabase functions deploy <name> --project-ref ejqqqwudmizqisdkxohw`, `--no-verify-jwt` pour `supplier-catalog-sync`) **après** la migration prod de Task 6.
- [ ] **Step 2 : Page** — compteurs depuis `majordhome_catalog_items_list` (articles actifs, à ≥ 2 offres, sans `model_key`, propositions `propose`) ; « Tout fusionner » = `decide(ids des proposées, 'fusionne')` avec `ConfirmDialog` ; fusion manuelle = deux recherches `searchItems` + `merge`.
- [ ] **Step 3 : Build + lint** ; **Step 4 : Commit**

```bash
git add src/apps/artisan/pages/settings/catalogue/HarmonisationPage.jsx src/apps/artisan/pages/settings/catalogue/ProposalRow.jsx supabase/functions/catalog-normalize/index.ts supabase/functions/supplier-catalog-sync/index.ts src/apps/artisan/pages/settings/suppliers/CatalogConnectorPanel.jsx src/apps/artisan/routes.jsx
git commit -m "feat(catalogue): page Harmoniser les bases (propositions de fusion, IA org-wide), edges sur les articles"
```

### Task 6 : Livraison tranche A

- [ ] **Step 1** : `npm run audit:quality` → `fail 0` ; `npx vite build` OK.
- [ ] **Step 2** : relever les compteurs prod (Task 2 Step 5, **avant**) ; appliquer `20261026_1` puis `20261026_2` (`node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw <fichier>`), inscrire les deux dans `supabase_migrations.schema_migrations` ; vérifier les compteurs **après** (15 fusions, 3 propositions, `count(catalog_items)` ≈ nombre de lignes actives distinctes, `anon` sans SELECT, `has_function_privilege('authenticated', 'public.catalog_items_ensure(uuid)', 'EXECUTE')` faux).
- [ ] **Step 3** : déployer les deux edges (Task 5 Step 1) ; appel réel `{action:'matches'}` impossible sans JWT → vérifier au cron de 04:00 UTC le lendemain (`catalog_sync_result.articles`).
- [ ] **Step 4** : push, Vercel READY ; mémoire + `.claude/proposed-updates.md` (entrée tranche 2 complétée : articles, matrice, harmonisation) ; message à Eric avec les gestes : page Articles, Harmoniser (3 propositions), Normaliser IA (premier appel réel).

---

## Tranche B — le devis

> **Recadrage d'Eric (spec § 9, 2026-10-24 soir)** : le devis ne choisit pas de fournisseur et la marge prend le prix
> d'achat le plus bas des offres. **Task 7 (meilleureOffre) est annulée**, Task 8 pose `purchase_price_ht =
> meilleur_prix_achat` et aucun champ fournisseur, Task 9 ne garde que la lecture seule des champs humains du drawer
> fournisseur (plus de menu Fournisseur sur la ligne). Review Focus 3 et 4 tombent avec Task 7 ; Review Focus 1, 2 et
> 5 restent couverts. Task 1 (amendement du même soir) : `catalog_items_ensure` ignore les lignes à prix nul ou
> offertes dans un pack.

### Task 7 : Règle « chez qui on achète » — module pur — **ANNULÉE (spec § 9)**

**Files:**
- Create: `src/lib/catalogue/meilleureOffre.js`
- Create: `scripts/catalogue/meilleure-offre.test.mjs` (ajouté à `audit:quality`)

**Interfaces:**
- Produces : `meilleureOffre(offres, { now, seuilJours = 30 })` → `{ retenue: Offre|null, raison: string, candidates: Offre[], ecartees: Array<{offre, motif}> }` ; `Offre = { product_id, supplier_id, supplier_name, supplier_auto_sync, reference, purchase_price_ht, purchase_price_at, stock_qty, en_stock, is_active }` (forme de la vue `majordhome_catalog_item_offers`) ; `offresParFournisseur(offres)` → une offre par fournisseur (la moins chère) ; `libelleRaison(retenue, candidates)` → « moins cher de 12 % chez Domos (relevé d'hier) » / « seule offre fraîche » / « à égalité, relevé automatique ». Réutilise `estFrais` / `libelleAge` de `ageDePrix.js`.

- [ ] **Step 1 : Tests (RED)** — cas : une seule offre fraîche → retenue ; deux fraîches 100 / 112 → la moins chère, raison « moins cher de 11 % » ; fraîche 120 et périmée 90 → la fraîche, la périmée dans `ecartees` motif `prix_perime` ; toutes périmées → `retenue = null`, raison « aucun prix de moins de 30 jours » ; `stock_qty = 0` → écartée `rupture`, `en_stock = false` idem, stock inconnu → candidate ; `purchase_price_ht` 0 ou NULL → écartée `sans_prix` (Review Focus 3) ; `is_active = false` → écartée ; égalité de prix → celle avec `supplier_auto_sync = true` ; `offresParFournisseur` : deux lignes du même fournisseur 50 / 45 → une seule à 45 (Review Focus 4).
- [ ] **Step 2** : Run `node --test scripts/catalogue/meilleure-offre.test.mjs` → FAIL (module absent). **Step 3** : implémenter. **Step 4** : PASS. **Step 5** : Commit

```bash
git add src/lib/catalogue/meilleureOffre.js scripts/catalogue/meilleure-offre.test.mjs package.json
git commit -m "feat(catalogue): règle pure de l'offre retenue (prix frais, en stock, le moins cher)"
```

### Task 8 : Picker article-first

**Files:**
- Rewrite: `src/apps/artisan/components/devis/DevisProductPicker.jsx` (recherche + filtres + liste d'articles + quantités ; < 350 lignes)
- Create: `src/apps/artisan/components/devis/PickerArticleRow.jsx` (photo, libellé, marque, prix de vente, offre retenue + raison, repli « toutes les offres »)
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx` (appel du picker inchangé : `onAddLines(lines, sectionTitle)` ; `sectionTitle` = libellé de la section courante)
- Modify: `src/shared/services/catalogItems.service.js` (`listItemsForPicker(orgId, { categories, search, brand, gamme, diametre, limit })` : `offres_actives > 0`, `is_active`, catégories ∈ `categories` quand non vide, sinon toutes **y compris NULL** avec badge « sans catégorie »)

**Interfaces:**
- Consumes : `meilleureOffre`, `offresParFournisseur` (Task 7) ; `useCatalogItemOffers` (Task 3) ; `categories` prop existante.
- Produces : ligne posée `{ line_type: 'product', catalog_item_id, supplier_product_id, supplier_id, supplier_name, designation: item.name, description: item.description, reference: offre.reference, quantity, unit: item.unit, purchase_price_ht: offre.purchase_price_ht, unit_price_ht: item.selling_price_ht, tva_rate: item.default_tva_rate, supplier_a_choisir: boolean }` ; sans offre retenue : `supplier_* = null`, `purchase_price_ht = null`, `supplier_a_choisir = true`.

- [ ] **Step 1** : service + picker + ligne. Les parcours Fournisseur → Gamme → Diamètre disparaissent du picker ; `diametre` reste un filtre quand la famille contient `fumisterie` (`getDistinctDiametres` existant, adapté à la vue liste).
- [ ] **Step 2** : `npx vite build` ; vérifier à la main dans un devis : poser une Powerwall → ligne avec BayWa retenu (prix frais) ; poser un article Soditelem → « fournisseur à choisir ».
- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/devis/DevisProductPicker.jsx src/apps/artisan/components/devis/PickerArticleRow.jsx src/apps/artisan/components/devis/DevisStepLines.jsx src/shared/services/catalogItems.service.js
git commit -m "feat(devis): picker par article Majord'home avec offre retenue"
```

### Task 9 : Menu fournisseur sur la ligne de devis ; drawer fournisseur en lecture seule sur les champs humains

**Files:**
- Create: `src/apps/artisan/components/devis/LineSupplierMenu.jsx` (liste des offres de l'article : fournisseur, prix, âge, stock ; sélection → met à jour `supplier_product_id`, `supplier_id`, `supplier_name`, `reference`, `purchase_price_ht`, `supplier_a_choisir=false`)
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx:45-60` (badge fournisseur cliquable quand `catalog_item_id` ; badge ambre « fournisseur à choisir » ; menu désactivé si le devis est verrouillé par son statut — même garde que les autres champs)
- Modify: `src/apps/artisan/pages/settings/ProductDetailDrawer.jsx` (libellé, marque, catégorie, gamme, nature, prix de vente en lecture seule avec lien « Modifier sur l'article Majord'home » ; specs / photo / variantes / compatibilités / documents / relevé inchangés)
- Modify: `src/apps/artisan/pages/settings/SupplierManagement.jsx:179-350` (`ProductFormModal` : mêmes champs en lecture seule quand le produit a un `catalog_item_id`)

- [ ] **Step 1** : implémenter ; `npx vite build` ; à la main : changer le fournisseur d'une ligne, la marge (`margeFournitures`) se recalcule.
- [ ] **Step 2 : Commit**

```bash
git add src/apps/artisan/components/devis/LineSupplierMenu.jsx src/apps/artisan/components/devis/DevisStepLines.jsx src/apps/artisan/pages/settings/ProductDetailDrawer.jsx src/apps/artisan/pages/settings/SupplierManagement.jsx
git commit -m "feat(devis): choix du fournisseur sur la ligne ; champs humains de la ligne fournisseur portés par l'article"
```

### Task 10 : Livraison tranche B

- [ ] `npm run audit:quality` → `fail 0` ; `npx vite build` OK ; push ; Vercel READY ; relecture indépendante de la branche (fable) ; passe de correction unique ; mémoire, `.claude/proposed-updates.md` ; message à Eric : gestes de test (un devis Batterie, un devis Photovoltaïque, un article Soditelem, le menu fournisseur).
