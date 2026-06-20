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
