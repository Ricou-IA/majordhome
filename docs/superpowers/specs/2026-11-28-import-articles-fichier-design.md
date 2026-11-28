# Import d'une base d'articles depuis un fichier — conception

Date : 2026-11-28. Statut : à valider par Eric.

## 1. Intention

Une entreprise qui arrive sur Majord'home a souvent sa base d'articles dans son ancien logiciel de devis (export
Excel ou CSV). Elle doit pouvoir la charger **en une fois** : ces articles deviennent la base de ses devis
(`majordhome.catalog_items`), **sans lien avec un fournisseur au départ**.

L'objectif d'Eric : **ensuite brancher la liste des fournisseurs sur ces articles**. Un fournisseur relevé plus tard
(boutique, tarif PDF, factures Pennylane, offre) doit venir se rattacher aux articles importés, pas créer des articles
en double à côté d'eux.

## 2. Constat (état au 2026-11-28)

- Un article sans fournisseur existe déjà : `catalog_items.source_product_id` est facultatif, `origin = 'manuel'`,
  création à l'unité par la page Articles et par le devis (`catalogItemsService.createItem`). Aucun import en nombre.
- Le seul import de fichier est « Import Excel » de la fiche fournisseur (`suppliersService.bulkCreateProducts`) :
  il écrit des lignes fournisseur, **ne crée aucun article**, et **supprime d'abord toutes les lignes du fournisseur**
  (contraire à l'écrivain unique ; casserait les liens d'un fournisseur relevé). Hors périmètre ici, signalé au § 10.
- **Trou bloquant pour l'objectif** : le branchement automatique ne voit que les articles qui ont déjà un fournisseur.
  - `catalog_items_ensure` (étape 2, rattachement franc) exige `m.prix IS NOT NULL` : l'article candidat doit avoir une
    ligne fournisseur avec un prix d'achat.
  - `catalog_item_proposals_propose` construit ses clés (marque, modèle, EAN) **depuis les lignes fournisseur**, jamais
    depuis l'article.
  Un article importé seul serait invisible aux deux : au premier relevé, chaque produit recréerait un article.
- `authenticated` ne peut écrire ni `model_key`, ni `code_ean`, ni `origin` sur `catalog_items` (UPDATE par colonne,
  migration `20261028_4`) : l'import passe donc par des RPC, comme l'import des clients.

## 3. Buts, non-buts, anti-buts

**Buts**
1. Importer un `.xlsx` / `.csv` d'articles : fichier type, correspondance des colonnes, aperçu, envoi par lots,
   imports précédents, retrait d'un import — même parcours que l'import des clients.
2. Chaque article importé porte ses clés de rapprochement (marque, modèle normalisé `model_key`, EAN valide) et sa
   référence interne (`code`).
3. Si le fichier porte des colonnes fournisseur (nom du fournisseur, référence chez lui, prix d'achat), créer aussi la
   ligne fournisseur rattachée à l'article, **par l'écrivain unique**, de sorte qu'un relevé ultérieur du même
   fournisseur mette à jour cette ligne au lieu de la doubler. La marge est alors connue tout de suite.
4. Étendre le branchement automatique et les propositions de fusion aux articles qui portent leurs propres clés, même
   sans aucune ligne fournisseur.

**Non-buts (v1)**
- Ouvrages / articles composés (nomenclature d'un ouvrage en sous-articles) : une ligne « ouvrage » est écartée avec
  sa raison.
- Mise à jour d'articles existants par un second import (prix, libellés) : un article déjà présent est un doublon,
  écarté par défaut (§ 6.4). Mettre à jour en masse sera un autre chantier.
- Photos et fiches techniques depuis le fichier (une adresse d'image n'est pas téléchargée en v1).
- Correction de « Import Excel » de la fiche fournisseur (signalée à part).
- Lecture assistée par un modèle (correspondance des colonnes) : comme la tranche 2 de l'import des clients, plus tard.

**Anti-buts (échec même si « ça marche »)**
- Un relevé fournisseur qui recrée en double les articles importés.
- Un import qui modifie ou désactive une ligne fournisseur ou un article existant sans que l'utilisateur l'ait vu.
- Une ligne du fichier perdue en silence : **lignes lues = importées + doublons écartés + écartées**, affiché et testé.
- Un article importé dans une autre organisation, ou un fournisseur d'une autre organisation réutilisé.

## 4. Approches considérées

1. **Articles seuls, avec leurs clés** ; les fournisseurs se branchent plus tard par leurs relevés. Simple, mais la
   marge reste vide jusqu'au premier relevé, même si le fichier connaît le prix d'achat.
2. **Articles et fournisseurs obligatoires dans le fichier.** Marge immédiate, mais refuse les bases sans fournisseur
   (main d'œuvre, stock, articles internes) — fréquent.
3. **Les deux : approche 1 toujours, colonnes fournisseur facultatives.** **Retenue par Eric (2026-11-28).** Accepte
   tout fichier, donne la marge quand le fichier la porte, et prépare le branchement des relevés sans doublon.

## 5. Ce que l'utilisateur fait

Page `/articles/import` (bouton « Importer » de la page Articles), **administrateur seul** (écran et RPC), module de
la page Articles. Mêmes étapes et mêmes composants d'habillage que `/clients/import` :

```
1. Fichier      Déposer .xlsx / .csv  ·  « Télécharger le fichier type »
2. Colonnes     Colonne du fichier  →  Champ Majord'home (présélection par synonymes, modifiable)
3. Aperçu       N lignes lues · X articles · Y lignes fournisseur · Z doublons · W écartées
                Fournisseurs du fichier : « BAYWA » → BayWa r.e. (existant) | « Cedeo » → à créer [coché]
                Valeurs à interpréter : Nature « Fourniture » → Équipement, « MO » → Main d'œuvre …
4. Envoi        Lots de 200, barre d'avancement, reprise sans doublon
5. Résultat     Compte rendu, lignes écartées téléchargeables avec leur raison
   Imports précédents : date, auteur, compteurs, « Retirer cet import »
```

## 6. Règles

### 6.1 Champs importables

Catalogue unique dans un module pur `src/lib/importArticles/champs.js` (même forme que `importClients/champs.js` :
clé, libellé, colonne cible, type, synonymes, exemple, aide).

| Champ | Cible | Notes |
|---|---|---|
| Désignation | `catalog_items.name` | **obligatoire** ; sans elle la ligne est écartée |
| Référence interne | `catalog_items.code` | unique par organisation, insensible à la casse (index existant) |
| Marque | `brand` | |
| Modèle / réf. fabricant | → `model_key` | normalisé par `calculerModelKey(marque, [modèle, désignation])` (`src/lib/catalogue/modelKey.js`) ; la valeur brute est gardée dans `specs.canonical.modele_import` |
| Code EAN | `code_ean` | gardé seulement s'il est valide `^[0-9]{8,14}$`, sinon vidé et compté |
| Catégorie | `category` | valeur du fichier rapprochée de `PRODUCT_CATEGORIES` (libellé ou code) ; inconnue ⇒ vide, comptée |
| Gamme | `gamme` | |
| Nature | `product_kind` | `main` · `accessory` · `stock` · `main_oeuvre` (`NATURES_ARTICLE`) ; correspondance des valeurs à l'aperçu ; vide ⇒ `main` ; « ouvrage » ⇒ ligne écartée |
| Unité | `unit` | rapprochée des unités connues ; inconnue ⇒ `pièce`, comptée |
| TVA | `default_tva_rate` | 0 / 5,5 / 10 / 20 ; vide ⇒ 20 ; autre ⇒ 20, compté |
| Prix de vente HT | `selling_price_ht` | vide ⇒ 0 (« à renseigner », comme aujourd'hui) |
| Description | `description` | |
| Fournisseur | (ligne fournisseur) | facultatif, voir § 6.3 |
| Réf. fournisseur | `supplier_products.reference` | obligatoire pour créer la ligne fournisseur |
| Prix d'achat HT | `supplier_products.purchase_price_ht` | obligatoire et > 0 pour créer la ligne fournisseur |
| Prix public HT | `supplier_products.tarif_public` | facultatif |
| Date du prix | `supplier_products.purchase_price_at` | facultatif ; jj/mm/aaaa ; future ⇒ vidée et comptée ; voir § 6.3 |
| Ancien numéro | `specs.canonical.ancien_numero` | numéro de l'article dans l'ancien logiciel, si distinct de la référence interne |

Une valeur illisible (prix, TVA, EAN) vide le champ et se compte à l'aperçu, comme pour les clients. Un prix TTC n'est
jamais deviné : les prix du fichier sont lus HT (dit à l'aperçu et dans l'aide du fichier type).

### 6.2 Article créé

`origin = 'manuel'`, `source_product_id = NULL`, `import_id` + `import_line` (nouvelles colonnes, comme `clients`),
`specs.canonical` avec ce qui n'a pas de colonne. Créé par la RPC, jamais par un `insert` du front.

### 6.3 Ligne fournisseur (facultative)

Créée seulement si la ligne du fichier a **fournisseur + réf. fournisseur + prix d'achat > 0** ; sinon l'article est
importé seul et l'aperçu dit pourquoi (« sans prix d'achat : pas de ligne fournisseur »).

- **Fournisseur reconnu par son nom** dans l'organisation (comparaison sans casse ni accents ni forme juridique) ;
  inconnu ⇒ proposé « à créer » à l'aperçu, coché par défaut ; décoché ⇒ ses lignes sont importées comme articles seuls.
  Un fournisseur n'est jamais pris dans une autre organisation.
- **Écriture par `supplier_catalog_upsert`** (écrivain unique), un appel par fournisseur et par lot, avec
  `p_meta.desactiver_absents = false` (un import n'est pas un relevé complet : rien n'est désactivé) et une
  `source_version` propre à l'import (`import-articles_<import_id>`) : la ligne entre dans l'index unique
  `(supplier_id, reference)` des lignes relevées, donc **le relevé suivant du même fournisseur la met à jour en place**.
- **La ligne est rattachée à SON article, pas à un article retrouvé** : lien posé par la RPC d'import, source
  `catalog_item_link_source = 'import'` (nouvelle valeur). Il faut l'empêcher d'être vue par `catalog_items_ensure`
  (appelé à la fin de `supplier_catalog_upsert`) avant d'être rattachée — sinon `ensure` créerait un second article.
  Mécanisme au choix du builder (passer l'article dans la ligne, ou un cœur interne partagé), à tester.
- Une ligne fournisseur qui **existe déjà** (même fournisseur, même référence ; active ou non, rattachée ou non) :
  la ligne du fichier est un doublon fort (§ 6.4) et **n'est jamais envoyée à l'upsert** — sinon il modifierait prix,
  date ou état d'une ligne existante sans que l'utilisateur l'ait vu. Recochée, elle crée l'article seul, sans ligne
  fournisseur. On ne déplace jamais une ligne existante. *(Décision de conception, à relire par Eric.)*
- Champs humains de la ligne posés à l'insertion seulement (règle existante de l'upsert).
- **Date du prix d'achat (décision d'Eric, 2026-11-28 : option B)** : la colonne « Date du prix » du fichier si elle
  est remplie ; sinon `purchase_price_at = NULL` — « date inconnue », donc **jamais frais** (`estFrais` de
  `ageDePrix.js`), affiché comme tel sur la fiche article. Le prix sert quand même à la marge (règle inchangée : prix
  d'achat le plus bas en base) tant qu'il n'y en a pas d'autre ; le premier relevé ou la première facture de ce
  fournisseur met cette ligne à jour en place, avec sa date. Aujourd'hui l'upsert remplace une date absente par
  `now()` (`COALESCE(r.purchase_price_at, now())`) : l'import doit pouvoir écrire une date absente (paramètre de l'upsert
  ou mise à jour dans la RPC d'import, au choix du builder) sans changer ce comportement pour les relevés.
  Limite connue : un vieux prix bas importé chez le fournisseur A reste le plus bas face à un prix récent plus élevé du
  fournisseur B, tant que A n'est pas relevé — la marge suit la règle existante, l'âge du prix est affiché.

### 6.4 Doublons (avec la base existante et dans le fichier)

Comptés à l'aperçu, **écartés par défaut**, recochables un par un ou « Tout importer / Tout écarter » (comme les
clients). Fort : même référence interne (`code`) — non recochable, l'index unique l'interdit ; même EAN valide ; même
marque + `model_key` ; même fournisseur + réf. fournisseur. Faible (importé par défaut, signalé) : même désignation
normalisée sans marque. **Liste des articles existants inconnue ou en chargement ⇒ import fermé**, jamais « aucun
doublon ». Deux lignes du fichier avec la même référence interne : la seconde est écartée.

### 6.5 Branchement des fournisseurs sur les articles (le cœur de l'objectif)

Modifier, par migration versionnée répétée sur le harnais :

- **Cas à couvrir** : les références d'un ancien logiciel diffèrent souvent de celles du site du fournisseur. Le
  premier relevé complet désactive alors la ligne importée, et l'étape 2 écartait l'article (il « a déjà une ligne de
  ce fournisseur »). D'où les deux règles ci-dessous. *(Décisions de conception, à relire par Eric.)*
  - Le test « l'article n'a pas encore de ligne de ce fournisseur » ne compte que les lignes **actives**.
  - « Sans fournisseur » = **aucune ligne active avec un prix d'achat**. Effet assumé, toutes organisations : un
    article dont toutes les lignes ont été éteintes par un relevé redevient candidat par ses propres clés (un produit
    revenu sous une nouvelle référence se rattache au lieu de se doubler). À mesurer sur la base avant / après.
- **`catalog_items_ensure`, étape 2** : un article **sans ligne active avec prix** devient candidat s'il porte ses
  propres clés (`brand` + `model_key`, ou `code_ean` valide), même nature, un seul candidat. Contrôle de prix adapté :
  sans prix d'achat connu, le prix d'achat de la ligne doit être ≤ au prix de vente de l'article quand celui-ci est
  renseigné (> 0), sinon pas de contrôle de prix. Source du lien : `cle` / `ean` comme aujourd'hui. Les articles qui
  ont des lignes gardent la règle actuelle (rapport ≤ 2).
- **`catalog_item_proposals_propose`** : les clés d'un article viennent aussi de l'article lui-même (union de ses
  lignes et de ses colonnes `brand` / `model_key` / `code_ean`), pour proposer la fusion « article importé ↔ article
  créé par un relevé » quand le rattachement franc n'a pas tranché (plusieurs candidats, nature différente). Garder les
  garde-fous de `20261027_5` (tables temporaires indexées + `ANALYZE`, clé partagée par plus de 10 articles écartée).
- **Survivant d'une fusion** : la règle actuelle (le plus ancien) donne l'article importé s'il précède le relevé ;
  c'est voulu (il porte la référence interne et le prix de vente de l'entreprise).

À mesurer après livraison sur un vrai relevé : nombre d'articles importés rattachés / proposés / doublés.

### 6.6 Retrait d'un import

Comme les clients : par lots, seulement les articles que **rien ne référence** (lignes de devis, documents, autres
lignes fournisseur que celles créées par cet import, fusions), lu dans `pg_constraint` à l'exécution. *(Décision de
conception, à relire par Eric :)* une ligne fournisseur créée par l'import et **jamais reprise par un relevé**
(`specs.source_version` encore égale à celle de l'import) est supprimée avec son article : elle n'existe que par
l'import. Une ligne **reprise par un relevé** (source changée) prouve que le fournisseur vend le produit : son article
est **conservé** et compté comme tel. Un fournisseur créé par l'import n'est jamais supprimé. Statut `retire` quand il ne reste
aucun article de l'import ; compteurs `retires` / `conserves`.

## 7. Base de données (migration à répéter sur `scripts/migration-rehearsal/`)

- Table `majordhome.catalog_imports` (calquée sur `client_imports` : org, auteur, nom de fichier, statut, compteurs,
  correspondance des colonnes et des valeurs, fournisseurs créés), RLS lecture membre org_admin, **aucune policy
  d'écriture**, `GRANT SELECT … TO service_role` si une vue publique la lit.
- `catalog_items` : `import_id uuid REFERENCES catalog_imports ON DELETE SET NULL`, `import_line integer`, index unique
  partiel `(import_id, import_line)` (rejeu d'un lot sans doublon). Toute vue qui expose ces colonnes les ajoute en fin
  de liste, sans réémettre de GRANT de table entière sur `majordhome_catalog_items` (ACL par colonne, `20261028_4`).
- `supplier_products.catalog_item_link_source` : ajouter la valeur `import` si un CHECK la borne.
- RPC SECURITY DEFINER, `REVOKE … FROM PUBLIC, anon`, garde positive `IF (org_admin actif de l'org de l'IMPORT) IS NOT
  TRUE THEN refuser`, `auth.uid() IS NULL` refusé en premier : `catalog_items_import_start`, `_batch` (200 lignes, tout
  ou rien, liste FERMÉE de clés : aucune clé `org_id` lue dans les lignes), `_finish`, `_removal_preview`, `_remove`.
  Codes d'erreur ↔ phrases dans un `messageErreurImport` côté module pur, testé dans les deux sens.
- `_batch` appelle `supplier_catalog_upsert` (service_role) depuis la fonction SECURITY DEFINER ; le fournisseur
  passé doit être de l'organisation de l'import (contrôle déjà dans l'upsert, à garder).

## 8. Front

- Modules purs `src/lib/importArticles/` (testés `scripts/import-articles/*.test.mjs`, dans `audit:quality`) :
  `champs.js`, `normaliser.js` (prix, TVA, EAN, unité, nature, catégorie), `controles.js`, `fournisseurs.js`
  (rapprochement des noms), `doublons.js`, `lots.js` (`verifierLigne` miroir clé par clé de ce que `_batch` accepte),
  `fichierType.js`. **Réutiliser tel quel** ce qui n'est pas propre aux clients : `lireFichier.js` (lecture, réparation
  des accents abîmés), `correspondance.js` si sa forme le permet ; sinon le déplacer dans un module commun plutôt que
  le recopier.
- Écrans `components/catalogue/import/` sur le modèle de `components/clients/import/` ; le hook de parcours n'écrit
  rien lui-même hors des RPC.
- Lien « Importer » dans l'en-tête de la page Articles (action secondaire, l'action `primary` reste « Nouvel article »).

## 9. Ce qui est laissé au builder

Découpage des migrations, mécanisme exact qui empêche `ensure` de voir la ligne fournisseur avant son rattachement,
mise en commun des modules de l'import des clients, libellés de l'aperçu, ordre des tranches. Toute décision de
comportement non écrite ici remonte à Eric.

## 10. Signalé, hors de ce chantier

« Import Excel » de la fiche fournisseur (`bulkCreateProducts`) supprime toutes les lignes du fournisseur puis
réinsère sans passer par `supplier_catalog_upsert` ni créer d'articles : à faire passer par l'écrivain unique ou à
retirer. Passage dédié.
