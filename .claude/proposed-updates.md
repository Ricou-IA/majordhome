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


## [2026-09-12 08:30] Tournées — outils de planification « machine-usable » (proposerPourContrat, edge slots-propose, compétences, BAN)
**Statut** : PENDING
**Commits** : 94de549 · d3ca2b1 · e18f692 · 2552eef · ccefc56 · 4924735 · 75b75da · cbcefe9
**Contexte** : Premier cas d'usage Hermes (client au téléphone → créneau optimisé) livré en tranche 1 sans LLM : le moteur Tournées répond désormais à la question inverse (contrat → journées) côté serveur, consommé par un CTA dans ContractModal et, demain, par le serveur MCP. Spec `docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md`, plan `docs/superpowers/plans/2026-09-12-planification-entretien-outils-machine.md`.
**Proposition** (section « Module Entretiens », règles qui mordent) :
- **Moteur Tournées = source unique, copié pour Deno.** `src/lib/tournee/*` (modules purs) est copié dans `supabase/functions/_shared/tournee/` par `npm run sync:tournee-engine` ; `scripts/tournee/sync-engine.test.mjs` (dans `audit:quality`) échoue dès qu'une copie diverge. **Ne jamais éditer les copies** ; après toute modif du moteur : sync + redéployer `slots-propose`. Les chargeurs (`loaders.js`) et la matrice Mapbox (`trajets-core.js`) sont injectables (client supabase passé en paramètre) : `tournees.service.js` / `trajets.service.js` ne sont plus que des wrappers navigateur.
- **`proposerPourContrat` (contrat → créneaux)** : horizon ferme = toute journée du technicien éligible ; au-delà, seules les journées déjà amorcées ; aucun créneau → `nouvellesJournees` (journées vides, signalées à part). Contrainte de période = `fenetreArrivee` de `placerCandidat` (borne l'heure d'ARRIVÉE), pas une amplitude tronquée.
- **Edge `slots-propose`** (verify_jwt + `requireOrgMembership(req, { orgId })`, `org_id` du body vérifié par membership) : erreurs typées `siege_non_configure` / `client_non_localise` / `aucun_technicien` / `contrat_introuvable` ; Mapbox via secret `MDH_MAPBOX_TOKEN`, repli vol d'oiseau **toujours signalé** (`estime:true`).
- **Compétences techniciens = `team_members.specialties` (text[])**, catégories d'équipement, éditables Settings → Équipe ; **vide = polyvalent**. Filtre dur de `techniciensEligibles` (catégories du contrat ⊆ specialties). RPC `team_member_set_routing_settings` a 4 paramètres (l'ancienne signature à 3 a été DROP : PostgREST ne départage pas deux surcharges à défauts).
- **Adresse BAN à la saisie** (`BanAddressInput`, ClientModal + LeadModal) : coordonnées écrites APRÈS l'adresse via RPC `client_set_location` (le trigger `reset_geocode_on_address_change` efface coordonnées ET `address_precision` quand l'adresse change) ; adresse introuvable → « Localiser à la commune » (précision `municipality`, suffisante pour les tournées). `geocode-sweep` retombe aussi sur la commune. Côté lead : texte seulement, le géocodage reste dans `geocodeAndAssignLead`.
- **CTA « Trouver le créneau optimisé »** (ContractModal) : sans LLM ; la pose passe par `ensureEntretienCard` + `scheduleEntretien` (single writer inchangé) ; une « nouvelle journée » renvoie à l'assistant classique.
- Gotcha : `npm run audit:dead-code` échoue depuis le 29/08 sur `src/lib/tournee/sequence.js` (orphelin conservé « hors chemin de prod ») — décider de le supprimer ou de l'allowlister.
---

## [2026-09-12 11:30] SMS — registre de campagnes, onglet Settings → Organisation → SMS, confirmation de RDV
**Statut** : PENDING
**Commit** : (tâche de suite de la tranche 1 Tournées — voir `git log --grep="confirmation_rdv"`)
**Contexte** : Les gabarits SMS (`settings.sms.templates`) étaient posés en SQL sans UI, ce qui bloquait toute nouvelle campagne (règle « pas de config sans UI »). Un onglet SMS édite désormais les gabarits, un registre pur fixe les campagnes et leurs variables, et la pose d'un RDV d'entretien depuis ContractModal envoie une confirmation. Détails : `docs/MODULE_MAILING.md` (sections « Gabarits SMS / WhatsApp » et « SMS confirmation de RDV »).
**Proposition** (section « Module Mailing », règles qui mordent — ou nouvelle sous-section « SMS ») :
- **Campagnes SMS = registre `src/lib/smsCampaigns.js`** (pur, testé) : une entrée par campagne appelée par le code (`avis_j1`, `rappel_entretien`, `confirmation_rdv`) avec ses variables. Les gabarits vivent dans `settings.sms.templates`, **éditables dans Settings → Organisation → SMS** (`SmsTab`) ; l'identité d'expéditeur (`enabled`, `sms_from`, `whatsapp_from`, `short_link_base`) y est en lecture seule (plateforme). **Ajouter une campagne = registre + gabarit saisi dans l'onglet**, jamais un texte en dur ni un `UPDATE` SQL.
- **`campaign_template_missing` est une information, pas une erreur** : tout émetteur l'affiche en `toast.info` pointant vers l'onglet et n'échoue jamais l'action métier qui l'a déclenché (le RDV est posé avant le SMS, non attendu). `settings.sms.enabled !== true` → silencieux (l'edge répond 403 sinon).
- Gotchas SMS : l'edge ne substitue que `{{[a-z0-9_]+}}` → `{{prénom}}` partirait tel quel (l'onglet bloque l'enregistrement) ; `deburr` s'applique au SMS **et** au WhatsApp ; sans `whatsapp_from` le gabarit WhatsApp est ignoré ; `’ ê â î ô û « »` font basculer un SMS en UCS-2 (70 car./segment). `deburrSms` du registre est une **copie** du `deburr()` de l'edge (Deno) : toute évolution touche les deux.
- Confirmation de RDV : envoyée par `ContractModal.handleConfirmScheduling` (CTA créneau optimisé ET planification manuelle), 1 seul créneau, mobile FR. **Non couvert** : kanban entretien et Tournées (`useJourneePose`).
---
