# CLAUDE.md - Majord'home Module Artisan

> ⚠️ **Consolidation multi-tenant — Sem 0 hardening DB quasi-finie (~97%, 2026-05-21)** — Une 2ème entreprise va rejoindre la même instance Supabase. Audit complet : `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md` (13 CRITICAL codebase + 131 ERROR Supabase Advisor). État Sem 0 détaillé : mémoire `project_hardening_sem0_status.md`. **Plus rien de bloquant côté Majord'home/core. La roadmap fonctionnelle (Sprints 8-10) peut reprendre.**
> **Dernière MàJ** : 2026-05-21 — Sem 0 hardening DB complète (P0.0.1 exec_sql INVOKER, P0.0.2 73 vues security_invoker, P0.0.4 REVOKE anon × 22 RPCs, P0.0.5/.0.6 RLS + policies 13 tables, P0.0.7 storage paths `${orgId}/`, P0.0.9 audit corps 6 RPCs sensibles, P0.0.10 search_path × 111 fonctions, P0.2 MDH_CRON_SECRET crons, P0.3 pennylane-proxy hardened, P0.4 OAuth GSC state HMAC, P0.5 voice RPC service_role only, P0.6 voice quota daily, P0.7 requireOrganization, P0.8 V2 mailing N8n→edge, P0.10 voice_recorder permission, P0.11 cache keys orgId, P0.13-P0.20 branding multi-tenant, P0.21 headers HTTP, P0.22 no sourcemap, P0.23 xlsx→exceljs, P0.24 sandbox iframes, P0.25 helper `_shared/auth.ts`, P0.26 escapePostgrestSearchTerm, P0.27 ESLint config). Détails : `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`.
> **MàJ 2026-06-01** : sync doc post-bridge Pennylane — bridge canonique (OVERWRITE post-attache + auto-attach cron), stabilisation pipeline (montant Gagné = accepted_sum, chip Refusé seul, expired=pending) + conventions GRANT service_role, cron.job pg_cron, gotcha PL V2 single GET root, signature contrat figée (nouvelle section Module Contrats).
> **MàJ 2026-06-03** : Bloc A — refonte prise de RDV ↔ Kanban (nouvelle section **Module Planning**). Un RDV planifie une carte unique selon son type, plus d'auto-lead silencieux, activation déduppée, lien `appointments.intervention_id`, dérivation `next_rdv_date`/`has_active_rdv` dans les vues kanban, cycle de vie carte↔RDV. Reste : flux installation chantier + Bloc B (assistant créneaux).
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
- **Toute nouvelle table `majordhome.*` lisible via une vue publique `majordhome_*`** doit inclure `GRANT SELECT ON majordhome.<table> TO service_role` dans sa migration. Les vues étant `security_invoker=true`, RLS ne suffit pas : sans ce GRANT, les edge functions qui lisent la vue plantent en `42501 permission denied` **silencieux**. INSERT/UPDATE/DELETE non accordés (écritures via RPCs SECURITY DEFINER). Auditer via `has_table_privilege('service_role', …, 'SELECT')` (régression post-Sem0 : 14 tables corrigées le 2026-05-27)
- Ne JAMAIS appeler `public.exec_sql` depuis le frontend
- **Ne JAMAIS construire de SQL dynamique côté frontend pour le mailing** (ou tout flux multi-tenant). Passer par une RPC SECURITY DEFINER qui vérifie `auth.uid() ∈ org_members` avant compile (cf. `mail_segment_compile_safe`, `mail_single_client_sql`, `mail_fetch_recipients`)
- **Toute clause PostgREST `.or()` / `.ilike()` qui interpole un input utilisateur** DOIT passer par `escapePostgrestSearchTerm()` (`src/lib/postgrestUtils.js`) avant interpolation. Strip `,()*:%\` empêche un attaquant de forger un filtre additionnel (P0.26). **Exception documentée (2026-05-26)** : les recherches ILIKE Pennylane (`searchPennylaneCustomers` dans `pennylane.service.js`) conservent un escape anti-wildcard LOCAL (échappe les wildcards `%` et `_`) car `escapePostgrestSearchTerm()` strip `%` et casserait la recherche partielle. Si ce besoin se répète → créer une variante `escapePostgrestSearchTermPreservingWildcards()` au helper plutôt que re-copier le regex local
- **Toute edge function `verify_jwt:false`** qui n'est PAS un webhook tiers légitime (Resend, Pennylane callback signé) doit exiger un secret partagé via `requireSharedSecret(req, MDH_CRON_SECRET)` du helper `_shared/auth.ts` (P0.2/P0.25)
- **Toute edge function `verify_jwt:true`** doit valider la membership via `requireOrgMembership(req, opts)` du helper `_shared/auth.ts` (P0.25)
- **Intégrations conditionnelles par org** : utiliser un flag dans `core.organizations.settings` (ex `{ pennylane: { enabled: true } }`) consommé via `orgSettingsFilter` de `requireOrgMembership`. Pattern à étendre pour Meta Ads, intégrations futures (P0.3)
- **Cache keys React Query** : toutes les familles utilisent `all: (orgId) => [domain, orgId]` (convention pricingKeys-style). Détails dans l'en-tête de `cacheKeys.js` (P0.11)
- **Toute valeur de branding** (nom, adresse, URL, certification, couleur, logo) DOIT passer par `core.organizations.settings` + helper `buildCompanyInfo(settings)` de `src/lib/orgBranding.js` plutôt que d'être hardcodée. **Fallback neutre** (`"Votre entreprise"`, champs vides, couleur slate `#64748b`, pas de logo) — une org sans settings affiche du neutre, **pas du Mayer** (P0.13-P0.20 + refacto 2026-05-22). `portal_url` est une constante app (`APP_PORTAL_URL='https://majordhome.vercel.app'`, singleton tant qu'il n'y a pas de sous-domaines par org), pas un setting. `domain` est dérivé de `from_email.split('@')[1]`. `formatFullAddress` / `buildLegalFooter` filtrent les champs vides (pas de séparateurs orphelins).
- **Toute nouvelle valeur de configuration org** (branding, intégration tierce, paramètre métier) DOIT être éditable via `/settings/organization` (ou un autre tile `/settings/*` existant), jamais hardcodée dans le code. Si la valeur n'a pas encore son UI : ajouter le champ dans l'onglet pertinent de la page Settings AVANT de la consommer côté code. Sinon les futurs onboarding multi-tenant resteront bloqués (cf. Module Settings → Organization).
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
- **Migration `useAuth().organization.settings` → `useOrgSettings()`** (2026-05-22) : décision scale-ready prise — `useOrgSettings()` devient le canal canonique unique pour lire/écrire les settings d'org. Les callers existants qui lisent `useAuth().organization?.settings` (buildCompanyInfo dans les PDFs, getMapDefaultCenter, getOrgHeadquarters, GeoGrid `ScanConfigPanel`/`BenchmarkLauncher`, mailing wizard `CampaignWizard`, etc.) doivent être migrés progressivement. À faire au fil des touches sur ces fichiers (pas de big-bang refacto). Quand tu touches un caller, profite pour migrer.

## Architecture
```
src/
├── main.jsx                    # Point d'entrée
├── App.jsx                     # Routes
├── lib/                        # supabaseClient, mapbox, territoire-config, serviceHelpers, phoneUtils, constants, deviceViewport
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
│       ├── shared/             # KanbanBoard, SearchBar, LinkedClientCard (composants génériques)
│       ├── clients/            # ClientModal+Tabs (4 onglets: Info/Contrat/Équipements/Historique), ClientCard, EquipmentList, EquipmentFormModal
│       # Note : ClientDetail a 6 onglets : Info/Contrat/Équipements/Interventions/Timeline/Mailings
│       ├── chantiers/          # ChantierKanban, ChantierCard, ChantierModal, ChantierInterventionSection
│       ├── entretiens/         # CreateContractModal+Steps, ContractModal, ContractsList, EntretiensDashboard
│       ├── pipeline/           # LeadModal+FormSections+StatusConfig, LeadKanban
│       │   └── longTerm/       # LongTermTab, LongTermLeadDrawer, MoveToLongTermModal (suivi projets MT-LT, ⚠️ WIP)
│       ├── planning/           # EventModal+FormSections+Confirmations, TechnicianSelect, scheduling/SchedulingAssistant
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
// Tables sans vue publique :
//   - côté frontend : créer une vue publique majordhome_xxx (security_invoker=true).
//     .schema('majordhome').from(...) renvoie HTTP 406 — le schema n'est pas exposé via PostgREST.
//   - côté edge function : RPC SECURITY DEFINER dans public avec SET search_path = majordhome, public.
// TOUJOURS filtrer par org_id explicitement : .eq('org_id', orgId)
// Préférer .maybeSingle() à .single() quand 0 row est un cas légitime (sinon HTTP 406).
```

### Gotchas DB
- **Séquences PostgreSQL** : Ne JAMAIS calculer manuellement un ID/numéro via `SELECT MAX(col) + 1`. Toujours laisser le DEFAULT de la séquence DB (`nextval()`) générer la valeur — atomique, évite race conditions et désynchronisation. Exemple : `majordhome.client_number` utilise `majordhome.client_number_seq`, toute insertion doit omettre `client_number` pour que le DEFAULT s'applique.
- **Vérifier l'erreur sur les mutations Supabase** : Toujours destructurer `{ error }` sur `update()` / `insert()` / `delete()`, même sur des opérations qu'on pense sûres. Triggers DB, RLS ou contraintes peuvent causer des échecs silencieux. Pattern : `const { data, error } = await supabase.from(...).update(...); if (error) { ... }`. Vu en pratique avec un trigger fantôme `set_geogrid_scans_updated_at` qui faisait échouer silencieusement les UPDATE de `benchmark_id`.
- **Schema `majordhome` non exposé via PostgREST** : `supabase-js` côté edge function ne peut PAS écrire dans `majordhome.*` via `.schema('majordhome').from(...)` — PostgREST renvoie "Invalid schema: majordhome". Pattern obligatoire : RPC SECURITY DEFINER dans `public` avec `SET search_path = majordhome, public`. Le schema `core` est en revanche exposé (asymétrie). Même pattern déjà utilisé pour les écritures N8N → Supabase.
- **Vues `public.majordhome_*` → `security_invoker=true`** (P0.0.2, ✅ 2026-05-20) : avant le fix, les 73 vues étaient SECURITY DEFINER par défaut, ce qui bypassait RLS et faisait du filtre `.eq('org_id', orgId)` côté front la SEULE défense effective contre le cross-org. Aujourd'hui en `security_invoker=true`, RLS s'applique sur tous les accès via PostgREST. **Garder quand même le `.eq('org_id', orgId)` explicite (défense en profondeur)**. Si on crée une nouvelle vue `majordhome_*`, mettre `WITH (security_invoker=true)` dès la création.
- **`public.exec_sql(text)` → SECURITY INVOKER** (P0.0.1, ✅ 2026-05-20) : avant le fix, cette fonction était SECURITY DEFINER exécutable par `authenticated` → permettait à n'importe quel user front authentifié de lire toute la DB via une requête SQL arbitraire. Maintenant en INVOKER, restreinte aux droits du caller. **NE PAS rajouter d'appels à cette fonction depuis le frontend** ou des edge functions exposées au public.
- **Gotcha `DROP SCHEMA` + Exposed schemas PostgREST** (incident 2026-05-21, 30 min downtime) : Ne JAMAIS `DROP SCHEMA xxx CASCADE` sans avoir d'abord vérifié que le schéma n'est PAS listé dans **Dashboard Supabase → API Settings → "Exposed schemas"**. Si oui : (1) retirer le schéma de la liste exposée, (2) attendre le re-deploy PostgREST (~30s), (3) puis seulement DROP. Sinon → 503 sur TOUTE l'API REST de l'instance (toutes les apps cohabitantes impactées). Symptôme : PGRST002 "Could not query the database for the schema cache" côté frontend, `ERROR: schema "xxx" does not exist` côté logs postgres. Fix d'urgence : `CREATE SCHEMA IF NOT EXISTS xxx; NOTIFY pgrst, 'reload schema';`. **Un schéma vide listé en exposed schemas EST une dépendance même sans objet dedans.**
- **RPC `public.update_majordhome_lead(p_lead_id uuid, p_updates jsonb)`** : RPC SECURITY DEFINER générique pour patcher partiellement un lead côté frontend. Préférable à `supabase.schema('majordhome').from('leads').update(...)` qui renvoie 406 (schema non exposé). Pattern : `supabase.rpc('update_majordhome_lead', { p_lead_id, p_updates: { client_id, updated_at: new Date().toISOString() } })`. Utilisée dans ~15 endroits (leads.service, geocoding.service, hook ensureClientForLeadFromPennylane, etc.). Le filtre `org_id` est appliqué côté RPC (check membership).
- **Gotcha `pennylane_sync` peu peuplé** : `majordhome.pennylane_sync` n'est alimentée que par les flux MDH→PL (création client via `usePennylaneSyncClient`) ou backfills explicites. Les clients créés directement dans Pennylane (avant intégration, ou hors MDH) n'ont JAMAIS leur mapping posé. **Pattern préféré pour matcher entité PL ↔ entité MDH** : partir des entités PL (paginé), fetcher leurs détails en batch (avec `pLimit` pour éviter le rate limit), comparer leurs fields avec le lead/client. Cf. `getCandidateQuotesForLead` dans `pennylane.service.js`. **Bridge prioritaire** : quand un mapping existe (`bridgeCustomerId` résolu), faire 1 appel direct `/quotes?filter=[{customer_id eq}]` SANS fenêtre temporelle pour ramener exhaustivement les devis du customer.
- **Tie-break Pennylane** : pour départager 2 devis PL créés le même jour, trier sur `pennylane_quote_id DESC` (ID interne PL, strictement incrémental dans le temps de création) — PAS sur `amount_ht DESC` ni `assigned_at`. Pattern utilisé dans la RPC `lead_attach_quotes_and_send` pour calculer `most_recent_*` et propager `order_amount_ht` sur `leads`. À généraliser pour tout tri chronologique d'entités PL (factures, paiements).
- **Vue `majordhome_appointments` = miroir simple auto-updatable** : ne JAMAIS l'étendre en LATERAL+window (ex. pré-agréger `technician_ids`/`technician_names`) — la vue perd `is_insertable_into=YES` et les INSERT/UPDATE/DELETE via PostgREST cassent. Pour exposer la relation N:N techniciens, faire une 2ᵉ requête côté service sur `majordhome_appointment_technicians` puis merger en mémoire (pattern `getTeamDayAvailability` / `useAppointments` / `getAppointmentById`). Règle générale : **miroir simple = updatable, agrégat/LATERAL = read-only** (régression Bloc B, hotfix 2026-06-03). Ajouter une colonne scalaire simple reste OK mais `CREATE OR REPLACE VIEW` n'autorise l'ajout qu'**EN FIN de liste** (ex. `appointments.grand_secteur` après `target_invoiced`, migration `20260617_4`) — sinon "cannot change name of view column". `grand_secteur` = photo du grand secteur figée à la création du RDV (même clustering que la Programmation, via `entretiensService.getGrandSecteurMaps(coreOrgId)` cache module 30 min ; snapshot non bloquant côté `appointmentsService.createAppointment`). **⚠️ `getGrandSecteurMaps` attend l'org CORE (3c68…), PAS l'org majordhome (`orgId`, 7825…) utilisée pour l'insert appointment** — il filtre `majordhome_contracts.org_id` = org core ; passer le mauvais org_id renvoie des maps vides et le grand secteur ne se résout jamais (fix 2026-06-17).
- **Intervention org = client OU contrat** : `majordhome.interventions` peut être rattachée à un client (`client_id`) OU à un contrat (`contract_id`) sans client direct. Toute RPC SECURITY DEFINER qui dérive `org_id` d'une intervention doit faire `COALESCE(c.org_id, ct.org_id)` (via `LEFT JOIN clients c … LEFT JOIN contracts ct …`) — sinon faux `not_authorized` sur les interventions sans client mais liées à un contrat. Pattern : `call_get_card_context`, `call_attempt_record` (2026-06-03).
- **`equipments.category` = ENUM NOT NULL** : ne JAMAIS envoyer `null` (viole NOT NULL → erreur `23502`). Certains types pricing n'ont pas de `equipment_category` mappé (Panneau photovoltaïque, Prestations Diverses, Travaux Électricité) → fallback `'autre'` (même convention que `contracts._pricingCodeToEquipmentCategory`). Le type précis reste porté par `equipment_type_id` (`EquipmentFormModal.jsx`, fix 2026-06-16).
- **`clients.geocode_attempts` (smallint NOT NULL DEFAULT 0)** : compteur anti-retry du balayage de géocodage. Le trigger BEFORE UPDATE `reset_geocode_on_address_change` remet `latitude`/`longitude`/`geocoded_at` à NULL **et** `geocode_attempts` à 0 quand `address`/`postal_code`/`city` change → un ré-adressage relance le géocodage même après N échecs (migration `20260617_1`, 2026-06-17).

### Vues publiques principales
- `majordhome_clients` → clients + has_active_contract calculé
- `majordhome_contracts` → contracts JOIN clients (client_name, client_address, etc.)
- `majordhome_appointments` → appointments + client_first_name, assigned_commercial_id
- `majordhome_chantiers` → leads filtrés (chantier_status IS NOT NULL) + JOIN equipment_type + intervention parent
- `majordhome_kanban_cards` → cartes Kanban matérialisées depuis `lead_pennylane_quotes.quote_status` (1 lead → 1-2 cartes selon le mix de statuts, fallback sur `leads.status_id` si aucun devis PL attaché). Pennylane canonical pour le placement. **Allowlists statut (2026-05-27)** : Gagné = `accepted`|`invoiced` (bug #7) ; Devis envoyé = `pending`|`draft`|`expired` ; Perdu = `refused`|`denied`|`canceled` UNIQUEMENT (et seulement si pending=0 ET accepted=0). `expired` est traité comme pending (devis expiré = relançable, ne pousse PAS le lead en Perdu — décision produit 2026-05-27). Tout autre statut PL futur (`scheduled`…) reste invisible jusqu'à extension explicite de la vue. **⚠️ Gotcha `display_order` codé en dur** : le placement fallback (leads SANS devis PL attaché) repose sur un CASE codé en dur sur `statuses.display_order` (5='gagne', 6='perdu'). Toute migration qui insère/réordonne un statut pipeline décale ces positions et casse **silencieusement** le placement (leads → 'unknown', invisibles — vécu : 75 Perdu invisibles + 1 Gagné en Perdu après l'insert d'« À planifier » par la migration Webshop, reverté le 2026-06-15). Règle : ne jamais insérer un statut au milieu du funnel commercial sans vérifier/refactorer le CASE (mapper par label, pas par `display_order`) ; les statuts de planification (chantier/entretien) n'ont rien à faire dans `majordhome.statuses`.
- `majordhome_prospects` → prospects JOIN profiles (created_by_name, assigned_to_name)
- `majordhome_prospect_interactions` → interactions JOIN profiles (created_by_name)
- `majordhome_mailing_logs` → historique des emails envoyés par campagne (client_id, lead_id, campaign_name, subject, email_to, sent_at, status, provider_id, error_message, delivered_at, opened_at, clicked_at, bounced_at, complained_at, last_event_at, open_count, click_count)
- `majordhome_mailing_events` → audit log complet des events webhook Resend (1 ligne par event reçu, dédupliqué par svix_id)
- `majordhome_equipments`, `majordhome_interventions`, `majordhome_maintenance_visits`
- `majordhome_geogrid_scans`, `majordhome_geogrid_results`, `majordhome_geogrid_keyword_lists`, `majordhome_geogrid_benchmarks`
- `majordhome_pennylane_customer_lookup` → cache write-through des customers Pennylane (alimenté à chaque fetch `/customers/{id}` via `cacheUpsertCustomer` fire-and-forget — D.5, 2026-05-26)
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
- **RPC `public.org_upsert_role_permission(p_org_id, p_role, p_resource, p_action, p_allowed)`** — upsert d'une ligne `majordhome.role_permissions` depuis le frontend (éditeur Droits d'accès). SECURITY DEFINER, REVOKE anon, org_admin only. À utiliser pour toute écriture : `.schema('majordhome').from('role_permissions').upsert(...)` renvoie 406 PGRST106 (schema non exposé via PostgREST).
- **⚠️ Droits app-level (WIP — modèle en cours, ne PAS consommer prématurément)** : un registre canonical `src/lib/permissionsRegistry.js` (défauts app-level par role × resource × action ; 13 ressources × 3 rôles éditables ; `org_admin` = bypass total, jamais listé) + un socle DB **inerte** (table `majordhome.app_role_permissions` seedée via `node scripts/gen-app-role-permissions-sql.mjs` + migration ; fonctions `user_effective_role(uid, org)` / `role_can(role, resource, action, org)`) sont posés mais **pas encore branchés partout**. **Phase 3 partielle** : seules les écritures `equipments`+`interventions` sont gouvernées par `role_can(project_org_id(project_id), 'clients', edit|delete)` (helper `project_org_id` = SECDEF qui résout l'org d'un projet sans déclencher la RLS `core.projects`). **Reste (à faire avec Eric, prod partagée)** : policies `clients`/`contracts`/`leads`, branchement front `can()`, retrait du seed Mayer `org_seed_permissions`. Remplacement de policies = pattern ADD `role_can` en OR → vérifier → DROP ancien. **Ne JAMAIS** éditer `app_role_permissions` à la main (régénérer depuis le registre) ni brancher une policy RLS sur `role_can` avant la Phase 4. Spec : `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md`.

### God mode org_admin (hard delete avec cascade)
Pour les entités où un soft-delete + restauration ne suffisent pas (planning fantôme, doublons d'import) : bouton "Supprimer" rouge ghost dans le footer de la modale d'édition (visible si `effectiveRole === 'org_admin'`) appelant une RPC `public.<entity>_hard_delete(p_<entity>_id)` :
- SECURITY DEFINER, REVOKE anon, `SET search_path = majordhome, public` explicite
- Check `auth.uid() ∈ core.organization_members WHERE role='org_admin' AND org_id = (SELECT org_id FROM <entity> WHERE id = p_<entity>_id)` → `RAISE EXCEPTION 'org_admin_required'` sinon
- Purge des dépendances "satellites" qui n'ont pas de FK CASCADE explicite (ex : RDV planning lié à un lead)
- DELETE final → cascade DB sur les FK
- Retourne JSON avec compteurs purgés pour feedback UX
- Côté front : `ConfirmDialog` destructive avec preflight count via SELECT count head sur les tables satellites, toast success, invalidation cache croisée
- Exemples livrés : `lead_hard_delete` (2026-05-22) ; `client_hard_delete` (2026-06-12) — purge satellites NO ACTION (interventions+enfants, certificats, sms_logs, service_requests), détache leads pipeline + filleuls (NULL), DELETE → cascade contracts/client_activities/mailing_logs. UI = corbeille rouge `ClientDetail` (visible org_admin en lecture seule) + ConfirmDialog avec décompte preflight. Service `hardDeleteClient` + hook `useClient` (invalidation croisée clients/contrats/interventions/planning)

## Conventions de Code

### Services (`src/shared/services/`)
- Pattern : `export const xxxService = { async method() {...} }`
- Retour : `{ data, error }` ou `{ data, count, error }`
- **`storage.service.js`** : Opérations Storage Supabase centralisées (`getSignedUrl`, `uploadFile`, `deleteFile`)
- **`serviceHelpers.js`** (`src/lib/`) : `withErrorHandling()`, `extractRpcResult()`, `getMajordhomeOrgId()`
- **`phoneUtils.js`** (`src/lib/`) : `cleanPhone()`, `formatPhoneForSearch()` (pour la recherche en base), `isMobileFR()` (détecte mobile FR 06/07 national/international, partagé avec `sav.service.js::sendAvisRequest` et `::sendEntretienReminder` — SMS rappel entretien mono-destinataire via webhook `VITE_N8N_WEBHOOK_SMS_RAPPEL`, campagne `rappel_entretien` distincte de l'avis `avis_j1`, N8N envoie + log dans `sms_logs` ; timeout 15s traité comme succès car N8N traite en background ; testé via `node --test scripts/phone-utils.test.mjs`)

### Hooks (`src/shared/hooks/`)
- TanStack React Query v5
- **Cache keys centralisées** : `src/shared/hooks/cacheKeys.js` — source unique pour toutes les query keys
  - Import : `import { clientKeys } from '@/shared/hooks/cacheKeys'`
  - Familles : clientKeys, contractKeys, leadKeys, appointmentKeys, interventionKeys, chantierKeys, prospectKeys, pricingKeys, mailingKeys, pennylaneSyncKeys, geogridKeys, orgSettingsKeys, kanbanCardKeys
  - Re-exports depuis chaque hook pour rétrocompatibilité
  - **Convention P0.11 (2026-05-21)** : toutes les keys prennent `orgId` en 1ᵉʳ paramètre (`all: (orgId) => [domain, orgId]`, sous-keys idem) — défense en profondeur multi-tenant. Détails dans l'en-tête de `cacheKeys.js`.
- **`usePaginatedList`** : Hook générique pour listes paginées (utilisé par useClients, useProspects)
- **`useDebounce`** : Hook utilitaire de debounce (remplace les implémentations manuelles)
- **`usePennylaneSyncClient`** : Sync client MDH→Pennylane (fire-and-forget, ne bloque pas UX). Le code 411 Pennylane est récupéré et stocké dans `clients.pennylane_account_number`. Erreurs loggées silencieusement (`console.warn`). Cron `pennylane-sync-cron` : ne calcule JAMAIS `client_number` manuellement, laisse la séquence DB le générer (cf. Gotchas DB).
- **`useOrgSettings()`** (2026-05-22) — **canal canonique** pour lire ET écrire `core.organizations.settings` côté frontend. Retourne `{ settings, isLoading, save, isSaving }`. Lecture via SELECT direct sur vue `core.organizations` (RLS scope user→org via `security_invoker`) ; écriture via RPC `org_update_settings` (SECURITY DEFINER, org_admin only, raise P0002 si org inexistante). `onSuccess` invalide `orgSettingsKeys.byOrg(orgId)` + appelle `refreshUserData()` du AuthContext pour resync `useAuth().organization.settings` (consommé par `buildCompanyInfo`, `getMapDefaultCenter`, etc.).
  - **Règle (scale-ready)** : tout nouveau code lisant ou écrivant les settings d'org DOIT passer par `useOrgSettings()`. **Ne plus introduire de `useAuth().organization?.settings`** dans du nouveau code. Migration progressive des callers existants à planifier (cf. Dette technique).
- Retournent : `{ data, isLoading, error, refetch, ...mutations }`

### Edge functions (`supabase/functions/`)
- **Helper partagé `_shared/auth.ts`** (P0.25, 2026-05-21) — pose la convention d'auth pour toutes les edges :
  - `verify_jwt:true` → `requireOrgMembership(req, { orgId?, orgSettingsFilter?, requiredRole? })` — valide JWT user + membership user × org dans `core.organization_members`. Retourne `{ ok, userId, orgId, membershipRole, supabase }` ou `{ ok:false, response }` 401/403/500 prête à renvoyer.
  - `verify_jwt:false` (crons N8n, jobs internes) → `requireSharedSecret(req, Deno.env.get("MDH_CRON_SECRET") || "", "MDH_CRON_SECRET")` — check Bearer secret timing-safe.
  - Webhooks tiers (Resend Svix, Pennylane callbacks) → garder leur propre vérification de signature.
  - Exports : `corsHeaders`, `buildCorsHeaders(req)`, `jsonResponse(body, status, req?)`, `getAdminClient`, `timingSafeEqual`, `sanitizeError(err, fallback)`.
  - Pattern d'import : `import { requireOrgMembership } from "../_shared/auth.ts";` — le `name` du fichier dans le `files` array du MCP `deploy_edge_function` doit être `../_shared/auth.ts` pour que le bundler résolve correctement.
- **Helpers P1** (2026-05-21) : `sanitizeError(err, fallback)` strip stack/Bearer/JWT/`*_SECRET=…` en prod (détecté via env `DENO_ENV=production` ou `ENVIRONMENT=production`) ; `buildCorsHeaders(req)` whitelist d'origines via env CSV `FRONTEND_ORIGINS` (fallback `*` si vide — dev local). **`sanitizeError` (fix 2026-05-27)** : pour les objets non-Error (ex. `PostgrestError`, dont `String(err)` renvoie `"[object Object]"` et masque la vraie cause), fait `JSON.stringify(err)` en dev (fallback générique en prod pour ne pas leaker). À respecter dans tout helper d'erreur.
- **`supabase/config.toml`** (P1.6, 2026-05-21) — versionne `verify_jwt` des 16 edges pour éviter drift prod/repo lors d'un redéploiement via MCP.
- **Edges déjà migrées vers le helper** (2026-05-21+) : `gsc-oauth-init`, `pennylane-proxy`, `pennylane-sync-cron`, `pennylane-backfill-quotes`, `pennylane-sync-quote-status`, `voice-extract-fieldreport`, `mailing-send` (verify_jwt:false + `requireSharedSecret`), `mailing-scheduler` (pg_cron + `requireSharedSecret`), `resend-domain-onboard` (`requireOrgMembership` org_admin). À migrer plus tard : `gsc-oauth-callback`, `gsc-sync`, `contract-signed-notify`, `mailing-unsubscribe`, `resend-webhook`, `invite-client`.
- **`MDH_*` namespace** pour les env vars partagées entre apps cohabitantes (isolation Majord'home vs Pack Vendeur / Baikal / Arpet) : `MDH_CRON_SECRET`, etc.
- **Edge function décrite comme un cron** : elle DOIT avoir une entrée `cron.job` réellement créée via migration versionnée (pg_cron) — sinon elle ne tourne jamais. Bug silencieux vécu : le cron `pennylane-sync-quote-status`, documenté "toutes les 15 min", est resté ~2 jours sans planification (entrée `cron.job` absente). Vérifier avec `SELECT jobname, schedule FROM cron.job`. Le secret partagé (`MDH_CRON_SECRET`) est lu depuis `vault.secrets` par le job pg_cron (cf. `pv-scrape-auto-poll`).

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
  - `LinkedClientCard` : carte présentationnelle « Client lié » (nom + n° client + ville + slot `children` pour l'action). Partagée pipeline (`SectionClientLinking`) ↔ entretien (`ContractModal`). Aucune logique métier.
- **Utilitaires partagés** : `src/lib/utils.js`
  - `formatDateForInput` (Date|string → YYYY-MM-DD, timezone-safe)
  - `formatDateFR` (→ "1 janvier 2026"), `formatDateShortFR` (→ "1 janv. 2026")
  - `formatDateTimeFR`, `formatPhoneNumber`, `formatEuro`
  - `computeEndTime`, `computeDuration`
  - `formatRelativeFR` (→ « il y a 2 heures », « dans 3 jours » via `Intl.RelativeTimeFormat` ; fallback `formatDateShortFR` au-delà d'une semaine ; `null` si invalide)
- **Branding multi-tenant** : `src/lib/orgBranding.js` — `buildCompanyInfo(settings)` construit l'objet `company` (nom, SIRET, adresse, RGE, etc.) depuis `core.organizations.settings`, avec **fallback neutre** (`"Votre entreprise"`, champs vides, couleur slate, pas de logo — refacto 2026-05-22, plus de fallback Mayer). Helpers `formatFullAddress(company)` + `buildLegalFooter(company)` filtrent les champs vides. Consommé par les PDFs (`generateContractPdfBlob(data, company)`, idem Certificat/Devis/PvReception) et le wizard mailing.
- **Siège org pour trajets** (P0.19, 2026-05-21) : `src/lib/territoire-config.js` — `getOrgHeadquarters(settings)` retourne `{ lat, lng, label }` du 1ᵉʳ centre de `settings.territoire_centers` ou `null`. Passé en `hqCoords` à `getDrivingDuration` / `getDrivingFromAddress` / `detectZoneForAddress` (`zoneDetection.js`). Si null → calcul de trajet skip, l'UI doit cacher l'affichage "depuis X".
- **Départements couverts par l'org** (P0.13 follow-up) : `src/lib/territoire-config.js` — `getCoverageDepartments(settings)` retourne `string[]` (codes département) depuis `settings.geogrid_target_department` (singleton, itération 1). Fallback neutre = `[]` (UI doit prompter la config). Liste statique 95 + 2A/2B + DOM-TOM dans `src/lib/departments.js` (`FRENCH_DEPARTMENTS`, `getDepartmentByCode`, `getDepartmentLabel`).
- **Constantes** : `src/lib/constants.js` — `DEFAULT_PAGE_SIZE`, `LARGE_PAGE_SIZE`, `KANBAN_PAGE_SIZE`
- **Logger** : `src/lib/logger.js` (P1.7, 2026-05-21) — `logger.error/warn/info/log/debug/table/group/groupEnd`. En prod (`import.meta.env.PROD`), tout est no-op sauf `logger.error` (Sentry-like). Variant `logger.silent.error` pour muter aussi les erreurs. Migrer les nouveaux `console.*` vers `logger.*` au fil de l'eau.
- **Viewport adaptatif tablette** : `src/lib/deviceViewport.js` — `initDeviceViewport()` (appelé dans `main.jsx` avant le render React) réécrit `<meta viewport>` pour forcer `TABLET_VIEWPORT_WIDTH=1024` sur les tablettes durcies (écran <1024px logique + pointeur tactile) → dézoom natif du navigateur → bascule en vue bureau (sidebar + colonnes). PC et grands écrans tactiles inchangés. Détection sur `screen.width/height` (stable, pas `innerWidth`). Hook DOM `html[data-device-class]`. Point d'extension unique pour un cas « phone » : `getDeviceClass()`.
- **⚠️ Gotcha react-pdf / Helvetica** (tous les PDFs : contrats, certificats, devis, étude solaire) : la police PDF de base (Helvetica) ne couvre PAS tous les glyphes Unicode. `toLocaleString('fr-FR')` insère une espace fine insécable U+202F dans les milliers → artefact (« 1/953 ») ; idem `~`, flèches/triangles ▲▼, moins typographique U+2212. Toujours passer par des formatters PDF-safe : normaliser les espaces (`.replace(/\s/g, ' ')` couvre U+202F/U+00A0), forcer la virgule FR via `String(x).replace('.', ',')`, remplacer les symboles par des mots/ASCII (cf. `fmtInt`/`numStr` dans `EtudePDF.jsx`).

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

### Scheduler Campagnes Auto (edge `mailing-scheduler` — pg_cron, depuis 2026-06-02)
> ⚠️ Remplace l'ancien workflow N8n « Mayer - Scheduler Campagnes Auto ». **Régression vécue 21/05→02/06** : après l'archivage du webhook `mayer-mailing` (P0.8 V2), le scheduler N8n continuait d'appeler `mail_campaigns_due` + `mail_campaign_mark_run` (donc `last_run_at` avançait, masquant la panne) sans plus jamais envoyer → ~12 jours sans bienvenue ni relances.

- **Edge `mailing-scheduler`** (`verify_jwt:false`, protégée par `MDH_CRON_SECRET`), planifiée par `pg_cron` toutes les 10 min (migration `20260602_mailing_scheduler_cron.sql`, secret lu depuis `vault.decrypted_secrets`). App-level cross-org : 1 cron pour toutes les orgs, chaque campagne porte son `org_id`.
- Pour chaque campagne due (`mail_campaigns_due()`) : POST `mailing-send` mode bulk → `mail_campaign_mark_run` **UNIQUEMENT si HTTP 2xx** (self-healing : un échec gateway laisse la campagne due, pas de fenêtre consommée à vide). Body `{ dry_run: true }` supporté pour pré-vérif.
- **Règle** : une edge cron qui orchestre une autre edge doit conditionner son `mark_run`/`commit` à la réussite HTTP de l'edge appelée (sinon une panne gateway consomme la fenêtre sans effet).
- Workflow N8n scheduler **à archiver** côté N8n ; `docs/n8n/MAILING_SCHEDULER_SETUP.md` obsolète.

### Onboarding domaine Resend (multi-tenant, 2026-06-02)
Pour qu'une org envoie depuis `@<son-domaine>`, l'admin passe par **Settings → Organization → Coordonnées → « Domaine d'envoi (Resend) »** (`ResendDomainSection.jsx`, visible une fois `from_email` enregistré). Edge `resend-domain-onboard` (`verify_jwt:true`, `requireOrgMembership(requiredRole:'org_admin')`) = proxy mince vers l'API Domains Resend (région `eu-west-1` RGPD), actions `setup`/`status`/`verify`. **Archi app-level vs org-level** : le moteur Resend (clé API) est app-level (1 compte partagé entre orgs cohabitantes) ; le domaine est org-level, **strictement dérivé de `settings.from_email`** (pas d'input libre — un admin ne peut pas enregistrer un domaine arbitraire dans le compte partagé). Statut persisté dans `settings.resend` (cache d'affichage). Pattern à reprendre pour toute intégration tierce app-level : dériver la ressource org d'un setting déjà validé par l'UI.

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
- `verify_jwt:false` — auth interne via `requireSharedSecret(MDH_CRON_SECRET)` (appel du scheduler `mailing-scheduler`) OU validation JWT user en début de handler (frontend). ⚠️ **Gotcha clé `sb_secret`** : le projet utilise une clé service_role au format `sb_secret` (non-JWT, récent) → une edge `verify_jwt:true` ne peut PAS être appelée avec cette clé via le gateway. Conséquence : tout appel inter-edges doit être `verify_jwt:false` + secret partagé. ⚠️ **Drift repo/prod** : la v11+ prod (badge cron + INSERT via vue publique `majordhome_mailing_logs`) n'est pas resynchronisée dans le repo → faire `get_edge_function` avant toute modif de `mailing-send`.
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
Toute campagne avec `is_automated = true` + `auto_segment_id` + cadence est déclenchée par l'edge `mailing-scheduler` (pg_cron 10 min, cf. sous-section dédiée ci-dessus). `lead_bienvenue` est la 1ʳᵉ campagne (cadence `auto_cadence_minutes=10`).

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

## Module Planning / Prise de RDV ↔ Kanban (Bloc A 2026-06-03 + Bloc B assistant créneaux 2026-06)

Refonte du service de prise de RDV. **Principe unique** : un RDV (`appointments`) planifie **une seule carte** (work item) déterminée par son **type** ; l'état de la carte est piloté par ses RDV. **Plus d'auto-lead silencieux** (cause historique des leads fantômes dans le pipeline).

### Types → destination unique
| Type (`appointment_type`) | Kanban | Work item |
|---|---|---|
| `rdv_technical` (Visite Technique = closing) + `rdv_agency` (legacy, alias) | Pipeline | `leads` (`status_id`) |
| `installation` | Chantier | `leads` (`chantier_status`) |
| `maintenance` (Entretien) | Entretien | `interventions` (`entretien`) |
| `service` (SAV) | Entretien | `interventions` (`sav`) |
| `other` (Autre) | — (planning seul) | aucun — **défaut non piégeux** |

### Modèle de données
- Lien `appointments.intervention_id` (miroir de `lead_id`, FK `ON DELETE SET NULL`). Un RDV pointe vers `lead_id` **ou** `intervention_id` **ou** rien (Autre). Multi-RDV : N appointments par carte (la date carte = 1ᵉʳ RDV).
- **Dérivation, source unique = `appointments`** : les vues `majordhome_entretien_sav`, `majordhome_chantiers`, `majordhome_kanban_cards` exposent `next_rdv_date` (MIN des RDV actifs liés) + `has_active_rdv`, via `LEFT JOIN LATERAL` filtré par type d'appt (`status NOT IN ('cancelled','no_show')`). Toutes en `security_invoker=true` (préservé). **Pas de champ dénormalisé** : puce date + marqueur ambre dérivent de ces 2 colonnes. Le filtre par type évite qu'un vieux RDV VT pollue la date d'un chantier (pipeline = `rdv_technical`/`rdv_agency`, chantier = `installation`, entretien = via `intervention_id`).

### Activation (prendre un RDV)
- `appointmentActivation.service.js::resolveCardForAppointment({type, clientId, leadId?, interventionId?})` : rattache (depuis un kanban) **ou** active la carte du client (dédup par client+type, jamais de doublon, jamais de formulaire prospect). Entretien/SAV → matérialise l'intervention via `entretiens.service.js::ensureEntretienCard`. VT → réutilise un lead **actif** (≠ Gagné/Perdu) sinon en crée un lié au client. `other` → rien.
- **Prospect** (vrai formulaire) réservé au **walk-in inconnu** (Planning, ni client ni lead lié), dans `EventModal::handleSave`.
- `EventModal` accepte `attachContext={ leadId?, interventionId?, lockedType? }` (rattachement direct + type figé depuis un kanban). Défaut fiche/planning = `other` ; Installation non proposée depuis la fiche.

### Cycle de vie carte ↔ RDV (unique writer = `appointments.service.js`)
- `syncCardStateOnCreate` (prise) : avance la carte en « planifié » **forward-only** (entretien `workflow_status→planifie` ; lead VT `status_id→RDV planifié` si display_order<3 ; chantier `chantier_status→planification` si en amont). Ne descend jamais, ne touche pas un état terminal.
- `recomputeEntretienWorkflow` (suppression/annulation de RDV) : entretien → recalcule `planifie`/`a_planifier` selon présence d'un RDV actif. Pipeline/chantier : no-op (marqueur « à replanifier » dérivé de `has_active_rdv=false`).
- **Les 3 chemins de planification entretien doivent poser `intervention_id`** : `EntretienSAVModal.handleConfirmScheduling`, `EntretienSAVKanban.handleConfirmSchedule`, `entretiens.service.ensureKanbanAndAppointmentForVisit`. Le pipeline pose déjà `lead_id` (`LeadModal`).
- **Brique de planification partagée `savService.scheduleEntretien({ card, slots, includesEntretien, coreOrgId })`** (2026-06-17) : source unique de planification entretien/SAV (createAppointmentBatch type `maintenance`/`service` avec `intervention_id` + `scheduled_date` + `workflow_status='planifie'` + confirm web-draft). Appelée par `EntretienSAVKanban.handleConfirmSchedule` **et** `ContractModal` (bouton « Planifier » → `ensureEntretienCard` → `SchedulingTransitionModal`). Ne pas réimplémenter la séquence ailleurs. ⚠️ `savService.updateFields` est une **allowlist par champ** : un champ absent de la liste est silencieusement ignoré (`scheduled_date` ajouté le 2026-06-17, sinon la date de planif était perdue — y compris dans l'ancien kanban).
- **`ContractModal` (slide-over entretien) planifie via le système unifié** (plus de « Marquer comme effectué »). Badge « Visite {année} » dérivé par `deriveVisitBadgeStatus({ visits, activeCard, currentYear })` (`src/lib/entretienVisitStatus.js`, testé `scripts/entretien-visit-status.test.mjs`) : visite courante `completed`→Réalisé ; `cancelled`/`skipped`→**Non réalisé (tâche close, ≠ « À faire »)** ; sinon carte active `planifie`→Planifié ; sinon À planifier. Carte active lue via `useEntretienByContract(orgId, contractId)`.

### Cartes & kanban
- Puce de gauche = **date du RDV** (`next_rdv_date` > `scheduled_date` > `created_at`). Pipeline : icône ambre `CalendarClock` si colonne `rdv_planifie` sans RDV actif. **Chantier** : icône ambre `CalendarClock` si `chantier_status='planification'` sans RDV `installation` actif (`!has_active_rdv`) — réactivé au Bloc B stage 4 (flux de planif installation depuis `ChantierModal`).
- `EntretienSAVKanban` : tri par date du RDV **ascendant** (du plus ancien au plus futur), même clé que l'affichage. Le `KanbanBoard` générique préserve l'ordre des items.
- Bouton **« Ranger »** (icône `Archive`, bas-gauche, cartes `a_planifier` uniquement) : `savService.deleteEntretienCard` + toast undo (recrée via `createEntretien`). Invalide `entretienSavKeys.all(orgId)` → dégrise instantanément le contrat dans l'outil Programmation (`plannedContractIds` est une query sous ce préfixe). Certificats masqués en `a_planifier` (utiles seulement une fois planifié).

### Assistant créneaux (Bloc B — livré 2026-06)
- Dossier `src/apps/artisan/components/planning/scheduling/` : `SchedulingAssistant.jsx` (orchestrateur multi-créneau), `DayResourceGrid.jsx` (vue jour × colonnes par membre, drag pour poser un créneau, conflits ambre non bloquants, off-hours grisés), `SlotDraftList.jsx` (créneaux en construction, tech par ligne). Remplace `SchedulingPanel`.
- **Contrat** : 1 créneau = 1 appointment, multi-créneau = N appointments via `appointmentsService.createAppointmentBatch(slots, ctx)`. `appointment_type` imposé par le **caller** (contexte partagé), pas par-slot. VT → commerciaux, entretien/SAV → techniciens.
- **Stage 4 — convergence chantier (2026-06-04)** : les jours d'installation sont des `appointments` `installation` natifs (`lead_id=chantier.id`), plus d'« intervention parent » ni de `intervention_slots`. `ChantierModal` ouvre `SchedulingAssistant` (multi-jours) → `createAppointmentBatch({ appointment_type:'installation', lead_id: chantier.id })` ; `ChantierInterventionSection` = liste read-only des appointments (`J X/N` via `chantier_day_index`/`chantier_total_days`) ; `useAppointments` ne merge plus les chantier-slots.

### Gotcha & reste à faire
- **⚠️ Backfill entretien** : un RDV `maintenance` sans `intervention_id` ne veut PAS dire entretien non fait — il peut déjà être `realise`/`facture`. Un backfill ne gardant que `workflow_status NOT IN (realise,facture)` crée des doublons « planifié » pour des entretiens déjà faits. **Scope correct = RDV À VENIR uniquement** (régression vécue & corrigée le 2026-06-03 : 24 doublons supprimés).
- **Reste (Bloc B stage 5)** : nettoyage des services orphelins post-convergence chantier (`chantierSlots.service.js`, `chantierSlotKeys`, `useInterventionSlots`, `getChantierInterventionByLeadId`, mutations `createChantierIntervention/createSlot/deleteSlot`) + DROP vue `intervention_slots` (5 slots historiques non migrés — décision Eric : repartir propre). À faire après validation prod.
- Spec Bloc A : `docs/superpowers/specs/2026-06-03-rdv-kanban-unifie-bloc-a-design.md` · Plan : `docs/superpowers/plans/2026-06-03-rdv-kanban-unifie-bloc-a.md` · mémoire `project_refonte_rdv_kanban_bloc_a.md`.
- Spec Bloc B (assistant créneaux multi-tech, à implémenter) : `docs/superpowers/specs/2026-06-03-rdv-kanban-assistant-creneaux-bloc-b-design.md` · Plan : `docs/superpowers/plans/2026-06-03-rdv-kanban-assistant-creneaux-bloc-b.md`.

## Module Programmation entretiens — Grands secteurs & géocodage auto (2026-06-17)

L'onglet **Programmation** (Entretiens) regroupe les contrats par **« grands secteurs »** géographiques au lieu du code postal nu (un CP agrège des communes éparses, et deux CP proches en n° ne sont pas proches en réalité). Spec : `docs/superpowers/specs/2026-06-17-programmation-grands-secteurs-design.md` · Plan : `docs/superpowers/plans/2026-06-17-programmation-grands-secteurs.md`.

### Clustering (frontend, pur)
- `src/lib/sectorClustering.js` — `clusterSectorsByProximity(sectors, { radiusKm=15, cityPopulation })` : **partition stricte au grain code postal** (chaque CP dans 1 seul grand secteur), agglomératif sous **contrainte de rayon** (haversine : tous les CP d'un secteur à ≤ rayon du barycentre pondéré → pas d'effet de chaîne). Déterministe (tri d'entrée + tie-break d'indice). Pur (aucune dépendance React/Supabase), testé `node --test scripts/sector-clustering.test.mjs`.
  - **Zéro doublon** (test de conservation : Σ CP des groupes = total) · **zéro orphelin** : CP sans coords → bucket `Non localisé` (placé en dernier) ; CP géocodé mais **isolé** (> rayon de tout le monde) → **son propre secteur singleton** (≠ `Non localisé`). On ne **scinde jamais** un CP entre deux secteurs.
  - **Nommage par la ville la plus peuplée** (PAS par nb de contrats) : `src/lib/communePopulation.js::fetchCityPopulations` (API `geo.api.gouv.fr`, cache localStorage org-scoped 30 j ; `normalizeCity` gère accents + abréviations St/Ste). Fallback nb de contrats si population indispo. Ex. le secteur d'Albi s'appelle « ALBI » même si le CP 81990 (Le Séquestre) y a plus de contrats.
- `entretiensService.getContractsBySector` : merge les coords client (2ᵉ requête `majordhome_clients`, la vue contrats ne les expose pas), **trim le CP**, annote chaque secteur de `grandSecteurId/Name/Order` (forme de retour inchangée).
- `SectorGroupView.jsx` : rendu **2 niveaux grand secteur → clients** (le niveau CP a été retiré — décision 2026-06-17, inutile une fois la commune affichée sur chaque ligne) ; clients triés par commune puis nom ; nom du grand secteur en MAJUSCULES (uniforme). **⚠️ Gotcha** : l'icône `Map` de lucide-react **shadow** le constructeur global `Map` → aliaser l'import en `MapIcon` si on utilise `new Map()` dans le fichier (sinon `Map is not a constructor` au rendu — invisible au build).

### Géocodage serveur automatique (« sans dette géographique »)
- Le géocodage à la saisie (`ClientModal`/`LeadModal` via `geocoding.service.js`) ne couvre PAS les créations hors modale (cron Pennylane, N8N, imports) ni les échecs/ré-adressages → comblé par un balayage serveur. Règle unique : `geocoded_at IS NULL` + adresse exploitable = à géocoder.
- **Edge `geocode-sweep`** (`verify_jwt:false`, `requireSharedSecret(MDH_CRON_SECRET)`) : lit un lot via RPC `geocode_fetch_pending_clients` (service_role), géocode via l'endpoint **unitaire** `/search/` de `geo.api.gouv.fr` (⚠️ **NE PAS** utiliser l'endpoint CSV `/search/csv/` : ses colonnes résultat ne sont pas à la position supposée → matchait 0 ; fix `cac340c`), applique via RPC `geocode_apply_client_coordinates` (COALESCE strict, n'écrase jamais une coord par NULL). RPCs service_role only (migration `20260617_2`). Cron pg_cron **30 min** (migration `20260617_3`, secret lu depuis vault). App-level cross-org, géocodage org-agnostique.
- Combiné à `clients.geocode_attempts` (cf. Gotchas DB) : 3 tentatives max puis abandon, reset au ré-adressage.

### Grand secteur figé sur le RDV (Planning)
- Photo du grand secteur figée à la création du RDV dans `appointments.grand_secteur` (détails + gotcha org CORE ≠ majordhome : cf. Gotchas DB, ligne `majordhome_appointments`). Affiché sur l'étiquette calendrier (`Planning.jsx::renderEventContent` : ligne 1 = heure + **type**, ligne 2 = `NOM · Secteur XXX` → supprime le doublon de nom). Périmètre = clients sous contrat (entretiens) ; pas de rétro-remplissage des RDV existants.

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
- `deleteEntretienCard(interventionId)` — hard delete intervention + enfants certificats. « Ranger » une carte « À planifier » → libère le contrat dans l'outil Programmation. Délie les RDV via FK `appointments.intervention_id ON DELETE SET NULL`. Toast undo recrée via `createEntretien` (snapshot).
- `scheduleEntretien({ card, slots, includesEntretien, coreOrgId })` (2026-06-17) — **source unique** de planification entretien/SAV (cf. Module Planning). Appelée par le kanban **et** `ContractModal`.

### Pièces de rechange (détail + « Offert », 2026-06-05)
- Composant `EntretienPartsSection.jsx` (fiche entretien) : détail des pièces (parent + enfants) + toggle « Offrir/Annuler » + suppression (X rouge), réservé **team_leader+**.
- Vue `majordhome_entretien_sav` v2 : `parts_detail` (JSON array agrégé parent+enfants via `WITH ORDINALITY`, clés `intervention_id`/`idx`/`designation`/`quantite`/`prix_ht`/`offert`) ; `parts_total_ttc` **exclut** les pièces offertes (geste commercial répercuté en prépa facturation).
- RPCs (SECURITY DEFINER, REVOKE anon, role-checkées team_leader+ côté DB) : `certificat_set_piece_offert(p_intervention_id, p_piece_index, p_offert)`, `certificat_delete_piece(p_intervention_id, p_piece_index)`.
- **⚠️ Gotcha `idx` parts_detail** : les `idx` sont recalculés par la vue (`WITH ORDINALITY`) → toute mutation qui retire/réordonne (`certificat_delete_piece`) invalide les `idx` mémorisés côté front. Pattern obligatoire : `refreshParts()` recharge `parts_detail` depuis la vue après CHAQUE mutation avant d'autoriser la suivante (sinon le 2ᵉ delete consécutif vise la mauvaise pièce).

## Module Contrats (configuration, PDF, signature)

Conventions contrat centralisées (config tarifaire / PDF / signature / zone). Code éparpillé : `ContractPdfSection.jsx` (envoi devis), `ContractSign.jsx` (écran de signature), `useContractZone` (resolver zone partagé), `generateContractPdfBlob` (PDF).

### Sources de vérité figées à la signature (2026-06-01)
- À la signature, **`contract.amount` et `contract.zone_id` sont les sources de vérité — figées à la configuration du contrat**. L'écran de signature (`ContractSign.jsx`) et le PDF ne recalculent JAMAIS le total ni la zone.
- `useContractZone` (resolver partagé) n'est qu'un **fallback** si `contract.zone_id` est NULL (contrat jamais configuré). Ne pas le laisser écarter une zone enregistrée (même la zone par défaut « Hors Zone ») au profit d'une re-détection par code postal.
- Tout écart entre la somme des lignes (grille tarifaire courante × zone stockée) et `contract.amount` s'affiche en **« Remise commerciale »** pour traçabilité — la somme des lignes retombe toujours sur le total signé. (Cas du forçage global *legacy* ; le mécanisme courant est le **forçage par ligne** ci-dessous.)
- **Règle générale** : tout artefact contractuel signé/envoyé au client (devis, contrat, certificat) lit les valeurs **ENREGISTRÉES**, jamais recalculées depuis la grille tarifaire courante. Sinon divergence config↔signature (bug CTR-00457 : contrat « Hors Zone » à 250 € enregistrés affiché/signé 220 €).

### Forçage de prix par ligne (override par équipement, 2026-06-05)
- Le prix d'un équipement dans un contrat peut être **forcé manuellement par ligne** (admin, dans `ContractPricingSection`). Le prix forcé **substitue le prix grille de la ligne** ; la dégressivité et le reste du mécanisme (`sous-total → dégressivité → total` via `calculateContractTotal`) restent appliqués en aval. `contracts.amount` se réaligne via l'auto-sync de `ContractPricingSection`.
- **Scope = contrat (donc client), JAMAIS global** : le forçage porte sur `(contract_id, equipment_id)` (1 contrat = 1 client). Il ne touche **jamais** la grille tarifaire `pricing_rates` (cas général par zone × type, partagée par l'org) ni les autres clients. La grille reste le défaut ; le forçage est une exception contractuelle ponctuelle.
- **Stockage sans migration** : rangé dans la table existante `majordhome.contract_pricing_items` via la convention **« ligne avec `equipment_id` NON NULL = prix forcé volontaire »** (les lignes `equipment_id` NULL = snapshots de création, ignorés → aucune régression). Service `getContractLineOverrides` / `setContractLineOverride` (delete ciblé + insert) / `clearContractLineOverride` (`pricing.service.js`) ; hook `useContractLineOverrides` (`usePricing.js`) ; cache key `pricingKeys.contractOverrides`. Consommé par les 3 calculs `computedPricing` (`ContractPricingSection`, `ContractSign`, `ContractPdfSection`) → écran de signature + PDF cohérents.
- **Legacy** : l'ancien forçage global (`contracts.amount_forced` + input « Forcer la valeur ») est retiré de l'UI. Les contrats `amount_forced=true` (33 en prod) sont préservés tant qu'aucune ligne n'est éditée ; à la 1ʳᵉ édition de ligne ils basculent sur le calcul (`amount_forced → false`). `buildContractPresentation` (écart en « Remise commerciale » / redistribution à la hausse) reste le **filet de rétro-compat** pour ces contrats non encore basculés.

## Module Tarification (Settings → /settings/pricing)

CRUD per-org de la grille tarifaire (P0.0.6 pricing per-org, 2026-05-21). Accès `org_admin` only.

- **Page** : `src/apps/artisan/pages/settings/PricingSettings.jsx` — 5 onglets : Zones / Types d'équipement / Tarifs (matrice zone × type) / Remises volume / Options
- **Hook admin** : `usePricingAdmin()` dans `src/shared/hooks/usePricing.js` — expose `{zones, equipmentTypes, rates, discounts, extras}` (incluant inactifs) + 13 mutations CRUD scopées automatiquement sur `useAuth().organization.id`
- **Hook prod** : `usePricingData()` (existant) — filtre `is_active=true` pour les formulaires contrat
- **Service** : `pricing.service.js` — lectures via vues publiques `majordhome_pricing_*` (RLS via `security_invoker`), écritures via `.schema('majordhome')` (CRUD UI)
- **Tables `majordhome.pricing_*`** : `pricing_zones`, `pricing_equipment_types`, `pricing_rates`, `pricing_discounts`, `pricing_extras` — toutes avec `org_id NOT NULL` + FK `core.organizations` + RLS `org_id IN (org_members)` + UNIQUE composites `(org_id, …)`
- **`upsertRate`** utilise `onConflict: 'org_id,zone_id,equipment_type_id'` (composite UNIQUE)

## Module Settings → Organization (/settings/organization)

Configuration multi-tenant de l'identité de l'org (livraison Task 1-15, 2026-05-22). Accès `org_admin` only — RouteGuard `resource="settings"` + guard `isOrgAdmin` in-component (`<Navigate to="/settings" replace />` si non-admin).

- **Page** : `src/apps/artisan/pages/settings/OrganizationSettings.jsx` — sidebar gauche + 3 onglets :
  - **Identité** (`organization/IdentityTab.jsx`) : `brand_name`, `legal_name`, `legal_form`, `capital`, `siret` (auto-format groupes de 3+5), `rcs`, `tva_intra` (auto-format FR + uppercase), `insurance`, `rge_certifications` (chips via `RgeCertificationsInput`)
  - **Coordonnées** (`organization/ContactTab.jsx`) : `address`, `postal_code`, `city`, `phone` (auto-format FR), `from_email`, `reply_to`, `website_url` (auto-prefix https au save). `domain` calculé auto depuis `from_email`, `portal_url` = constante app (singleton)
  - **Territoire** (`organization/TerritoryTab.jsx`) : siège unique obligatoire (label + recherche adresse Mapbox + couleur + emoji) + référence Google Business (`google_place_id` + bouton "Trouver" vers Place ID Finder FR) + département principal (`geogrid_target_department` via `DepartmentSelect`, 95 dépts + DOM-TOM, bouton "Détecter depuis siège" via Mapbox reverse geocoding) + N antennes commerciales optionnelles (même `CenterEditor` que le siège, expandable inline)
- **Composants partagés** : `pages/settings/organization/components/` — `RgeCertificationsInput.jsx`, `AddressSearch.jsx`, `DepartmentSelect.jsx`, `CenterEditor.jsx`
- **Source de vérité** : `core.organizations.settings` (JSONB) — consommé par `buildCompanyInfo(settings)`, `getOrgHeadquarters(settings)`, `getMapDefaultCenter(settings)`, `getCoverageDepartments(settings)`, `getResources(settings)` (mailing)
- **Hook** : `useOrgSettings()` — canal canonique read/write (cf. section Hooks)
- **RPC** : `public.org_update_settings(p_org_id, p_patch jsonb)` SECURITY DEFINER, REVOKE anon, GRANT authenticated. Check `auth.uid() ∈ org_members WHERE role='org_admin'` côté DB. Raise `42501` si non-admin, `P0002` si org inexistante. Shallow merge JSONB (`||`).
- **Save par onglet** (pas global) : chaque onglet a son `{ form, initial }` local + `isDirty` calculé via `JSON.stringify` diff. Bouton "Enregistrer" disabled si `!isDirty || !isValid || isSaving`.
- **Migration legacy** : champ `geogrid_department_code` (singleton historique Mayer) → `geogrid_target_department` (convention unifiée). Backfill Mayer = `'81'` (2026-05-22).
- **Fallbacks Mayer neutralisés** (refacto 2026-05-22) : `orgBranding.js` (NEUTRAL_DEFAULTS) + `mapbox.js` (`getMapDefaultCenter` dérive du siège, fallback centre France `[2.5, 46.5]`) + `communesService.js` (paramétré par `departmentCode`). Une org sans settings voit du neutre, pas du Mayer.
- **Spec/plan source** : `docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md` + `docs/superpowers/plans/2026-05-22-multitenant-settings-organization.md`

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

## Module Pennylane quote-driven (Sprint 9 — chantiers ↔ devis PL)

> ⚠️ **WIP — stabilisation en cours** (init `1df67db4` 2026-05-21 ; bridge canonique lead↔customer livré `8b08424` 2026-05-27). Pipeline ↔ Pennylane opérationnel : attache multi-devis, cron sync 15 min, **bridge canonique (PL fait foi pour l'identité du lead post-attache)**, auto-attach des nouveaux devis. À reprendre 1 par 1 si bugs.

Couche de liaison entre les chantiers du Kanban (`majordhome.leads`) et les devis Pennylane importés. Permet d'attacher/détacher manuellement un devis PL à un lead/chantier, de gérer plusieurs devis par chantier, et d'afficher le suivi devis directement sur la carte Kanban + la modale.

### DB
- **Table `majordhome.lead_pennylane_quotes`** (N:N leads ↔ devis Pennylane) — 127 lignes pour 90 leads en prod. Colonnes :
  - `ejected_at` (timestamptz) — soft-detach (un devis "éjecté" reste tracé sans bloquer un nouvel attachement)
  - `ejected_reason` (text) — `'deleted_in_pennylane'` posé par le cron quand devis disparu PL (404)
  - `is_winning_quote` (boolean, default false) — "devis effectivement signé" pour les leads Gagnés. 1 winning max par lead actif, garanti par la RPC `lead_mark_won_with_quote` (pas de contrainte UNIQUE pour éviter UniqueViolation en transition). **Invariant DB (trigger `trg_lead_pennylane_quotes_invariant_winning`, 2026-05-25)** : `is_winning_quote=true ⟹ quote_status ∈ {accepted, invoiced}` — poser winning sur un statut incompatible (expired/refused/pending/null) force `quote_status='accepted'` automatiquement. Préserve le geste commercial face aux désynchros cron/RPC.
  - `pdf_url` (text, nullable) — URL publique stable du PDF Pennylane (`q.public_file_url`). Posée à l'attach par `lead_attach_quotes_and_send` / `assign_pennylane_quote_to_lead` + sync systématique par le cron `pennylane-sync-quote-status` (bug #8, 2026-05-26).
- Vue publique `public.majordhome_lead_pennylane_quotes`.
- **Table `majordhome.pennylane_customer_lookup`** (D.5, 2026-05-26) — cache write-through des customers PL. PK composite `(org_id, pennylane_id)`, RLS scoped org_id. Alimentée fire-and-forget après chaque `fetchCustomerById`/`fetchCustomersByIds` via `cacheUpsertCustomer(orgId, customer)` dans `pennylane.service.js`. RPC d'upsert : `public.upsert_pennylane_customer_lookup(p_org_id, p_payload jsonb)` SECURITY DEFINER, COALESCE strict (jamais d'écrasement d'une valeur existante avec null/vide). Usage prévu : search "Client existant" sur création lead (bug #5 ROGERO) en complément de `majordhome_clients`. Pas de seed initial — le cache se peuple à l'usage.

### RPCs Pipeline ↔ PL (bridge PR 1-5, spec `docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md`)
- `public.lead_attach_quotes_and_send(p_org_id, p_lead_id, p_quotes jsonb)` — multi-attach + bascule statut "Devis envoyé" en 1 transaction. Calcule `most_recent_quote` via tie-break `pennylane_quote_id DESC` (cf Gotchas DB), propage `order_amount_ht` (ROUND).
- `public.lead_mark_won_with_quote(p_org_id, p_lead_id, p_winning_quote_pl_id)` — **définition canonique UNIQUE de « gagner un lead »** : pose `is_winning_quote=true` (false sur les autres), bascule `status_id` en Gagné, pose `won_date` + **`chantier_status='gagne'` (= crée le chantier)** + insère `lead_activity` `'status_changed'` source `'mark_won_with_quote'`. Idempotent (garde `display_order<>5`). **Appelée par le chemin manuel ET par le cron** — ne JAMAIS dupliquer la logique de gain (statut / won_date / chantier) ailleurs, toujours passer par cette RPC. Fix régression chantier (2026-06-02) : avant, le gain auto via le cron ne posait que `is_winning_quote` → ni statut Gagné, ni chantier. `won_date` = jour du run (PL V2 n'expose pas la date de signature réelle).
- `public.pennylane_sync_ensure_winning_quotes(p_org_id)` — helper du cron : pour chaque lead avec ≥1 devis `accepted` sans devis gagnant, appelle `lead_mark_won_with_quote` sur le plus récent `accepted` (effet « gagné » complet → crée le chantier). Déclencheur sur `accepted` uniquement (évite de créer des chantiers rétroactifs sur de vieux `invoiced`). Chaque lead wrappé en `EXCEPTION` (un échec ne casse pas le batch). SECURITY DEFINER, service_role only.
- `public.pennylane_sync_update_quote_fields(p_quote_id, p_new_status, p_pdf_url)` (2026-05-26) — update batch `quote_status` + `pdf_url` en COALESCE strict (ne vide jamais une valeur existante). Appelée par le cron à chaque sync, remplace `pennylane_sync_update_quote_status` côté cron (l'ancienne reste dispo pour rétrocompat). service_role only.
- `public.pennylane_sync_overwrite_lead_fields(p_lead_id, p_org_id, p_fields jsonb)` (2026-05-27) — mirror lead de `pennylane_sync_update_client_fields`. Sémantique COALESCE+NULLIF : PL non-vide → écrase MDH (PL canonical post-attache) ; PL vide → préserve MDH. service_role only.
- `public.pennylane_sync_auto_attach_quote(p_org_id, p_lead_id, p_quote_pl_id, …)` (2026-05-27) — attache un nouveau devis PL ≥1000€ HT à un lead déjà bridgé. Idempotent (no-op si quote_pl_id déjà en base, y compris ejected = respect du soft-detach). Bump lead → "Devis envoyé" si stage < 4 (forward-only). service_role only.
- `public.lead_pennylane_quotes_link_client(p_lead_id, p_org_id, p_client_id)` (2026-06-10) — backfill `pennylane_client_id` sur les liaisons actives sans client d'un lead (post-attach, matérialisation client). Idempotent. SECURITY DEFINER, membership-checked, REVOKE anon/PUBLIC, GRANT authenticated. Existe car la vue `majordhome_lead_pennylane_quotes` n'est pas updatable (`.schema('majordhome')` → 406). Appelée par `ensureClientForLeadFromPennylane`.
- Toutes : SECURITY DEFINER, `search_path = majordhome, public, core` locked, REVOKE anon, check `auth.uid() ∈ core.organization_members` + check `settings.pennylane.enabled=true` (sauf les `*_sync_*` service_role only).

### Cron `pennylane-sync-quote-status` (edge function, 15 min)
- `verify_jwt:false` + `MDH_CRON_SECRET` (cf charte edge functions). Appel Pennylane direct (pas via `pennylane-proxy` qui exige JWT user). **Planifié via `cron.job` pg_cron** (la planification a manqué ~2 j à la création — cf. charte edge functions).
- **Étapes 1-3** : sync `quote_status` + `pdf_url` PL → `lead_pennylane_quotes` via RPC `pennylane_sync_update_quote_fields` (COALESCE strict, backfill auto du `pdf_url` manquant en 1 cycle) ; ejecte les devis disparus côté PL (404 → `ejected_reason='deleted_in_pennylane'`) ; appelle `pennylane_sync_ensure_winning_quotes`.
- **Étape 4 — Sync identité PL → MDH (OVERWRITE-when-PL-has-value, 2026-05-27)** : pour chaque customer bridgé (≥1 devis attaché actif), fetch `/customers/{id}` puis update clients ET leads via `pennylane_sync_update_client_fields` + `pennylane_sync_overwrite_lead_fields`. PL non-vide écrase MDH (PL canonical post-attache) ; PL vide → préserve MDH (NULLIF). Sûr car les champs contact MDH sont verrouillés en lecture seule dès qu'un devis est attaché (cf. règle "Contact lead lecture seule").
- **Étape 5 — Auto-attach nouveaux devis (2026-05-27)** : pour chaque customer bridgé, `/quotes?filter=customer_id eq X` (filter natif V2), diff avec `lead_pennylane_quotes` → chaque nouveau devis ≥1000€ HT (`PIPELINE_MIN_AMOUNT_HT`) attaché via `pennylane_sync_auto_attach_quote`. Idempotent (no-op si déjà en base/ejected). Auto-bump lead → "Devis envoyé" si stage < 4 (forward-only, ne rétrograde pas Gagné/Perdu).
- Pattern général : **Cron sans JWT user → appel API tierce direct. Filtrer orgs activées via `settings.<integration>.enabled` côté JS quand PostgREST ne suffit pas (jsonb imbriqué).**

### Composants frontend
- `src/apps/artisan/components/chantiers/QuoteBlock.jsx` (257 LOC) — affiché sur **ChantierCard** (compact) + **ChantierModal** (détail). Liste les devis attachés, statut, montant, lien Pennylane.
- `src/apps/artisan/components/chantiers/LinkPennylaneQuoteModal.jsx` — modale single-attach manuel pour le chantier post-vente.
- `src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx` — modale multi-attach au pivot lead "Devis envoyé". Sections Suggestions (`useCandidateQuotesForLead`) + Exploration 60j (`useUnlinkedQuotes`).
- `ChantierReceptionSection.jsx` — intègre les devis liés dans le flow de réception chantier.
- **Branchement conditionnel** : si `usePennylaneEnabled()` true (lecture `settings.pennylane.enabled`) ET target="Devis envoyé" → `QuoteCandidatesModal`. Sinon flow MDH classique (`QuoteModal`). Préserve le mode 100% MDH pour les orgs sans Pennylane.

### Service / Hook
- `src/shared/services/pennylane.service.js` — méthodes `assign`/`eject`, multi-devis, `getCandidateQuotesForLead`, `getUnlinkedQuotes`, `fetchCustomerById`, extracteurs (`extractCustomerEmail/Phone/Name/Address`).
- `src/shared/hooks/usePennylane.js` — wrappers React Query.
- `src/shared/hooks/useOrgSettings.js::usePennylaneEnabled()` — sélecteur sec `Boolean(settings?.pennylane?.enabled)`.
- **Gotcha rate limit** : Pennylane V2 = 25 req/5s. Tout batch `/customers/{id}` ou `/quotes/{id}` doit être wrappé par le helper interne `pLimit(5)` de `pennylane.service.js` (sinon → 429 retry → 500 proxy + latence >3s).
- **LISTE vs single GET (nom client)** (corrigé 2026-06-10, ef7c175/b1ba789) : le single GET `/quotes/{id}` et `/customers/{id}` embarquent le nom complet du customer ; mais la **LISTE `/quotes` n'embarque QUE `customer.id`**, PAS le nom (l'ancienne note inverse était fausse → régression ad57337). Pour afficher le nom sur des devis issus de la LISTE, utiliser le helper cache-first `resolveCustomerNames(orgId, ids)` : lecture batch `pennylane_customer_lookup` (0 appel PL) + fallback live `/customers/{id}` borné (cap 40 + pLimit 5) avec write-through self-healing. Ne JAMAIS re-fetch en boucle non bornée `/customers/{id}` sur ~100 devis.
- **Filter natif PL V2** : `/quotes?filter=[{"field":"customer_id","operator":"eq","value":X}]` (JSON URL-encoded) évite le scan paginé global. Pattern via `fetchQuotesForCustomerId()` avec fallback try/catch sur scan + filter client-side si syntaxe rejetée (400). `pennylane-proxy` whitelist OK car split sur "?" → `cleanPath='/quotes'`.
- **Shape réponse PL V2 single GET** : `/quotes/{id}` et `/customers/{id}` retournent la ressource **directement au root** (PAS wrappée dans `{ quote: … }` / `{ customer: … }`). Assumer le wrap a fait skip 155 devis silencieusement (2026-05-27). Helper défensif `unwrapPennylaneResource<T>(rawData, expectedKey)` : essaie la clé wrap puis fallback root via `'id' in obj`.
- **Shape champs customer PL V2** (gotcha 2026-06-10) : `customer.emails` peut être un array de **strings** (`["x@y.fr"]`) OU d'objets (`[{ value, is_default }]`) — gérer les deux formes (cf. `extractCustomerEmail` frontend + `extractEmail` dans le cron). L'adresse est dans `billing_address.address` (et **non** `.street`). Lire `.value` sur une string ou `.street` sur l'objet → `undefined` → email/adresse jamais syncés silencieusement.

### Règles métier Pipeline ↔ PL
- **Auto-matérialisation client + bridge canonique au rattachement de devis** : quand un devis PL est rattaché à un lead, le hook `useAttachQuotesAndSend` déclenche post-process `ensureClientForLeadFromPennylane` (`src/shared/hooks/usePennylane.js`) qui :
  1. Fetch `/customers/{customer_id}` PL pour récupérer les coordonnées complètes
  2. Patche le lead avec les champs PL en mode **OVERWRITE** (décision 2026-05-27 : post-attache, PL est canonique pour l'identité du lead — `buildContactPatchFromCustomer` ne préserve PLUS les saisies user). Sécurité : PL vide → préserve MDH (NULLIF côté RPC). Aucun conflit possible car les champs contact MDH sont verrouillés en lecture seule dès qu'un devis est attaché (cf. règle "Contact lead lecture seule"). Bandeau bleu UI "Données synchronisées depuis Pennylane — à modifier dans Pennylane".
  3. Cherche un mapping existant dans `majordhome.pennylane_sync` (entity_type='client', pennylane_id=customer_id) → link au client existant si trouvé
  4. Sinon `convertLeadToClient`
  5. Upsert `pennylane_sync` + UPDATE `lead_pennylane_quotes.pennylane_client_id`
  - Fire-and-forget : un échec ne casse pas l'attach principal.
  - **Note backfill** : les leads attachés avant les règles (pré-2026-05-24/25) n'ont pas bénéficié — re-trigger via détache/rattache manuel.
- **Contact lead lecture seule si devis PL attaché** : `pennylaneSyncedContact = pennylaneActive && linkedQuotes.length > 0` → `contactFieldsDisabled` (override `editClientMode`). Bandeau bleu "Données synchronisées depuis Pennylane — à modifier dans Pennylane" si au moins 1 champ contact est rempli ; bandeau amber "Aucune coordonnée disponible" si tous vides (lead ancien pré-fix #6 — l'user doit détacher/rattacher pour resync).
- **Sémantique 3-fold des montants pipeline** : trois valeurs distinctes. (1) `card.total_amount` = `accepted_sum` de la vue `majordhome_kanban_cards` (SUM des devis `quote_status IN ('accepted','invoiced')`) = "montant total des devis valides du lead" → affiché en colonne **Gagné uniquement** (ex. 2 devis accepted 6481+5470 → 11951€). (2) `leads.order_amount_ht` = "montant du dernier devis PL envoyé" (calculé à l'attache, arrondi entier) → affiché dans les **autres colonnes** Kanban (en amont, on ne sait pas lequel sera signé). (3) `is_winning_quote=true` = "devis effectivement signé" (sélection commerciale via `lead_mark_won_with_quote`). Les trois peuvent diverger.
- **Seuil pipeline 1000€ HT** : devis PL <1000€ HT exclus du sélecteur de rattachement (constante `PIPELINE_MIN_AMOUNT_HT` dans `QuoteCandidatesModal.jsx`) — considérés SAV/entretien, hors pipeline commercial. Devis déjà attachés préservés même sous le seuil (vue informative).
- **Invariant « Devis envoyé » exige ≥1 devis PL rattaché (org PL, 2026-06-10)** : sur une org Pennylane-enabled, la transition d'un lead vers « Devis envoyé » (display_order 4) est INTERDITE sans ≥1 devis dans `lead_pennylane_quotes` (`ejected_at IS NULL`) — rapprochement 100% manuel (human-in-the-loop). Filet DB = trigger `enforce_devis_envoye_requires_quote()` (BEFORE UPDATE OF status_id sur `majordhome.leads`, SECURITY DEFINER, scope orgs PL only via `settings.pennylane.enabled`). Compatible `lead_attach_quotes_and_send` / `pennylane_sync_auto_attach_quote` (insèrent le devis AVANT de basculer le statut, même transaction). UX : drag kanban ou bouton « Envoyer le devis » ouvre la fiche + `QuoteCandidatesModal` (prop `autoQuote` threadée Pipeline→LeadModal). Flag carte ambre « Devis à rapprocher » sur les violateurs historiques (`usePennylaneEnabled() && column_key==='devis_envoye' && !hasDevis`).
- **Liens vers les devis Pennylane (UI)** : TOUJOURS utiliser `q.public_file_url` (PDF direct, persisté dans `lead_pennylane_quotes.pdf_url`). Ne JAMAIS construire d'URL `app.pennylane.com/quotes/{id}` à la main — format inventé qui 404 en multi-cabinet (bug #8, 2026-05-26). Si `pdf_url` est NULL (devis tout neuf pas encore passé dans le cron) → lien grisé + tooltip "PDF non synchronisé (prochain cycle <15 min)" plutôt qu'un lien cassé.
- **Stabilisation UI pipeline post-bridge (2026-05-27)** :
  - **Dates lead canoniques côté PL** : `quote_sent_date` et `won_date` ne sont plus éditables depuis la modale lead. La date d'envoi de chaque devis est lisible dans `LinkedQuotesPanel` (`quote_date` PL) ; la date de signature n'est pas exposée par PL V2, le passage en Gagné est tracé via `leads.status_changed_at`. **Colonnes DB `leads.quote_sent_date`/`won_date` préservées** (nullables) pour les consommateurs legacy (rapports, chantiers) mais ne plus les éditer côté UI lead.
  - **`LinkedQuotesPanel` chip statut** : un seul chip affiché — "Refusé" (`quote_status IN ('denied','refused')`). Les autres statuts (pending/accepted/draft/expired/invoiced) ne sont pas chip-isés : le placement Kanban + le badge Gagnant transmettent déjà l'info. Palette deutan-friendly (mirror `QuoteCandidatesModal`).
  - **`expired` = pending sémantique** : un devis Pennylane expiré reste en "Devis envoyé" (relançable), ne pousse pas le lead en Perdu. Aligné sur la vue `majordhome_kanban_cards` (expired dans `pending_count`/`pending_sum`) et `LeadCard.filteredQuotes` (expired dans `devis_envoye`, pas `perdu`).

### Référence
- Spec bridge complet : `docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md` (8 PRs séquentielles, PR 1-5 livrées)
- Spec multi-devis : `docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md`
- Spec bug #7 quote_status sync : `docs/superpowers/specs/2026-05-25-bug7-quote-status-sync-design.md` (option B retenue : étendre allowlist `accepted_count` à `accepted,invoiced` + trigger invariant winning)
- Spec d'arbitrage WIP : `docs/PROMPT_SPRINT_PENNYLANE_QUOTE_DRIVEN.md`
- Brief refonte modale matching : `docs/PROMPT_PENNYLANE_MATCHING_REFACTOR.md` (consommé partiellement par les commits perf + bridge prioritaire + pré-remplissage contact 2026-05-25 ; reste à traiter bug #5 ROGERO + cache `pennylane_customer_lookup`)

## Module Appels sortants (cerveau livré — mock, câblage Kanban à faire)

> 🔧 **WIP** — moteur de campagne d'appels sortants V1 (entretien). DB + frontend (service/hook/UI) livrés en **mock** (rien ne téléphone encore). Reste : câblage Kanban + V2 téléphonie réelle. Plan : `docs/superpowers/plans/2026-06-03-campagne-appels-sortants-moteur.md` · Spec : `docs/superpowers/specs/2026-06-03-campagne-appels-sortants-moteur-design.md`.

Depuis le kanban entretien colonne `a_planifier` : file séquentielle 1-à-1 via `CallProvider` abstrait → filtre les non-aboutis → screen-pop quand un humain décroche → 3 gestes (RDV / refus / à rappeler). Réutilise `appointmentsService.createAppointment({appointment_type:'maintenance'})` (RDV) et `entretiensService.recordVisit({status:'cancelled'})` (refus = passe l'entretien en cancelled, pas de carte fantôme).

- **Abstraction provider** : `src/apps/artisan/components/appels/callProvider.js` — `CallProvider` (EventEmitter `on/off/_emit` + `start/pause/resume/stop/resolveTransfer`). V1 = `MockCallProvider` (scénarios déterministes, sans téléphonie) ; V2 = provider réel (Vapi/Telnyx + PBX). Events `{contactId,...}` : `dialing` | `no_answer` | `voicemail` | `human_answered` | `transfer_accepted` | `transfer_missed` | `session_done`.
- **Plages horaires légales** : `callWindow.js::isWithinCallWindow(params, now)` — défaut `DEFAULT_CALL_WINDOW = {window_start:9, window_end:20}`, pas le dimanche.
- **DB (2026-06-03)** : tables `majordhome.call_sessions` + `call_attempts` (CHECK XOR `intervention_id`/`lead_id`, allowlist 7 résultats `no_answer|voicemail|transferred_answered|transfer_missed|rdv_booked|refused|callback`) ; vues `majordhome_call_sessions` / `_attempts` / `_attempt_stats` (stats = `call_count` + `last_call_at` + `last_call_result` par carte) ; RPCs `call_session_start` / `call_attempt_record` (vérifie ownership intervention/lead × org) / `call_get_card_context` (org via `COALESCE(client.org_id, contract.org_id)`).
- **Frontend (2026-06-03)** : service `callCampaigns.service.js`, hook `useCallSession({orgId})` (state machine `idle|running|paused|popped|done` + compteurs + API `start/pause/resume/stop/acceptTransfer/closeCurrent`), cache keys `callSessionKeys` / `callAttemptKeys`, UI `PhoningPanel.jsx` (modale orchestrateur) + `PhoningScreenPop.jsx` (screen-pop transfert, 3 gestes).
- **Reste à câbler** : bouton « Lancer l'appel » sur kanban entretien `a_planifier` (monter `PhoningPanel`) + tag 📞 sur cartes (JOIN `majordhome_call_attempt_stats` dans `majordhome_entretien_sav`) ; puis V2 téléphonie réelle (attend Vapi/PBX + modale RDV unifiée).

## Module Solaire (calculateur PV — livré 2026-06-11)

App interne d'aide à la vente terrain (commerciaux) : simulation de rentabilité photovoltaïque 3 étapes (localisation → consommation → résultats) + étude PDF client. Spec : `docs/superpowers/specs/2026-06-10-app-solaire-pv-design.md` · Plan : `docs/superpowers/plans/2026-06-10-app-solaire-pv.md` · mémoire `project_solaire_calculateur_pv.md`.

- **App** : `src/apps/solaire/`. Routes `/solaire` + `/solaire/historique` (RouteGuard `resource=pv_calculator`, `action=view`) + page admin `/settings/solaire` (org_admin). Sidebar « Solaire » (icône Sun). Permission `pv_calculator.view` seedée (commercial/team_leader ✅, technicien ❌).
- **Moteur PUR** : `src/apps/solaire/lib/pvEngine.js` (aucun import React/Supabase — conversions pente/orientation, puissance max toiture, répartition mensuelle, conso VE, coeff simultanéité, coût depuis grille avec interpolation linéaire). Testé via `node --test scripts/pv-engine.test.mjs`. **RÈGLE produit absolue : le surplus PV n'est JAMAIS valorisé en €** (approche conservatrice).
- **Étude PDF** : `etudeModel.js::buildEtudeModel` = **source de calcul unique** partagée UI étape 3 ↔ PDF (live + régénération depuis l'historique via `pvgis_monthly` persisté). PDF via `@react-pdf/renderer` brandé `buildCompanyInfo(settings)`, graphique redessiné en primitives (pas de capture). Fusion des annexes (bibliothèque technique) via `pdf-lib` (annexe défaillante = ignorée avec warn, jamais bloquante).
- **Config org** : `core.organizations.settings.pv` (défauts mergés via `buildPvConfig(settings)` de `pvConfig.js`) — `default_price_kwh`, `inflation_rate`, `degradation_rate`, `horizon_years`, `system_loss`, `panel_power_wc`, `autoconso_threshold`, `cost_grid[]` (`[{kwc, prix_ttc}]` 1→9 kWc, interpolation), `simultaneity{}`, `ev{}`, `max_power_kwc` (défaut 9), `tech_docs[]`. Éditable via `SolaireSettings.jsx` (4 onglets : Calcul / Grille de coûts / Simultanéité & VE / Bibliothèque technique). **⚠️ `org_update_settings` merge JSONB niveau 1 (`||`)** → toujours sauver l'objet `pv` COMPLET via `useOrgSettings().save({ pv })`, jamais un sous-objet partiel.
- **Plafond d'offre `max_power_kwc` (défaut 9)** : au-delà de 9 kWc le régime réglementaire change (offre résidentielle, grille 1-9 kWc). Optimiseur + scénarios bornés par `min(max toiture, max_power_kwc)` ; mention `cappedByOffer` si la toiture permettrait plus.
- **DB** : `majordhome.pv_simulations` (RLS owner-or-admin) + vue publique `majordhome_pv_simulations` (security_invoker, auto-updatable, GRANT service_role). Brouillon `localStorage pv-draft:${userId}`.
- **Accès externes** : `src/apps/solaire/lib/pvgis.js` — `fetchPvgis1kwc()` (invoke edge `pvgis-proxy`), `searchAddress()` (géocodage `api-adresse.data.gouv.fr` en **fetch DIRECT** : CORS OK, pas de proxy — contrairement à PVGIS), `getDevicePosition()`. Bibliothèque technique : bucket `product-documents` path `${orgId}/solaire/`, métadonnées `settings.pv.tech_docs` (fiches `kind='borne'` annexées seulement si option borne active dans la simu).
- **Edge `pvgis-proxy`** (`verify_jwt:true`, `requireOrgMembership`) : relais CORS vers PVGIS v5.2 PVcalc. `peakpower=1` forcé serveur (prod linéaire en kWc, le front multiplie → 1 seul appel PVGIS/simulation). Body `{lat, lon, loss?, angle?, aspect?}` → `{e_m[12], e_y, params}`. Bornes validées, timeout 15s (504), 502 si PVGIS KO/shape inattendue.
- **Palette deutan stricte** (jaunes graphiques, bleus/neutres texte — jamais rouge/vert).

## Module Meta Ads (dashboard ROI)

Dashboard de suivi ROI des campagnes Meta (publicité). Gotchas Meta API (double-comptage leads, System User Token, CBO/ABO, budget +25%) détaillés en mémoire `project_meta_ads_initiative.md`.

- **Vue `public.majordhome_meta_ads_leads_attribution`** (lue par le dashboard) : funnel par org_id / campaign_id / adset_id / commercial_id / date (total/contacted/planified/quoted/won/lost). `leads_won` est **Pennylane-aware** : `is_won=true` OU devis PL non-éjecté (`is_winning_quote OR quote_status IN ('accepted','invoiced')`) ; `leads_lost` exclut ces gagnés-via-PL.
- **RPC `public.meta_ads_backfill_lead_attribution(...)`** (service_role only, merge-only `jsonb_strip_nulls`) — rétro-peuple `external_data` (campaign_id/adset_id/ad_id) via un workflow N8N de re-fetch Meta par lead. Colonnes générées `leads.meta_campaign_id/adset_id/ad_id` dérivées de `external_data->>` (NULL tant que pas backfillé — les leads live N8N n'embarquent pas les fields campagne par défaut).
- **Règle d'agrégation (à généraliser)** : toute vue/RPC qui compte les « leads gagnés » doit être **Pennylane-aware** (statut `is_won` OU devis PL gagnant), sinon sous-comptage au moment où le cron tourne. À appliquer à tout futur KPI/dashboard pipeline.

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
