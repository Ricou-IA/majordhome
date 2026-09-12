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


## [2026-09-12 13:00] SMS — registre de campagnes, onglet Settings → Organisation → SMS, rappel automatique des RDV (cron paramétrable)
**Statut** : PENDING
**Commits** : `3142a4d` (onglet + registre) puis le commit « rappel automatique paramétrable » du même jour (voir `git log --grep="sms-rappel-rdv"`)
**Contexte** : Les gabarits SMS (`settings.sms.templates`) étaient posés en SQL sans UI, ce qui bloquait toute nouvelle campagne (règle « pas de config sans UI »). Un onglet SMS édite les gabarits et un réglage de rappel automatique ; un registre pur fixe les campagnes et leurs variables ; un cron horaire rappelle aux clients leurs RDV d'entretien (la veille ou en début de semaine, au choix de l'org). Pas de SMS à la pose : le planning est une pré-planification validée par téléphone. Détails : `docs/MODULE_MAILING.md` (sections « Gabarits SMS / WhatsApp » et « Rappel automatique des RDV d'entretien »).
**Proposition** (section « Module Mailing », règles qui mordent — ou nouvelle sous-section « SMS ») :
- **Campagnes SMS = registre `src/lib/smsCampaigns.js`** (pur, testé, **copié vers `_shared/` par `npm run sync:tournee-engine`** comme le moteur Tournées — ne jamais éditer la copie) : une entrée par campagne appelée par le code (`avis_j1`, `rappel_entretien`, `rappel_rdv`) avec ses variables. Les gabarits vivent dans `settings.sms.templates`, **éditables dans Settings → Organisation → SMS** (`SmsTab`) ; l'identité d'expéditeur (`enabled`, `sms_from`, `whatsapp_from`, `short_link_base`) y est en lecture seule (plateforme). **Ajouter une campagne = registre + gabarit saisi dans l'onglet**, jamais un texte en dur ni un `UPDATE` SQL.
- **Un seul cœur d'envoi : `supabase/functions/_shared/sms.ts`** (`sendCampaignSms` : rendu, lien court, Twilio WhatsApp→SMS, pré-log/clôture `sms_logs`), utilisé par `sms-send` (appel utilisateur, membership) et `sms-rappel-rdv` (cron, secret). Toute nouvelle edge qui envoie un SMS passe par là — jamais un 2ᵉ appel Twilio ailleurs.
- **`campaign_template_missing` est une information, pas une erreur** : côté front `toast.info` vers l'onglet, côté cron un compteur `skipped` dans le rapport ; l'action métier qui a déclenché l'envoi n'échoue jamais. `settings.sms.enabled !== true` → silencieux (l'edge répond 403 sinon).
- **Rappel des RDV = réglage d'org, pas de planning codé en dur** : `settings.sms.rappel_rdv = { mode: off|veille|hebdo, jour, heure }` (défaut `off`), cron pg_cron `sms-rappel-rdv` **horaire** ; l'edge décide par org via `planifierRappelRdv` (heure H ou H+1 = retentative). Anti-doublon = `appointments.client_notified_at`, remis à NULL par trigger quand date/heure du RDV changent. Périmètre : `maintenance` + `scheduled` uniquement.
- Gotchas SMS : l'edge ne substitue que `{{[a-z0-9_]+}}` → `{{prénom}}` partirait tel quel (l'onglet bloque l'enregistrement) ; `deburr` s'applique au SMS **et** au WhatsApp ; sans `whatsapp_from` le gabarit WhatsApp est ignoré ; `’ ê â î ô û « »` font basculer un SMS en UCS-2 (70 car./segment). Rendu `{{}}` et retrait des accents = `renderSmsTemplate` / `deburrSms` du registre, importés par `_shared/sms.ts` (copie synchronisée) : l'aperçu de l'onglet est le message envoyé. Coût affiché en **SMS** (« Coût de ce message : 3 SMS »), jamais en segments/caractères, toujours sur un exemple rendu.
---

