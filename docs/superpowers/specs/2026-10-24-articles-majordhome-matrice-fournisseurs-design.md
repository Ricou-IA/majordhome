# Articles Majord'home et matrice fournisseurs — conception

**Date** : 2026-10-24 · **Décideur** : Eric Pudebat (Mayer Énergie) · **Statut** : relue (bâtisseur), à approuver par Eric
**Précède** : `2026-10-24-catalogue-photovoltaique-connexion-generique-design.md` (tranche 2 du catalogue, livrée et relue le 2026-10-24).

## 1. Intention

Aujourd'hui le devis pioche directement dans les catalogues fournisseurs : on choisit un fournisseur, puis une
gamme, puis un article. Les articles communs entre fournisseurs ne sont reliés que deux à deux
(`majordhome.catalog_matches`), et les boutons d'harmonisation (normalisation IA, rapprochements) sont rangés
dans la fiche de chaque fournisseur.

Eric veut inverser le modèle : **des articles Majord'home par organisation, qui sont la base du devis, et une
correspondance vers les lignes fournisseur — une matrice de passage [org] × [fournisseur]**. Au moment du devis,
l'application dit chez qui acheter. Ses mots : « je veux améliorer la prise de décision et la rapidité » ;
« chez qui on achète pour l'instant, le reste plus tard » ; « il ne faut pas écraser la base fournisseurs ».

Cible à plus long terme (hors périmètre ici, mais elle oriente les choix) : un assistant IA qui construit un
devis à partir de « fais un devis pour une borne V2C ». Il devra raisonner sur des articles propres, décrits par
des attributs, pas sur 1 500 libellés fournisseur. L'article Majord'home est cette couche ; la mapper est la
première marche.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Une entité « article Majord'home » par org, base du devis, qui porte ce que voit le client (libellé, catégorie,
  famille, photo, fiche technique, specs harmonisées) et le prix de vente de l'org.
- La matrice : chaque ligne fournisseur est rattachée à au plus un article ; un article a zéro, une ou plusieurs
  lignes fournisseur (ses « offres »), chacune avec sa référence, son prix d'achat, son stock relevé et la date
  de ce prix.
- Au devis, poser un article et voir immédiatement l'offre retenue et pourquoi, la changer d'un clic ; le
  fournisseur retenu et son prix d'achat sont mémorisés sur la ligne.
- Une page d'harmonisation **au niveau de l'org** (plus par fournisseur) : propositions de fusion d'articles,
  normalisation IA, file à confirmer, fusion et séparation manuelles.
- La base devis est complète dès le premier jour : aucune saisie d'article n'est nécessaire pour commencer.

**Non-objectifs (plus tard, explicitement)**
- Proposer un matériel équivalent (« un onduleur moins cher chez un autre fournisseur ») : le choix du matériel
  reste à l'humain, l'app ne choisit que le fournisseur.
- L'assistant IA de devis.
- La commande fournisseur, les frais de port, les délais de livraison, les remises de fin d'année.
- Un référentiel d'articles global partagé entre organisations.
- Un prix de vente calculé automatiquement depuis l'achat.

**Anti-objectifs (ce qui ferait de la livraison un échec même si « ça marche »)**
- Modifier, écraser ou supprimer une donnée fournisseur (référence, libellé, marque, prix, specs relevées). La
  base fournisseur est rattachée, jamais réécrite.
- Casser les consommateurs actuels de `majordhome.supplier_products` : moteur fumisterie
  (`fum_article_attrs` × `supplier_products`), dimensionnement clim (`src/lib/clim/dimensionnement.js`), relevés
  (`supplier_catalog_upsert`), catalogue d'achats depuis les factures Pennylane, variantes (`variant_of`).
- Un devis existant qui change de contenu ou de prix après la migration.
- Proposer d'office un fournisseur sur un prix périmé.

## 3. Contraintes

- Charte multi-tenant de `CLAUDE.md` : `org_id` sur toute mutation ; tables `majordhome.*` sous RLS scopée org
  dès la création ; vues `public.majordhome_*` en `security_invoker=true`, colonnes ajoutées **en fin** de liste ;
  RPC SECURITY DEFINER avec `REVOKE EXECUTE FROM PUBLIC, anon` (et `authenticated` si `org_id` est dans le
  payload) ; gardes positives ; `GRANT SELECT … TO service_role` sur toute table lue par une vue depuis une edge ;
  `{ error }` lu sur chaque écriture ; cache keys avec `orgId` en premier ; `unwrapResult` dans les mutations ;
  `logger`, jamais `console`.
- Toute migration structurelle est répétée sur `scripts/migration-rehearsal/` avant la prod. **Cette fois la
  liste de `snapshot.mjs` doit être étendue** (`catalog_matches`, `supplier_catalog_apply_mapping`,
  `get_distinct_brands`, et les nouveaux objets) au lieu de rejouer la chaîne `20261025_2.._5`.
- Les modules de règles sont PURS dans `src/lib/catalogue/` (aucun import React / Supabase), testés par
  `node --test scripts/catalogue/*.test.mjs`, inclus dans `audit:quality`. Ceux copiés pour Deno passent par
  `npm run sync:tournee-engine` (liste `CATALOGUE` de `scripts/sync-tournee-engine.mjs`).
- Pas de composant > 500 lignes ; pas de logique métier dans le JSX.
- Les devis déjà émis gardent leurs lignes telles quelles : `quote_lines.supplier_product_id`, `supplier_id`,
  `purchase_price_ht`, `designation`, `unit_price_ht` sont des instantanés et le restent.

## 4. Ce qu'Eric a décidé

1. Les articles Majord'home sont **par org** et constituent la base du devis.
2. La correspondance est une **matrice org × fournisseur** : un article, N lignes fournisseur.
3. La base fournisseur n'est **jamais écrasée**.
4. Au devis, la seule décision à accélérer aujourd'hui est **chez qui on achète**.
5. L'harmonisation est un geste **général**, pas rangé dans la fiche d'un fournisseur.

## 5. Choix de conception (miens, à contester)

### 5.1 Un article par ligne fournisseur, automatiquement

Chaque ligne fournisseur **active** de l'org qui n'est rattachée à aucun article en reçoit un, créé par la base,
copie de la ligne : libellé, marque, catégorie, gamme, nature (`product_kind`), unité, TVA par défaut, prix de
vente (`selling_price_ht`), photo, `specs.canonical`, `code_ean`, `model_key`. C'est ce qui rend la base devis
complète d'emblée, sans saisie. L'article mémorise sa ligne d'origine (`source_product_id`) et son mode de
création (`auto`).

Avant de créer, la base tente un **rattachement franc** à un article existant de l'org : même marque (insensible
à la casse) et même `model_key`, ou même `code_ean`, article qui n'a encore aucune ligne de ce fournisseur, même
nature, prix d'achat du même ordre (rapport ≤ 2) — exactement la règle de confirmation d'office d'aujourd'hui.
Si plusieurs articles sont candidats, on crée l'article et l'harmonisation proposera la fusion.

Cela vaut au backfill de la migration (toutes les lignes actives de l'org, fumisterie et achats Pennylane compris :
la base devis, c'est tout ce qu'on sait chiffrer) et à chaque relevé : `supplier_catalog_upsert` se termine par
l'appel de la RPC qui pose les articles manquants. Les doublons legacy de même fournisseur et même référence
(1 576 lignes DINAK / MODINOX) partagent un seul article. Une variante (`variant_of`) a son propre article.

### 5.2 Le modèle de données

- `majordhome.catalog_items` : `id, org_id, name, brand, model_key, code_ean, category, gamme, product_kind,
  unit, default_tva_rate, selling_price_ht, description, image_url, specs jsonb, is_active, source_product_id,
  origin ('auto' | 'manuel'), merged_into uuid NULL, created_at, updated_at`. RLS : lecture membre, écriture
  **par RPC seulement** (org_admin), sauf les champs humains de l'article éditables depuis la fiche article par
  les rôles qui ont `catalogue.edit` (le builder s'aligne sur la ressource de permission existante des
  fournisseurs). Index `(org_id, lower(brand), model_key)` et `(org_id, code_ean)` pour le rattachement, pas
  d'unicité (deux articles distincts peuvent porter la même clé jusqu'à la fusion).
- `majordhome.supplier_products` : `catalog_item_id uuid NULL` (FK, ON DELETE SET NULL),
  `catalog_item_link_source text` (`auto | cle | ean | ia | manuel`), `catalog_item_linked_at`. **Rien d'autre
  ne change sur cette table.** La matrice, c'est cette colonne.
- `majordhome.quote_lines` : `catalog_item_id uuid NULL`. Les colonnes existantes (`supplier_product_id`,
  `supplier_id`, `reference`, `purchase_price_ht`) sont le fournisseur retenu, instantané.
- `majordhome.catalog_item_proposals` : `org_id, item_a_id, item_b_id (a < b), source ('cle' | 'ean' | 'ia'),
  motif, statut ('propose' | 'fusionne' | 'refuse'), decided_by, decided_at`. Remplace `catalog_matches`. Une
  paire refusée n'est jamais reproposée.
- Vues `security_invoker` : `majordhome_catalog_items` (miroir simple **updatable** des champs humains ; pas de
  LATERAL), `majordhome_catalog_item_offers` (lecture : article × ligne fournisseur avec `supplier_name`,
  `reference`, `purchase_price_ht`, `stock_qty`, `prix_date`, `is_active`, `auto_sync` du fournisseur),
  `majordhome_catalog_item_proposals` (avec les deux articles et l'écart de prix).
- `GRANT SELECT` à `service_role` sur les trois tables (les edges lisent les vues).

### 5.3 Les RPC (SECURITY DEFINER, `SET search_path = majordhome, public`)

- `catalog_items_ensure(p_org_id)` — service_role (appelée en fin d'`supplier_catalog_upsert`, par la migration,
  par l'import d'achats) : rattachement franc ou création pour toute ligne active sans article. Retourne
  `{ crees, rattaches }`.
- `catalog_item_proposals_propose(p_org_id)` — service_role : pour chaque paire d'articles de l'org sans ligne
  fournisseur commune, même marque + `model_key` ou même EAN, et non refusée : **fusion d'office** si un seul
  candidat de chaque côté, même nature, prix du même ordre ; **proposée** sinon. Appelée après chaque relevé et
  après chaque normalisation IA.
- `catalog_item_merge(p_survivor_id, p_absorbed_id)` — org_admin : re-pointe les lignes fournisseur et les
  `quote_lines.catalog_item_id` de l'absorbé vers le survivant, hérite les champs vides, concatène les specs
  (survivant prioritaire), marque `merged_into`, `is_active=false`. Le survivant est le plus ancien des deux sauf
  choix explicite. Journalise dans la proposition (`fusionne`).
- `catalog_item_proposals_decide(p_ids uuid[], p_statut)` — org_admin : `fusionne` (appelle merge) ou `refuse`
  en lot.
- `catalog_item_detach(p_product_id)` — org_admin : sort une ligne fournisseur de son article et lui crée le sien
  (défaire une fusion ou un rattachement faux).
- `catalog_item_attach(p_product_id, p_item_id)` — org_admin : rattachement manuel (source `manuel`), la ligne
  quitte son article précédent ; un article qui n'a plus aucune ligne et aucune ligne de devis est désactivé.

Toutes : garde `IF auth.uid() IS NULL THEN RAISE` (frontend) ou service_role only (serveur), `REVOKE FROM
PUBLIC, anon` (+ `authenticated` pour les service_role), vérification que les deux objets sont de la même org.

### 5.4 Règle « chez qui on achète » — module pur `src/lib/catalogue/meilleureOffre.js`

Entrée : les offres d'un article (`prix_achat`, `prix_date`, `stock_qty` ou `null` si inconnu, `fournisseur`,
`auto_sync`) et la date du jour. Sortie : `{ retenue, raison, candidates[] }`.

- **Fraîche** = `prix_date` de moins de **30 jours**. Date d'un prix : pour une ligne relevée (`specs ?
  'source_version'`), la date du relevé (`updated_at` posée par l'upsert) ; pour une ligne issue des factures
  Pennylane, la date du dernier achat écrite dans `specs.canonical` par `scripts/catalogue/achats.js` (le
  builder lit la forme exacte) ; sinon `updated_at`.
- **Disponible** = `stock_qty > 0`, ou stock inconnu (neutre). `stock_qty = 0` écarte l'offre du choix d'office.
- Retenue = la moins chère parmi les fraîches et disponibles ; à égalité, le fournisseur relevé automatiquement
  (`auto_sync`). Raison en français : « moins cher de 12 % chez Domos (relevé d'hier) ».
- Aucune offre fraîche et disponible → **pas de retenue d'office** : la ligne de devis est posée sans
  fournisseur, badge « fournisseur à choisir », les offres datées restent listées avec leur âge. Soditelem et
  Tereva (dernier prix facturé) seront donc souvent dans ce cas tant qu'ils ne sont pas relevés autrement.
- Une offre d'un fournisseur inactif ou d'une ligne inactive n'est jamais candidate.

Testé sur des cas fixes : une seule offre ; deux fraîches ; une fraîche chère et une périmée moins chère (la
fraîche gagne) ; toutes périmées (aucune retenue) ; stock à zéro ; égalité de prix.

### 5.5 Le devis

- **Picker article-first** (`DevisProductPicker`) : recherche dans les articles de l'org, filtrée par les
  catégories de la famille / section comme aujourd'hui, filtres marque et gamme, une ligne par article avec sa
  photo, son prix de vente de l'org et son **offre retenue** (fournisseur, prix d'achat, raison) ; un repli
  montre toutes les offres. Les parcours Fournisseur → Gamme → Diamètre disparaissent du picker devis (ils
  restent dans Settings → Fournisseurs pour explorer un catalogue). Le diamètre devient un filtre comme la gamme
  quand la famille en a besoin (fumisterie).
- À l'ajout, la ligne reçoit : `catalog_item_id`, désignation / unité / TVA / prix de vente de l'article,
  `supplier_product_id`, `supplier_id`, `supplier_name`, `reference`, `purchase_price_ht` de l'offre retenue
  (ou `null` + badge si aucune).
- Sur une ligne de devis, un petit menu « Fournisseur » liste les offres de l'article (prix, âge, stock) et
  permet d'en changer ; la marge se recalcule. Un devis déjà envoyé n'est pas modifié.
- Le badge « moins cher ailleurs » et `useCatalogMatches` disparaissent (l'offre retenue les remplace).
- Rien ne change pour les lignes libres, les sections, les moteurs fumisterie et clim (ils posent déjà une
  ligne fournisseur ; le builder renseigne `catalog_item_id` depuis la ligne choisie quand il est connu).

### 5.6 La fiche article et l'harmonisation

- **Settings → Fournisseurs → onglet « Articles »** (ou page sœur) : liste des articles de l'org, filtres
  catégorie / marque / gamme / nombre d'offres / « sans offre fraîche », recherche. Fiche article : champs humains
  éditables (libellé, marque, catégorie, gamme, nature, unité, TVA, prix de vente, description, photo choisie
  parmi celles des offres ou téléversée), specs harmonisées (les schémas `src/shared/specs/*` s'appliquent à
  l'article), tableau des offres (fournisseur, référence, prix, âge, stock, lien vers le drawer de la ligne
  fournisseur en lecture), documents = union des `product_documents` des lignes rattachées, boutons
  « Rattacher une ligne fournisseur » et « Détacher ».
- Le drawer de la ligne fournisseur (`ProductDetailDrawer`) devient **lecture seule sur les champs humains**
  (libellé, marque, catégorie, gamme, nature, prix de vente) avec un lien « Modifier sur l'article Majord'home » ;
  il garde le relevé, les documents, les variantes et l'identifiant de l'article. Les corrections faites jusqu'ici
  sur les lignes sont reprises dans l'article au backfill (ce sont les valeurs courantes).
- La correspondance des rayons (`supplier_catalog_apply_mapping`) continue de reclasser la **ligne** ; elle
  reclasse aussi l'article quand il n'a que cette ligne et que sa catégorie n'a pas été corrigée à la main
  (même règle `categorie_releve` que pour la ligne).
- **Settings → Fournisseurs → « Harmoniser les bases »** (remplace la page Rapprochements, au niveau org) :
  compteurs (articles, articles à plusieurs offres, sans clé modèle, propositions en attente) ; boutons
  « Normaliser les modèles (IA) » (toutes les lignes de l'org sans clé, tous fournisseurs : l'edge
  `catalog-normalize` prend `supplier_id` optionnel) et « Proposer les fusions » ; file des propositions avec
  les deux articles côte à côte, leurs offres et l'écart de prix, « Fusionner » / « Refuser » unitaires et
  « Tout fusionner » ; onglets Proposées / Fusionnées / Refusées ; fusion manuelle par recherche. Les boutons
  « Normaliser » et « Rapprocher » du panneau fournisseur sont retirés.

### 5.7 Migration et existant

Une migration versionnée, répétée sur le harnais (liste de `snapshot.mjs` étendue), avec un fichier
d'assertions :
1. Tables, colonnes, vues, RPC, droits.
2. Backfill `catalog_items_ensure` pour chaque org qui a des lignes fournisseur (pas seulement Mayer).
3. Les 15 `catalog_matches` confirmés → `catalog_item_merge` (survivant = article de la ligne la plus ancienne) ;
   les 3 proposés → `catalog_item_proposals` ; les refusés → refusés. Puis `DROP` de `catalog_matches`, de sa vue
   et de ses trois RPC ; retrait du front correspondant (`matchesModel.js`, `useCatalogMatches`,
   `ProductMatchesBlock`, `CatalogMatchesPage`).
4. `quote_lines.catalog_item_id` renseigné depuis `supplier_product_id` pour toutes les lignes existantes.
5. `supplier_catalog_upsert` appelle `catalog_items_ensure` en fin ; l'import d'achats Pennylane et l'import
   ECOSTAL n'ont rien à faire (ils passent par l'upsert).
6. Assertions : un article par ligne active, aucun article sans org, les 15 fusions effectives, aucun devis dont
   une ligne a changé de `unit_price_ht` / `purchase_price_ht`, anon sans droit, `service_role` en SELECT.

### 5.8 Livraison en deux tranches

- **Tranche A — la matrice** : modèle, RPC, backfill, fiche article, harmonisation générale, retrait de
  `catalog_matches`. Livrable seul : la base devis existe, les doublons se fusionnent au niveau org.
- **Tranche B — le devis** : règle `meilleureOffre`, picker article-first, menu fournisseur sur la ligne,
  `catalog_item_id` sur les lignes. Dépend de A.

## 5.9 Points tranchés après la relecture bâtisseur (mes choix, sauf mention)

- **Prix de vente = l'article.** `catalog_items.selling_price_ht` est le prix de vente de l'org pour le devis.
  Au backfill, il est semé depuis la ligne rattachée qui a un prix de vente non nul le plus récemment modifié
  (sinon 0 = à saisir). Les moteurs fumisterie (`nomenclature.js` : `tarif_public ?? selling_price_ht` de la
  ligne), clim (`src/lib/clim/dimensionnement.js`) et sa copie sur le site Mayer **continuent de lire la ligne
  fournisseur** : ce sont des règles de prix propres à leur module, hors périmètre. Pour ne pas ouvrir de trou
  entre les tranches, le drawer de la ligne garde son champ prix de vente éditable **jusqu'à la tranche B** ; à la
  livraison de B il passe en lecture seule et renvoie vers l'article. Une convergence des moteurs sur
  `catalog_item_id` est un sujet à part, signalé, pas embarqué.
- **Date du prix d'achat = colonne dédiée** `supplier_products.purchase_price_at` (timestamptz), posée par
  `supplier_catalog_upsert` à chaque écriture de `purchase_price_ht` (date du relevé) et par l'import d'achats
  (date de la dernière facture). Backfill depuis `specs.canonical.stock_releve.at` (relevés) et la date de dernier
  achat écrite par `achats.js` (factures), sinon `updated_at`. `updated_at` ne sert plus jamais de date de prix :
  une correction manuelle ne rafraîchit pas un prix périmé. Ce n'est pas « écraser la base fournisseur » : c'est
  une date que seuls les relevés écrivent. Le stock se lit dans `specs.canonical.stock_releve` (`{qty}`
  SuiteCommerce, `{en_stock}` WooCommerce) : la vue `catalog_item_offers` expose `stock_qty` (entier ou NULL) et
  `en_stock` (booléen ou NULL), le module `meilleureOffre` ne connaît que ces deux champs.
- **Un article sans offre active n'est pas proposé au devis.** La vue `majordhome_catalog_items` expose
  `offres_actives` (nombre de lignes actives rattachées) ; le picker ne liste que `offres_actives > 0` ; la fiche
  et la page d'harmonisation les montrent avec un badge « plus au catalogue ». Pas d'état stocké : c'est calculé.
  Les articles sans catégorie (≈ 257 lignes Soditelem / Tereva) n'apparaissent que dans une section sans filtre
  de catégorie, avec le badge « sans catégorie », et la page Articles offre le filtre « sans catégorie » pour les
  ranger.
- **`quote_lines`** : la vue `majordhome_quote_lines_write` reçoit `catalog_item_id` **en fin de liste** ;
  `upsertQuoteLines` supprime puis réinsère toutes les lignes, donc le front porte `catalog_item_id` dans son état
  de ligne dès la tranche A (sinon le backfill se perd au premier enregistrement). `quote_lines` et
  `catalog_items` rejoignent la liste `TABLES` de `snapshot.mjs`.
- **Edge `catalog-normalize`** : `supplier_id` devient optionnel ; sans lui, toutes les lignes actives de l'org
  sans clé modèle, par lots, tous fournisseurs.
- **Permission d'édition de l'article** : décision d'Eric, voir § 8.

## 6. Laissé au builder

- Le découpage exact des composants (fiche article, picker, page d'harmonisation) dans la limite des 500 lignes.
- La forme de la recherche d'articles (RPC `ilike` avec `escapePostgrestSearchTerm`, ou vue + filtres PostgREST).
- La pagination de la liste d'articles (plusieurs milliers après backfill).
- Le nom de la date de dernier achat écrite par `scripts/catalogue/achats.js` (pour le backfill de
  `purchase_price_at`).
- La photo par défaut d'un article à plusieurs offres (première offre qui en a une).

## 7. Hors périmètre, rappel

Assistant IA de devis ; choix du matériel équivalent ; commande fournisseur ; frais de port et délais ;
référentiel global inter-org ; prix de vente automatique ; relevé Soditelem / Tereva autrement que par factures ;
convergence des moteurs fumisterie / clim sur l'article Majord'home.

## 8. Décision d'Eric après relecture

**Édition d'un article Majord'home = org_admin seul** (Eric, 2026-10-24 : « admin seul »). Pas de nouvelle
ressource dans le registre des permissions : la fiche Articles et la page d'harmonisation vivent sous Settings →
Fournisseurs (`RouteGuard resource="settings"`), les policies d'écriture de `catalog_items` et toutes les RPC
d'écriture exigent `role = 'org_admin'` dans `core.organization_members`. Lecture (vues) = tout membre de l'org,
nécessaire au picker de devis.
