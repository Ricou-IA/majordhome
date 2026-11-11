# Pièces détachées Invicta — tranche 1 (relevé et données) — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relever le site de pièces détachées Invicta de façon rejouable et ranger en base les pièces (avec prix), les modèles d'appareil et leur nomenclature, pour qu'une pièce soit trouvable et chiffrable dans un devis SAV.

**Architecture:** Un script de console relève l'API JSON du site depuis le navigateur connecté et produit un fichier daté. Un adaptateur PUR le transforme en trois listes (pièces, modèles, nomenclature). Un script Node en tire un SQL rejouable qui appelle deux RPC `service_role` : `supplier_pieces_upsert` (enveloppe de l'écrivain unique `supplier_catalog_upsert`, qui porte la désactivation ciblée et le suivi du prix de vente) et `equipment_models_upsert` (modèles + nomenclature).

**Tech Stack:** JavaScript ESM (Node `--test`), PostgreSQL / Supabase (migrations versionnées, harnais `scripts/migration-rehearsal/`), React 18 pour les deux retouches d'écran.

**Spec:** `docs/superpowers/specs/2026-11-11-pieces-detachees-invicta-releve-nomenclature-design.md` (à lire en entier, § 5 et § 7 bis surtout). Les tranches 2 (fichiers), 3 (écrans) et 4 (autres marques) auront chacune leur plan.

## Global Constraints

- Conventions du dépôt : `CLAUDE.md` (charte multi-tenant, Module Catalogue fournisseur). Français pour les textes d'écran, code en anglais ou français comme le voisinage du fichier.
- Org Mayer `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`, projet Supabase `ejqqqwudmizqisdkxohw`, fournisseur `INVICTA` (existant, 160 lignes de tarif à ne jamais désactiver ni réécrire).
- Le site n'est lu que depuis le navigateur connecté d'Eric, en lecture seule (GET), concurrence 4 au plus. Jamais de requête au site depuis Node ou un serveur avec sa session. Aucun identifiant Invicta stocké.
- Catégorie des pièces : `piece_detachee` ; nature : `accessory` ; `taux_remise` en pourcentage (30, pas 0,3).
- Prix : `tarif_public` = prix HT du site ; `selling_price_ht_defaut` = prix public ; `purchase_price_ht` = arrondi au centime de prix public × (1 − remise / 100). Remise lue dans `suppliers.connector_config.pieces.remise_pct` ; absente → 0 et avertissement.
- Toute fonction SECURITY DEFINER : `SET search_path = majordhome, public`, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`, `GRANT … TO service_role`. Toute table : RLS + `REVOKE ALL … FROM PUBLIC, anon`. Toute vue `public.majordhome_*` : `security_invoker = true`, `REVOKE ALL … FROM PUBLIC, anon`, `GRANT SELECT … TO authenticated, service_role`. Toute table temporaire jointe dans une fonction : index + `ANALYZE`.
- Commits par chemins explicites (sessions concurrentes sur `main`), message terminé par la ligne `Co-Authored-By` du dépôt. Pas de worktree. Vérification front : `npx vite build`, jamais les outils de prévisualisation.
- Un échec ne s'avale jamais : relevé incomplet, référence à deux prix, pièce de nomenclature introuvable ⇒ arrêt avec message, aucun SQL écrit.

## Review Focus

1. **Session Invicta expirée en cours de relevé** (401 / 403 au 300ᵉ appareil) : aucun fichier téléchargé, message clair — test Task 1 (fonction pure de contrôle de complétude).
2. **Référence de pièce identique à une référence du tarif** (accessoires P69…) : la ligne du tarif garde son prix d'achat et de vente ; la nomenclature pointe la ligne du tarif — tests Task 2 et assertion Task 3.
3. **Prix de vente ajusté à la main puis nouveau relevé** : le prix ajusté est conservé et compté ; un prix resté égal à l'ancien prix public suit — assertion Task 3.
4. **Second relevé où une pièce a disparu** : la pièce est désactivée, les 160 lignes du tarif restent actives, la pièce est réactivée si elle revient — assertion Task 3.
5. **Remise absente ou non numérique dans `connector_config`** : achat = prix public, avertissement dans le compte rendu, pas de `NaN` dans le SQL — test Task 4.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `scripts/catalogue/dump-invicta-pieces.browser.js` (créé) | Relevé console : parcourt rayons → appareils → documents, télécharge le JSON |
| `src/lib/catalogue/invictaPiecesReleve.js` (créé) | PUR : forme d'un appareil relevé (`appareilDepuisApi`) et contrôle de complétude (`controlerReleve`), partagés par le script console (copie inline) et les tests |
| `src/lib/catalogue/invictaPieces.js` (créé) | PUR : relevé → `{ pieces, modeles, nomenclature, compteRendu }` |
| `scripts/catalogue/invicta-pieces.test.mjs` (créé) | Tests de l'adaptateur sur fixtures + relevé réel pinné |
| `scripts/catalogue/data/invicta-pieces-2026-11-11.json` (créé) | Relevé de référence |
| `supabase/migrations/20261111_1_equipment_models_pieces.sql` (créé) | Tables, vues, RPC, colonne `equipments.equipment_model_id` |
| `scripts/migration-rehearsal/assert-equipment-models-pieces.sql` (créé) + `snapshot.mjs` (modifié) | Répétition |
| `scripts/catalogue/import-invicta-pieces.mjs` (créé) | Relevé → SQL rejouable dans `scripts/catalogue/out/` |
| `src/lib/devisConfig.js`, `src/shared/services/suppliers.service.js`, `src/apps/artisan/components/devis/DevisProductPicker.jsx` (modifiés) | Catégorie, exclusion des chapitres équipement / option, référence fournisseur sur la ligne |
| Fiche fournisseur (composant à localiser par `connector_config`) (modifié) | Champ « Remise sur les pièces (%) » |
| `package.json` (modifié) | Test ajouté à `audit:quality` |
| `CLAUDE.md` (modifié) | Puces du Module Catalogue fournisseur |

---

### Task 1 : Relevé du site et fichier de référence

**Files:**
- Create: `src/lib/catalogue/invictaPiecesReleve.js`, `scripts/catalogue/dump-invicta-pieces.browser.js`, `scripts/catalogue/data/invicta-pieces-2026-11-11.json`
- Test: `scripts/catalogue/invicta-pieces.test.mjs` (première moitié)

**Interfaces:**
- Produces: `appareilDepuisApi(produit, documents, categorie) -> Appareil` et `controlerReleve(releve) -> { ok: boolean, erreurs: string[] }` ; format du fichier = § 5.1 du spec (`{ source, fetched_at, manufacturer, categories[], appareils[] }`, chaque appareil `{ id, publicId, reference, name, categorie, lifecycleStage, photo, vues_eclatees[], documents[], items[] }`, chaque item `{ repere, quantity, notes, piece: { publicId, reference, name, price, taxRate, weight, unitCode, isPurchasable, isBundle, isVirtualKit, onlyAvailableInBundle, lifecycleStage, stockAvailable, image_url, remplacement } }`).

- [ ] **Step 1 : tests de forme.** Dans `invicta-pieces.test.mjs`, avec une réponse d'API réduite écrite à la main (un appareil « POELE OXANA - P601314 », deux items dont un avec `replacementProduct` et un kit) :

```js
test('appareilDepuisApi garde repère, quantité, remarque et la pièce', () => {
  const a = appareilDepuisApi(PRODUIT_API, DOCS_API, 'poeles');
  assert.equal(a.reference, 'P601314');
  assert.equal(a.items[0].repere, '23');
  assert.equal(a.items[0].piece.reference, 'AS700180A');
  assert.equal(a.items[0].piece.price, 13.65);
  assert.deepEqual(a.items[1].piece.remplacement, { reference: 'F670807B', name: 'TAQUE FABRILOR SERIE 700' });
  assert.equal(a.vues_eclatees.length, 1);
  assert.equal(a.documents[0].type, 'Notice');
});
test('controlerReleve refuse un rayon incomplet', () => {
  const r = controlerReleve({ categories: [{ publicId: 'x', name: 'Poêles', total: 3 }], appareils: [{ categorie: 'Poêles', items: [] }] });
  assert.equal(r.ok, false);
  assert.match(r.erreurs[0], /Poêles : 1 \/ 3/);
});
test('controlerReleve refuse un appareil non lu', () => { /* appareil { erreur: 'HTTP 401' } ⇒ ok false, message contenant la référence et « 401 » */ });
```

- [ ] **Step 2 :** `node --test scripts/catalogue/invicta-pieces.test.mjs` → échec (module absent).
- [ ] **Step 3 :** écrire `invictaPiecesReleve.js`. Photo et vue éclatée : prendre la variante de plus grande largeur (`variants`), `fileId` de cette variante.
- [ ] **Step 4 :** écrire `dump-invicta-pieces.browser.js` sur le modèle de `dump-woocommerce.browser.js` : constante `MARQUE = 'VdklLfh0Fp'` ; `GET /api/1.0.0/manufacturers/{MARQUE}` puis ses rayons (à lire dans la réponse ; à défaut, la table des quatre rayons Invicta du spec § 2) ; pagination `products?Category=…&Limit=100&Offset=…` ; par appareil `products/{publicId}` + `products/{id}/documents`, 4 à la fois, pause 150 ms entre lots ; progression `console.log` tous les 20 appareils ; `appareilDepuisApi` et `controlerReleve` recopiées dans le script (commentaire : source = `src/lib/catalogue/invictaPiecesReleve.js`) ; si `controlerReleve` échoue → `throw`, rien n'est téléchargé ; sinon téléchargement `invicta-pieces-AAAA-MM-JJ.json`.
- [ ] **Step 5 : prendre le relevé de référence.** Par l'extension Chrome, dans l'onglet d'Eric connecté à `pieces-detachees.invicta-group.fr` : exécuter la logique du script en tâche de fond (résultat dans `window.__releve`, interrogé par appels courts — un appel de plus de 45 s est coupé), puis récupérer le JSON par tranches et l'écrire dans `scripts/catalogue/data/invicta-pieces-2026-11-11.json`. Si la session est fermée, demander à Eric de se reconnecter et s'arrêter là.
- [ ] **Step 6 :** `node --test …` vert ; vérifier à la main `appareils.length === 470` (ou la somme des `total` des rayons si le site a bougé) et noter les nombres réels pour la Task 2.
- [ ] **Step 7 :** commit `feat(catalogue): relevé des pièces détachées Invicta (script console + fichier de référence)`.

### Task 2 : Adaptateur pur

**Files:**
- Create: `src/lib/catalogue/invictaPieces.js`
- Test: `scripts/catalogue/invicta-pieces.test.mjs` (seconde moitié)

**Interfaces:**
- Consumes: le fichier de relevé (Task 1).
- Produces:

```js
/**
 * @param {object} releve
 * @param {{ version: string, remisePct: number, referencesTarif: string[] }} opts  referencesTarif = références déjà
 *   présentes chez le fournisseur hors catégorie piece_detachee
 * @returns {{ pieces: LignePiece[], modeles: Modele[], nomenclature: LigneNomenclature[], compteRendu: object }}
 */
export function piecesDepuisReleveInvicta(releve, opts)
export function nomModele(name, reference)   // 'POELE OXANA - P601314' → 'OXANA'
```

`LignePiece` = ligne acceptée par `supplier_catalog_upsert` : `{ reference, name, brand, category: 'piece_detachee', product_kind: 'accessory', unit, default_tva_rate: 20, tarif_public, taux_remise, purchase_price_ht, selling_price_ht_defaut, image_url, specs: { source_version, canonical: { cycle_de_vie, remplacee_par, kit, vendue_seule, poids_kg, stock_releve, releves_pieces: [marque] } } }`.
`Modele` = `{ reference, name, model_name, brand, category, lifecycle, photo: { url, fileId } | null, exploded_views: [{ url, fileId, width, height }], documents: [...], source: { site, publicId, version } }`.
`LigneNomenclature` = `{ modele_reference, position, repere, piece_reference, quantity, notes }`.
`compteRendu` = `{ appareils, pieces, lignes_nomenclature, deja_au_tarif, sans_prix, arretees, remplacees, kits, somme_prix_public }`.

- [ ] **Step 1 : tests sur fixture** (relevé de deux appareils partageant une pièce) :
  - une pièce vue sur deux appareils sort une seule fois ; `nomenclature` a une ligne par item, `position` = rang dans l'appareil à partir de 1 ;
  - prix 79,84 et remise 30 → `tarif_public: 79.84`, `selling_price_ht_defaut: 79.84`, `purchase_price_ht: 55.89`, `taux_remise: 30` ;
  - `remisePct: undefined` ou `'abc'` → `taux_remise: 0`, achat = public, `compteRendu.avertissements` contient « remise absente » ;
  - même référence avec deux prix différents → `throw` dont le message cite la référence et les deux prix ;
  - référence présente dans `referencesTarif` → absente de `pieces`, comptée dans `deja_au_tarif`, toujours présente dans `nomenclature` ;
  - pièce `price: null` ou `isPurchasable: false` → `purchase_price_ht: 0`, `selling_price_ht_defaut: 0`, `vendue_seule: false`, comptée dans `sans_prix` ;
  - `lifecycleStage: 'Discontinued'` → `cycle_de_vie: 'arretee'` ; `UntilEndOfStock` → `'fin_de_stock'` ; `OnSale` → `'en_vente'` ; valeur inconnue → conservée telle quelle en minuscules ;
  - `unitCode: 'PCE'` → `unit: 'pièce'` ; autre code → code en minuscules ;
  - `nomModele('POELE OXANA - P601314', 'P601314') === 'OXANA'`, `nomModele('POELE A GRANULES THERA - P614044', 'P614044') === 'THERA'`, `nomModele('POELE PELETS SOFIA BLANC - P618970', 'P618970') === 'SOFIA BLANC'`, nom sans préfixe connu → nom privé de « - référence » seulement ;
  - repère « 7-14 » conservé tel quel.
- [ ] **Step 2 :** lancer → échec.
- [ ] **Step 3 :** implémenter. Préfixes retirés par `nomModele`, dans cet ordre, insensibles à la casse : `POELE A GRANULES`, `POELE PELETS`, `POELE PELLETS`, `POELE`, `INSERT`, `FOYER`. Compléter la liste d'après les noms réels du relevé (les tests du Step 4 la figent).
- [ ] **Step 4 : test pinné sur le relevé réel** `data/invicta-pieces-2026-11-11.json` avec `remisePct: 30`, `referencesTarif: []` : `assert.equal` sur `compteRendu.appareils`, `.pieces`, `.lignes_nomenclature`, `.somme_prix_public` (arrondie au centime) — valeurs obtenues en exécutant l'adaptateur une fois, relues (ordres de grandeur attendus : 470 appareils, quelques milliers de pièces, ≈ 15 000 lignes) puis inscrites en dur ; plus : aucune `LignePiece` sans `reference` ni `name`, références uniques, chaque `piece_reference` de la nomenclature existe dans `pieces`.
- [ ] **Step 5 :** ajouter `scripts/catalogue/invicta-pieces.test.mjs` à `audit:quality` dans `package.json` ; `npm run audit:quality` vert.
- [ ] **Step 6 :** commit `feat(catalogue): adaptateur pur des pièces détachées Invicta`.

### Task 3 : Migration et répétition

**Files:**
- Create: `supabase/migrations/20261111_1_equipment_models_pieces.sql`, `scripts/migration-rehearsal/assert-equipment-models-pieces.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (ajouter aux listes : tables `equipment_models`, `equipment_model_parts` ; fonctions `supplier_pieces_upsert`, `equipment_models_upsert` ; lire `README.md` du harnais pour la marche)

**Interfaces:**
- Consumes: `public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb)` (corps en prod = dernière migration qui la redéfinit ; vérifier par `pg_get_functiondef` avant d'écrire), `majordhome.equipment_model_key(text)`.
- Produces:
  - `majordhome.equipment_models (id, org_id, brand, brand_key, reference, reference_key, name, model_name, model_name_key, category, lifecycle, photo_path, exploded_views jsonb, source jsonb, is_active, created_at, updated_at)`, unique `(org_id, brand_key, reference_key)`, clés posées par trigger depuis `equipment_model_key`.
  - `majordhome.equipment_model_parts (id, org_id, equipment_model_id → equipment_models ON DELETE CASCADE, position int, repere text, supplier_product_id → supplier_products, quantity numeric, notes text)`, index `(equipment_model_id, position)` et `(supplier_product_id)`.
  - `majordhome.equipments.equipment_model_id uuid NULL REFERENCES majordhome.equipment_models ON DELETE SET NULL` ; la colonne est ajoutée en fin de la vue `public.majordhome_equipments` et de sa vue d'écriture si elle en a une (vérifier comment le front écrit un équipement ; `CREATE OR REPLACE VIEW` n'ajoute qu'en fin de liste ; ne pas réémettre de `GRANT` de table entière sur une vue à ACL par colonne).
  - Vues `public.majordhome_equipment_models` (miroir, lecture) et `public.majordhome_equipment_model_parts` (jointe à `supplier_products` : `piece_reference, piece_name, tarif_public, selling_price_ht, unit, catalog_item_id, is_active, cycle_de_vie, remplacee_par, kit, vendue_seule`, les quatre derniers tirés de `specs->'canonical'`).
  - `public.supplier_pieces_upsert(p_org_id uuid, p_supplier_id uuid, p_source_version text, p_marque text, p_rows jsonb) RETURNS jsonb` :
    1. refuse si une `reference` de `p_rows` existe déjà chez le fournisseur avec `category IS DISTINCT FROM 'piece_detachee'` (`RAISE EXCEPTION 'reference_au_tarif'`) ;
    2. photographie `(reference, tarif_public, selling_price_ht)` des lignes existantes concernées ;
    3. appelle `supplier_catalog_upsert(…, p_meta := '{"desactiver_absents": false}')` ;
    4. suivi du prix de vente : pour chaque ligne dont le nouveau `tarif_public` diffère de l'ancien, si l'ancien `selling_price_ht` valait l'ancien `tarif_public` ou 0 → `selling_price_ht = nouveau tarif_public` ; même règle pour l'article lié (`catalog_items.selling_price_ht` égal à l'ancien prix public ou 0) ; sinon compté dans `prix_ajustes_non_suivis` ;
    5. fusionne `p_marque` dans `specs->'canonical'->'releves_pieces'` des lignes reçues ;
    6. désactive (`is_active = false`, `specs.desactive_par_releve = true`) les lignes `piece_detachee` actives du fournisseur absentes de `p_rows` dont `releves_pieces` est exactement `[p_marque]` ; retire `p_marque` de `releves_pieces` des absentes qui portent d'autres marques ;
    7. retourne le résultat de l'écrivain enrichi de `{ prix_suivis, prix_ajustes_non_suivis, pieces_desactivees }`.
  - `public.equipment_models_upsert(p_org_id uuid, p_supplier_id uuid, p_brand text, p_source_version text, p_models jsonb, p_parts jsonb) RETURNS jsonb` : refuse `p_models` vide ; upsert des modèles par `(org, brand_key, reference_key)` (`photo_path` et `exploded_views` jamais écrasés par NULL : la tranche 2 les remplit) ; elle ne désactive aucun modèle (elle est appelée par lots) ; pour chaque modèle reçu, suppression puis réinsertion de sa nomenclature depuis `p_parts` (`{ modele_reference, position, repere, piece_reference, quantity, notes }`), pièce résolue par `(p_supplier_id, piece_reference)` en prenant la ligne active la plus ancienne ; `RAISE EXCEPTION 'piece_introuvable'` avec la référence si une ne se résout pas ; rattache d'office les `equipments` de l'org sans `equipment_model_id` dont `equipment_model_key(brand) = brand_key` du modèle et `equipment_model_key(model)` ∈ { `reference_key`, `reference_key` privée de son « p » initial } quand **un seul** modèle correspond ; retourne `{ modeles, lignes, equipements_rattaches }`.
  - `public.equipment_models_close(p_org_id uuid, p_brand text, p_source_version text) RETURNS jsonb` : appelée une fois après tous les lots, désactive les modèles actifs de la marque dont `source->>'version'` ≠ `p_source_version` (jamais supprimés : un équipement client peut y être rattaché) ; refuse si aucun modèle de la marque ne porte `p_source_version` (relevé non importé) ; retourne `{ modeles_desactives }`.
  - Droits : RLS sur les deux tables, policy SELECT = membre de l'org, aucune policy d'écriture ; `GRANT SELECT` à `authenticated` et `service_role` ; policy UPDATE existante des équipements inchangée (le rattachement suit `clients.edit`).

- [ ] **Step 1 : écrire les assertions** (`assert-equipment-models-pieces.sql`, style des asserts voisins, fixture nettoyée en fin) :
  - fournisseur de test avec 2 lignes de tarif `poele` actives + `supplier_pieces_upsert` de 3 pièces → les 2 lignes de tarif toujours actives, prix inchangés ; 3 pièces `piece_detachee` actives avec article ;
  - second appel avec 2 pièces dont une au prix public changé (10 → 12) → la 3ᵉ désactivée et marquée ; prix de vente de la pièce changée = 12 sur la ligne et sur l'article ; `prix_suivis = 1` ;
  - prix de vente d'une pièce mis à 15 à la main puis relevé à 13 → reste 15, `prix_ajustes_non_suivis = 1` ;
  - pièce revenue au 3ᵉ appel → réactivée ;
  - pièce vue sous deux marques, absente du relevé de l'une → reste active ;
  - `supplier_pieces_upsert` avec une référence du tarif → exception `reference_au_tarif` ;
  - `equipment_models_upsert` : 1 modèle + 2 lignes → vue `majordhome_equipment_model_parts` rend 2 lignes avec `tarif_public` ; pièce inconnue → exception `piece_introuvable` ; rejouer → 2 lignes (pas 4) ; équipement de marque égale et modèle « 601314 » rattaché, équipement « oxana » non rattaché ; `equipment_models_close` avec une autre version → modèle inactif, équipement toujours rattaché ;
  - `has_function_privilege('anon' | 'authenticated', …, 'EXECUTE')` faux pour les trois RPC ; `has_table_privilege('anon', …)` faux pour tables et vues ; `has_table_privilege('service_role', 'majordhome.equipment_models', 'SELECT')` vrai.
- [ ] **Step 2 :** lancer le harnais (commande du `README.md`) → échec sur la première assertion.
- [ ] **Step 3 :** écrire la migration.
- [ ] **Step 4 :** harnais vert ; `node scripts/permissions-coherence.mjs --env .env.local` ne se plaint d'aucun objet nouveau (les deux tables relèvent du catalogue : les déclarer là où le script range `supplier_products`).
- [ ] **Step 5 :** appliquer en prod (`apply_migration` du connecteur Supabase, nom `20261111_1_equipment_models_pieces`) ; vérifier `to_regclass('majordhome.equipment_models')`, `to_regclass('public.majordhome_equipment_model_parts')` non NULL et les privilèges par les mêmes requêtes que l'assertion.
- [ ] **Step 6 :** commit `feat(catalogue): modèles d'appareil, nomenclature et écrivain des pièces détachées`.

### Task 4 : Import et mise en base

**Files:**
- Create: `scripts/catalogue/import-invicta-pieces.mjs`
- Test: `scripts/catalogue/invicta-pieces.test.mjs` (fonction pure de découpage)

**Interfaces:**
- Consumes: `piecesDepuisReleveInvicta` (Task 2), RPC de la Task 3, lecture du fournisseur par l'API de management comme `import-releve.mjs` (`SUPABASE_ACCESS_TOKEN` de `.env.local`).
- Produces: `scripts/catalogue/out/invicta-pieces_<date>.sql` (un ou plusieurs fichiers numérotés) ; export `decouperEnLots(liste, taille) -> liste[]`.

- [ ] **Step 1 :** test `decouperEnLots` (liste vide → `[]` ; 5 éléments par 2 → 3 lots ; les lots de nomenclature ne coupent jamais un modèle en deux : fonction `lotsParModele(modeles, nomenclature, tailleMax)` → chaque lot `{ modeles, parts }` cohérent).
- [ ] **Step 2 :** écrire le script. Arguments `--fichier` (requis), `--fournisseur` (défaut `INVICTA`), `--org`, `--env`. Il lit en base : `id`, `connector_config` du fournisseur et la liste des références hors `piece_detachee` ; calcule `version = invicta-pieces_AAAA-MM-JJ` d'après `fetched_at` ; `marque = releve.manufacturer.name` ; appelle l'adaptateur ; écrit le SQL : (1) un `DO $$` → `supplier_pieces_upsert` (toutes les pièces en un appel ; si le JSON dépasse 4 Mo, s'arrêter avec un message — la désactivation ciblée exige un appel unique) ; (2) N `DO $$` → `equipment_models_upsert` par lots de 60 modèles ; (3) `equipment_models_close` ; (4) marque et photo des lignes du tarif : `UPDATE supplier_products SET brand = 'INVICTA' WHERE supplier_id = … AND brand IS NULL AND category IS DISTINCT FROM 'piece_detachee'` et l'équivalent sur `catalog_items` liés dont `brand IS NULL` (la photo attend la tranche 2). Balises dollar `$rows$`, `$models$`, `$parts$` avec le garde-fou de `import-releve.mjs`. Compte rendu console = `compteRendu` + avertissements.
- [ ] **Step 3 :** poser la remise en base par le même SQL si elle est absente : `connector_config = connector_config || '{"pieces": {"remise_pct": 30, "marque_site": "VdklLfh0Fp", "site": "https://pieces-detachees.invicta-group.fr"}}'` **seulement si la clé `pieces` n'existe pas** (valeur d'Eric du 2026-11-11 ; ensuite elle se règle à l'écran, Task 5). Le script relit donc la remise après ce bloc : au premier passage, passer `--remise 30`.
- [ ] **Step 4 :** générer, relire le compte rendu, appliquer : `node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw scripts/catalogue/out/<fichiers>`.
- [ ] **Step 5 : vérifier en prod** (lecture) : lignes INVICTA `category = 'poele'` actives = 144 comme avant ; nombre de pièces actives = `compteRendu.pieces` ; `count(*)` de `equipment_models` et `equipment_model_parts` = compte rendu ; modèle `P601314` : ses lignes, repère 30 = `F670108B` à 79,84 ; `catalog_sync_result` du fournisseur ; équipements rattachés (liste nominative pour le message de fin).
- [ ] **Step 6 :** rejouer le même SQL → mêmes compteurs, 0 insertion, 0 désactivation.
- [ ] **Step 7 :** commit `feat(catalogue): import des pièces détachées et de la nomenclature Invicta`.

### Task 5 : Devis et fiche fournisseur

**Files:**
- Modify: `src/lib/devisConfig.js` (`CATEGORIES_PRODUIT`), `src/shared/services/suppliers.service.js` (`PRODUCT_CATEGORIES` : `{ value: 'piece_detachee', label: 'Pièce détachée' }`), `src/apps/artisan/components/devis/DevisProductPicker.jsx`, le composant de la fiche fournisseur qui édite `connector_config` (le trouver par `grep connector_config src/`)
- Test: `scripts/devis-config.test.mjs` et le test existant du picker s'il y en a un ; sinon la règle d'exclusion sort dans une fonction pure testée

**Interfaces:**
- Produces: `exclurePiecesDetachees(typeChapitre) -> boolean` (vrai pour `equipement` et `option`) dans le module pur voisin du picker ; ligne de devis posée depuis un article `piece_detachee` sans `code` : `reference` = référence fournisseur de la pièce.

- [ ] **Step 1 :** tests : `CATEGORIES_PRODUIT` contient `piece_detachee` et `validerDevisConfig` l'accepte dans une famille ; `exclurePiecesDetachees('equipement') === true`, `('option') === true`, `('libre') === false`, `('stock') === false`.
- [ ] **Step 2 :** lancer → échec ; implémenter. Dans le picker, quand `exclurePiecesDetachees(typeChapitre)` et que la famille n'a pas de catégories, passer aux critères de recherche l'exclusion de la catégorie (ajouter le critère au service de recherche d'articles s'il n'existe pas, en `.neq` / `.not('category','eq',…)` — pas d'interpolation d'entrée utilisateur). Référence de la ligne : la vue liste des articles expose-t-elle une référence fournisseur ? Sinon, ajouter à la recherche une lecture de la référence de la ligne source (`source_product_id`) pour les seuls articles `piece_detachee` sélectionnés ; échec de cette lecture ⇒ ligne posée sans référence + `toast.warning`, jamais un refus.
- [ ] **Step 3 :** fiche fournisseur : champ numérique « Remise sur les pièces détachées (%) », visible quand `connector_config.pieces` existe, enregistré en réécrivant l'objet `pieces` complet ; sous le champ : « Appliquée au prochain relevé de pièces ». Afficher la date et les compteurs du dernier relevé de pièces n'est pas dans cette tranche.
- [ ] **Step 4 :** `npm run audit:quality` et `npx vite build` verts.
- [ ] **Step 5 :** commit `feat(devis): pièces détachées trouvables dans les devis SAV, remise réglable`.

### Task 6 : Documentation et livraison

**Files:**
- Modify: `CLAUDE.md` (Module Catalogue fournisseur)

- [ ] **Step 1 :** ajouter une puce « Pièces détachées Invicta » : relevé navigateur seulement (`dump-invicta-pieces.browser.js`), adaptateur pur + test pinné, `supplier_pieces_upsert` seul écrivain des pièces (jamais `supplier_catalog_upsert` en direct sur un relevé de pièces : il désactiverait le tarif), prix de vente des pièces suit le prix public sauf ajustement manuel (exception limitée à `piece_detachee`), `equipment_models` / `equipment_model_parts` écrites par RPC seulement, rattachement d'un équipement = choix humain sauf référence exacte, marche de mise à jour en 3 commandes.
- [ ] **Step 2 :** `git pull --rebase --autostash`, push sur `main`, suivre le déploiement Vercel jusqu'à READY.
- [ ] **Step 3 :** message de fin à Eric : compteurs réels, équipements rattachés, ce qui n'est pas fait (tranches 2 à 4), ce qui n'a pas été vérifié à l'écran.
