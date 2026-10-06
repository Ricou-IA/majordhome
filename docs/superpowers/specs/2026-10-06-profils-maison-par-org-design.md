# Profils « maison » par organisation — Design

> **Statut** : PRINCIPE VALIDÉ par Eric le 2026-10-06 (« profil maison = modèle standard + cases ») — spec à relire avant le plan d'implémentation
> **Date** : 2026-10-06
> **Contexte déclencheur** : préparation de l'onboarding d'orgs clientes. Chaque entreprise a ses métiers : une secrétaire (cas de Mathis chez Mayer, aujourd'hui « Responsable » faute de mieux), un assistant commercial, un sous-traitant… Les quatre rôles standard ne suffisent pas, et l'écran Droits d'accès ne peut pas en accueillir un cinquième (contrainte CHECK en base).
> **Spec parente** : `2026-06-02-permissions-app-level-canonical-design.md` (droits app-level, livré 2026-09-30) — ce document l'étend, il ne le remplace pas.
> **Mémoire liée** : `project_droits_app_level.md`

## 1. Problème

État mesuré le 2026-10-05 (code + prod) :

1. **Le rôle n'est pas stocké, il est déduit** de trois champs — `core.profiles.app_role`, `core.profiles.business_role`, `core.organization_members.role` — par deux fonctions jumelles, `computeEffectiveRole` (front) et `majordhome.user_effective_role` (DB). `core.profiles` est partagé avec les autres apps de l'instance : on n'y ajoute pas un vocabulaire Majord'home.
2. **Quatre rôles figés** : `EFFECTIVE_ROLES` côté front, CHECK `role IN ('org_admin','team_leader','commercial','technicien')` sur `majordhome.role_permissions`, défauts `app_role_permissions` générés pour trois rôles.
3. **Les rôles sont testés en dur hors de la grille** : 14 fonctions et 3 policies en base, 5 edge functions (`requireOrgMembership({ requiredRole })`), 16 fichiers front (`effectiveRole === 'team_leader'`, `isTeamLeaderOrAbove`, `canAccessPipeline`…). Ces tests gardent des gestes sensibles (avoir, import Pennylane, suppression…).
4. **Le rôle planning** (`majordhome.planning_role_for` → `team_members.role` ∈ admin | commercial | technician) dérive des mêmes trois champs et décide qui est proposé pour quel type de RDV.

Rendre tout cela paramétrable d'un coup = réécrire la sécurité. Hors de question pour une première version.

## 2. Principe retenu

**Un profil maison est un rôle standard habillé.** Il porte un nom propre à l'org (« Secrétaire ») et un **modèle** parmi `team_leader | commercial | technicien`. Partout où le code teste un rôle en dur — base, edge functions, front, planning — c'est le **modèle** qui est vu. Seule la **grille Droits d'accès** distingue le profil maison de son modèle : il y a sa propre colonne, pré-remplie comme le modèle, et chaque case peut en diverger.

Conséquences assumées :
- Une Secrétaire bâtie sur Responsable garde ce que le code réserve aux responsables (avoir, import PL…). Si ce n'est pas voulu, on la bâtit sur Commercial ou Technicien — ou on fait descendre le geste concerné dans la grille (travail au cas par cas, hors de cette spec).
- `org_admin` n'est jamais un modèle : il bypass tout, un « admin restreint » n'a pas de sens dans ce modèle.
- Aucune permission n'est inventée : la grille gouverne exactement les mêmes ressources × actions qu'aujourd'hui (registre `permissionsRegistry.js`).

## 3. Modèle de données (schéma `majordhome`, jamais `core`)

### 3.1 `majordhome.org_roles` — les profils maison d'une org

| colonne | type | règle |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL → `core.organizations` | org CORE (comme `leads`, `role_permissions`) |
| `code` | text NOT NULL | `^[a-z0-9_]+$`, immuable, dérivé du libellé à la création (`secretaire`), **jamais** un des 4 codes standard (CHECK) |
| `label` | text NOT NULL | « Secrétaire », éditable |
| `base_role` | text NOT NULL | CHECK ∈ `team_leader | commercial | technicien` |
| `is_active` | boolean NOT NULL DEFAULT true | désactivation douce (cf. § 6) |
| `created_at`, `updated_at` | timestamptz | |

UNIQUE `(org_id, code)`. RLS : SELECT membre de l'org ; écritures via RPC seulement (org_admin). Vue `public.majordhome_org_roles` (`security_invoker=true`, GRANT SELECT service_role).

### 3.2 `majordhome.member_org_roles` — qui porte quel profil

| colonne | type | règle |
|---|---|---|
| `org_id` | uuid NOT NULL | |
| `user_id` | uuid NOT NULL | membre de l'org (vérifié par la RPC) |
| `org_role_id` | uuid NOT NULL → `org_roles` ON DELETE CASCADE | même org (FK composite `(org_role_id, org_id)`) |

PK `(org_id, user_id)` : **un membre porte au plus un profil maison**. Pas de ligne = rôle standard, comme aujourd'hui. Vue `public.majordhome_member_org_roles` (join libellé + `base_role` + `code`).

**Invariant** : quand un membre porte un profil maison, ses trois champs `core` valent le `ROLE_DB_MAPPING` du **modèle**. C'est ce qui fait que tout le code en dur voit le modèle. La RPC d'assignation (§ 4.2) écrit les deux à la fois ; `team_member_sync_role_for_user` est appelée derrière comme pour tout changement de rôle.

### 3.3 `majordhome.role_permissions` — s'ouvre aux codes maison

- La contrainte CHECK est remplacée par un trigger `role_permissions_check_role` : `role` est l'un des 4 standard **ou** existe dans `org_roles` pour **cette** `org_id`. (Un CHECK ne peut pas lire une autre table ; un FK ne peut pas être conditionnel.)
- `app_role_permissions` (défauts app) ne change pas : les profils maison n'ont pas de défaut propre, ils héritent du modèle (§ 4.1).
- Suppression d'un `org_roles` ⇒ ses lignes `role_permissions` sont purgées par la même RPC (pas de FK possible sur un code texte).

## 4. Résolution d'une permission

### 4.1 Chaîne, côté base comme côté front

```
profil maison du membre ? → surcharge role_permissions(org, code_maison)   si trouvée : verdict
                          ↓ sinon
modèle (rôle standard)    → surcharge role_permissions(org, modèle)        si trouvée : verdict
                          ↓ sinon
                          → défaut app_role_permissions(modèle)             si trouvé : verdict
                          ↓ sinon
                          → refus (fail-closed, inchangé)
```

« Pré-remplie comme le modèle » signifie donc **le modèle tel que configuré dans cette org** (surcharges comprises), pas le défaut app. Décocher une case du modèle plus tard se répercute sur le profil maison tant qu'il n'a pas sa propre surcharge sur cette case — c'est le comportement attendu d'un héritage, et c'est ce que l'éditeur affiche (anneau ambre = surcharge propre au profil).

Implémentation :
- **DB** : `majordhome.user_effective_role(org)` **ne change pas** (retourne toujours le rôle standard — les 14 fonctions et 22 policies qui en dépendent restent valides). Nouvelle fonction `majordhome.user_org_role_code(org) → text|null` (STABLE, SECURITY DEFINER, lit `member_org_roles` × `org_roles.is_active`). `majordhome.role_can` consulte d'abord `role_permissions(org, user_org_role_code)` puis déroule la chaîne existante. Une seule fonction modifiée.
- **Front** : `resolvePermission(role, resource, action, overrides)` (`permissionsRegistry.js`, pur) gagne un paramètre `orgRoleCode` et reproduit la chaîne. `AuthContext` expose `orgRole` (`{ code, label, baseRole } | null`) à côté d'`effectiveRole`, qui **reste le rôle standard**. Aucun des 16 fichiers qui testent `effectiveRole` n'est touché.
- **Test de cohérence** `scripts/permissions-coherence.mjs` : vérifie que `role_can` et `resolvePermission` donnent le même verdict pour un membre portant un profil maison (impersonation sur le harnais).

### 4.2 RPC (toutes SECURITY DEFINER, `REVOKE FROM PUBLIC, anon`, garde `IF (caller est org_admin de p_org_id) IS NOT TRUE THEN refuser`)

| RPC | rôle |
|---|---|
| `org_role_create(p_org_id, p_label, p_base_role) → org_roles` | code dérivé du libellé (translit + `_`, suffixe numérique si pris), refuse un code standard |
| `org_role_update(p_org_role_id, p_label, p_is_active)` | libellé et activation ; **pas** de changement de modèle (voir § 7) |
| `org_role_delete(p_org_role_id) → { members_reset }` | purge `role_permissions` du code, CASCADE `member_org_roles` ; les membres retombent sur le modèle (leurs champs `core` le portent déjà) |
| `member_set_org_role(p_org_id, p_user_id, p_org_role_id | null)` | écrit `member_org_roles` **et** réaligne les champs `core` sur le modèle (même écriture que `updateMemberRole`), puis `team_member_sync_role_for_user` ; `null` = retour à un rôle standard (la ligne est supprimée, le rôle standard est posé par l'appelant comme aujourd'hui) |
| `org_upsert_role_permission` (existante) | inchangée : le trigger § 3.3 accepte désormais un code maison de l'org |

## 5. Écrans

### 5.1 Droits d'accès (`PermissionsEditor.jsx`)

- Colonnes = Responsable, Commercial, Technicien **+ une colonne par profil maison actif**, en-tête « Secrétaire · *d'après Responsable* ».
- Bouton **(+) Ajouter un profil** en tête de grille → modale : libellé (obligatoire) + modèle (radio, 3 choix, Responsable présélectionné). À la création, la colonne apparaît avec les valeurs héritées (aucune surcharge, aucun anneau ambre).
- Menu `…` sur l'en-tête : Renommer · Désactiver/Réactiver · Supprimer (ConfirmDialog destructive avec le nombre de membres concernés et la phrase « ils reprendront les droits du modèle »).
- Une case d'un profil maison se coche/décoche comme les autres (`org_upsert_role_permission`). « Réinitialiser » sur une case = supprimer sa surcharge → retour à l'héritage (geste déjà existant pour les standards ? à vérifier ; sinon à ajouter pour les deux).

### 5.2 Gestion de l'équipe (`TeamManagement.jsx`)

- « Rôle actuel » : badge au libellé du profil maison, sous-ligne « d'après Responsable ».
- « Changer le rôle » : les 4 standard puis un séparateur puis les profils maison actifs de l'org. Choisir un profil maison → `member_set_org_role` ; choisir un standard → `member_set_org_role(null)` puis `updateMemberRole` comme aujourd'hui. Même ConfirmDialog.
- Modale « Inviter un membre » : même liste.
- Colonne « Commercial — Assignable aux leads » (livrée le 2026-10-05, `commercial_set_for_user`) : **indépendante du profil**, se règle par personne.

### 5.3 Hors périmètre V1

- Édition par profil maison des gestes testés en dur (§ 1.3) : ils suivent le modèle.
- Changement de modèle d'un profil existant (§ 7).
- Profils maison partagés entre orgs, catalogue de profils « métier » proposés à l'onboarding : plus tard, à partir de ce que les clientes créeront vraiment.

## 6. Désactivation vs suppression

- **Désactiver** : le profil disparaît des menus et de la grille, les membres qui le portent **conservent** leur assignation mais `user_org_role_code` renvoie `null` tant qu'il est inactif → ils agissent comme leur modèle. Réactiver restaure tout. Geste réversible, recommandé.
- **Supprimer** : purge définitive (surcharges + assignations), irréversible, org_admin seul, confirmé avec décompte.

## 7. Changement de modèle — pourquoi non

Changer `base_role` réécrit les champs `core` de tous les porteurs (donc leur rôle planning, leurs gestes sensibles) et change la lecture de toutes leurs surcharges : trop de conséquences implicites pour un menu déroulant. Si un profil est mal bâti : en créer un autre, réassigner, supprimer l'ancien. Les surcharges ne sont pas copiées — c'est volontaire, on repart du bon modèle.

## 8. Sécurité — points de contrôle (charte multi-tenant)

- Tables `org_roles`, `member_org_roles` : RLS activée à la création, SELECT membre de l'org (`org_id IN (org_members)`), aucune policy d'écriture (RPC seulement), `GRANT SELECT TO service_role` (vues `security_invoker`).
- Toutes les RPC : `REVOKE ALL FROM PUBLIC, anon` vérifié par `has_function_privilege` sur le harnais ; garde positive `IS NOT TRUE` ; `p_org_id` toujours recoupé avec la membership de `auth.uid()` (jamais pris pour argent comptant).
- Trigger `role_permissions_check_role` : refuse un code maison d'une **autre** org (sinon un admin pourrait poser des surcharges sur un code qui n'existe que chez le voisin — sans effet, mais sale).
- `role_can` : le code maison est lu via `auth.uid()` (jamais passé en paramètre).
- Harnais : `role_permissions`, `app_role_permissions`, `team_members` sont déjà dans `POLICY_TABLES` ; ajouter les 2 tables, les vues, les RPC et `role_can` au `snapshot.mjs`. Assertions par impersonation : membre maison bâti sur Technicien avec `pipeline.view` coché → `role_can('pipeline','view')` = true ET `user_effective_role` = `'technicien'` ; même membre après désactivation du profil → false.

## 9. Découpage de livraison

1. **Tranche 1 — base** : tables, vues, trigger, 4 RPC, `user_org_role_code`, `role_can` modifiée, harnais + assertions, `permissions-coherence.mjs` étendu. Livrable seul : rien ne change à l'écran tant qu'aucun profil n'existe.
2. **Tranche 2 — front** : `resolvePermission` + `AuthContext.orgRole`, colonne + (+) dans Droits d'accès, menu dans Équipe et Invitation, service/hook (`orgRoles.service.js`, `useOrgRoles`, clés `orgRoleKeys` dans `cacheKeys.js`).
3. **Tranche 3 — Mayer** : créer « Secrétaire » (modèle Responsable), l'affecter à Mathis, régler ses cases avec Eric. Mesure : `scripts/permissions-coherence.mjs --env .env.local` vert.

## 10. Questions ouvertes (à trancher avant la tranche 2)

1. Mot à l'écran : « Profil » (recommandé, c'est le mot d'Eric) — en sachant que `core.profiles` s'appelle déjà ainsi côté code ; le code dira `org_role`.
2. Un profil maison doit-il pouvoir être bâti sur Responsable ? Oui (c'est le cas Secrétaire), mais c'est le modèle le plus « puissant » hors grille : afficher dans la modale de création la liste des gestes que le modèle emporte (« Responsable : avoirs, import Pennylane, … ») pour que l'admin choisisse en connaissance.
3. Faut-il un « Réinitialiser au modèle » global par colonne ? Probablement oui, peu coûteux (DELETE des surcharges du code).
