# Base de pièces — catalogues des marchands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relever chaque nuit le catalogue de pièces détachées d'un marchand qui a donné son accord (Energies Bois Distribution d'abord) et, dans la fenêtre « Trouver une pièce », afficher tout de suite les pièces dont la fiche cite l'appareil, avant toute recherche web.

**Architecture:** La chaîne de relevé existante (fournisseur connecté `woocommerce` → edge `supplier-catalog-sync` → écrivain unique `supplier_pieces_upsert`) reçoit un mode « boutique publique, catalogue de pièces ». Une vue de lecture expose les lignes relevées avec un champ de recherche ; un classement pur côté écran sépare « citées pour ce modèle » et « même marque ». Hermes reste le second recours, sur clic.

**Tech Stack:** React 18 + TanStack Query v5, Supabase (Postgres, Edge Functions Deno, pg_cron existant), modules purs `src/lib/catalogue/*` copiés pour Deno par `npm run sync:tournee-engine`.

**Spec:** `docs/superpowers/specs/2026-11-12-base-pieces-catalogues-marchands-design.md` — à lire avec ce plan. Règles du dépôt : `CLAUDE.md`, sections « Module Catalogue fournisseur », « Module Assistant pièces », « Multi-tenant & sécurité ».

## Global Constraints

- Aucun relevé d'un marchand sans son accord : en mode public, l'edge refuse (`accord_absent`) tant que `connector_config.accord` ne porte pas un contact et une date. Seul Energies Bois Distribution (`https://energies-bois-distribution.com`) a donné son accord.
- Politesse : un relevé par nuit au plus (cron existant de 04:00 UTC) ou sur clic d'un org_admin ; 400 ms de pause entre deux pages ; jamais de relevé déclenché par la consultation d'une fiche ; l'en-tête d'identification nomme Majord'home.
- Seuls les rayons « Pièces détachées … » et leurs sous-rayons sont relevés ; conduits, poêles et accessoires ne le sont pas.
- Écrivain unique : `public.supplier_pieces_upsert`, **un seul appel par relevé**, marque de relevé `CATALOGUE`. Jamais `supplier_catalog_upsert` en direct, jamais d'écriture front sur `supplier_products` pour un relevé.
- Prix : le flux donne le prix public **TTC** ; `specs.canonical.prix_public_ttc` = ce prix, `tarif_public` = TTC ÷ 1,2 (arrondi au centime), `purchase_price_ht` = `tarif_public` × (1 − `connector_config.pieces.remise_pct` ÷ 100), remise 0 par défaut, TVA 20.
- La vue de recherche n'expose ni prix d'achat ni remise. Vue `WITH (security_invoker=true)`, `REVOKE ALL … FROM PUBLIC, anon`, filtre `org_id` explicite côté front.
- « Cité pour ce modèle » seulement si les mots utiles du modèle figurent dans la fiche à mots entiers, à la suite et dans l'ordre ; sinon « même marque, modèle non cité ». La date du relevé est toujours affichée avec le prix et le stock.
- Ne rien dégrader : relevés Domos et BayWa, pièces Invicta, chapitres « équipement » des devis inchangés. Les modules copiés pour Deno ne s'éditent jamais dans `_shared/`.
- Charte du dépôt : `{ data, error }` dans les services, `unwrapResult` dans les mutations, clés de cache centralisées (`orgId` en premier), composants < 500 lignes, logique dans `src/lib`, RPC à `org_id` en paramètre = `service_role` seul, garde positive (`IS NOT TRUE`).
- **Arrêts obligatoires (accord d'Eric)** : toute migration en production, tout déploiement d'edge, la création du fournisseur et le premier relevé réel (tâche 7).

## Review Focus

1. Modèle écrit autrement par le marchand (« Globe-Globe Airtight », « Globe / Globe Airtight », « GLOBE AT ») → les deux premières formes donnent « cité », la troisième tombe sous « même marque » sans erreur (test tâche 4).
2. Appareil sans modèle, ou modèle d'un seul mot générique (« One », « Evo ») → jamais « cité » sur ce seul mot ; le bloc dit pourquoi (test tâche 4).
3. Relevé incomplet ou flux en panne à la troisième page → rien n'est écrit, l'erreur est visible sur la fiche fournisseur, la base garde le relevé précédent (test tâche 2, assertion tâche 3).
4. Pièce disparue du catalogue au relevé suivant → désactivée, absente de la recherche ; les autres fournisseurs et les pièces Invicta intacts (assertion tâche 3).
5. Description HTML piégée ou énorme (balises, scripts, 50 000 caractères) → texte nettoyé et borné à 20 000 caractères, jamais interprété à l'écran (test tâche 1, rendu tâche 5).

---

### Task 1: Extrait réel du flux et adaptateur de pièces

**Files:** Create `scripts/catalogue/data/ebd-pieces-2026-11.json`, `src/lib/catalogue/woocommercePieces.js`, `scripts/catalogue/woocommerce-pieces.test.mjs` · Modify `scripts/sync-tournee-engine.mjs` (liste `CATALOGUE` : ajouter `woocommercePieces`), `package.json` (test ajouté à `audit:quality`).

**Produces** (module pur, sans import, JSDoc sur chaque export) :

```js
export const MARQUE_RELEVE = 'CATALOGUE';
export const DESCRIPTION_MAX = 20000;
export function texteDepuisHtml(html)                       // → string : balises et scripts retirés, entités décodées, espaces réduits, borné à DESCRIPTION_MAX
export function rayonsDePieces(categories)                  // → Set d'ids : rayons dont le nom normalisé commence par « pieces detachees », et tous leurs descendants
export function marqueDeLaFiche(item, categoriesParId)      // → string MAJUSCULES : brands[0].name, sinon reste d'un rayon « Pièces détachées X », sinon 'DIVERS'
export function piecesDepuisReleveWoocommerce(releve, { version, remisePct = 0, releveLe })
//   → { lignes: Ligne[], compte: { retenues, variantes, sans_prix, sans_reference, hors_rayon }, rayons: string[] }
//   lève Error('releve_incomplet') si items.length < total ou si aucune ligne retenue ; Error('reference_en_double')
```

`releve` = `{ total, fetched_at, items[], categories[] }` comme l'adaptateur existant (`src/lib/catalogue/woocommerce.js`), avec en plus `description` et `brands` sur chaque item. `Ligne` = forme attendue par `supplier_pieces_upsert` (lire `supabase/migrations/20261111_2_pieces_detachees_relecture.sql` et un appelant existant, `scripts/catalogue/import-invicta-pieces.mjs`), avec : `reference` = sku, `name`, `brand`, `category: 'piece_detachee'`, `tarif_public`, `purchase_price_ht`, `taux_remise`, `default_tva_rate: 20`, `unit: 'pièce'`, `image_url`, `image_source_url` = permalien, et `specs.canonical = { catalogue_pieces: true, fiche_produit, rayons: [noms], prix_public_ttc, stock_releve: { en_stock, at: releveLe }, description_marchand }`.

- [ ] **Step 1 : capturer l'extrait.** Lecture du flux public avec 400 ms de pause : `/wp-json/wc/store/v1/products/categories?per_page=100&page=N` (toutes les pages) et `/wp-json/wc/store/v1/products?category=<id>&per_page=100` pour le seul rayon « Pièces détachées Freepoint », plus une fiche en rupture, une fiche `type: "variable"` et une fiche sans prix prises dans les rayons de pièces (si l'une de ces trois n'existe pas sur le site, la fabriquer à partir d'une fiche réelle et le dire dans un champ `_note` du fichier). Garder les champs bruts utiles (dont `description` et `brands`), ranger `{ total, fetched_at, items, categories }` avec `total` = nombre d'items de l'extrait.
- [ ] **Step 2 : écrire les tests qui échouent** (`node:test`), sur l'extrait :

```js
test('rayonsDePieces : la racine et ses descendants, rien d’autre', () => { /* « Pièces détachées », « Pièces détachées MCZ », « Joints MCZ » dedans ; « Conduits de fumées », « Poêle à granulés » dehors */ });
test('texteDepuisHtml', () => {
  assert.equal(texteDepuisHtml('<p>Compatible&nbsp;: <b>Globe</b> / Globe Airtight</p><script>alert(1)</script>'), 'Compatible : Globe / Globe Airtight');
  assert.equal(texteDepuisHtml('x'.repeat(50000)).length, 20000);
  for (const v of [null, undefined, 42]) assert.equal(texteDepuisHtml(v), '');
});
test('les quatre bougies du rayon Freepoint', () => {
  const { lignes } = piecesDepuisReleveWoocommerce(releve, { version: 'woocommerce_2026-11-12', releveLe: '2026-11-12T04:00:00Z' });
  const par = Object.fromEntries(lignes.map((l) => [l.reference, l]));
  assert.equal(par['4D145181040'].specs.canonical.prix_public_ttc, 47.7);
  assert.equal(par['4D145181040'].tarif_public, 39.75);
  assert.equal(par['4D145181040'].purchase_price_ht, 39.75);
  assert.equal(par['4D145181040'].brand, 'CADEL');
  assert.ok(par['4D145181040'].specs.canonical.rayons.some((r) => /freepoint/i.test(r)));
  assert.match(par['4D145181040'].specs.canonical.description_marchand, /Globe Airtight/);
  assert.ok(par['4D14513002'] && par['41451308101'] && par['41450905000']);
  for (const l of lignes) { assert.equal(l.category, 'piece_detachee'); assert.equal(l.specs.canonical.catalogue_pieces, true); }
});
test('remise', () => { /* remisePct: 20 → purchase_price_ht = 31.8, taux_remise = 20 pour 4D145181040 */ });
test('exclusions comptées', () => { /* variantes, sans_prix, sans_reference, hors_rayon : valeurs de l’extrait ; la fiche en rupture EST retenue avec stock_releve.en_stock === false */ });
test('relevé tronqué refusé', () => { assert.throws(() => piecesDepuisReleveWoocommerce({ ...releve, total: releve.items.length + 1 }, { version: 'v', releveLe: 'x' }), /releve_incomplet/); });
```

- [ ] **Step 3 :** `node --test scripts/catalogue/woocommerce-pieces.test.mjs` → FAIL (module absent).
- [ ] **Step 4 : implémenter.** Une fiche est retenue si elle a un sku, un prix > 0, un type `simple`, et au moins un rayon dans `rayonsDePieces`. Le prix TTC = `prices.price / 10^currency_minor_unit`. Réutiliser `calculerModelKey` seulement si la forme de ligne l'exige (sinon ne pas poser `model_key`).
- [ ] **Step 5 :** tests PASS ; `npm run sync:tournee-engine` ; `node --test scripts/tournee/sync-engine.test.mjs` PASS ; commit `feat(pieces): adaptateur de catalogue de pièces WooCommerce`.

### Task 2: Relevé d'une boutique publique dans `supplier-catalog-sync`

**Files:** Create `src/lib/catalogue/cataloguePieces.js` (+ test dans `scripts/catalogue/woocommerce-pieces.test.mjs`) · Modify `supabase/functions/supplier-catalog-sync/woocommerceClient.ts`, `…/woocommerceClient.test.ts`, `…/index.ts`, `scripts/sync-tournee-engine.mjs` (`cataloguePieces` dans `CATALOGUE`), `src/lib/catalogue/releve.js` seulement si l'import de fichier doit garder `description` et `brands` pour un catalogue de pièces.

**Consumes:** `piecesDepuisReleveWoocommerce`, `MARQUE_RELEVE` (tâche 1).

**Produces:**

```js
// src/lib/catalogue/cataloguePieces.js — pur
export function configCataloguePieces(connectorConfig)   // → { public: boolean, pieces: boolean, accord: { contact, date } | null, remisePct: number }
export function accordValide(connectorConfig)            // → boolean : contact non vide ET date AAAA-MM-JJ valide et non future
```

```ts
// woocommerceClient.ts
export async function lireBoutiquePublique(siteUrl: string, opts?: { pauseMs?: number; pagesMax?: number }): Promise<Releve>
//   sans connexion ni cookie ; garde `description` et `brands` ; pagine AUSSI les catégories ; 400 ms entre deux pages ;
//   lève les mêmes codes que le client existant (acces_bloque, reponse_inattendue…) ; relevé incomplet ⇒ erreur, rien de partiel
```

Dans `index.ts`, la synchronisation d'un fournisseur `woocommerce` dont `configCataloguePieces(config).public && .pieces` : refuse `accord_absent` si `accordValide` est faux (avant tout appel réseau) ; lit par `lireBoutiquePublique` ; transforme par `piecesDepuisReleveWoocommerce` (remise de la fiche) ; écrit par **un** `rpc('supplier_pieces_upsert', { p_org_id, p_supplier_id, p_source_version, p_marque: MARQUE_RELEVE, p_rows })` ; range `compte` et `rayons` dans le compte rendu du relevé (là où la fiche fournisseur le lit déjà). Les deux portes existantes (cron, org_admin) sont inchangées ; un fournisseur public n'exige plus d'identifiants au Vault. Tout autre fournisseur suit le chemin actuel, à l'identique.

- [ ] **Step 1 : tests d'abord** — `accordValide` (contact vide, date absente, date future, date mal formée → faux ; `{ contact: 'M. X', date: '2026-11-12' }` → vrai) ; `woocommerceClient.test.ts` : analyse d'une page de produits qui garde `description` et `brands`, pagination des catégories, relevé interrompu à la page 3 ⇒ erreur et aucun relevé rendu (Review Focus 3).
- [ ] **Step 2 :** lancer → FAIL. **Step 3 :** implémenter. **Step 4 :** tests PASS ; `deno check supabase/functions/supplier-catalog-sync/index.ts` ; `npm run sync:tournee-engine` ; test de synchro PASS ; `scripts/catalogue/woocommerce.test.mjs` (Domos) toujours PASS.
- [ ] **Step 5 :** commit `feat(pieces): relevé d'une boutique publique de pièces`. Rien n'est déployé.

### Task 3: Base — vue de recherche et indicateur

**Files:** Create `supabase/migrations/20261113_3_pieces_catalogue.sql`, `scripts/migration-rehearsal/assert-pieces-catalogue.sql`.

**Produces:**

```sql
public.majordhome_pieces_catalogue   -- vue security_invoker, lecture seule
--  id, org_id, supplier_id, supplier_name, reference, name, brand, rayons (text, noms joints par « | »),
--  prix_public_ttc numeric, en_stock boolean, releve_at timestamptz, fiche_url text, image_url,
--  recherche text  = lower(unaccent(name || reference || brand || rayons || description_marchand))
--  lignes : supplier_products actives, category = 'piece_detachee', specs->'canonical'->>'catalogue_pieces' = 'true'
ALTER TABLE majordhome.assistant_recherches ADD COLUMN nb_pieces_base integer NULL;   -- ajoutée EN FIN de la vue majordhome_assistant_recherches
public.assistant_recherche_noter_base(p_id uuid, p_nb integer) RETURNS void           -- service_role seul ; borne 0..999 ; ligne en_cours seulement
```

- [ ] **Step 1 : assertions** (harnais, chaîne `20261113_1` + `20261113_2` + `20261113_3` ; fixtures supprimées en fin) :
  1. La vue n'a aucune colonne `purchase_price_ht`, `taux_remise`, `tarif_public`, `selling_price_ht`, `specs`.
  2. `anon` ne lit pas la vue ; `authenticated` n'a que SELECT ; `security_invoker=true` (`… IS NOT TRUE THEN RAISE`).
  3. Un membre voit les pièces de catalogue de son org et aucune d'une autre org.
  4. Une ligne `piece_detachee` sans `catalogue_pieces` (comme une pièce Invicta) n'est pas dans la vue.
  5. `recherche` est sans casse ni accents : une ligne « Bougie d'allumage CÉRAMIQUE » se trouve par `ilike '%ceramique%'`.
  6. **Écrivain à marque unique** : deux appels successifs de `supplier_pieces_upsert(…, 'CATALOGUE', …)` — le second sans une pièce du premier — laissent cette pièce inactive et hors de la vue ; les lignes d'un autre fournisseur de la même org ne changent pas ; rejouer le second appel ne crée aucun doublon (Review Focus 4).
  7. `assistant_recherche_noter_base` : `anon` et `authenticated` ne l'exécutent pas ; valeur hors 0..999 ou ligne close ⇒ aucune écriture.
- [ ] **Step 2 :** harnais → FAIL. **Step 3 :** écrire la migration (si l'assertion 6 révèle que `supplier_pieces_upsert` ne convient pas à une marque unique, s'arrêter et le rapporter : on l'étend, on ne le contourne pas). **Step 4 :** harnais PASS.
- [ ] **Step 5 :** commit `feat(pieces): vue de recherche des catalogues de pièces`. Application en production : après accord d'Eric.

### Task 4: Classement pur

**Files:** Create `src/lib/catalogue/recherchePieces.js`, `scripts/catalogue/recherche-pieces.test.mjs` · Modify `package.json` (`audit:quality`).

**Produces:**

```js
export const MOTS_GENERIQUES = Object.freeze(['one','evo','air','plus','new','eco','top','max','mini','wifi','at']);
export function motsDuModele(modele)                 // → string[] : mots normalisés de 2 lettres et plus, hors chiffres seuls
export function modeleExploitable(modele)            // → boolean : au moins un mot de 4 lettres et plus hors MOTS_GENERIQUES
export function classerPieces({ marque, modele, saisie }, lignes)
//   lignes = rangées de la vue (name, reference, brand, rayons, recherche, prix_public_ttc, en_stock, …)
//   → { citees: Ligne[], memeMarque: Ligne[], motif: null | 'modele_absent' | 'modele_generique' | 'marque_absente' }
```

Règles : normalisation sans casse ni accents ; « cité » = les `motsDuModele` présents à mots entiers, à la suite et dans l'ordre, dans `recherche` (séparateurs et nombres seuls ignorés) ET modèle exploitable ; « même marque » = marque de l'appareil présente à mots entiers dans `brand` ou `rayons` (après retrait de « pièces détachées ») ; `saisie` : chaque mot de 2 lettres et plus doit figurer dans `recherche` ; ordre : en stock d'abord, puis prix croissant, puis référence ; une ligne n'apparaît que dans un groupe.

- [ ] **Step 1 : tests d'abord**, sur les lignes produites par la tâche 1 mises à la forme de la vue :

```js
test('Globe Airtight + « bougie » : les deux bougies citées, rien d’autre', () => {
  const r = classerPieces({ marque: 'FREEPOINT', modele: 'GLOBE AIRTIGHT', saisie: 'bougie' }, lignes);
  assert.deepEqual(r.citees.map((l) => l.reference).sort(), ['4D14513002', '4D145181040']);
  assert.ok(r.memeMarque.every((l) => /bougie/i.test(l.name)));
  assert.equal(r.motif, null);
});
test('formes d’écriture du modèle', () => { /* fiche « Globe-Globe Airtight » et « Globe / Globe Airtight » → citée ; fiche « GLOBE AT » seule → même marque */ });
test('modèle absent ou générique', () => {
  assert.equal(classerPieces({ marque: 'FREEPOINT', modele: '', saisie: '' }, lignes).motif, 'modele_absent');
  assert.equal(classerPieces({ marque: 'FREEPOINT', modele: 'One', saisie: '' }, lignes).motif, 'modele_generique');
  assert.equal(classerPieces({ marque: 'FREEPOINT', modele: 'One', saisie: '' }, lignes).citees.length, 0);
});
test('marque hors catalogue', () => { const r = classerPieces({ marque: 'COLA', modele: 'Elegant', saisie: '' }, lignes); assert.equal(r.citees.length + r.memeMarque.length, 0); });
test('mot entier', () => { /* modèle « Joy » ne cite pas une fiche qui ne dit que « Joystick » */ });
test('tri', () => { /* en stock avant rupture, puis prix croissant */ });
```

- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS, lint sans avertissement. **Step 5 :** commit `feat(pieces): classement des pièces de catalogue`.

### Task 5: Bloc « Dans les catalogues de vos fournisseurs »

**Files:** Create `src/shared/services/piecesCatalogue.service.js`, `src/shared/hooks/usePiecesCatalogue.js`, `src/apps/artisan/components/assistant/PiecesCatalogueBloc.jsx` · Modify `src/shared/hooks/cacheKeys.js`, `src/apps/artisan/components/assistant/TrouverPieceModal.jsx`, `src/shared/services/assistantPieces.service.js` et `src/shared/hooks/useAssistantPieces.js` (transmettre `nbPiecesBase`), `supabase/functions/assistant-pieces/index.ts` (accepter `nb_pieces_base` facultatif, appeler `assistant_recherche_noter_base` après l'ouverture, sans jamais faire échouer le lancement).

**Produces:**

```js
export const piecesCatalogueKeys = {
  all: (orgId) => ['pieces-catalogue', orgId],
  parMarque: (orgId, marque) => [...piecesCatalogueKeys.all(orgId), 'marque', marque || ''],
};
piecesCatalogueService.listerPourMarque(orgId, marque)   // vue, .eq('org_id', orgId), filtre sur `recherche` par le premier mot utile de la marque (escapePostgrestSearchTerm), 500 lignes au plus
usePiecesCatalogue(equipment)                            // useQuery, enabled: !!orgId && !!marque ; staleTime 10 min
<PiecesCatalogueBloc equipment saisie onCompte={(n) => …} />   // n = nombre de pièces « citées » affichées
```

Règles d'écran (spec § 3) : le bloc se charge à l'ouverture, sans clic ; `saisie` (le champ existant) filtre au fil de la frappe par `classerPieces`, sans nouvel appel réseau ; chaque ligne : désignation, référence, fournisseur, prix public TTC (`formatEuro`), « en stock » / « en rupture » suivi de « au relevé du JJ/MM », lien « voir la fiche » seulement si `lienSur(fiche_url)` (domaine visible, `target="_blank" rel="noopener noreferrer"`) ; groupe « Cité pour ce modèle » ouvert, groupe « Même marque, modèle non cité (N) » replié ; `motif` traduit en une phrase (« Modèle non renseigné : recherche par marque seulement. », « Le nom du modèle est trop court pour distinguer les pièces. », « Aucun catalogue relevé ne couvre cette marque. ») ; aucune pièce : « Rien dans les catalogues relevés. » ; erreur de lecture : « Catalogues indisponibles pour le moment. » avec `logger.error`, la recherche web restant utilisable ; texte toujours en nœuds texte ; rien ne repose sur la seule couleur. Le bouton de recherche web devient « Rien de probant ? Chercher sur le web (environ deux minutes) ».

- [ ] **Step 1 :** service, clés, hook. **Step 2 :** composant et intégration dans la fenêtre. **Step 3 :** edge `assistant-pieces` : `nb_pieces_base` entier 0..999 sinon ignoré ; erreur de la RPC journalisée (code seul), jamais renvoyée. **Step 4 :** `deno check`, `npm run lint`, `npm run audit:quality`, `npm run build` → OK. **Step 5 :** commit `feat(pieces): pièces des catalogues dans la fenêtre Trouver une pièce`.

### Task 6: Réglages sur la fiche du fournisseur

**Files:** Modify `src/apps/artisan/pages/settings/SupplierManagement.jsx` et/ou `src/apps/artisan/pages/settings/suppliers/CatalogConnectorPanel.jsx`, `src/lib/catalogue/piecesDetachees.js` (si `connectorConfigAvecPieces` doit conserver les nouvelles clés à l'enregistrement).

Pour un fournisseur `woocommerce` : case « Boutique publique (relevé sans identifiants) », case « Catalogue de pièces détachées », champs « Accord du fournisseur — contact » et « date », remise pièces (déjà là). En mode public : le bloc des identifiants est masqué, « Actualiser le catalogue » et « Relevé automatique chaque nuit » sont disponibles sans identifiants mais désactivés, avec la raison écrite, tant que `accordValide` est faux. Le compte rendu du relevé affiche les fiches retenues et les exclues par motif (dont les variantes). `accord_absent` a son message en français. L'enregistrement conserve toutes les clés de `connector_config` qu'il ne connaît pas.

- [ ] **Step 1 :** test pur d'abord si une fonction de fusion de `connector_config` est touchée (les clés `pieces`, `public`, `catalogue_pieces`, `accord` survivent à un enregistrement qui n'en modifie qu'une). **Step 2 :** écran. **Step 3 :** lint, audit, build. **Step 4 :** commit `feat(pieces): réglages d'un catalogue de pièces public`.

### Task 7: Mise en production, premier relevé, recette — accords d'Eric

- [ ] **Step 1 (accord) :** appliquer `20261113_3` ; contrôler l'effet en base (`has_table_privilege`, `reloptions`, colonnes de la vue) ; déployer `supplier-catalog-sync` et `assistant-pieces` sur le projet `ejqqqwudmizqisdkxohw` (`--project-ref` explicite) ; fusionner l'écran.
- [ ] **Step 2 (Eric, à l'écran) :** Paramètres → Fournisseurs → créer « ENERGIES BOIS DISTRIBUTION » : site `https://energies-bois-distribution.com`, boutique WooCommerce, publique, catalogue de pièces, accord (contact, date), remise.
- [ ] **Step 3 (Eric) :** « Actualiser le catalogue ». Attendu : environ 560 pièces retenues, variantes comptées à part, aucune erreur ; vérifier en base (lecture seule) que les lignes des autres fournisseurs n'ont pas changé (compte par fournisseur avant / après) et que les pièces Invicta sont intactes.
- [ ] **Step 4 :** recette sur le Freepoint Globe Airtight de la fiche CLI-01324 : à l'ouverture, les deux bougies 4D145181040 et 4D14513002 sous « Cité pour ce modèle » avec prix et date du relevé ; « bougie » filtre ; un appareil COLA affiche « Aucun catalogue relevé ne couvre cette marque. » ; la recherche web marche toujours et sa ligne porte `nb_pieces_base`.
- [ ] **Step 5 :** activer le relevé de nuit ; le lendemain, contrôler qu'un second relevé n'a créé aucun doublon et que `catalog_sync_result` est daté du jour.
- [ ] **Step 6 :** `CLAUDE.md` — compléter « Module Catalogue fournisseur » (mode public, catalogue de pièces, accord obligatoire, écrivain et marque de relevé, prix TTC) et « Module Assistant pièces » (la base d'abord, Hermes ensuite, indicateur `nb_pieces_base`) ; commit.
