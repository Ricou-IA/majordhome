# Import des clients d'un autre logiciel — fichier type et agent de correspondance

Date : 2026-11-21 · Demande d'Eric, à l'ouverture de Cimaj (2ᵉ entreprise, base clients vide).
Statut : conception à approuver. Rien n'est construit.

## 1. Intention

Une entreprise qui arrive sur Majord'home a déjà ses clients dans un autre logiciel. Aujourd'hui elle
ne peut que les ressaisir un par un (« Nouveau client »). L'import d'origine de Mayer
(`scripts/_import_excel.mjs`) est un script à usage unique, aux règles propres à Mayer, lancé par un
développeur : il ne sert à personne d'autre.

Eric veut deux portes :

1. **un fichier type** à télécharger, remplir et déposer ;
2. **un agent d'import** : depuis n'importe quel export, l'IA retraite l'information pour l'importer.

Pourquoi maintenant : c'est un morceau de l'onboarding d'une nouvelle entreprise, demandé à
l'ouverture de Cimaj (`CLAUDE.md` § « Ouverture à une 2ᵉ entité », reste à faire).

## 2. Buts, hors périmètre, échecs à éviter

**Buts**

- L'administrateur d'une entreprise importe seul sa base clients depuis un Excel ou un CSV, sans
  développeur.
- Un fichier aux colonnes inconnues est compris sans que l'administrateur ait à tout pointer à la main.
- Chaque ligne du fichier est comptée : importée, écartée comme doublon, ou écartée avec sa raison.
- Un import raté se retire en entier.

**Hors périmètre de cette livraison**

- Équipements, contrats, interventions, historique de l'ancien logiciel. L'ancien numéro de client est
  conservé sur la fiche pour pouvoir les rattacher plus tard (tranche suivante, à cadrer sur un vrai
  export).
- Fichiers qui ne sont pas en colonnes : PDF, Word, un client étalé sur plusieurs lignes. À ne
  construire que le jour où un vrai fichier le demande (« voie 3 », § 4).
- Mise à jour ou fusion d'une fiche existante à partir du fichier.
- Envoi des clients importés vers Pennylane (la fiche est créée dans Pennylane au premier devis ou à la
  première facture, comme aujourd'hui pour une fiche qui n'y est pas).
- Étape « Importer vos clients » dans la carte de démarrage (`src/lib/organisation/demarrage.js` ne
  dérive ses étapes que des réglages ; à voir avec l'onboarding).
- Import de leads ou de prospects.

**Ce qui serait un échec même si « ça marche »**

- Un import qui annonce « terminé » avec des lignes sautées sans le dire.
- Une valeur inventée ou modifiée par le modèle (un numéro de téléphone, un nom).
- Des doublons créés en masse dans une base qui a déjà des clients.
- Une fiche créée dans une autre entreprise.
- 3 000 fiches importées de travers et impossibles à retirer.

## 3. Ce qui existe et qu'on réutilise

| Sujet | État actuel | Usage ici |
|---|---|---|
| Création d'une fiche | `clientsService.createClient` : deux écritures depuis le navigateur (`projects` puis `majordhome_clients_all`), nom affiché par `buildClientDisplayName`, noms en majuscules, `cleanPhone` | L'import reprend les mêmes règles, mais écrit par lots côté base (§ 7) |
| Doublons | `src/lib/clientDuplicateMatch.js` (pur, testé) : fort = téléphone ou e-mail ; faible = nom + prénom, ou nom + code postal | Réutilisé tel quel, en mémoire |
| Lecture d'un Excel dans le navigateur | ExcelJS, déjà une dépendance (`SupplierManagement.jsx`) | Lecture du fichier déposé et génération du fichier type |
| Lecture par un modèle puis validation humaine | Edge `supplier-offer-import` : format de sortie strict, relecture tolérante par un module pur, rien n'est écrit sans validation | Même forme pour l'agent (§ 6) |
| Géocodage | Edge `geocode-sweep`, cron 30 min, 100 fiches par passage, file **commune à toutes les entreprises**, triée par date de création (`geocode_fetch_pending_clients`, migration `20260617_2`) | Les fiches importées sont placées sur la carte toutes seules (3 000 fiches ≈ 15 h), mais la file doit devenir équitable entre entreprises (§ 8) |
| Journal d'audit | Trigger sur `clients` | Chaque fiche importée a sa ligne « créée par » |
| Droits | `clients.create` (org_admin, team_leader) | L'import est réservé à org_admin (§ 9) |

Colonnes de `majordhome.clients` utiles : `first_name`, `last_name`, `company_name`, `email`, `phone`,
`phone_secondary`, `address`, `address_complement`, `postal_code`, `city`, `housing_type`, `surface`,
`construction_year`, `access_instructions`, `client_category` (`particulier` | `entreprise` | `public`),
`notes` (visibles par le client), `internal_notes` (internes, affichées sur la fiche), `mail_optin` et
`sms_optin` (NOT NULL, `true` par défaut, réglables sur la fiche), `import_source` (texte, existe
déjà). Il n'existe ni référence à l'ancien logiciel, ni marque d'import.

`clients.org_id` et `projects.org_id` portent l'organisation du schéma `core` : l'import travaille avec
`organization.id`, comme `createClient`.

## 4. Approches envisagées

**Voie 1 — l'agent trouve les colonnes, le code importe (retenue par Eric le 2026-11-21).** Un seul
parcours : déposer → correspondance des colonnes → aperçu et contrôles → import. Le fichier type est
un fichier dont la correspondance est connue d'avance ; pour un fichier inconnu, l'agent lit l'en-tête
et une vingtaine de lignes et préremplit la correspondance, que l'administrateur corrige. Tout le reste
est du code. Vingt lignes seulement partent chez le modèle, aucune valeur ne peut être inventée,
quelques centimes quel que soit le volume. Ne traite pas un fichier qui n'est pas en colonnes.

**Voie 2 — l'agent réécrit chaque fiche.** Le fichier entier passe par le modèle. Avale n'importe quoi
(liste en PDF comprise), mais toute la base clients part chez le modèle, l'import dure des minutes et
doit être découpé, et chaque valeur rendue doit être contrôlée contre l'original sous peine d'un numéro
modifié sans que personne le voie. Écartée.

**Voie 3 — la voie 1, plus la voie 2 pour ce qui ne rentre pas en colonnes.** Reportée : à ne
construire que sur un vrai fichier qui le demande.

## 5. Le parcours

Page `/clients/import`, ouverte par un bouton « Importer » à côté de « Nouveau client » (visible pour
org_admin seulement). Une page et non une fenêtre : les tableaux sont larges.

```
1. Fichier            2. Correspondance              3. Aperçu                    4. Résultat
Déposer un .xlsx      Colonne du fichier → Champ     3 000 lignes lues            2 840 fiches créées
ou un .csv            « Tél. portable » → Téléphone  2 840 prêtes                 112 doublons écartés
                      « Nom complet » → Nom + Prénom 112 doublons (à trancher)    48 lignes écartées
Télécharger le        « Remarques » → Notes           48 écartées (raison)        Télécharger les lignes
fichier type          « Code agence » → Ignorer                                   écartées
```

**Étape 1 — Fichier.** Dépôt d'un `.xlsx` ou d'un `.csv` (10 Mo, 10 000 lignes au plus ; `.xls` refusé
avec le message « enregistrez-le en .xlsx ou .csv »). Bouton « Télécharger le fichier type ». Champ
facultatif « Logiciel d'origine » (texte libre, rangé dans `import_source`).

**Étape 2 — Correspondance.** Un tableau : une ligne par colonne du fichier, avec trois valeurs
d'exemple, le champ Majord'home choisi, et la transformation s'il y en a une. Trois issues par
colonne : un champ, « Ajouter aux notes » (la valeur est ajoutée aux notes de la fiche sous la forme
« Nom de la colonne : valeur »), ou « Ignorer ». Le préremplissage vient, dans l'ordre : du fichier
type (reconnu à ses en-têtes), des synonymes d'en-tête connus (« Tél », « Portable », « CP »,
« Raison sociale »…), puis de l'agent pour ce qui reste (§ 6). La ligne d'en-tête est détectée (les
exports ont souvent un titre au-dessus) et se corrige à l'écran.

**Étape 3 — Aperçu.** Compteurs, puis trois listes : prêtes (échantillon), doublons (chacun avec la
fiche existante en face et une coche « importer quand même »), écartées (avec la raison). Rien n'est
écrit avant le bouton « Importer N clients ».

**Étape 4 — Résultat.** Progression par lots, puis le bilan. Les lignes écartées se téléchargent dans
un fichier (les colonnes d'origine plus une colonne « Raison ») pour être corrigées et réimportées.

Sous le parcours, la liste des **imports précédents** : date, fichier, auteur, nombre de fiches, et
« Retirer cet import » (§ 8).

## 6. Les règles (modules purs)

Dossier `src/lib/importClients/`, sans import React ni Supabase, testé par
`scripts/import-clients-*.test.mjs` (ajoutés à `audit:quality`). Les écrans ne calculent rien.

**`champs.js` — le catalogue des champs, seule définition.** Pour chaque champ : clé, libellé, colonne
de la base, synonymes d'en-tête, exemple. Il sert au fichier type, aux synonymes, à l'écran de
correspondance et à la consigne de l'agent. Champs : type de client (particulier / entreprise /
public), nom, prénom, société, e-mail, téléphone, téléphone 2, adresse, complément d'adresse, code
postal, ville, type de logement, surface, année de construction, consignes d'accès, notes (visibles
par le client), notes internes, accepte les e-mails, accepte les SMS, ancien numéro de client.

- **Type de client absent** : société renseignée ⇒ `entreprise` (sinon la fiche s'affiche sous le nom
  du contact et ne se retrouve pas par la raison sociale, règle de `buildClientDisplayName`) ; sinon
  `particulier`.
- **Accord e-mails / SMS** (décidé par Eric le 2026-11-21 : « oui, d'office ») : colonne absente ou
  cellule vide ⇒ `true`, comme une fiche créée à la main ; « non », « 0 », « faux », « refus » ⇒
  `false`. Les clients importés entrent donc dans la première campagne envoyée à la base clients, sauf
  ceux que le fichier marque « non ».

**Transformations, liste fermée** (une colonne peut en porter une) :

| Clé | Effet |
|---|---|
| `nom_prenom` | « DUPONT Jean » → nom + prénom (le nom est la partie en majuscules, sinon le premier mot) |
| `prenom_nom` | « Jean Dupont » → prénom + nom |
| `cp_ville` | « 81600 Gaillac » → code postal + ville |
| `adresse_complete` | « 12 rue des Lilas 81600 Gaillac » → adresse + code postal + ville |

Toute autre mise en forme est faite d'office, sans réglage : téléphone (un numéro lu comme un nombre
par Excel, « 612345678 », retrouve son 0 ; `cleanPhone` ensuite), code postal (4 chiffres → 0 devant),
e-mail (minuscules, espaces retirés), noms en majuscules comme `createClient`, type de client et type
de logement ramenés aux valeurs admises.

**`lireFichier.js`** — de la feuille ou du CSV vers `{ entetes, lignes }`. CSV : séparateur détecté
(`;`, `,`, tabulation), guillemets, UTF-8 avec ou sans BOM, repli Windows-1252 quand le décodage UTF-8
échoue (les exports français). Excel : première feuille non vide, valeur des formules, dates en ISO.
Ligne d'en-tête = parmi les dix premières, celle qui a le plus de cellules de texte.

**`correspondance.js`** — `proposerCorrespondance(entetes)` (fichier type, puis synonymes),
`appliquerCorrespondance(ligne, correspondance)` → fiche candidate, `lireReponseAgent(json, entetes)`
(lecture tolérante : un champ ou une transformation hors des listes fermées devient « à choisir »,
une colonne que le modèle invente est jetée).

**`controles.js`** — `controlerFiche(fiche)` et `classerLignes(fiches, clientsExistants)` :

- **Écartée** (non importable) : ni nom ni société.
- **Corrigée et signalée** (importée) : e-mail invalide → champ laissé vide ; type de logement
  inconnu → vide ; surface ou année illisible → vide. La valeur d'origine n'est jamais perdue : elle
  est ajoutée aux **notes internes**, comme les colonnes « Ajouter aux notes » (jamais aux notes
  visibles par le client).
- **Doublon dans le fichier** : même ancien numéro, ou même nom + prénom et même téléphone, e-mail ou
  code postal qu'une ligne précédente → écartée, la première est gardée.
- **Doublon avec la base** (par `matchClientDuplicates`, sur tous les clients non archivés de
  l'entreprise lus en entier par `fetchAllPages`, complété ici par l'ancien numéro) :
  **fort** → écarté par défaut, coche pour l'importer quand même ; **faible** → importé par défaut,
  signalé, coche pour l'écarter.
  - Fort : même téléphone, même e-mail, même ancien numéro (`external_ref`), ou même nom + prénom
    dans le même code postal. Ce dernier cas est ce qui empêche un fichier déposé deux fois de
    recréer toutes les fiches sans téléphone ni e-mail.
  - Faible : même nom + prénom ailleurs, ou même nom dans le même code postal (une famille).
- **Invariant, testé et affiché** : lignes lues = importées + doublons écartés + écartées. Liste des
  clients existants inconnue (chargement, échec) ⇒ import fermé, jamais « aucun doublon » supposé.

**`fichierType.js`** — génère le `.xlsx` à la demande depuis `champs.js` : une feuille « Clients »
avec la seule ligne d'en-tête, une feuille « Mode d'emploi » (un champ par ligne : à quoi il sert,
exemple, valeurs admises). Aucune ligne d'exemple dans la feuille à remplir (elle serait importée).

## 7. L'agent de correspondance

Edge `clients-import-mapping` (`verify_jwt = true`, `requireOrgMembership` org_admin). Elle n'écrit
rien.

- **Reçoit** : les en-têtes (60 colonnes au plus) et vingt lignes d'échantillon (cellules coupées à
  200 caractères). Jamais le fichier.
- **Appelle** Claude (`claude-haiku-5-5` par défaut, variable `ANTHROPIC_IMPORT_MODEL`, effort bas,
  format de sortie strict). Schéma sans « valeur ou null » (l'API en refuse plus de seize, vécu sur
  `supplier-offer-import`) : absent = chaîne vide.
- **Rend** : pour chaque colonne, `{ colonne, champ, transformation }` pris dans les listes fermées de
  `champs.js` (copié pour Deno par `npm run sync:tournee-engine`), plus une remarque libre affichée
  telle quelle (« la colonne Contact semble mêler nom et téléphone »).
- **Limites** : 30 analyses par entreprise et par jour (variable d'environnement), délai 60 s. Les
  compteurs journaliers existants (voix, pièces, enrichissement) sont par utilisateur : celui-ci demande
  sa table et sa RPC d'incrément (service_role), sur le modèle d'`increment_assistant_quota`.

Elle est appelée d'office à l'arrivée à l'étape 2 quand il reste des colonnes non reconnues ; l'écran
écrit « Vingt lignes de votre fichier sont lues par l'assistant pour reconnaître les colonnes. » Une
panne, un refus de quota ou une réponse illisible ne bloque jamais : la correspondance reste à faire
à la main, et l'écran le dit. Le modèle ne produit que des noms de champs : il ne voit pas, ne
réécrit pas et ne peut pas altérer les données importées.

## 8. Écriture, reprise et retrait

**Migration** (versionnée, répétée sur le harnais avec son `assert-clients-import.sql`) :

- `majordhome.client_imports` : `id`, `org_id`, `created_by`, `created_at`, `file_name`,
  `source_label`, `mapping jsonb`, `counts jsonb`, `status` (`en_cours` | `termine` | `retire`),
  `removed_at`, `removed_by`. RLS : lecture org_admin de l'entreprise, aucune policy d'écriture
  (écrite par les RPC). Vue `public.majordhome_client_imports` (`security_invoker`, `REVOKE` anon et
  PUBLIC, `GRANT SELECT` à `service_role`).
- `majordhome.clients` : `import_id uuid` (FK), `import_line integer`, `external_ref text` (ancien
  numéro de client). Index unique partiel `(import_id, import_line)`. `external_ref` exposée en fin de
  liste des vues clients (affichée sur la fiche, cherchable) ; les deux autres restent internes.

**RPC** (SECURITY DEFINER, `SET search_path`, `REVOKE … FROM PUBLIC, anon`, garde positive
`IS NOT TRUE` : l'appelant est org_admin actif de l'entreprise de l'import) :

- `clients_import_start(p_org_id, p_file_name, p_source_label, p_mapping, p_counts)` → id de l'import.
- `clients_import_batch(p_import_id, p_rows jsonb)` : pour chaque ligne, crée le projet
  (`core.projects`, même forme que `createClient`) puis la fiche, dans l'entreprise **de l'import**
  (jamais reçue dans les lignes). Un lot est tout ou rien. Une ligne déjà écrite
  (`import_id`, `import_line`) est passée : un lot renvoyé après une coupure ne crée pas de doublon.
  `client_number` laissé à la séquence. Rend le nombre de fiches créées.
- `clients_import_finish(p_import_id, p_counts)`.
- `clients_import_remove(p_import_id)` : supprime les fiches de l'import **auxquelles rien n'est
  rattaché** et leurs projets ; garde les autres et rend les deux compteurs. L'écran l'annonce avant
  (« 2 828 fiches seront retirées, 12 conservées : elles ont déjà un contrat ou une intervention ») et
  le confirme après.
  - « Rien n'est rattaché » se lit sur les clés étrangères réelles : 30 tables pointent vers `clients`
    en production (équipements et interventions par le projet, contrats, leads, rendez-vous, devis,
    chantiers, mais aussi `invoices`, `pellets_orders`, `webshop_orders`, `pv_simulations`,
    `pv_dossiers`, `thermal_studies`, `voice_memos`, `sms_logs`, `campaign_inscriptions`,
    `agent_verifications`…). La liste se dérive du catalogue (`pg_constraint`) au moment d'écrire la
    migration, et l'assertion du harnais échoue si une clé étrangère vers `clients` n'est pas couverte.
  - Ne compte pas comme rattachement, et part avec la fiche : `client_dpe` (posé tout seul à
    l'ouverture de la fiche). À l'inverse, `mailing_logs` part en cascade avec la fiche en base, mais
    une fiche qui a reçu un e-mail doit garder sa trace d'envoi : elle est **conservée** dès que
    `mailing_logs` en porte une ligne.
  - `client_hard_delete` n'est définie dans aucune migration du dépôt (elle n'existe qu'en
    production) : la lire par `pg_get_functiondef` avant d'écrire le retrait.

**File de géocodage équitable.** `geocode_fetch_pending_clients` sert aujourd'hui les fiches par date
de création, toutes entreprises confondues : un import de 3 000 fiches ferait attendre une quinzaine
d'heures toute fiche créée ensuite chez une autre entreprise. La même migration la fait alterner entre
entreprises (chaque passage partage ses 100 fiches entre les organisations qui en attendent, les plus
anciennes d'abord dans chacune).

**Taille des lots** : l'écriture passe par PostgREST, 8 s au plus par appel (`CLAUDE.md`, Module Base
de pièces). 200 lignes par lot au départ, à **mesurer** avant livraison (bloc `DO` qui appelle la RPC
puis `RAISE EXCEPTION` avec la durée), triggers de `clients` compris (journal d'audit).

**Côté écran** : lots envoyés l'un après l'autre, `{ error }` lu à chaque lot. Un lot refusé arrête
l'import, dit combien de fiches sont créées et propose « Reprendre » (qui renvoie les lots restants).
Un import interrompu (onglet fermé) reste `en_cours` dans la liste, avec ses fiches déjà créées et le
bouton « Retirer cet import ».

## 9. Droits et étanchéité

- Import, liste des imports, retrait, agent : **org_admin** de l'entreprise, tenu à l'écran et en base
  (RPC, RLS, edge). C'est un geste de reprise en masse, pas un geste quotidien.
- L'entreprise d'une fiche importée est celle de l'import, dérivée en base ; aucune ligne ne porte
  d'`org_id`.
- Clé de cache `clientImportKeys.all(orgId)` dans `cacheKeys.js` ; invalidation de `clientKeys.all`
  après un import ou un retrait. Aucun brouillon en `localStorage` (un fichier rechargé se relit).
- Module : socle (CRM). Route déclarée dans `routes.jsx` ; une route absente de `ROUTES_PAR_MODULE`
  tombe sur `crm` (`src/lib/modules.js`), rien à y ajouter.

## 10. Livraison en deux tranches

1. **Fichier type et parcours complet** : catalogue des champs, lecture du fichier, correspondance par
   fichier type et synonymes puis à la main, contrôles, aperçu, écriture par lots, bilan, lignes
   écartées à télécharger, imports précédents et retrait. Utilisable seule.
2. **Agent** : edge `clients-import-mapping` et préremplissage de l'étape 2. Déploiement de l'edge et
   pose de la limite sur le oui d'Eric.

## 11. Critères de réussite

- Le fichier type rempli de N lignes produit N fiches comptées (créées, doublons, écartées), et
  l'invariant du § 6 tient sur chaque jeu d'essai.
- Un export aux en-têtes d'un autre logiciel (jeu d'essai à fabriquer tant qu'aucun vrai fichier
  n'existe ; à rejouer sur le premier vrai export) arrive à l'aperçu sans pointer plus de quelques
  colonnes à la main.
- 3 000 lignes s'importent sans dépasser le délai d'un appel, et un lot renvoyé ne crée aucun doublon.
- Un membre non administrateur, ou l'administrateur d'une autre entreprise, est refusé par chaque RPC
  (éprouvé en se mettant à sa place, `set_config('request.jwt.claims', …)`).
- « Retirer cet import » sur une base d'essai ramène le nombre de fiches à celui d'avant.
- `npm run audit:quality` et `npx vite build` passent.

## 12. Laissé au constructeur

- Découpage des composants sous `src/apps/artisan/components/clients/import/` (aucun au-dessus de
  500 lignes ; état du parcours par `useReducer`). `Clients.jsx` (702 lignes, dette connue) ne reçoit
  que le bouton.
- Liste exacte des synonymes d'en-tête, à étoffer au fil des vrais fichiers.
- Forme des vues clients à recréer pour exposer `external_ref` (colonne ajoutée en fin de liste ;
  vérifier `majordhome_clients` et `majordhome_clients_all`, et leurs droits après `CREATE OR REPLACE`).
- Sort des lignes du journal d'audit des fiches retirées (à aligner sur `client_hard_delete`).
- Extension de `snapshot.mjs` du harnais (tables, vues, fonctions touchées).

## 13. Choix faits sans Eric, à confirmer à la relecture

- Doublon fort (écarté par défaut) : téléphone, e-mail, ancien numéro, ou même nom + prénom dans le
  même code postal. Doublon faible (importé par défaut, signalé) : homonyme ailleurs, même nom dans le
  même code postal.
- Société renseignée sans type de client ⇒ fiche « entreprise ».
- Colonne sans champ : « Ajouter aux notes » proposé à côté d'« Ignorer » ; ces valeurs vont dans les
  notes internes, jamais dans les notes visibles par le client.
- Une valeur illisible (e-mail, surface) vide le champ mais reste dans les notes internes ; la ligne
  est importée.
- La file de géocodage devient équitable entre entreprises (sinon l'import d'une entreprise retarde
  les fiches des autres).
- Une fiche importée qui a déjà reçu un e-mail de campagne n'est pas retirée avec son import.
- L'agent est appelé d'office, sans clic, avec la mention des vingt lignes lues.
- Retrait d'un import sans limite de temps, tant que rien n'est rattaché aux fiches.
- Limites : 10 000 lignes, 10 Mo, 30 analyses par jour et par entreprise.
- `.xls` (ancien format Excel) refusé.
