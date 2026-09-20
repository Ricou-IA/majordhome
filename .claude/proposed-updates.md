# Propositions de mise à jour CLAUDE.md — file vivante

> **Ce fichier ne contient QUE les propositions OUVERTES.**
> Dès qu'une proposition est intégrée au CLAUDE.md (RESOLU) ou écartée (REJETE), on la **retire d'ici** — git + l'archive gardent la trace.
> Snapshot historique complet au 2026-06-18 (110 entrées, 93 RESOLU + 5 REJETE + 12 PENDING d'alors) : `.claude/proposed-updates-archive.md`.
> **Discipline anti-drift** : une session qui intègre une entrée dans CLAUDE.md la **supprime** de ce fichier dans la foulée. Sinon la doc est à jour mais l'entrée traîne en PENDING (cause exacte du tas qu'on vient de nettoyer : 6 entrées étaient déjà dans CLAUDE.md sans avoir été fermées ici).
> Revue du 2026-09-16 : 6 entrées intégrées (SMS, référentiel équipements, paramétrage par module, Pennylane sans création de lead, MT-LT = vue, RDV toujours assigné) — commit `docs(claude): revue des propositions`.
> Revue du 2026-09-20 : 1 entrée intégrée (contrat unique des mutations React Query — `unwrapResult`, § Conventions qualité → Hooks).

---

## [DROITS APP-LEVEL] Modèle de permissions canonical — Phases 4-6 à graver
**Statut** : PENDING (volontairement différé — fusionne 4 anciennes entrées du 2026-06-02 : spec 01:22 / registre 01:39 / socle DB 01:55 / Phase 3 RLS 02:21)
**Commits** : cc9ac2b · 74a9e00 · 4285f82 · ed671ec
**État** : Phases 1-3 livrées en prod (registre `src/lib/permissionsRegistry.js` ; table `majordhome.app_role_permissions` + fonctions `user_effective_role`/`role_can` ; écritures `equipments`+`interventions` gouvernées par `role_can(project_org_id(...), 'clients', …)`). Garde-fou déjà présent dans CLAUDE.md § Rôles & Permissions (ne pas éditer `app_role_permissions` à la main ; ne pas brancher de policy RLS sur `role_can` avant Phase 4).
**Reste (avec Eric, prod partagée)** : policies `clients`/`contracts`/`leads`, branchement front `can()`, retrait du seed Mayer `org_seed_permissions`.
**À faire** : graver la doc complète dans CLAUDE.md § Rôles & Permissions quand Phases 4-6 atterrissent. Spec : `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md`.

*Confirmé PENDING le 2026-08-09 : rien à graver tant que les phases ne sont pas livrées. Reconfirmé le 2026-09-16.*
---

## [2026-09-20 19:45] Un fichier `sql/*.sql` « à exécuter dans le SQL Editor » n'est pas une migration appliquée
**Statut** : PENDING
**Commit** : (fix prospection — migration `20260920_2_prospection_tables_vues.sql`)
**Contexte** : Le module Prospection (Cédants + Commercial, `/cedants`, `/prospection`, screener SIRENE) était livré côté front depuis mars 2026 avec `sql/migration_prospects.sql` comme seule définition DB — jamais jouée, ni sur l'ancien projet partagé (703 migrations, 0 trace, 0 ligne `role_permissions` `cedants`/`prospection_commerciale`) ni en prod. Six mois de module mort en silence : les lecteurs recevaient PGRST205 (vue inconnue), avalé par les hooks jusqu'au contrat `unwrapResult` du 18/09. Le brief visait un `.schema('majordhome')` (PGRST106) — vrai, mais second bug derrière l'absence totale des tables ; la vue d'origine (`LEFT JOIN profiles`) en cachait un troisième (non updatable). CLAUDE.md listait `majordhome_prospects` parmi les « vues publiques principales » comme si elle existait.
**Proposition** (§ Base de Données → Gotchas DB) :
```
- **Un fichier `sql/*.sql` ou une doc « ✅ FAIT » ne prouve pas qu'un objet existe en base.** Avant de déboguer un module qui « échoue en silence », vérifier d'abord l'existence de ses objets en prod (`to_regclass('majordhome.<table>')`, `to_regclass('public.majordhome_<vue>')`) et l'inscription de sa migration dans `supabase_migrations.schema_migrations`. Vécu 2026-09-20 : module Prospection livré en mars 2026 sans qu'aucune de ses tables n'ait jamais existé (migration `sql/migration_prospects.sql` « à exécuter dans le SQL Editor », jamais jouée) — six mois de PGRST205 avalés. Toute nouvelle table part d'une migration versionnée `supabase/migrations/` répétée sur le harnais, jamais d'un fichier « à exécuter à la main ».
```
**À corriger aussi dans CLAUDE.md (2 lignes, § Vues publiques principales)** : `majordhome_prospects` = miroir simple auto-updatable de `majordhome.prospects` (plus de `created_by_name`/`assigned_to_name`, non consommés) ; `majordhome_prospect_interactions` = miroir + `created_by_name` par sous-requête scalaire (reste insérable). Le front écrit à travers ces deux vues.
---
