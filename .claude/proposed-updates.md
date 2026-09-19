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

## [2026-09-19 00:30] Contrat unique des mutations React Query — `unwrapResult`
**Statut** : PENDING
**Commits** : 8d4dfc0 (helper) · 6bb7430 → 7397abf (16 commits, un par hook)
**Contexte** : Les services renvoient `{ data, error }` sans throw (`withErrorHandling`). Un hook qui expose `useMutation({ mutationFn: (x) => xxxService.method(x) }).mutateAsync` tel quel RÉSOUT donc avec `{ data: null, error }` sur un refus (RLS, 23503, RPC qui RAISE) : tout appelant en try/catch affichait un toast de succès mensonger. Vécu 3 fois les 17-18/09 (« Équipement supprimé » sur DELETE 409, « Client supprimé définitivement » sur `org_admin_required`, « Tâche supprimée » / « Lead passé en X » / « Fusion faite : 0 devis » sur refus), plus une régression silencieuse depuis 36850cd (InterventionDetail lisait `result.path` / `result.success` à plat → photos terrain jamais liées, PV toujours « en erreur »). 17 hooks alignés ; `useGoogleCalendar` est un faux positif (service en `fetch` qui throw nativement).
**Proposition** (§ Conventions qualité → Hooks, après la ligne « Pas de console.* en prod ») :
```
- **Contrat unique des mutations** : toute `mutationFn` déballe la réponse du service via `unwrapResult()` (`src/lib/serviceHelpers.js`, pendant hook de `withErrorHandling`) → `mutateAsync` résout avec `data` et **REJETTE** sur `{ error }`. Côté appelant : try/catch + toast, **jamais** de lecture de `{ error }` ni de `result.data` sur le retour d'un hook. Un service qui porte une clé hors `data` (`clientCreated` d'`updateLeadStatus`, `duplicate` de `createProspect`) se déballe à la main dans la mutationFn et résout avec un objet nommé (`{ lead, clientCreated }`). Sans ce déballage, un appelant en try/catch annonce un succès sur un refus (vécu ×3, 2026-09-17/18) — et le contrat porté par l'appelant (« hybride » `if (result?.error) throw`) ne protège que lui. Les services qui `throw` nativement (`googleCalendar.service`, fetch) n'ont rien à déballer. Mesure de régression : `grep -rnE "mutationFn: .*=> *[a-zA-Z]+Service\.[a-zA-Z]+\(" src/shared/hooks | grep -v "unwrap("` doit ne remonter que `useGoogleCalendar`.
```
---
