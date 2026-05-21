# CLAUDE.md - Majord'home Module Artisan

> ⚠️ **Consolidation multi-tenant — Sem 0 hardening DB quasi-finie (~97%, 2026-05-21)** — Une 2ème entreprise va rejoindre la même instance Supabase. Audit complet : `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md` (13 CRITICAL codebase + 131 ERROR Supabase Advisor). État Sem 0 détaillé : mémoire `project_hardening_sem0_status.md`. **Plus rien de bloquant côté Majord'home/core. La roadmap fonctionnelle (Sprints 8-10) peut reprendre.**
> **Dernière MàJ** : 2026-05-21 — Sem 0 hardening DB complète (P0.0.1 exec_sql INVOKER, P0.0.2 73 vues security_invoker, P0.0.4 REVOKE anon × 22 RPCs, P0.0.5/.0.6 RLS + policies 13 tables, P0.0.7 storage paths `${orgId}/`, P0.0.9 audit corps 6 RPCs sensibles, P0.0.10 search_path × 111 fonctions, P0.2 MDH_CRON_SECRET crons, P0.3 pennylane-proxy hardened, P0.4 OAuth GSC state HMAC, P0.5 voice RPC service_role only, P0.6 voice quota daily, P0.7 requireOrganization, P0.8 V2 mailing N8n→edge, P0.10 voice_recorder permission, P0.11 cache keys orgId, P0.13-P0.20 branding multi-tenant, P0.21 headers HTTP, P0.22 no sourcemap, P0.23 xlsx→exceljs, P0.24 sandbox iframes, P0.25 helper `_shared/auth.ts`, P0.26 escapePostgrestSearchTerm, P0.27 ESLint config). Détails : `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`.
> **Détails DB/composants/sprints** : `docs/DATABASE.md`, `docs/COMPONENTS.md`, `docs/SPRINT_LOG.md`

## Projet
Plateforme SaaS métier pour artisans du bâtiment (CVC). CRM, planning, pipeline commercial, outil terrain tablette, carte territoire. Pilote : **Mayer Énergie** (Gaillac, 81). Préparation onboarding 2ème entreprise sur la même instance Supabase.

## Multi-tenant & sécurité (Sem 0 hardening — 97% complet)

8 bombes structurelles initiales + 3 ajoutées en cours d'hardening (P0.2, P0.4, P0.8 V2) :

| # | Bombe | Fix | Statut |
|---|---|---|---|
| 1 | `public.exec_sql(text)` SECURITY DEFINER exécutable par `authenticated` → lecture totale DB depuis le navigateur | `ALTER FUNCTION ... SECURITY INVOKER` (P0.0.1) | ✅ Fait (2026-05-20) |
| 2 | 73 vues `public.majordhome_*` SECURITY DEFINER bypassant RLS → filtre `.eq('org_id')` côté front était la SEULE défense | `ALTER VIEW ... SET (security_invoker=true)` (P0.0.2) | ✅ Fait (2026-05-20) |
| 3 | 24 RPCs SECURITY DEFINER exposées à `anon` (delete_organization, update_user_role, …) | `REVOKE EXECUTE FROM anon` (P0.0.4) | ✅ Fait (2026-05-20) |
| 4 | 13 tables `majordhome.*` sans RLS du tout + 6 policies `USING(true)` | RLS + policies `org_id IN (org_members)` (P0.0.5/.0.6) | ✅ Fait (2026-05-20) |
| 5 | Storage `contracts` / `certificats` / `product-documents` : policy ALL pour tout `authenticated` sans filtre | DROP ALL + 12 policies par bucket avec filtre `(storage.foldername(name))[1]::uuid IN (org_members)` + migration paths `${orgId}/...` (P0.0.7) | ✅ Fait DB (2026-05-21) — N8N upload contrat à migrer côté workflow |
| 6 | Crons Pennylane `verify_jwt:false` publics → invocation anonyme possible (drain quota PL, pollution DB) | Auth header `MDH_CRON_SECRET` timing-safe via helper `requireSharedSecret` (P0.2) | ✅ Fait (2026-05-21) |
| 7 | State OAuth GSC opaque (base64) → CSRF, replay, user-switch entre init et callback | State signé HMAC-SHA256 (`RESEND_WEBHOOK_SECRET`) avec binding `(orgId, userId, returnTo, nonce, exp)` + TTL 10 min + revalidation membership au callback (P0.4) | ✅ Fait (2026-05-21) |
| 8 | Webhook N8n public `mayer-mailing` acceptait `segment_sql` brut → exfil cross-org possible si URL du webhook fuite | Migration N8n→edge function `mailing-send` qui n'accepte que `segment_id`/`client_id` + RPC `mail_fetch_recipients` membership-checked (P0.8 V2). Workflow N8n archivé. | ✅ Fait (2026-05-21) |

**Règles imposées par le multi-tenant** :
- Toute mutation Supabase doit explicitement filtrer par `org_id` (défense en profondeur, même si RLS s'applique via `security_invoker`)
- Tout nouveau RPC SECURITY DEFINER doit `REVOKE EXECUTE FROM anon` immédiatement après création (sauf webhooks publics légitimes)
- **RPC SECURITY DEFINER qui prend `org_id` dans son payload** (sans le dériver d'`auth.uid()`) : `REVOKE FROM PUBLIC, anon, authenticated`, accessible seulement à `service_role`. Sinon un attaquant authentifié peut forger un `org_id` arbitraire et écrire cross-org. Exemple : `record_voice_memo_extraction` (P0.5)
- Tout nouveau bucket Storage doit utiliser `${orgId}/...` en préfixe de path + policies `(storage.foldername(name))[1]::uuid IN (org_members)`
- Toute nouvelle table `majordhome.*` doit avoir RLS activée + policies CRUD scopées org_id dès la création
- Toute nouvelle vue `public.majordhome_*` doit être créée avec `WITH (security_invoker=true)`
- Ne JAMAIS appeler `public.exec_sql` depuis le frontend
- **Ne JAMAIS construire de SQL dynamique côté frontend pour le mailing** (ou tout flux multi-tenant). Passer par une RPC SECURITY DEFINER qui vérifie `auth.uid() ∈ org_members` avant compile (cf. `mail_segment_compile_safe`, `mail_single_client_sql`, `mail_fetch_recipients`)
- **Toute clause PostgREST `.or()` / `.ilike()` qui interpole un input utilisateur** DOIT passer par `escapePostgrestSearchTerm()` (`src/lib/postgrestUtils.js`) avant interpolation. Strip `,()*:%\` empêche un attaquant de forger un filtre additionnel (P0.26)
- **Toute edge function `verify_jwt:false`** qui n'est PAS un webhook tiers légitime (Resend, Pennylane callback signé) doit exiger un secret partagé via `requireSharedSecret(req, MDH_CRON_SECRET)` du helper `_shared/auth.ts` (P0.2/P0.25)
- **Toute edge function `verify_jwt:true`** doit valider la membership via `requireOrgMembership(req, opts)` du helper `_shared/auth.ts` (P0.25)
- **Intégrations conditionnelles par org** : utiliser un flag dans `core.organizations.settings` (ex `{ pennylane: { enabled: true } }`) consommé via `orgSettingsFilter` de `requireOrgMembership`. Pattern à étendre pour Meta Ads, intégrations futures (P0.3)
- **Cache keys React Query** : toutes les familles utilisent `all: (orgId) => [domain, orgId]` (convention pricingKeys-style). Détails dans l'en-tête de `cacheKeys.js` (P0.11)
- **Toute valeur de branding** (nom, adresse, URL, certification, couleur, logo) DOIT passer par `core.organizations.settings` + helper `buildCompanyInfo(settings)` de `src/lib/orgBranding.js` plutôt que d'être hardcodée. Fallback Mayer accepté uniquement comme valeur par défaut dans le helper (P0.13-P0.20)
- **Toute clé `localStorage`** doit être suffixée par `:${orgId}` (cache org-scoped) ou `:${userId}` (draft personnel) pour éviter fuite cross-org au switch d'organisation. Ex : `territoire-zones-v8:${orgId}` (`useMapZones`), `intervention-draft-${userId}_${id}` (`useInterventionDraft`) (P1.9)

## Stack
- React 18 + Vite 5 + React Router 6
- Supabase (PostgreSQL + Auth + Storage)
- Tailwind CSS 3.4 + Radix UI
- TanStack React Query v5
- React Hook Form + Zod
- FullCalendar 6 (planning)
- Recharts (graphiques)
- Mapbox GL JS + react-map-gl + @turf/turf (carte territoire)
- Sonner (toasts), Lucide React (icons)
- N8N (webhooks, automatisations)

## Commandes
```bash
npm run dev               # Dev server (port 5173)
npm run build             # Build production
npm run lint              # ESLint (max-warnings = count actuel, regression guard CI)
npm run lint:errors       # ESLint errors uniquement (--quiet)
npm run audit:dead-code   # Détecte les fichiers sources jamais importés
npm run audit:quality     # lint:errors + audit:dead-code (à lancer avant PR)
```

**Pre-commit hook actif** (`.githooks/pre-commit`) : lance `npm run lint:errors` avant chaque commit, bloque si une error apparaît. Setup automatique via `npm prepare` (`git config core.hooksPath .githooks`). Bypass d'urgence : `git commit --no-verify`.

## Conventions qualité (2026-05-21)

Règles pour maintenir le niveau atteint après le hardening Sem 0 + audit qualité. **Ces règles s'appliquent à toute nouvelle feature ou refacto** :

### Composants (.jsx)
- **Pas de composant > 500 LOC** sans découpage en sous-composants (orchestrateur + sections)
- **Pas de composant > 10 `useState`** sans envisager `useReducer` ou state machine. >15 useState = obligatoire à refacto
- **Pas de logique business dans le JSX** : extraire dans des hooks ou des helpers `src/lib/`
- **Tailwind only** : pas de CSS modules, pas de styled-components

### Services (`src/shared/services/`)
- **Pas de service > 700 LOC** sans décomposition en sous-modules (cf. `clients.service.js` → délègue à `equipments.service.js`)
- Toujours retourner `{ data, error }` ou `{ data, count, error }` — jamais throw au caller
- **Toujours destructurer `{ error }`** sur `update/insert/delete` Supabase (cf. Gotchas DB)
- Utiliser `withErrorHandling()` du helper `serviceHelpers.js` pour wrapper les async

### Hooks (`src/shared/hooks/`)
- Toujours utiliser les cache keys centralisées de `cacheKeys.js` (jamais inline)
- Toutes les keys prennent `orgId` en 1ᵉʳ paramètre (convention P0.11, voir en-tête `cacheKeys.js`)
- `enabled: !!orgId && ...` obligatoire sur les `useQuery` qui dépendent d'orgId
- Pas de console.* en prod : utiliser `import { logger } from '@lib/logger'` (no-op en prod, sauf `logger.error`)

### Cache keys
- Convention pricingKeys-style : `all: (orgId) => [domain, orgId]` + sous-keys avec orgId en 1ᵉʳ
- Pas de key avec préfixe statique partagé (`['clients']` direct) — utiliser `clientKeys.all(orgId)`

### Sécurité (charte multi-tenant — cf. section ci-dessus)
- Toute mutation Supabase doit explicitement filtrer par `org_id`
- Tout nouveau RPC SECURITY DEFINER : `REVOKE FROM anon` immédiat. Si payload contient `org_id` → `REVOKE FROM authenticated` aussi (service_role only)
- Tout nouveau bucket Storage : path `${orgId}/...` + policies `(storage.foldername(name))[1]::uuid IN (org_members)`
- Toute clause PostgREST `.or()` / `.ilike()` interpolant un input user : passer par `escapePostgrestSearchTerm()`
- Toute edge function : utiliser `requireOrgMembership` ou `requireSharedSecret` du helper `_shared/auth.ts`

### Code mort
- **Lancer `npm run audit:dead-code` avant chaque PR feature majeur** — identifie les fichiers jamais importés
- Si tu retires un import : vérifier que le fichier source n'a plus aucun caller, et le supprimer
- Si tu crées un composant "partagé" : le consommer dans au moins 1 endroit dans le même commit (sinon il devient mort dès la naissance — vu sur ColumnHeader, useModalManager)

### Dette technique
- **1 nouveau warning ESLint → fix immédiat** (le `--max-warnings` du script `lint` est défini sur le count actuel pour empêcher la régression)
- Si tu touches un fichier identifié comme dette (LeadModal, clients.service.js, etc.) : profiter pour le décomposer un peu plus dans le même commit
- TODOs : OK temporairement avec une raison claire (ex `// TODO P0.X — à faire`), mais ne pas les laisser pourrir > 1 mois

## Architecture
```
src/
├── main.jsx                    # Point d'entrée
├── App.jsx                     # Routes
├── lib/                        # supabaseClient, mapbox, territoire-config, serviceHelpers, phoneUtils, constants
├── contexts/AuthContext.jsx     # Auth + org + rôles
├── pages/                      # Pages publiques (Login, Reset)
├── components/
│   ├── ProtectedRoute.jsx
│   └── ui/                     # Radix UI (button, card, input, tabs, confirm-dialog...)
├── layouts/AppLayout.jsx       # Sidebar + header
├── hooks/pipeline/             # useDashboardData, useDashboardFilters
├── apps/artisan/
│   ├── routes.jsx              # Routes lazy-loaded (16 routes)
│   ├── pages/                  # Dashboard, Clients, ClientDetail (+ client-detail/Tab*.jsx), Pipeline, Planning, Chantiers, Entretiens, Territoire, InterventionDetail, Settings, Profile, Mailing, GeoGrid
│   └── components/
│       ├── FormFields.jsx      # Composants formulaire partagés (FormField, TextInput, etc.)
│       ├── shared/             # KanbanBoard, SearchBar (composants génériques)
│       ├── clients/            # ClientModal+Tabs (4 onglets: Info/Contrat/Équipements/Historique), ClientCard, EquipmentList, EquipmentFormModal
│       # Note : ClientDetail a 6 onglets : Info/Contrat/Équipements/Interventions/Timeline/Mailings
│       ├── chantiers/          # ChantierKanban, ChantierCard, ChantierModal, ChantierInterventionSection
│       ├── entretiens/         # CreateContractModal+Steps, ContractModal, ContractsList, EntretiensDashboard
│       ├── pipeline/           # LeadModal+FormSections+StatusConfig, LeadKanban, LeadList, SchedulingPanel
│       ├── planning/           # EventModal+FormSections+Confirmations, TechnicianSelect, MiniWeekCalendar
│       ├── territoire/         # TerritoireMap, MapControls, MapPopup, MapSearch, useMapZones, useTerritoireData
│       └── geogrid/            # ScanTab, KeywordListsPanel, BenchmarksPanel, BenchmarkLauncher, BenchmarkResultTable, ScanConfigPanel, ScanHistory, GeoGridMap, communesService
├── apps/prospection/
│   ├── _shared/
│   │   ├── lib/               # sireneApi, scoringCedants, scoringCommercial
│   │   ├── hooks/             # useSireneSearch
│   │   └── components/        # SearchSireneModal, ProspectTable, ProspectKPIs, ProspectFilters, ProspectDrawer
│   ├── cedants/               # config, CedantsPipeline
│   └── commercial/            # config, CommercialPipeline
└── shared/
    ├── services/               # auth, clients, contracts, chantiers, entretiens, geocoding, territoire, prospects, storage
    └── hooks/                  # cacheKeys, usePaginatedList, useDebounce + useClients, useContracts, useChantiers, useLeads, useAppointments, useProspects, etc.
```

## Aliases (vite.config.js)
`@` → `src/`, `@components`, `@pages`, `@layouts`, `@contexts`, `@lib`, `@services` → `src/shared/services`, `@hooks` → `src/shared/hooks`, `@hooksPipeline` → `src/hooks/pipeline`, `@apps`

## Base de Données (Supabase)

### Schémas
- **`core`** : profiles, organizations, organization_members
- **`majordhome`** : clients, equipments, interventions, leads, appointments, contracts, etc.
- **`public`** : vues qui exposent core/majordhome

### Pattern d'accès frontend
```javascript
// Tables avec vue publique → supabase.from('majordhome_clients')
// Tables sans vue → supabase.schema('majordhome').from('leads')
// TOUJOURS filtrer par org_id explicitement : .eq('org_id', orgId)
```

### Gotchas DB
- **Séquences PostgreSQL** : Ne JAMAIS calculer manuellement un ID/numéro via `SELECT MAX(col) + 1`. Toujours laisser le DEFAULT de la séquence DB (`nextval()`) générer la valeur — atomique, évite race conditions et désynchronisation. Exemple : `majordhome.client_number` utilise `majordhome.client_number_seq`, toute insertion doit omettre `client_number` pour que le DEFAULT s'applique.
- **Vérifier l'erreur sur les mutations Supabase** : Toujours destructurer `{ error }` sur `update()` / `insert()` / `delete()`, même sur des opérations qu'on pense sûres. Triggers DB, RLS ou contraintes peuvent causer des échecs silencieux. Pattern : `const { data, error } = await supabase.from(...).update(...); if (error) { ... }`. Vu en pratique avec un trigger fantôme `set_geogrid_scans_updated_at` qui faisait échouer silencieusement les UPDATE de `benchmark_id`.
- **Schema `majordhome` non exposé via PostgREST** : `supabase-js` côté edge function ne peut PAS écrire dans `majordhome.*` via `.schema('majordhome').from(...)` — PostgREST renvoie "Invalid schema: majordhome". Pattern obligatoire : RPC SECURITY DEFINER dans `public` avec `SET search_path = majordhome, public`. Le schema `core` est en revanche exposé (asymétrie). Même pattern déjà utilisé pour les écritures N8N → Supabase.
- **Vues `public.majordhome_*` → `security_invoker=true`** (P0.0.2, ✅ 2026-05-20) : avant le fix, les 73 vues étaient SECURITY DEFINER par défaut, ce qui bypassait RLS et faisait du filtre `.eq('org_id', orgId)` côté front la SEULE défense effective contre le cross-org. Aujourd'hui en `security_invoker=true`, RLS s'applique sur tous les accès via PostgREST. **Garder quand même le `.eq('org_id', orgId)` explicite (défense en profondeur)**. Si on crée une nouvelle vue `majordhome_*`, mettre `WITH (security_invoker=true)` dès la création.
- **`public.exec_sql(text)` → SECURITY INVOKER** (P0.0.1, ✅ 2026-05-20) : avant le fix, cette fonction était SECURITY DEFINER exécutable par `authenticated` → permettait à n'importe quel user front authentifié de lire toute la DB via une requête SQL arbitraire. Maintenant en INVOKER, restreinte aux droits du caller. **NE PAS rajouter d'appels à cette fonction depuis le frontend** ou des edge functions exposées au public.
- **Gotcha `DROP SCHEMA` + Exposed schemas PostgREST** (incident 2026-05-21, 30 min downtime) : Ne JAMAIS `DROP SCHEMA xxx CASCADE` sans avoir d'abord vérifié que le schéma n'est PAS listé dans **Dashboard Supabase → API Settings → "Exposed schemas"**. Si oui : (1) retirer le schéma de la liste exposée, (2) attendre le re-deploy PostgREST (~30s), (3) puis seulement DROP. Sinon → 503 sur TOUTE l'API REST de l'instance (toutes les apps cohabitantes impactées). Symptôme : PGRST002 "Could not query the database for the schema cache" côté frontend, `ERROR: schema "xxx" does not exist` côté logs postgres. Fix d'urgence : `CREATE SCHEMA IF NOT EXISTS xxx; NOTIFY pgrst, 'reload schema';`. **Un schéma vide listé en exposed schemas EST une dépendance même sans objet dedans.**

### Vues publiques principales
- `majordhome_clients` → clients + has_active_contract calculé
- `majordhome_contracts` → contracts JOIN clients (client_name, client_address, etc.)
- `majordhome_appointments` → appointments + client_first_name, assigned_commercial_id
- `majordhome_chantiers` → leads filtrés (chantier_status IS NOT NULL) + JOIN equipment_type + intervention parent
- `majordhome_prospects` → prospects JOIN profiles (created_by_name, assigned_to_name)
- `majordhome_prospect_interactions` → interactions JOIN profiles (created_by_name)
- `majordhome_mailing_logs` → historique des emails envoyés par campagne (client_id, lead_id, campaign_name, subject, email_to, sent_at, status, provider_id, error_message, delivered_at, opened_at, clicked_at, bounced_at, complained_at, last_event_at, open_count, click_count)
- `majordhome_mailing_events` → audit log complet des events webhook Resend (1 ligne par event reçu, dédupliqué par svix_id)
- `majordhome_equipments`, `majordhome_interventions`, `majordhome_maintenance_visits`
- `majordhome_geogrid_scans`, `majordhome_geogrid_results`, `majordhome_geogrid_keyword_lists`, `majordhome_geogrid_benchmarks`
- `profiles`, `organizations`, `organization_members` (vues core)

### Org cible
**Mayer Energie** : `org_id = 3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`

## Rôles & Permissions
| Rôle | Permissions |
|------|-------------|
| `org_admin` | Tout gérer |
| `team_leader` | Clients, planning, assignation |
| `user` (technicien) | Vue projets, rapports terrain |

```jsx
const { isOrgAdmin, isTeamLeaderOrAbove, canAccessPipeline } = useAuth();
// canAccessPipeline = isOrgAdmin OU business_role === 'Commercial'
```

- **RPC `public.org_seed_permissions(p_org_id)`** (P1.8, 2026-05-21) — copie les permissions Mayer comme template pour provisioning d'une nouvelle org. SECURITY DEFINER, `service_role` only, idempotent.

## Conventions de Code

### Services (`src/shared/services/`)
- Pattern : `export const xxxService = { async method() {...} }`
- Retour : `{ data, error }` ou `{ data, count, error }`
- **`storage.service.js`** : Opérations Storage Supabase centralisées (`getSignedUrl`, `uploadFile`, `deleteFile`)
- **`serviceHelpers.js`** (`src/lib/`) : `withErrorHandling()`, `extractRpcResult()`, `getMajordhomeOrgId()`
- **`phoneUtils.js`** (`src/lib/`) : `cleanPhone()`, `formatPhoneForSearch()` (pour la recherche en base)

### Hooks (`src/shared/hooks/`)
- TanStack React Query v5
- **Cache keys centralisées** : `src/shared/hooks/cacheKeys.js` — source unique pour toutes les query keys
  - Import : `import { clientKeys } from '@/shared/hooks/cacheKeys'`
  - Familles : clientKeys, contractKeys, leadKeys, appointmentKeys, interventionKeys, chantierKeys, prospectKeys, pricingKeys, mailingKeys, pennylaneSyncKeys, geogridKeys
  - Re-exports depuis chaque hook pour rétrocompatibilité
  - **Convention P0.11 (2026-05-21)** : toutes les keys prennent `orgId` en 1ᵉʳ paramètre (`all: (orgId) => [domain, orgId]`, sous-keys idem) — défense en profondeur multi-tenant. Détails dans l'en-tête de `cacheKeys.js`.
- **`usePaginatedList`** : Hook générique pour listes paginées (utilisé par useClients, useProspects)
- **`useDebounce`** : Hook utilitaire de debounce (remplace les implémentations manuelles)
- **`usePennylaneSyncClient`** : Sync client MDH→Pennylane (fire-and-forget, ne bloque pas UX). Le code 411 Pennylane est récupéré et stocké dans `clients.pennylane_account_number`. Erreurs loggées silencieusement (`console.warn`). Cron `pennylane-sync-cron` : ne calcule JAMAIS `client_number` manuellement, laisse la séquence DB le générer (cf. Gotchas DB).
- Retournent : `{ data, isLoading, error, refetch, ...mutations }`

### Edge functions (`supabase/functions/`)
- **Helper partagé `_shared/auth.ts`** (P0.25, 2026-05-21) — pose la convention d'auth pour toutes les edges :
  - `verify_jwt:true` → `requireOrgMembership(req, { orgId?, orgSettingsFilter?, requiredRole? })` — valide JWT user + membership user × org dans `core.organization_members`. Retourne `{ ok, userId, orgId, membershipRole, supabase }` ou `{ ok:false, response }` 401/403/500 prête à renvoyer.
  - `verify_jwt:false` (crons N8n, jobs internes) → `requireSharedSecret(req, Deno.env.get("MDH_CRON_SECRET") || "", "MDH_CRON_SECRET")` — check Bearer secret timing-safe.
  - Webhooks tiers (Resend Svix, Pennylane callbacks) → garder leur propre vérification de signature.
  - Exports : `corsHeaders`, `buildCorsHeaders(req)`, `jsonResponse(body, status, req?)`, `getAdminClient`, `timingSafeEqual`, `sanitizeError(err, fallback)`.
  - Pattern d'import : `import { requireOrgMembership } from "../_shared/auth.ts";` — le `name` du fichier dans le `files` array du MCP `deploy_edge_function` doit être `../_shared/auth.ts` pour que le bundler résolve correctement.
- **Helpers P1** (2026-05-21) : `sanitizeError(err, fallback)` strip stack/Bearer/JWT/`*_SECRET=…` en prod (détecté via env `DENO_ENV=production` ou `ENVIRONMENT=production`) ; `buildCorsHeaders(req)` whitelist d'origines via env CSV `FRONTEND_ORIGINS` (fallback `*` si vide — dev local).
- **`supabase/config.toml`** (P1.6, 2026-05-21) — versionne `verify_jwt` des 16 edges pour éviter drift prod/repo lors d'un redéploiement via MCP.
- **Edges déjà migrées vers le helper** (2026-05-21) : `gsc-oauth-init`, `pennylane-proxy`, `pennylane-sync-cron`, `pennylane-backfill-quotes`, `voice-extract-fieldreport`. À migrer plus tard : `gsc-oauth-callback`, `gsc-sync`, `mailing-send`, `contract-signed-notify`, `mailing-unsubscribe`, `resend-webhook`, `invite-client`.
- **`MDH_*` namespace** pour les env vars partagées entre apps cohabitantes (isolation Majord'home vs Pack Vendeur / Baikal / Arpet) : `MDH_CRON_SECRET`, etc.

### Composants
- Fichiers .jsx, PascalCase
- Tailwind (pas de CSS modules)
- Toasts : `toast.success()`, `toast.error()`
- Routes lazy-loaded dans `src/apps/artisan/routes.jsx`
- **Composants formulaire partagés** : `src/apps/artisan/components/FormFields.jsx`
  - `FormField`, `TextInput`, `PhoneInput`, `SelectInput`, `TextArea`, `SectionTitle`
  - Exports : `inputClass`, `selectClass` (tokens `secondary-*`, `primary-*`)
- **Composants partagés** : `src/apps/artisan/components/shared/`
  - `KanbanBoard` : Board Kanban générique (DnD optionnel, colonnes configurables)
  - `SearchBar` : Barre de recherche avec icône et bouton clear
- **Utilitaires partagés** : `src/lib/utils.js`
  - `formatDateForInput` (Date|string → YYYY-MM-DD, timezone-safe)
  - `formatDateFR` (→ "1 janvier 2026"), `formatDateShortFR` (→ "1 janv. 2026")
  - `formatDateTimeFR`, `formatPhoneNumber`, `formatEuro`
  - `computeEndTime`, `computeDuration`
- **Branding multi-tenant** : `src/lib/orgBranding.js` — `buildCompanyInfo(settings)` construit l'objet `company` (nom, SIRET, adresse, RGE, etc.) depuis `core.organizations.settings`, avec fallback Mayer. Helpers `formatFullAddress(company)` + `buildLegalFooter(company)`. Consommé par les PDFs (`generateContractPdfBlob(data, company)`, idem Certificat/Devis/PvReception) et le wizard mailing.
- **Constantes** : `src/lib/constants.js` — `DEFAULT_PAGE_SIZE`, `LARGE_PAGE_SIZE`, `KANBAN_PAGE_SIZE`
- **Logger** : `src/lib/logger.js` (P1.7, 2026-05-21) — `logger.error/warn/info/log/debug/table/group/groupEnd`. En prod (`import.meta.env.PROD`), tout est no-op sauf `logger.error` (Sentry-like). Variant `logger.silent.error` pour muter aussi les erreurs. Migrer les nouveaux `console.*` vers `logger.*` au fil de l'eau.

## Module Mailing

### Architecture
- **Page** : `src/apps/artisan/pages/Mailing.jsx` — Wrapper 3 onglets : **Envoi** (tous rôles) + **Segments** (admin only) + **Éditeur** (admin only)
- **Onglet Envoi** : `src/apps/artisan/components/mailing/SendTab.jsx` — sélecteur campagne + dropdown segment (depuis `mail_segments`) + carte d'identité + preview + envoi N8n
- **Onglet Segments** : `src/apps/artisan/components/mailing/SegmentsTab.jsx` — catalogue de segments réutilisables (presets + perso) avec CRUD via `SegmentBuilderDrawer.jsx`
- **Onglet Éditeur** : `src/apps/artisan/components/mailing/EditorTab.jsx` — liste cards + actions (Éditer / Dupliquer / Archiver) + wizard `CampaignWizard.jsx` (inclut bloc Automatisation)
- **Onglet client** : `src/apps/artisan/pages/client-detail/TabMailings.jsx` — Historique des mails + badges status + timeline events + compteurs opens/clics (polling 30s)
- **Tables** :
  - `majordhome.mail_campaigns` (key, label, subject, preheader, html_body, purpose, audience, tone, trigger_description, notes, blocks JSONB, tracking_type_value, **is_automated**, **auto_segment_id** FK, **auto_cadence_days**, **auto_cadence_minutes**, **auto_time_of_day**, **last_run_at**, **next_run_at**). Colonnes legacy `default_segment` / `allowed_segments` conservées (nullables) mais non utilisées par l'UI.
  - `majordhome.mail_segments` (catalogue de ciblages : name, description, audience='clients'|'leads', filters JSONB DSL, is_preset, is_archived). 7 presets seed : Tous / Contrat / Contrat actif / Contrat clos / Devis relance / Contacté relance / Nouveau bienvenue.
  - `majordhome.mailing_logs` (client_id, lead_id, org_id, campaign_name, subject, email_to, sent_at, status, provider_id, error_message, delivered_at, opened_at, clicked_at, bounced_at, complained_at, last_event_at, open_count, click_count)
  - `majordhome.mailing_events` (audit log complet, 1 ligne par event webhook reçu, dédupliqué par `svix_id` UNIQUE)
- **Colonne leads** : `status_changed_at` (timestamptz) — horodatage du passage dans le statut courant, mis à jour par trigger `WHEN (OLD.status_id IS DISTINCT FROM NEW.status_id)`. Reset à chaque changement de statut ; immuable sur correction de fiche (nom, email, etc.)
- **Vues** : `public.majordhome_mail_campaigns`, `public.majordhome_mail_segments`, `public.majordhome_mailing_logs`, `public.majordhome_mailing_events`
- **Services** : `mailCampaigns.service.js`, `mailSegments.service.js` (CRUD + compile/count/preview)
- **Hooks** : `useMailCampaigns`, `useMailSegments` (+ `useSegmentCount`, `useSegmentPreview`) via React Query
- **Cache keys** : `mailCampaignKeys`, `mailSegmentKeys`, `mailingKeys.byClient(clientId)`, `mailingKeys.byLead(leadId)`
- **RPCs** :
  - `public.mail_segment_compile(filters jsonb, campaign_name text, org_id uuid) RETURNS text` — compose le SELECT SQL depuis le DSL jsonb. SECURITY DEFINER, format() + quote_literal pour la safety.
  - `public.mail_segment_compile_safe(segment_id uuid, campaign_name text) RETURNS text` (P0.8, 2026-05-21) — recharge filters depuis `mail_segments` côté serveur + check `auth.uid() ∈ org_members` + délègue à `mail_segment_compile`. Utilisée par `mailing-send` edge function.
  - `public.mail_single_client_sql(client_id uuid, campaign_name text) RETURNS text` (P0.8) — SQL pour 1 destinataire transactionnel, membership-checked.
  - `public.mail_fetch_recipients(segment_id?, client_id?, campaign_name?)` (P0.8 V2) — wrapper appelé par `mailing-send`, compile + exécute en 1 aller-retour, retourne directement les rows destinataires.
  - `public.mail_segment_count(filters, campaign_name, org_id) RETURNS integer` — COUNT(*) sur le SQL compilé
  - `public.mail_segment_preview(filters, campaign_name, org_id, limit) RETURNS TABLE(...)` — N premiers destinataires
  - `public.mail_campaigns_due() RETURNS TABLE(...)` — campagnes `is_automated=true AND next_run_at <= NOW()`, consommée par le scheduler N8n
  - `public.mail_campaign_mark_run(campaign_id) RETURNS timestamptz` — update `last_run_at=NOW()` + calcule `next_run_at` selon cadence
- **Constantes shared** :
  - `src/apps/artisan/components/mailing/segmentBuilder.constants.js` — audiences/housing/DPE/order_by + `buildEmptyFilters()` + `updateFilters()` (immutable path update)
  - `src/apps/artisan/components/mailing/resources.js` — 📌 caisse à outils URLs Mayer (CTA, services, blog, zones, contact). Source de vérité pour l'IA — à mettre à jour à chaque nouvelle ressource
- **Provider email** : Resend (API `https://api.resend.com/emails`) — bascule depuis Gmail le 2026-04-11
- **Edge function `mailing-send`** (P0.8 V2, 2026-05-21) : moteur d'envoi mailing pilote par le frontend / scheduler. Accepte `{ segment_id, campaign_id }` (broadcast) OU `{ client_id, campaign_id }` (transactionnel) — JAMAIS de SQL brut. RPC `mail_fetch_recipients(segment_id?, client_id?, campaign_name?)` membership-checked compile et exécute côté DB. Squelette HTML commun (`core.organizations.settings.email_skeleton_html`) appliqué automatiquement aux templates body-only.
- **Edge function `contract-signed-notify`** (P0.14 transactionnel, 2026-05-21) : envoi transactionnel "contrat signé" multi-tenant. Charge contract + org settings + template `contrat_signature_confirm` depuis DB, télécharge PDF, envoie via Resend avec PDF en attachement, log dans `mailing_logs`. Remplace l'ancien workflow N8N "Mayer - Entretien Contrat".
- **Edge function webhook Resend** : `supabase/functions/resend-webhook/` (verify_jwt: false, Svix HMAC SHA256 via Web Crypto API, RPC atomique)
- **Edge function unsubscribe** : `supabase/functions/mailing-unsubscribe/` (verify_jwt: false, token HMAC SHA256 signé avec `RESEND_WEBHOOK_SECRET`, GET = page HTML confirmation + POST = one-click RFC 8058)
- **Edge function avis-redirect** : `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/avis-redirect` — redirige vers fiche Google Reviews Mayer + tracke le clic via `?log_id=` (utilisée dans SMS et accessible aux mails)
- **Ancien webhook N8n `mayer-mailing` (id `1COgLUuiMtSq2sUq`)** : **ARCHIVÉ depuis P0.8 V2** (2026-05-21). Acceptait `segment_sql` brut — vulnérabilité cross-org si URL fuite. Ne plus appeler.

### Segment Builder (onglet Segments)
Builder à facettes 4 blocs : **Population** (audience + base filters) / **Attributs** (géo, logement, équipement, source, Meta, tags, dates) / **Historique mailing** (exclure campagnes reçues, cooldown, engagement ouvert/cliqué) / **Preview** (count live + table 20 destinataires + tri/limite). Sauvegarde dans `mail_segments` avec jsonb filters. Voir DSL dans `docs/MAILING_SEGMENT_BUILDER.md` §3.

### Scheduler Campagnes Auto (workflow N8n générique)
1 workflow unique (toutes les 10 min) :
1. `HTTP POST /rpc/mail_campaigns_due` → liste campagnes éligibles
2. `Split In Batches` (1 à 1)
3. `HTTP POST /rpc/mail_segment_compile` → SQL dynamique du segment
4. `Code node` → build payload (+LIMIT 500 safety)
5. `HTTP POST /webhook/mayer-mailing` → workflow d'envoi existant
6. `HTTP POST /rpc/mail_campaign_mark_run` → update `last_run_at` + `next_run_at`

Setup complet : `docs/n8n/MAILING_SCHEDULER_SETUP.md`. `lead_bienvenue` est la 1ʳᵉ campagne branchée (cadence `auto_cadence_minutes=10`, ancien workflow dédié à désactiver après validation 24h).

### Éditeur de campagne (wizard 3 étapes)
1. **Identité** : libellé (clé technique auto-générée par slugify), Contexte (objectif, cible, notes), ton éditorial (5 choix + Autre), **bloc Automatisation** (toggle + choix `auto_segment_id` dans le catalogue + cadence jours OU minutes + heure d'envoi)
2. **Brief** : ligne éditoriale (textarea libre — l'IA structure les blocs elle-même), objet/preheader facultatifs (l'IA propose sinon)
3. **Génération** : prompt système copiable (inclut carte d'identité + brief + caisse à outils URLs + types de blocs disponibles + contraintes techniques) + JSON structuré + textarea HTML final + bouton Prévisualiser (iframe overlay)

**Workflow V1 (copier-coller)** : wizard → prompt copié → chat Claude → HTML généré → coller dans textarea (auto-extraction OBJET/PREHEADER depuis commentaire HTML en tête) → Sauvegarder. Validation : impossible de save/envoyer si subject vide.

**Vdef prévue** : remplacer l'étape 3 par appel API direct Anthropic au lieu du copier-coller.

### Edge function `mailing-send` (P0.8 V2 — remplace ancien workflow N8n)
Moteur d'envoi mailing centralisé. Le frontend appelle `supabase.functions.invoke('mailing-send', { body: {...} })`. Le scheduler N8n auto-campagnes appelle l'edge avec `service_role` au lieu d'un webhook public.

**Modes** :
- **Broadcast** : `{ campaign_id, segment_id, test_email? }` — RPC `mail_fetch_recipients(p_segment_id, ...)` compile + exécute le SQL membership-checked
- **Transactionnel** : `{ campaign_id, client_id }` (ou `lead_id`) — RPC `mail_fetch_recipients(p_client_id=...)` pour 1 destinataire

**Sécurité** :
- `verify_jwt:true` (frontend) OU `service_role` (scheduler N8n) — pas de webhook public
- Le SQL n'est JAMAIS accepté du client — toujours compilé côté DB après check `auth.uid() ∈ org_members`
- `mail_campaigns.is_transactional=true` → exclu de l'onglet Envoi broadcast (sécurité UX)

**Templates** :
- Squelette HTML commun dans `core.organizations.settings.email_skeleton_html` (+ `secondary_color`, `email_tagline`) appliqué automatiquement aux templates body-only.
- Templates legacy `mail_a..g`, `lead_bienvenue`, etc. : détectés via heuristique `<!DOCTYPE>` et laissés intacts (migration progressive).
- Placeholder `{{SALUTATION}}` remplacé par "Bonjour Prénom Nom," dans le squelette.

### Webhook Resend — tracking delivered / opened / clicked / bounced

Pipeline de tracking post-envoi alimenté par les events webhook Resend.

**Prérequis Resend Dashboard** :
- Domain `mayer-energie.fr` → Configuration → **Click Tracking** ON + **Open Tracking** ON
- Webhooks → Add Endpoint :
  - URL : `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/resend-webhook`
  - Events : `email.sent`, `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`, `email.failed`, `email.delivery_delayed`
- Signing Secret `whsec_...` → Supabase → Edge Functions → Secrets → `RESEND_WEBHOOK_SECRET`

**Edge function `resend-webhook`** (`supabase/functions/resend-webhook/index.ts`) :
- `verify_jwt: false` — Resend ne passe pas de JWT, on valide par signature Svix
- **Vérification signature Svix** : HMAC SHA256 via Web Crypto API, format `{svix_id}.{svix_timestamp}.{body}`, tolérance timestamp 5 min (anti-replay), support rotation de secret (multiple v1 signatures)
- **Extraction timestamp event** : privilégie `data.open.timestamp` / `data.click.timestamp` / `data.bounce.timestamp` (date réelle de l'event) avant de fallback sur `data.created_at` (date d'envoi)
- Appelle la RPC `public.resend_apply_webhook_event(provider_id, event_type, event_at, svix_id, payload)` qui fait tout en 1 aller-retour DB

**RPC `public.resend_apply_webhook_event`** (PL/pgSQL, SECURITY DEFINER) :
- INSERT dans `mailing_events` (idempotent via `svix_id` UNIQUE → retries Resend sans effet de bord)
- UPDATE `mailing_logs` avec règles de priorité statut :
  - `sent` (1) < `delivered` (2) < `opened` (3) < `clicked` (4)
  - `bounced` / `complained` / `failed` = 100 (terminal, override tout)
  - Un event ne rétrograde jamais un statut supérieur
- `opened_at` / `clicked_at` via COALESCE (premier event seulement)
- `open_count` / `click_count` incrémentés à chaque event reçu
- `error_message` extrait de `payload->bounce->reason` / `payload->failed->reason`

**Flow complet** :
```
N8n (envoi) → INSERT mailing_logs (status='sent', provider_id)
              ↓
Resend      → email.sent, email.delivered (~1s)
              → webhook POST /functions/v1/resend-webhook
                → verify Svix signature
                → RPC resend_apply_webhook_event
                  → INSERT mailing_events (audit)
                  → UPDATE mailing_logs (status, delivered_at, last_event_at)
              ↓
User ouvre  → email.opened → opened_at, open_count++
User clique → email.clicked → clicked_at, click_count++
(ou Safe Links prefetch → counters peuvent être > 1 pour un seul vrai clic)
```

**Important — counters et Outlook/Hotmail** :
- Outlook/Hotmail Safe Links pré-fetch chaque lien pour scan de sécurité → chaque scan génère un `email.clicked`
- `click_count` peut atteindre 10-20+ pour un seul vrai clic utilisateur
- Afficher le compteur tel quel ou calculer un "unique click" via `mailing_events` (GROUP BY user agent / ip) selon le besoin
- Open Tracking marqué "Not Recommended" par Resend : faux négatifs (clients bloquant les images) + faux positifs (prefetching Apple Mail Privacy Protection)

**Idempotence** : chaque webhook Resend a un header `svix-id` UNIQUE stocké dans `mailing_events`. Les retries Resend (jusqu'à 5 tentatives sur 3 jours) sont dédupliqués naturellement.

### Désabonnement (opt-out RGPD)

Pipeline de désinscription conforme RFC 8058 avec plusieurs canaux.

**Colonnes DB** (sur `majordhome.clients` et `majordhome.leads`) :
- `email_unsubscribed_at TIMESTAMPTZ` — timestamp du désabonnement
- `email_unsubscribe_reason TEXT` — `user_request` | `list_unsubscribe_header` | `spam_complaint` | `manual`

**Edge function `mailing-unsubscribe`** (`supabase/functions/mailing-unsubscribe/index.ts`) :
- URL : `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/mailing-unsubscribe`
- `verify_jwt: false`
- **GET `?token=xxx`** : page HTML de confirmation (design Mayer Énergie, responsive)
- **POST `?token=xxx`** : one-click RFC 8058 silencieux (body form-urlencoded supporté aussi)
- **Token signé HMAC SHA256** avec `RESEND_WEBHOOK_SECRET` (même secret que webhook, économie de config)
  - Format : `{rt}.{rid}.{exp}.{base64url_sig}` où `rt=c|l`, `rid=UUID`, `exp=epoch`
  - Expiration : 90 jours
  - Validation timestamp stricte pour éviter replay

**RPC `public.mailing_apply_unsubscribe(rt, rid, reason, ts)`** (PL/pgSQL, SECURITY DEFINER) :
- Update `clients.email_unsubscribed_at` (ou `leads.email_unsubscribed_at`)
- Idempotent : si déjà désabonné, retourne `already_unsubscribed=true` sans toucher au timestamp
- Retour JSON : `{ already_unsubscribed, rows_updated, recipient_type, recipient_id }`

**Workflow N8n** — génération du token dans le noeud `5. Personnaliser HTML` :
- Utilise `crypto.createHmac('sha256', keyBytes)` avec `$env.RESEND_WEBHOOK_SECRET` décodé depuis `whsec_<base64>`
- Remplace automatiquement le lien `mailto:?subject=Désabonnement` du footer HTML par l'URL edge function (regex sur les templates, aucune modif des templates)
- Expose `unsubscribeUrl` dans l'output pour le noeud 6

**Headers dans le noeud `6. Resend Send`** :
```json
"headers": {
  "List-Unsubscribe": "<https://.../mailing-unsubscribe?token=xxx>, <mailto:contact@mayer-energie.fr?subject=Désabonnement>",
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
}
```
→ Gmail / Outlook / Yahoo / Apple Mail affichent automatiquement le bouton natif "Se désabonner" en haut de l'email. Click = POST one-click vers l'edge function.

**Variable d'environnement N8n requise** : `RESEND_WEBHOOK_SECRET` (même valeur que le secret Supabase Edge Functions).

**Auto-unsubscribe sur spam complaint** : quand qqn clique "Signaler comme spam" dans Gmail/Outlook, Resend envoie `email.complained` → RPC `resend_apply_webhook_event` marque automatiquement `email_unsubscribed_at = NOW()` + `reason='spam_complaint'`. Respect immédiat du souhait utilisateur.

**Exclusion dans les segments** : les 7 segments de `Mailing.jsx` ont tous `AND email_unsubscribed_at IS NULL` (en plus du `mail_optin=true` manuel et du `email IS NOT NULL`). Triple filtre : opt-out manuel CRM + opt-out automatique webhook + email valide.

**UI fiche client** : bandeau orange "Client désabonné" en haut de `TabMailings.jsx` si `email_unsubscribed_at` est set. Affiche la date + la raison (lien, bouton natif, spam, manuel). Le client reste dans la base, juste exclu des campagnes.

### Templates campagnes broadcast (7)
| Template | Cible | Objet |
|----------|-------|-------|
| `mail_a` | Clients contrat actif | Information — Mayer Energie reprend le suivi |
| `mail_b` | Clients sans contrat | Offre Exclusive — reprise Econhome |
| `mail_c` | Clients contrat clos | Reconquête Info — ancien contrat |
| `mail_d` | Clients contrat clos | Offre Reconquête — retour client |
| `mail_e` | Leads Contacté | Relance Contacté — rappel à bon souvenir |
| `mail_f` | Leads Devis envoyé | Relance Devis — suivi devis + aides + prix |
| `mail_g` | Leads Perdu | Remerciement — ressources site web |

### Templates transactionnels (`mail_campaigns.is_transactional=true`)
Déclenchés 1-à-1 sur événement (pas envoyés en broadcast). Exclus de l'onglet Envoi.

| Template | Trigger | Placeholders custom | Lieu de remplacement |
|----------|---------|---------------------|---------------------|
| `contrat_signature_confirm` | Signature contrat | `{{CLIENT_NAME}}`, `{{BRAND_NAME}}`, `{{ORG_EMAIL}}`, `{{ORG_PHONE}}`, `{{ORG_ADDRESS}}`, `{{ORG_POSTAL_CODE}}`, `{{ORG_CITY}}`, `{{ACCENT_COLOR}}` | Edge function `contract-signed-notify` (charge `core.organizations.settings`) |
| `proposition_contrat` | Envoi devis depuis fiche client | `{{EQUIP_RECAP}}`, `{{TOTAL_AMOUNT}}`, `{{PDF_URL}}` | Frontend `ContractPdfSection.jsx:handleSendProposal` (replaceAll côté client) |

**Convention** : éditables via onglet Mailing → Éditeur. La colonne `mail_campaigns.is_transactional BOOLEAN` distingue les transactionnels des broadcast. Pour ajouter une 3ᵉ campagne transactionnelle, considérer centraliser le `replaceAll` dans `mailCampaignsService.renderTemplate(orgId, key, vars)` plutôt qu'inline.

### Segments de ciblage (catalogue `mail_segments`, 8 presets seed)
| Segment preset | Audience | Description |
|----------------|----------|-------------|
| Tous les clients | clients | Tous actifs avec email + opt-in |
| Clients avec contrat (actif ou clos) | clients | ≥1 contrat `active` ou `cancelled` |
| Clients contrat actif | clients | ≥1 contrat `status='active'` |
| Clients contrat en attente | clients | ≥1 contrat `status='pending'` |
| Clients contrat clos | clients | `status='cancelled'` et aucun actif |
| Leads Devis envoyé — Relance | leads | Statut Devis envoyé, `quote_sent_date` entre 7-14j |
| Leads Contacté — Relance | leads | Statut Contacté, `status_changed_at` entre 7-14j |
| Leads Nouveau — Bienvenue | leads | Statut Nouveau (branché sur campagne `lead_bienvenue`) |

**Enum DB `contract_status`** : `active` / `pending` / `cancelled` (PAS d'`archived`).

Filtres par défaut sur tous les segments : `email_unsubscribed_at IS NULL`, `email IS NOT NULL`, `c.mail_optin=true` (clients), `c.is_archived=false` (clients), `l.is_deleted=false` (leads), `NOT IN mailing_logs WHERE campaign_name = <current>` (exclusion campagne courante).

L'utilisateur crée des segments personnalisés via **Mailing → Segments → Nouveau segment** (builder 4 blocs). Chaque segment est un jsonb DSL compilé en SQL par la RPC `mail_segment_compile`.

### Campagne automatique — Workflow générique
Toute campagne avec `is_automated = true` + `auto_segment_id` + cadence est déclenchée par le scheduler N8n "Mayer - Scheduler Campagnes Auto" (cron 10 min). `lead_bienvenue` est la 1ʳᵉ campagne (cadence `auto_cadence_minutes=10`, ancien workflow dédié à désactiver après validation 24h). Setup : `docs/n8n/MAILING_SCHEDULER_SETUP.md`.

### Tags mailing dans fiche lead
- Statut **Contacté** (display_order 2) : tag indigo "Mailing Relance" si campagne Contacté envoyée
- Statut **Devis envoyé** (display_order 4) : tag ambre "Mailing Relance Devis" si campagne Devis envoyée
- Tags en lecture seule, chargés depuis `mailing_logs` via `lead_id`
- La checkbox "Mail envoyé" reste manuelle (usage commercial)

### Compteur destinataires
Utilise la RPC `public.mail_segment_count(filters, campaign_name, org_id)` qui compile puis COUNT(*) en un seul aller-retour. Le résultat s'affiche en badge à côté du sélecteur de segment. Le toast et la confirmation utilisent le nombre réel de destinataires.

### Évolutions prévues
- ~~Migration Gmail → Resend~~ ✅ FAIT (2026-04-11)
- ~~Gestion erreurs/bounces dans mailing_logs~~ ✅ FAIT (colonnes `provider_id` + `error_message` + `status='failed'`)
- ~~Webhook Resend (ouvertures, clics, bounces, complaints)~~ ✅ FAIT (2026-04-11) — edge function `resend-webhook` + RPC atomique + table `mailing_events` + vérification Svix HMAC SHA256
- ~~TabMailings enrichi (badges, timeline, compteurs)~~ ✅ FAIT (2026-04-11) — 7 statuts avec icônes Lucide, timeline chronologique des events, stats header, polling 30s
- ~~Auto-cleanup email sur bounce Permanent~~ ✅ FAIT (2026-04-11) — RPC webhook vide `clients.email` sur hard bounce, ré-envois bloqués
- ~~Auto-archive clients injoignables~~ ✅ FAIT (2026-04-11) — si bounce Permanent + pas de phone + pas de contrat actif + pas d'intervention en cours
- ~~Désabonnement opt-out complet (List-Unsubscribe RFC 8058)~~ ✅ FAIT (2026-04-11) — edge function `mailing-unsubscribe`, bouton natif Gmail/Outlook, auto-unsubscribe sur spam complaint, bandeau UI fiche client
- Dashboard stats mailing (taux d'ouverture/clic/bounce par campagne) — nécessite requêtes d'agrégation sur `mailing_logs`
- "Unique click" : déduplication des clics via `mailing_events` (GROUP BY user_agent/ip) pour filtrer Safe Links Outlook
- Bouton "Désabonner manuellement" sur fiche client (UI-driven) — actuel : il faut passer par un UPDATE SQL ou attendre un event automatique
- Bouton "Réabonner" (undo) sur fiche client désabonnée — pour les cas où un client se désinscrit par erreur et veut revenir

## Module Certificats d'entretien (multi-équipements)

### Architecture
- **1 certificat par équipement** : interventions enfants (`parent_id` + `equipment_id`)
- **Parent** = carte Kanban (1 par contrat/client), **enfants** = 1 par équipement du contrat
- **Vue `majordhome_entretien_sav`** filtrée `parent_id IS NULL` (enfants exclus du Kanban et des stats)
- **Lazy create** : les enfants sont créés à la première ouverture de la modale si absents

### Composants
| Fichier | Rôle |
|---------|------|
| `CertificatsSection.jsx` | Section certificats extraite de EntretienSAVModal (equipments, lazy create, progress bar, liste) |
| `CertificatEquipmentRow.jsx` | Ligne équipement : statut (À faire/Rempli/Néant) + CTA Remplir/Voir/Néant |
| `useCertificatEntretien.js` | Hook React Query : `useCertificatChildren` + `useCertificatEntretienMutations` |

### Workflow
```
planifie → [Remplir certificats équipements] → realise → facture (hors Kanban)
```
- Transition `realise` automatique quand tous les enfants sont traités (rempli ou néant)
- `completeParentEntretien()` : transition parent + insert `maintenance_visit` (chaînage annuel)
- Bouton "Valider facturation" sur carte Kanban → carte disparaît
- `client_comment` (colonne `interventions`) : message pour le mail client

### PDF Certificat
- Logo Mayer Énergie + titre centré
- Signature technicien (nom = user connecté, non modifiable)
- TVA retirée, prochaine intervention en mois/année FR

### Fiche équipement
- Combobox marque/modèle : saisie libre + suggestions fournisseurs (`<input>` + `<datalist>`)

### Service methods (`sav.service.js`)
- `getChildInterventions(parentId)` — enfants + JOIN équipements
- `createChildInterventions(parentId, equipments, ctx)` — batch insert
- `markChildNeant(childId)` / `unmarkChildNeant(childId)` — NÉANT toggle
- `completeParentEntretien(parentId, orgId, reportNotes)` — clôture + maintenance_visit

## Module Tarification (Settings → /settings/pricing)

CRUD per-org de la grille tarifaire (P0.0.6 pricing per-org, 2026-05-21). Accès `org_admin` only.

- **Page** : `src/apps/artisan/pages/settings/PricingSettings.jsx` — 5 onglets : Zones / Types d'équipement / Tarifs (matrice zone × type) / Remises volume / Options
- **Hook admin** : `usePricingAdmin()` dans `src/shared/hooks/usePricing.js` — expose `{zones, equipmentTypes, rates, discounts, extras}` (incluant inactifs) + 13 mutations CRUD scopées automatiquement sur `useAuth().organization.id`
- **Hook prod** : `usePricingData()` (existant) — filtre `is_active=true` pour les formulaires contrat
- **Service** : `pricing.service.js` — lectures via vues publiques `majordhome_pricing_*` (RLS via `security_invoker`), écritures via `.schema('majordhome')` (CRUD UI)
- **Tables `majordhome.pricing_*`** : `pricing_zones`, `pricing_equipment_types`, `pricing_rates`, `pricing_discounts`, `pricing_extras` — toutes avec `org_id NOT NULL` + FK `core.organizations` + RLS `org_id IN (org_members)` + UNIQUE composites `(org_id, …)`
- **`upsertRate`** utilise `onConflict: 'org_id,zone_id,equipment_type_id'` (composite UNIQUE)

## Module Voice (PWA terrain)

PWA dédiée pour les mémos vocaux structurés (RDV terrain / réunion / note libre) — Phase 1 MAKE. Routes `/voice/*` dans `src/apps/voice/`.

- **Accès** : permission DB `voice_recorder.use` dans `majordhome.role_permissions` (P0.10, 2026-05-21). Configurable via Settings → Permissions par tout org_admin. Mayer seed : team_leader=true, commercial=false, technicien=false. `org_admin` bypass automatique.
- **Pattern usage** : `const { can } = useCanAccess(); if (!can('voice_recorder', 'use')) <AccessDenied />` — guard dans `VoiceAccessGate.jsx`.
- **Edge function `voice-extract-fieldreport`** (`verify_jwt:false`, P0.6 — 2026-05-21) : extraction structurée d'un mémo vocal CVC via Claude Sonnet 4.6 (fallback GPT-4o). Auth via `requireSharedSecret(MDH_CRON_SECRET)` du helper `_shared/auth.ts`. Body : `{ transcript, memo_type, duration_seconds, user_id?, org_id? }`.
- **Quota daily user × org** (P0.6 follow-up, 2026-05-21) : table `majordhome.voice_quotas(user_id, org_id, date, count, last_at)` + RPC `public.increment_voice_quota(p_user_id, p_org_id, p_daily_limit DEFAULT 20)` SECURITY DEFINER service_role only. UPSERT atomique avec RAISE EXCEPTION P0001 `voice_quota_exceeded` si count > limit. Env var `VOICE_DAILY_LIMIT` override possible. Si `user_id`/`org_id` absents du body → warn + skip quota check (transition douce le temps d'updater le workflow N8n).
- **RPC `public.record_voice_memo_extraction`** : insert dans `majordhome.voice_memos` + crée éventuellement leads/tâches. SECURITY DEFINER **service_role only** (P0.5, 2026-05-21) — `REVOKE FROM PUBLIC, anon, authenticated` car prend `org_id` dans le payload sans le dériver d'`auth.uid()`.
- **Workflow N8n `mayer-voice-field-report`** : pipeline complet (transcription Whisper → voice-extract-fieldreport → record_voice_memo_extraction). Doit passer `Authorization: Bearer <MDH_CRON_SECRET>` sur le node Voice Extract + `user_id`/`org_id` dans le body pour activer le quota.

## Module GeoGrid Rank Tracker

Suivi SEO local Google Maps via 2 modes de scan complémentaires :
- **Mode `grid`** : grille géographique régulière N×N (5×5/7×7/9×9) autour d'un centre — pour le maillage local fin (Gaillac et environs)
- **Mode `cities`** : 1 requête par commune du Tarn (filtrable par seuil population) — pour la visibilité départementale

### Stack
- **Edge function** : `supabase/functions/geogrid-scan/` (non versionnée localement, déployée seule via MCP). Accepte `mode: 'grid' | 'cities'` ; en mode cities reçoit un array `points: [{name, code, lat, lng}]`. Matching business utilise normalisation Unicode (lowercase + strip diacritiques)
- **API Google** : Places API (New) — `places.googleapis.com/v1/places:searchText`
- **Projet GCP** : `Towercontrol` (compte Google : `eric.pudebat@gmail.com`) — secret `GOOGLE_PLACES_API_KEY` côté Supabase Edge Functions
- **API communes Tarn** : `https://geo.api.gouv.fr/departements/81/communes` (gratuit, sans auth, INSEE) — cache LocalStorage 7 jours dans `communesService.js`
- **Free tier Google Places** : 5000 requêtes/mois UTC (reset 1er du mois 00:00 UTC). Au-delà : 27,75 €/1000 req (tranche 5k-100k)

### DB
- `majordhome.geogrid_scans` (colonnes : `scan_mode`, `keyword`, `business_name`, `place_id`, `center_lat/lng`, `radius_km`/`grid_size` nullables si mode='cities', `search_radius_m`, `stats` jsonb, **`benchmark_id`** FK nullable vers geogrid_benchmarks)
- `majordhome.geogrid_results` (1 ligne/point ; en mode cities : `point_label`=nom commune, `point_code`=code INSEE)
- `majordhome.geogrid_keyword_lists` (id, org_id, name, description, keywords JSONB array, keyword_count generated, is_active, created_at, updated_at)
- `majordhome.geogrid_benchmarks` (id, org_id, list_id FK, scan_mode, business_name, place_id, center_lat/lng, radius_km/grid_size nullables, search_radius_m, city_min_population nullable, total_keywords, completed_keywords, status enum, error_message, started_at, completed_at)
- Vues publiques : `majordhome_geogrid_scans` (calcule `total_points` via COUNT results), `majordhome_geogrid_keyword_lists`, `majordhome_geogrid_benchmarks` (+ JOIN list_name)
- `core.organizations.settings.google_place_id` — stocke le Place ID Google du business par org, pré-rempli dans `ScanConfigPanel` via `useAuth().organization.settings.google_place_id`

### UI — Profils de recherche (mode cities)
`ScanConfigPanel.jsx` expose un sélecteur `searchRadiusM` avec 5 profils métier : 500m (piéton), 1km (quartier), **2km (ville, default)**, 3km (ville étendue), 5km (zone large). Pilote le `locationBias` Google Places — définit à quel point Google privilégie la proximité géographique stricte. Default 2000m adapté aux installateurs/pros itinérants.

### UI — Architecture 3 onglets (GeoGrid.jsx)
- **Scan unique** (`ScanTab.jsx`) : scan ad-hoc 1 keyword, config + map + historique (filtré `benchmark_id IS NULL`)
- **Listes de keywords** (`KeywordListsPanel.jsx`) : CRUD listes réutilisables (name, description, keywords array). Seed "Mayer SEO 2026" : 25 keywords prioritaires (8 Poêle + 5 Ramonage + 4 Clim + 2 PAC + 3 Chauffage + 3 Entretien)
- **Benchmarks** (`BenchmarksPanel.jsx`) : historique des runs d'une liste (N scans liés). `BenchmarkLauncher` : loop frontend séquentiel (1 scan/keyword), progress bar, estimation coût/durée. `BenchmarkResultTable` : tableau consolidé groupé par famille (auto-tag par regex sur keyword)

### Services & Hooks
- `geogrid.service.js` : méthodes CRUD `getKeywordLists`, `createKeywordList`, `updateKeywordList`, `deleteKeywordList`, `getBenchmarks`, `createBenchmark`, `updateBenchmarkProgress`, `getBenchmarkScans`, `deleteBenchmark`
- `useGeoGrid.js` : hooks `useKeywordLists`, `useCreateKeywordList`, `useUpdateKeywordList`, `useDeleteKeywordList`, `useBenchmarks`, `useBenchmarkScans`, `useDeleteBenchmark`
- Cache keys : `geogridKeys.keywordLists(orgId)`, `geogridKeys.benchmarks(orgId)`, `geogridKeys.benchmarkScans(benchmarkId)`

### Auto-tag famille keywords
Regex dans `BenchmarkResultTable.jsx` : `detectFamily(keyword)` retourne Poêle / Ramonage / Climatisation / PAC / Chauffage / Entretien / Autre. Synthèse cards % visibilité par famille. Regex PAC : `\bpac\b|pompe.{0,8}chaleur` (matche "pompe a chaleur", "pompe à chaleur", "pompe de chaleur" avec jusqu'à 8 chars entre les mots).

### Garde-fou app
`useGeoGridQuota(orgId)` calcule `SUM(total_points)` du mois courant en bornes UTC strictes (`Date.UTC(year, month, 1)`). Bouton "Lancer le scan" désactivé si projection > 5000 sauf override explicite via checkbox (partagé entre scan unique et benchmarks).

## Module Search Console (Google Search Console)

2ème thermomètre SEO complémentaire à GeoGrid Maps : positions/impressions/clics du site mayer-energie.fr dans Google Search. Intégré comme 4ème onglet de GeoGrid.

### Stack
- OAuth Google : `refresh_token` dans `core.organizations.settings.gsc_refresh_token` + `gsc_site_url` (`sc-domain:mayer-energie.fr`)
- API GSC : `searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` (rowLimit 25k, paginé jusqu'à 200k)
- Edge functions : `gsc-oauth-init` (verify_jwt:true), `gsc-oauth-callback` (verify_jwt:false), `gsc-sync` (verify_jwt:true)
- DB : `majordhome.gsc_keyword_metrics` (UNIQUE org_id+site_url+date+query+page) + RPC `public.gsc_upsert_metrics(p_rows jsonb)` (SECURITY DEFINER)
- Frontend : `gsc.service.js` + `useGsc.js` (`gscKeys` dans `cacheKeys.js`) + `GscPanel.jsx` (4ème onglet `GeoGrid.jsx`)

### Sync
Au retour OAuth (`?gsc=connected`), `useEffect` déclenche auto `triggerSync({ monthsBack: 16 })`. Bouton "Sync 16 mois" disponible aussi pour re-import manuel.

### UI
GscPanel : non-connecté (CTA OAuth) ou connecté (sélecteur période 7j/30j/3m/12m + filtre famille + toggle "Liste Mayer SEO 2026 uniquement" + 5 KPIs + tableau agrégé par requête avec étoile pour keywords curés).

> Détails complets (edge functions, RLS, secrets GCP, etc.) : `docs/MODULE_SEARCH_CONSOLE.md`. Master prompt évolution : `docs/GSC_INTEGRATION_MASTER_PROMPT.md`.

## Plan de Développement
| Sprint | Titre | Statut |
|--------|-------|--------|
| 0-5b | Auth, CRM, Planning, Terrain, Pipeline, Entretiens, Territoire | ✅ FAIT |
| 6 | Chantiers (Kanban post-vente, commandes, planification) + Dashboard réel + Planning multi-select | ✅ FAIT |
| 7 | Droits & Accès (permissions granulaires par rôle) | ✅ FAIT |
| P | Prospection (Cédants + Commercial, Screener SIRENE, Pipeline, Drawer) | ✅ FAIT |
| M | Mailing (Configurateur campagnes, mailing_logs, onglet Mailings fiche client) | ✅ FAIT |
| **Sem 0** | **Hardening DB pré-onboarding 2ème entreprise (cf. `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`)** | **✅ ~97% (2026-05-21)** |
| **Sem 3** | **Branding multi-tenant (P0.13-P0.20 — settings org, PDFs paramétrés, edges multi-tenant)** | **✅ FAIT (2026-05-21)** |
| 8 | Portail Client | ⬜ À FAIRE |
| 9 | Intégration Pennylane (devis/factures) | 🔧 EN COURS (proxy hardened P0.3, lignes libres + ledger_account livrés) |
| 10 | N8N Avancé (Facebook Ads, Slack bidirectionnel) | ⬜ À FAIRE |
