# Import d'une base d'articles depuis un fichier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'administrateur d'une entreprise dépose un Excel ou un CSV d'articles. Ils deviennent des articles Majord'home (`catalog_items`), avec leur ligne fournisseur quand le fichier la porte, et les relevés fournisseurs suivants se rattachent à ces articles au lieu de les doubler.

**Architecture:** Les règles vivent dans des modules purs `src/lib/importArticles/`, testés par `node --test`. Ils réutilisent la lecture de fichier et l'exécution par lots de `src/lib/importClients/`. L'écriture passe par des RPC SECURITY DEFINER (org_admin de l'entreprise de l'import), par lots idempotents. Les lignes fournisseur sont écrites par l'écrivain unique `supplier_catalog_upsert`, étendu pour accepter l'article de la ligne et une date de prix absente. `catalog_items_ensure` et `catalog_item_proposals_propose` lisent désormais aussi les clés portées par l'article.

**Tech Stack:** React 18, TanStack Query v5, Tailwind, ExcelJS 4 (déjà chargé à la demande par `components/clients/import/classeur.js`), Supabase (PostgreSQL, PostgREST), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-28-import-articles-fichier-design.md`, à lire avec ce plan. Le modèle suivi est l'import des clients : `docs/superpowers/plans/2026-11-21-import-clients-tranche-1-fichier-type.md`, `supabase/migrations/20261121_13_clients_import.sql` et `20261122_1_clients_import_suite.sql`.

## Global Constraints

- Import, liste des imports et retrait : **org_admin** seulement, tenu à l'écran (`useAuth().isOrgAdmin`) ET dans chaque RPC (même condition que `update_member_role`, adhésion active comprise).
- Limites du fichier : celles de `lireFichier.js` (`LIGNES_MAX` = 50 000, `OCTETS_MAX` = 20 Mo, `.xlsx` / `.csv`).
- Invariant affiché et testé : **lignes lues = importées + doublons écartés + écartées**.
- Liste des articles existants, ou des lignes fournisseur des fournisseurs du fichier, inconnue (chargement, échec) ⇒ import **fermé**, jamais « aucun doublon ».
- Aucune ligne envoyée à la base ne porte d'`org_id` : l'entreprise est celle de l'import. Un fournisseur n'est jamais pris dans une autre organisation.
- Une ligne fournisseur **existante** (même fournisseur, même référence ; active ou non) n'est jamais envoyée à `supplier_catalog_upsert`.
- Prix du fichier lus **HT** ; prix d'achat sans date ⇒ `purchase_price_at = NULL` (décision d'Eric, option B).
- Les relevés existants ne changent pas de comportement : les nouvelles clés de `supplier_catalog_upsert` sont facultatives et sans effet quand elles manquent.
- Toute RPC : `SECURITY DEFINER`, `SET search_path = majordhome, public`, `auth.uid() IS NULL` refusé en première instruction, garde positive (`IS NOT TRUE`), `REVOKE ALL … FROM PUBLIC, anon` puis `GRANT EXECUTE … TO authenticated`. Fonctions internes : `REVOKE … FROM PUBLIC, anon, authenticated`.
- Toute vue créée ou recréée : `WITH (security_invoker = true)`, `REVOKE ALL … FROM PUBLIC, anon`, nouvelle colonne en **fin** de liste. Ne jamais réémettre un `GRANT … UPDATE` de table entière sur `majordhome_catalog_items` : ses droits sont accordés par colonne (`20261028_4`).
- Toute table temporaire jointe dans une fonction reçoit un index et un `ANALYZE` (incident du 2026-10-25).
- Conventions du dépôt (`CLAUDE.md`) : services `{ data, error }` via `withErrorHandling`, mutations déballées par `unwrapResult`, clés dans `cacheKeys.js` avec `orgId` en premier, `logger` et non `console`, composants sous 500 lignes, Tailwind seul, `Combobox` au lieu du `<select>` natif, fenêtres de confirmation `ConfirmDialog`.
- Ne jamais lancer de serveur de développement ni d'outil d'aperçu : la preuve est `npm run audit:quality` et `npx vite build`.
- Commits par chemins explicites (`git commit … -- <fichiers>`) : d'autres sessions travaillent sur `main`. Migrations en production, déploiement et push : sur le oui d'Eric, à la Task 10.

## Review Focus

1. **Prix écrits à la française** : « 1 234,50 € », « 1.234,50 », « 12,5 » HT, et « 0,2 » ou « 20 % » pour la TVA. Une valeur mal lue fausse la marge en silence. → Task 1.
2. **Même fichier importé deux fois** : rien ne doit être recréé par défaut, ni les articles sans code ni EAN (doublon par marque + modèle, puis par désignation). → Task 3.
3. **Fournisseur écrit autrement que dans la base** : « BAYWA r.e. SAS » et « Baywa RE » désignent le même fournisseur, et il ne doit pas être recréé. → Task 3.
4. **Relevé qui arrive après l'import avec d'autres références** : l'article importé doit se rattacher ou être proposé à la fusion, jamais doublé. → Task 7.
5. **Lot renvoyé après une coupure** : aucun doublon d'article ni de ligne fournisseur, et l'écran dit ce qui est déjà créé. → Task 5 (assertion) et Task 8.

## File Structure

| Fichier | Rôle |
|---|---|
| `src/lib/importArticles/champs.js` | Catalogue des 18 champs, seule définition |
| `src/lib/importArticles/normaliser.js` | Mise en forme d'une valeur (prix, TVA, EAN, date, texte) |
| `src/lib/importArticles/correspondance.js` | Colonnes → champs (proposer, valider, appliquer), sans cible composée |
| `src/lib/importArticles/valeurs.js` | Valeurs à interpréter : nature, catégorie, unité |
| `src/lib/importArticles/fournisseurs.js` | Rapprochement des noms de fournisseurs |
| `src/lib/importArticles/controles.js` | Contrôler une ligne, doublons, bilan, lignes à écrire |
| `src/lib/importArticles/lots.js` | `verifierLigneArticle` (miroir de la RPC), messages d'erreur |
| `src/lib/importArticles/fichierType.js` | Fichier type et fichier des lignes écartées (données seulement) |
| `src/lib/importArticles/libelles.js` | Phrases du bilan, du retrait, des corrections |
| `scripts/import-articles/*.test.mjs` | Un test par module ci-dessus |
| `supabase/migrations/20261129_2_catalog_import.sql` | Écrivain étendu, table, colonnes, vue, RPC d'écriture |
| `supabase/migrations/20261129_3_catalog_import_retrait.sql` | Aperçu et retrait |
| `supabase/migrations/20261129_4_rattachement_articles_sans_offre.sql` | `catalog_items_ensure` et propositions étendus |
| `scripts/migration-rehearsal/assert-catalog-import.sql`, `assert-catalog-import-retrait.sql`, `assert-rattachement-articles-sans-offre.sql` | Assertions du harnais |
| `src/shared/services/catalogImports.service.js` | Lectures et appels RPC |
| `src/shared/hooks/useCatalogImports.js` | Liste des imports, données de contrôle, exécution, retrait |
| `src/apps/artisan/pages/settings/catalogue/ArticlesImport.jsx` | Page : garde org_admin, assemble les étapes |
| `src/apps/artisan/components/catalogue/import/` | `useParcoursImportArticles.js`, `EtapeFichier.jsx`, `EtapeColonnes.jsx`, `EtapeApercu.jsx`, `EtapeResultat.jsx`, `ImportsPrecedents.jsx` |

**Réutilisés sans modification :** `lireFichier.js`, `cleEntete` (`importClients/champs.js`), `decouperEnLots`, `executerLots`, `lireReponseRetrait`, `TAILLE_LOT`, `TAILLE_LOT_RETRAIT` (`importClients/lots.js`), `lireFichierDepose`, `telechargerClasseur` (`components/clients/import/classeur.js`), `lireSaisieDate` (`src/lib/datesFr.js`), `calculerModelKey` (`src/lib/catalogue/modelKey.js`), `fetchAllPages` (`src/lib/postgrestUtils.js`).

**Décision :** la correspondance des articles a son propre module court. Celle des clients est bâtie sur les cibles composées, les civilités et l'ordre nom / prénom. La rendre générique risquerait l'import des clients, déjà en production, pour une quarantaine de lignes. Seul `cleEntete` est partagé.

Les numéros de migration (`20261129_2` à `_4`) se remplacent par les premiers numéros libres le jour où elles sont écrites (`20261129_1` est déjà pris).

---

### Task 1: Champs et mise en forme des valeurs

**Files:**
- Create: `src/lib/importArticles/champs.js`, `src/lib/importArticles/normaliser.js`, `scripts/import-articles/champs.test.mjs`, `scripts/import-articles/normaliser.test.mjs`
- Modify: `package.json` (ajouter chaque `scripts/import-articles/*.test.mjs` à `audit:quality`, à cette tâche et aux suivantes)

**Interfaces:**
- Produces:
  - `CHAMPS_ARTICLE: Array<{ cle, libelle, type, synonymes: string[], exemple, aide, fournisseur?: true }>`. Les clés, dans l'ordre du fichier type : `designation, code, marque, modele, ean, categorie, gamme, nature, unite, tva, prix_vente, description, fournisseur, ref_fournisseur, prix_achat, prix_public, date_prix, ancien_numero`. Les types possibles sont `texte | prix | tva | ean | date | valeur` (`valeur` = nature, catégorie, unité, interprétées par la Task 2). `fournisseur: true` marque les cinq derniers champs liés au fournisseur.
  - `champArticle(cle): object | null`, `cibleArticleDepuisEntete(entete): string` (clé, ou `''` si l'en-tête n'est pas reconnu, via `cleEntete`).
  - `normaliserArticle(champ, brut, maintenant = new Date()): { valeur: string | number | null, illisible: boolean }`.

- [ ] **Step 1: Écrire les tests**
  - `champs.test.mjs` : 18 clés uniques ; aucun synonyme partagé par deux champs (comparaison sur `cleEntete`) ; `cibleArticleDepuisEntete('Désignation') === 'designation'`, `('Libellé') === 'designation'`, `('Réf. interne') === 'code'`, `('Code article') === 'code'`, `('PU HT') === 'prix_vente'`, `('Prix d\'achat') === 'prix_achat'`, `('Gencod') === 'ean'`, `('Réf. fabricant') === 'modele'`, `('Fournisseur principal') === 'fournisseur'`, `('Réf. fournisseur') === 'ref_fournisseur'`, `('Colonne X') === ''`. « Note », « Remarque » et « Client » ne sont synonymes de rien.
  - `normaliser.test.mjs` :
    - prix : `'1 234,50 €'` → 1234.5, `'1.234,50'` → 1234.5, `'12,5'` → 12.5, `'12.50'` → 12.5, `'1 234'` (espace fine U+202F) → 1234 ; `'abc'` et `'-3'` → `{ valeur: null, illisible: true }` ; `''` → `{ valeur: null, illisible: false }`.
    - TVA : `'20'`, `'20 %'`, `'0,2'`, `'0.2'` → 20 ; `'5,5'`, `'0,055'` → 5.5 ; `'10'` → 10 ; `'0'` → 0 ; `'7'` → `{ valeur: null, illisible: true }`.
    - EAN : `'3 760 123 456 789'` → `'3760123456789'` ; `'-'` et `'12AB'` → illisible ; un nombre d'Excel `'3.760123456789E12'` (rendu par `celluleEnTexte`) → `'3760123456789'`.
    - date : `'2026-03-15'` (cellule date d'Excel) → `'2026-03-15'` ; `'15/03/2026'` → `'2026-03-15'` ; une date postérieure à `maintenant` → illisible ; `'32/13/2026'` → illisible.
    - texte : espaces de bord retirés, `''` → null.

- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test scripts/import-articles/champs.test.mjs scripts/import-articles/normaliser.test.mjs` → FAIL (modules absents).
- [ ] **Step 3: Écrire `champs.js` et `normaliser.js`**, deux modules purs en imports relatifs. Pour les prix, on retire les espaces (U+0020, U+00A0, U+202F) et `€`. S'il y a une virgule, elle est décimale et les points sont des séparateurs de milliers ; sinon le point est décimal. Pour la TVA, une valeur < 1 est multipliée par 100, puis seules 0, 5,5, 10 et 20 sont admises. Les dates passent par `lireSaisieDate`. Le prix TTC n'est jamais deviné.
- [ ] **Step 4: Lancer, vérifier le succès** — même commande → PASS.
- [ ] **Step 5: Committer** — `feat(import articles): catalogue des champs et lecture des valeurs`.

---

### Task 2: Correspondance des colonnes et valeurs à interpréter

**Files:**
- Create: `src/lib/importArticles/correspondance.js`, `src/lib/importArticles/valeurs.js`, `scripts/import-articles/correspondance.test.mjs`, `scripts/import-articles/valeurs.test.mjs`
- Modify: `src/lib/catalogue/natures.js` (exporter `UNITES_ARTICLE`)

**Interfaces:**
- Consumes: `CHAMPS_ARTICLE`, `cibleArticleDepuisEntete` (Task 1) ; `CIBLE_IGNORER`, `CIBLE_A_CHOISIR` de `importClients/champs.js`.
- Produces:
  - `proposerCorrespondanceArticles(entetes: string[]): Correspondance` (même forme `{ index, entete, cible, origine }` que les clients ; un champ déjà pris n'est pas reproposé).
  - `validerCorrespondanceArticles(c): { erreurs: string[], aChoisir: number, avecFournisseur: boolean }`. Erreurs : deux colonnes vers le même champ ; « Indiquez la colonne de la désignation. » si `designation` manque. `avecFournisseur` vaut vrai quand `fournisseur`, `ref_fournisseur` et `prix_achat` sont tous trois choisis.
  - `appliquerCorrespondanceArticles(ligne: { numero, cellules }, c): { numero, valeurs: Record<cle, string> }`.
  - `NATURE_ECARTER = '@ecarter'`.
  - `proposerValeurs(cle: 'nature'|'categorie'|'unite', distinctes: string[], options: Array<{ value, label }>): Record<string, string>` : valeur du fichier → valeur Majord'home, `''` = inconnue. Pour `nature`, `NATURE_ECARTER` est possible.
  - `valeursDistinctes(lignes: Array<{ valeurs }>, cle): string[]` (triées, sans vide).

- [ ] **Step 1: Écrire les tests**
  - `correspondance` : en-têtes `['Désignation','Réf','PU HT','Fournisseur','Réf. fournisseur','Prix d\'achat','Bidule']` → cibles `designation, code, prix_vente, fournisseur, ref_fournisseur, prix_achat, ''` ; `avecFournisseur === true`. Sans « Prix d'achat », `avecFournisseur === false`. Deux colonnes « Désignation » → une erreur et la seconde à choisir. `appliquer` ne pose que les cellules non vides, et la première l'emporte.
  - `valeurs` (nature, options = `NATURES_ARTICLE`) : `Fourniture` → `main` ; `MO`, `Main d'oeuvre`, `Main-d’œuvre` → `main_oeuvre` ; `Option`, `Accessoire` → `accessory` ; `Stock` → `stock` ; `Ouvrage` → `@ecarter` ; `Truc` → `''`.
  - `valeurs` (catégorie, options passées par le test `[{ value: 'poele', label: 'Poêle' }, { value: 'climatisation', label: 'Climatisation' }]`) : `Poêles`, `POELE`, `poele` → `poele` ; `Clim` → `''`. La comparaison se fait par `cleEntete`, singulier ou pluriel en `s`.
  - `valeurs` (unité, options = `UNITES_ARTICLE`) : `U`, `Unité`, `pce`, `Pièce` → `pièce` ; `ML`, `m` → `ml` ; `m2`, `M²` → `m²` ; `Forfait`, `Ft` → `forfait` ; `H`, `heure` → `h`.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire les deux modules.** Les catégories viennent de l'appelant (`PRODUCT_CATEGORIES` vit dans un service, qu'un module pur n'importe pas).
- [ ] **Step 4: Lancer, vérifier le succès.**
- [ ] **Step 5: Committer** — `feat(import articles): correspondance des colonnes et des valeurs`.

---

### Task 3: Fournisseurs, contrôles, doublons, bilan

**Files:**
- Create: `src/lib/importArticles/fournisseurs.js`, `src/lib/importArticles/controles.js`, `scripts/import-articles/fournisseurs.test.mjs`, `scripts/import-articles/controles.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 et 2, `calculerModelKey(marque, textes)`.
- Produces:
  - `cleFournisseur(nom): string` : sans accents ni casse ni ponctuation, formes juridiques retirées (`sarl sas sasu sa eurl snc sci scop`), espaces réduits.
  - `rapprocherFournisseurs(noms: string[], existants: Array<{ id, name }>): Array<{ nom, cle, supplierId: string | null, aCreer: boolean }>` : une entrée par `cle` distincte, et `aCreer = supplierId === null`.
  - `controlerArticle(valeurs, { valeursInterpretees, avecFournisseur }): { fiche: Fiche | null, raison: 'sans_designation' | 'ouvrage' | null, corrections: string[], ligneFournisseur: 'oui' | 'sans_prix' | 'sans_reference' | 'sans_fournisseur' | 'non_demandee' }`. Les clés de `Fiche` reprennent celles de la ligne envoyée (Task 4). `model_key = calculerModelKey(marque, [modele, designation])`, et le modèle brut est gardé en `modele_brut`. `corrections` porte les clés des champs vidés ou remplacés (prix illisible, EAN invalide, catégorie inconnue, unité remplacée par `pièce`, TVA remplacée par 20, date future).
  - `classerArticles(candidats, existant): Classee[]`. `existant = { articles: Array<{ id, code, code_ean, brand, model_key, name, product_kind }>, lignes: Array<{ supplier_id, reference }> }`. Chaque `Classee` vaut `{ numero, fiche, raison, doublon: null | { force: 'fort' | 'faible', motif: 'code' | 'ean' | 'marque_modele' | 'ligne_fournisseur' | 'designation' | 'fichier_code' | 'fichier', articleId?: string }, recochable: boolean }`.
  - `aImporter(classee, choix: Record<numero, boolean>): boolean`, `choixPourTousLesDoublons(classees, choix, reprendre: boolean)`, `bilan(classees, choix): { lues, importees, doublons, ecartees, lignesFournisseur }`.
  - `lignesPourEcriture(classees, choix, fournisseursResolus: Record<cle, string>): RowArticle[]` (forme dans la Task 4). Une ligne `ligne_fournisseur` recochée part **sans** `fournisseur`.

- [ ] **Step 1: Écrire les tests**
  - `fournisseurs` : `cleFournisseur('BAYWA r.e. SAS') === cleFournisseur('Baywa RE')` ; `'Cédéo'` = `'CEDEO'` ; `'Tereva SA'` ≠ `'Tereva Distribution'`. `rapprocherFournisseurs(['Baywa RE','BAYWA R.E.','Cedeo'], [{ id: 'b1', name: 'BayWa r.e.' }])` → 2 entrées : `b1` et `aCreer`.
  - `controles` :
    - Ligne sans désignation → `raison = 'sans_designation'`. Nature `@ecarter` → `'ouvrage'`.
    - Avec `avecFournisseur` : prix d'achat 0 → `ligneFournisseur = 'sans_prix'` et l'article reste importable.
    - Doublons forts, écartés par défaut : code existant (insensible à la casse, `' ref-1 '` = `'REF-1'`), **non recochable** ; EAN valide existant, recochable ; marque + `model_key` existants (marque comparée sans casse), recochable ; `(supplier_id, reference)` existant → `motif 'ligne_fournisseur'`, recochable, et sa ligne d'écriture n'a pas de `fournisseur`.
    - `lignesPourEcriture` produit des objets aux clés exactes de `RowArticle` (Task 4), sans `org_id`.
    - Doublon faible : même désignation (par `cleEntete`), sans marque des deux côtés. Importé par défaut.
    - Dans le fichier : deux lignes avec le même code → la seconde `fichier_code`, non recochable ; deux lignes identiques par marque + modèle → la seconde `fichier`, recochable.
    - **Invariant** : sur un jeu de 12 lignes qui couvre tous les cas, `lues === importees + doublons + ecartees` pour trois jeux de `choix` différents.
    - **Même fichier deux fois** : les fiches d'un premier passage, transformées en `existant.articles`, rendent toutes les lignes doublons fortes, y compris celles qui n'ont que marque + modèle.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire les deux modules.**
- [ ] **Step 4: Lancer, vérifier le succès.**
- [ ] **Step 5: Committer** — `feat(import articles): fournisseurs, doublons et bilan`.

---

### Task 4: Ligne envoyée, messages, fichier type, libellés

**Files:**
- Create: `src/lib/importArticles/lots.js`, `src/lib/importArticles/fichierType.js`, `src/lib/importArticles/libelles.js` et leurs trois tests dans `scripts/import-articles/`

**Interfaces:**
- Produces:
  - Forme `RowArticle` (seule forme acceptée par `catalog_items_import_batch`, Task 5) : `{ import_line: int, name, code, brand, model_key, modele_brut, code_ean, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht, description, ancien_numero, fournisseur: null | { supplier_id, reference, purchase_price_ht, tarif_public, purchase_price_at } }`.
  - `verifierLigneArticle(row): string | null` : la clé que la RPC refuserait, ou null. Règles : `import_line` entier ≥ 1 ; `name` non vide ; `product_kind ∈ main|accessory|stock|main_oeuvre` ; `default_tva_rate ∈ 0|5.5|10|20` ; `selling_price_ht` nombre ≥ 0 ; `code_ean` null ou `^[0-9]{8,14}$` ; `fournisseur` null ou avec `supplier_id` uuid, `reference` non vide, `purchase_price_ht` > 0, `purchase_price_at` null ou `aaaa-mm-jj`. Une clé hors de la forme n'est pas refusée (la RPC l'ignore, liste fermée) ; le test de `lignesPourEcriture` (Task 3) vérifie que les lignes produites ont exactement les clés de `RowArticle`.
  - `messageErreurImportArticles(error): string`, sur le modèle de `messageErreurImport` des clients. Il traduit `row_invalid` (détail `ligne N : colonne`), `code_pris`, `ligne_fournisseur_existante` (détail `ligne N`), `supplier_not_in_org`, `import_closed`, `org_admin_required`, `unauthenticated`, `import_not_found`, les délais (`57014`, `55P03`) et le réseau.
  - `feuillesFichierTypeArticles(): Array<{ nom, lignes: string[][] }>` (feuille « Articles » : libellés de `CHAMPS_ARTICLE`, puis une ligne d'exemple ; feuille « Aide » : libellé, aide, exemple). `feuilleLignesEcarteesArticles(entetes, lignes, classees, choix)`.
  - `phraseBilanArticles(bilan)`, `texteRetraitArticles({ retirables, conservees })`, `texteCorrectionsArticles(resume)`, `texteDateDuPrix(nSansDate)` (« 12 prix d'achat sans date : ils seront affichés « date inconnue » et remplacés au premier relevé de leur fournisseur. »).
- [ ] **Step 1: Écrire les tests.** `verifierLigneArticle` sur une ligne valide et sur chaque règle cassée ; chaque code d'erreur de la Task 5 a sa phrase, et une phrase n'est jamais le code brut ; le fichier type relu par `proposerCorrespondanceArticles` donne exactement les 18 champs.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire les trois modules.** Commentaire en tête de `lots.js` : « miroir de `catalog_items_import_batch` (migration 20261129_2), à modifier ensemble ».
- [ ] **Step 4: Lancer, vérifier le succès**, puis lancer `npm run audit:quality`. Attendu : vert, sans fichier mort (les modules sont importés par leurs tests ; s'ils sont signalés comme jamais importés, ajouter le dossier à `ALLOW_ORPHAN` de l'audit jusqu'à la Task 9, comme pour l'import des clients, et le retirer à la Task 9).
- [ ] **Step 5: Committer** — `feat(import articles): ligne envoyée, messages et fichier type`.

---

### Task 5: Base — écrivain étendu, imports, écriture par lots

**Files:**
- Create: `supabase/migrations/20261129_2_catalog_import.sql`, `scripts/migration-rehearsal/assert-catalog-import.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (s'ils manquent : colonnes de `catalog_items` et de `supplier_products` lues par la migration, `majordhome.suppliers`, vue `majordhome_catalog_items` et les vues qui lisent `catalog_items`, `supplier_catalog_upsert`), `docs/DATABASE.md`

**Interfaces:**
- Consumes: forme `RowArticle` (Task 4).
- Produces (appelées par la Task 8) :
  - `public.catalog_items_import_start(p_org_id uuid, p_file_name text, p_mapping jsonb, p_counts jsonb, p_fournisseurs jsonb) RETURNS jsonb`. `p_fournisseurs = [{ "nom": text, "supplier_id": uuid | null }]` ; un `supplier_id` null crée le fournisseur (`name` = nom tel qu'écrit dans le fichier, `is_active = true`, org de l'import). Retour : `{ "import_id": uuid, "fournisseurs": [{ "nom", "supplier_id", "cree": bool }] }`.
  - `public.catalog_items_import_batch(p_import_id uuid, p_rows jsonb) RETURNS jsonb` → `{ "created": n, "skipped": n, "lignes_fournisseur": n }`.
  - `public.catalog_items_import_finish(p_import_id uuid, p_counts jsonb) RETURNS void`.
  - Vue `public.majordhome_catalog_imports` : `id, org_id, created_by, created_by_name, created_at, file_name, counts, status, removed_at`.
  - `supplier_catalog_upsert` : clé de ligne facultative `catalog_item_id` (posée **à l'insertion seulement**, si l'article est de la même org et vivant, avec `catalog_item_link_source = 'import'` et `catalog_item_linked_at = now()`) ; clé de `p_meta` facultative `prix_sans_date` (si vraie, une `purchase_price_at` absente reste NULL à l'insertion au lieu de `now()`).
  - Codes : `unauthenticated`, `org_admin_required` (42501), `import_not_found` (P0002), `import_closed`, `rows_invalid`, `row_invalid`, `code_pris`, `ligne_fournisseur_existante`, `supplier_not_in_org`.

- [ ] **Step 1: Écrire l'assertion du harnais** (blocs `DO $$ … RAISE EXCEPTION … $$`, identité sous `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated`). Elle échoue si l'un de ces faits est faux :
  1. `anon` n'exécute aucune des trois RPC (`has_function_privilege`), ni aucune fonction interne ; `majordhome_catalog_imports` est `security_invoker` et `anon` n'y a aucun droit ; `authenticated` n'a toujours pas UPDATE sur `catalog_items.model_key`, `code_ean`, `origin` ni `import_id`.
  2. org_admin de A : `start` avec un fournisseur existant et un fournisseur « Nouveau » à créer → le second est créé dans A. Un `batch` de 4 lignes (2 avec `fournisseur`, 2 sans) rend `created = 4, lignes_fournisseur = 2`. Les 4 articles ont `origin = 'manuel'`, `import_id`, `import_line`, `model_key` et `code_ean` tels qu'envoyés. Les 2 lignes fournisseur ont `catalog_item_id` = leur article, `catalog_item_link_source = 'import'`, `specs.source_version = 'import-articles_<import_id>'`, `is_active`. Celle envoyée sans date a `purchase_price_at IS NULL`, l'autre a la date envoyée. **Aucun autre article n'a été créé** (`catalog_items_ensure` ne les a pas vues).
  3. Le même lot renvoyé rend `created = 0, skipped = 4`, et ni les articles ni les lignes fournisseur ne changent de nombre.
  4. Une ligne avec `product_kind = 'ouvrage'` → `row_invalid` et **aucune** écriture du lot. Une ligne dont le `code` existe déjà dans A (casse différente) → `code_pris`. Une ligne dont `(supplier_id, reference)` existe déjà → `ligne_fournisseur_existante`, et la ligne existante n'a pas bougé (prix, date, `is_active`). Un `supplier_id` de B → `supplier_not_in_org`. Une clé `org_id` dans une ligne est ignorée (l'article est dans A).
  5. Refus `org_admin_required` : membre non administrateur de A ; org_admin de B sur l'import de A (`batch`, `finish`) ; `start` par un org_admin de B avec `p_org_id` = A. Sans jeton : `unauthenticated`.
  6. `finish` → `termine`, et un `batch` ensuite lève `import_closed`.
  7. **Les relevés n'ont pas changé** : un appel à `supplier_catalog_upsert` sans les nouvelles clés (service_role) sur une nouvelle référence crée sa ligne avec `purchase_price_at` non nul, et `catalog_items_ensure` lui crée un article comme avant.
  8. Un relevé de la même référence (même fournisseur, autre `source_version`, nouveau prix) met à jour **en place** la ligne créée par l'import : même `id`, même `catalog_item_id`, nouveau prix, `purchase_price_at` non nul.
  9. Un membre de B ne lit aucune ligne de `majordhome_catalog_imports` de A.
- [ ] **Step 2: Lancer, vérifier l'échec**

```bash
node scripts/migration-rehearsal/snapshot.mjs --env .env.local
node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-catalog-import.sql
```
Attendu : échec (« function public.catalog_items_import_start does not exist »).

- [ ] **Step 3: Écrire la migration**
  - `supplier_catalog_upsert` recréée depuis sa dernière définition (`20261111_2`, lire `pg_get_functiondef` en production pour partir de l'état réel), avec les deux clés facultatives et rien d'autre de changé. Mêmes `REVOKE` / `GRANT` (service_role seul).
  - CHECK `supplier_products_catalog_item_link_source_check` : ajouter `import`.
  - Table `majordhome.catalog_imports`, calquée sur `client_imports` : `id, org_id, created_by, created_at, file_name, mapping, counts, status ('en_cours','termine','retire'), fournisseurs_crees uuid[] NOT NULL DEFAULT '{}', removed_at, removed_by`. RLS : une seule policy, SELECT pour un org_admin de `org_id`. `GRANT SELECT … TO service_role`.
  - `catalog_items` : `import_id uuid REFERENCES majordhome.catalog_imports(id) ON DELETE SET NULL`, `import_line integer`, index unique partiel `(import_id, import_line) WHERE import_id IS NOT NULL`. La vue `majordhome_catalog_items` n'est pas modifiée.
  - Garde interne `majordhome.catalog_import_org_admin(p_import_id uuid) RETURNS uuid` (rend l'org de l'import, sinon lève une erreur).
  - `catalog_items_import_batch` : 1 à 500 objets ; l'import doit être `en_cours`. Par ligne, les contrôles de `verifierLigneArticle` (`row_invalid`, détail `ligne N : colonne`), `code_pris` (code déjà pris dans l'org, `lower`), et pour une ligne avec `fournisseur` : fournisseur de l'org (`supplier_not_in_org`) et `(supplier_id, reference)` absent (`ligne_fournisseur_existante`). Une ligne déjà écrite pour `(import_id, import_line)` est comptée `skipped`. Sinon, `INSERT` dans `catalog_items` avec la **liste fermée** des colonnes, `specs.canonical` = `{ modele_import, ancien_numero }` non vides, `origin = 'manuel'`. Puis un appel à `supplier_catalog_upsert` **par fournisseur du lot**, avec les seules lignes à créer (`reference`, `name`, `brand`, `product_kind`, `category`, `gamme`, `unit`, `default_tva_rate`, `purchase_price_ht`, `purchase_price_at`, `tarif_public`, `selling_price_ht_defaut` = prix de vente de l'article, `model_key`, `catalog_item_id`), `p_source_version = 'import-articles_' || import_id`, `p_meta = '{"desactiver_absents": false, "prix_sans_date": true}'`. Tout le lot réussit, ou rien n'est écrit.
  - `catalog_items_import_start` crée les fournisseurs manquants, les note dans `fournisseurs_crees`, et refuse un `supplier_id` hors de l'org.
- [ ] **Step 4: Répéter la migration, vérifier le succès**

```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261129_2_catalog_import.sql --assert scripts/migration-rehearsal/assert-catalog-import.sql
```
Attendu : toutes les assertions passent.

- [ ] **Step 5: Mesurer un lot de 200** (dont 100 avec fournisseur) : bloc `DO` sous l'identité d'un org_admin, `clock_timestamp()` avant et après, `RAISE EXCEPTION 'duree_ms=%'`. Attendu : sous 2 000 ms (PostgREST coupe à 8 s). Au-dessus, fixer une taille de lot articles plus petite dans `importArticles/lots.js` (`TAILLE_LOT_ARTICLES`) et noter la mesure dans l'en-tête de la migration.
- [ ] **Step 6: Documenter et committer** — `docs/DATABASE.md` (table, colonnes, nouvelles clés de l'upsert) ; commit `feat(import articles): table des imports et écriture par lots`.

---

### Task 6: Base — aperçu et retrait d'un import

**Files:**
- Create: `supabase/migrations/20261129_3_catalog_import_retrait.sql`, `scripts/migration-rehearsal/assert-catalog-import-retrait.sql`

**Interfaces:**
- Produces :
  - `public.catalog_items_import_removal_preview(p_import_id uuid) RETURNS jsonb` → `{ "retirables": n, "conservees": n }`.
  - `public.catalog_items_import_remove(p_import_id uuid, p_limit integer DEFAULT 100) RETURNS jsonb` → `{ "retirees": n, "conservees": n, "restantes": n }` (mêmes clés que les clients, pour `lireReponseRetrait`).
- Règle (spec § 6.6). Un article de l'import est **retirable** si rien ne le référence, sauf ses propres lignes fournisseur créées par l'import et **jamais reprises** (`catalog_item_link_source = 'import'` ET `specs->>'source_version' = 'import-articles_<import_id>'`). Les références se lisent dans `pg_constraint` à l'exécution (toute clé étrangère vers `majordhome.catalog_items`, y compris `merged_into`), par `EXECUTE format(…)` sur un tableau d'identifiants, sans table temporaire. Le retrait supprime ces lignes fournisseur, puis l'article. Un article dont une ligne a été reprise par un relevé est **conservé**. Les fournisseurs créés ne sont jamais supprimés. À `restantes = 0` : `status = 'retire'`, `removed_at`, `removed_by`.

- [ ] **Step 1: Écrire l'assertion.** Sur un import de 5 articles : un article est cité par une ligne de devis ; un deuxième a sa ligne fournisseur reprise par un relevé (appel à l'upsert avec une autre `source_version`) ; un troisième a une ligne fournisseur jamais reprise ; deux sont sans fournisseur. Attendu : `preview` = `{ retirables: 3, conservees: 2 }`, et `remove(…, 2)` puis `remove(…, 2)` → total `retirees = 3`, `restantes = 0`, import `retire`. L'article cité et l'article repris existent toujours, la ligne reprise existe et est active, la ligne jamais reprise n'existe plus, le fournisseur créé existe. Droits : mêmes refus qu'à la Task 5 (5).
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire la migration.**
- [ ] **Step 4: Répéter, vérifier le succès** ; mesurer `remove(…, 100)` : sous 2 000 ms, sinon ajuster `TAILLE_LOT_RETRAIT_ARTICLES` dans `importArticles/lots.js`.
- [ ] **Step 5: Committer** — `feat(import articles): aperçu et retrait d'un import`.

---

### Task 7: Base — les fournisseurs se rattachent aux articles qui n'en ont pas

**Files:**
- Create: `supabase/migrations/20261129_4_rattachement_articles_sans_offre.sql`, `scripts/migration-rehearsal/assert-rattachement-articles-sans-offre.sql`

**Interfaces:**
- Modifie `public.catalog_items_ensure(uuid, integer)` et `public.catalog_item_proposals_propose(uuid)`, recréées depuis leur définition en production (`pg_get_functiondef`). Signatures, droits et retours inchangés.
- Étape 2 de `ensure` (spec § 6.5). Un article est candidat s'il a la même nature et les mêmes clés (marque + `model_key`, ou EAN valide) **portées par l'article lui-même ou par ses lignes**, et qu'il est le seul candidat. Le test « déjà une ligne de ce fournisseur » ne compte que les lignes **actives**. Contrôle du prix : si l'article a une ligne active avec un prix, la règle actuelle s'applique (rapport ≤ 2) ; sinon, le prix d'achat de la ligne doit être ≤ au prix de vente de l'article quand celui-ci est > 0, et il n'y a pas de contrôle quand il vaut 0.
- `propose` : `t_cles` reçoit aussi, pour chaque article vivant, sa propre ligne `(item, product_kind, created_at, supplier_id NULL, lower(brand), model_key, ean)`. Les garde-fous de `20261027_5` sont conservés (clé partagée par plus de 10 articles écartée, index + `ANALYZE`). Le test « fournisseur commun » ignore les `supplier_id` NULL.

- [ ] **Step 1: Écrire l'assertion**
  1. Un article importé (sans ligne, marque `BAYWA`, `model_key` `X1`, prix de vente 100). Un relevé BAYWA d'une ligne même marque, même modèle, achat 60 → rattachée à cet article (`cle`), aucun article créé. Même cas avec un achat de 150 → pas rattachée, un article créé, puis `propose` crée une proposition entre les deux.
  2. Un article importé avec EAN valide. Une ligne d'un autre fournisseur avec le même EAN → rattachée (`ean`).
  3. Deux articles importés avec les mêmes clés : une ligne ne se rattache à aucun des deux (deux candidats).
  4. Un article dont la seule ligne BAYWA est **inactive**. Une nouvelle ligne BAYWA, même marque et même modèle, autre référence → rattachée.
  5. Non-régression : sur le scénario des assertions existantes `assert-catalog-items.sql` et `assert-catalog-items-harmonisation.sql`, les résultats restent identiques (rejouer ces deux fichiers dans la même chaîne).
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire la migration.**
- [ ] **Step 4: Répéter, vérifier le succès** (les trois assertions de catalogue passent ensemble).
- [ ] **Step 5: Mesure à préparer pour la mise en production** : écrire `scripts/catalogue/mesure-rattachement-sans-offre.sql`, en lecture seule, qui compte par organisation les articles vivants **sans ligne active avec prix** et qui portent des clés, c'est-à-dire ceux qui deviennent candidats. Résultat à noter avant et après la Task 10.
- [ ] **Step 6: Committer** — `feat(catalogue): les relevés se rattachent aux articles sans fournisseur`.

---

### Task 8: Service, clés de cache, hooks

**Files:**
- Create: `src/shared/services/catalogImports.service.js`, `src/shared/hooks/useCatalogImports.js`
- Modify: `src/shared/hooks/cacheKeys.js` (`catalogImportKeys = { all: (orgId) => ['catalog-imports', orgId], list: (orgId) => […], existant: (orgId, supplierIds) => […] }`)

**Interfaces:**
- Consumes: les RPC des Tasks 5 et 6 ; `messageErreurImportArticles`, `decouperEnLots`, `executerLots`, `lireReponseRetrait`.
- Produces:
  - `catalogImportsService` : `listImports(orgId)`, `getExistant(orgId, supplierIds)` → `{ articles, lignes }` (articles vivants : `id, code, code_ean, brand, model_key, name, product_kind` depuis `majordhome_catalog_items`, lus en entier par `fetchAllPages` avec tri stable sur `id` ; lignes `supplier_id, reference` des seuls `supplierIds` existants, actives ou non, depuis `majordhome_supplier_products_write` ou la vue de lecture qui expose ces colonnes), `getSuppliers(orgId)` (`id, name`), `start`, `batch`, `finish`, `removalPreview`, `remove`. Tous rendent `{ data, error }`.
  - `useCatalogImports(orgId)` → `{ imports, isLoading }` ; `useExistantArticles(orgId, supplierIds)` → `{ existant: undefined | { articles, lignes } }` (`undefined` pendant le chargement, une nouvelle lecture ou un échec : jamais un objet vide) ; `useExecuterImportArticles(orgId)` → `{ lancer({ import, lignes, depuis }), reprendre, etat }` (lots via `executerLots`, reprise au lot refusé) ; `useRetirerImportArticles(orgId)`.
  - Après un lot réussi et à la fin : invalider `catalogImportKeys.all(orgId)` et la famille des articles (`catalogItemKeys` ou la clé existante de `useCatalogItems`) et des fournisseurs.
- [ ] **Step 1: Écrire le service et les hooks**, avec `unwrapResult` dans chaque `mutationFn` et `enabled: !!orgId`.
- [ ] **Step 2: Vérifier** : `grep -rnE "mutationFn: .*=> *[a-zA-Z]+Service\.[a-zA-Z]+\(" src/shared/hooks | grep -v "unwrap("` ne remonte que `useGoogleCalendar`. `npm run lint:errors` doit être vert.
- [ ] **Step 3: Committer** — `feat(import articles): service et hooks`.

---

### Task 9: La page d'import

**Files:**
- Create: `src/apps/artisan/pages/settings/catalogue/ArticlesImport.jsx`, `src/apps/artisan/components/catalogue/import/useParcoursImportArticles.js`, `EtapeFichier.jsx`, `EtapeColonnes.jsx`, `EtapeApercu.jsx`, `EtapeResultat.jsx`, `ImportsPrecedents.jsx`
- Modify: `src/apps/artisan/routes.jsx` (route `settings/suppliers/articles/import`, même `RouteGuard resource="articles" action="edit"` que la page Articles, et `<Navigate to="/settings/suppliers/articles" replace />` dans la page si `!isOrgAdmin`) ; `src/lib/modules.js` si la route doit y être déclarée (`moduleDeRoute` testé contre `routes.jsx`) ; `ArticlesPage.jsx` (bouton « Importer », `secondary`, visible si `isOrgAdmin`, à gauche de l'action principale) ; l'audit du code mort (retirer l'exception posée en Task 4)

**Interfaces:**
- Consumes: Tasks 1 à 4 et 8 ; `lireFichierDepose`, `telechargerClasseur` ; `PRODUCT_CATEGORIES`, `NATURES_ARTICLE`, `UNITES_ARTICLE`.
- Le parcours est un réducteur (`useParcoursImportArticles`), étapes `fichier → colonnes → apercu → envoi → resultat`. Les composants ne calculent rien : ils lisent les modules purs.
- **Aperçu** (spec § 5) : bilan `phraseBilanArticles` ; liste des fournisseurs (`rapprocherFournisseurs`) avec, pour chaque nom à créer, une coche « Créer » cochée par défaut (un nom décoché envoie ses lignes sans fournisseur) ; tableau des valeurs à interpréter pour nature, catégorie et unité, une ligne par valeur distincte, `Combobox` des valeurs Majord'home (`proposerValeurs` en présélection) ; doublons avec « Tout importer / Tout écarter » ; `texteCorrectionsArticles` et `texteDateDuPrix`. **« Importer » est fermé** tant que `existant === undefined`, qu'une erreur de correspondance reste, ou que zéro ligne est à importer.
- **Envoi** : `start` avec les fournisseurs choisis, puis remplacement des noms par les `supplier_id` rendus, puis `lignesPourEcriture` et les lots. Avant l'envoi, chaque ligne passe par `verifierLigneArticle` : une ligne refusée est écartée avec sa raison, jamais envoyée. Barre d'avancement ; en cas d'arrêt, « Reprendre » repart du lot refusé.
- **Résultat** : compteurs, téléchargement des lignes écartées (`feuilleLignesEcarteesArticles`).
- **Imports précédents** : liste (date, auteur, compteurs, statut), « Retirer cet import » → `ConfirmDialog` avec le texte `texteRetraitArticles(preview)`, puis appels de retrait en boucle jusqu'à `restantes = 0`. La liste est masquée pendant un envoi.
- [ ] **Step 1: Écrire le parcours et les écrans.** Chaque fichier sous 500 lignes, au plus 10 `useState` par composant (le réducteur porte l'état).
- [ ] **Step 2: Vérifier** : `npm run audit:quality` et `npx vite build` → verts (aucun nouveau warning, `audit-ui` sans hausse).
- [ ] **Step 3: Committer** — `feat(import articles): page d'import et retrait`.

---

### Task 10: Mise en production, mesure, documentation

**Files:**
- Modify: `CLAUDE.md` (section « Module Import des articles », 8 à 12 lignes : seule définition des champs, invariant du bilan, écriture par les RPC seules, nouvelles clés de l'upsert et leur usage réservé à l'import, rattachement des articles sans fournisseur, règle du retrait, date de prix inconnue) ; `docs/superpowers/specs/2026-11-28-import-articles-fichier-design.md` (chemin réel de la page : `/settings/suppliers/articles/import`)

- [ ] **Step 1: Tout vérifier** — `npm run audit:quality` et `npx vite build` → verts.
- [ ] **Step 2: Mesure avant** — lancer `mesure-rattachement-sans-offre.sql` en production (lecture seule) et noter les chiffres par organisation.
- [ ] **Step 3: Sur le oui d'Eric, appliquer les trois migrations** dans l'ordre (`apply_migration`), puis contrôler : `to_regclass('majordhome.catalog_imports')` non nul ; `has_function_privilege('anon', …)` faux sur les cinq RPC ; `node scripts/permissions-coherence.mjs --env .env.local` sans nouvel écart ; mesure après, identique à la mesure avant (la migration ne rattache rien par elle-même : seul un prochain relevé le fera).
- [ ] **Step 4: Essai sans écriture en production** — bloc `DO` sous l'identité d'un org_admin de Cimaj : `start`, `batch` de 200 lignes fabriquées (100 avec fournisseur), mesure, puis `RAISE EXCEPTION` (tout est annulé). Attendu : sous 2 s.
- [ ] **Step 5: Pousser** (`git pull --rebase --autostash` puis `git push`), suivre Vercel jusqu'à « Ready ».
- [ ] **Step 6: Recette à remettre à Eric** (skill `recette-navigateur`, compte Cimaj) : télécharger le fichier type, le remplir de 6 lignes (une sans désignation, une « Ouvrage », deux avec un fournisseur inconnu dont une sans prix d'achat, une avec un prix « 1 234,50 € », une avec une TVA « 0,055 »). Importer, vérifier le bilan et la marge de l'article qui a un prix d'achat (« date inconnue » sur sa fiche), réimporter le même fichier (tout doublon), retirer l'import (le fournisseur créé reste). Dire ce qui n'a pas été vu à l'écran.
- [ ] **Step 7: Committer la documentation** et mettre à jour la mémoire (`project_…` de l'import des articles, ligne dans `MEMORY.md`).
