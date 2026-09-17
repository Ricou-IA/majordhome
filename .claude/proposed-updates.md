# Propositions de mise à jour CLAUDE.md — file vivante

> **Ce fichier ne contient QUE les propositions OUVERTES.**
> Dès qu'une proposition est intégrée au CLAUDE.md (RESOLU) ou écartée (REJETE), on la **retire d'ici** — git + l'archive gardent la trace.
> Snapshot historique complet au 2026-06-18 (110 entrées, 93 RESOLU + 5 REJETE + 12 PENDING d'alors) : `.claude/proposed-updates-archive.md`.
> **Discipline anti-drift** : une session qui intègre une entrée dans CLAUDE.md la **supprime** de ce fichier dans la foulée. Sinon la doc est à jour mais l'entrée traîne en PENDING (cause exacte du tas qu'on vient de nettoyer : 6 entrées étaient déjà dans CLAUDE.md sans avoir été fermées ici).
> Revue du 2026-09-16 : 6 entrées intégrées (SMS, référentiel équipements, paramétrage par module, Pennylane sans création de lead, MT-LT = vue, RDV toujours assigné) — commit `docs(claude): revue des propositions`.

---

## [DROITS APP-LEVEL] Modèle de permissions canonical — Phases 4-6 à graver
**Statut** : PENDING (volontairement différé — fusionne 4 anciennes entrées du 2026-06-02 : spec 01:22 / registre 01:39 / socle DB 01:55 / Phase 3 RLS 02:21)
**Commits** : cc9ac2b · 74a9e00 · 4285f82 · ed671ec
**État** : Phases 1-3 livrées en prod (registre `src/lib/permissionsRegistry.js` ; table `majordhome.app_role_permissions` + fonctions `user_effective_role`/`role_can` ; écritures `equipments`+`interventions` gouvernées par `role_can(project_org_id(...), 'clients', …)`). Garde-fou déjà présent dans CLAUDE.md § Rôles & Permissions (ne pas éditer `app_role_permissions` à la main ; ne pas brancher de policy RLS sur `role_can` avant Phase 4).
**Reste (avec Eric, prod partagée)** : policies `clients`/`contracts`/`leads`, branchement front `can()`, retrait du seed Mayer `org_seed_permissions`.
**À faire** : graver la doc complète dans CLAUDE.md § Rôles & Permissions quand Phases 4-6 atterrissent. Spec : `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md`.

*Confirmé PENDING le 2026-08-09 : rien à graver tant que les phases ne sont pas livrées. Reconfirmé le 2026-09-16.*
---

## [2026-09-16 16:00] Module Mouchard — journal d'audit des écritures (leads, RDV)
**Statut** : RESOLU (intégré dans CLAUDE.md § Module Mouchard, après Module Planning, le 2026-09-17)
**Commit** : 836a5ca
**Contexte** : L'Historique d'un lead était déclaratif (le front loggait quand il y pensait, avec un `user_id` auto-déclaré) ; une modif de date de RDV à 15:05 sur PERRON n'avait laissé aucune trace. Un trigger AFTER générique trace maintenant toute écriture sur `leads` / `appointments` dans `majordhome.audit_log`, affiché dans l'Historique de la fiche lead et dans la modale RDV.
**Proposition** (section « ## Module Mouchard (journal d'audit) → `docs/superpowers/specs/2026-09-16-mouchard-audit-log-design.md` », à placer après Module Planning) :
```
Règles qui mordent :
- **Toute écriture sur `leads` / `appointments` est tracée par trigger DB** (`majordhome.audit_row_change()` → `majordhome.audit_log`, append-only, `changed_by = auth.uid()` serveur, `source` = RPC/vue racine). Ne JAMAIS y écrire depuis le front ni y poser de GRANT INSERT : le trigger est le seul écrivain. Ajouter une table auditée = 1 `CREATE TRIGGER` avec la liste CSV des colonnes bruit en argument.
- **`lead_activities` reste déclaratif** (`user_id` fourni par le front) : pour prouver QUI a fait QUOI, c'est `audit_log` qui fait foi, pas l'activité.
- **Fail-safe assumé** : une erreur du trigger part en WARNING et ne bloque pas l'écriture métier → après toute modif de la fonction, vérifier qu'une écriture depuis l'app produit bien une ligne (`SELECT * FROM majordhome.audit_log ORDER BY id DESC LIMIT 1`).
- **`org_id` du journal = org CORE** (normalisé dans le trigger via `majordhome.organizations.core_org_id`, car `appointments.org_id` porte l'org majordhome) → filtrer avec `organization.id`, comme les leads.
- UPDATE sans champ utile → aucune ligne ; `updateLeadStatus` n'écrit plus « Statut : X → X ». Mise en forme = module pur `src/lib/auditTrail.js` (libellés FR, `resolvers` ids→noms via `useAuditResolvers`), rendu partagé `AuditEntry` (fiche lead + modale RDV).
```
---
