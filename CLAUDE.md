# CLAUDE.md - Majord'home Module Artisan

> **Dernière MàJ** : 2026-03-07
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
├── lib/                        # supabaseClient, mapbox, territoire-config
├── contexts/AuthContext.jsx     # Auth + org + rôles
├── pages/                      # Pages publiques (Login, Reset)
├── components/
│   ├── ProtectedRoute.jsx
│   └── ui/                     # Radix UI (button, card, input, tabs, confirm-dialog...)
├── layouts/AppLayout.jsx       # Sidebar + header
├── hooks/pipeline/             # useDashboardData, useDashboardFilters
├── apps/artisan/
│   ├── routes.jsx              # Routes lazy-loaded (11 routes)
│   ├── pages/                  # Dashboard, Clients, ClientDetail, Pipeline, Planning, Entretiens, Territoire, InterventionDetail, Settings, Profile
│   └── components/
│       ├── clients/            # ClientCard, ClientModal, EquipmentList, EquipmentFormModal
│       ├── entretiens/         # ContractCard, ContractModal, ContractsList, SectorGroupView, EntretiensDashboard, VisitBadge
│       ├── pipeline/           # LeadModal, LeadKanban, LeadList, SchedulingPanel, dashboard/
│       ├── planning/           # EventModal, TechnicianSelect, MiniWeekCalendar
│       └── territoire/         # TerritoireMap, MapControls, MapPopup, useMapZones, useTerritoireData
└── shared/
    ├── services/               # auth, clients, contracts, entretiens, geocoding, territoire
    └── hooks/                  # useClients, useContracts, useLeads, useAppointments, etc.
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

### Hooks (`src/shared/hooks/`)
- TanStack React Query v5
- Cache keys via factory : `clientKeys.list(orgId, filters)`
- Retournent : `{ data, isLoading, error, refetch, ...mutations }`

### Composants
- Fichiers .jsx, PascalCase
- Tailwind (pas de CSS modules)
- Toasts : `toast.success()`, `toast.error()`
- Routes lazy-loaded dans `src/apps/artisan/routes.jsx`

## Plan de Développement
| Sprint | Titre | Statut |
|--------|-------|--------|
| 0-5b | Auth, CRM, Planning, Terrain, Pipeline, Entretiens, Territoire | ✅ FAIT |
| 6 | Portail Client | ⬜ À FAIRE |
| 7 | Intégration Pennylane (devis/factures) | ⬜ À FAIRE |
| 8 | N8N Avancé (Facebook Ads, Slack bidirectionnel) | ⬜ À FAIRE |
