# Défigeage d'une journée de technicien — design

> 2026-10-16 · décidé avec Eric · module Tournées (`docs/MODULE_TOURNEES.md`)
> Prérequis : figeage (spec 2026-09-12, `majordhome.figer_journee`, migration `20260930_1`),
> départ / retour (`20261014_2`).

## 1. Intention

Le figeage est un **état intermédiaire de la journée**, pas une heure gravée (Eric, 2026-10-16) :

- il se pose **dès que la journée est pleine** (cron `tournees-figer` ou bouton « Figer la journée ») ;
- il **retire la journée du choix** (auto-RDV, agent téléphonique, propositions de créneaux —
  `journeesProposables` et les RPC `auto_rdv_poser` / `agent_creneaux` sautent `figee_at`) et sert
  de point d'arbitrage d'une journée trop pleine ;
- **jusqu'à la veille il est réversible** : une annulation ou une modification doit rendre la
  journée au circuit normal pour regarnir le trou ;
- **la veille, c'est définitif** (à terme : heure exacte communiquée la veille).

Promesse au client : **on propose un créneau et on s'y tient** ; l'heure exacte ne vient qu'à la fin.

Bug corrigé : aujourd'hui, supprimer / annuler / déplacer un RDV d'une journée figée laisse la trace
`journees_secteur.figee_at` en place. La journée reste « figée » (puce Planning), exclue de
l'auto-RDV, et le trou n'est jamais regarni. Cas observé en prod : Antoine, 16/10, un RDV annulé
sur une journée restée figée.

## 2. Règle

### 2.1 Déclencheurs — un RDV QUITTE sa journée d'origine (technicien × date)

| Geste | Journée(s) d'origine |
|---|---|
| Suppression du RDV | (date, chaque technicien du RDV) |
| Passage du statut à `cancelled` | idem |
| Changement de `scheduled_date` | (ancienne date, chaque technicien) |
| Changement de `scheduled_start` (même jour) | (date, chaque technicien) |
| Retrait d'un technicien du RDV (`appointment_technicians` DELETE, RDV toujours là) | (date, technicien retiré) |

Tous types de RDV (une installation retirée libère aussi de la place). Toutes les voies d'écriture
sont couvertes (drag Planning, EventModal, Reprogrammer, annulation, `deleteAppointment`,
déplanification d'entretien, RPC serveur) puisque la règle vit en base.

**Ne déclenchent rien** :
- l'écriture du figeage lui-même (`figer_journee` modifie heures et durées) ;
- une écriture qui ne touche ni date, ni heure de début, ni technicien, ni statut→`cancelled`
  (note, objet, durée seule, adresse…) ;
- l'**arrivée** d'un RDV dans une journée (ajout de technicien, nouvelle date) — rien à défiger ;
- toute journée d'origine **à moins de J+2** (aujourd'hui ou demain, heure de Paris) :
  « une annulation la veille au soir ou le jour même, on laisse la journée telle qu'elle »
  (Eric). Même borne que le cron qui fige « à partir de demain ».

### 2.2 Défiger une journée (technicien × date, date ≥ J+2, trace présente)

1. **Trace retirée** : `journees_secteur.figee_at = NULL`, `figee_par = NULL` (la ligne reste :
   elle porte l'étiquette de secteur). La journée redevient ouverte / pleine selon le moteur ;
   l'auto-RDV peut de nouveau y proposer ; le cron la refigera si elle redevient pleine.
2. **RDV restants verrouillés par le figeage** (marqueur §3) : `hour_confirmed_at = NULL`,
   `time_flex_minutes = NULL` (= souplesse par défaut de l'org, 30 min aujourd'hui), marqueur
   remis à faux. `announced_start` **inchangé** : c'est l'ancre de leur créneau. Le moteur peut
   combler le trou en les décalant dans leur fenêtre ; en pratique l'ordre ne change pas.
3. **RDV verrouillés à la main** (geste explicite, EventModal « heure figée ») : **inchangés**, 🔒 conservé.

Le SMS « heure de passage » (`figer_sms`) est OFF : aucune heure n'a été communiquée par le
figeage. S'il est activé un jour, la règle est à revoir (cf. §6) — un client défigé pourrait
avoir reçu une heure.

### 2.3 Le RDV qui part

- Il **perd son verrou de figeage** s'il quitte sa journée (date ou technicien) — quelle que soit
  la date d'origine : il arrive dans sa nouvelle journée comme n'importe quel RDV posé, avec un
  créneau ajustable ; si celle-ci est pleine, elle se figera par le circuit normal.
- Changement d'heure seul : il suit le sort de sa journée (défigée à J+2 et plus → libéré ;
  veille / jour même → inchangé, comme le reste de la journée).
- Verrou manuel : conservé dans tous les cas.

## 3. Reconnaître un verrou « posé par le figeage »

Piège mesuré en prod (2026-10-16) : `hour_confirmed_at = journees_secteur.figee_at` **ne suffit
pas**. Une journée refigée réécrit `figee_at` ; les RDV verrouillés au premier figeage gardent
l'ancien instant. Sur 15 RDV verrouillés des 6 journées figées, 6 avaient un instant ≠ `figee_at`,
dont 5 posés par `tournees_figer_journee` selon `audit_log` (Antoine 16/10 : figé le 21/09,
refigé le 13/10).

→ **Nouvelle colonne** `majordhome.appointments.hour_locked_by_figeage boolean NOT NULL DEFAULT false`.
- `figer_journee` la pose à `true` en même temps que `hour_confirmed_at`.
- Toute autre écriture de `hour_confirmed_at` (pose manuelle, retrait) la remet à `false`
  (trigger BEFORE UPDATE, hors figeage) — le front n'a pas à la connaître.
- **Reprise** : `true` pour les RDV dont `hour_confirmed_at` non NULL correspond à une ligne
  `audit_log` (table `appointments`, `changed_fields` contient `hour_confirmed_at`, `source LIKE
  'tournees_figer_journee%'`, `new_values->>'hour_confirmed_at'` = valeur actuelle). Origine
  inconnue (ex. RDV verrouillé le 15/09, avant le Mouchard) → reste `false` (verrou manuel, par
  prudence).
- Pas d'exposition dans la vue `majordhome_appointments` (inutile au front aujourd'hui ; éviter de
  toucher la vue miroir).

## 4. Mise en œuvre (choix techniques — appel du builder sauf mention)

- **En base, par trigger**, pas côté front (décision : couvre toutes les voies).
  - `appointments` BEFORE UPDATE OF `scheduled_date, scheduled_start, status, hour_confirmed_at` :
    marqueur (§3), libération du RDV qui part (§2.3), puis défigeage des journées d'origine (§2.2).
  - `appointments` BEFORE DELETE : défigeage des journées d'origine (les liens techniciens
    existent encore en BEFORE ; la cascade les supprime ensuite).
  - `appointment_technicians` AFTER DELETE : défigeage de (date du RDV, technicien retiré) si le
    RDV existe encore (sinon c'est la cascade d'une suppression, déjà traitée).
  - Le défigeage lui-même n'écrit que `hour_confirmed_at` / `time_flex_minutes` / marqueur sur les
    voisins → ne se redéclenche pas.
- **Garde figeage** : `figer_journee` pose `set_config('majordhome.figeage_en_cours', 'on', true)`
  au début et le remet à `''` à la fin ; les triggers ne défigent rien quand il vaut `'on'`.
  Sans cela, une journée refigée défigerait ses propres RDV déjà verrouillés.
- **Org** : `appointments.org_id` = org majordhome, `journees_secteur.org_id` = org CORE
  (`majordhome.organizations.core_org_id`).
- **« Aujourd'hui »** = `(now() AT TIME ZONE 'Europe/Paris')::date` ; défiger ssi
  `date_origine >= aujourd'hui + 2`.
- Fonctions trigger `SECURITY DEFINER`, `SET search_path = majordhome, public`, `REVOKE EXECUTE
  FROM PUBLIC, anon, authenticated` (fonctions trigger, jamais appelées directement). Le trigger
  d'audit Mouchard trace les écritures sur les voisins (source = requête d'origine).
- **Migration** `supabase/migrations/20261016_1_defigeage_journee.sql` : colonne + reprise +
  `CREATE OR REPLACE majordhome.figer_journee` (identique + marqueur + garde) + triggers.
  Répétée sur `scripts/migration-rehearsal/` (ajouter `majordhome.figer_journee` à `FUNCTIONS`
  de `snapshot.mjs`, et `majordhome.appointments` si besoin à `TRIGGER_TABLES`) avec
  `assert-defigeage-journee.sql`.
- **Front** : aucune logique nouvelle. Vérifier que les mutations de RDV invalident
  `tourneeKeys.all(orgId)` (puce d'état de la journée) — `useAppointments` le fait déjà à un
  endroit ; étendre aux mutations update / delete / annulation si elles ne le font pas.
- **Moteur / edges** : aucun changement attendu (`etatJournee`, `journeesProposables` lisent déjà
  `figee_at`) → pas de `sync:tournee-engine` ni de redéploiement, sauf si l'implémentation en
  découvre le besoin.

## 5. Vérification (critère « fait »)

Assertions de répétition (fixtures créées dans le script : org, 2 techniciens, journée à J+5
figée via `figer_journee`, 3 RDV dont 1 verrouillé à la main, + une journée figée à J+1) :
1. Supprimer un RDV de la journée J+5 ⇒ trace retirée ; RDV restants verrouillés par le figeage
   ⇒ `hour_confirmed_at` / `time_flex_minutes` NULL, `announced_start` inchangé ; RDV manuel inchangé.
2. Annuler (statut `cancelled`) ⇒ idem.
3. Déplacer à une autre date ⇒ journée d'origine défigée ; le RDV déplacé n'est plus verrouillé ;
   journée d'arrivée inchangée (figée si elle l'était).
4. Changer de technicien ⇒ journée de l'ancien technicien défigée.
5. Changer l'heure seule ⇒ journée défigée.
6. Modifier une note / l'objet ⇒ rien.
7. Même geste sur la journée J+1 ⇒ rien (trace et verrous intacts).
8. `figer_journee` sur une journée déjà figée (refigeage) ⇒ ne défige rien, verrous antérieurs intacts.
9. Pose manuelle de `hour_confirmed_at` ⇒ marqueur faux ; RDV figé par `figer_journee` ⇒ vrai.
10. Privilèges : `anon` / `authenticated` n'exécutent pas les fonctions trigger.

Puis prod : migration appliquée, reprise contrôlée (compte des marqueurs = attendu), `npx vite
build` et `npm run audit:quality` verts, commit + push `main`, Vercel READY.

## 6. Hors périmètre / suites

- **Heure exacte la veille** (Eric : « on précise l'heure exacte la veille ») : aujourd'hui le
  figeage pose l'heure définitive dès que la journée est pleine. Distinguer « journée retirée du
  choix » (dès pleine) et « heure communiquée » (la veille) est un chantier à part, avec la
  réactivation du SMS `heure_de_passage`.
- Dérive du créneau : le figeage a réécrit `announced_start` (≤ 30 min de décalage) ; on recentre
  le créneau sur cette heure, sans reconstituer l'heure annoncée d'origine (dérive possible ≤ 1 h
  après un cycle figé → défigé). Accepté pour l'instant.
- Changement de durée seule (sans heure) : ne défige pas.
- Journées déjà figées ayant perdu un RDV avant la livraison : aucune n'est à J+2 ou plus au
  2026-10-16 (seul cas : Antoine, 16/10, jour même) → pas de reprise de défigeage.
