# Module Maintenance — tâches récurrentes, borne d'atelier, traçabilité

> Spec validée avec Eric le 2026-09-25 (brainstorming). Premier client : l'usine **Bricafeu**
> (nouvelle organisation sur l'instance Majord'home). Le module est générique : aucune
> donnée ni règle propre à Bricafeu dans le code — « tâche, fréquence, traçabilité » pour
> n'importe quelle structure.

## 1. Besoin

- Une **liste de tâches de maintenance** rattachées à des **unités** (machine, ligne, poste),
  chacune avec une **fréquence**.
- Un **écran en usine** (TV + Raspberry Pi, navigateur plein écran) qui affiche les tâches du
  jour ET sert à les valider (écran d'affichage = écran de saisie).
- **Traçabilité** : qui a fait quoi, quand, avec commentaire. Les tâches sont pour toute
  l'équipe (pas d'affectation) ; l'équipe est restreinte mais on doit pouvoir suivre.
- Un **responsable** paramètre, suit, reçoit un **e-mail chaque soir**, exporte un
  **registre PDF**.

## 2. Décisions (et ce qu'elles écartent)

| Sujet | Décision | Écarté |
|---|---|---|
| Identité de la borne | **Compte Supabase « borne » membre de l'org** (option 1-B, « le plus simple, on évoluera ») | Jeton d'appareil + edge (1-A) — à reprendre dès qu'une org **avec clients** veut une borne ; RPC `anon` (1-C) — refusé |
| Signature | **Prénom choisi dans une liste + PIN 4 chiffres**, commentaire facultatif | Nom seul (déclaratif), anonyme |
| Échéances | **Calculées à la volée** depuis la tâche + le journal (module pur) | Occurrences matérialisées par cron |
| « Pas pu faire » | Commentaire **obligatoire** ; la tâche **revient à J+1** (toutes fréquences) | Rester en retard jusqu'à réalisation |
| Tâches | Pour tout le monde, pas d'affectation | Affectation par personne |
| Expéditeur e-mail | À configurer plus tard : `from_email` de l'org OU expéditeur plateforme `MDH_PLATFORM_FROM_EMAIL` ; ni l'un ni l'autre ⇒ rien ne part, et c'est **affiché** | — |
| Navigation | `settings.modules.crm` (absent ⇒ vrai). `false` masque les menus CRM et fait de `/maintenance` l'accueil | Brancher toute la sidebar sur `modules.js` (hors périmètre) |

### Risque assumé de l'option 1-B et ses garde-fous

Le compte borne voit **tout ce qu'un membre de l'org voit** (les policies RLS existantes
autorisent « tout membre de l'org »). Chez Bricafeu, l'org ne contient que la maintenance :
sans conséquence. Garde-fous :

1. `maint_operators.pin_hash` n'a **aucune policy SELECT** et aucun GRANT sur la colonne pour
   `authenticated` : la vue publique n'expose pas le hash. Un hash de 4 chiffres se casse
   hors ligne en une seconde : il ne doit jamais quitter la base.
2. `maint_task_logs` n'a **aucune policy d'écriture** : une réalisation passe uniquement par
   la RPC `maint_record_completion`, qui vérifie le PIN. Même le compte borne en main, on ne
   signe pas pour un collègue sans son PIN.
3. **Échec fort** : l'écran de création du compte borne refuse si l'org possède au moins un
   client (`majordhome_clients`). Le jour où c'est bloquant → passer à l'option 1-A.

## 3. Modèle de données

Toutes les tables vivent dans `majordhome.*`, `org_id uuid NOT NULL REFERENCES
core.organizations(id)` (org **core**), RLS activée dès la création, vue miroir
`public.majordhome_maint_*` `WITH (security_invoker = true)`, `GRANT SELECT … TO service_role`
(lues par l'edge du soir). Privilèges explicites (`REVOKE ALL … FROM anon, authenticated`
puis GRANT ciblés), comme `20260923_1_invoices_hub.sql`.

### `maint_units`
`id`, `org_id`, `name` (NOT NULL), `description`, `sort_order` int, `archived_at`,
`created_at`, `updated_at`.
RLS : SELECT membre ; INSERT/UPDATE `org_admin`. Pas de DELETE (archivage).

### `maint_tasks`
`id`, `org_id`, `unit_id` (FK `maint_units`, même org — vérifié par trigger), `label`
(NOT NULL), `instructions`, `frequency_kind` ∈ (`weekdays`, `interval`),
`weekdays smallint[]` (ISO 1 = lundi … 7 = dimanche, non vide si `weekdays`),
`interval_unit` ∈ (`day`, `week`, `month`) et `interval_count int ≥ 1` (renseignés si
`interval`), `start_date date NOT NULL DEFAULT (today Paris)`, `sort_order`, `archived_at`,
`created_at`, `updated_at`. CHECK de cohérence entre `frequency_kind` et les colonnes.
RLS : SELECT membre ; INSERT/UPDATE `org_admin`. Pas de DELETE.

### `maint_operators`
`id`, `org_id`, `first_name` (NOT NULL), `active` bool, `pin_hash` (bcrypt pgcrypto),
`failed_attempts` smallint, `locked_until` timestamptz, `sort_order`, `created_at`,
`updated_at`.
RLS : SELECT membre ; INSERT/UPDATE `org_admin`. **La vue publique n'expose pas
`pin_hash`** ; elle expose `has_pin` (booléen). Le PIN s'écrit uniquement par la RPC
`maint_set_operator_pin`.

### `maint_task_logs` — journal append-only
`id`, `org_id`, `task_id`, `unit_id` (dénormalisé pour le filtrage et le registre),
`operator_id`, `status` ∈ (`done`, `not_done`), `comment` (obligatoire si `not_done`),
`due_date date` (échéance visée, telle qu'affichée), `done_at timestamptz DEFAULT now()`,
`recorded_by uuid` (= `auth.uid()` du compte connecté, posé serveur).
RLS : SELECT membre. **Aucune** policy INSERT/UPDATE/DELETE : écriture par RPC uniquement.
Trigger qui refuse UPDATE/DELETE (journal non modifiable, même pour le service role hors
purge d'org).

### `maint_digest_runs`
`org_id`, `day date`, `sent_at`, `provider_id` — PK `(org_id, day)`. Anti-doublon de
l'e-mail du soir. Aucune policy (service role seulement).

### RPC (toutes `SECURITY DEFINER`, `SET search_path`, `REVOKE … FROM PUBLIC, anon`, `auth.uid() IS NULL` refusé en 1ʳᵉ instruction, gardes **positives** `IF (autorisé) IS NOT TRUE`)

- `maint_set_operator_pin(p_operator_id uuid, p_pin text)` — `org_admin` de l'org de
  l'opérateur ; PIN `^\d{4}$` ; remet `failed_attempts`/`locked_until` à zéro.
- `maint_unlock_operator(p_operator_id uuid)` — `org_admin`.
- `maint_record_completion(p_task_id uuid, p_operator_id uuid, p_pin text, p_status text,
  p_comment text, p_due_date date) RETURNS jsonb` — membre de l'org de la tâche ; tâche non
  archivée ; opérateur actif de la même org ; `p_due_date` ≤ aujourd'hui (Paris) et ≥
  `start_date`. **PIN faux ou opérateur bloqué ⇒ `RETURN {ok:false, error, …}` et PAS de
  `RAISE`** : un `RAISE` annulerait l'incrément de `failed_attempts` (la transaction est
  rejouée à blanc) et le blocage ne s'enclencherait jamais. 5 échecs ⇒ bloqué 15 min.
  Succès ⇒ insertion du log, compteur remis à zéro, `RETURN {ok:true, log_id}`.
  Erreurs de contrat (non membre, tâche inconnue, statut invalide, commentaire manquant
  sur `not_done`) ⇒ `RAISE` (rien à conserver).

`p_due_date` vient du client (c'est l'échéance que l'opérateur voyait) : c'est une
information de traçabilité. On la borne côté serveur sans recalculer la règle (une seule
définition de l'échéance : le module pur, § 4).

## 4. Règle d'échéance — `src/lib/maintenance/echeances.js` (module PUR)

Toutes les dates sont des jours calendaires `YYYY-MM-DD` en **Europe/Paris**. Le jour d'un
log = jour Paris de `done_at`.

`prochaineEcheance(tache, dernierLog)` :
- tâche archivée ⇒ `null` (jamais due) ;
- **pas de log** ⇒ `weekdays` : premier jour coché ≥ `start_date` ; `interval` :
  `start_date` ;
- **dernier log `not_done`** ⇒ jour du log + 1 (quelle que soit la fréquence) ;
- **dernier log `done`**, `weekdays` ⇒ premier jour coché ≥ jour du log + 1 ;
- **dernier log `done`**, `interval` ⇒ jour du log + N (jours / semaines / mois ; en mois,
  ancrage fin de mois : 31 janv. + 1 mois = 28/29 févr.) ;
- résultat final = `max(calcul, start_date)` (jamais due avant sa date de début).

« Dernier log » = log le plus récent par `done_at`. Un changement de fréquence s'applique
dès la prochaine échéance, calculée depuis ce dernier log.

`etatDuJour(tache, dernierLog, aujourdhui)` ⇒ `a_venir` (échéance > aujourd'hui),
`a_faire` (= aujourd'hui), `en_retard` avec `joursDeRetard` (< aujourd'hui). Une tâche en
retard n'apparaît qu'**une fois** (pas d'empilement des jours manqués).

`ponctualite(logs)` : parmi les logs `done` d'une période, part de ceux dont le jour ≤
`due_date`. Les `not_done` sont comptés à part.

Ce module est **la seule définition** de « dû / en retard » : borne, suivi, e-mail du soir
(copie synchronisée pour Deno, comme `sync:tournee-engine`) et PDF l'importent.

## 5. La borne — `/maintenance/borne`

- Route plein écran (hors `AppLayout`), accessible à tout membre de l'org dont le module est
  actif ; le compte borne n'a qu'elle (redirection depuis `/`).
- En-tête : nom de l'org (`buildCompanyInfo`), date longue, heure.
- Bandeau **En retard** (ambre), « depuis N jours », dernier commentaire « pas pu faire ».
- **Tâches du jour groupées par unité**, grosses tuiles. Faite aujourd'hui ⇒ tuile grisée
  ✓ + prénom + heure (reste visible). Les tâches à venir ne sont pas affichées.
- Rafraîchissement toutes les 60 s (React Query `refetchInterval`).
- **Valider** (fenêtre en 3 étapes, signature en dernier) :
  1. Fait / Pas pu faire + commentaire (obligatoire pour « pas pu faire ») ;
  2. prénom (grille des opérateurs actifs) ;
  3. PIN (pavé numérique à l'écran) → confirmation « ✓ <tâche> — <prénom>, <heure> ».
  PIN faux ⇒ message + essais restants ; bloqué ⇒ « bloqué jusqu'à HH:MM, voir le
  responsable ». Fermeture automatique après 30 s d'inactivité.
- **Pannes visibles** : hors ligne (`navigator.onLine` + échec de requête) ⇒ bandeau rouge,
  validations désactivées, pas de file d'attente ; session expirée ⇒ écran de connexion.

## 6. Côté responsable

### `/maintenance` (entrée sidebar « Maintenance », module `maintenance` actif)
- **Suivi** (défaut) : retards en cours ; « pas pu faire » des 7 derniers jours ; ponctualité
  du mois par unité. Lien « Ouvrir la borne ».
- **Historique** : journal filtrable (période, unité, tâche, opérateur, statut) ; bouton
  **Exporter le registre PDF** sur ces filtres.
- **Unités & tâches** (`org_admin`) : CRUD + archivage ; formulaire de fréquence (jours
  cochés ou « tous les N jours/semaines/mois ») avec **aperçu de la prochaine échéance**.

Accès : ressource `maintenance` (`view` : suivi + historique ; `edit` : unités & tâches),
`org_admin` en bypass. Défauts : `team_leader` view, autres rôles view (le compte borne est
`member`).

### `/settings/maintenance` (tuile du module « Maintenance » de `modules.js`)
- **Opérateurs** : prénom, actif, définir / réinitialiser le PIN (jamais réaffiché),
  débloquer.
- **E-mail du soir** : activé, destinataires, heure (18 h par défaut) — `settings.maintenance`
  (objet complet sauvé, merge JSONB niveau 1). Bandeau rouge si aucun expéditeur résolu.
- **Borne** : créer le compte borne (e-mail + mot de passe, via `create-user`, rôle
  `member`) ; refusé si l'org a des clients (§ 2). `settings.maintenance.kiosk_user_ids`
  liste les comptes borne (redirection `/` → `/maintenance/borne`).

### Navigation
`settings.modules.crm === false` ⇒ la sidebar ne montre que Maintenance (+ Paramètres),
`/` redirige vers `/maintenance`. Absent ⇒ comportement actuel inchangé (Mayer).

## 7. E-mail du soir — edge `maintenance-digest`

- `verify_jwt:false` + `requireSharedSecret(MDH_CRON_SECRET)` ; appelée **chaque heure** par
  pg_cron (job créé par migration, secret lu dans `vault.secrets`).
- Pour chaque org avec `settings.modules.maintenance === true`,
  `settings.maintenance.digest.enabled === true`, heure Paris courante = heure configurée,
  et pas de ligne `maint_digest_runs (org, jour)` :
  - contenu construit par `digestModel.js` (pur, testé) : réalisé aujourd'hui par unité,
    retards en cours, « pas pu faire » du jour avec commentaires, opérateurs bloqués ;
  - **part même si tout est à jour** (« ✓ Tout est à jour ») : un soir sans e-mail = panne ;
  - expéditeur : `from_email` de l'org, sinon `MDH_PLATFORM_FROM_EMAIL`, sinon
    `skipped: no_sender` dans la réponse ;
  - `maint_digest_runs` inséré **seulement** si Resend répond 2xx (sinon l'heure suivante
    réessaie).
- Réponse JSON `{ sent, skipped: [{org_id, reason}], errors }` — chaque écriture lit son
  `{ error }`.

## 8. Registre PDF

- Point d'entrée unique `registreExport.js`, modèle pur `registreModel.js` (met en forme,
  ne recalcule rien), rendu react-pdf avec le socle `src/lib/pdfShared.jsx` et
  `buildCompanyInfo(settings)`.
- En-tête : org, période, unités filtrées. Par unité : tableau date-heure / tâche / statut /
  opérateur / commentaire. Pied : « N entrées — journal non modifiable — généré le … ».
- Formatters PDF-sûrs (pas de glyphe hors WinAnsi).

## 9. Tests et vérifications

- `node --test` (ajoutés à `audit:quality`) :
  - `scripts/maintenance/echeances.test.mjs` — jours cochés, retard non empilé, intervalles
    jours/semaines/mois (31 → fin de mois), `not_done` ⇒ J+1, `start_date` future, archivée,
    changement de fréquence après logs, bascule heure d'hiver (jour Paris d'un `done_at`
    UTC) ;
  - `ponctualite`, `digestModel`, `registreModel` ;
  - test de synchro de la copie Deno.
- Migration versionnée `supabase/migrations/`, répétée sur `scripts/migration-rehearsal/`.
- Audits post-application : RLS active (5 tables) ; `has_function_privilege('anon', …)` =
  false pour les 3 RPC ; `has_table_privilege('service_role', …, 'SELECT')` ; colonne
  `pin_hash` illisible pour `authenticated`.
- `npx vite build`, `npm run lint`, `npm run audit:quality`.

## 10. Mise en route Bricafeu (hors code, avec Eric)

Créer l'org, `settings.modules = { maintenance: true, crm: false }`, compte `org_admin` du
responsable ; le responsable crée unités, tâches, opérateurs, compte borne ; configuration
de l'expéditeur e-mail.

## 11. Hors V1

Photo jointe, déclenchement au compteur d'heures, affectation, file hors ligne, écran de
veille TV, jeton d'appareil (1-A), branchement complet de la sidebar sur `modules.js`.
