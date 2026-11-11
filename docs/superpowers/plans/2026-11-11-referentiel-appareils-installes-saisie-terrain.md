# Référentiel des appareils installés — saisie terrain : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une saisie d'équipement pas à pas (marque de référence → base locale → recherche web validée sur place) qui rattache l'équipement à une fiche du référentiel des appareils, et une file de contrôle org_admin (valider, corriger, fusionner).

**Architecture:** `majordhome.equipment_models` devient le référentiel (origine, état de contrôle, clé facultative vers l'article). Règles de saisie et lecture de la réponse IA dans des modules purs testés ; écritures par RPC SECURITY DEFINER (front : création depuis un article, contrôle, fusion) ou par une edge `equipment-model-enrich` + RPC service_role (fiche web). Écrans : sous-composants de `EquipmentFormModal`, carte du tableau de bord.

**Tech Stack:** React 18, TanStack Query v5, Supabase (PostgreSQL, Storage, Edge Functions Deno), API Anthropic (recherche web serveur), `node --test`, harnais `scripts/migration-rehearsal/`.

**Spec:** `docs/superpowers/specs/2026-11-11-referentiel-appareils-installes-saisie-terrain-design.md` (lire en entier avant la première tâche).

## Global Constraints

- Charte multi-tenant du `CLAUDE.md` : `org_id` filtré partout ; RPC SECURITY DEFINER = `REVOKE EXECUTE … FROM PUBLIC, anon` (+ `authenticated` si elle prend `org_id` dans son payload, alors service_role seul) ; garde positive `IF (autorisé) IS NOT TRUE THEN RAISE` ; `IF auth.uid() IS NULL THEN RAISE` en tête des RPC front ; `SET search_path = majordhome, public`.
- Nouvelle table `majordhome.*` : RLS + policies dès la création ; vue `public.majordhome_*` : `WITH (security_invoker = true)`, `REVOKE ALL … FROM PUBLIC, anon`, `GRANT SELECT … TO authenticated, service_role` ; `GRANT SELECT ON majordhome.<table> TO service_role` si lue par une vue.
- `CREATE OR REPLACE VIEW` n'ajoute de colonnes qu'EN FIN de liste.
- Aucune écriture front dans `equipment_models` (aucun INSERT/UPDATE accordé à `authenticated`).
- Migrations versionnées `supabase/migrations/2026111X_N_<sujet>.sql`, chacune répétée par `node scripts/migration-rehearsal/run.mjs --migration … --assert …` avant application ; nouvelles fonctions / tables / vues ajoutées aux listes de `scripts/migration-rehearsal/snapshot.mjs` (`FUNCTIONS`, `TABLES`, `VIEWS`, `POLICY_TABLES`).
- Mutations des hooks : `unwrapResult()` ; services : `{ data, error }` via `withErrorHandling` ; cache keys dans `cacheKeys.js` avec `orgId` en premier.
- Modules purs : aucun import React / Supabase / alias ; copiés pour Deno par `npm run sync:tournee-engine` quand une edge s'en sert ; JSDoc sur toute signature exportée (deno check).
- Composants < 500 lignes ; Tailwind ; `logger` au lieu de `console` côté front.
- Libellés écran en français, jamais « Mayer » ; marque de référence en MAJUSCULES.
- Rien n'est rattaché ni choisi d'office ; aucune recherche web sans clic ; une saisie n'est jamais bloquée.
- Ancienne saisie gardée : `equipments.metadata.saisie_origine = { brand, model, le: 'AAAA-MM-JJ', par }`, posée seulement si absente.
- Plafond de recherches web : 20 par utilisateur et par jour (`EQUIPMENT_ENRICH_DAILY_LIMIT` pour surcharger).
- Recherche web : même modèle que l'enrichissement d'article (`ANTHROPIC_ENRICH_MODEL`, défaut `claude-sonnet-5-5`), outils `web_search_20260209` + `web_fetch_20260209`.
- Fin de chaque tâche : `npm run lint`, `npx vite build` (si front touché), tests de la tâche ; fin du chantier : `npm run audit:quality`.
- Commit par chemins explicites, puis `git pull --rebase --autostash` et `git push` (sessions concurrentes sur `main`).

## Review Focus

1. **La relève Invicta suivante** ne doit ni désactiver une fiche web Invicta ni rattacher d'office sur elle → assertion dans la Tâche 3.
2. **Deux intervenants valident le même appareil web** (même marque, même référence fabricant) → une seule fiche, la seconde validation rattache à la première et le dit → assertion Tâche 4, test Tâche 6.
3. **Formulaire abandonné après validation d'une fiche web** → la fiche reste `a_controler`, « Installée chez : aucun client » dans la file, fusionnable → test Tâche 8.
4. **Recherche web en échec** (délai, réponse illisible, plafond atteint, refus) → message clair, la saisie reste et s'enregistre sans rattachement → test Tâche 7.
5. **Fusion vers une fiche fabricant, ou d'une fiche fabricant** : la fiche fabricant survit toujours ; fusionner une fiche fabricant dans une fiche web est refusé → assertion Tâche 4.

---

### Task 1: Règles pures de la saisie d'appareil

**Files:**
- Create: `src/lib/equipements/saisieAppareil.js`
- Test: `scripts/equipements/saisie-appareil.test.mjs`
- Modify: `package.json` (ajouter le test à `audit:quality`)

**Interfaces:**
- Consumes: `cle(texte)` et `classerModeles(modeles, equipement)` de `src/lib/catalogue/nomenclature.js`.
- Produces:
  - `marqueDeReference(saisie: string, marques: Array<{ name: string, brand_key: string }>): { name: string, exacte: boolean } | null` — même clé ⇒ `exacte: true` ; sinon une seule marque à distance d'édition ≤ 1 sur des clés de 6 caractères ou plus ⇒ `exacte: false` ; sinon `null`.
  - `classerAppareils(fiches: object[], saisie: { model?: string, equipmentTypeId?: string }): object[]` — exclut `merged_into` non nul, classe par `classerModeles`, à score égal les fiches du même `equipment_type_id` d'abord, ne garde que les scores > 0.
  - `classerArticles(articles: object[], saisie: { model?: string }): object[]` — articles dont le nom ou le code contient la clé du modèle saisi (≥ 3 caractères), dans l'ordre du score de `classerModeles` appliqué à `{ model_name: name, reference: code }`.
  - `saisieOrigine(equipement: { brand?: string|null, model?: string|null }, par: string, le: string): object`.
  - `champsRattachement(fiche: object): { brand: string, model: string, equipmentModelId: string, supplierProductId: string|null }` — `brand` = `fiche.brand` en majuscules, `model` = `fiche.model_name`, `supplierProductId` = `fiche.catalog_source_product_id ?? null`.

- [ ] **Step 1: Write the failing tests**

```js
test('marqueDeReference : clé identique, faute d\'une lettre, rien', () => {
  const M = [{ name: 'JOLLY MEC', brand_key: 'jollymec' }, { name: 'EDILKAMIN', brand_key: 'edilkamin' }, { name: 'MCZ', brand_key: 'mcz' }];
  assert.deepEqual(marqueDeReference('Jollymec ', M), { name: 'JOLLY MEC', exacte: true });
  assert.deepEqual(marqueDeReference('Efilkamin', M), { name: 'EDILKAMIN', exacte: false });
  assert.equal(marqueDeReference('MZC', M), null); // clé < 6 : pas de rapprochement approché
  assert.equal(marqueDeReference('', M), null);
});
test('classerAppareils : fusionnées exclues, même type en tête, scores nuls retirés', () => { /* fiches LODI 10 (type A), LODI 10 (type B), absorbée, OXANA ; saisie { model: 'lodi 10', equipmentTypeId: 'B' } → [LODI 10 type B, LODI 10 type A] */ });
test('classerArticles : nom ou code, au moins 3 caractères', () => { /* 'ar' → [] ; 'aratos' → l'article ARATOS */ });
test('champsRattachement et saisieOrigine', () => {
  assert.deepEqual(champsRattachement({ id: 'm1', brand: 'Invicta', model_name: 'ARATOS', catalog_source_product_id: 'sp1' }),
    { brand: 'INVICTA', model: 'ARATOS', equipmentModelId: 'm1', supplierProductId: 'sp1' });
  assert.deepEqual(saisieOrigine({ brand: 'invicta', model: 'aratos 8' }, 'saisie terrain', '2026-11-12'),
    { brand: 'invicta', model: 'aratos 8', le: '2026-11-12', par: 'saisie terrain' });
});
```

- [ ] **Step 2: Run** `node --test scripts/equipements/saisie-appareil.test.mjs` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement the five functions** in `src/lib/equipements/saisieAppareil.js` (distance d'édition : Levenshtein borné, écrite dans le module).
- [ ] **Step 4: Run** the test — Expected: PASS ; ajouter le fichier à `audit:quality` dans `package.json`.
- [ ] **Step 5: Commit** `src/lib/equipements/saisieAppareil.js scripts/equipements/saisie-appareil.test.mjs package.json` — `feat(equipements): règles pures de la saisie d'appareil`.

### Task 2: Prompt et lecture de la recherche web d'un appareil

**Files:**
- Create: `src/lib/catalogue/enrichissementAppareil.js`
- Modify: `scripts/sync-tournee-engine.mjs` (ajouter `'enrichissementAppareil'` à `CATALOGUE`), `package.json`
- Test: `scripts/catalogue/enrichissement-appareil.test.mjs`

**Interfaces:**
- Consumes: `urlPublique`, `champsDuSchema` de `./enrichissement.js` (même dossier, importé en `./enrichissement.js` pour rester copiable).
- Produces:
  - `construirePromptAppareil(saisie: { brand: string, model: string, typeLabel?: string|null }, champs: Champ[]): string` — demande jusqu'à 3 appareils candidats si la saisie est ambiguë (tailles, coloris, générations), chacun avec `brand`, `model_name`, `reference` (référence fabricant), `category`, `en_vente` (bool|null), `photo_url`, `notice_url`, `fiche_url`, `source_urls` (≤ 3), `specs`, `remarque` ; « n'invente rien, null sinon » ; JSON final `{ "appareils": [ … ] }`.
  - `lireAppareils(texte: string, champs: Champ[]): { erreur?: 'reponse_illisible'|'aucun_appareil', appareils: Array<{ brand: string, model_name: string, reference: string|null, category: string|null, en_vente: boolean|null, photo_url: string|null, notice_url: string|null, fiche_url: string|null, source_urls: string[], specs: object, remarque: string|null }> }` — ne lève jamais ; URL non publiques ⇒ null ; textes bornés à 200 caractères ; appareil sans `brand` ou sans `model_name` écarté ; au plus 3.

- [ ] **Step 1: Write the failing tests** — `lireAppareils` : JSON en bloc ```json```, deux candidats ; URL `http://127.0.0.1/x.jpg` → `photo_url: null` ; texte sans JSON → `erreur: 'reponse_illisible'` ; `{ "appareils": [] }` → `erreur: 'aucun_appareil'` ; 5 candidats → 3 ; `construirePromptAppareil` contient la marque, le modèle et chaque clé de champ.
- [ ] **Step 2: Run** `node --test scripts/catalogue/enrichissement-appareil.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** (réutiliser la stratégie `extraireJson` d'`enrichissement.js` : l'exporter de ce module plutôt que la recopier, avec JSDoc).
- [ ] **Step 4: Run** the test, then `npm run sync:tournee-engine` and `node --test scripts/tournee/sync-engine.test.mjs` — Expected: PASS, `supabase/functions/_shared/catalogue/enrichissementAppareil.js` créé.
- [ ] **Step 5: Commit** les deux modules, la copie `_shared`, le test, `scripts/sync-tournee-engine.mjs`, `package.json` — `feat(catalogue): lecture de la recherche web d'un appareil`.

### Task 3: Base — le référentiel, les marques, la relève fabricant limitée

**Files:**
- Create: `supabase/migrations/20261112_4_referentiel_appareils.sql` (numéro suivant disponible le jour J), `scripts/migration-rehearsal/assert-referentiel-appareils.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs`

**Interfaces:**
- Produces (base) :
  - `equipment_models` + colonnes `origin text NOT NULL DEFAULT 'releve_fabricant' CHECK (origin IN ('releve_fabricant','web','catalogue'))`, `review_status text NOT NULL DEFAULT 'controle' CHECK (review_status IN ('controle','a_controler'))`, `catalog_item_id uuid` (même org, trigger comme `equipments_check_model_org`), `equipment_type_id uuid` (même org), `specs jsonb NOT NULL DEFAULT '{}'`, `source_urls jsonb NOT NULL DEFAULT '[]'`, `created_by uuid`, `reviewed_by uuid`, `reviewed_at timestamptz`, `merged_into uuid REFERENCES majordhome.equipment_models(id)`. Index partiel `(org_id, review_status) WHERE review_status = 'a_controler'`.
  - `majordhome.equipment_brand_refs (id, org_id, name, brand_key, created_at)`, unique `(org_id, brand_key)`, clé par `equipment_model_key(name)` (trigger), RLS lecture membres, aucune écriture `authenticated`. Amorçage : marques distinctes non vides des équipements de l'org (`project_org_id`), des fiches et des articles actifs, en MAJUSCULES, une par clé (la plus fréquente gagne).
  - Fonction interne `majordhome.equipment_brand_ref_ensure(p_org_id uuid, p_brand text) RETURNS text` (renvoie l'écriture de référence ; crée la ligne si absente) — `REVOKE … FROM PUBLIC, anon, authenticated`.
  - `public.equipment_models_close` réécrite : désactivation ET rattachement d'office limités à `em.origin = 'releve_fabricant'`.
  - Vue `public.majordhome_equipment_models` : colonnes ajoutées en fin (`origin, review_status, catalog_item_id, equipment_type_id, specs, source_urls, created_by, reviewed_by, reviewed_at, merged_into`, plus `catalog_source_product_id` = `catalog_items.source_product_id` par sous-requête scalaire).
  - Vue `public.majordhome_equipment_brand_refs (id, org_id, name, brand_key)`.

- [ ] **Step 1: Write the assertions** (`assert-referentiel-appareils.sql`, blocs `DO $$ … RAISE EXCEPTION`) : (0) droits — `authenticated` sans INSERT/UPDATE sur `equipment_models` et `equipment_brand_refs`, `anon` sans SELECT sur les deux vues, `equipment_brand_ref_ensure` non exécutable par `authenticated` ; (1) les 470 fiches existantes sont `releve_fabricant` / `controle` ; (2) relève : une fiche `web` Invicta hors version reste active après `equipment_models_close`, et un équipement dont le modèle saisi est sa référence n'y est pas rattaché d'office ; (3) amorçage : `JOLLY MEC` présent une fois, aucune clé en double ; (4) un `catalog_item_id` d'une autre org est refusé.
- [ ] **Step 2: Run** `node scripts/migration-rehearsal/snapshot.mjs --env .env.local` puis `node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-referentiel-appareils.sql` — Expected: FAIL (colonnes absentes).
- [ ] **Step 3: Write the migration** ; étendre les listes de `snapshot.mjs` (nouvelle table, vue, fonction ; la chaîne de rejeu doit inclure `20261111_1` et `_3/_4` pour les fonctions recréées).
- [ ] **Step 4: Run** `run.mjs --migration supabase/migrations/20261112_4_referentiel_appareils.sql --assert …` — Expected: PASS. Puis `node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-baseline.sql` (§1 mis à jour si les listes changent).
- [ ] **Step 5: Commit** migration, assertions, `snapshot.mjs` (et `assert-baseline.sql` si touché) — `feat(equipements): référentiel des appareils installés (base)`. **Ne pas appliquer en prod avant la Tâche 4** (appliquées ensemble).

### Task 4: Base — créer, contrôler, fusionner, plafond de recherches

**Files:**
- Create: `supabase/migrations/20261112_5_referentiel_appareils_rpc.sql`, `scripts/migration-rehearsal/assert-referentiel-appareils-rpc.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs`

**Interfaces:**
- Consumes: Tâche 3 (colonnes, `equipment_brand_ref_ensure`).
- Produces (toutes `SECURITY DEFINER`, `SET search_path = majordhome, public`) :
  - `public.equipment_model_create_from_catalog(p_catalog_item_id uuid) RETURNS jsonb` — authenticated ; `auth.uid()` NULL ⇒ refus ; org = celle de l'article ; `user_can(org,'clients','edit') IS NOT TRUE` ⇒ `RAISE 'clients_edit_required'` ; fiche existante portant ce `catalog_item_id` (non fusionnée) ⇒ la renvoie ; sinon crée `origin='catalogue'`, `review_status='controle'`, `source_id='catalogue:'||id article`, `reference` = code de l'article sinon son nom, `model_name`/`name` = nom, `brand` = `equipment_brand_ref_ensure`, `specs` = `specs->'canonical'`. Retour `{ model_id, created bool }`.
  - `public.equipment_model_create_from_web(p_org_id uuid, p_user_id uuid, p_fiche jsonb, p_files jsonb) RETURNS jsonb` — service_role SEUL ; si une fiche active non fusionnée de l'org a même `brand_key` et même `reference_key` (référence non vide) ⇒ la renvoie `{ model_id, created:false, existante:true }` sans rien écrire ; sinon crée `origin='web'`, `review_status='a_controler'`, `source_id='web:'||gen_random_uuid()`, `photo_path`, documents `equipment_documents` (`equipment_model_id`, `source = { origine:'web', url }`, types `notice` / `fiche_technique`) depuis `p_files = { photo_path, documents:[{ storage_path, document_type, label, file_name, file_size }] }` ; chemins hors `${org}/equipment-models/web/` refusés.
  - `public.equipment_model_review(p_model_id uuid, p_patch jsonb) RETURNS jsonb` — org_admin ; refuse une fiche `releve_fabricant` (`fiche_fabricant`) ou fusionnée ; champs du patch acceptés : `brand, model_name, name, reference, equipment_type_id, catalog_item_id, specs, retirer_photo (bool), documents_retires (uuid[])` ; pose `review_status='controle'`, `reviewed_by/at`. Patch vide = valider. Documents retirés : lignes supprimées (objets Storage laissés, chemin unique à la fiche).
  - `public.equipment_model_merge(p_absorbed_id uuid, p_survivor_id uuid) RETURNS jsonb` — org_admin, même org, ids distincts, aucune des deux fusionnée ; refus si l'absorbée est `releve_fabricant` (`fiche_fabricant_survit`) ; équipements re-pointés (`equipment_model_id`), documents de l'absorbée re-pointés sauf `storage_path` déjà présent sur la survivante (supprimés alors), absorbée : `merged_into`, `is_active=false`, `review_status='controle'`. Retour `{ equipements, documents }`.
  - `majordhome.equipment_enrich_quotas (user_id, org_id, date, count, last_at)` PK `(user_id, org_id, date)`, RLS sans policy, et `public.increment_equipment_enrich_quota(p_user_id uuid, p_org_id uuid, p_daily_limit int DEFAULT 20) RETURNS int` service_role seul, `RAISE 'equipment_enrich_quota_exceeded' USING ERRCODE='P0001'` au-delà (modèle : `increment_voice_quota`).
  - Vue `public.majordhome_equipment_models_a_controler` (security_invoker) : fiches `a_controler` non fusionnées + `nb_equipements` + `clients` (jsonb `[{ client_id, client_number, display_name }]`, 10 au plus) + `created_by_name`.

- [ ] **Step 1: Write the assertions** : droits (`anon` n'exécute rien ; `authenticated` n'exécute ni `create_from_web` ni `increment_equipment_enrich_quota` ; exécute les trois autres) ; un technicien (impersonation `request.jwt.claim.sub`) crée depuis un article et rejoue ⇒ même `model_id` ; `create_from_web` deux fois même marque + référence ⇒ une fiche ; chemin d'une autre org refusé ; `review` par un non-admin ⇒ refus, par l'admin ⇒ `controle` ; `review` d'une fiche fabricant ⇒ `fiche_fabricant` ; `merge` web → fabricant re-pointe 2 équipements ; `merge` fabricant → web ⇒ `fiche_fabricant_survit` ; quota : 21ᵉ appel ⇒ `P0001`.
- [ ] **Step 2: Run** `run.mjs --migration …_4… --migration …_5… --assert assert-referentiel-appareils-rpc.sql` — Expected: FAIL.
- [ ] **Step 3: Write the migration** (garde positive partout ; `has_function_privilege` mesuré par l'assertion, pas relu).
- [ ] **Step 4: Run** the same command — Expected: PASS ; puis les assertions de la Tâche 3 rejouées dans la même chaîne — PASS.
- [ ] **Step 5: Apply in prod** `20261112_4` puis `_5` (`apply_migration`, projet `ejqqqwudmizqisdkxohw`), puis vérifier : `SELECT origin, review_status, count(*) FROM majordhome.equipment_models GROUP BY 1,2` → `releve_fabricant | controle | 470` ; `has_function_privilege('anon', 'public.equipment_model_review(uuid, jsonb)', 'EXECUTE')` → false ; `node scripts/permissions-coherence.mjs --env .env.local` → vert.
- [ ] **Step 6: Commit** migration, assertions, `snapshot.mjs` — `feat(equipements): création, contrôle et fusion des fiches d'appareil`.

### Task 5: Services et hooks

**Files:**
- Modify: `src/shared/services/equipmentModels.service.js`, `src/shared/services/equipments.service.js`, `src/shared/hooks/useEquipmentModels.js`, `src/shared/hooks/cacheKeys.js`

**Interfaces:**
- Consumes: Tâches 1, 3, 4.
- Produces:
  - `equipmentModelsService.listBrandRefs(orgId) → { data: Array<{ name, brand_key }> }`
  - `equipmentModelsService.listForBrand` : exclut `merged_into` non nul (filtre `.is('merged_into', null)`).
  - `equipmentModelsService.searchArticles(orgId, brand, model) → { data: object[] }` — `majordhome_catalog_items_list` filtré par marque (`ilike` via `escapePostgrestSearchTerm`) et `recherche`, 30 au plus.
  - `equipmentModelsService.createFromCatalog(catalogItemId) → { data: { model_id, created } }`
  - `equipmentModelsService.searchWeb(orgId, { brand, model, equipmentTypeId }) → { data: { appareils, photo_refus?, ... } }` et `createFromWeb(orgId, appareil) → { data: { model_id, created, existante, avertissements: string[] } }` (edge, Tâche 6).
  - `equipmentModelsService.listToReview(orgId)`, `review(modelId, patch)`, `merge(absorbedId, survivorId)`.
  - `equipmentModelsService.setEquipmentModel(equipmentId, modelId)` garde sa signature mais devient le rattachement complet : relit la fiche (`brand`, `model_name`, `catalog_source_product_id`) et le `metadata` de l'équipement, puis écrit `equipment_model_id`, `brand`/`model` (`champsRattachement`), `supplier_product_id` seulement si la fiche en porte un, et `metadata.saisie_origine` si absente (`saisieOrigine(…, 'rattachement', date du jour)`) ; `modelId = null` = détacher sans toucher marque ni modèle. Le bloc « Pièces détachées » (choix du modèle fabricant) en profite sans changement d'écran.
  - `equipmentsService.createEquipment` / `updateEquipment` acceptent `equipmentModelId` et `saisieOrigine` (fusion dans `metadata`).
  - Cache keys : `equipmentModelKeys.brandRefs(orgId)`, `.articles(orgId, brandKey, modelKey)`, `.toReview(orgId)`.
  - Hooks : `useBrandRefs()`, `useArticlesForEquipment(brand, model, enabled)`, `useEquipmentEnrichment()` → `{ searchWeb, createFromWeb, createFromCatalog, isSearching, isCreating }`, `useModelsToReview()`, `useModelReview()` → `{ review, merge, isSaving }` ; `useSetEquipmentModel` garde son nom mais appelle `attachEquipment`. Invalidation : `equipmentModelKeys.all(orgId)`, `clientKeys.all(orgId)`, `equipmentDocumentKeys.all(orgId)`.

- [ ] **Step 1: Implement** the service methods and hooks above (pas de test unitaire : ces fichiers ne sont pas purs ; leur logique de décision est dans la Tâche 1).
- [ ] **Step 2: Verify** `npm run lint` et `npx vite build` — Expected: 0 erreur, 0 nouvel avertissement ; le contrôle `grep -rnE "mutationFn: .*=> *[a-zA-Z]+Service\.[a-zA-Z]+\(" src/shared/hooks | grep -v "unwrap("` ne remonte que `useGoogleCalendar`.
- [ ] **Step 3: Commit** les quatre fichiers — `feat(equipements): services et hooks du référentiel des appareils`.

### Task 6: Edge `equipment-model-enrich`

**Files:**
- Create: `supabase/functions/equipment-model-enrich/index.ts`, `supabase/functions/_shared/telechargement.ts`
- Modify: `supabase/functions/catalog-item-enrich/index.ts` (importe `telecharger`, `verifierPhoto`, `verifierFiche` du module partagé ; comportement inchangé), `supabase/config.toml` (`verify_jwt = true`)

**Interfaces:**
- Consumes: Tâche 2 (`construirePromptAppareil`, `lireAppareils`), Tâche 4 (`equipment_model_create_from_web`, `increment_equipment_enrich_quota`), `requireOrgMembership`, `user_can`.
- Produces: `POST` `{ action: 'chercher', org_id, brand, model, equipment_type_id? , champs }` → `{ ok, appareils: [{ …, photo_refus, notice_refus, fiche_refus }] }` ; `{ action: 'creer', org_id, appareil }` → `{ ok, model_id, created, existante, avertissements }`. Erreurs : 400 entrée, 403 `clients.edit`, 429 `quota`, 504 délai, 502 réponse illisible, 422 refus du modèle.
- `_shared/telechargement.ts` exporte `telecharger(url, max, echeance, apercu?)`, `verifierPhoto(url, echeance)`, `verifierFiche(url, echeance)` et les constantes `PHOTO_MAX`, `PDF_MAX`, `TYPES_IMAGE` (déplacés tels quels depuis `catalog-item-enrich`, avec `verifierDns`).

- [ ] **Step 1: Extract** `_shared/telechargement.ts` ; `catalog-item-enrich` l'importe ; `deno check supabase/functions/catalog-item-enrich/index.ts` — Expected: OK.
- [ ] **Step 2: Implement** `equipment-model-enrich` : `requireOrgMembership` puis `user_can(org,'clients','edit')` (garde positive) ; `chercher` : quota AVANT l'appel IA, mêmes outils, reprises `pause_turn` et échéances que `catalog-item-enrich`, conso journalisée, chaque URL vérifiée ; `creer` : relit la fiche reçue avec `lireAppareils` (rien n'est cru sur parole), télécharge photo et PDF vers `product-documents/${org}/equipment-models/web/${uuid}.<ext>` (client service_role), appelle `equipment_model_create_from_web` avec `p_user_id = auth.userId` ; si la RPC échoue, supprime les objets déposés ; un fichier refusé ⇒ avertissement, la fiche se crée quand même ; si la RPC renvoie `existante`, supprime les objets déposés.
- [ ] **Step 3: Verify** `deno check supabase/functions/equipment-model-enrich/index.ts` — Expected: OK.
- [ ] **Step 4: Deploy** `equipment-model-enrich` puis `catalog-item-enrich` (fichiers `../_shared/…` nommés comme tels) ; appel réel `chercher` sur `{ brand: 'EDILKAMIN', model: 'Kelly' }` avec le jeton d'un membre — Expected: 200, au moins un appareil ; un appel sans jeton → 401.
- [ ] **Step 5: Commit** les trois fichiers et `config.toml` — `feat(equipements): recherche web d'un appareil (edge)`.

### Task 7: Saisie pas à pas dans « Ajouter un équipement »

**Files:**
- Create: `src/apps/artisan/components/clients/saisieAppareil/MarqueReference.jsx`, `.../VerifierAppareil.jsx`, `.../AppareilWebCarte.jsx`, `.../AppareilRattache.jsx`
- Modify: `src/apps/artisan/components/clients/EquipmentFormModal.jsx`, `src/apps/artisan/pages/client-detail/TabEquipments.jsx` (transmet `equipmentModelId` et `saisieOrigine` au service)

**Interfaces:**
- Consumes: Tâches 1 et 5.
- Produces (props) :
  - `MarqueReference({ saisie, marques, onAccept(name) })` — sous le champ marque : « Écrire JOLLY MEC ? » (ou « Vouliez-vous dire EDILKAMIN ? » si non exacte) ; rien si la saisie est déjà l'écriture de référence.
  - `VerifierAppareil({ brand, model, equipmentTypeId, onChoisir(fiche) })` — bouton « Vérifier » ; groupes « Appareils connus » / « Articles du catalogue » ; « Rien ne correspond — chercher sur le web » ; « Aucun de ceux-là » ferme le panneau ; rien de présélectionné.
  - `AppareilWebCarte({ appareil, onValider(appareilCorrige) })` — photo, nom, référence, caractéristiques, liens sources ; nom et référence modifiables avant « C'est cet appareil ».
  - `AppareilRattache({ fiche, onChanger, onRetirer })` — vignette de la fiche rattachée dans le formulaire.
- `EquipmentFormModal` : le parcours s'affiche en ajout ET en modification d'un équipement sans `equipment_model_id` (un équipement déjà rattaché montre `AppareilRattache`) ; état `equipmentModelId` + `fiche` ; une fiche web est créée dès « C'est cet appareil » (l'équipement n'existe pas encore en ajout) et l'équipement l'enregistre à la validation du formulaire ; au choix d'une fiche, marque et modèle prennent `champsRattachement(fiche)` et `saisieOrigine` mémorise la saisie d'avant ; `onSubmit` reçoit `equipmentModelId`, `saisieOrigine` et `supplierProductId`. Le fichier reste < 500 lignes (logique dans les sous-composants).

- [ ] **Step 1: Implement** les quatre composants et l'intégration ; messages : « Recherche dans la base… », « Recherche web : 20 à 60 secondes », plafond (« 20 recherches par jour atteintes : enregistrez l'appareil tel quel »), échec (« La recherche n'a pas abouti : enregistrez l'appareil tel quel, il pourra être rattaché plus tard »), fiche déjà existante (« Cet appareil existait déjà dans la base : il y est rattaché »).
- [ ] **Step 2: Verify** `npm run lint`, `npx vite build` — Expected: verts ; `wc -l` de `EquipmentFormModal.jsx` < 500.
- [ ] **Step 3: Verify in the app (Eric, sur son serveur)** : ajout « jollymec » → proposition « JOLLY MEC » ; « INVICTA / aratos » → Vérifier propose ARATOS ; « EDILKAMIN / Kelly » → recherche web → validation → l'équipement enregistré montre la fiche ; coupure réseau pendant la recherche → message, enregistrement possible.
- [ ] **Step 4: Commit** les fichiers — `feat(equipements): saisie d'appareil pas à pas`.

### Task 8: File de contrôle dans le tableau de bord

**Files:**
- Create: `src/apps/artisan/components/dashboard/AppareilsAControler.jsx`, `src/apps/artisan/components/dashboard/AppareilAControlerFiche.jsx`
- Modify: `src/apps/artisan/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: Tâche 5 (`useModelsToReview`, `useModelReview`), `EquipmentDocumentViewer` (documents), recherche de fiches par `useEquipmentModelsForBrand`.
- Produces: carte « Appareils à contrôler (N) » visible `isOrgAdmin` et seulement si N > 0, placée avec les cartes Pennylane ; liste → fiche : photo, champs, caractéristiques, documents (visionneuse), pages sources, créée par / le, « Installée chez » (liens vers les fiches client, « aucun client » si 0) ; actions **Valider**, **Corriger** (formulaire des champs du patch de la Tâche 4, type d'équipement, article lié), **Fusionner avec…** (recherche d'une fiche de la même marque, `ConfirmDialog` annonçant le nombre d'équipements déplacés).

- [ ] **Step 1: Implement** les deux composants et l'insertion ; toasts d'erreur avec le code RPC traduit (`fiche_fabricant`, `fiche_fabricant_survit`).
- [ ] **Step 2: Verify** `npm run lint`, `npx vite build` — Expected: verts.
- [ ] **Step 3: Verify in the app (Eric)** : la fiche web de la Tâche 7 apparaît ; Corriger le nom puis Valider la retire de la file ; une fiche abandonnée (« aucun client ») se fusionne dans une autre.
- [ ] **Step 4: Commit** — `feat(equipements): file de contrôle des appareils créés sur le terrain`.

### Task 9: Documentation et clôture

**Files:**
- Modify: `CLAUDE.md` (Module Catalogue fournisseur → puce « Référentiel des appareils installés » : origines, états, RPC, edge, plafond, `equipment_models_close` limitée, `saisie_origine`), `docs/DATABASE.md` (table, colonnes, vues)

- [ ] **Step 1: Write** les deux sections (règles qui mordent uniquement).
- [ ] **Step 2: Run** `npm run audit:quality` — Expected: tous les tests verts, aucun fichier orphelin, registre OK.
- [ ] **Step 3: Commit**, `git pull --rebase --autostash`, `git push` ; suivre le déploiement Vercel jusqu'à READY.
