# Propositions de mise à jour CLAUDE.md — file vivante

> **Ce fichier ne contient QUE les propositions OUVERTES.**
> Dès qu'une proposition est intégrée au CLAUDE.md (RESOLU) ou écartée (REJETE), on la **retire d'ici** — git + l'archive gardent la trace.
> Snapshot historique complet au 2026-06-18 (110 entrées, 93 RESOLU + 5 REJETE + 12 PENDING d'alors) : `.claude/proposed-updates-archive.md`.
> **Discipline anti-drift** : une session qui intègre une entrée dans CLAUDE.md la **supprime** de ce fichier dans la foulée. Sinon la doc est à jour mais l'entrée traîne en PENDING (cause exacte du tas qu'on vient de nettoyer : 6 entrées étaient déjà dans CLAUDE.md sans avoir été fermées ici).

---

## [DROITS APP-LEVEL] Modèle de permissions canonical — Phases 4-6 à graver
**Statut** : PENDING (volontairement différé — fusionne 4 anciennes entrées du 2026-06-02 : spec 01:22 / registre 01:39 / socle DB 01:55 / Phase 3 RLS 02:21)
**Commits** : cc9ac2b · 74a9e00 · 4285f82 · ed671ec
**État** : Phases 1-3 livrées en prod (registre `src/lib/permissionsRegistry.js` ; table `majordhome.app_role_permissions` + fonctions `user_effective_role`/`role_can` ; écritures `equipments`+`interventions` gouvernées par `role_can(project_org_id(...), 'clients', …)`). Garde-fou déjà présent dans CLAUDE.md § Rôles & Permissions (ne pas éditer `app_role_permissions` à la main ; ne pas brancher de policy RLS sur `role_can` avant Phase 4).
**Reste (avec Eric, prod partagée)** : policies `clients`/`contracts`/`leads`, branchement front `can()`, retrait du seed Mayer `org_seed_permissions`.
**À faire** : graver la doc complète dans CLAUDE.md § Rôles & Permissions quand Phases 4-6 atterrissent. Spec : `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md`.

*Confirmé PENDING le 2026-08-09 : rien à graver tant que les phases ne sont pas livrées.*
---

## [2026-08-11] Pennylane : le miroir local est la source de LECTURE — la règle actuelle dit l'inverse
**Statut** : PENDING
**Contexte** : la section « Module Pennylane » de CLAUDE.md recommande aujourd'hui « **Pattern préféré pour matcher entité PL ↔ entité MDH** : partir des entités PL (paginé), fetcher leurs détails en batch (avec `pLimit`) ». Cette règle a été écrite **avant** l'arrivée du miroir local (`majordhome.pennylane_quotes` + `pennylane_customer_lookup`, alimentés par `pennylane-quotes-sweep` toutes les 5 min, livrés le 2026-08-07 avec l'explorateur de devis). Tant qu'elle y figure, tout nouveau code repart interroger Pennylane en direct.

Le coût mesuré le 2026-08-10 : `pennylane-sync-quote-status` faisait 781 appels PL (≈ 322 s) contre un wall-clock de 150 s en plan Free — tuée à CHAQUE exécution depuis des semaines, sur l'ancien projet comme sur le neuf, pendant que le sweep récupérait les mêmes données en 3 appels et 2 s. Réécrite en lecture du miroir : 200, 363 devis resynchronisés, étapes 4-5 exécutées pour la première fois.

**Proposition — remplacer le « pattern préféré » par :**

> - **Le miroir local est la source de LECTURE, Pennylane la source d'ÉCRITURE.** Toute lecture d'entité PL part de `majordhome_pennylane_quotes` / `majordhome_pennylane_customer_lookup`. Un `apiCall('GET', …)` en direct doit se justifier (entité non miroitée : `ledger_accounts`, factures). Reste ~15 lectures directes à instruire dans `pennylane.service.js` (contre 3 écritures).
> - **Périmètre du miroir** : `pending | expired | accepted | invoiced | denied`. `denied` réintégré le 2026-08-11 — le refus place la carte en Perdu, ce n'est pas une info morte. `draft` reste dehors : renvoyé par l'API PL mais absent de son énumération filtrable (**« renvoyé » ≠ « filtrable »** chez Pennylane — vérifier avant d'ajouter un statut).
> - **Absence du miroir ≠ suppression.** `missing_since` signifie « sorti du périmètre balayé ». Avant l'élargissement, passer en refusé en était une cause (cf. `20260807_2_mark_missing_refuse_wipe.sql`) : y brancher une éjection aurait détaché 142 devis du pipeline en silence. Ne jamais éjecter sur une absence — vérifier par un GET ciblé (404 = supprimé).
> - **Fraîcheur** : miroir daté de > 30 min ⇒ s'abstenir et le signaler, plutôt qu'écrire sur la foi de données figées.

**Aussi à corriger dans la même section** : « Rate limit V2 25 req/5s → `pLimit(5)` » reste vrai pour les écritures, mais ne doit plus se lire comme un feu vert pour paralléliser des lectures massives — à 5 req/s, 781 appels font 156 s de plancher, au-dessus du plafond Free.
---
