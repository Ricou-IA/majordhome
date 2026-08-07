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
---

## [2026-07-17] Chantier = devis validés du pipeline (définition unique de l'allowlist PL)
**Statut** : PENDING
**Commit** : 52fc416, 80bb62a, bd5d3cd, 08477c8, 7f11f6c, 4d38bc0
**Contexte** : Deux bugs distincts faussaient les montants du Kanban chantier. (1) Le trigger `invariant_winning` réécrivait en `accepted` tout refus PL posé sur une ligne gagnante : le cron écrivait le `refused` lu dans Pennylane, le trigger le réécrivait AVANT écriture, la valeur stockée ne bougeait jamais et le cron comptait un update réussi — échec silencieux permanent (OBIERTI : 3 devis « validés » en base, 2 dans PL ; 6 950 € au lieu de 5 717 €, sur la carte pipeline comme sur la carte chantier). (2) `majordhome_chantiers` sommait TOUS les devis rattachés sans filtre de statut, là où le pipeline ne compte que `accepted|invoiced` : 9 à 12 chantiers /43 divergeaient de leur propre carte Gagné (RENOU 21 190 € contre 5 600 €). Corrigé par une définition unique (`quote_status_bucket` → vue `lead_quote_stats`) consommée par les deux vues.
**Proposition** : ajouter à « Module Pennylane quote-driven → Règles qui mordent » :
> - **Une seule définition de « devis validé »** : `majordhome.quote_status_bucket()` → vue `majordhome.lead_quote_stats` → consommée par `majordhome_kanban_cards` ET `majordhome_chantiers`. Ne JAMAIS recopier l'allowlist (vue, RPC ou JS) — le chantier a divergé du pipeline pendant des mois exactement comme ça. Le chantier ne définit rien : il reprend les devis validés du pipeline, et le rattachement se fait uniquement depuis le pipeline (la modale d'attache côté chantier a été retirée).
> - **PL a le dernier mot sur un refus** : `invariant_winning` ne force `accepted` que sur un statut indécis (`null/pending/draft/expired`) ; un refus explicite passe et retire `is_winning_quote`. ⚠️ Dans le cas indécis le statut stocké diverge VOLONTAIREMENT de PL et ne se réaligne jamais seul (no-op assumé du cron toutes les 15 min).
> - **`linked_quotes_amount_ht = 0` a deux sens** (aucun devis validé / aucun devis rattaché) : seul `validated_quotes_count` les distingue. Toute cascade `||` sur ce champ retombe sur `order_amount_ht` et réaffiche le montant d'avant-refus.

À trancher : ces 3 points vont-ils dans `CLAUDE.md` (règles qui mordent) ou restent-ils dans `docs/MODULE_PENNYLANE.md`, où ils sont déjà documentés en détail ?
---

## [2026-08-05] Invariant : 1 membre d'org actif = 1 ressource planning (team_members)
**Statut** : PENDING
**Commit** : (non commite — session Gestion de l'equipe)
**Contexte** : L'edge function `create-user` (invitation d'un membre) cree `auth.users` + `core.profiles` + `core.organization_members`, mais JAMAIS la ligne `majordhome.team_members` qui sert de ressource planning. Consequence : le membre invite n'apparait dans aucune assignation RDV, n'a pas de colonne planning et sa couleur n'est pas editable (`—` dans Gestion de l'equipe). Vecu sur 2 membres Mayer (Mohammed, Mathis Daguts). Corrige par une RPC idempotente `public.team_member_ensure_for_user(p_core_org_id, p_user_id, p_color)` (SECURITY DEFINER, org_admin only, relie une ressource orpheline de meme email avant d'inserer) + auto-appel depuis `TeamManagement.jsx` pour tout membre sans ressource. Index unique partiel `team_members (org_id, user_id) WHERE user_id IS NOT NULL`.
**Proposition** : ajouter au module Planning (CLAUDE.md ou `docs/MODULE_PLANNING.md`) :
> - **1 membre d'org actif = 1 ressource planning `majordhome.team_members`** (colonne calendrier, assignation RDV, couleur). `create-user` ne la cree PAS : elle est garantie par la RPC idempotente `team_member_ensure_for_user(core_org_id, user_id, color)` (org_admin only), auto-appelee depuis `/settings/team` pour tout membre qui n'en a pas. Toute nouvelle voie de creation de membre (SSO, import, edge function) doit appeler cette RPC, sinon le membre est invisible du planning — echec silencieux.
> - Mapping role effectif → `team_members.role` : `org_admin`→`admin`, `team_leader`/`Commercial`→`commercial`, sinon `technician` (c'est ce que filtre `SectionAssignee` : types commerciaux → `['commercial','admin']`, types techniques → `technician`).
> - Gotcha : `team_members.display_name` est une colonne **GENERATED** (`first_name || ' ' || last_name`) → ne jamais l'inclure dans un INSERT (erreur 428C9).

> - **Le role planning suit le role du membre** : tout changement de role dans Gestion de l'equipe appelle `public.team_member_sync_role_for_user(core_org_id, user_id)` (depuis `permissions.service.updateMemberRole`). Derivation centralisee dans `majordhome.planning_role_for(app_role, business_role, membership_role)` — seule source, utilisee par ensure ET sync. Ne pas recopier le CASE ailleurs.

A trancher : ces points vont-ils dans CLAUDE.md ou dans `docs/MODULE_PLANNING.md` ?
---

## [2026-08-06] Module Thermique — section absente de CLAUDE.md
**Statut** : PENDING
**Commits** : 79bccc9 (rapport PDF) · f409b19 (PDF depuis l'historique) · module livré depuis 2026-07-06
**Contexte** : CLAUDE.md n'a AUCUNE section « Module Thermique », alors que le module est en prod et substantiel (wizard 3 étapes, 4 moteurs purs, 331 tests node, rapport PDF, page `/settings/thermique`). Une session qui ouvre le repo à froid ne connaît ni les règles qui mordent, ni l'existence du rapport PDF — risque de recréer ce qui existe ou de casser la cohérence écran ↔ PDF. Les mémoires inter-sessions y font référence mais elles ne sont pas chargées comme CLAUDE.md.
**Proposition** : ajouter une section (après « Module Solaire », qui est son plus proche voisin) :

> ## Module Thermique (étude de déperditions + dimensionnement PAC)
>
> Outil terrain pour installateur **non-ingénieur** : déperditions EN 12831 pièce par pièce, dimensionnement PAC (bivalence, conso), rapport PDF client. Routes `/thermique` (wizard 3 étapes : Contexte → Pièces → Résultats) + `/thermique/historique`, RouteGuard `resource=thermal_study`. Page admin `/settings/thermique` (org_admin). Spec : `docs/superpowers/specs/2026-07-03-module-thermique-deperditions-design.md`.
>
> - **Moteurs PURS** (aucun import React/Supabase/alias) : `thermalEngine.js` (EN 12831), `heatPumpEngine.js` (bivalence + conso degrés-jours), `geometryEngine.js`, `assembleBatimentParametrique.js`. Testés via `node --test "scripts/thermique/*.test.mjs"` (331 tests). Toute règle de calcul se teste là, pas dans un composant.
> - **`buildEtudeModel` (`lib/etudeModel.js`) = SOURCE DE CALCUL UNIQUE** écran ↔ PDF (pattern Solaire). `ENGINE_VERSION` versionne les règles : à incrémenter à tout changement de calcul.
> - **Résultats FIGÉS (R7)** : une étude rouverte affiche `thermal_studies.results` tel qu'enregistré (bannière ambre si la version moteur diffère), pas un recalcul. `resultsPersistables(model)` définit le sous-ensemble persisté (`bilan`/`thetaE`/`pac`) — les parois sont re-dérivables de l'`input`. **Règle générale** (même esprit que les contrats signés) : un artefact remis au client lit les valeurs ENREGISTRÉES.
> - **Rapport PDF** (2026-08-06) : `lib/rapportModel.js` (PUR) met en forme le modèle SANS jamais recalculer → un chiffre du PDF absent de l'écran est un bug de ce module. `couleurRatio` y vit aussi : **source unique** de l'échelle de couleur écran (`ResultatsPiecesGrid`) ↔ PDF. Génération via `telechargerRapportThermique()` de `lib/rapportExport.js` — **point d'entrée unique** des 2 boutons (étape Résultats + ligne d'historique) ; ne pas réimplémenter la chaîne dans un 3ᵉ écran. `@react-pdf/renderer` en import dynamique (chunk séparé). Le catalogue PAC (4,6 Mo) n'est chargé qu'à la demande : absent → le graphe de bivalence disparaît, jamais le rapport.
> - **⚠️ Glyphes PDF (Helvetica/WinAnsi)** : dans tout texte du rapport, les lettres grecques (θ, Δ, Φ), les flèches et `≈ ≥ ≤ −` sortent en artefact → écrire « T° extérieure de base », « majoration Utb » en toutes lettres. `° ² · × — – ’ « » € %` passent. Formatters PDF-safe obligatoires (`components/etude/pdfShared.jsx`) : `toLocaleString('fr-FR')` insère une espace fine U+202F.
> - **Palette deutan (R12)** : bleu → ambre pour l'intensité des déperditions, **jamais rouge/vert**, et la couleur ne porte jamais l'information seule (bornes chiffrées systématiques).
> - **DB** : `majordhome.thermal_studies` + vue publique `majordhome_thermal_studies` (security_invoker, auto-updatable). `input` jsonb = état wizard (shape VERROUILLÉ, cf. `toStudyInput`), `results` jsonb + `engine_version`. La liste ne sélectionne PAS `input` (jsonb lourd) : le récupérer via `getById` quand on en a besoin. Brouillon `localStorage thermal-draft:${userId}`.
> - **Config org** : `core.organizations.settings.thermique` via `buildThermiqueConfig(settings)`. ⚠️ `org_update_settings` merge JSONB niveau 1 → toujours sauver l'objet `thermique` COMPLET.
> - **⚠️ L'étude est aujourd'hui INDÉPENDANTE du pipeline** : les rails existent (colonnes `client_id`/`lead_id`, `contexte.clientId`/`leadId` dans l'état, pré-remplissage `/thermique?client=<id>`) mais **rien ne les alimente** — aucun écran ne produit l'URL `?client=`, `leadId` n'est jamais renseigné, et ni la fiche client ni le lead n'affichent les études. Seule porte d'entrée : la sidebar. **Chantier phase 2 (décidé avec Eric le 2026-08-06)** : brancher l'étude sur le lead. Ne pas considérer le lien comme fonctionnel avant.

À trancher : tout dans CLAUDE.md, ou une section courte « règles qui mordent » + un `docs/MODULE_THERMIQUE.md` pour le détail (comme Mailing / Planning / Entretiens / Pennylane) ?
---
