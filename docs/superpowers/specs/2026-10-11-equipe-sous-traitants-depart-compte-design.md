# Équipe — sous-traitants à missions, départ d'un membre, onglets Compte et Agenda Google

> Date : 2026-10-11 · Statut : spec validée en conversation avec Eric, à relire avant plan
> Contexte : suite de la refonte de Settings → Équipe (synthèse + fiche membre en modale, commits `f32f0d9`, `f2a7294`).

## 1. Problème

Eric (2026-10-10/11) :

> « Mohammed est un sous-traitant, je dois pouvoir le programmer mais ce n'est pas une personne qui est à 100 % dans l'équipe et donc l'avoir tout le temps en dispo est un peu lourd, mais en même temps je dois pouvoir l'activer facilement. »
> « Il faut aussi prévoir la période d'activité. Même hors activité on garde l'historique des RDV. »
> « Oui, connexion perdue [à la fin de la période]. »
> « Il faut ajouter un onglet de paramétrage avec la gestion des mots de passe etc. et aussi un connecteur pour synchroniser l'agenda vers son Google perso s'il veut, Majord'home → Google (pas l'inverse). »

Deux situations distinctes, à ne pas confondre :

| Situation | Exemple | Ce qu'il faut |
|---|---|---|
| **Sous-traitant** | Mohammed | Invisible par défaut ; visible pendant ses **missions datées**, activées en deux clics ; garde son compte entre deux missions |
| **Départ** | un salarié qui quitte l'entreprise | Date de sortie ; **connexion coupée** le lendemain ; historique intact |

Vocabulaire imposé par Eric : **« sous-traitant »** (pas « renfort »).

## 2. Constats qui orientent le design (mesurés en prod le 2026-10-11)

- `majordhome.team_members.is_active` existe (8 lignes, toutes `true`) et `appointmentsService.getTeamMembers` filtre `is_active = true`. **Désactiver un membre tel quel ferait perdre à ses anciens RDV leur couleur et leur nom** (la résolution couleur de `planningEvents.js` part de cette liste) → contraire à « on garde l'historique ».
- Sur 243 policies RLS qui citent `core.organization_members`, **227 ne regardent pas `status`** : passer une adhésion en `status='disabled'` ne couperait pas l'accès aux données.
- **Aucune FK ne référence `core.organization_members`** : supprimer une adhésion ne déclenche aucune cascade.
- 12 policies passent par `core.profiles.org_id` sans adhésion ; toutes portent sur des tables `core` d'autres applications de l'instance (`intervenants`, `projet_intervenants`, bucket `project-recordings`, `org_invitations`, `role_changes_log`).
- Trigger `core.sync_profile_org_membership` (AFTER INSERT OR UPDATE OF org_id ON core.profiles) : ne fait **rien** quand `org_id` passe à NULL ; quand `org_id` est reposé, il **réinsère** l'adhésion avec `role = COALESCE(app_role,'member')`, `status='active'`.
- Bannir le compte `auth.users` (ban Supabase) est **exclu** : l'instance est partagée avec d'autres applications.
- Le connecteur Google Calendar existe (edges `google-calendar-auth` / `google-calendar-sync`, sens unique Majord'home → Google). Il est **par personne** : l'OAuth Google exige que la personne autorise elle-même ; un admin ne peut pas brancher le Google d'un autre. L'action `status` de l'edge teste réellement le refresh token (`needs_reconnect`).
- `client-change-password` est l'edge du portail client, pas des membres. Chacun change déjà son propre mot de passe depuis Profil ; `/reset-password` existe (`authService` → `resetPasswordForEmail`).

## 3. Tranche 1 — Sous-traitants et missions

### 3.1 Données (migration `20261011_1_team_member_missions`)

- `majordhome.team_members.is_subcontractor boolean NOT NULL DEFAULT false`.
- Table `majordhome.team_member_missions` :
  - `id uuid pk`, `org_id uuid NOT NULL` (org **majordhome**, comme `team_members.org_id`), `team_member_id uuid NOT NULL` (FK composite même org vers `team_members`, `ON DELETE CASCADE`), `date_from date NOT NULL`, `date_to date NOT NULL`, `note text NULL`, `created_by uuid`, `created_at`, `updated_at`.
  - `CHECK (date_to >= date_from)`. **Pas deux missions qui se chevauchent pour un même membre** : garde dans la RPC d'écriture (pas de contrainte d'exclusion, qui exigerait l'extension `btree_gist`).
  - RLS activée ; `SELECT` = membres de l'org (via bridge `majordhome.organizations.core_org_id` → `core.organization_members`) ; **aucune policy d'écriture** (écritures par RPC).
  - Vue `public.majordhome_team_member_missions` `WITH (security_invoker=true)` + `GRANT SELECT ON majordhome.team_member_missions TO service_role`.
- RPC `public.team_member_mission_upsert(p_mission_id uuid NULL, p_team_member_id uuid, p_date_from date, p_date_to date, p_note text)` et `public.team_member_mission_delete(p_mission_id uuid)` :
  - SECURITY DEFINER, `SET search_path = majordhome, core, public`, `REVOKE ALL … FROM PUBLIC, anon` puis `GRANT EXECUTE TO authenticated`.
  - Garde **positive** : `IF auth.uid() IS NULL THEN refuser` ; autorisé si le rôle d'adhésion dans l'org core du membre ∈ (`org_admin`, `team_leader`) — `IF (autorisé) IS NOT TRUE THEN RAISE '42501'`.
  - Refuse (`22023`) un membre qui n'est pas sous-traitant, des dates inversées, un chevauchement.
- Nouvelle RPC `public.team_member_set_subcontractor(p_team_member_id uuid, p_is_subcontractor boolean)` (SECURITY DEFINER, org_admin, `REVOKE FROM PUBLIC, anon`) : passer **sous-traitant ⇒ `include_in_routing = false`** dans la même transaction (un sous-traitant n'est jamais proposé par la machine). Revenir salarié ne remet pas `include_in_routing` à vrai tout seul.
- Ajouter la table et la vue au harnais `scripts/migration-rehearsal/snapshot.mjs` ; répéter la migration avant prod.

### 3.2 Règle de visibilité — module pur `src/lib/teamVisibility.js`

Source **unique** de « qui peut-on choisir ce jour-là ». Testé `node --test scripts/team-visibility.test.mjs` (ajouté à `audit:quality`).

```
membreChoisissableLe(membre, dateISO, { missions, departs }) → boolean
  - parti (left_on < date)                → false
  - salarié                               → true
  - sous-traitant                         → une mission couvre date
membreVisibleLe(membre, dateISO, ctx, { aUnRdvCeJour }) → choisissable OU aUnRdvCeJour
membresVisiblesSurPeriode(membres, debut, fin, ctx, rdvs) → membres visibles au moins un jour de la plage
```

- **Un RDV existant rend toujours sa personne visible** ce jour-là, quel que soit son statut (historique, RDV d'un sous-traitant hors mission, RDV d'un parti).
- Les dates sont des dates calendaires `YYYY-MM-DD` (fuseau Europe/Paris), jamais des `Date` UTC.

### 3.3 Chargement des membres

- `appointmentsService.getTeamMembers` **ne filtre plus `is_active`** : il rend tout le monde (salariés, sous-traitants, partis), avec les missions (2ᵉ requête sur `majordhome_team_member_missions`, mergée en mémoire — même pattern que `getTeamDayAvailability`). La résolution couleur / nom de l'historique (`planningEvents.js`) continue d'utiliser **la liste complète**.
- Les écrans qui **proposent une personne** filtrent via `teamVisibility.js` ; aucun écran ne recopie la règle.

### 3.4 Consommateurs à brancher (filtre « choisissable »)

| Écran | Ce qui change |
|---|---|
| `pages/Planning.jsx` | colonnes et chips de filtre : membres visibles sur la plage affichée |
| `planning/scheduling/SchedulingAssistant.jsx` | colonnes : membres choisissables sur le jour de la colonne |
| `planning/EventFormSections.jsx` → `SectionAssignee` | liste : choisissables à la date du RDV + la (les) personne(s) déjà assignée(s) |
| `chantiers/ChantierModal.jsx`, `entretiens/EntretienSAVModal.jsx`, `entretiens/SchedulingTransitionModal.jsx` | idem, à la date planifiée |
| `CertificatWizard.jsx`, `ClientDetail.jsx`, `PhoningScreenPop.jsx` | **à auditer** : s'ils affichent un nom (historique) → liste complète ; s'ils proposent un choix → filtre |
| Moteur de tournées `src/lib/tournee/loaders.js` | déjà filtré par `include_in_routing` ; ajouter l'exclusion des partis (`left_on`) en tranche 2. Toute modif ⇒ `npm run sync:tournee-engine` + redéploiement `slots-propose`, `tournees-figer`, `auto-rdv` |

### 3.5 UI

- **Barre du Planning** : bouton « Sous-traitants » (visible `org_admin` / `team_leader`) → panneau listant chaque sous-traitant, ses missions à venir et en cours, « + Mission » (du / au, défaut = semaine affichée), modifier / supprimer. Une pastille indique combien sont en mission sur la plage affichée.
- **Fiche membre** : case « Sous-traitant » dans l'onglet Profil & planning (le libellé « À la main (sous-traitant ponctuel) » du sélecteur Planification devient « À la main ») ; nouvel onglet **Disponibilité** = la même liste de missions que le panneau du Planning (composant partagé `MissionsEditor`), plus la date de sortie (tranche 2).
- **Synthèse Équipe** : tag « Sous-traitant » sous le rôle ; colonne Planification affiche « En mission jusqu'au 18/10 » / « Prochaine mission 14/10 » / « En réserve ».

## 4. Tranche 2 — Départ et coupure d'accès

### 4.1 Données (migration `20261011_2_member_departure`)

- `majordhome.team_members` : `left_on date NULL` (dernier jour travaillé), `access_revoked_at timestamptz NULL`, `revoked_membership_role text NULL` (photo du rôle d'adhésion au moment de la coupure, pour le restaurer).
- RPC `public.member_set_departure(p_core_org_id uuid, p_user_id uuid, p_left_on date NULL)` — SECURITY DEFINER, `REVOKE FROM PUBLIC, anon`, org_admin seul (garde positive), refuse sur soi-même (`42501`) et sur le dernier `org_admin` de l'org :
  - pose `left_on` ;
  - si `p_left_on < current_date` (Europe/Paris) → coupe tout de suite (cf. 4.2) ;
  - si `p_left_on` NULL ou ≥ aujourd'hui et accès coupé → **rétablit** (cf. 4.3).
- Fonction `majordhome.apply_member_departures()` (service_role) + job pg_cron quotidien `member-departures` à 00:10 Europe/Paris : coupe les accès des `left_on < current_date` non encore coupés. La fonction renvoie le nombre d'accès coupés ; la trace est `cron.job_run_details` (ce n'est pas un cron de planification, il n'écrit pas `planification_runs`). Vérifier après livraison avec `SELECT jobname, schedule FROM cron.job`.

### 4.2 Coupure (transactionnelle)

1. `revoked_membership_role` ← rôle actuel dans `core.organization_members` ;
2. `DELETE FROM core.organization_members WHERE user_id = … AND org_id = core_org` → toutes les policies Majord'home perdent la personne immédiatement (le JWT reste valide jusqu'à expiration mais chaque requête est refusée) ;
3. `UPDATE core.profiles SET org_id = NULL WHERE id = … AND org_id = core_org` (seulement si c'est cette org) → coupe aussi les 12 policies `core` par `profiles.org_id` ;
4. `access_revoked_at = now()`.
`commercials.is_active = false` pour ce profil (il sort de la liste « Commercial assigné », ses leads gardent leur commercial).
Ne touche **jamais** : `team_members` (ligne conservée), `appointments`, `appointment_technicians`, certificats, `audit_log`, `profiles` (nom conservé pour les résolveurs).

### 4.3 Rétablissement

`UPDATE core.profiles SET org_id = core_org` → le trigger réinsère l'adhésion (`status='active'`, rôle = `app_role`) ; puis réaligner `role` sur `revoked_membership_role` (même pattern que `create-user`) ; vider `access_revoked_at` / `revoked_membership_role`. La ligne `commercials` n'est pas réactivée automatiquement (geste explicite dans la fiche).

### 4.4 Point à vérifier sur le harnais AVANT la prod

- Que la suppression d'adhésion ne casse rien d'autre (vues `organization_members`, `useOrgMembers`, résolveurs d'audit, `useAuditResolvers`, edges qui joignent l'adhésion pour un nom).
- Que le front d'un utilisateur coupé tombe proprement sur l'écran « pas d'organisation » (`getUserOrganization` → `organization: null`).
- **Si un effet de bord apparaît, on s'arrête et on revient vers Eric** avec une autre voie (ex. ajout de `status='active'` dans `core.is_org_member` + les helpers RLS), sans forcer.

### 4.5 UI

- Onglet **Disponibilité** de la fiche : « Date de sortie » (facultative) + état (« Accès coupé depuis le 12/10 », bouton « Rétablir l'accès »). Confirmation `ConfirmDialog` avant une coupure immédiate.
- La synthèse Équipe liste les membres actifs (adhésion présente) ; une section repliée **« Anciens membres »** liste les `team_members` partis (nom, date de sortie, bouton ouvrir la fiche en lecture + rétablir). Sans elle, un parti disparaîtrait de l'écran avec son adhésion.

## 5. Tranche 3 — Onglets Compte et Agenda Google

### 5.1 Compte

- **Envoyer un lien de réinitialisation** à l'e-mail du membre : `authService.resetPassword(email)` existant (`/reset-password`). Rien côté serveur.
- **Définir un mot de passe provisoire** : nouvelle edge `member-set-password` (`verify_jwt:true`, `requireOrgMembership(req, { orgId, requiredRole: 'org_admin' })`), vérifie que la cible est membre **de la même org**, refuse la cible = soi (géré depuis Profil), `auth.admin.updateUserById(userId, { password })`, ≥ 8 caractères, lit `{ error }`, réponse 5xx explicite. Entrée `supabase/config.toml`.
- **Dernière connexion** : même edge, action `info` → `last_sign_in_at`, `created_at`, `email_confirmed_at` via `auth.admin.getUserById` (jamais `listUsers`, qui répond 500 sur l'instance partagée).

### 5.2 Agenda Google

- Edge `google-calendar-auth` : actions `status` et `disconnect` acceptent un `user_id` cible **si** l'appelant est `org_admin` de l'org et la cible membre de cette org ; sans `user_id`, comportement inchangé (soi-même).
- Onglet : état (non connecté / connecté avec `google_email` depuis `connected_at` / **à reconnecter**). Sa propre fiche → bouton « Connecter » (flux existant). Fiche d'un autre → « Copier le lien » vers `/profile` + une phrase de marche à suivre, et « Déconnecter » (admin). Le sens unique Majord'home → Google est rappelé à l'écran.

## 6. Hors périmètre

- Plusieurs périodes d'emploi pour un salarié (saisonniers récurrents) : les missions couvrent le cas sous-traitant ; un salarié saisonnier = rétablir l'accès.
- Suppression définitive d'un compte.
- Sync Google → Majord'home.
- Proposition des sous-traitants par la machine pendant une mission (ils restent « à la main »).

## 7. Vérification

- `node --test scripts/team-visibility.test.mjs` (règles, bords de mission, parti, RDV existant).
- Migrations répétées sur `scripts/migration-rehearsal/` ; audit `has_function_privilege('anon', …)` = false pour chaque RPC ; `has_table_privilege('service_role', 'majordhome.team_member_missions', 'SELECT')` = true.
- Tranche 2 : impersonation sur le harnais (utilisateur coupé → 0 ligne lue sur `majordhome_clients`, `majordhome_appointments` ; rétabli → lignes revenues).
- `npx vite build`, `npm run lint`, `npm run audit:quality`.
- Recette Eric : Mohammed invisible hors mission, visible pendant, ses RDV passés toujours colorés ; départ d'un compte de test.
