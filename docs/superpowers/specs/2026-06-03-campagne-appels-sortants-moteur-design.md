# Spec — Moteur de campagne d'appels sortants (le « cerveau »)

> **Date** : 2026-06-03
> **Statut** : Design validé en discussion, en attente de relecture Eric avant plan
> **Périmètre** : Spec n°1 sur 2. Cette spec couvre le **cerveau applicatif** (déclenchement, file d'appel, données, écran de phoning, qualification, branchement RDV/refus). Le **volet audio** (outil IA, numéro/caller ID, trunk SIP/PBX, transfert réel, webhooks téléphonie) fait l'objet d'une **spec n°2 séparée** qui dépend des réponses de l'opérateur télécom de Mayer.
> **Lié à** : `2026-06-03-rdv-kanban-unifie-bloc-a-design.md` (réutilise le modèle RDV↔carte), module Entretiens, module Pipeline, [[project_phase1_voice_pwa]] (phase TÉLÉPHONE / BUY).

---

## 1. Contexte & objectif

Aujourd'hui, la relance téléphonique des contrats d'entretien « à planifier » (et des leads chauds du pipeline) est faite à la main par un humain (Philippe Mazel ou un commercial). **70-80 % de ce temps est perdu sur des appels qui n'aboutissent pas** : non-décrochés et répondeurs. C'est la friction réelle constatée.

**Objectif** : un assistant vocal IA qui **compose les numéros, absorbe les non-aboutis tout seul, et ne mobilise l'humain que sur les vrais décrochés**. L'humain reste le closeur — il prend l'appel transféré et cale le RDV (ou qualifie le refus) lui-même.

**Ce n'est pas du « launch and forget »** : l'humain lance la séquence, reste attentif et disponible (il peut faire autre chose en parallèle), et reprend la main dès qu'un client décroche.

### Niveau d'ambition : 0,5 (filtre + transfert)

- L'IA **compose**, **détecte répondeur / non-décroché**, **laisse un message sur répondeur**, et **transfère** les humains qui décrochent.
- L'IA **ne prend pas les RDV** et **ne gère pas les objections** — c'est l'humain post-transfert.
- Le Niveau 1 (l'IA propose des créneaux, cale les RDV faciles, gère les objections) est **explicitement hors périmètre** et viendra plus tard.

---

## 2. Périmètre de cette spec

**Dans le périmètre (constructible sans la téléphonie réelle)** :
- Déclenchement depuis le kanban (colonne « À planifier »)
- File d'appel séquentielle + session de campagne
- Modèle de données `call_attempts` + dérivation des marqueurs sur les cartes
- Écran de phoning : tableau de bord live + zone screen-pop
- Qualification automatique des issues non-abouties (non décroché / répondeur / transfert loupé)
- Gestes rapides post-décroché (caler RDV / refusé client / à rappeler) — branchés sur les flux existants
- Comportements paramétrables (plages horaires, garde-fous)

**Hors périmètre — spec n°2 (volet audio)** :
- Choix de l'outil IA (Vapi probable), voix FR, latence
- Numéro Mayer en sortie (caller ID), trunk SIP, intégration PBX
- Mécanique réelle de transfert d'appel
- Webhooks téléphonie réels

**Hors périmètre — évolution (Niveau 1)** :
- IA qui propose des créneaux et réserve les RDV
- IA qui gère les objections et coche elle-même « refusé par le client »

### Découplage spec n°1 ↔ spec n°2 : l'adaptateur `CallProvider`

Le moteur consomme un **`CallProvider` abstrait** (même esprit que l'adapter pattern intake/notify du voice PWA). Interface :

- `startSession(contacts, params)` → démarre la file d'appel
- événements émis : `onDialing`, `onNoAnswer`, `onVoicemail`, `onHumanAnswered`, `onTransferAccepted`, `onTransferMissed`, `onSessionDone`

**Spec n°1** fournit une **implémentation `MockCallProvider`** (simule les événements selon un scénario configurable) → permet de développer et tester tout le cerveau sans téléphonie. **Spec n°2** fournit l'implémentation réelle (Vapi/Telnyx + PBX). Le reste du code ne change pas.

---

## 3. Usage cible : deux kanbans, un seul moteur

- **Entretien** (cartes = interventions) — **besoin n°1**.
- **Pipeline leads chauds** (cartes = leads) — même moteur, accroche différente.

Le « segment » à appeler **n'est pas une requête séparée** : c'est le **contenu de la colonne « À planifier »** du kanban concerné. L'utilisateur range déjà ses cartes là — le geste existe.

L'accroche (texte court dit par l'IA avant transfert) est **paramétrable par contexte** (entretien vs lead chaud).

---

## 4. Scénario de bout en bout (validé)

**Préparation**
1. L'utilisateur range les cartes à appeler dans la colonne **« À planifier »** (geste existant).
2. Il clique sur **« Lancer l'appel »** en tête de colonne → lancement **immédiat** (batch typique 10-15).

**Pendant — l'humain est en veille (il fait autre chose, reste attentif)**
3. L'IA compose, **1 appel à la fois**. Un onglet/panneau « Phoning » reste ouvert.
4. Tableau de bord live : *appelés N · répondeurs N · non décrochés N · transferts N* + progression.
5. **Ça mord** (humain décroché) → notification sonore + la **fiche du contact s'ouvre toute seule** (screen-pop) avec les **3 gestes rapides**. Le tél / softphone de l'humain sonne (volet audio, spec n°2). Il décroche et parle.

**Close (par l'humain)**
6. Pendant / après la conversation, il clique l'un des 3 gestes → la file reprend automatiquement.

---

## 5. Architecture & composants

### Déclenchement
- Bouton **« Lancer l'appel »** en tête de la colonne « À planifier » (kanban entretien d'abord, kanban pipeline ensuite).
- Désactivé si la colonne est vide.
- Empêche une 2ᵉ session active simultanée sur le même kanban.
- À la création : snapshot des cartes de la colonne → `call_session` + une `call_attempt` planifiée par contact.

### Écran de phoning
- **Tableau de bord live** : compteurs par issue + barre de progression + bouton Pause/Stop.
- **Zone screen-pop** : vide en veille ; à `onHumanAnswered`, affiche la fiche du contact + les 3 gestes.

### Qualification automatique
- `onNoAnswer` / `onVoicemail` / `onTransferMissed` → écrivent une ligne `call_attempts` avec le `result` correspondant + mettent à jour les marqueurs de la carte. Aucune action humaine requise.

---

## 6. Modèle de données

### Table `majordhome.call_attempts` (journal — source de vérité)

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | FK `core.organizations`, RLS |
| `session_id` | uuid | FK `call_sessions` (regroupe un « Lancer l'appel ») |
| `intervention_id` | uuid NULL | FK — miroir, **exactement 1 de** `intervention_id`/`lead_id` renseigné (comme `appointments` du Bloc A) |
| `lead_id` | uuid NULL | FK — miroir |
| `phone_dialed` | text | numéro effectivement composé |
| `result` | text (enum) | `no_answer` · `voicemail` · `transferred_answered` · `transfer_missed` · `rdv_booked` · `refused` · `callback` |
| `note` | text NULL | objection / commentaire (cas refus, à rappeler) |
| `attempt_at` | timestamptz | |
| `created_by` | uuid NULL | humain ayant qualifié (NULL si auto-IA) |
| `created_at` | timestamptz | |

- `result` **aligné et étendu** depuis `CallModal` existant (`no_answer`, `callback`).
- RLS `org_id IN (org_members)`, `GRANT SELECT TO service_role` (charte multi-tenant), vue publique `majordhome_call_attempts` en `security_invoker=true`.

### Table `majordhome.call_sessions` (légère)

`id`, `org_id`, `kanban` (`entretien`|`pipeline`), `params` jsonb (fenêtre horaire, accroche), `status` (`active`|`paused`|`done`), `started_at`, `started_by`, `ended_at`, compteurs dénormalisés optionnels.

### Dérivation sur les cartes
Les vues kanban (entretien + pipeline) dérivent `call_count`, `last_call_at`, `last_call_result` depuis `call_attempts` — **même pattern que `next_rdv_date` du Bloc A**. Réutilise le rendu du tag 📞 existant ([LeadCard.jsx:278](../../../src/apps/artisan/components/pipeline/LeadCard.jsx#L278)).

> **Décision à confirmer au plan** : le pipeline a déjà `leads.call_count` / `leads.last_call_date` alimentés par `CallModal`. Choix retenu : `call_attempts` devient la **source de vérité unique**, les vues dérivent les compteurs. Vérifier au plan comment `CallModal` persiste aujourd'hui pour réconcilier sans casser le tag 📞 actuel du pipeline (option de transition : l'IA écrit `call_attempts` **et** incrémente `leads.call_count` tant que la vue pipeline n'est pas migrée).

---

## 7. Comportements

| Comportement | Décision V1 |
|---|---|
| **Débit** | 1 appel à la fois (séquentiel). Jamais l'humain débordé. |
| **Non décroché** | `result=no_answer`, `call_attempts +1`, carte **reste « À planifier »**, tag 📞+1. |
| **Répondeur** | `result=voicemail`, **message TTS court laissé**, tag 📞+1 + marqueur « répondeur ». |
| **Transfert pris** | `result=transferred_answered` → l'humain close via les 3 gestes. |
| **Transfert loupé** (humain ne prend pas en N secondes) | L'IA **s'excuse + propose un rappel**, `result=transfer_missed` → marqueur **« À rappeler »**. Jamais de client laissé en plan. |
| **Plages horaires** | Fenêtre paramétrable + garde-fou par défaut (pas avant 9h / après 20h / le dimanche). |
| **Re-tentatives** | V1 = **une passe** sur le batch. Pour relancer les non-décrochés, l'utilisateur relance un nouveau batch. Re-tentative automatique espacée = évolution V1.1. |

---

## 8. Gestes rapides post-décroché (screen-pop)

L'écran de phoning expose **3 gestes en un clic**, sans que l'humain quitte l'écran ni navigue dans la fiche pendant qu'il a le client en ligne. Ce ne sont **pas de nouvelles fonctions** — ce sont les flux existants regroupés dans le contexte d'appel :

1. **`[Caler le RDV]`** → réutilise le flux RDV du **Bloc A** (`createAppointment` type `maintenance` pour l'entretien / type pipeline pour les leads ; pose `intervention_id`/`lead_id`, matérialise la carte → « Planifié »). `call_attempts.result=rdv_booked`.
2. **`[Refusé par le client + note]`** → réutilise la mécanique **« Proposé mais refusé par le client »** de la fiche Contrat (clôt la visite d'entretien de l'année + note → **sort le contrat du pool « à faire sur l'année »**, historique conservé). `call_attempts.result=refused` + `note`.
3. **`[À rappeler]`** → `call_attempts.result=callback` + marqueur « À rappeler ».

---

## 9. Gestion des erreurs & cas limites

- **Numéro manquant / invalide** sur une carte → skip + marqueur « tél manquant », pas de blocage de la file.
- **Contact opt-out téléphone** (si un flag est ajouté) → exclu de la file.
- **Humain absent** (ne prend aucun transfert) → fallback « à rappeler » systématique sur chaque décroché — aucun client en plan.
- **Lancement sur colonne vide** → bouton désactivé.
- **Double lancement** → une seule session active par kanban.
- **Mutations Supabase** → toujours `{ error }` destructuré + filtre `org_id` explicite (charte projet).

---

## 10. Tests

- **`MockCallProvider`** : émet une séquence d'événements configurable (X non-décrochés, Y répondeurs, Z décrochés…) → développe et valide tout le cerveau sans téléphonie.
- Vérifier : qualification écrit bien `call_attempts` ; dérivation du compteur 📞 sur la carte ; screen-pop ouvre la **bonne** fiche ; les 3 gestes sont branchés sur les flux existants (RDV Bloc A / visite refusée / callback) ; garde-fou horaire respecté ; reprise auto de la file ; une seule session active.

---

## 11. Découpage en livrables (pour le plan)

1. **DB** : `call_attempts` + `call_sessions` + vues publiques + dérivation dans les vues kanban.
2. **`CallProvider` + `MockCallProvider`** : interface + simulateur.
3. **Service + hooks** : `callCampaigns.service.js`, `useCallSession`, cache keys.
4. **UI** : bouton « Lancer l'appel », écran de phoning (dashboard + screen-pop), 3 gestes rapides.
5. **Branchements** : flux RDV Bloc A, visite refusée, marqueurs cartes.

Le tout est **constructible et testable de bout en bout en mode mock**, avant même que le volet audio (spec n°2) soit prêt.
