# Agent téléphonique — reconnaître le client par son numéro

> Statut : **SPEC À VALIDER** (2026-10-04). Aucun code écrit, aucune config d'agent modifiée.
> Évolution de `2026-10-04-agent-telephonique-verifier-client-design.md` (livré).
> Demande d'Eric : « plus intéressant de demander le numéro (ou d'utiliser celui qui appelle) :
> recherche par numéro, trouve la fiche, “à Gaillac, c'est bien ça ?”, “vous pouvez me
> confirmer votre adresse ?” — c'est plus fluide ».

> **Mise à jour 2026-10-04 (v10.2, en ligne)** : le mécanisme décrit au § 5 par variables
> dynamiques (`accueil`, `appelant_*`, `date_heure_paris`) est **abandonné** — ElevenLabs refuse
> tout appel dont une variable n'est pas fournie (« missing required dynamic variable »), et ses
> valeurs par défaut ne servent qu'aux tests du tableau de bord. L'edge `agent-accueil` renvoie
> désormais une **surcharge du premier message** (message d'accueil saisi dans Settings →
> Communication → Agent téléphonique, « Bonjour » remplacé par la salutation) ; le prompt déduit
> l'accueil de ce premier message. Abandonnés : le cas « dossier à Gaillac » (accueil neutre) et
> l'heure de Paris fournie par le serveur. Référence à jour : `docs/agent-telephonique/prompt-v10.md`.

## 1. Le problème

Aujourd'hui (prompt v9), Claire demande dans l'ordre : nom (épelé), commune, adresse, numéro
(répété par paires), puis vérifie. Quatre questions, dont deux pénibles (épeler, répéter un
numéro), avant de savoir si l'appelant est client. Or le numéro est la clé la plus
discriminante (≤ 5 fiches par numéro, contre 67 pour un même nom), et au téléphone il arrive
**gratuitement** : c'est le numéro qui appelle.

## 2. Le conflit avec la règle actuelle (surfacé, tranché)

La spec `verifier_client` pose : **« aucun oracle »** — l'agent ne dit jamais qu'un dossier
existe ni ce qu'il contient avant vérification. Annoncer « à Gaillac, c'est bien ça ? » à
partir d'un numéro **dit à voix haute** casserait cette règle : n'importe qui pourrait dicter le
numéro d'un tiers et apprendre où il habite (puis, par élimination, s'il est client).

La variante retenue distingue **d'où vient le numéro** :

| Numéro | Origine | Annonce de la commune |
|---|---|---|
| **Numéro appelant** (`system__caller_id`, injecté par la plateforme, jamais par le modèle) | le téléphone qui appelle | **Oui** — c'est son propre téléphone qui parle |
| Numéro **dicté** (numéro masqué, test web, « j'appelle d'un autre téléphone ») | ce que dit l'appelant | **Non** — on demande la commune, comme aujourd'hui |

Ce qui reste exposé dans le premier cas : à quelqu'un qui appelle **depuis** le téléphone d'un
client, le **nom** (accueil personnalisé, § 3) ou, à défaut, la commune de sa fiche — ni adresse,
ni équipement, ni RDV. C'est le conjoint, un enfant,
le client lui-même dans l'immense majorité des cas. Usurper un numéro appelant est possible mais
encadré (authentification des numéros imposée aux opérateurs en France depuis 2024 — à confirmer
sur le dossier Twilio). **Risque jugé acceptable ; à valider par Eric.**

La vérification elle-même ne change pas de nature : rien au-delà de la commune n'est dit tant
que le serveur n'a pas vérifié l'**adresse** (et le nom dans le cas du numéro dicté).

## 3. Flux d'appel cible

**Accueil personnalisé dès la première phrase** (décision Eric 2026-10-04 : « tellement classe
de pouvoir faire une réponse personnalisée directement »). Avant que Claire ne parle, ElevenLabs
appelle notre **webhook d'initiation** avec le numéro appelant (§ 5) ; le serveur renvoie le
message d'accueil :

| Ce que porte le numéro | Premier message |
|---|---|
| une seule fiche, prénom connu | « Bonjour Jean Dupont, Mayer Énergie, Claire à l'appareil. Cet appel peut être enregistré pour le suivi de votre demande. Que puis-je pour vous ? » |
| plusieurs fiches au même nom (couple), ou prénom absent / double (« Jean et Marie ») | « Bonjour Madame, Monsieur Dupont, Mayer Énergie, … » |
| fiches à des noms différents, numéro inconnu, numéro masqué, test web, serveur trop lent | accueil actuel, neutre |

**Jamais de « Monsieur » ou « Madame » deviné** : la fiche client n'a pas de civilité, et
deviner depuis le prénom se trompe (Dominique, Claude, Camille…). « Prénom Nom » ou « Madame,
Monsieur Nom » sont corrects dans tous les cas. Une colonne civilité sur la fiche permettrait
« Bonjour Monsieur Dupont » — chantier séparé, pas un prérequis.

**Étape 1** (inchangée) : qualifier la demande.

**Étape 2a — client accueilli par son nom** :
1. « Vous pouvez me confirmer votre adresse ? » → `verifier_client` (adresse seule : numéro,
   nom et commune sont ceux du serveur).
2. Si l'appelant corrige le nom à l'accueil (« ah non, c'est sa fille ») ou si la vérification
   échoue → étape 2b, sans commentaire, mais **sans redemander le numéro** (on le connaît).

**Étape 2a bis — numéro reconnu sans nom annonçable** (fiches à des noms différents dans la même
commune) : « Je vois un dossier à Gaillac, c'est bien vous ? » puis adresse, comme ci-dessus.
Fiches dans plusieurs communes → 2b.

**Étape 2b — pas de numéro appelant, ou bascule** : nom (épelé), commune, adresse, puis le
numéro **seulement s'il n'a pas déjà été obtenu** → `verifier_client` comme aujourd'hui.

Gain attendu pour un client qui appelle de son téléphone : 2 questions (« c'est bien vous ? »,
« votre adresse ? ») au lieu de 4, ni épellation ni dictée de numéro. **Le nom n'est plus
demandé à un client vérifié** : on l'a déjà ; il ne reste demandé qu'à un nouveau client
(étape 2b), pour la demande de rappel.

## 4. Mesures en base (Mayer, 2026-10-04)

- 3 699 numéros distincts portés par 3 397 clients actifs.
- 53 numéros partagés par plusieurs fiches ; **31 avec des communes différentes** (0,8 %) : pour
  eux, `commune: null` → étape 2b.
- 89 clients sans aucun numéro : jamais reconnus par le numéro (étape 2b, puis nouveau client).

## 5. Changements serveur

### Webhook d'initiation : edge `agent-accueil`
- Appelée par ElevenLabs au décroché d'un appel Twilio (« conversation initiation client data
  webhook »), avec le numéro appelant, le numéro appelé et l'`agent_id`. Format exact de la
  requête et de l'authentification à relever sur la doc ElevenLabs au moment du code.
- Org résolue depuis l'`agent_id` (`_shared/agentOrg.ts`). Une requête : fiches non archivées
  portant ce numéro (même RPC de candidats que `verifier_client`).
- Renvoie `dynamic_variables` (`accueil_nom`, `accueil_commune`, `numero_reconnu`) et
  `conversation_config_override.agent.first_message` selon le tableau du § 3.
- **Budget : réponse en moins de 500 ms.** Au-delà, ou en erreur : accueil neutre (l'appel ne
  doit jamais attendre ni échouer à cause de nous).
- Rien n'est vérifié à ce stade : `agent_verifications` n'est pas écrit, et l'agent ne doit
  rien dire d'autre que le nom avant la vérification de l'adresse.

### Edge `agent-verifier-client` : deux actions
- **`reconnaitre`** (nouvelle) — corps : `{ action: "reconnaitre", telephone_appelant,
  conversation_id, agent_id }`, les trois derniers en variables système (`system__caller_id`,
  `system__conversation_id`, `system__agent_id`). Renvoie `{ commune }` si toutes les fiches du
  numéro partagent une commune (normalisée), sinon `{ commune: null }`. Jamais de nom, jamais le
  nombre de fiches. Numéro masqué / invalide → `{ commune: null }`. Tracée dans
  `agent_verifications` (motif interne `reconnaissance`), **hors** limite des 3 vérifications.
- **`verifier`** (existante, par défaut) — accepte en plus `telephone_appelant` (variable
  système). Règle :
  - numéro utilisé = `telephone` dicté s'il est fourni, sinon `telephone_appelant` ;
  - `commune` vide **et** numéro = numéro appelant → le filtre commune est sauté (elle a été
    confirmée à l'oral à partir du serveur) ; `nom` vide dans le même cas → filtre nom sauté.
  - Le reste inchangé : vérifié si un et un seul candidat passe l'**adresse** ; doublon → `false`.

### Module pur `src/lib/agentTelephonique.js`
- `communeUnique(candidats)` → commune normalisée commune à toutes les fiches, ou `null`.
- `verifierCandidats(entree, candidats, { numeroAppelant })` : filtres nom / commune ignorés
  quand le champ est vide ET que `numeroAppelant` est vrai ; jamais sinon (un numéro dicté sans
  commune reste un échec, comme aujourd'hui).
- Tests ajoutés à `scripts/agent-telephonique.test.mjs` : commune unique / multiple / aucune ;
  vérification par numéro appelant + adresse seule ; même entrée avec un numéro dicté → échec.

Aucune migration : `agent_verifications.motif_echec` est un texte libre (nouvelle valeur
`reconnaissance`).

## 6. Changements côté agent (soumis à Eric avant application)

- Activer le webhook d'initiation sur l'agent (`enable_conversation_initiation_client_data_from_webhook`)
  et autoriser la surcharge du premier message (`overrides…agent.first_message`, aujourd'hui `false`).
- L'outil `reconnaitre_appelant` devient inutile dans le cas nominal (l'accueil a déjà la
  réponse) : les variables `accueil_*` suffisent au prompt. Le garder seulement si la doc
  ElevenLabs montre que le webhook d'initiation n'est pas fiable.
- Outil `verifier_client` : `nom`, `commune`, `telephone` deviennent facultatifs ;
  `telephone_appelant` = `system__caller_id` ajouté.
- Prompt v10, étape 2 réécrite selon le § 3 (texte proposé à part, une fois le serveur prêt).
  Le reste du prompt (créneaux, récapitulatif, conclusion) inchangé.

## 7. Tests

- **Sans Twilio (aujourd'hui, widget web)** : `system__caller_id` est vide → seul le chemin 2b
  est testable ; il doit se comporter exactement comme le v9, dans le nouvel ordre.
- **Avec Twilio** : appel depuis le portable d'un client test (fiche ABRIOUX) → commune annoncée,
  adresse demandée, vérifié ; appel depuis un numéro inconnu → 2b sans rien révéler ; numéro
  masqué → 2b.
- Le serveur se teste sans crédit d'appel : `curl` signé du secret sur les deux actions.

## 8. Hors périmètre

- Civilité sur la fiche client (« Bonjour Monsieur Dupont ») : chantier séparé.
- Le même webhook d'initiation pourra injecter l'heure de Paris (le réglage
  `system__timezone` est ignoré par ElevenLabs) : à ajouter dans la foulée, il est gratuit.
- Journal d'appel / demande de rappel : spec séparée (`…-journal-appel-design.md`).
