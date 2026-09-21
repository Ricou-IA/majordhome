# Propositions de mise à jour CLAUDE.md — file vivante

> **Ce fichier ne contient QUE les propositions OUVERTES.**
> Dès qu'une proposition est intégrée au CLAUDE.md (RESOLU) ou écartée (REJETE), on la **retire d'ici** — git + l'archive gardent la trace.
> Snapshot historique complet au 2026-06-18 (110 entrées, 93 RESOLU + 5 REJETE + 12 PENDING d'alors) : `.claude/proposed-updates-archive.md`.
> **Discipline anti-drift** : une session qui intègre une entrée dans CLAUDE.md la **supprime** de ce fichier dans la foulée. Sinon la doc est à jour mais l'entrée traîne en PENDING (cause exacte du tas qu'on vient de nettoyer : 6 entrées étaient déjà dans CLAUDE.md sans avoir été fermées ici).
> Revue du 2026-09-16 : 6 entrées intégrées (SMS, référentiel équipements, paramétrage par module, Pennylane sans création de lead, MT-LT = vue, RDV toujours assigné) — commit `docs(claude): revue des propositions`.
> Revue du 2026-09-20 : 1 entrée intégrée (contrat unique des mutations React Query — `unwrapResult`, § Conventions qualité → Hooks).
> Revue du 2026-09-20 (soir) : 1 entrée intégrée (gotcha « un fichier `sql/*.sql` n'est pas une migration appliquée », § Gotchas DB + correction des vues `majordhome_prospects` / `_prospect_interactions`, § Vues publiques principales).
> Revue du 2026-09-21 : 2 entrées intégrées (facturation d'entretien → Pennylane, condensée en 4 puces § Module Pennylane + remise exceptionnelle § Module Contrats ; `create-user` : écritures `core` + lecture de `{ error }`, § Edge functions).

---

## [DROITS APP-LEVEL] Modèle de permissions canonical — Phases 4-6 à graver
**Statut** : PENDING (volontairement différé — fusionne 4 anciennes entrées du 2026-06-02 : spec 01:22 / registre 01:39 / socle DB 01:55 / Phase 3 RLS 02:21)
**Commits** : cc9ac2b · 74a9e00 · 4285f82 · ed671ec
**État** : Phases 1-3 livrées en prod (registre `src/lib/permissionsRegistry.js` ; table `majordhome.app_role_permissions` + fonctions `user_effective_role`/`role_can` ; écritures `equipments`+`interventions` gouvernées par `role_can(project_org_id(...), 'clients', …)`). Garde-fou déjà présent dans CLAUDE.md § Rôles & Permissions (ne pas éditer `app_role_permissions` à la main ; ne pas brancher de policy RLS sur `role_can` avant Phase 4).
**Reste (avec Eric, prod partagée)** : policies `clients`/`contracts`/`leads`, branchement front `can()`, retrait du seed Mayer `org_seed_permissions`.
**À faire** : graver la doc complète dans CLAUDE.md § Rôles & Permissions quand Phases 4-6 atterrissent. Spec : `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md`.

*Confirmé PENDING le 2026-08-09 : rien à graver tant que les phases ne sont pas livrées. Reconfirmé le 2026-09-16.*
---

## [2026-09-21 23:15] Plan comptable de gestion + affectation par métier + icônes des tuiles
**Statut** : PENDING
**Commit** : (session du 2026-09-21, feat(settings): plan comptable de gestion)
**Contexte** : Les sélecteurs de compte proposaient toute la classe 7 de Pennylane (une trentaine de numéros, chacun décliné par TVA). Eric : « la liste mérite d'être un paramètre plan comptable de gestion » et « l'affectation doit être affectée au métier » (entretien d'un poêle ≠ sa pose). Livré : tuile Socle → Plan comptable, section « Contrats d'entretien » renommée, icônes `Receipt`/`BookOpen` ajoutées à la page Paramètres (la tuile Facturation Pennylane affichait un « ? »).
**Proposition** (§ Module Pennylane + § Paramétrage par module) :
- **Plan comptable de gestion = source unique des sélecteurs de compte** : `settings.pennylane.chart = [{ number, alias }]` (Settings → Plan comptable, `pennylaneChart(settings)` dans `useOrgSettings.js`), vide → toute la classe 7 avec un rappel. Affectation PAR MÉTIER : « Contrat » = catégorie d'équipement → compte (livré) ; « Devis » = un compte par article du catalogue (colonnes `supplier_products.ledger_account_pl_id` / `quote_lines.ledger_account_pl_id` posées, aucun écran ne les renseigne, à câbler avec les devis natifs) ; travaux / installation = autre module. Ne jamais mélanger les contextes.
- **Toute icône citée dans `src/lib/modules.js` doit figurer dans `ICONS` de `pages/Settings.jsx`**, sinon la tuile affiche un « ? » (HelpCircle) sans erreur — vécu sur Facturation Pennylane le 2026-09-21. À ajouter au test `modules.test.mjs` si ça se reproduit.
---

## [2026-09-22 01:30] Commande « personnes × jours » (installation + SAV) — un jour = un RDV à N techniciens
**Statut** : PENDING
**Commit** : c279346 · a0eeee2 · a356f84 · 0d06b0c · 60f7cd5
**Contexte** : 12 paires d'installations en double en prod (un RDV par technicien pour la même journée, créés par l'assistant à chaque clic de colonne). « Personnes × jours » n'existait nulle part comme donnée. Livré : colonnes `planned_team_size` / `planned_days` sur `leads` (chantier) et `interventions` (SAV), saisie `PlannedOrderFields` en tête de la planification, fusion des créneaux qui se chevauchent le même jour (`installOrder.js`, `mergeOverlapping`), badge J i/N sur la commande. Spec `docs/superpowers/specs/2026-09-21-chantier-commande-installation-personnes-jours-design.md`.
**Proposition** (§ Module Planning, « Règles qui mordent ») :
- **Un jour d'installation ou de SAV = UN RDV à N techniciens** (`appointment_technicians`), jamais N RDV d'une personne. La commande « personnes × jours » est une donnée de la carte (`leads.planned_team_size/planned_days` pour le chantier, `interventions.*` pour le SAV — l'entretien est dimensionné par le barème, pas de commande), saisie dans la modale de planification (`PlannedOrderFields`). L'assistant fusionne un clic sur une journée déjà posée au même horaire (`fusionnerCreneau`, module pur `src/lib/installOrder.js` testé) quand `mergeOverlapping` est actif (ChantierModal, EntretienSAVModal pour un SAV) ; on prévient si la commande n'est pas remplie, on ne bloque pas.
- **`update_majordhome_lead` a une liste de colonnes EXPLICITE** : une nouvelle colonne de `leads` est ignorée en silence par la RPC tant qu'on n'y ajoute pas sa ligne `CASE WHEN p_updates ? '…'`. Le REVOKE FROM PUBLIC, anon manquait (posé le 2026-09-22).
- **Harnais de répétition** : `snapshot.mjs` déclare le sous-ensemble ; une migration qui touche une vue absente du sous-ensemble échoue en « relation does not exist » → étendre TABLES / VIEWS / FUNCTIONS (fait pour leads, appointments, sms_logs, lead_pennylane_quotes, les 3 vues chantiers / interventions / entretien_sav, project_org_id, quote_status_bucket).
---
