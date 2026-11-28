# Aspirateur de sites fournisseurs : agent qui apprend un site, recettes communes, données produit mutualisées

Date : 2026-11-28 · Demandé par Eric · Taille : projet (document complet)
Document lié : `2026-11-28-poele-caracteristiques-cee-design.md` (champs CEE de la fiche poêle, à livrer avant).

## 1. Intention

Une entreprise crée son fournisseur (fiche, adresse du site, accès au compte en ligne — bloc
`AccesCompteFournisseur`, accès rangés au coffre) et peut ensuite **aspirer le site** : le catalogue, les fiches
produit et les fiches techniques PDF entrent dans sa base, avec les caractéristiques qui servent au devis (dont
celles du CEE BAR-TH-112 et la sortie des fumées). Aujourd'hui chaque site demande un développement de notre part
(WooCommerce, SuiteCommerce, relevé Invicta collé dans la console, scripts PDF) : l'entreprise ne peut rien
brancher seule.

Deux décisions d'Eric (2026-11-28) fondent la conception :

1. **Agent de type A** : un agent IA apprend le site UNE fois et en tire une **recette** ; un programme simple
   rejoue ensuite la recette, pour presque rien. L'IA ne lit plus que les pages et PDF récupérés.
2. **La recette appartient à la plateforme, pas à une entreprise** : quand une deuxième entreprise ajoute le même
   fournisseur, la recette est déjà là. **Les données produit lues sans être connecté sont partagées** entre
   entreprises ; ce qui n'est visible qu'avec un compte pro reste à l'entreprise dont c'est le compte ; **les prix
   ne sont jamais partagés.**

Réponses d'Eric à la relecture (2026-11-28) :

3. **Accord du fournisseur : acquis.** L'aspiration fait partie des conditions d'achat ; on part du principe qu'il
   est validé. Même convention que la base de pièces : enregistrer la fiche d'un fournisseur aspiré confirme
   l'accord (`accordAConfirmer`), aucune saisie supplémentaire.
4. **Deville s'achète chez Invicta, mais a sa propre fiche fournisseur « DEVILLE »** (deuxième fiche, mêmes
   conditions d'achat). Les deux fiches pointent le même site pro.
5. **Une recette apprise par une entreprise sert aux autres sans validation préalable**, avec un **suivi côté
   super-administrateur** (table de configuration et de suivi des recettes, § 7.10).
6. **Le site aspiré est celui renseigné sur la fiche fournisseur** (`suppliers.site_url`) : pour Invicta,
   `https://pro.invicta-group.fr/` (espace pro connecté), pas invicta.fr ni le site de pièces détachées.

Les autres entrées du catalogue restent et convergent au même endroit : import de facture ou d'offre PDF depuis la
fiche fournisseur (`supplier-offer-import`), factures Pennylane (Soditelem, Tereva), enrichissement web public
(« Enrichir », `catalog-item-enrich`, à passer en lot plus tard — hors de ce document).

## 2. Ce que voit l'utilisateur

```
Fiche fournisseur « DEVILLE » (achetée chez Invicta)
┌ Site et catalogue ───────────────────────────────────────────────┐
│ pro.invicta-group.fr · marque : Deville · Recette connue          │
│ Prix lus sur le site : net HT                                       │
│ Dernière aspiration : 3 déc. · 58 lus · 3 en échec (voir)          │
│ [ Aspirer le site ]                      Voir les propositions (41)│
└────────────────────────────────────────────────────────────────────┘
```

- **Site jamais exploré** : « Aspirer le site » lance l'apprentissage (quelques minutes, progression affichée),
  puis montre la recette sur 5 produits d'essai : « voici ce que j'ai lu sur ces 5 fiches ». L'administrateur
  confirme (ou signale « ce n'est pas ça ») ; c'est seulement alors que tout le site est aspiré.
- **Site déjà connu** (appris par n'importe quelle entreprise) : l'aspiration part directement.
- **Résultat** : une liste de **propositions** par article (nouvel article, caractéristique, fiche technique,
  photo, prix d'achat), cochées par défaut quand le champ est vide, décochées quand elles remplacent une valeur
  existante ; « Appliquer » écrit. Les données déjà lues par une autre entreprise sur les pages publiques
  arrivent en propositions **sans aspiration** dès qu'un article de même marque + référence existe.
- **Arrêts dits clairement** : captcha ou protection anti-robot (« Le site bloque les robots : aspiration
  impossible »), accès refusés (« Identifiant ou mot de passe refusés par le site »), site trop changé
  (« La recette ne marche plus : réapprentissage proposé »).

## 3. Objectifs

- Un administrateur branche seul un nouveau fournisseur, sans développement de notre part, pour tout site de
  catalogue « classique » (liste de produits → page produit → PDF), connecté ou non.
- Fiche technique officielle jointe à l'article ; caractéristiques du schéma de la catégorie remplies (pour les
  poêles : CEE + sortie des fumées en priorité).
- Une recette par site, commune, versionnée ; un site déjà appris ne coûte plus d'IA d'exploration.
- Données produit publiques mutualisées entre entreprises.
- Premier site visé : **l'espace pro Invicta** (`pro.invicta-group.fr`, connecté), pour les deux fiches
  fournisseur INVICTA et DEVILLE. Une fiche fournisseur peut **restreindre l'aspiration à une ou plusieurs marques**
  du site (réglage de la fiche, `connector_config.aspirateur.marques`) : la fiche DEVILLE n'aspire que Deville, la
  fiche INVICTA que Invicta. Une même recette (par domaine) sert aux deux.
- Conséquence assumée de la règle de provenance : sur un site entièrement derrière connexion, **rien n'alimente les
  fiches communes** (seule la recette est partagée). Les fiches communes se rempliront par les sites publics
  (deville.fr, autorisé par son robots.txt) et par l'enrichissement web public, chantier séparé.

## 4. Non-objectifs

- Pas de commande, pas de panier, aucun POST autre que le formulaire de connexion.
- Pas d'aspiration automatique à l'enregistrement des accès : c'est un geste (« Aspirer le site »).
- Pas de nouveau relevé des pièces détachées Invicta : le relevé existant (console) reste ; il pourra migrer plus
  tard.
- Pas de passage en lot de « Enrichir » ni de reprise des factures Pennylane : chantiers séparés.
- Hermes n'est pas utilisé et sa configuration verrouillée n'est pas touchée (spec assistant pièces § 11).

## 5. Anti-objectifs (ce qui serait un échec même si « ça marche »)

- Un mot de passe vu par le modèle, écrit dans une recette, un journal, une réponse ou un fichier.
- Une entreprise qui lit un prix, un stock ou un document réservé au compte d'une autre.
- Un captcha ou une protection contournés.
- Une valeur écrite dans le catalogue sans être passée par une proposition (sauf les cas du § 7.8).
- Une aspiration qui « réussit » avec 14 % de produits sautés en silence : chaque produit non lu est compté et
  listé avec sa raison.
- Une recette corrigée pour une entreprise qui casse l'aspiration des autres.

## 6. Approches considérées

| | Principe | Pour | Contre |
|---|---|---|---|
| **A — retenue** | Un agent apprend le site une fois et écrit une recette ; un programme la rejoue ; l'IA ne fait que lire le texte récupéré | Générique, peu coûteux à l'usage, reproductible, mot de passe jamais dans le modèle, recette mutualisable | Plus gros chantier ; la recette casse quand le site change (réapprentissage) |
| B | Un agent (Hermes ou autre) aspire tout à chaque passage | Simple à construire | 0,30 à 1 $ par article, heures par fournisseur, résultats variables, mot de passe dans un agent à chaque passage ; Hermes verrouillé exprès ne peut ni se connecter ni écrire |
| C | Un connecteur codé par site | Le plus fiable | Un développement par fournisseur : l'entreprise ne peut pas brancher seule |

## 7. Conception

### 7.1 Les pièces

1. **Service « aspirateur » sur le VPS KVM 2** (`72.60.88.126`, déjà Chromium, Traefik et le modèle « relais à
   forme fixe » d'Hermes). Programme Node + Playwright (Chromium), utilisateur Unix dédié (ni `hermes` ni
   `root`), unité systemd, exposé par Traefik sur un chemin dédié, n'acceptant que l'edge (en-tête
   `X-Aspirateur-Key`, secret `MDH_ASPIRATEUR_KEY`). Un seul travail à la fois par site, file d'attente simple.
   *Choix de Claude : le VPS plutôt que Vercel Sandbox, parce qu'il a déjà le navigateur, le routage et le modèle
   de relais ; aucune nouvelle dépendance de fournisseur.*
   *Choix de Claude : **aucune clé de l'API Claude sur le VPS** (il héberge Hermes, Chromium y tourne sans bac à
   sable). Chaque appel au modèle du service passe par l'edge `fournisseur-aspirer-modele` (`verify_jwt = false`,
   `MDH_ASPIRATEUR_KEY`), qui porte la clé, fixe le modèle, compte le coût et applique le plafond du travail.*
2. **Edge `fournisseur-aspirer`** (`verify_jwt = true`, `requireOrgMembership` + **org_admin**, car elle utilise
   les accès du coffre ; module `crm`) : actions fermées `lancer`, `suivre`, `confirmer_recette`, `rejeter_recette`.
   Elle relit en base le fournisseur, son `site_url` et ses accès (`org_secret_read`, service_role), jamais depuis la
   requête, et parle au service. Réponses `{ data, error: code }`, codes ↔ messages dans un module pur partagé.
3. **Edge `fournisseur-aspirer-retour`** (`verify_jwt = false`, `requireSharedSecret(MDH_ASPIRATEUR_KEY)`) :
   le service y dépose ses résultats (lots de produits lus), qu'elle range par les seules RPC du § 7.6.
   C'est « l'upload » : le VPS n'a aucune clé de la base.
4. **Écran** : bloc « Site et catalogue » de la fiche fournisseur + écran des propositions.

### 7.2 Les accès : jamais vus par le modèle

- L'edge lit les accès au coffre et les transmet au service dans la requête de lancement (HTTPS). Le service les
  garde **en mémoire pour la durée du travail**, ne les écrit nulle part (journaux filtrés : toute chaîne égale à
  l'identifiant ou au mot de passe est remplacée par `***` avant écriture).
- Pendant l'apprentissage, le modèle dispose d'un outil `se_connecter(selecteur_identifiant, selecteur_mot_de_passe,
  selecteur_bouton)` : le programme remplit les champs lui-même et rend seulement `connecte | refuse | inconnu`.
- **Toute recette est refusée à l'enregistrement si elle contient l'identifiant, le mot de passe ou le numéro de
  compte client** de l'entreprise qui l'a apprise (contrôle de chaîne, côté service ET côté RPC).

### 7.3 La recette (commune, versionnée)

Table `majordhome.site_recettes` **sans `org_id`** (référentiel commun, comme `statuses`) :
`id`, `domaine` (hôte normalisé, ex. `www.deville.fr`), `version`, `statut` (`essai` | `active` | `retiree`),
`contenu jsonb`, `schema_version`, `appris_le`, `appris_par_org` (traçabilité, jamais exposé aux autres
entreprises), `essais` (compteurs de réussite / échec), `cree_le`. Une seule `active` par domaine.

`contenu` (validé par un module pur `src/lib/aspirateur/recette.js`, testé, copié pour le service) :

- `connexion` (facultatif) : URL de la page, sélecteurs des deux champs et du bouton, **preuve de connexion**
  (sélecteur ou texte présent seulement une fois connecté).
- `listes` : URL(s) de départ par rayon, règle de pagination (lien « suivant » ou paramètre de page), sélecteur
  des liens produit.
- `produit` : où lire nom, marque, **référence fabricant**, EAN, prix, photo, liens des documents (fiche technique, notice, déclaration de performance, étiquette énergie),
  zone du texte des caractéristiques.
- `politesse` : délai entre pages (≥ 1 s), plafond de pages par passage.

**Nature du prix lu** (public HT, public TTC, net) : réglage de la FICHE FOURNISSEUR de chaque entreprise
(`connector_config.aspirateur.nature_prix`), demandé à la confirmation de la première aspiration et jamais deviné
(cf. l'erreur HT / TTC du tarif Invicta) — un prix net dépend du compte, il n'a pas sa place dans la recette
commune. *Choix de Claude.*

Accès : lecture et écriture par `service_role` seulement ; l'écran d'une entreprise lit seulement « recette
connue / à apprendre » par une RPC qui ne rend ni le contenu, ni la date, ni rien qui révèle qu'une autre
entreprise se fournit chez ce fournisseur. *Choix de Claude.*

### 7.4 Apprentissage (agent)

- Modèle Claude (Sonnet par défaut, configurable) appelé depuis le service, outils :
  `aller(url)`, `lire_page()` (texte visible tronqué + liens), `cliquer(selecteur)`, `se_connecter(...)`,
  `essayer_recette(recette)` (le programme rejoue la recette sur 5 produits et rend ce qu'il a lu),
  `proposer_recette(recette)`.
- **Navigateur borné au site** : interception Playwright de toute requête ; seuls le domaine du fournisseur et
  son domaine enregistrable (ex. `*.invicta-group.fr`, qui couvre le CDN des images et PDF) passent ; le reste est
  bloqué. Une page piégée ne peut donc rien envoyer ailleurs.
- Budget par apprentissage : 60 pages, 15 minutes, plafond de coût (environ 3 $, réglable) ; dépassé ⇒ échec dit.
- Captcha, page de défi, 403 / 429 répétés ⇒ arrêt `site_protege`, jamais de contournement.
- Sortie : une recette en `essai` + les 5 produits lus, présentés à l'administrateur (§ 2). Confirmer ⇒ la recette
  est utilisée pour l'aspiration complète de cette entreprise ; elle devient `active` après une aspiration
  complète réussie (§ 7.7).

### 7.5 Aspiration (programme, sans agent)

- Rejoue la recette : connexion si besoin (preuve vérifiée), listes, pages produit, documents.
- **Provenance mesurée, pas déclarée** : chaque page produit et chaque document est d'abord demandé **sans
  session** ; s'il est servi ainsi, il est `public` (partageable). Sur un site à connexion, la page est **aussi**
  lue avec la session, mais cette lecture ne sert qu'aux données de l'entreprise (prix, stock, documents réservés)
  et **n'alimente jamais les fiches communes** : seule la lecture sans session y va. Une page servie seulement
  avec la session est `compte` en entier. `robots.txt` est respecté pour les demandes sans session ; la politesse
  (≥ 1 s) compte les deux lectures. *Choix de Claude.*
- **Prix d'achat** : une valeur lue sur le site ne remplace jamais un prix venu d'un tarif PDF ou d'une facture
  plus récent (`purchase_price_at`) ; sinon elle devient une proposition. Un article sans aucun prix est créé
  avec un prix de vente « à renseigner » (0), comme les tarifs importés. *Choix de Claude.*
- Lecture des caractéristiques : le texte de la page et le texte du PDF (PDF vérifié `%PDF-`, taille plafonnée)
  sont passés à un petit modèle (Haiku) avec les champs du schéma de la catégorie (y compris les alias) ; sortie
  stricte, relue par une lecture tolérante sur le modèle de `enrichissement.js` ; une valeur hors du type ou de
  l'unité du champ est écartée. Une valeur prise dans le PDF du fabricant prime sur celle de la page.
- Rapport de passage : produits trouvés dans les listes, lus, en échec (avec raison), documents récupérés ; écrit
  même en échec (journal `majordhome.aspirations`, une ligne par passage, par entreprise).
- **Recette cassée** (plus de la moitié des pages produit sans référence, ou connexion impossible avec des accès
  qui marchaient) ⇒ arrêt `recette_obsolete` et proposition de réapprentissage, qui repart de la recette active.

### 7.6 Où vont les données

- **Fiches produit communes** : `majordhome.fiches_produit` (sans `org_id`) — clé marque normalisée + référence
  fabricant (EAN en second), catégorie, `specs` canoniques, photo, documents, URL source, site, date de lecture,
  **uniquement ce qui est de provenance `public`**. Fichiers dans un dossier commun du Storage
  (`fiches-communes/<fiche>/<empreinte>.pdf`, un objet par contenu), écrit par `service_role` seulement.
- **Données propres à l'entreprise** : prix, stock, et tout ce qui est `compte` vont dans
  `majordhome.catalogue_propositions` (avec `org_id`, RLS par organisation) : une ligne par article × proposition
  (nouvel article, champ, document, photo, prix), avec valeur, source, provenance, statut.
- Les propositions de l'entreprise sont aussi construites à partir des fiches communes qui correspondent à ses
  articles (même marque + référence, un seul candidat), sans aspirer.
- Écritures : RPC `service_role` dédiées (`aspiration_*`), seule voie d'écriture de ces tables, jamais le front.

### 7.7 Versions de recette

- Un réapprentissage crée une version `essai` ; elle ne sert qu'à l'entreprise qui l'a déclenchée tant qu'elle n'a
  pas fait une aspiration complète réussie ; elle devient alors `active` et l'ancienne `retiree` (sans validation
  préalable, décision d'Eric ; le super-administrateur est prévenu, § 7.10).
- Une entreprise dont l'aspiration échoue avec la version active peut réapprendre sans gêner les autres.

### 7.10 Suivi super-administrateur

Décision d'Eric : une table de configuration et de suivi côté super-administrateur.

- Une ligne par domaine : version active, versions en essai, date d'apprentissage, nombre d'entreprises qui
  l'utilisent, dernières aspirations (réussies / en échec et raison), coût d'IA cumulé.
- Gestes : retirer une version (l'entreprise retombe sur l'active précédente), bloquer un domaine (aucun
  apprentissage ni aspiration), relancer un apprentissage.
- Une nouvelle version passée `active` ou un domaine dont les aspirations échouent sont signalés.
- *Choix de Claude, à confirmer : l'écran vit dans la console Baikal* (c'est là qu'est le super-administrateur ;
  Majord'home n'a aucun écran super_admin), lu et piloté par des actions ajoutées à l'edge `baikal-admin`
  (`X-Baikal-Key`) ; les tables et RPC sont livrées dans Majord'home.

### 7.8 Appliquer les propositions

- « Appliquer » passe par les écrivains existants, au jeton de l'utilisateur ou par leurs RPC :
  `supplier_catalog_upsert` avec `desactiver_absents = false` (nouveaux articles, prix d'achat — un relevé
  partiel ne désactive jamais rien), fusion des `specs` de l'article (droits par colonne de `catalog_items`),
  `product_documents` (le fichier commun est **copié** sous `product-documents/${org}/articles/…` pour suivre les
  règles d'accès existantes).
- Défaut : proposition cochée si le champ de l'article est vide, décochée si elle remplace une valeur ; jamais
  d'écrasement d'un champ humain (`name`, prix de vente) — même règle que `supplier_catalog_upsert`.

### 7.9 Coûts et quotas

- Apprentissage : quelques dollars par site, une fois pour toute la plateforme.
- Aspiration : lecture par Haiku ≈ 0,004 $ par page ou PDF (mesure de l'import d'offre) ; 60 produits ≈ 0,50 $.
- Quota par entreprise et par jour (apprentissages et aspirations), réglable par secret, compteur comme
  `increment_assistant_quota`.

## 8. Contraintes (rappel des règles du projet)

- RLS et `REVOKE … FROM PUBLIC, anon` sur toute nouvelle table et RPC ; les deux tables communes sont lisibles
  par `service_role` seulement (exception assumée au « tout scopé org », comme les référentiels communs).
- Garde positive dans toute RPC ; les RPC qui reçoivent `org_id` sont `service_role` seulement.
- Modules purs testés (`node --test`) pour : validation de recette, absence des accès dans une recette, règle de
  provenance, lecture tolérante des caractéristiques, construction des propositions, codes ↔ messages.
- Migrations versionnées, répétées sur `scripts/migration-rehearsal/`.
- Déploiement des edges et du service sur le oui d'Eric.

## 9. Tranches

1. **Espace pro Invicta, fiches INVICTA et DEVILLE** : service et edges, recette commune, apprentissage avec
   connexion, aspiration filtrée par marque, nature du prix, propositions, écran de la fiche fournisseur.
   Mesure : articles Invicta et Deville avec fiche technique jointe et Etas / émissions / sortie des fumées lus
   (ou absents dits) ; nombre de produits lus = nombre trouvés dans les listes, ou écart listé.
2. **Site public — deville.fr** : provenance `public`, fiches communes et leurs fichiers.
3. **Versions, réapprentissage, suivi super-administrateur** (§ 7.7, § 7.10).
4. **Mutualisation** : propositions construites depuis les fiches communes pour une deuxième entreprise.

Hors périmètre, décidé : aspiration au geste seulement (pas de passage de nuit) ; une relance périodique viendra
avec un connecteur `aspirateur` et la garde administrateur existante sur `suppliers`. *Choix de Claude.*

## 10. Laissé au constructeur

Forme exacte du JSON de recette et ses limites, découpage du service, nom des RPC, plafonds chiffrés (pages,
minutes, dollars), présentation de l'écran des propositions, normalisation des marques (réutiliser
`equipment_brand_refs` ou la normalisation de `catalog_items` si possible).
