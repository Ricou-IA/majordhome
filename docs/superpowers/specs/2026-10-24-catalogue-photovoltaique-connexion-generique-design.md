# Catalogue fournisseur — tranche 2 : Photovoltaïque, connexion générique, enrichissement, filtres

**Date** : 2026-10-24 · **Statut** : en relecture (Eric). Suite de
`2026-10-24-module-batterie-catalogue-baywa-design.md` (tranche 1, livrée le même jour : famille Batterie,
adaptateurs BayWa / Domos, RPC `supplier_catalog_upsert`, secrets Vault, edge `supplier-catalog-sync`, panneau
« Connexion catalogue »).

## 1. Intention

Remarques d'Eric après la tranche 1 (chat du 2026-10-24) :
1. « Ça n'a pas pris le catalogue photovoltaïque » → importer **tout** le catalogue des deux fournisseurs, pas
   seulement le stockage, sous une catégorie et une famille de devis **« Photovoltaïque »** (chapitres PANNEAUX /
   ONDULEUR ET MONITORING / FIXATION / COFFRETS ET CÂBLAGE / MAIN D'ŒUVRE, « on corrigera après dans Majord'home »).
2. « La connexion au fournisseur doit être pour tous les fournisseurs, il faut prévoir le champ URL » → la fiche
   fournisseur porte l'adresse de la boutique, le type de boutique et les identifiants, pour n'importe quel
   fournisseur ; plus de « baywa » / « domos » en dur dans le code.
3. « L'idée c'est de pouvoir aspirer ce qu'on peut depuis le site du fournisseur et de compléter ensuite » → la
   photo et la fiche technique relevées arrivent dans la fiche produit, les caractéristiques relevées s'affichent
   dans le drawer, le reste se complète à la main.
4. « Il n'y a pas de classement par marque ? » → filtres Marque et Gamme et tri dans la liste des produits
   (900 articles BayWa sinon illisibles).

## 2. Objectifs · non-objectifs · anti-objectifs

**Objectifs**
- Catégorie catalogue `photovoltaique` + famille de devis « Photovoltaïque » par défaut.
- Tout article simple des deux relevés importé : stockage → `batterie` (comme aujourd'hui), le reste →
  `photovoltaique`, gamme = famille du site en français. Correspondance éditable par fournisseur.
- Fiche fournisseur : **URL du site**, **type de boutique** (WooCommerce / NetSuite SuiteCommerce / Autre),
  identifiants (Vault) pour tout fournisseur qui a un site. Un nouveau fournisseur WooCommerce se connecte sans
  code ; un SuiteCommerce demande deux réglages de site (voir § 5).
- Photo du site → photo du produit (URL, comme l'enrichissement web existant) ; fiche technique → bouton
  « Ranger dans Documents » qui la télécharge à la demande ; caractéristiques relevées visibles dans le drawer.
- Liste produits : filtres Marque et Gamme, tri marque puis libellé.

**Non-objectifs**
- Téléchargement en masse des 900 fiches techniques PDF (≈ 2 Go de Storage pour des documents consultés
  rarement) : à la demande seulement, depuis le drawer.
- Un EAN deviné : aucune clé universelle publiée par les grossistes (BayWa = référence fabricant sans EAN, Domos =
  SKU interne) ; le rapprochement entre fournisseurs (§ 7, dans cette tranche) repose sur le modèle fabricant.
- Scrape des pages produit Domos pour les fiches techniques (l'API Store n'en donne pas) : plus tard si besoin.
- Un dimensionnement photovoltaïque depuis le catalogue (le calculateur Solaire garde sa grille de coûts).

**Anti-objectifs**
- Écraser une photo ou un document posés à la main (même règle que libellé / prix de vente : à l'INSERT ou si vide).
- Contourner une protection anti-robot (Domos reste un relevé navigateur).
- Un prix de vente inventé pour le photovoltaïque : 0 = « à renseigner », comme Solipac.

## 3. Données

### 3.1 Fournisseur (`majordhome.suppliers`)
- `connector` passe de `baywa | domos` à la **plateforme** : `suitecommerce | woocommerce | NULL` (migration :
  `baywa → suitecommerce`, `domos → woocommerce`, CHECK réécrit). NULL = « Autre » : import Excel / relevé JSON
  seulement.
- `site_url text` (ex. `https://solarshop.baywa-re.fr`), requis si `connector` non NULL. Backfill BayWa / Domos.
- `connector_config jsonb` : réglages propres à la plateforme. SuiteCommerce : `{ sca_path: '/sca-lux-2019-2',
  site_id: '6376560' }` (lus dans les URLs du site : `…/sca-lux-2019-2/…` et `c=6376560`) ; WooCommerce : `{}`.
  Édités dans la fiche fournisseur sous « Type de boutique » (deux champs texte, pré-remplis pour BayWa).
- `category_mapping jsonb` : `{ "<clé de catégorie du site>": "batterie" | "photovoltaique" | "exclure" }`, éditable
  dans le panneau Connexion catalogue (liste des catégories vues au dernier relevé, un sélecteur par ligne, avec
  le libellé et le chemin parent affichés). **Clé** = identifiant stable du site, pas le libellé : SuiteCommerce
  `cseg_itemcategory` (`Battery Storage`…), WooCommerce le **slug** (`batteries-ac`, `accessoires-systeme-de-
  stockage`… — trois catégories Domos s'appellent « Accessoires » avec des parents différents). Un article sans
  catégorie a la clé `(sans categorie)` (23 articles Domos : onduleurs Livoltek / Solis, coffrets, un ESS à
  66 905 €) : il apparaît dans le tableau, défaut `photovoltaique`, rien n'est perdu en silence. **Précédence**
  quand un article porte plusieurs catégories (28 chez Domos) : `exclure` > `batterie` > `photovoltaique`.
  Absente → défaut de l'adaptateur (§ 4). Les catégories vues (clé, libellé, parent, nombre d'articles) sont
  rangées à chaque relevé dans `catalog_sync_result.categories_vues`.
- `auto_sync boolean NOT NULL DEFAULT false` : relevé nocturne par le cron. Posé à `true` par le panneau quand un
  « Actualiser » serveur a réussi (et décochable) ; jamais pour WooCommerce derrière Cloudflare (Domos resterait
  en `acces_bloque` chaque nuit). Le cron ne traite que `auto_sync = true`.
- `catalog_sync_error jsonb` : **dernière erreur**, séparée du dernier relevé réussi (`catalog_sync_result` ne
  porte plus que des succès). Un échec n'efface donc plus « Relevé du 24/10 : 605 articles » ; le panneau
  affiche les deux lignes.
- Vues `majordhome_suppliers(_write)` : colonnes ajoutées **en fin**.

### 3.2 Catalogue (`supplier_products`)
- `category ∈ {…, 'batterie', 'photovoltaique'}` (texte libre, pas de contrainte).
- **Ce qu'un humain corrige dans le drawer survit au relevé** (Eric : « on corrigera après dans Majord'home »).
  La RPC pose `category`, `product_kind`, `brand` et `gamme` **à l'INSERT seulement** (comme `name` et
  `selling_price_ht`) ; au ré-import elle ne touche que prix d'achat, specs (fusion), `is_active`, `model_key`.
  Un changement de la table de correspondance s'applique par un bouton explicite « Appliquer la correspondance »
  (RPC `supplier_catalog_apply_mapping`, org_admin) qui réécrit `category` des articles concernés — jamais
  pendant le relevé. Le drawer reste libre sur ces champs.
- `image_url` / `image_source_url` écrits par la RPC **à l'INSERT ou si `image_url` est NULL** (jamais écrasés).
  Source : BayWa `itemimages_detail` (première URL, à conserver dans le relevé — le script de console tranche 1
  la tronquait), Domos `image`. `image_source_url` = page produit (`permalink` Domos, `urlcomponent` BayWa).
- `specs.canonical.fiche_technique_fr` (déjà) ; document rangé = ligne `product_documents`
  (`document_type = 'fiche_technique'`, bucket `product-documents`, path `${orgId}/${productId}/…`), créée par
  l'edge sur demande.

### 3.3 Devis
- **Une famille peut piocher dans plusieurs catégories** : `famille.categories: string[]` remplace `categorie`
  (string, gardée en lecture pour les réglages enregistrés : `categorie: 'x'` ≡ `categories: ['x']`,
  normalisé par `buildDevisConfig` ; l'éditeur Familles enregistre le tableau). Un devis Photovoltaïque avec
  onduleur hybride + batterie est le cas courant (kits « PV + stockage » chez Domos).
- `DEFAULT_FAMILLES` += `{ key: 'photovoltaique', label: 'Photovoltaïque', categories: ['photovoltaique',
  'batterie'], sections: ['PANNEAUX', 'ONDULEUR ET MONITORING', 'FIXATION', 'COFFRETS ET CÂBLAGE', 'MAIN D\'ŒUVRE'] }`,
  après Batterie ; Batterie passe à `categories: ['batterie', 'photovoltaique']` (un coffret ou un compteur
  rangé en PV reste accessible). Le picker filtre fournisseurs / gammes / produits sur l'ensemble des catégories
  de la famille. Mayer n'a pas de liste enregistrée (vérifié tranche 1) : les défauts s'appliquent.
- `CATEGORIES_PRODUIT`, `PRODUCT_CATEGORIES`, `CATEGORIE_LABELS` += `photovoltaique` « Photovoltaïque ».

## 4. Adaptateurs par plateforme

`src/lib/catalogue/suitecommerce.js` (ex-`baywa.js`) et `woocommerce.js` (ex-`domos.js`), copiés en
`_shared/catalogue/`. Même contrat qu'en tranche 1 : `articlesDepuisReleve(releve, { version, mapping })` →
`{ lignes, retenus, exclus, releve_at, categories_vues }`. Changements :
- **Périmètre = tout article simple à prix** (kits / bundles exclus, prix absent ou 0 exclu). Plus de filtre
  « Tesla » : il est couvert par « tout ».
- **Catégorie Majord'home** = `mapping[categorie_du_site]` si présent, sinon défaut par mots-clés :
  SuiteCommerce `cseg_itemcategory` : `Battery Storage → batterie`, tout le reste (`PV`, `Inverters`,
  `Inverter Accessories`, `Mounting Systems`, `Electrical`, `E-Mobility`, `Diverse`) → `photovoltaique` ; les
  accessoires Tesla restent en `batterie` (règle tranche 1 : fabricant Tesla ou libellé Tesla/Powerwall).
  WooCommerce (Domos) : slugs stockage (tranche 1) → `batterie`, racines `Panneaux solaires`, `Onduleurs /
  Micro-onduleurs`, `Systèmes de fixation`, `Coffrets de protection`, `Accessoires`, `Site isolé / ESS`,
  `Déstockage`, `Non classé` → `photovoltaique`. `'exclure'` dans le mapping écarte la catégorie.
- **Gamme** = libellé FR de la famille du site : SuiteCommerce `{ PV: 'Modules PV', Inverters: 'Onduleurs',
  'Inverter Accessories': 'Accessoires onduleur', 'Mounting Systems': 'Fixation', Electrical: 'Électrique',
  'E-Mobility': 'Bornes de recharge', Diverse: 'Divers' }` ; pour le stockage, les gammes de la tranche 1
  (Batterie / Stockage tertiaire / Passerelle…). WooCommerce : nom de la sous-catégorie la plus précise
  (« Micro-onduleur », « Coffrets AC », « Fixation au sol »…), sinon la racine.
- **Nature** : `main` pour un module PV (`custitem_itemwatt` / « Wc » dans le nom), un onduleur, une batterie ;
  `accessory` sinon. **Marque** : `custitem_manufacturerfacet` / premier mot du nom (inchangé).
- `image_url` ajouté à la ligne (voir § 3.2) ; `specs.canonical` reçoit pour le PV : `puissance_wc`, `mpn`,
  `fabricant`, `garantie_produit_ans`, `garantie_perf_ans`, `dimensions_cm`, `poids_kg`, `fiche_technique_fr`.
- Tests sur les relevés réels (nouveaux comptes à figer au premier passage) + un test par défaut de mapping et
  par surcharge (`mapping: { 'E-Mobility': 'exclure' }` ⇒ 0 borne).
- Scripts de console et import Node : `dump-suitecommerce.browser.js` (paramétré par `sca_path` / `site_id`, à
  éditer en tête), `dump-woocommerce.browser.js` ; `import-releve.mjs --fournisseur <nom en base>` lit
  `connector` / `site_url` / `category_mapping` du fournisseur (requête via l'API de management) au lieu d'un
  preset. BayWa : le relevé doit conserver `itemimages_detail` (URL d'image) et `urlcomponent`.

## 5. Connexion générique (edge `supplier-catalog-sync`)

- Un client par plateforme : `suitecommerceClient.ts` (ex-`baywaClient.ts`, paramétré par `site_url`, `sca_path`,
  `site_id` ; **les autres constantes — paramètres de l'API items, chemins de connexion, en-têtes — restent
  celles de BayWa**, seul site SuiteCommerce connu : le type s'affiche « NetSuite SuiteCommerce (compatible
  BayWa) » et un second site de ce type pourra demander un ajustement de code, c'est assumé),
  `woocommerceClient.ts` (connexion = `POST /wp-login.php` par formulaire puis Store API avec le cookie ;
  **Cloudflare / captcha ⇒ `acces_bloque`**, on ne contourne pas). Le mode `cron` traite les fournisseurs actifs
  avec `auto_sync = true` (migration : le cron `20261024_3` reste, l'edge filtre).
- Le relevé serveur et l'import de fichier passent par le même adaptateur avec le `category_mapping` du
  fournisseur. `categories_vues` est écrit dans `catalog_sync_result`.
- Action `document` : `{ action: 'document', org_id, supplier_id, product_id }` → télécharge
  `specs.canonical.fiche_technique_fr` (vérifié le 2026-10-24 : les liens signés BayWa se téléchargent sans
  session), l'enregistre dans `product-documents` et crée la ligne `product_documents` si aucune
  `fiche_technique` n'existe déjà pour ce produit. Refus `document_absent` / `document_illisible` (pas un PDF).

## 6. Côté application

- **Fiche fournisseur** (`SupplierFormModal`) : « Site du fournisseur » (URL), « Type de boutique »
  (Aucun / WooCommerce / NetSuite SuiteCommerce), champs `sca_path` / `site_id` visibles pour SuiteCommerce.
- **Panneau Connexion catalogue** : identifiants seulement pour un type de boutique connu (aucune RPC ne rend
  la valeur d'un secret à un humain, et on n'en ajoute pas : des identifiants « pour les avoir sous la main »
  seraient illisibles) ; « Actualiser » si type connu ; case « Relevé automatique chaque nuit » (`auto_sync`) ;
  « Importer un relevé » toujours ; **tableau de correspondance des catégories** (clé / libellé / parent /
  nombre → Batterie / Photovoltaïque / Exclure) enregistré dans `category_mapping`, avec le bouton « Appliquer
  la correspondance » (§ 3.2) ; deux lignes d'état (dernier relevé réussi, dernière erreur) ; bouton
  « Supprimer les identifiants » (`org_secret_delete`, mineur M2 de la relecture).
- **Liste produits** (`ProductCatalog`) : sélecteurs Marque et Gamme (valeurs distinctes du fournisseur, RPC
  `get_distinct_brands` sur le modèle de `get_distinct_gammes`), filtres passés à `getProducts`
  (`brand`, `gamme`), tri `brand, name`. Compteurs par nature inchangés.
- **Drawer produit** : schémas `batterie.schema.js` et `photovoltaique.schema.js` (champs canoniques ci-dessus,
  groupes Identité / Performance / Garanties / Dimensions / Documents) dans le registre `src/shared/specs` ; en
  plus, un bloc « Relevé fournisseur » en lecture seule listant toute clé `canonical` hors schéma (date de
  relevé, stock, lien fiche). Bouton « Ranger la fiche technique dans Documents » (action `document`) quand le
  lien existe et qu'aucun document `fiche_technique` n'est encore rangé. La photo relevée s'affiche comme
  aujourd'hui (`image_url`), remplaçable à la main.
- Section CLAUDE.md : la proposition PENDING de la tranche 1 est complétée (plateformes, mapping, enrichissement).

## 7. Articles communs entre fournisseurs (demande d'Eric du 2026-10-24)

Besoin : « s'il y a des articles communs, il me faut pouvoir les identifier » — le nom diffère d'un site à
l'autre, la référence fournisseur n'est pas la référence fabricant, aucun EAN partagé.

**Clé commune = marque + modèle fabricant normalisé** (`model_key`), dérivée par un module PUR testé sur les deux
relevés (`src/lib/catalogue/modelKey.js`) :
- candidats = jetons du libellé (et de la référence fabricant BayWa `mpn`) qui mêlent lettres et chiffres,
  longueur ≥ 5, hors unités (`13,5KWH`, `5KW`, `400WC`, `48V`…) et hors EAN à 13 chiffres ; normalisés en
  majuscules sans espaces ni tirets (`LUNA2000-7-E1` → `LUNA20007E1`) ;
- on garde le **plus spécifique** : un jeton qui est le préfixe d'un autre jeton du même libellé (`SUN2000` devant
  `SUN20005KLB0`, `LUNA2000` devant `LUNA20007E1`) est une famille, pas un modèle, et ne fait pas de clé ;
- `code_ean` (colonne existante, alimentée par l'import Excel et par les noms EcoFlow) est une seconde clé, plus
  forte quand les deux côtés l'ont.
- Mesure du 2026-10-24 sur BayWa × Domos : ~20 vrais communs par cette clé (LUNA2000-7-E1 2 001,90 € BayWa /
  2 119,94 € Domos ; SUN2000-5K-LB0 567,78 / 636,11 ; HMS-1000-2T 122,01 / 129,60 ; EMMA-A02 281,35 / 265,33…), et
  quelques faux amis évités par la règle du préfixe.

**Pas de rapprochement un par un** (Eric, 2026-10-24 : « il faut le faire 1 par 1 ? »). Trois niveaux :
1. **Clé franche ⇒ confirmé automatiquement** : même org, fournisseurs différents, même `brand` et même
   `model_key` complet (ou même `code_ean`) et un seul candidat de chaque côté ⇒ `statut = confirme`,
   `source = cle`, sans intervention.
2. **Normalisation en lot par l'IA** pour les articles sans clé franche : un job (edge `catalog-normalize`,
   Claude via le pattern `voice-extract-fieldreport`, lots de 50 articles, à la demande depuis le panneau et après
   chaque relevé) renvoie pour chaque article `{ brand, model, confiance }` à partir du libellé, de la description,
   des specs relevées et de la fiche technique (texte extrait du PDF quand elle est rangée) ; `confiance ≥ 0,9`
   ⇒ `model_key` posée (`source = ia`), et le niveau 1 s'applique. Le modèle et la confiance sont conservés dans
   `specs.canonical` (`modele_ia`, `modele_ia_confiance`) ; une saisie manuelle de `model_key` dans le drawer
   prime toujours et n'est jamais recalculée.
3. **File des ambigus** (plusieurs candidats pour une même clé, famille seule, confiance < 0,9) : page
   « Rapprochements à confirmer » (Settings → Fournisseurs) avec cases à cocher et **« Tout confirmer »** ; une
   paire refusée n'est jamais reproposée.

**Stockage** : `supplier_products.model_key text` + `model_key_source ∈ cle|ia|manuel` ; table
`majordhome.catalog_matches(org_id, product_a_id, product_b_id, source ∈ cle|ia|manuel, statut ∈
propose|confirme|refuse, confirmed_by, confirmed_at)`, unique sur la paire ordonnée. Un rapprochement manuel
reste possible depuis le drawer (« Même article que… », recherche dans les autres fournisseurs).

**Affichage** : dans le drawer, bloc « Aussi chez » (fournisseur, référence, prix d'achat, écart) ; dans la liste
produits, pastille « ×2 » sur les articles rapprochés et un filtre « Communs à plusieurs fournisseurs » ; dans le
picker du devis, le prix d'achat le plus bas est signalé quand l'article existe ailleurs (sans changer le choix).
Une page « Rapprochements à confirmer » dans Settings → Fournisseurs liste les propositions en attente.

## 8. Laissé au builder

- Nom exact des gammes, ordre des groupes du drawer, libellés des sélecteurs.
- Migrations répétées sur le harnais avec leurs asserts : `20261025_1` (fournisseurs : `connector` plateforme +
  backfill, `site_url`, `connector_config`, `category_mapping`, `auto_sync`, `catalog_sync_error` ; vues ; RPC
  `supplier_catalog_upsert` v3 — champs à l'INSERT seulement, `image_url` si NULL, `model_key` ; RPC
  `supplier_catalog_apply_mapping` ; RPC `get_distinct_brands`), `20261025_2` (`model_key`, `model_key_source`,
  table `catalog_matches` + RLS + vues, RPC de proposition / confirmation / refus). `product_documents` à ajouter
  au snapshot du harnais.
- `allegerReleve` / `FIELDS_BAYWA` élargis aux champs PV (`custitem_itemwatt`…) et à `itemimages_detail` /
  `urlcomponent` ; le script de console BayWa les conserve désormais (un nouveau relevé BayWa est requis pour les
  photos — le relevé automatique de l'app le fait).
- Nature `main` : module PV, onduleur (`Inverters`), batterie, borne de recharge ; accessoire sinon.
- Le relevé complet pèse plus (≈ 900 + 600 articles) : vérifier que l'import depuis l'app passe avec
  `allegerReleve` (sinon découper l'envoi en pages côté service).
