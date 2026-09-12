# Tournées — « fenêtres d'abord, heures ensuite » : souplesse par RDV, insertion sous fenêtres, consolidation

**Date** : 2026-09-12 · **Statut** : formulation validée par Eric en chat, spec à relire · **Tranche 2 du moteur** (suite de `2026-09-12-planification-entretien-outils-machine-design.md`)

## 1. Le problème

Poser des heures exactes une à une **fragmente** la journée : après MARCIACQ 08:16-09:46 et BASCOUL 14:00, il reste des trous que plus rien ne remplit (« 50 min perdues »). Le moteur actuel ne touche jamais à un RDV posé (arbitrage du 2026-08-29 : « une heure annoncée au client ne bouge pas ») — il ne peut donc ni resserrer une journée ni faire rentrer 110 min dans un trou de 100 en glissant un voisin de 20 min.

**Décisions d'Eric (2026-09-12)** :
- Un RDV **figé** est une **exigence du client** (« je veux 14h, pas avant, pas après »). On le qualifie **à la prise de RDV** : modale « Figer / ±15 / ±30 / demi-journée ». Chaque événement porte sa capacité à bouger.
- Le détour net (« +10 min ») n'est pas une mesure pour l'opérateur. Il voit **trois chiffres** : trajet pour y aller, temps de travail, **temps restant utile** avant le suivant (« 50 min → perdu », « 150 min → une autre visite y tient »). *(Livré en tranche 1, commit `cd0b5ab`.)*
- Les RDV « adaptables » sont ce qui permet d'améliorer la tournée. Variante formulée par Eric et retenue : **ordonnancer par étapes** — 1ᵉʳ passage = prise avec fenêtres, 2ᵉ passage = heures figées quand la journée est complète.
- **On voit toujours des blocs** : avant consolidation, le planning montre le RDV à son heure provisoire, avec sa fenêtre visible. Jamais une liste sans horaire.

## 2. Le modèle en trois temps

| Temps | Quand | Quoi |
|---|---|---|
| **1. Prise** | au téléphone, au clic sur un créneau | Le RDV reçoit une **heure provisoire** (celle du moteur) **et une souplesse** : `0` (figé), `15`, `30`, ou `demi-journée`. Défaut d'org (proposé : ±30 pour un entretien), figé sur demande du client. |
| **2. Insertion** | à chaque nouveau candidat | Le moteur place le candidat en respectant les fenêtres : un voisin **adaptable** peut glisser dans sa tolérance pour faire rentrer le candidat. La proposition l'énonce (« rentre si BASCOUL passe de 14:00 à 14:20 ») et la pose fait **les deux écritures en un geste humain**. Un RDV figé ne bouge **jamais**. |
| **3. Consolidation** | la veille, ou quand la journée est pleine | Action « Figer la journée » : ordonnancement de la journée entière dans les fenêtres (`sequencerTournee`, déjà écrit), heures définitives, **SMS d'heure de passage** à chaque client adaptable, puis tous les RDV de la journée passent figés. |

Ce que le client sait, et quand : un client **figé** connaît son heure dès la prise ; un client **adaptable** connaît sa fenêtre (« mardi entre 8h et 10h » ou « mardi matin ») à la prise, et son heure précise à la consolidation (SMS).

## 3. Modèle de données

- `majordhome.appointments.time_flex_minutes smallint NULL` — tolérance autour de `scheduled_start` : `0` figé, `15`, `30`, `240` (demi-journée = la fenêtre devient [début de demi-journée, fin de demi-journée], cf. §5). **`NULL` = souplesse par défaut de l'org** (`settings.tournees.souplesse_defaut_minutes`, ±30). **Décision d'Eric (2026-09-12) : par principe, tous les RDV existants sont adaptables** — pas de reprise de données, ils prennent le défaut d'org ; c'est en cliquant sur un RDV qu'on le fige quand le client l'exige (§4 bis). Conséquence assumée : une consolidation peut déplacer un RDV ancien dont l'heure avait été dite au client — l'aperçu avant confirmation le montre, et le SMS d'heure de passage l'informe.
- `majordhome.appointments.hour_confirmed_at timestamptz NULL` — posé quand on fige (à la prise ou après coup) et par la consolidation ; `NOT NULL` ⇒ heure communiquée au client, plus aucune souplesse. Repasser un RDV en adaptable remet la colonne à NULL.
- Vue `majordhome_appointments` : deux colonnes ajoutées **en fin de liste** (miroir simple auto-updatable, gotcha `CREATE OR REPLACE VIEW`). Google Calendar sync (one-way) continue de recevoir l'heure provisoire puis l'heure définitive : rien à changer.
- `core.organizations.settings.tournees` : `souplesse_defaut_minutes` (proposé 30), `reste_utile_min_minutes` (proposé 75), `consolidation_heure` (proposé 17:00 la veille, pour l'automatisation ultérieure). Éditables dans l'onglet Settings → Tournées (tâche en cours `task_89bbe7fe`) — **règle « pas de config sans UI »**.

## 4. La prise de RDV (modale de souplesse)

- Au clic sur un créneau proposé (CTA) **et** dans l'assistant classique, avant `scheduleEntretien` : une mini-modale « Souplesse du rendez-vous » avec quatre choix — **Figé** (heure exigée par le client), **±15 min**, **±30 min** (présélectionné = défaut d'org), **Demi-journée**. Une ligne rappelle ce que le client entend : « Vous lui annoncez : mardi 14 oct. vers 08:15 (entre 07:45 et 08:45) ».
- Figé ⇒ `hour_confirmed_at = now()` (l'heure est annoncée) ; sinon `NULL`.
- Le kanban / la fiche client affichent la souplesse (icône ↔ + « ±30 ») tant que `hour_confirmed_at` est NULL.

### 4 bis. Modifier la souplesse après coup (décision Eric 2026-09-12)

- **Un clic sur un RDV** (modale d'édition du Planning `EventModal`, et le panneau de la barre horaire Tournées) expose le **même sélecteur** de souplesse que la prise : Figé / ±15 / ±30 / Demi-journée. Un seul composant partagé (`SouplesseSelect`), une seule écriture (`appointmentsService.updateAppointment` sur `time_flex_minutes` + `hour_confirmed_at`), aucune logique dupliquée.
- Passer en **Figé** = « le client exige cette heure » : `hour_confirmed_at = now()`, le moteur ne le déplacera plus jamais. Repasser en adaptable remet `hour_confirmed_at` à NULL.
- Le geste est **par RDV**, jamais en masse (une exigence client se pose au cas par cas). Permission : celle qui autorise déjà l'édition du RDV.

## 5. Moteur (modules purs, testés)

- `arrets.js::construireArretsExistants` : la fenêtre d'un arrêt devient `[debut − flex, debut + flex]` (bornée par l'amplitude et, pour la demi-journée, par [08:00,12:00] ou [13:00,18:00] selon `scheduled_start`), au lieu de la fenêtre ponctuelle `[debut, debut]`. `flex = 0` ⇒ strictement le comportement actuel.
- `creneaux.js::placerCandidat` : quand un intervalle est trop court de `d` minutes, tenter de **repousser le voisin suivant** (ou avancer le précédent) de `d` à l'intérieur de sa fenêtre — sans cascade au-delà d'un voisin (V1 : un seul RDV décalé par insertion, le cas simple et lisible). Le résultat porte `decalages: [{ id, debutMinutesAvant, debutMinutesApres }]`.
- Score : `coutMinutes` + **pénalité de temps perdu** (`resteUtileMinutes` entre 10 et `reste_utile_min_minutes` ⇒ + le reste, considéré comme du temps de technicien perdu) ; à coût égal, la place la plus tôt (inchangé). Le mois d'entretien du contrat entre au même endroit (bonus léger dans le mois anniversaire ± tolérance, réutilise `scoreEligibilite`).
- `sequence.js::sequencerTournee` **revient dans le chemin de production** pour la consolidation : entrée = arrêts avec fenêtres, sortie = ordre + heures ; ≤ 8 arrêts énumérés (optimum exact), au-delà plus-proche-voisin (déjà écrit). Retirer la mention « hors chemin de production » ; le test-témoin de `creneaux.test.mjs` reste.
- Copies Deno resynchronisées (`npm run sync:tournee-engine`) ; l'edge `slots-propose` renvoie `decalages` sur chaque créneau.

## 6. Pose et consolidation (écritures)

- **Pose** (`scheduleEntretien`, source unique) : reçoit `timeFlexMinutes` + `decalages[]` ; écrit le RDV **et** les décalages des voisins dans la même opération (V1 : deux UPDATE successifs côté service, échec ⇒ rien n'est annoncé comme fait ; la RPC transactionnelle `entretien_book_slot` de la tranche 2 outils-machine reprendra les deux en une transaction).
- **Consolidation** : bouton « Figer la journée » sur la journée (onglet Tournées, en-tête de la barre horaire ; visible si ≥ 1 RDV adaptable) → `sequencerTournee` → aperçu des heures définitives (avant/après par RDV) → confirmation humaine → UPDATE des `scheduled_start/end`, `time_flex_minutes = 0`, `hour_confirmed_at = now()` → SMS `heure_de_passage` à chaque client adaptable (edge `sms-send`, gabarit à créer avec la tâche SMS en cours, variables `{{prenom}} {{date}} {{heure}} {{technicien}}`). **Aucune consolidation automatique en V1** : le geste est humain ; le cron « la veille à 17h » est une V2 explicite.
- Un RDV figé n'apparaît jamais dans un décalage ni dans une consolidation (il est un point fixe de l'ordonnancement).

## 7. Affichage — des blocs, toujours

- **Planning (FullCalendar)** : le RDV adaptable est un bloc **à son heure provisoire** (même durée), style distinct : bordure pointillée + icône ↔ dans le titre + **bande translucide** (événement de fond) qui couvre sa fenêtre (07:45-08:45 pour ±30). Un RDV figé : bloc plein + cadenas. Après consolidation : tout devient plein. `expandAppointmentBlocks` (`planningEvents.js`) produit le bloc et la bande ; le drag manuel d'un bloc adaptable reste possible (comme aujourd'hui) et **fige** l'heure (l'humain a choisi).
- **Barre horaire de l'onglet Tournées** : le bloc à l'heure provisoire + une **glissière** claire sur la fenêtre ; `bornesDeplacement` (déjà écrit) borne le glissement manuel à la fenêtre ∩ voisins.
- **Proposition de créneau (CTA)** : trajet · travail · reste utile (livré) + ligne « rentre si X passe de 14:00 à 14:20 » quand un décalage est nécessaire, avec la souplesse de X rappelée.

## 8. Hors périmètre

- Cascade de décalages (plus d'un voisin déplacé par insertion) — V2 si les cas réels le demandent.
- Consolidation automatique (cron) et SMS automatique la veille — V2, une fois le geste manuel éprouvé.
- Multi-technicien par entretien ; réordonnancement des RDV figés.

## 9. Critères de succès

1. Tests purs : `construireArretsExistants` (fenêtres selon flex), `placerCandidat` (décalage d'un voisin adaptable, jamais d'un figé, jamais deux), pénalité de temps perdu, `sequencerTournee` sur fenêtres (ordre + heures dans les fenêtres, figés immobiles) — `node --test scripts/tournee/*.test.mjs` vert, copies Deno synchronisées.
2. Depuis le CTA, poser un RDV « ±30 » sur une journée où un voisin adaptable doit glisser : les deux RDV ont les bonnes heures en base, le planning montre bloc + bande, le kanban montre « ±30 ».
3. « Figer la journée » sur une journée avec 2 adaptables : heures recalculées dans les fenêtres, `hour_confirmed_at` posé, 2 SMS partis (log `sms_logs`), blocs pleins.
4. Un RDV figé n'est jamais modifié par une insertion ni par une consolidation (test + vérification SQL après scénario).
5. Un RDV existant (avant migration) est adaptable au défaut d'org : sans consolidation ni insertion voisine, aucun changement sur le planning actuel (heures inchangées, blocs habillés « adaptable »).
6. Depuis `EventModal`, passer un RDV en « Figé » puis lancer une insertion ou une consolidation sur sa journée : il n'a pas bougé d'une minute.

## 10. Risques

- **Heure provisoire prise pour définitive** par un utilisateur (ou par le client si on lui lit l'écran) : d'où la bande visible, l'icône ↔, et le texte « vers 08:15 (entre …) » dans la modale de prise.
- **SMS d'heure de passage** : dépend de la tâche SMS (gabarits + onglet Settings) ; sans gabarit, la consolidation fige mais n'envoie rien et le dit (toast explicite, jamais silencieux).
- **Interaction avec Google Calendar** : une consolidation = N mises à jour d'événements ; la sync est fire-and-forget, vérifier qu'elle traite bien les updates en rafale.
- **`sequencerTournee` > 8 arrêts** : heuristique plus-proche-voisin — acceptable (journées Mayer : 3-5 entretiens), à surveiller.

**Souplesse par défaut** : **±30 min** (décision implicite d'Eric 2026-09-12 — « par principe tous les RDV ont une souplesse » ; il fige au cas par cas). Modifiable dans Settings → Tournées.
