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

## [À INTÉGRER] mail_segment_compile — appartenance segment = placement Pennylane
**Statut** : PENDING → CLAUDE.md § Module Mailing > RPCs (sous `mail_segment_compile`)
**Commit** : 3916c1c · détail complet : archive, entrée [2026-06-16 01:49]
**À graver** : pour les statuts PL-driven (Devis envoyé / Gagné / Perdu), `mail_segment_compile` dérive l'appartenance d'un segment leads de `majordhome_kanban_cards.column_key` (MT-LT inclus), PAS de `leads.status_id` (figé). Branche PL active seulement si `p_org_id` non NULL (sinon fallback `status_id`). Mapping label→column_key (devis_envoye / gagne / perdu). Vérifié : poêle 34→27, Devis envoyé 69→59, Contacté inchangé. Question ouverte : `mail_segment_count`/`preview` héritent-ils bien de la même RPC ?
---

## [À INTÉGRER] SMS rappel entretien — état "déjà relancé" = dérivé sms_logs/an (option A)
**Statut** : PENDING → CLAUDE.md § Module Mailing/SMS (le gros est déjà couvert via phoneUtils ; manque CE détail)
**Commits** : ba7c732 / 93f606b / b59054b / 70225d7 (poussés main, testé end-to-end) · détail : archive [2026-06-16 09:50]
**À graver** : 2ème campagne SMS (distincte de `avis_j1`). Bulle SMS sur l'onglet Programmation (`SectorGroupView`), uniquement contrats « à planifier », permission `can('entretiens','create')`. État « déjà relancé cet an » = **option A** : dérivé de `majordhome_sms_logs` (`campaign_name='rappel_entretien'`, `sent_at ≥ 01/01`), pas de colonne dédiée, reset implicite au 01/01, cache key `smsKeys.remindedClients(orgId, year)`. Webhook `VITE_N8N_WEBHOOK_SMS_RAPPEL`. Gotcha : `sms_logs` sans `contract_id` → état indexé par `client_id` (un multi-contrats est marqué après 1 envoi, acceptable V1).
---

## [À INTÉGRER] Invariant « Gagné » piloté par Pennylane sur toutes les surfaces
**Statut** : PENDING → CLAUDE.md § Règles métier Pipeline ↔ PL
**Commit** : 667384b · détail : archive [2026-06-17 22:22]
**À graver** : sur une org PL-enabled, passage manuel en « Gagné » interdit sur TOUTES les surfaces — seule voie = `lead_mark_won_with_quote`. Board (`LeadKanban`) : drag vers Gagné refusé dès `pennylaneActive` (avec/sans devis). Drawer Long Terme (`LongTermLeadDrawer`) : bouton « Gagné » ouvre `MarkWonQuoteModal` si ≥1 devis, sinon toast exigeant un rattachement. Le Long Terme n'est qu'un autre affichage de « Devis envoyé », jamais plus permissif. Org sans PL : bascule manuelle conservée (autonomie multi-tenant).
---

## [À INTÉGRER] Invariant « Perdu » piloté par Pennylane si devis attaché
**Statut** : PENDING → CLAUDE.md § Règles métier Pipeline ↔ PL
**Commit** : fa8880b · détail : archive [2026-06-17 22:30]
**À graver** : sur une org PL-enabled, passage manuel en « Perdu » bloqué UNIQUEMENT si ≥1 devis attaché (marquer refusés dans PL → bascule quand 100% refused/denied/canceled via `majordhome_kanban_cards`). **Asymétrie volontaire avec Gagné** : perte DIRECTE (lead SANS devis : RDV non pertinent, ghost) reste autorisée partout (bouton Perdu conservé sur Nouveau/Contacté/RDV planifié). Surfaces gardées : board (`pennylaneActive && hasDevisPl`), drawer LT (`pennylaneActive && linkedQuotes.length>0`), fiche lead (déjà conforme via `PL_DRIVEN_STATUSES`). Org sans PL : conservé.
---

## [2026-06-19 00:22] Solaire — scénarios par paliers commerciaux 3/6/9 + carte « Optimisé »
**Statut** : PENDING
**Commit** : f2c2cbb974013e9e8915e3e81c655b0df3ad0b2c
**Contexte** : Refonte du dimensionnement du calculateur PV (`pvEngine.js`). Les 3 scénarios Sobre/Recommandé/Confort (paliers ±0,5 kWc autour de l'optimum, jugés irréalistes) sont remplacés par les paliers commerciaux réels (multiples de 3 : 3/6/9 kWc, bornés `min(toiture, plafond 9)`) PLUS une carte « Optimisé » = `recommendedKwc` de `optimize()`. `buildScenarios({recommendedKwc, maxKwc, increment=OFFER_INCREMENT_KWC})` perd le param `stepKwc` ; nouvelle fonction `defaultScenarioKwc({scenarios, recommendedKwc})` choisit le palier pré-sélectionné. Fusion si l'optimum tombe pile sur un palier (pas de carte doublon) ; petite toiture (<3 kWc) → carte Optimisé seule.
**Proposition** : Ajouter au § Module Solaire de CLAUDE.md : « **Scénarios = paliers commerciaux + Optimisé (révision 2026-06-18)** : `buildScenarios({recommendedKwc, maxKwc, increment=OFFER_INCREMENT_KWC=3})` retourne les paliers multiples de 3 (3/6/9, bornés `min(toiture, max_power_kwc)`) + une carte « Optimisé » flaggée `isOptimum` (= `recommendedKwc` de `optimize()`). Si l'optimum tombe pile sur un palier → fusion (le palier porte `isOptimum`, pas de doublon). Petite toiture (<3 kWc) → carte Optimisé seule. Défaut sélectionné = `defaultScenarioKwc({scenarios, recommendedKwc})` = palier le plus proche de l'optimum (égalité → le plus grand, ne pas sous-dimensionner) ; un `selectedKwc` explicite présent dans les scénarios prime (`etudeModel.js`). Carte UI : étoile sur l'Optimisé (`ScenarioCards.jsx`), grille `lg:grid-cols-4`. » — OU : juger si cette granularité a sa place dans CLAUDE.md vs uniquement la mémoire `project_solaire_calculateur_pv.md`.
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
