# Modèle de droits canonical, niveau App — Design

> **Statut** : DESIGN VALIDÉ (4 décisions actées 2026-06-02) — prêt pour le plan d'implémentation quand le job est lancé
> **Date** : 2026-06-02
> **Contexte déclencheur** : bug RLS équipements/interventions (membre non-admin voyait 0 donnée) — corrigé en Couche 1 (migration `member_read_equipment_interventions_rls`). Ce spec couvre le job complet « droits app-level » différé par Eric.
> **Mémoire liée** : `project_droits_app_level.md`, `project_apps_cohabitantes.md`

## 1. Problème

Trois constats issus de l'investigation (2026-06-01 → 02) :

1. **Trois couches déconnectées.** L'écran « Droits d'accès » (`PermissionsEditor.jsx` → `role_permissions`) pilote uniquement `can()` côté front. La RLS (DB) est une barrière séparée, role-based en dur, qui **ne consulte pas** `role_permissions` (vérifié : aucune policy ni fonction sauf `org_seed_permissions` ne la référence). La vue Kanban Entretien filtre ses colonnes via une constante hardcodée. → elles divergent (le bug équipement en est la preuve : l'écran disait « Technicien peut voir/modifier Clients », la RLS bloquait les équipements).

2. **Per-org cloné de Mayer.** `role_permissions` est per-org. Une nouvelle org est seedée par `org_seed_permissions(org_id)` qui **copie** les lignes de Mayer (`3c68193e`, template hardcodé). Pas de socle commun, copie figée, Mayer = template → ne scale pas pour la 2ᵉ entreprise.

3. **Enforcement front-only contournable.** Un membre déterminé peut taper l'API directement ; seule la RLS protège réellement, et elle ignore la config.

## 2. Objectif

Faire de l'écran « Droits d'accès » la **source de vérité unique, réellement appliquée** : une case cochée/décochée change le comportement **du front ET de la DB**, pour **toutes les entreprises**, avec un **socle commun (app-level) + surcharges per-org**.

### Non-objectifs (YAGNI)
- **Pas d'isolation intra-org par équipe/projet** dans Majord'home (modèle org-wide). La colonne `project_id` est **conservée** (route vers l'org + infra partagée `core.projects` pour Baikal/Arpet/RAG) mais n'est **pas** un filtre d'isolation. Branche projet possible en bolt-on plus tard, sans refonte.
- **Pas de permissions champ-par-champ.** Granularité = `resource × action`, satellites héritant du parent. On descend d'un cran (sous-resource) seulement si une règle métier réelle l'exige.
- **Pas de gestion des préférences d'affichage** (ex. colonnes Kanban tech) dans la matrice de sécurité — concern séparé.

## 3. Deux axes orthogonaux

- **Tenancy (isolation)** : App (défauts) → **Org** (LA frontière, tout scopé `org_id`) → User (propriété : `created_by`, `assigned_user_id`, `edit_own`). « Team »/projet = pas un niveau d'isolation dans MDH.
- **Capacité (rôle)** : `org_admin > team_leader > commercial > technicien`. « team_leader » est un barreau de capacité, pas une tenancy.

Point de jonction : `role_can(org, resource, action)` — prend l'**org** (tenancy) + la **capacité**. Pas de paramètre `team`.

## 4. Le registre — source unique

Extension de `src/lib/permissions.js` (déjà le registre front : `RESOURCES`, `ACTIONS`, `EFFECTIVE_ROLES`, `computeEffectiveRole`, `hasPermission`). On y ajoute, par resource : les tables gouvernées + leur scope, l'op SQL par action, et le **défaut app-level** par rôle.

```js
// src/lib/permissions/registry.js (extrait)
export const REGISTRY = {
  clients: {
    label: 'Clients',
    tables: { clients: 'org', client_activities: 'org',
              equipments: 'project', contracts: 'org', contract_equipments: 'parent:contracts' },
    actions: {
      view:   { sql: 'SELECT', default: { team_leader: true,  commercial: true,  technicien: true  } },
      create: { sql: 'INSERT', default: { team_leader: true,  commercial: true,  technicien: false } },
      edit:   { sql: 'UPDATE', default: { team_leader: true,  commercial: true,  technicien: true  } },
      delete: { sql: 'DELETE', default: { team_leader: false, commercial: false, technicien: false } },
    },
  },
  // pipeline, entretiens, chantiers, planning, devis, tasks, territoire, ...
};
```

Tout en dérive : la matrice Settings (rendue depuis le registre, plus de colonnes en dur), `can()`, et les policies RLS (qui référencent `role_can(resource, action)`).

## 5. Couches défauts + surcharges

| Couche | Portée | Stockage | Édition |
|---|---|---|---|
| Défauts app-level | toutes les orgs | `majordhome.app_role_permissions(role, resource, action, allowed)` — **généré du registre** | super-admin uniquement (code → migration de seed) |
| Surcharges per-org | une org | `majordhome.role_permissions` (existante) | org_admin via `PermissionsEditor` |

**Résolution** (front et DB, identique) : `surcharge org si présente → sinon défaut app → org_admin = bypass total`.

`app_role_permissions` : `org_id` absent, RLS lecture = tout `authenticated`, écriture = service_role (régénéré par migration). Convention `GRANT SELECT TO service_role` (charte vues `security_invoker`).

## 6. Côté Front

- `getPermissions(orgId)` → retourne le **merge** défauts app ⊕ surcharges org (au lieu des seules lignes per-org). `buildPermissionMap` inchangé en aval.
- `useCanAccess().can(resource, action)` → **signature inchangée** ; lit le merge ; `org_admin` bypass conservé.
- `PermissionsEditor.jsx` → rendu **depuis le registre** ; chaque case montre l'état effectif + indicateur « défaut » vs « surchargé » ; toggle = écrit/efface une surcharge per-org. Vue super-admin séparée (option) pour les défauts app.

## 7. Côté DB / RLS

### Fonctions
- `majordhome.user_effective_role(p_org_id uuid) RETURNS text` (SECDEF) — miroir DB de `computeEffectiveRole` (lit `core.organization_members.role` + `core.profiles.app_role/business_role`).
- `majordhome.role_can(p_org_id uuid, p_resource text, p_action text) RETURNS boolean` (SECDEF, search_path lock, REVOKE anon) — résout rôle effectif + permission effective (override→défaut→bypass admin).
- `majordhome.project_org_id(uuid)` / `user_can_read_project(uuid)` — **déjà créés en Couche 1**, réutilisés pour le pattern « via projet ».

### Patterns de scoping → templates RLS
Sur les ~70 tables `majordhome` (toutes en RLS), elles se rangent en 3 patterns de scoping (org / projet / client) + 2 cas structurels (parent, référence) :

| Pattern | Tables (extrait) | Template écriture (INSERT/UPDATE/DELETE) |
|---|---|---|
| **org_id direct** (majorité) | clients, leads, contracts, appointments, quotes, tasks, certificats, pricing_*, geogrid_*, mailing_* | `role_can(org_id, R, A)` |
| **via projet** | equipments, interventions, conversations, dpe_data, home_details, service_requests | `role_can(project_org_id(project_id), R, A)` |
| **via client** | pellets_orders | `role_can((SELECT org_id FROM clients WHERE id = client_id), R, A)` |
| **via parent** | quote_lines, contract_pricing_items, *_technicians, messages, mailing_events, task_notes | hérite de la policy du parent (EXISTS parent + `role_can` du parent) |
| **référence** (hors scope org) | statuses, sources, equipment_brands | lecture ouverte, écriture admin |

**Lecture** : reste org-wide (membre voit toute l'org) — la lecture n'est pas gatée par rôle en RLS (le gating « view » par rôle reste front/route, cf. existant). Les policies SELECT org-wide de la Couche 1 généralisées.

## 8. Le verrou Front↔DB (anti-divergence)

1. `app_role_permissions` est **générée du registre** (migration de seed) → défauts code et DB ne divergent pas.
2. `role_can()` est l'**unique arbitre**, consommé par `can()` (front) ET la RLS → même verdict.
3. **Test de cohérence (CI)** : pour chaque `(resource, action)` CRUD du registre, vérifie qu'une policy `role_can(…, R, A)` existe sur chaque table de la resource, **et réciproquement** (table `majordhome` sans resource au registre = échec). Empêche tout droit demi-câblé (la classe de bug d'origine).
4. **Fail-closed** : nouvelle case = `deny` non-admin par défaut ; `org_admin` bypass → nouvelle feature utilisable par l'admin, invisible aux autres tant que non ouverte.

## 9. Pont resources → tables (arbitrages)

Règle générale : **une table = un propriétaire** (sinon quel `role_can` ?). Une exception documentée (`interventions`, dual-owner). Arbitrages tranchés :

- **`interventions`** → **double propriétaire `entretiens` + `chantiers`** (décision Eric : une intervention relève des deux modules). Capacité = **union** : action autorisée si `role_can(org,'entretiens',A) OR role_can(org,'chantiers',A)`. Robuste, et **sans risque de sur-permission tant que `delete = org_admin only`** (décision 3 : seul l'admin supprime, quel que soit le module). Discriminant disponible si les défauts des deux modules divergent un jour : `intervention_type` (`maintenance`/`entretien`/`sav` → entretien ; `installation` → chantier). Scoping org via `project_id` (cf. §7).
- **`contracts` / `contract_*`** → sous **`clients`** (décision Eric : pas de contrat sans client). Promotion en resource `contrats` le jour où « commercial édite le contact mais pas le montant ».
- **`quotes` / `quote_lines` / `quote_templates`** → resource **`devis`** (déjà dans `RESOURCES`).
- **`leads`** (a org_id+project_id+client_id) → resource **`pipeline`**, scope `org_id`.

Long tail : tables enfant → héritent du parent ; tables référence → lecture ouverte ; tables audit/dedup → admin-only.

## 10. Règles métier (défauts app-level cibles)

| resource | action | org_admin | team_leader | commercial | technicien |
|---|---|---|---|---|---|
| clients | create | ✅ | ✅ | ✅ | ❌ |
| clients | edit (contact/contrat/équip./interv.) | ✅ | ✅ | ✅ | ✅ |
| clients | delete | ✅ | ❌ | ❌ | ❌ |
| pipeline | create | ✅ | ✅ | ✅ | ❌ |
| pipeline | delete | ✅ | ❌ | ❌ | ❌ |

- **Création client/lead** : `team_leader+` **et commercial** (Eric : le commercial garde la création). Technicien = non.
- **Modification fiche** (contact/contrat/équipement/intervention) : **tous**.
- **Suppression** (toute entité) : **org_admin uniquement**.

## 11. Séquencement (PRs)

1. **Registre** : étendre `lib/permissions.js` (tables, op SQL, défauts). Aucun changement de comportement.
2. **DB socle** : `app_role_permissions` + seed depuis registre + `user_effective_role` + `role_can`. Aucune policy encore branchée.
3. **Front merge** : `getPermissions` lit défauts⊕surcharges ; `PermissionsEditor` rendu depuis registre + défaut/surcharge. (Comportement front passe en app-level, RLS pas encore.)
4. **RLS écritures** : appliquer les 4 templates `role_can()` table par table (remplace progressivement les policies role-based en dur). Lecture déjà org-wide (Couche 1 généralisée).
5. **Test de cohérence** en CI.
6. **Nettoyage** : retirer `org_seed_permissions` ; purger les surcharges Mayer redondantes avec les défauts app ; dé-templatiser Mayer.

Chaque PR est livrable indépendamment ; l'enforcement DB (PR 4) arrive en dernier, après que le socle (PR 2) et le merge front (PR 3) sont en place.

## 12. Risques

- **`core` partagé (Baikal/Arpet)** : ne **jamais** modifier la RLS de `core.projects`/`core.project_members`. Tout reste dans `majordhome`. (Couche 1 a déjà respecté ça.)
- **Migration Mayer** : purger les surcharges redondantes = changement de comportement effectif pour les rôles non-admin Mayer → vérifier par impersonation avant/après (méthode Couche 1).
- **Perf RLS** : `role_can()` appelé par ligne sur les écritures (négligeable) ; sur les lectures, garder le pattern org-wide (pas d'appel `role_can` en SELECT).
- **Rôle effectif en DB** : `user_effective_role` doit rester aligné avec `computeEffectiveRole` (front) → couvert par le test de cohérence (même jeu de cas).

## 13. Décisions actées (Eric, 2026-06-02)
1. ✅ `interventions` → **double owner `entretiens` + `chantiers`** (union des permissions ; discriminant `intervention_type` en réserve).
2. ✅ `contracts` → **sous `clients`** (pas de contrat sans client).
3. ✅ Suppression (toute entité) = **`org_admin` uniquement**, pour l'instant.
4. ✅ Défauts app-level éditables par **super-admin uniquement** ; org_admin = surcharges per-org.
