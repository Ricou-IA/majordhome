# Identité de l'entreprise : une seule saisie pour Majord'home et HésiaSun

> Conception — 2026-11-21. Décisions d'Eric ce jour : l'écran Organisation doit être le même dans les deux
> produits et maintenu à un seul endroit ; un installateur qui a les deux produits saisit son identité **une
> seule fois** ; **Majord'home est la source**, poussée vers HésiaSun.

## 1. Pourquoi

Majord'home (`C:\Dev\Frontend-Majordhome`, React / Vite / JavaScript, projet Supabase `ejqqqwudmizqisdkxohw`)
et HésiaSun (`C:\Dev\Solaire`, Next.js / TypeScript, projet Supabase `zfvynpockpqxaiaqddhp`) ont chacun un
écran « Organisation » où l'entreprise saisit son nom, ses mentions légales, ses coordonnées et son
signataire. Ces valeurs s'impriment sur les devis, certificats, mandats et dossiers. Un installateur qui a les
deux produits les saisit deux fois, et rien ne garantit qu'elles restent identiques.

Le chantier sert aussi l'onboarding : une entreprise déjà cliente de HésiaSun qui ouvre Majord'home (ou
l'inverse) ne doit pas repartir d'une fiche vide.

## 2. État des lieux (lu dans les deux dépôts le 2026-11-21)

- **Mêmes clés de réglages.** HésiaSun range l'identité dans `organizations.settings` (jsonb) « avec exactement
  les clés de Majordhome » (`apps/web/src/lib/organization/settings.ts`) ; Majord'home dans
  `core.organizations.settings`.
- **Une seule colonne miroir chez HésiaSun** : `organizations.name`. Les colonnes `siret`, `address_line`,
  `postal_code`, `city`, `phone`, `email`, `website`, `logo_path` ont été supprimées par sa migration
  `20261024_0021_drop_org_columns` : tout est dans `settings`. Restent `siret_verifie` / `siret_verifie_le`
  (SIRET retrouvé dans l'annuaire des entreprises).
- **Formes enregistrées différentes** : Majord'home enregistre SIRET, TVA et téléphone avec leurs espaces
  (« 100 288 224 00015 », « FR 06 449776916 ») et les imprime tels quels ; HésiaSun enregistre 14 chiffres et
  « FR… » sans espace.
- **HésiaSun ne laisse pas saisir** la raison sociale, le SIRET ni la forme juridique (ils viennent de
  l'annuaire) et recalcule toujours la TVA depuis le SIREN (`tvaDepuisSiret`, `form-helpers.ts`). Majord'home
  laisse tout saisir librement.
- **Règles en double** : `formatSiret`, `formatTva`, `validate` dans `IdentityTab.jsx` et `ContactTab.jsx` côté
  Majord'home ; `normalizeSiret`, `normalizeTvaIntra` et un schéma zod côté HésiaSun.
- **API HésiaSun** : `/api/v1`, clé par organisation (`api_keys`, portées `projects:read`, `projects:write`,
  `docs:read`), garde `withApiHandler`. Aucune entrée sur l'organisation.
- **Coffre Majord'home** : `org_secret_set` / `org_secret_delete` (org_admin), `org_secret_status` (membre, sans
  la valeur), `org_secret_read` (service_role). Nom `org:<org_id>:<clé>`.
- **Aucun lien** entre une organisation de Majord'home et une organisation de HésiaSun.

## 3. Buts, non-buts, ce qui serait un échec

**Buts**
1. Une entreprise reliée modifie son identité dans Majord'home ; HésiaSun la reçoit sans geste.
2. Les contrôles et formats de l'identité n'ont qu'une définition.
3. Au moment de relier, l'identité déjà saisie d'un côté n'est pas à retaper de l'autre.
4. Une entreprise qui n'a qu'un des deux produits ne voit aucun changement.

**Non-buts (cette conception)**
- Un écran partagé (même composant dans les deux dépôts) : écarté, voir § 4.
- Synchroniser l'équipe, les documents d'entreprise (certifications, attestations), le territoire, l'expéditeur
  des e-mails.
- Logo et image de signature : lot 4, après les textes.
- Fusionner les comptes ou les abonnements des deux produits.

**Ce qui serait un échec, même si « ça marche »**
- Une identité qui diverge en silence (envoi refusé sans que personne le voie).
- Une entreprise HésiaSun bloquée en lecture seule sans moyen de reprendre la main.
- L'identité d'une entreprise écrite dans l'organisation d'une autre.
- La clé HésiaSun lisible par un navigateur.

## 4. Les façons de faire envisagées

| | Principe | Pour | Contre |
|---|---|---|---|
| **A (retenue)** | Majord'home source, poussée vers HésiaSun par son API | Un seul sens, pas de conflit ; chaque produit reste autonome | HésiaSun en lecture seule pour une entreprise reliée |
| B | Les deux écrans modifiables, synchronisés dans les deux sens | Souple | Conflits, échos, base de comparaison à tenir — vécu avec la fiche client Pennylane, disproportionné pour une identité qui change deux fois par an |
| C | Identité tenue dans un troisième service, lue par les deux | Propre sur le papier | Les deux produits dépendraient d'un tiers pour imprimer un devis |

Eric a retenu **A** le 2026-11-21. Pour la « maintenance à un seul endroit », un composant d'écran commun a été
écarté (deux techniques, deux habillages, onglets différents) : on partage **les règles**, chaque produit
dessine son formulaire.

## 5. Conception

### 5.1 Le périmètre : les champs de l'identité

Quinze champs, tous des textes, sous les clés déjà communes :

`brand_name` (obligatoire), `legal_name`, `legal_form`, `capital`, `siret`, `tva_intra`, `rcs`, `insurance`,
`address`, `postal_code`, `city`, `phone`, `website_url`, `signatory_name`, `signatory_role`.

Hors périmètre, volontairement : `from_email` (expéditeur des e-mails de Majord'home, ce n'est pas l'e-mail de
contact de HésiaSun), `rge_certifications` et `company_documents` (HésiaSun les tient autrement), logo,
signature, couleurs, territoire.

### 5.2 Le module de règles (Majord'home, lot 1)

`src/lib/organisation/identite.js`, module PUR (aucun import React, Supabase ni alias ; JSDoc sur chaque
export), testé par `scripts/organisation-identite.test.mjs` et ajouté à `audit:quality`. Il porte :

- `VERSION_IDENTITE` (entier), à incrémenter à tout changement de champ ou de règle ;
- `CHAMPS_IDENTITE` : la liste ordonnée (clé, libellé, obligatoire, longueur maximale) ;
- les normalisations : SIRET (14 chiffres ou vide), TVA (`FR` + 11 chiffres), code postal (5 chiffres),
  téléphone (via les règles de `phoneUtils`, recopiées si l'import casse la pureté), site web (préfixe `https`) ;
- `validerSaisie(valeurs, cles)` → `{ ok, erreurs }` : contrôle d'ÉCRAN, avec les champs obligatoires
  d'aujourd'hui (nom commercial pour Identité ; adresse, code postal, ville, téléphone pour Coordonnées) ;
- `validerEnvoi(identite)` → `{ ok, erreurs }` : contrôle de l'ENVOI, formats seulement, seul `brand_name`
  obligatoire — une entreprise aux coordonnées encore vides s'envoie sans refus ;
- `formaterPourSaisie(cle, valeur)` : la forme affichée et enregistrée par Majord'home (espaces du SIRET, de
  la TVA, du téléphone) ;
- `tvaDepuisSiret(siret)` : la TVA calculée du SIREN, reprise de HésiaSun ;
- `identitePourEnvoi(settings)` → l'objet normalisé (sans espaces) des quinze champs, chaînes vides
  comprises, plus `version`.

**Ce que Majord'home enregistre ne change pas de forme** : la normalisation ne sert qu'à l'envoi et à la
comparaison ; les PDF continuent d'imprimer les valeurs enregistrées. Une identité reprise de HésiaSun passe
par `formaterPourSaisie` avant d'être écrite dans Majord'home.

`IdentityTab.jsx` et `ContactTab.jsx` l'utilisent à la place de leurs fonctions locales (aucun changement
visible attendu : mêmes champs obligatoires, mêmes formats). Les règles actuelles des deux écrans et de `settings.ts` (HésiaSun)
sont à comparer AVANT d'écrire : toute différence est tranchée dans le module et notée dans le commit.

**Copie pour HésiaSun.** Le fichier est copié tel quel dans HésiaSun par un script de Majord'home
(`npm run sync:identite`, qui écrit dans `../Solaire/apps/web/src/lib/organization/identite-partagee.js` quand
ce dossier existe, comme `sync:tournee-engine` pour Deno). On n'édite jamais la copie. Deux garde-fous :
un test côté HésiaSun vérifie que ses normalisations existantes rendent le même résultat que la copie sur un
jeu de valeurs ; et la version voyage dans chaque envoi (§ 5.4), si bien qu'une copie en retard se voit au
premier envoi, pas six mois plus tard.

### 5.3 Côté HésiaSun (lot 2)

- **Portée d'API** `organization:write`, ajoutée aux portées connues et proposée à la création d'une clé.
- **`GET /api/v1/organization`** (portée `organization:write`, non décompté du quota) : rend
  `{ id, name, identite: {quinze champs}, siret_verifie, geree_par }`.
- **`PUT /api/v1/organization`** (même portée, non décompté) : reçoit `{ version, identite, source: 'majordhome' }`.
  - `version` supérieure à celle de la copie locale ⇒ 409 `version_inconnue` (rien n'est écrit).
  - Valide avec les règles de la copie ; un champ refusé ⇒ 422 avec la clé du champ.
  - `siret` reçu non vide et différent de `siret_verifie` ⇒ 409 `siret_different` (un envoi ne change jamais
    un SIRET vérifié dans l'annuaire).
  - **Qui a le droit d'écrire** : la requête porte `liaison_id` (identifiant tiré par Majord'home au moment
    de relier) et, pour le tout premier envoi seulement, `ouverture: true`.
    - Aucune gestion en place et `ouverture: true` ⇒ accepté, la liaison est ouverte.
    - Gestion en place avec le MÊME `liaison_id` ⇒ accepté.
    - Gestion en place avec un autre `liaison_id` ⇒ 409 `deja_reliee` (une autre organisation Majord'home
      tient déjà cette entreprise).
    - Aucune gestion en place et pas d'`ouverture` ⇒ 409 `liaison_rompue` (HésiaSun a repris la main) : un
      rejeu ou un « Renvoyer » n'annule donc jamais « Reprendre la gestion ici ». Relier à nouveau est un geste
      neuf de l'administrateur, avec un nouvel identifiant.
  - Écrit les quinze clés dans `settings` (réécrit complet à partir de sa valeur brute, comme
    `saveOrgSettingsAction`) et `organizations.name` ← `brand_name`. Aucune migration.
  - Pose `settings.identite_geree_par = { source: 'majordhome', liaison_id, depuis, dernier_envoi }` à
    l'ouverture, met à jour `dernier_envoi` ensuite.
- **`DELETE /api/v1/organization/liaison`** (avec `liaison_id`, refusé s'il ne correspond pas) : retire
  `identite_geree_par` (appelé quand Majord'home délie).
- **Écran Identité** : si `identite_geree_par` est posé, les quinze champs sont en lecture seule sous un
  bandeau « Identité gérée dans Majord'home — dernière mise à jour le … », avec un bouton **« Reprendre la
  gestion ici »** (administrateur de l'organisation, confirmation) qui retire `identite_geree_par` et note
  `settings.identite_liaison_rompue_le`. C'est la sortie de secours si l'entreprise quitte Majord'home.
  `saveOrgSettingsAction` refuse alors, côté serveur, toute clé d'identité tant que la gestion est ailleurs
  (une lecture seule d'écran ne suffit pas).
- La clé d'API désigne l'organisation : l'entrée n'accepte aucun identifiant d'organisation dans la requête.

**État du lot 2 au 2026-11-21 : écrit et commité en local dans HésiaSun (`7482789`), non poussé.** Écarts avec
ce qui précède, constatés en construisant :
- **Une migration est nécessaire** (`20261121_0049_api_keys_portee_organisation.sql`) : `api_keys.scopes` porte
  une contrainte qui n'acceptait que trois portées. À appliquer avant tout push de HésiaSun.
- **TVA** : un envoi dont la TVA ne correspond pas au SIRET est refusé, 409 `tva_incoherente` (TVA vide acceptée).
- **Défaire la liaison** : `DELETE /api/v1/organization/liaison?liaison_id=…` (paramètre d'adresse, pas de corps).
- **Refus** : tous en 409 `conflict` avec la raison dans `error.details.raison` ; un champ mal formé en 422 avec
  le détail par champ dans `error.details`.
- **Forme enregistrée par HésiaSun** : SIRET et TVA sans espaces (son schéma), téléphone par paires.
- **E-mail, logo et signature** restent modifiables dans HésiaSun sous gestion extérieure.
- Les trois entrées ne sont pas décomptées du quota : elles fonctionnent quel que soit le plan.
- Limite connue : la lecture seule est tenue par l'écran et par l'action d'enregistrement ; la règle de base de
  données de HésiaSun laisse toujours un administrateur écrire sa ligne d'organisation par un autre chemin.
- Copie des règles : `npm run sync:identite` (Majord'home) écrit `identite-partagee.js` dans HésiaSun,
  `-- --check` échoue si elle diffère.

### 5.4 Côté Majord'home (lot 3)

**Relier.** Paramètres → Organisation → Identité, bloc « HésiaSun » (org_admin). L'administrateur colle une
clé HésiaSun de portée `organization:write`. L'edge `hesiasun-identite` (ci-dessous), action `relier` :
1. appelle `GET /organization` avec la clé reçue ; clé refusée ⇒ `cle_refusee`, rien n'est rangé ;
2. si les deux SIRET sont renseignés et différents ⇒ `siret_different`, rien n'est rangé ;
3. si HésiaSun est déjà gérée par une autre liaison ⇒ `deja_reliee`, rien n'est rangé ;
4. range la clé au coffre (clé `hesiasun:api_key`), tire un `liaison_id` et rend le nom de l'entreprise
   HésiaSun et son identité.

Le bloc est une ligne repliée en bas de l'onglet Identité (« Relier à HésiaSun »), visible de tout org_admin :
pas de module à ouvrir, donc rien à changer dans `modules.js` ni dans `baikal-admin`. Si `MDH_HESIASUN_URL`
n'est pas posé, l'action répond `non_configure` et le bloc le dit.

L'écran montre alors les deux identités côte à côte et demande laquelle garder, **une fois** :
« Garder celle de Majord'home » (elle part vers HésiaSun) ou « Reprendre celle de HésiaSun » (elle est écrite
dans les réglages de Majord'home par `org_update_settings`, au jeton de l'administrateur, puis renvoyée telle
quelle). Quand un des deux côtés est vide, le choix est présélectionné sur l'autre mais reste à confirmer.
Ensuite Majord'home est la source.

**État.** `settings.hesiasun = { liaison_id, relie_le, entreprise, dernier_envoi_le, erreur, en_attente }`, écrit
seulement par l'edge via une RPC `public.org_hesiasun_noter(p_org_id, p_etat jsonb)` (SECURITY DEFINER,
`REVOKE … FROM PUBLIC, anon, authenticated`, fusion de la seule clé `hesiasun`). La clé d'API n'y figure jamais.

**Edge `hesiasun-identite`** (`verify_jwt = true`, `requireOrgMembership` avec `requiredRole: 'org_admin'`),
actions fermées : `relier`, `pousser`, `delier`, `etat`.
- L'adresse de HésiaSun vient du secret `MDH_HESIASUN_URL` ; absente ⇒ `non_configure`.
- `pousser` relit l'identité EN BASE (jamais dans la requête), la passe par `identitePourEnvoi`, lit la clé par
  `org_secret_read`, appelle `PUT /organization`. Succès ⇒ `dernier_envoi_le`, `erreur` et `en_attente` vidés.
  Échec ⇒ `erreur` = code, `en_attente = true`. `liaison_rompue` ⇒ la liaison est défaite côté Majord'home
  (clé retirée du coffre, `settings.hesiasun` vidé sauf une mention « rompue depuis HésiaSun le … »).
- `delier` : `DELETE /organization/liaison?liaison_id=…`, puis clé retirée et état vidé, même si HésiaSun ne répond pas
  (le dire).
- Réponses `{ data, error }` où `error` est un CODE ; table codes ↔ messages dans le module pur, testée dans
  les deux sens (convention de `dpe-lien` et `sav-report-send`).

**Déclenchement.** Après un enregistrement réussi de l'onglet Identité ou Coordonnées, si l'organisation est
reliée, l'écran appelle `pousser`. Échec ⇒ message (« Enregistré dans Majord'home ; HésiaSun n'a pas reçu la
mise à jour : … ») et le bloc HésiaSun affiche l'erreur avec « Renvoyer ». L'enregistrement dans Majord'home
n'échoue jamais à cause de HésiaSun.

**Rejeu.** Un cron horaire (`pg_cron`, migration versionnée, secret `MDH_CRON_SECRET` lu au coffre) appelle
l'edge `hesiasun-identite-cron` (`verify_jwt = false`, `requireSharedSecret`), qui ne fait un appel réseau que
pour les organisations `en_attente`. Au bout de 24 h d'échecs, il cesse et laisse l'erreur affichée.

### 5.5 Recherche dans l'annuaire, côté Majord'home (lot 5, indépendant)

HésiaSun sait « Retrouver votre entreprise » (annuaire des entreprises) ; Majord'home fait tout saisir. À
reprendre dans l'onglet Identité de Majord'home : recherche par nom ou SIRET, remplissage de raison sociale,
SIRET, TVA, forme juridique quand l'annuaire la donne, adresse du siège. Majord'home a déjà un accès à
l'annuaire pour la prospection (`src/apps/prospection/_shared/lib/sireneApi.js`). Ce lot ne dépend pas des
autres et sert directement l'onboarding.

## 6. Ordre et vérification

| Lot | Contenu | Dépôt | Preuve |
|---|---|---|---|
| 1 | Module de règles, écrans Majord'home branchés dessus | Majord'home | tests du module, lint, build ; pour Mayer et Cimaj, `formaterPourSaisie` appliqué aux valeurs en base les rend inchangées, et `validerEnvoi(identitePourEnvoi(…))` passe |
| 2 | Portée, entrées d'API, lecture seule, « Reprendre la gestion ici » | HésiaSun | tests de l'entrée (version, SIRET, ouverture, autre liaison, liaison rompue, `name`), typecheck, lint |
| 3 | Bloc HésiaSun, edge, RPC d'état, cron | Majord'home | harnais pour la RPC (`has_function_privilege`), tests des codes, un envoi réel vers une organisation HésiaSun de test relu par `GET` |
| 4 | Logo et image de signature | les deux | à concevoir à part |
| 5 | Recherche dans l'annuaire | Majord'home | tests du remplissage, essai à l'écran |

Les lots 1 et 5 se livrent seuls. Le lot 3 n'a de sens qu'après le lot 2 en production.

**Règles de livraison.** HésiaSun : français partout, commits `domaine : description`, `git commit --only`,
**aucun push, aucune migration, aucun changement d'environnement sans l'accord explicite d'Eric, étape par
étape**. Majord'home : toute edge déployée et tout secret posé en production sur son oui ; migrations répétées
sur le harnais avant la production.

## 7. Mes choix, à corriger si besoin

Ce sont des choix de conception que j'ai faits, pas des décisions d'Eric :
1. Quinze champs de texte seulement ; e-mail de contact, certifications et documents restent propres à chaque
   produit.
2. La liaison se fait par une clé d'API collée par l'administrateur (pas de rapprochement automatique par le
   SIRET : deux entreprises ne se relient pas sans le geste de quelqu'un qui a les deux accès).
3. HésiaSun peut reprendre la main seul (« Reprendre la gestion ici »).
4. Un envoi ne change jamais un SIRET vérifié dans l'annuaire par HésiaSun.
5. Au moment de relier, l'administrateur choisit une fois quelle identité garder.
6. Les règles sont copiées d'un dépôt à l'autre avec un numéro de version dans chaque envoi, plutôt que
   publiées comme un paquet installé des deux côtés.
7. Majord'home garde sa forme d'enregistrement (avec espaces) ; seul l'envoi est normalisé.
8. L'envoi ne contrôle que les formats ; les champs obligatoires restent une règle d'écran.
9. Le bloc de liaison est visible de tout org_admin, replié, sans module.
10. Une entreprise HésiaSun n'est tenue que par une liaison à la fois (`liaison_id`).

## 7 bis. Tranché par Eric le 2026-11-21 : « Oui, annuaire »

Majord'home fait comme HésiaSun : raison sociale, SIRET et forme juridique viennent de l'annuaire des
entreprises, la TVA se calcule du SIREN ; la saisie à la main ne s'ouvre que par « Entreprise introuvable dans
l'annuaire ? Saisir à la main ». Livré avec les lots 1 et 5 (plan
`docs/superpowers/plans/2026-11-21-identite-entreprise-lots-1-et-5.md`). L'entrée d'API de HésiaSun (lot 2)
peut donc exiger une TVA cohérente avec le SIREN quand le SIRET est renseigné.

## 8. Laissé au constructeur

- Le détail des libellés et des messages, dans le ton de chaque produit.
- La forme exacte du bloc « HésiaSun » et de la comparaison côte à côte.
- L'emplacement des tests côté HésiaSun (vitest) et le découpage en fichiers.
- Le nom de la migration et son numéro du jour.
