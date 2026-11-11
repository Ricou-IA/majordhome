# Référentiel des appareils installés — saisie terrain pas à pas, enrichissement web, file de contrôle

> Conception du 2026-11-11, issue de la conversation avec Eric (contrôle à l'écran des pièces détachées Invicta).
> Ce qui vient d'Eric est marqué **(Eric)** ; mes choix sont marqués **(mon choix)** et restent à confirmer.

## 1. Intention

Aujourd'hui un équipement client se saisit en texte libre (marque, modèle). Résultat mesuré le 2026-11-11 sur les
1 015 équipements de Mayer : 550 portent la marque « À RENSEIGNER », les 834 marques saisies représentent 87 marques
réelles écrites de 119 façons (JOLLY MEC / JOLLYMEC…), 30 seulement sont rattachés à un modèle fabricant et 18 à un
article. Sans rattachement, l'équipement n'a ni vue éclatée, ni pièces détachées, ni notice, ni caractéristiques : le
technicien et le devis SAV repartent de zéro à chaque intervention.

But **(Eric)** : quand l'intervenant saisit un appareil, l'outil nettoie la saisie, cherche d'abord dans notre base pour
proposer un rattachement, et sinon lance une recherche web qui enrichit la base avec cette référence. L'intervenant
valide sur place ; sa validation ouvre un élément à contrôler dans le tableau de bord de l'administrateur, qui peut
**valider, corriger ou fusionner avec une fiche existante (Eric)**.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Une saisie d'équipement pas à pas, utilisable sur tablette, qui aboutit le plus souvent à un équipement rattaché à
  une fiche du référentiel.
- Un référentiel des appareils installés qui grossit avec l'usage : chaque appareil trouvé sur le web y entre une fois
  et sert ensuite à tous les clients qui ont le même.
- Une file de contrôle pour l'administrateur, avec trois gestes : valider, corriger, fusionner.

**Non-objectifs**
- La reprise des 1 015 équipements existants : elle se fait **en séance avec Eric (Eric)**, à part, avant ce chantier
  (§ 8). L'outil sert aux saisies suivantes.
- Faire du référentiel un catalogue de vente : **un appareil installé n'est pas un article, il peut ne plus être vendu
  (Eric)**.
- Le relevé des pièces détachées d'autres marques (chantier distinct).

**Anti-objectifs (ce qui serait un échec même si « ça marche »)**
- Un rattachement fait d'office : l'outil propose, un humain clique. Même règle que le choix du modèle fabricant.
- Une saisie bloquée : sans réseau, sans résultat ou avec une recherche web en échec, l'équipement s'enregistre tel
  que saisi.
- Une recherche web lancée sans clic (elle coûte de l'ordre de 0,30 $).
- Une fiche relevée chez le fabricant (Invicta) écrasée par une saisie terrain.
- Une fiche visible d'une autre organisation.
- Un échec silencieux : recherche impossible, téléchargement refusé, écriture refusée se disent à l'écran.

## 3. Le référentiel des appareils installés

**Deux bases distinctes (Eric)** : le catalogue sert à vendre (articles, prix, fournisseurs, devis) ; le référentiel
décrit ce qui est installé chez les clients. **Une clé de rattachement facultative (Eric)** relie une fiche du
référentiel à un article du catalogue quand il en existe un.

**Pas de troisième table (mon choix)** : `majordhome.equipment_models`, qui porte aujourd'hui les 470 appareils relevés
sur le site de pièces Invicta, devient ce référentiel. Colonnes ajoutées :

| Colonne | Rôle |
|---|---|
| `origin` | `releve_fabricant` (les 470 actuels) · `web` (§ 4 étape 4) · `catalogue` (créée depuis un article, § 4 étape 3). Pas d'autre origine : une saisie non identifiée ne crée pas de fiche (§ 4 étape 5). |
| `review_status` | `controle` · `a_controler`. Les fiches relevées chez le fabricant sont `controle`. |
| `catalog_item_id` | clé facultative vers `catalog_items` de la même organisation (FK composite ou trigger, comme `equipments_check_model_org`) |
| `equipment_type_id` | type d'équipement de l'org (`pricing_equipment_types`), facultatif. **(mon choix)** C'est le vocabulaire de la fiche : celui du formulaire d'équipement. `category` (texte libre du site fabricant) reste tel quel pour les fiches relevées. Les clés de `specs` suivent le schéma de caractéristiques de la catégorie de ce type. |
| `specs` | caractéristiques (jsonb, mêmes clés que `catalog_items.specs.canonical` pour la catégorie) |
| `source_urls` | pages où la recherche web a lu les données (jsonb), montrées à l'administrateur |
| `created_by`, `reviewed_by`, `reviewed_at` | qui a créé, qui a contrôlé |
| `merged_into` | fiche absorbée par une fusion (jamais supprimée, comme `catalog_items`) |

Contraintes existantes à respecter : `source_id` est NOT NULL et unique par `(org_id, brand_key, source_id)` → une fiche
web ou terrain reçoit un `source_id` synthétique (`terrain:<uuid>`), jamais un identifiant du site fabricant. Le relevé
fabricant (`equipment_models_upsert`) ne touche que ses propres `source_id` : il ne peut donc pas écraser une fiche
web. **À corriger dans ce chantier** : `equipment_models_close` (migration `20261111_1`) désactive TOUTES les fiches
actives de la marque absentes de la version relevée, et rattache d'office les équipements dont le modèle saisi est une
référence exacte. Sans correction, la prochaine relève Invicta désactiverait toutes les fiches web Invicta. Les deux
traitements se limitent à `origin = 'releve_fabricant'`. Lecture : la policy `equipment_models_select` (membres de l'org) reste. **Aucune écriture directe du front**
(pas d'INSERT/UPDATE pour `authenticated` aujourd'hui) : tout passe par les RPC et l'edge du § 5-6.

Documents d'une fiche web (photo, notice, fiche technique) : mêmes tables que les documents relevés
(`equipment_documents` avec `equipment_model_id` + `source`, photo dans `photo_path`), fichiers dans
`product-documents/${org}/equipment-models/web/…` (le dossier `site/` reste réservé au relevé fabricant, policies
restrictives existantes).

**Marques (mon choix)** : nouvelle table par organisation `majordhome.equipment_brand_refs (org_id, name, brand_key)`,
une ligne par marque, avec l'écriture de référence (« JOLLY MEC »). Elle est alimentée par la reprise des 1 015 (§ 8),
puis par chaque fiche créée et par les marques du catalogue. Comparaison sur `brand_key` : minuscules, sans accents ni
ponctuation ni espaces, ce qui règle JOLLYMEC / JOLLY MEC. Lecture par les membres, écriture par RPC. La table
`majordhome.equipment_brands` existante n'a **pas d'`org_id`** (table globale, multi-tenant fautif) : elle n'est pas
utilisée par ce chantier et son sort est à signaler à part. Sans la reprise, l'étape 1 ne propose d'écriture que pour
les marques déjà présentes au référentiel ou au catalogue ; les étapes 2 et 3 n'en dépendent pas.

**Rattachement d'un équipement à une fiche (mon choix)** : c'est le nettoyage demandé par Eric. La marque et le modèle
de l'équipement sont réécrits avec ceux de la fiche (`brand` = marque de référence, `model` = nom du modèle de la
fiche). La saisie d'origine est gardée dans `equipments.metadata.saisie_origine`. `supplier_product_id` reçoit la ligne
d'origine de l'article (`catalog_items.source_product_id`) quand la fiche porte un article, sinon il reste tel quel.

## 4. Parcours de l'intervenant (fenêtre « Ajouter un équipement »)

Fenêtre existante `EquipmentFormModal` (fiche client), en mode ajout, et en modification d'un équipement non rattaché.
Pas à pas, sans perdre la saisie entre les étapes :

1. **Type, marque, modèle** saisis comme aujourd'hui. À la frappe, la marque propose son écriture de référence
   (« jollymec » → « JOLLY MEC ») ; l'intervenant l'accepte d'un clic, ou garde sa saisie.
2. **« Vérifier »** : recherche dans la base locale, sans réseau extérieur ni coût. Résultats en deux groupes :
   - **Appareils connus** (référentiel, fiches contrôlées et à contrôler, fiches fusionnées exclues), filtrés sur la
     marque et classés comme `classerModeles` le fait déjà, les fiches du même type d'équipement en tête (référence exacte, nom identique, contenance, premier mot), avec photo, référence,
     « en vente » / « arrêté » ;
   - **Articles du catalogue** de la même marque (nom, référence, photo).
   Rien n'est présélectionné, même un résultat unique.
3. **Choix** :
   - un appareil connu → l'équipement est rattaché (`equipment_model_id`, et `supplier_product_id` si la fiche porte un
     article) ;
   - un article sans fiche au référentiel → une fiche est créée depuis l'article (`origin = catalogue`, clé vers
     l'article). **(mon choix)** Elle naît `controle` : ses données viennent de notre catalogue, pas du web. Droit
     requis : `clients.edit`, comme la saisie de l'équipement (l'article n'est pas modifié).
4. **« Rien ne correspond — chercher sur le web »** (clic explicite) : la recherche renvoie une fiche proposée (marque,
   nom exact, référence fabricant, catégorie, caractéristiques, photo, notice, pages sources), ou plusieurs candidats
   si l'appareil est ambigu (tailles, coloris). L'intervenant choisit « C'est cet appareil » → la fiche entre au
   référentiel `a_controler` et apparaît dans la file de contrôle ; l'équipement s'y rattache à l'enregistrement du
   formulaire (en ajout, il n'existe pas encore). Saisie abandonnée : la fiche reste dans la file, « installée chez :
   aucun client », à valider ou fusionner.
   Il peut corriger le nom ou la référence avant de valider.
5. **« Aucun de ceux-là »** ou recherche en échec → l'équipement s'enregistre tel que saisi, sans rattachement.
   **(mon choix)** Pas de fiche créée, pas d'élément dans la file : on ne remplit pas le référentiel de saisies non
   identifiées. Ces équipements restent visibles dans le compteur « non rattachés » de la reprise.

Chaque étape dit ce qui se passe (« Recherche dans la base… », « Recherche web : 20 à 60 secondes »). La fenêtre ne se
ferme pas pendant une recherche web ; fermer l'annule côté écran (l'edge peut finir, rien n'est écrit sans le clic de
l'étape 4).

## 5. Recherche web

Nouvelle edge `equipment-model-enrich` **(mon choix : séparée de `catalog-item-enrich`, qui écrit dans un article)**,
qui réutilise le module pur `src/lib/catalogue/enrichissement.js` (URL publiques seulement, DNS vérifié, PDF vérifié,
téléchargement plafonné) et le même modèle d'IA (`ANTHROPIC_ENRICH_MODEL`).

- `verify_jwt:true`, `requireOrgMembership`, puis `user_can(org, 'clients', 'edit')` (le droit de saisir un
  équipement ; le technicien l'a).
- Action `chercher` : renvoie une ou plusieurs fiches proposées ; **rien n'est écrit**.
- Action `creer` : reçoit la fiche telle que validée (corrections de l'intervenant comprises) et l'id de l'équipement ;
  télécharge photo et notice (vérifiées), crée la fiche (`origin = web`, `review_status = a_controler`, `created_by` =
  l'utilisateur du jeton), les documents, et rattache l'équipement — en une seule RPC SECURITY DEFINER **service_role
  only** (elle prend `org_id` dans son payload, charte multi-tenant), tout ou rien. Une écriture refusée renvoie une
  erreur explicite ; un fichier refusé n'empêche pas la fiche et se dit (« fiche créée sans notice »).
- Plafond par utilisateur et par jour **(mon choix : 20, comme `voice_quotas`)** pour borner le coût.
- Dédoublonnage avant création : si une fiche active de la même org porte déjà la même marque et la même référence
  fabricant (`reference_key`), `creer` rattache à celle-ci au lieu d'en créer une seconde, et le dit.

## 6. File de contrôle de l'administrateur

**Dans le tableau de bord (Eric)** (`Dashboard.jsx`, visible `org_admin`) : une carte « Appareils à contrôler (N) »,
qui ouvre la liste. Pour chaque fiche : photo, marque, nom, référence, catégorie, caractéristiques, documents, pages
sources, qui l'a créée, quand, et chez quels clients elle est installée.

Trois gestes **(Eric)** :
- **Valider** → `review_status = controle`, `reviewed_by/at` posés.
- **Corriger** → mêmes champs éditables (marque, nom, référence, catégorie, caractéristiques, clé vers un article,
  retrait de la photo ou d'un document) puis validation.
- **Fusionner avec une fiche existante** → recherche d'une fiche du référentiel ; les équipements rattachés à la fiche
  absorbée passent sur la fiche gardée, ses documents aussi s'ils ne sont pas déjà présents, la fiche absorbée reçoit
  `merged_into` et sort des recherches. On ne fusionne jamais une fiche relevée chez le fabricant DANS une fiche web
  (la fiche fabricant est toujours la survivante).

RPC SECURITY DEFINER `org_admin` (garde positive `IS NOT TRUE`, `REVOKE … FROM PUBLIC, anon`), `SET search_path`
explicite, filtre `org_id` partout.

## 7. Contraintes

Charte multi-tenant du `CLAUDE.md` entière : RLS et org_id partout, aucune écriture front directe dans `majordhome.*`,
REVOKE PUBLIC/anon, vue publique `security_invoker` si une vue est ajoutée (avec `REVOKE ALL … FROM PUBLIC, anon` et le
`GRANT SELECT` à service_role sur les tables lues), migrations versionnées répétées sur `scripts/migration-rehearsal/`.
Règles pures (nettoyage de saisie, classement, dédoublonnage, mise en forme d'une fiche proposée) dans un module pur
testé, copié pour Deno par `sync:tournee-engine` si l'edge s'en sert. Mutations des hooks via `unwrapResult`. Composants
sous 500 lignes : `EquipmentFormModal` (454) reçoit les étapes comme sous-composants.

## 8. Ordre de réalisation

1. **Reprise des 1 015 équipements, en séance avec Eric (Eric)** : marques ramenées à leur écriture de référence,
   modèles rattachés au référentiel quand c'est sûr, cas douteux tranchés par Eric. Elle produit la liste des marques de
   référence dont l'outil se sert. Faite en premier **(mon choix, proposé à Eric)**.
2. Base : colonnes, table des marques, RPC de création / contrôle / fusion, `equipment_models_close` limitée au relevé
   fabricant, répétition sur le harnais.
3. Étapes 1 à 3 du parcours (base locale seulement) — utiles sans aucun coût web.
4. Recherche web (edge + étape 4).
5. File de contrôle dans le tableau de bord.

## 9. Laissé au constructeur

Présentation exacte des étapes (accordéon, panneaux successifs), libellés, prompt de recherche et schéma de réponse de
l'IA, nommage des RPC et du module pur, découpage des commits, forme des tests.
