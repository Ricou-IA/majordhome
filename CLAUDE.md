# CLAUDE.md - Majord'home Module Artisan

> **Dernière MàJ** : 2026-03-15 — Refactoring architecture (cacheKeys, usePaginatedList, KanbanBoard, serviceHelpers)
> **Détails DB/composants/sprints** : `docs/DATABASE.md`, `docs/COMPONENTS.md`, `docs/SPRINT_LOG.md`

## Projet
Plateforme SaaS métier pour artisans du bâtiment (CVC). CRM, planning, pipeline commercial, outil terrain tablette, carte territoire. Pilote : **Mayer Énergie** (Gaillac, 81).

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
npm run dev      # Dev server (port 5173)
npm run build    # Build production
npm run lint     # ESLint
```

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
│   ├── routes.jsx              # Routes lazy-loaded (14 routes)
│   ├── pages/                  # Dashboard, Clients, ClientDetail (+ client-detail/Tab*.jsx), Pipeline, Planning, Chantiers, Entretiens, Territoire, InterventionDetail, Settings, Profile
│   └── components/
│       ├── FormFields.jsx      # Composants formulaire partagés (FormField, TextInput, etc.)
│       ├── shared/             # KanbanBoard, SearchBar, ColumnHeader, CardSkeleton (composants génériques)
│       ├── clients/            # ClientModal+Tabs (4 onglets: Info/Contrat/Équipements/Historique), ClientCard, EquipmentList, EquipmentFormModal
│       ├── chantiers/          # ChantierKanban, ChantierCard, ChantierModal, ChantierOrderSection, ChantierInterventionSection
│       ├── entretiens/         # CreateContractModal+Steps, ContractModal, ContractsList, EntretiensDashboard
│       ├── pipeline/           # LeadModal+FormSections+StatusConfig, LeadKanban, LeadList, SchedulingPanel
│       ├── planning/           # EventModal+FormSections+Confirmations, TechnicianSelect, MiniWeekCalendar
│       └── territoire/         # TerritoireMap, MapControls, MapPopup, MapSearch, useMapZones, useTerritoireData
├── apps/prospection/
│   ├── _shared/
│   │   ├── lib/               # sireneApi, scoringCedants, scoringCommercial
│   │   ├── hooks/             # useSireneSearch
│   │   └── components/        # SearchSireneModal, ProspectTable, ProspectKPIs, ProspectFilters, ProspectDrawer
│   ├── cedants/               # config, CedantsPipeline
│   └── commercial/            # config, CommercialPipeline
└── shared/
    ├── services/               # auth, clients, contracts, chantiers, entretiens, geocoding, territoire, prospects, storage
    └── hooks/                  # cacheKeys, usePaginatedList, useDebounce, useModalManager + useClients, useContracts, useChantiers, useLeads, useAppointments, useProspects, etc.
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

### Vues publiques principales
- `majordhome_clients` → clients + has_active_contract calculé
- `majordhome_contracts` → contracts JOIN clients (client_name, client_address, etc.)
- `majordhome_appointments` → appointments + client_first_name, assigned_commercial_id
- `majordhome_chantiers` → leads filtrés (chantier_status IS NOT NULL) + JOIN equipment_type + intervention parent
- `majordhome_prospects` → prospects JOIN profiles (created_by_name, assigned_to_name)
- `majordhome_prospect_interactions` → interactions JOIN profiles (created_by_name)
- `majordhome_equipments`, `majordhome_interventions`, `majordhome_maintenance_visits`
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
  - Re-exports depuis chaque hook pour rétrocompatibilité
- **`usePaginatedList`** : Hook générique pour listes paginées (utilisé par useClients, useProspects)
- **`useDebounce`** : Hook utilitaire de debounce (remplace les implémentations manuelles)
- **`useModalManager`** : Gestion centralisée d'état de modales multiples
- Retournent : `{ data, isLoading, error, refetch, ...mutations }`

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
  - `ColumnHeader` : En-tête colonne Kanban (pastille + label + count + montant)
  - `CardSkeleton` : Skeleton de carte pour états de chargement
- **Utilitaires partagés** : `src/lib/utils.js`
  - `formatDateForInput` (Date|string → YYYY-MM-DD, timezone-safe)
  - `formatDateFR` (→ "1 janvier 2026"), `formatDateShortFR` (→ "1 janv. 2026")
  - `formatDateTimeFR`, `formatPhoneNumber`, `formatEuro`
  - `computeEndTime`, `computeDuration`
- **Constantes** : `src/lib/constants.js` — `DEFAULT_PAGE_SIZE`, `LARGE_PAGE_SIZE`, `KANBAN_PAGE_SIZE`

## Plan de Développement
| Sprint | Titre | Statut |
|--------|-------|--------|
| 0-5b | Auth, CRM, Planning, Terrain, Pipeline, Entretiens, Territoire | ✅ FAIT |
| 6 | Chantiers (Kanban post-vente, commandes, planification) + Dashboard réel + Planning multi-select | ✅ FAIT |
| 7 | Droits & Accès (permissions granulaires par rôle) | ✅ FAIT |
| P | Prospection (Cédants + Commercial, Screener SIRENE, Pipeline, Drawer) | ✅ FAIT |
| 8 | Portail Client | ⬜ À FAIRE |
| 9 | Intégration Pennylane (devis/factures) | ⬜ À FAIRE |
| 10 | N8N Avancé (Facebook Ads, Slack bidirectionnel) | ⬜ À FAIRE |
