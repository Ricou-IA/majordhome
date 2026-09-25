# Module Maintenance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le module Maintenance (tâches récurrentes par unité, borne d'atelier avec signature prénom + PIN, suivi responsable, e-mail du soir, registre PDF) sur l'architecture Majord'home.

**Architecture:** Tables `majordhome.maint_*` (RLS org, vues `security_invoker`), écritures sensibles par RPC `SECURITY DEFINER` (PIN, journal append-only). Règle d'échéance = module pur `src/lib/maintenance/echeances.js`, seule définition de « dû / en retard », copiée pour Deno. Front = app `src/apps/maintenance/` (borne plein écran + pages responsable) + tuile Settings ; edge horaire `maintenance-digest` pour l'e-mail du soir.

**Tech Stack:** React 18, React Router 6, TanStack Query v5, Supabase (PostgreSQL, pgcrypto `extensions`, pg_cron, pg_net), Deno edge functions, Resend, @react-pdf/renderer, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-25-module-maintenance-taches-recurrentes-design.md`

## Global Constraints

- `org_id` = org **core** (`core.organizations.id`), filtré explicitement dans toute requête/mutation front.
- Tout RPC SECURITY DEFINER : `REVOKE EXECUTE … FROM PUBLIC, anon` ; `auth.uid() IS NULL` refusé en 1ʳᵉ instruction ; gardes positives `IF (x) IS NOT TRUE THEN RAISE`.
- Toute table `majordhome.maint_*` : RLS + `GRANT SELECT … TO service_role` ; vues `public.majordhome_maint_*` `WITH (security_invoker = true)`.
- `pin_hash` jamais exposé par une vue ; PIN `^\d{4}$` ; 5 échecs ⇒ blocage 15 min ; PIN faux ⇒ `RETURN` (pas `RAISE`).
- `maint_task_logs` : aucune policy d'écriture, trigger anti UPDATE/DELETE.
- Jours calendaires en Europe/Paris, format `YYYY-MM-DD`.
- Services `{ data, error }` via `withErrorHandling` ; `mutationFn` via `unwrapResult` ; cache keys `maintenanceKeys.all(orgId)` ; `enabled: !!orgId`.
- Palette deutan (ambre pour retard, jamais rouge/vert porteur d'info seul) ; bandeau hors ligne = exception d'alerte système.
- Aucune valeur Bricafeu dans le code.

---

### Task 1: Règle d'échéance (module pur)

**Files:**
- Create: `src/lib/maintenance/echeances.js`
- Test: `scripts/maintenance/echeances.test.mjs`

**Interfaces — Produces:**
- `jourParis(dateOrIso: Date|string): 'YYYY-MM-DD'`
- `ajouterJours(jour, n)`, `ajouterMois(jour, n)` (ancrage fin de mois), `jourIso(jour): 1..7`
- `prochaineEcheance(tache, dernierLog): string|null` — `tache = { frequency_kind, weekdays, interval_unit, interval_count, start_date, archived_at }`, `dernierLog = { status, done_at } | null`
- `etatDuJour(tache, dernierLog, aujourdhui): { etat: 'a_venir'|'a_faire'|'en_retard'|'archivee', echeance, joursDeRetard }`
- `dernierLogParTache(logs): Map<taskId, log>` (plus récent `done_at`)
- `ponctualite(logs): { faits, aLHeure, taux|null, nonFaits }`
- `decrireFrequence(tache): string` (« Lun, Mer, Ven », « Tous les 2 semaines »…)

- [ ] Step 1 — tests : jours cochés (premier jour ≥ start), retard non empilé (dû lundi, mercredi ⇒ `en_retard`, 2 jours, une seule échéance), `not_done` ⇒ J+1 (y compris weekdays), `done` weekdays ⇒ prochain jour coché > jour du log, intervalles jours/semaines/mois, 31 janv. + 1 mois = 29 févr. 2028 / 28 févr. 2027, `start_date` future ⇒ `a_venir`, `max(calcul, start_date)`, archivée ⇒ `null`, `done_at` UTC 2026-10-24T22:30Z ⇒ jour Paris 2026-10-25 (heure d'été) et 2026-10-25T23:30Z ⇒ 2026-10-26 (heure d'hiver), ponctualité.
- [ ] Step 2 — `node --test scripts/maintenance/echeances.test.mjs` ⇒ FAIL (module absent).
- [ ] Step 3 — implémenter (arithmétique de dates sur `Date.UTC`, jamais sur l'heure locale ; `jourParis` via `Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' })`).
- [ ] Step 4 — tests PASS.
- [ ] Step 5 — commit `feat(maintenance): règle d'échéance des tâches récurrentes (module pur)`.

### Task 2: Modèles purs e-mail du soir et registre

**Files:**
- Create: `src/lib/maintenance/digestModel.js`, `src/lib/maintenance/registreModel.js`
- Test: `scripts/maintenance/digest-model.test.mjs`, `scripts/maintenance/registre-model.test.mjs`

**Interfaces — Consumes:** Task 1. **Produces:**
- `construireDigest({ units, tasks, logs, operators, aujourdhui, orgName }) → { sujet, toutAJour, faitsParUnite:[{unite, n}], retards:[{unite, tache, depuis, joursDeRetard}], nonFaits:[{unite, tache, operateur, commentaire}], bloques:[{prenom, jusqua}] }` + `digestHtml(digest) → string` (HTML échappé, sans dépendance).
- `construireRegistre({ units, tasks, logs, operators, periode:{du, au}, filtres }) → { titre, periode, sections:[{unite, lignes:[{date, heure, tache, statut, operateur, commentaire}]}], total }` — ne recalcule rien, trie par `done_at` croissant.

- [ ] Step 1 — tests : digest « tout à jour » (aucun retard/non fait ⇒ `toutAJour: true`, sujet « ✓ Tout est à jour »), retards listés triés du plus ancien, non-faits du jour seulement, opérateur bloqué si `locked_until > maintenant`, HTML échappe `<script>` ; registre groupé par unité, lignes triées, heure Paris, `total`.
- [ ] Step 2 — FAIL. Step 3 — implémenter. Step 4 — PASS. Step 5 — commit.

### Task 3: Migration base de données

**Files:**
- Create: `supabase/migrations/20260925_1_maintenance_module.sql`
- Create: `scripts/migration-rehearsal/assert-maintenance.sql`

Contenu (cf. spec § 3) : 5 tables, triggers `handle_updated_at`, trigger cohérence unité/tâche même org, trigger append-only journal, RLS (SELECT membre, écriture `org_admin` sur units/tasks/operators, rien sur logs/digest_runs), privilèges explicites, vues (operators sans `pin_hash`, avec `has_pin`), RPC `maint_set_operator_pin`, `maint_unlock_operator`, `maint_record_completion`, `maint_digest_mark_sent` (service_role), seed `app_role_permissions` pour la ressource `maintenance`.

- [ ] Step 1 — écrire les assertions (RLS active ×5, `has_function_privilege('anon', …)` false ×4, `authenticated` false sur `maint_digest_mark_sent`, `service_role` SELECT sur les 5 tables, vue operators sans colonne `pin_hash`, scénario : PIN faux ×5 ⇒ `locked`, compteur persisté (preuve que RETURN et pas RAISE), PIN bon ⇒ log inséré, UPDATE du log refusé, `not_done` sans commentaire refusé, membre d'une autre org refusé).
- [ ] Step 2 — `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260925_1_maintenance_module.sql --assert scripts/migration-rehearsal/assert-maintenance.sql` ⇒ PASS.
- [ ] Step 3 — commit. **Application en prod : après accord explicite d'Eric** (instance partagée).

### Task 4: Service, cache keys, hooks

**Files:**
- Create: `src/shared/services/maintenance.service.js`, `src/shared/hooks/useMaintenance.js`
- Modify: `src/shared/hooks/cacheKeys.js` (famille `maintenanceKeys`)

**Produces:** `maintenanceService.{listUnits, listTasks, listOperators, listLogs({orgId, du, au}), saveUnit, archiveUnit, saveTask, archiveTask, saveOperator, setOperatorPin, unlockOperator, recordCompletion}` ; hooks `useMaintenanceData(orgId)` (units+tasks+operators+logs 60 j, `refetchInterval` optionnel), `useMaintenanceLogs(orgId, filtres)`, `useMaintenanceMutations(orgId)`.

- [ ] Implémenter, `npx vite build`, commit.

### Task 5: Branchements registre, permissions, navigation, routes

**Files:**
- Modify: `src/lib/modules.js` (module `maintenance`, tuile `/settings/maintenance`), `src/lib/permissionsRegistry.js` (`maintenance: view [1,1,1], edit [0,0,0]`), `src/lib/permissions.js` (RESOURCES), `src/layouts/AppLayout.jsx` (item Maintenance si `moduleActif(settings,'maintenance')`, CRM masqué si `settings.modules.crm === false`), `src/apps/artisan/routes.jsx` (routes `maintenance`, `settings/maintenance`, redirection index), `src/App.jsx` (route plein écran `/maintenance/borne`), `src/apps/artisan/pages/Settings.jsx` (icône `ClipboardCheck`).
- Test: `scripts/modules.test.mjs` (déjà couvrant : route déclarée) + `node scripts/verify-permissions-registry.mjs`.

- [ ] Implémenter, tests, build, commit.

### Task 6: Borne `/maintenance/borne`

**Files:** `src/apps/maintenance/pages/Borne.jsx`, `src/apps/maintenance/components/borne/{TuileTache,ValidationDialog,PavePin,BandeauHorsLigne}.jsx`, `src/apps/maintenance/lib/useEnLigne.js`.

Comportement : spec § 5. - [ ] Implémenter, build, commit.

### Task 7: Pages responsable `/maintenance`

**Files:** `src/apps/maintenance/pages/Maintenance.jsx` (onglets), `src/apps/maintenance/components/{SuiviTab,HistoriqueTab,UnitesTab,TacheForm,FrequenceInput}.jsx`.

- [ ] Implémenter, build, commit.

### Task 8: Paramètres `/settings/maintenance`

**Files:** `src/apps/artisan/pages/settings/MaintenanceSettings.jsx`, `src/apps/artisan/pages/settings/maintenance/{OperateursTab,DigestTab,BorneTab}.jsx`.

- [ ] Implémenter, build, commit.

### Task 9: Registre PDF

**Files:** `src/apps/maintenance/lib/registreExport.js`, `src/apps/maintenance/components/RegistrePDF.jsx`.

- [ ] Implémenter (point d'entrée unique `telechargerRegistre({ settings, … })`), build, commit.

### Task 10: Edge `maintenance-digest` + cron

**Files:**
- Modify: `scripts/sync-tournee-engine.mjs` (PARTAGES_MAINTENANCE → `_shared/maintenance/`)
- Create: `supabase/functions/maintenance-digest/index.ts`, `supabase/migrations/20260925_2_maintenance_digest_cron.sql`
- Modify: `supabase/config.toml` (`verify_jwt = false`), `package.json` (`audit:quality` + tests)

- [ ] Sync, `deno check` si disponible, commit. **Déploiement + cron en prod : après accord d'Eric.**

### Task 11: Vérification finale

- [ ] `npm run lint`, `npm run audit:quality`, `npx vite build`.
- [ ] Proposition de section CLAUDE.md dans `.claude/proposed-updates.md` (PENDING).
