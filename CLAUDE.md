# CLAUDE.md - Majord'home Module Artisan

> **Consolidation multi-tenant** (onboarding d'une 2ᵉ entreprise sur la même instance Supabase) — hardening Sem 0 quasi terminé. Détails : `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`.
> **Référence par domaine** : `docs/DATABASE.md`, `docs/COMPONENTS.md`, `docs/SPRINT_LOG.md`, et `docs/MODULE_*.md` (Mailing, Pennylane, Planning, Entretiens). Historique des modifs : git.

## Posture de travail (à chaque tâche)
1. **Réfléchir avant de coder** — énoncer les hypothèses, ne pas deviner. Si le code peut répondre (caller, export, convention existante), le lire d'abord.
2. **Simplicité d'abord** — minimum de code, zéro abstraction spéculative.
3. **Chirurgical** — toucher seulement ce qui sert l'objectif. Le nettoyage adjacent se **signale** (spawn_task / note de fin), il ne s'embarque pas dans le commit.
4. **Objectif défini puis vérifié** — critère de succès AVANT de commencer ; boucler jusqu'à preuve (build / lint / test), pas avant, pas après.
5. **Surfacer les conflits, jamais les moyenner** — 2 patterns dans le code ? on en choisit un et on le dit.
6. **Échouer fort** — « terminé » avec 14% sauté en silence = le pire bug. Surfacer l'incertitude et ce qui a été ignoré (cf. nos gotchas « échec silencieux »).
7. **Checkpoint à chaque étape** — ne pas empiler sur un état cassé ; repartir d'un contexte frais quand ça tourne en rond, ne pas re-litiger une approche rejetée.

## Lancer un /loop
Avant de démarrer un loop auto-rythmé, TOUJOURS définir :
- Critère de succès vérifiable + la commande/check qui le prouve
- Checkpoint : rapport après chaque étape (fait / reste / diff), stop si l'arbitrage appartient à Eric
- Conditions d'arrêt : fini OU bloqué OU ambigu

Pas d'objectif d'output défini → on ne lance pas (le loop s'arrête trop tôt ou tourne sans fin). Objectif gros/multi-étapes → l'écrire dans un plan `docs/superpowers/plans/` et y pointer le loop.
## Projet
Plateforme SaaS métier pour artisans du bâtiment (CVC). CRM, planning, pipeline commercial, outil terrain tablette, carte territoire. Pilote : **Mayer Énergie** (Gaillac, 81). Préparation onboarding 2ème entreprise sur la même instance Supabase.

## Multi-tenant & sécurité

L'app cohabite avec d'autres sur une **instance Supabase partagée** → toute fuite cross-org est critique. Le hardening Sem 0 (8 bombes structurelles résolues : `exec_sql`→INVOKER, 73 vues→`security_invoker`, REVOKE anon × RPCs, RLS sur tables `majordhome.*`, storage préfixé `${orgId}/`, secrets sur crons, OAuth state HMAC, mailing sans SQL brut) est archivé dans `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`. **Les règles ci-dessous en sont la contrepartie vivante — à respecter à chaque touche :**

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
- Si tu touches un fichier identifié comme dette (LeadModal, clients.service.js, etc.) : **ne pas embarquer la décomposition dans le même commit** (Posture #3) — la signaler (spawn_task / note de fin) pour un passage dédié
- TODOs : OK temporairement avec une raison claire (ex `// TODO P0.X — à faire`), mais ne pas les laisser pourrir > 1 mois
- **`useOrgSettings()` = canal canonique unique** pour lire/écrire les settings d'org. **Ne plus introduire de `useAuth().organization?.settings`** dans du nouveau code. Les callers legacy (buildCompanyInfo des PDFs, getMapDefaultCenter, getOrgHeadquarters, GeoGrid `ScanConfigPanel`/`BenchmarkLauncher`, mailing `CampaignWizard`…) restent à migrer : **tâche à signaler (spawn_task), pas à embarquer au fil de l'eau** (Posture #3).

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


## Module Mailing → `docs/MODULE_MAILING.md`
Règles qui mordent :
- Provider **Resend**. Envoi via edge `mailing-send` — **jamais de SQL brut côté front** (RPC `mail_fetch_recipients` membership-checked, compile côté DB).
- Scheduler auto = **pg_cron → edge `mailing-scheduler`** (PAS N8n). `mail_campaign_mark_run` SEULEMENT si `mailing-send` renvoie HTTP 2xx (sinon fenêtre consommée à vide).
- `is_transactional=true` → exclu du broadcast (onglet Envoi).
- Webhook `resend-webhook` (Svix HMAC) idempotent via `svix_id` UNIQUE ; priorité statuts sent<delivered<opened<clicked, bounce/complaint=terminal.
- Gotcha clé `sb_secret` (service_role non-JWT) : tout appel inter-edges = `verify_jwt:false` + secret partagé.

## Module Planning / RDV ↔ Kanban → `docs/MODULE_PLANNING.md`
Règles qui mordent :
- **1 RDV = 1 carte** selon son `appointment_type` (plus d'auto-lead silencieux). Lien `appointments.intervention_id` OU `lead_id` OU rien.
- Dérivation `next_rdv_date`/`has_active_rdv` dans les vues (source unique = `appointments`). Vue `majordhome_appointments` = **miroir simple updatable** → JAMAIS de LATERAL/window (casse les INSERT PostgREST).
- Unique writer du cycle carte↔RDV = `appointments.service.js` (forward-only, ne descend jamais un état terminal).
- Source unique planif entretien/SAV = `savService.scheduleEntretien(...)` (kanban + ContractModal). `savService.updateFields` = allowlist par champ (un champ absent est ignoré en silence).
- Gotcha backfill : un RDV passé ≠ entretien non fait (scope backfill = RDV À VENIR uniquement).

## Module Entretiens (Programmation · grands secteurs · certificats · géocodage) → `docs/MODULE_ENTRETIENS.md`
Règles qui mordent :
- Programmation regroupée en **grands secteurs** (clustering CP par proximité, `src/lib/sectorClustering.js` pur + testé ; nommage par la ville la + peuplée). Gotcha : l'icône `Map` de lucide **shadow** `new Map()` → aliaser `MapIcon`.
- Géocodage serveur auto : edge `geocode-sweep` (cron pg_cron 30 min) via endpoint **`/search/` unitaire** (PAS `/search/csv/`). `clients.geocode_attempts` = 3 max, reset au ré-adressage.
- Grand secteur figé sur `appointments.grand_secteur` à la création du RDV ; `getGrandSecteurMaps` attend l'org **CORE** (≠ org majordhome).
- Certificats = 1 par équipement (interventions enfants `parent_id`+`equipment_id`), vue Kanban filtrée `parent_id IS NULL`. Pièces : `refreshParts()` après CHAQUE mutation (les `idx` sont recalculés par la vue).
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


## Module Pennylane quote-driven (WIP) → `docs/MODULE_PENNYLANE.md`
Règles qui mordent :
- Post-attache, **PL fait foi** pour l'identité du lead (OVERWRITE ; contact lead en lecture seule).
- « Gagner un lead » = UNIQUEMENT `lead_mark_won_with_quote` (statut + won_date + chantier). Ne jamais dupliquer la logique de gain ailleurs.
- « Devis envoyé » / « Gagné » / « Perdu » manuels **interdits sans devis PL rattaché** sur orgs PL (trigger DB + gardes board/drawer/fiche). Perte directe (sans devis) reste OK.
- Liens devis = `q.public_file_url` / `pdf_url` — **jamais** construire `app.pennylane.com/quotes/{id}` (404 multi-cabinet).
- Rate limit V2 25 req/5s → `pLimit(5)`. Single GET = ressource au **root** (pas wrappée). LISTE `/quotes` n'embarque QUE `customer.id` (pas le nom → `resolveCustomerNames`).
- Seuil pipeline 1000€ HT. Tie-break chrono = `pennylane_quote_id DESC`.
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
