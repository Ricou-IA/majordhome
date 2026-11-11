# Pièces détachées Invicta — relevé codifié, nomenclature par appareil, prix dans l'outil

Date : 2026-11-11 · Demandeur : Eric · Statut : à valider

## 1. Intention

Eric (2026-11-11) : « Le catalogue Invicta n'est pas enrichi. Je suis connecté sur le site fabricant. Pour les poêles,
il faudrait importer les fiches techniques, les caractéristiques à renseigner dans le devis, et les vues éclatées pour
avoir directement dans l'application la liste des pièces détachées. » Puis : « Si tu retrouves le modèle de données
(ou le JSON du site), pense à codifier tout cela pour faire des mises à jour rapides. L'objectif aussi serait d'avoir
le prix des pièces détachées dans notre outil. »

Pourquoi : aujourd'hui, pour un SAV de poêle, il faut quitter l'outil, ouvrir le site Invicta, retrouver l'appareil,
lire la vue éclatée, noter référence et prix, puis ressaisir dans le devis. On veut la vue éclatée, la liste des
pièces et leur prix sur la fiche de l'appareil du client et dans la fiche SAV, et poser la pièce dans un devis sans
ressaisie. Et on veut pouvoir rafraîchir tout cela en quelques minutes quand Invicta change ses prix.

Ce document couvre **les pièces détachées, les vues éclatées, les photos et les documents** du site
`pieces-detachees.invicta-group.fr`. Les **caractéristiques techniques pour le devis** sont un second chantier (§ 9) :
le site ne les porte pas.

## 2. État des lieux (mesuré le 2026-11-11)

**En base (prod, org Mayer)** : fournisseur « INVICTA » sans site ni connecteur ; 160 lignes
`supplier_products` (144 `category='poele'`, 16 sans catégorie), toutes actives, toutes avec un article
(`catalog_item_id`), prix d'achat et de vente renseignés ; **aucune marque (`brand` NULL), aucune photo, `specs` vide,
aucun document**. Ces lignes ne viennent pas d'un relevé (pas de `specs.source_version`). Parc client : 47 équipements
de marque Invicta, 6 Deville ; le champ modèle est saisi librement (« pyra », « 611444 », « p945044 »,
« rustica p 917644 », « insert 700 turbo », vide pour 7).

**Le site** (application Angular, API JSON `/api/1.0.0/…`, session du compte pro Mayer, cookies ; lecture seule) :

| Appel | Contenu |
|---|---|
| `GET manufacturers/{publicId}` | marque (Invicta = `VdklLfh0Fp` ; aussi Deville `ZMD5qmG5J4`, La Foyère `BxEI1Dt2FX`, Laudel `GVoLKzB0dO`, La Romaine `J8xiGIvrsT`) |
| `GET categories/{publicId}` | rayon d'une marque (Invicta : Poêles `6rHQ2VQ7V0`, Granulés `5pTmF26SXD`, Foyers `WcBUWh6va6`, Inserts `o5eeayGEi7`) |
| `GET products?Category={id}&Limit=100&Offset=n` | appareils d'un rayon : `{ items[], totalCount, hasNextItems }` |
| `GET products/{publicId}` | un appareil complet, avec `items[]` = sa nomenclature |
| `GET products/{id}/documents` | documents (`id` = uuid de l'appareil) : `{ id, type, label, fileKey, publicFileKey, displayOrder }` |
| `GET products/{publicId}/variants`, `GET products/{id}/links` | variantes / liens (vides sur l'échantillon) |
| `GET products/search?Query=…` | recherche par référence ou nom |

Volumes Invicta : **470 appareils** (174 poêles, 116 granulés, 124 foyers, 56 inserts). Sur un échantillon de 32
appareils : 1 037 lignes de nomenclature (≈ 32 par appareil), 454 pièces distinctes (les pièces sont largement
partagées entre appareils), 25 appareils sur 32 ont une vue éclatée, 15 sur 32 ont au moins un document.

Appareil (`products/{publicId}`) — champs utiles : `id` (uuid), `publicId`, `reference` (« P601314 »), `name`
(« POELE OXANA - P601314 »), `manufacturer.name`, `lifecycleStage`, `image` (photo, variantes 160 → 800 px sur
`cdn.prod.platform.invicta-group.fr/media/variants/{fileId}`), `gallery.explodedViews[]` (image de la vue éclatée,
jusqu'à ≈ 700 × 800 px, rôle `Zoom`), `items[]`. Les champs `powerOutput`, `fuel`, `description`, `material`,
`frontWidth`, `ecolabel`, `weight` existent mais sont **vides sur les 32 appareils sondés**.

Ligne de nomenclature (`items[]`) : `reference` = **numéro de repère** sur la vue éclatée (« 23 », parfois une plage
« 7-14 »), `quantity`, `notes` (« (Boitier Insertion SOFT) »), et `item` = la pièce : `reference` (« F670108B »),
`name`, `price` (HT), `taxRate`, `weight`, `unitCode`, `publicId`, `isPurchasable`, `isBundle` / `isVirtualKit`
(pièce vendue en kit), `onlyAvailableInBundle`, `lifecycleStage` (`OnSale` 1 010 · `Discontinued` 24 ·
`UntilEndOfStock` 3 sur l'échantillon), `replacementProduct` (`{ reference, name, description }`, 26 cas),
`stockAvailable`, `image`. **Un même repère revient sur plusieurs lignes d'un appareil** (226 cas sur 1 037 :
variantes de couleur ou de version, distinguées par `notes` ou par la désignation).

Types de documents rencontrés : `Notice`, `Datasheet` (7 appareils sur 32 — probablement la fiche technique),
`Procedure` (mise en service, dépannage carte Micronova, kit Wi-Fi…), `Program` (micrologiciel de la carte).

Recoupement : 110 de nos 155 références distinctes existent à l'identique sur le site. Les 45 absentes : accessoires
(P69…), quelques appareils récents (P942111 / P942112 OVE Plug-in, P649000 Aratos Plug-in), 4 références C02….

**Prix** (Eric, 2026-11-11) : le « Prix HT » du site est l'assiette ; une remise de 30 % s'applique sur le panier.
« Pour l'instant prix HT = prix public. »

## 3. Buts, hors-champ, échecs à éviter

**Buts**
1. Un relevé complet du site, **codifié et rejouable** : un script lancé depuis le navigateur connecté d'Eric produit
   un fichier daté ; un import en tire tout le reste. Rafraîchir les prix = relancer les deux.
2. Les pièces détachées dans le catalogue, avec leur prix, trouvables par référence ou désignation et posables dans
   un devis.
3. La nomenclature de chaque appareil (repère, pièce, quantité, remarque) et sa vue éclatée, consultables sur la
   fiche de l'équipement du client et dans la fiche SAV.
4. Photo, notice, fiche technique et procédures rangées sur le modèle d'appareil.
5. Les 470 appareils Invicta, pas seulement ceux que Mayer vend : le parc installé compte des anciens modèles.
6. Une méthode réutilisable telle quelle pour les quatre autres marques du site.

**Hors-champ (ce document)**
- Les caractéristiques techniques imprimées dans le devis (puissance, rendement, dimensions) : § 9.
- Passer commande sur le site Invicta depuis l'outil (panier, bons de commande).
- Le stock Invicta en temps réel (`stockAvailable` est relevé pour information, jamais présenté comme fiable).
- Les micrologiciels (`Program`) : non importés.
- Un relevé automatique côté serveur : le site est derrière une session de compte pro, on reste sur le relevé
  navigateur (même posture que Domos et Tereva). Aucun identifiant Invicta n'est stocké.

**Ce qui ferait de la livraison un échec même si « ça marche »**
- Un relevé de pièces qui **désactive les 160 lignes du tarif Invicta** (cf. § 5.2 : c'est le comportement par défaut
  de l'écrivain du catalogue).
- Une vue éclatée ou une liste de pièces affichée sur le mauvais appareil (rattachement approximatif par le nom).
- Un prix affiché sans dire que c'est le prix public, ou un prix d'achat inventé.
- Des milliers de pièces qui polluent le choix d'un poêle ou d'une batterie dans un devis.
- Une pièce arrêtée ou remplacée proposée sans le signaler.
- Un relevé partiel (session expirée au milieu) importé comme complet.

## 4. Ce que l'utilisateur voit

Les écrans sont des propositions de conception (Eric n'en a rien dit) ; à valider avec ce document.

**Fiche de l'équipement d'un client** (carte équipement de la fiche client, là où vivent déjà les « Documents » du
modèle) et **fiche d'intervention / SAV** : un bloc « Pièces détachées ».
- Si l'équipement est rattaché à un modèle fabricant : la vue éclatée (agrandissable), un champ « Numéro de repère »
  (plusieurs repères séparés par des virgules, comme sur le site) et le tableau repère · référence · désignation ·
  quantité · prix public HT. Une pièce arrêtée porte la mention « Arrêtée », avec « Remplacée par <référence> » quand
  le site le dit ; une pièce vendue en kit porte « Kit ». Jamais la couleur seule.
- Si l'équipement n'est pas rattaché : « Choisir le modèle fabricant », qui propose d'abord les modèles dont la
  référence ou le nom ressemble à ce qui est saisi (marque + modèle), puis une recherche libre. Le choix est
  enregistré sur l'équipement et se change.
- Depuis la fiche SAV : cocher des pièces → « Ajouter au devis » ouvre le devis SAV (fenêtre de devis existante) avec
  ces pièces en lignes du chapitre « PIÈCES », au prix public, quantité 1 modifiable.

**Recherche d'articles du devis** : une pièce se trouve par sa référence ou sa désignation dans les familles
« Dépannage / SAV », « Entretien / ramonage » et « Pièces détachées » ; elle n'apparaît pas dans le choix d'un poêle.

**Réglages → Fournisseurs → INVICTA** : la date du dernier relevé de pièces et ses compteurs (appareils, pièces,
nouvelles, désactivées), la remise sur les pièces (30 % par défaut, modifiable), et le rappel de la marche à suivre
pour rafraîchir.

**Fiche article d'un poêle du catalogue** (les 110 références communes) : la photo du site si l'article n'en a pas,
la marque « INVICTA » posée, et un lien vers la nomenclature du modèle.

## 5. Conception

### 5.1 Relevé (navigateur) — `scripts/catalogue/dump-invicta-pieces.browser.js`

À coller dans la console du navigateur connecté, comme `dump-woocommerce.browser.js`. Paramètre : la marque (publicId
du fabricant, Invicta par défaut). Il parcourt les rayons de la marque, pagine les appareils, puis pour chaque
appareil lit `products/{publicId}` et `products/{id}/documents`, avec une concurrence faible (4 requêtes à la fois) et
une pause pour ne pas charger le site. Il produit **un fichier** `invicta-pieces-AAAA-MM-JJ.json` à déposer dans
`scripts/catalogue/data/` :

```
{ source, fetched_at, manufacturer: { publicId, name },
  categories: [{ publicId, name, total }],
  appareils: [{ id, publicId, reference, name, categorie, lifecycleStage,
                photo: { url, fileId } | null,
                vues_eclatees: [{ url, fileId, width, height }],
                documents: [{ id, type, label, fileKey, publicFileKey }],
                items: [{ repere, quantity, notes,
                          piece: { publicId, reference, name, price, taxRate, weight, unitCode, isPurchasable,
                                   isBundle, isVirtualKit, onlyAvailableInBundle, lifecycleStage, stockAvailable,
                                   image_url, remplacement: { reference, name } | null } }] }] }
```

Le relevé garde les champs bruts utiles et rien d'autre (pas de panier, pas de compte). Il **échoue bruyamment** si un
rayon rend moins d'appareils que son `totalCount`, si un appel répond 401 / 403 (session expirée) ou si un appareil
n'a pas pu être lu : aucun fichier partiel n'est téléchargé.

### 5.2 Adaptateur pur et import — `scripts/catalogue/invicta-pieces.js`, `scripts/catalogue/import-invicta-pieces.mjs`

Module PUR (aucun import React / Supabase), testé sur le relevé réel
(`scripts/catalogue/invicta-pieces.test.mjs`, dans `audit:quality`, qui pinne le nombre d'appareils, de pièces
distinctes et la somme des prix du relevé de référence). Il transforme le relevé en trois listes :

1. **Pièces** (dédoublonnées par référence sur tout le relevé) → lignes pour l'écrivain unique
   `supplier_catalog_upsert`, fournisseur INVICTA :
   - `reference`, `name` = ceux du site ; `brand` = nom de la marque du relevé ; `category = 'piece_detachee'`
     (nouvelle catégorie) ; `product_kind = 'accessory'` ; `unit` d'après `unitCode` ; `default_tva_rate` = 20 ;
   - `tarif_public` = prix HT du site ; `taux_remise` = remise du fournisseur (§ 5.5) ;
     `purchase_price_ht` = prix public × (1 − remise) ; `selling_price_ht_defaut` = prix public (convention maison :
     vente = prix public, la remise se fait sur le devis) ;
   - `specs.source_version` = version du relevé ; `specs.canonical` : `cycle_de_vie`, `remplacee_par`
     (référence), `kit` (booléen), `vendue_seule` (faux si `onlyAvailableInBundle` ou non achetable), `poids_kg`,
     `stock_releve` ;
   - `image_url` quand la pièce a une image.
   - Une même référence vue avec deux prix différents dans le relevé = erreur bruyante (pas de choix silencieux).
   - Une pièce sans prix ou non achetable est relevée à 0 € (elle n'obtient donc pas d'article, règle existante) et
     reste visible dans la nomenclature, sans prix.
2. **Modèles d'appareil** : référence fabricant, nom nettoyé (« OXANA » depuis « POELE OXANA - P601314 », le nom
   complet est conservé), marque, rayon du site, cycle de vie, photo, vues éclatées, documents.
3. **Nomenclature** : (modèle, position, repère, référence de pièce, quantité, remarque).

**Contrainte forte sur l'écrivain du catalogue.** `supplier_catalog_upsert` désactive par défaut **toute ligne active
du fournisseur absente du relevé** — donc les 160 lignes du tarif INVICTA si on lui passe un relevé de pièces. L'import
des pièces appelle l'écrivain avec `p_meta.desactiver_absents = false`, puis désactive lui-même, dans le même SQL, les
seules lignes `category = 'piece_detachee'` **issues d'un relevé de pièces de la même marque** et absentes du nouveau
relevé (marquées `desactive_par_releve`, jamais supprimées, réactivées si elles reviennent — même règle que
l'écrivain). Le harnais de répétition porte une assertion : après un relevé de pièces, les lignes du tarif sont
toujours actives.

L'écrivain met aussi à jour une ligne existante de même référence chez le même fournisseur : si une référence de
pièce coïncide avec une référence du tarif (les accessoires P69… pourraient être aussi des pièces), le prix d'achat de
la ligne du tarif serait écrasé par le prix calculé. L'adaptateur **exclut de la liste des pièces toute référence qui
existe déjà chez le fournisseur hors catégorie `piece_detachee`** et la compte (« déjà au tarif ») ; la nomenclature
pointe alors la ligne du tarif.

L'import génère un SQL rejouable dans `scripts/catalogue/out/` (appliqué par `scripts/fumisterie/apply-sql.mjs`,
comme les autres imports), par lots si la taille l'exige (≈ 470 appareils, de l'ordre de 15 000 lignes de
nomenclature et quelques milliers de pièces). Ordre : pièces (écrivain) → modèles → nomenclature. Les modèles et la
nomenclature sont écrits par une RPC dédiée `service_role` (§ 5.3), jamais par des INSERT épars.

Le même SQL pose, sur les lignes du tarif INVICTA dont la référence correspond à un modèle relevé : la marque
(`brand = 'INVICTA'` si NULL, sur la ligne et sur son article) et la photo de l'article si elle est absente. Ce sont
des champs humains : ils ne sont écrits que s'ils sont vides.

### 5.3 Données

Nouvelle migration versionnée, répétée sur le harnais. Trois objets nouveaux :

**`majordhome.equipment_models`** — le modèle fabricant, par org. `org_id`, `brand`, `brand_key` (dérivée de
`majordhome.equipment_model_key`, source unique existante), `reference` (référence fabricant), `reference_key`,
`name` (nom complet du site), `model_name` (nom nettoyé), `model_name_key`, `category` (rayon du site : poêle,
granulés, foyer, insert), `lifecycle`, `photo_path`, `exploded_views` (jsonb : chemins Storage + dimensions),
`source` (jsonb : site, publicId, version du relevé), `is_active`, horodatages. Unique `(org_id, brand_key,
reference_key)`.

**`majordhome.equipment_model_parts`** — la nomenclature. `org_id`, `equipment_model_id` (FK, cascade), `position`,
`repere` (texte : « 23 », « 7-14 »), `supplier_product_id` (FK vers la ligne de la pièce), `quantity`, `notes`. Pas
d'unicité sur le repère (un repère porte plusieurs variantes). Remplacée en bloc, par modèle, à chaque relevé.

**`majordhome.equipments.equipment_model_id`** — rattachement explicite d'un équipement client à son modèle
fabricant (nullable, FK `ON DELETE SET NULL`). **Aucun rattachement automatique par le nom** : l'écran propose, un
humain choisit. Seule exception, à l'import : un équipement dont la marque correspond et dont le modèle saisi,
normalisé, est **exactement** une référence fabricant (avec ou sans le « P » initial : « 611444 », « p945044 ») est
rattaché d'office, et le compte en est rendu.

Documents : `majordhome.equipment_documents` reçoit une colonne `equipment_model_id` (nullable) et les types
`fiche_technique` et `procedure` s'ajoutent à `notice` / `vue_eclatee` / `autre`. Un document relevé est rattaché au
modèle fabricant ; la vue `majordhome_equipment_model_documents` rend aussi, pour un équipement, les documents de son
modèle rattaché. Les documents déposés à la main (clé marque + modèle saisis) continuent de fonctionner à
l'identique. Un document relevé porte sa provenance (`source` : identifiant du document sur le site) pour être
remplacé et non doublé au relevé suivant.

Droits (charte multi-tenant) : RLS activée ; lecture = membre de l'org ; **aucune écriture depuis le front** sur
`equipment_models` / `equipment_model_parts` (écrites par la RPC d'import `service_role`) ; le rattachement d'un
équipement suit les droits d'écriture existants des équipements (`role_can(org, 'clients', 'edit')` — le technicien
qui a l'appareil sous les yeux peut choisir le modèle). Vues publiques `majordhome_equipment_models` et
`majordhome_equipment_model_parts` (cette dernière jointe à la pièce : référence, désignation, prix public, cycle de
vie, remplacement, kit, article), `security_invoker = true`, `REVOKE … FROM PUBLIC, anon`, `GRANT SELECT` à
`service_role`. RPC d'import `equipment_models_upsert(p_org_id, p_brand, p_source_version, p_models jsonb)` :
SECURITY DEFINER, `service_role` seul (elle prend `org_id` en paramètre), refuse un relevé vide, désactive les
modèles de la marque absents du relevé sans jamais les supprimer (un équipement client peut y être rattaché), remplace
la nomenclature de chaque modèle reçu, résout chaque pièce par (fournisseur, référence) et **échoue si une référence
de nomenclature ne se résout pas**.

### 5.4 Fichiers (photos, vues éclatées, documents)

Les fichiers sont **copiés dans notre Storage** (bucket `product-documents`, chemin
`${orgId}/equipment-models/…`, policies existantes), jamais affichés par lien direct vers le site Invicta : un lien
externe casse le jour où le site change, et la fiche SAV doit s'ouvrir sur le terrain. Script
`scripts/catalogue/attach-invicta-fichiers.mjs`, sur le modèle de `attach-fiches.mjs` : il lit le relevé, télécharge
ce qui manque, dépose, puis écrit les chemins (SQL rejouable). Il est **incrémental** (un fichier déjà déposé pour le
même `fileId` n'est pas retéléchargé) et **non bloquant** (un fichier en échec est compté et listé, l'import des prix
et de la nomenclature n'en dépend pas).

À vérifier par le constructeur avant de choisir la voie : les images sont sur un CDN (`cdn.prod.platform…`) qui
paraît public ; l'adresse de téléchargement d'un document (à partir de `fileKey` / `publicFileKey`) n'a pas été
relevée. Si une ressource exige la session, elle est récupérée par le script navigateur (dans le relevé ou un second
script de console), **jamais en rejouant la session d'Eric depuis un serveur ou un script Node**. Types importés :
`Notice`, `Datasheet` (→ `fiche_technique`), `Procedure`. `Program` ignoré.

### 5.5 Remise et prix

`suppliers.connector_config.pieces = { remise_pct: 30, marque_site: 'VdklLfh0Fp', site: 'https://pieces-detachees.invicta-group.fr' }`,
modifiable dans la fiche fournisseur (règle « pas de configuration sans écran »). L'import lit la remise en base ;
absente → 0 % et un avertissement. À l'écran, le prix montré dans la nomenclature est le **prix public HT**, libellé
comme tel ; le prix d'achat (public − remise) sert à la marge du devis, comme pour tout article.

### 5.6 Devis

- Catégorie `piece_detachee` : exclue des familles qui listent leurs catégories (poêle, batterie…) par construction ;
  visible dans les familles sans catégorie (« Dépannage / SAV », « Entretien / ramonage », « Pièces détachées »,
  « Autre »). Le constructeur vérifie que la recherche d'articles des chapitres de type « libre » de ces familles
  propose bien les articles du catalogue ; sinon il l'ajoute pour la catégorie `piece_detachee`.
- « Ajouter au devis » depuis la fiche SAV : `CreateDevisModal` avec `initialLines` (mécanisme existant, déjà utilisé
  par la climatisation) et `interventionId` (devis fléché SAV existant). Chaque ligne porte `catalog_item_id`,
  la référence de la pièce, sa désignation, le prix public.
- Aucun changement au modèle de document ni à l'envoi Pennylane.

### 5.7 Mise à jour

Marche à suivre, écrite dans l'en-tête des scripts et rappelée dans la fiche fournisseur :
1. Navigateur connecté au site Invicta → coller le script de relevé → fichier téléchargé.
2. `node scripts/catalogue/import-invicta-pieces.mjs --fichier …` → compte rendu (appareils, pièces, nouvelles,
   prix changés, désactivées, références déjà au tarif) → SQL.
3. Appliquer le SQL. 4. `attach-invicta-fichiers.mjs` pour les fichiers nouveaux.

Un relevé de prix seul (étapes 1 à 3) doit prendre quelques minutes. Claude peut faire l'étape 1 lui-même par
l'extension Chrome quand Eric est connecté.

## 6. Tranches

1. **Relevé et données** : script de relevé, adaptateur pur + tests sur le relevé réel, migration, import des pièces,
   des modèles et de la nomenclature, marque et photo des 110 articles communs. Fin de tranche : les pièces sont
   trouvables et chiffrables dans un devis SAV par la recherche d'articles.
2. **Fichiers** : photos, vues éclatées, documents copiés dans le Storage.
3. **Écrans** : bloc « Pièces détachées » (fiche équipement, fiche SAV), choix du modèle fabricant, « Ajouter au
   devis », bloc relevé de la fiche fournisseur.
4. **Autres marques du site** (Deville, La Foyère, Laudel, La Romaine) : même script, autre paramètre. À lancer sur
   demande d'Eric.

## 7. Décisions prises par le rédacteur (à confirmer par Eric)

- Les pièces sont des lignes du fournisseur INVICTA, pas un fournisseur à part.
- Prix d'achat = prix public − 30 % (remise réglable) ; Eric a dit « pour l'instant prix HT = prix public », ce que
  je lis comme « le prix du site est le prix public, donc le prix de vente par défaut ».
- Toutes les pièces à prix > 0 deviennent des articles (quelques milliers), dans une catégorie à part.
- Rattachement d'un équipement à son modèle : choisi par un humain, sauf référence fabricant saisie à l'identique.
- Fichiers copiés chez nous plutôt que liés.
- Micrologiciels non importés ; procédures importées.
- Pièce arrêtée : gardée, active, signalée (elle reste commandable jusqu'à épuisement et sert à identifier la
  remplaçante).
- Écrans du § 4.

## 7 bis. Précisions issues de la relecture (2026-11-11)

**Faits du dépôt à respecter**
- `piece_detachee` s'ajoute à `CATEGORIES_PRODUIT` (`src/lib/devisConfig.js`) et à `PRODUCT_CATEGORIES`
  (`suppliers.service.js`), sinon `validerDevisConfig` la refuse.
- Les chapitres de type « libre » cherchent déjà dans tout le catalogue (`DevisProductPicker.jsx`, `FILTRES.libre`) :
  rien à ajouter pour trouver une pièce dans un devis SAV. En revanche une famille sans catégorie avec un chapitre
  « OPTIONS » (VMC) listerait toutes les pièces (nature `accessory`) : la catégorie `piece_detachee` est exclue des
  chapitres de type `equipement` et `option`.
- `taux_remise` est un pourcentage (30, pas 0,3), comme dans `scripts/catalogue/achats.js`.
- `equipment_documents.brand` / `model` et leurs clés sont NOT NULL, avec un trigger qui refuse une clé vide : un
  document relevé porte la marque du relevé et la **référence fabricant** comme modèle ; la vue par équipement
  dédoublonne un document atteint à la fois par les clés et par `equipment_model_id`.
- Le tarif INVICTA compte 160 lignes pour 155 références distinctes : quand une référence de nomenclature tombe sur
  une référence du tarif en double, la ligne active la plus ancienne est retenue (et le cas est compté).
- Une org qui a déjà enregistré ses familles de devis ne reçoit pas les familles « Dépannage / SAV », « Entretien /
  ramonage », « Pièces détachées » : vérifier celles de Mayer avant la tranche 3 (lecture seule), et les lui faire
  ajouter dans Réglages → Devis si elles manquent.

**Décisions du rédacteur**
- **Relevé de référence** : pris au début de la tranche 1 par Claude, via l'extension Chrome, dans la session d'Eric
  (lecture seule), et rangé dans `scripts/catalogue/data/`. Les tests se pinnent dessus.
- **Autres marques** : toutes sous le fournisseur INVICTA (un seul compte, un seul panier). Chaque pièce garde dans
  `specs.canonical.releves_pieces` la liste des marques du site où elle a été vue ; un relevé de la marque X ne
  désactive une pièce que si X était sa **seule** marque. La marque (`brand`) d'une pièce est celle du premier relevé
  qui l'a créée.
- **Référence sur la ligne de devis** : une pièce posée dans un devis, par « Ajouter au devis » comme par la
  recherche d'articles, porte la référence Invicta de la pièce (c'est elle qu'on commande). Pour un article de
  catégorie `piece_detachee` sans référence interne, le picker reprend la référence fournisseur ; on n'écrit pas
  `catalog_items.code` à l'import (unicité par org, collisions possibles).
- **Pièce arrêtée ou remplacée** : signalée dans la nomenclature (fiche équipement, fiche SAV). La recherche
  d'articles du devis ne le signale pas en tranche 1 (limite assumée, à reprendre si Eric y bute).

**Décision d'Eric (2026-11-11) — le prix de vente d'une pièce suit le prix public à chaque relevé.** Exception à la
règle « prix de vente posé à l'INSERT seulement », limitée à la catégorie `piece_detachee` : au relevé, si le prix de
vente courant de la ligne est égal à l'ancien `tarif_public` (ou à 0), il prend le nouveau prix public, et le prix de
vente de l'article suit dans les mêmes conditions ; un prix modifié à la main (différent de l'ancien prix public) est
conservé et compté dans le compte rendu (« prix de vente ajustés à la main, non suivis »). Cette règle vit dans
l'import des pièces (ou une RPC dédiée `service_role`), pas dans `supplier_catalog_upsert`, dont le comportement ne
change pas pour les autres fournisseurs. Les devis déjà enregistrés ne bougent pas.

**Question encore ouverte** : lecture de « prix HT = prix public » (prix d'achat = prix public − 30 %, remise
réglable) et uniformité des 30 % sur toutes les pièces, kits compris. Sans réponse, l'hypothèse du § 7 s'applique ;
une erreur se corrige en changeant la remise et en rejouant l'import.

## 7 ter. Ce que le relevé complet a appris (tranche 1, 2026-11-11) — décisions prises en cours de route

Relevé réel : 470 appareils, 1 771 pièces distinctes, 13 974 lignes de nomenclature ; 76 appareils sans vue
éclatée, 196 sans photo, 233 sans document ; documents : 244 notices, 108 fiches techniques, 621 procédures,
131 micrologiciels.

- **Une référence de pièce n'a pas toujours un seul prix.** 50 références sur 1 771 désignent plusieurs produits du
  site (kits composés par appareil, visserie vendue à l'unité ou en lot) avec un prix différent selon l'appareil
  (« KIT ATTACHES VITRE » : de 2,25 € à 21,84 €). Le § 5.2 prévoyait une erreur ; à la place : **le prix public est
  gardé sur chaque ligne de nomenclature** (`equipment_model_parts.public_price_ht`), et la pièce du catalogue n'a de
  prix que s'il est le même partout — sinon elle est à 0 € avec `prix_selon_appareil`, donc sans article, et son prix
  se lit sur l'appareil. Coût si c'est le mauvais choix : ces 50 pièces ne se trouvent pas par la recherche
  d'articles du devis ; elles se poseront depuis la nomenclature (tranche 3).
- **Une référence fabricant n'est pas toujours un seul appareil** (P687644 = « FOYER 700 DO INVICTA » et sa version
  EXPORT). L'identité d'un modèle est l'identifiant de l'appareil sur le site (`source_id`), pas la référence ;
  unicité `(org, marque, source_id)`. Le rattachement d'office d'un équipement n'a lieu que si un seul modèle actif
  porte la référence.
- **Les deux modules purs du relevé vivent dans `scripts/catalogue/`** (`invicta-pieces.js`,
  `invicta-pieces-releve.js`), pas dans `src/lib` : ils ne sont importés par aucun écran (convention des modules
  « script-only », audit de code mort). Les règles d'écran sont dans `src/lib/catalogue/piecesDetachees.js`.
- **Les adresses du site (photo, vues éclatées, documents) sont rangées dans `equipment_models.source`** en
  attendant la copie des fichiers (tranche 2) ; `photo_path` et `exploded_views` restent vides et ne sont jamais
  écrasés par un relevé.
- **La fiche fournisseur effaçait `connector_config` à chaque enregistrement** (sauf boutique SuiteCommerce) : le
  réglage `pieces` y est désormais conservé (`connectorConfigAvecPieces`).
- Une pièce désactivée par un relevé garde son article actif (limite connue : la recherche d'articles ne propose
  que les articles ayant une offre active, donc elle disparaît bien du devis).

## 7 quater. Tranche 2 (fichiers) — faits et décisions (2026-11-11)

- **Les fichiers du site sont publics** (images sur `cdn.prod.platform.invicta-group.fr`, documents sur
  `/media/documents/{fileKey}`, servis par CloudFront sans session) : la copie se fait par un script Node, sans
  aucun identifiant. Le § 5.4 laissait le choix ouvert.
- **Un objet Storage par contenu, pas par document** : le site publie la même procédure sous un identifiant
  différent pour chaque appareil (973 documents = 1,4 Go, 299 contenus distincts = environ 600 Mo). L'identité d'un
  contenu est l'ETag du site. Conséquence : un document relevé ne supprime jamais son objet ; l'écran ne propose pas
  de retirer un document relevé (le relevé suivant le remettrait).
- **Rien d'approximatif** : vues éclatées en tout ou rien par appareil ; la liste des documents d'un modèle n'est
  réécrite que si chaque document a été déposé ou est définitivement écarté (lien mort, ou autre format qu'un PDF —
  un `.docx` au relevé).
- **Photo des articles du tarif** : adresse publique du CDN du fabricant (comme les autres relevés de catalogue),
  posée seulement sur un article sans photo — 75 articles ; les autres poêles du tarif n'ont pas de photo sur le
  site de pièces.
- Résultat : 274 modèles avec photo, 394 avec vue éclatée, 243 notices, 108 fiches techniques, 621 procédures.
  Projet Supabase en offre Pro : le volume n'est pas une contrainte.

## 7 quinquies. Tranche 3 (écrans) — ce qui est livré (2026-11-11)

- Le bloc « Pièces détachées » est **replié par défaut** sur la carte équipement de la fiche client (une ligne :
  « Pièces détachées · OXANA · réf. P601314 ») et **ouvert** dans la fiche SAV quand l'appareil a son modèle.
- Sans modèle fabricant : une ligne « Pièces détachées : Choisir le modèle fabricant » (droit `clients.edit`). Le
  sélecteur montre d'abord « D'après ce qui est saisi » (référence exacte, nom, premier mot), puis toute la marque,
  avec une recherche ; si la marque saisie n'a aucun modèle relevé, toutes les marques relevées, en le disant.
- Dans la fiche SAV, l'appareil est celui du SAV s'il est connu, sinon le premier équipement du client qui a un
  modèle ; une liste permet d'en changer. « Ajouter au devis » demande le droit `devis.create` et un client sur la
  carte ; le technicien limité à la clôture voit les pièces mais ne crée pas de devis.
- La colonne de prix montre toujours le **prix public** du fabricant ; la ligne de devis prend le prix de vente du
  catalogue s'il a été ajusté à la main, sinon le prix public.
- Non fait : lien vers la nomenclature depuis la fiche article d'un poêle (§ 4, dernier point) ; bloc « relevé de
  pièces » de la fiche fournisseur (date et compteurs) — la remise y est réglable depuis la tranche 1.

## 8. Laissé au constructeur

Noms exacts des colonnes et des vues, découpage des composants, forme du champ de repère, taille des lots SQL,
nettoyage du nom de modèle (règle testée sur le relevé réel), présentation de la vue éclatée (zoom), choix
navigateur / Node pour les fichiers selon ce que le site autorise, extension de `snapshot.mjs` du harnais.

## 9. Second chantier (non couvert) : caractéristiques et fiche technique pour le devis

Le site de pièces ne porte pas les caractéristiques. Pistes, à instruire avec Eric : (a) les documents `Datasheet` du
site quand ils existent (7 appareils sur 32), rangés aussi sur l'article du catalogue pour partir en annexe du
devis ; (b) lecture automatique de la notice ou de la fiche technique pour remplir `specs.canonical` de l'article,
avec validation case par case (même geste que « Enrichir ») ; (c) le site public ou le tarif Invicta. La tranche 2
ci-dessus prépare (a) en rangeant les fiches techniques sur le modèle.
