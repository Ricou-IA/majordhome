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
---

## [2026-09-12 11:30] Tournées — souplesse des RDV : « fenêtres d'abord, heures ensuite »
**Statut** : PENDING
**Commits** : eb37d4e · 0fe70c4 · df733e7 · 0526e1b · e44a5c7 · 55319ae
**Contexte** : Spec `docs/superpowers/specs/2026-09-12-tournees-fenetres-et-consolidation-design.md`. Chaque RDV porte une souplesse ; le moteur peut glisser UN voisin adaptable ; « Figer la journée » ordonnance et communique les heures.
**Proposition** (section « Module Planning / RDV ↔ Kanban » ou « Module Entretiens », règles qui mordent) :
- **Souplesse d'un RDV** = `appointments.time_flex_minutes` (0 figé / 15 / 30 / 240 demi-journée, **NULL = défaut d'org** `settings.tournees.souplesse_defaut_minutes` = 30) + `appointments.hour_confirmed_at` (heure communiquée au client ⇒ figé, quel que soit `time_flex_minutes`). **Décision Eric 2026-09-12 : tous les RDV existants sont adaptables par principe** ; on fige au cas par cas (modale d'édition du Planning, `SectionSouplesse`). Source unique des libellés/annonce : `src/lib/souplesse.js` ; composant unique `SouplesseSelect`.
- **Un RDV figé ne bouge jamais** : `arrets.js::toleranceDe` lui donne une tolérance ponctuelle ; `placerCandidat` ne décale qu'un voisin **adaptable** (au plus un par insertion, sans casser le voisin du voisin) ; `sequencerTournee` (de retour en prod pour la consolidation) le traite comme point fixe.
- **`construireArretsExistants(rdvs, depot, opts)`** : sans `opts`, tolérance = fenêtre ponctuelle (comportement d'avant — c'est ce que fait encore l'onglet Tournées) ; avec `opts` (`flexDefaut`, `amplitude`, `demiJournee`), les voisins deviennent décalables — c'est ce que fait le CTA via `proposerPourContrat`. Ne pas passer `opts` par réflexe : l'appelant doit savoir écrire les décalages (`scheduleEntretien({ decalages })`).
- **Classement du CTA** = `scoreMinutes` = coût + temps perdu (`resteUtileMinutes` sous `reste_utile_min_minutes` = 75) ; l'écran montre trajet / travail / reste utile, jamais le détour net.
- **Pose** : `scheduleEntretien({ timeFlexMinutes, decalages })` écrit le RDV puis les décalages ; un décalage refusé remonte `decalage_refuse` (le RDV est posé, l'écran le dit).
- **Consolidation** : bouton « Figer la journée » (panneau de journée, onglet Tournées) → `useConsolidationJournee` → heures définitives + `hour_confirmed_at` + SMS campagne `heure_de_passage` (gabarit `settings.sms.templates.heure_de_passage` à créer — absent ⇒ affiché, jamais avalé). Pas de consolidation automatique en V1.
- **Affichage** : bloc pointillé à l'heure provisoire + événement de fond `__band` (ni cliquable ni déplaçable) sur la fenêtre ; ↔ adaptable / 🔒 figé. Les handlers Planning lisent `extendedProps.id` (inchangé).
---
