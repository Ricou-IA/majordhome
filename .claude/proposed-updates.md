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

## [2026-06-20 09:51] Planning — couleurs calendrier par personne (source = team_members.calendar_color)
**Statut** : PENDING
**Commit** : 1a0b8888d8a6a2c9da5e98957a9655a4ffc80e52
**Contexte** : Migration `20260620_planning_member_colors.sql` — seed one-time des couleurs du calendrier par personne (Mayer). Source unique = `majordhome.team_members.calendar_color`, résolue via `profile_key` pour les humains présents aussi comme commerciaux (Philippe, Michel). Violet `#6D28D9` est RÉSERVÉ au statut « facturé » → aucune personne ne doit l'avoir. Couleurs prévues éditables via Settings → Équipe (Phase 2, pas encore livrée). Seed actuel : Ludovic=#EF4444, Antoine=#F97316, Philippe=#3B82F6, Michel=#0D9488, Eric=#10B981.
**Proposition** : Ajouter au § Module Planning de CLAUDE.md : « **Couleurs calendrier par personne** : source unique = `majordhome.team_members.calendar_color` (résolue via `profile_key` pour les humains présents aussi comme commerciaux). Violet `#6D28D9` RÉSERVÉ au statut « facturé » → ne jamais l'assigner à une personne. Édition prévue via Settings → Équipe (Phase 2). Seed initial Mayer = migration `20260620_planning_member_colors.sql`. » — OU : juger si ce détail (couplé à la Phase 2 UI non livrée) reste en mémoire/`docs/MODULE_PLANNING.md` jusqu'à ce que l'UI d'édition atterrisse.
---

## [2026-06-20 09:53] Planning — module pur planningEvents.js (couleur RDV + buckets + filtres)
**Statut** : PENDING (suite directe de l'entrée [2026-06-20 09:51] couleurs par personne)
**Commit** : bc1d94c4903f194db79f68251be05693d78e4b57
**Contexte** : Nouveau module PUR `src/lib/planningEvents.js` (aucun import React/Supabase, node-testé via `scripts/planning-events.test.mjs`) qui consomme les couleurs par personne. Pose les conventions de résolution couleur + filtres du calendrier : buckets de type (`COMMERCIAL_TYPES = rdv_agency|rdv_technical` / `TECHNICIAN_TYPES = installation|maintenance|service` / sinon `other`), résolution couleur d'un RDV par propriétaire avec override violet `INVOICED_EVENT_COLOR` (#6D28D9) si `target_invoiced`, fallback slate `FALLBACK_PERSON_COLOR` (#94A3B8), unification d'identité humaine par `profile_key` (= `team_members.user_id` = `commercials.profile_id`) pour dédoublonner Philippe/Michel (tech + commercial → 1 humain), prédicats `matchesKindFilter` (« Autre » toujours visible) / `matchesMemberFilter` (Set de recordIds, vide = tout). Pas encore consommé par l'UI dans ce commit.
**Proposition** : Ajouter au § Module Planning de CLAUDE.md (à graver quand l'UI consomme le module) : « **Helpers calendrier purs** : `src/lib/planningEvents.js` (node-testé `scripts/planning-events.test.mjs`) — buckets de type (`COMMERCIAL_TYPES`=rdv_agency/rdv_technical, `TECHNICIAN_TYPES`=installation/maintenance/service, sinon `other`), `resolveAppointmentColor(appt, maps)` (couleur du propriétaire, override violet `INVOICED_EVENT_COLOR` #6D28D9 si facturé, fallback `FALLBACK_PERSON_COLOR` #94A3B8), `buildPersonColorMaps` / `buildTeamList` qui unifient une personne présente en tech ET commercial via `profile_key` (= `team_members.user_id` = `commercials.profile_id`), prédicats `matchesKindFilter`/`matchesMemberFilter`. » — OU : juger si ce détail reste en mémoire/`docs/MODULE_PLANNING.md` tant que l'UI (EventModal / page Planning) ne consomme pas encore le module.
---

## [2026-06-20 10:02] Planning — couleurs par personne + module pur planningEvents.js
**Statut** : PENDING
**Commit** : 6303d6d7de33db2cd5e05b7f7d3405c7b6b71859
**Contexte** : Nouveau helper PUR `src/lib/planningEvents.js` (aucun import React/Supabase, testé via `scripts/planning-events.test.mjs`) consommé par `useAppointments.js`. La couleur d'un RDV est désormais résolue par personne (couleur du team_member) au lieu d'une couleur par type. Les filtres planning changent de forme : `filters.memberIds` → `filters.kinds {intervention, commercial}` (2 toggles bucket) + `filters.memberProfileKeys` (chips équipe dédupliquées). `useAppointments` expose maintenant `teamList` (auparavant construit dans `Planning.jsx`). `toCalendarEvent(a, { color })` accepte une couleur.
**Proposition** : Ajouter au § « Module Planning / RDV ↔ Kanban » :
- **Couleur de RDV par personne** : `src/lib/planningEvents.js` (module PUR, testé `scripts/planning-events.test.mjs`) résout la couleur d'un event = couleur `calendar_color` du propriétaire (commercial préféré pour VT/agence, sinon technicien), override **violet `#6D28D9`** si `target_invoiced`, fallback slate `#94A3B8`. `appointmentsService.toCalendarEvent(a, { color })`.
- **Identité humaine unifiée par `profile_key`** : `team_members.user_id` === `commercials.profile_id` → une même personne présente dans les 2 tables (Philippe, Michel) est dédupliquée. `buildTeamList`/`buildPersonColorMaps` exposent `recordIds[]` (union team_member.id + commercial.id) pour matcher les RDV. `useAppointments` retourne `teamList` (source unique pour filtres + EventModal).
- **Filtres planning** : `filters = { kinds: {intervention, commercial}, memberProfileKeys[], appointmentType, status }`. Buckets : `COMMERCIAL_TYPES=['rdv_agency','rdv_technical']`, `TECHNICIAN_TYPES=['installation','maintenance','service']`, tout autre type = `'other'` (toujours visible). Prédicats `matchesKindFilter`/`matchesMemberFilter`.
---

## [2026-06-20 10:26] Gotcha planning : RDV multi-tech découpé en N blocs FullCalendar (id composite)
**Statut** : PENDING
**Commit** : aeb63f2d2037b02b15554b5ba281d289f489ddbb
**Contexte** : Sur le calendrier, un RDV intervention/install à ≥2 techniciens est désormais rendu comme 1 bloc PAR technicien (chacun sa couleur), via `expandAppointmentBlocks(appt, maps, selectedRecordIds)` dans `src/lib/planningEvents.js` + `flatMap` dans `useAppointments`. `toCalendarEvent` accepte un `idSuffix` qui rend l'event FullCalendar unique : son `id` devient `${appointment.id}__${techId}`. L'id réel du RDV reste dans `extendedProps.id`. Les handlers drag/resize de `Planning.jsx` lisent maintenant `event.extendedProps.id || event.id`.
**Proposition** : Ajouter au module Planning (CLAUDE.md ou docs/MODULE_PLANNING.md) le gotcha : « Affichage calendrier ≠ "1 RDV = 1 carte". Un RDV intervention/Autre à ≥2 techniciens est éclaté en 1 bloc coloré par technicien (couleur = personne). FullCalendar exige un id unique par event → l'id du bloc devient `${appointment.id}__${techId}` ; TOUJOURS lire l'id réel du RDV via `event.extendedProps.id` dans les handlers (drag/resize/clic), jamais `event.id`. Découpage géré par `expandAppointmentBlocks` (facturé→1 bloc violet, mono-tech ou RDV commercial→1 bloc ; restreint aux techniciens visibles si filtre équipe actif). » — à trancher : doit-on documenter ce nouveau pattern d'id composite comme convention durable, ou est-ce un détail d'implémentation interne au module Planning ?
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
