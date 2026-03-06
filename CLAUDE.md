# CLAUDE.md - Majord'home Module Artisan

> **Dernière MàJ** : 2026-03-06 — EventModal v2.1 (commercial assigné, overlay non-bloquant), SchedulingPanel v2.0 (type fixé, drag-to-resize), MiniWeekCalendar v2.0 (drag-to-resize)
> **Fichiers contexte détaillés** : voir `docs/DATABASE.md`, `docs/COMPONENTS.md`, `docs/SPRINT_LOG.md`

## Projet
Plateforme SaaS métier pour artisans du bâtiment (CVC prioritaire). CRM, planning, pipeline commercial, outil terrain tablette (interventions, attestations réglementaires) + portail client (futur). Premier client pilote : **Mayer Énergie** (Gaillac, 81).

## Vision Produit

### 3 profils utilisateurs
| Profil | Device | Usage |
|--------|--------|-------|
| **Dirigeant** (org_admin) | Desktop | Vision globale, pipeline KPIs, facturation |
| **Secrétaire/Commercial** (team_leader) | Desktop | Gestion clients, planning, prise RDV, suivi leads |
| **Technicien** (user) | **Tablette** | Fiche client terrain, saisie intervention, signature, attestation PDF |

### Intégrations existantes (N8N - 4 workflows actifs)
| Workflow | Webhook | Flux |
|----------|---------|------|
| **Contact Lead** | `/webhook/mayer-contact` | Site web → Slack `#commercial` + Email confirmation |
| **Urgence SAV** | `/webhook/mayer-urgence` | Site web → Slack `#interventions` + Email client |
| **Entretien Contrat** | `/webhook/mayer-entretien` | Site web → Slack + PDF contrat (Gotenberg) + Email |
| **Slack Interactions** | `/webhook/mayer-slack-interactions` | Bouton Slack "Planifier RDV" → Modal date/techniciens |

### Intégrations à connecter
- **Google Calendar** : sync planning bidirectionnelle
- **Pennylane** : sync + création devis/factures (API)
- **Facebook Ads / Fiche Google** : leads entrants → N8N → DB
- **N8N → Supabase** : écriture leads et RDV en DB

## Stack Technique
- **Framework** : React 18 + Vite 5 + React Router 6
- **Backend** : Supabase (PostgreSQL + Auth + Storage + Realtime)
- **Styling** : Tailwind CSS 3.4 + Radix UI (composants)
- **State** : React Context (auth), TanStack React Query v5 (données async)
- **Formulaires** : React Hook Form + Zod (validation)
- **Calendrier** : FullCalendar 6 (semaine/jour/mois, drag & drop)
- **Charts** : Recharts
- **Icons** : Lucide React
- **Notifications** : Sonner (toasts)
- **Automatisations** : N8N (webhooks, Slack, Gmail, Gotenberg PDF)

## Commandes
```bash
npm run dev      # Dev server (port 5173)
npm run build    # Build production
npm run preview  # Preview build
npm run lint     # ESLint
```

## Architecture Fichiers
```
src/
├── main.jsx                           # Point d'entrée (React + QueryClient + AuthProvider)
├── App.jsx                            # Routes principales
├── lib/supabaseClient.js              # Client Supabase
├── contexts/AuthContext.jsx            # Auth + org + rôles + permissions
├── pages/                             # Pages publiques (Login, Reset, etc.)
├── components/
│   ├── ProtectedRoute.jsx             # Routes protégées
│   └── ui/                            # Composants Radix UI (button, card, input, tabs, confirm-dialog...)
├── layouts/AppLayout.jsx              # Layout sidebar + header
├── hooks/pipeline/                    # Hooks pipeline (useDashboardData, useDashboardFilters)
├── apps/artisan/
│   ├── routes.jsx                     # Routes lazy-loaded du module (10 routes)
│   ├── pages/                         # Pages métier
│   │   ├── Dashboard.jsx              # Tableau de bord
│   │   ├── Clients.jsx                # Liste clients (5 stat cards cliquables, filtres URL, 4 cartes/ligne)
│   │   ├── ClientDetail.jsx           # Fiche client (5 onglets : info, contrat, équipements, interventions, timeline)
│   │   ├── Pipeline.jsx               # Dashboard pipeline commercial (3 onglets)
│   │   ├── Planning.jsx               # Calendrier FullCalendar
│   │   ├── Entretiens.jsx             # Entretiens & Contrats (3 onglets : Dashboard, Contrats, Secteurs)
│   │   ├── InterventionDetail.jsx     # Détail intervention
│   │   ├── Settings.jsx               # Paramètres org
│   │   └── Profile.jsx                # Profil utilisateur
│   └── components/
│       ├── clients/                   # ClientCard, ClientModal, EquipmentList, EquipmentFormModal
│       ├── entretiens/                # ContractCard, ContractModal, ContractsList, SectorGroupView, EntretiensDashboard, VisitBadge
│       ├── pipeline/                  # LeadModal, LeadKanban, LeadList, SchedulingPanel, dashboard/ (Cards, Filters, Charts)
│       └── planning/                  # EventModal (v2.1 + commercial assigné, overlay non-bloquant, priorité supprimée, type verrouillé edit), TechnicianSelect (partagé), MiniWeekCalendar (v2.0 drag-to-resize)
└── shared/
    ├── services/
    │   ├── auth.service.js            # Service auth Supabase
    │   ├── clients.service.js         # Service clients (v7.0 - CLIENT_CATEGORIES, onlyArchived filter)
    │   ├── contracts.service.js       # Service contrats CRUD (contracts + contract_equipments)
    │   └── entretiens.service.js      # Service page Entretiens (vue enrichie, stats, secteurs, visites)
    └── hooks/
        ├── useClients.js              # 7 hooks React Query (list, detail, equipments, activities, stats, search, pricingEquipmentTypes)
        └── useContracts.js            # Hooks contrats : useClientContract, useContractEquipments (fiche client) + useContracts, useContract, useContractStats, useContractSectors, useContractVisits, useContractMutations (page Entretiens)
```

## Aliases (vite.config.js)
```
@              → src/
@components    → src/components
@pages         → src/pages
@layouts       → src/layouts
@contexts      → src/contexts
@lib           → src/lib
@services      → src/shared/services
@hooks         → src/shared/hooks
@hooksPipeline → src/hooks/pipeline
@apps          → src/apps
```

## Base de Données (Supabase)

> Détail complet des tables et colonnes : voir `docs/DATABASE.md`

### Architecture multi-schéma
DB partagée entre plusieurs applications. Organisation cible : **"Mayer Energie"** (org_id: `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`).

### Schémas
- **`core`** : profiles, organizations, organization_members (auth multi-tenant)
- **`majordhome`** : tables métier (clients, equipments, interventions, leads, appointments, team_members, etc.)
- **`public`** : **vues** qui exposent les tables core/majordhome

### Pattern vues publiques
```
public.majordhome_clients           → majordhome.clients (+ has_active_contract calculé, client_number)
public.majordhome_client_activities → majordhome.client_activities
public.majordhome_equipments        → majordhome.equipments
public.majordhome_interventions     → majordhome.interventions
public.majordhome_contracts         → majordhome.contracts (enrichie : JOIN clients pour client_name, client_address, etc.)
public.majordhome_contract_equipments → majordhome.contract_equipments
public.majordhome_maintenance_visits → majordhome.maintenance_visits
public.majordhome_appointments      → majordhome.appointments (+ client_first_name, assigned_commercial_id)
public.projects                     → core.projects (legacy)
public.profiles                     → core.profiles
public.organizations                → core.organizations
```

Le frontend utilise `supabase.from('majordhome_clients')` (vue publique) pour les clients, `.schema('majordhome').from('leads')` pour les tables sans vue.

### Tables principales (schéma majordhome)

| Table | Rows | Rôle | Accès frontend |
|-------|------|------|----------------|
| `clients` | 3301 | **Clients CRM** (colonnes typées, siren) — import Excel 2026-02-23 | vue `majordhome_clients` |
| `client_activities` | 0 | **Timeline** activités client | vue `majordhome_client_activities` |
| `equipments` | 709 | Parc équipements CVC (equipment_type_id FK → pricing_equipment_types) | vue `majordhome_equipments` |
| `pricing_equipment_types` | 12 | Types d'équipements tarifaires (label, category, slug) | vue `majordhome_pricing_equipment_types` |
| `equipment_brands` | 7+ | Marques d'équipements (name, slug, display_order) | `.schema('majordhome')` |
| `interventions` | 0 | Historique interventions (purgé, à recréer) | vue `majordhome_interventions` |
| `appointments` | 0 | Planning RDV (53 colonnes, lead_id FK, client_id FK, client_first_name, assigned_commercial_id, Google Cal sync) | vue `majordhome_appointments` |
| `team_members` | 1 | Techniciens (spécialités, disponibilité, couleur) | `.schema('majordhome')` |
| `leads` | 27 | Pipeline CRM (30+ cols, org_id, client_id FK → clients, appointment_id FK → appointments) | `.schema('majordhome')` |
| `sources` | 8 | Sources de leads | `.schema('majordhome')` |
| `statuses` | 8 | Statuts pipeline | `.schema('majordhome')` |
| `contracts` | 666 | **Contrats d'entretien** (403 actifs, 263 expirés) — import Excel | vue enrichie `majordhome_contracts` (avec JOIN client) |
| `contract_equipments` | 0 | Pivot contrats ↔ équipements | vue `majordhome_contract_equipments` |
| `maintenance_visits` | 0 | Visites de maintenance annuelles (FK uuid → contracts) | vue `majordhome_maintenance_visits` |
| `service_requests` | 0 | Tickets SAV | `.schema('majordhome')` |

### Architecture client : lien dual
```
majordhome.clients (table dédiée, colonnes typées, client_number auto CLI-XXXXX)
  ├── project_id → core.projects (FK 1:1, préserve les FK legacy)
  ├── org_id → core.organizations
  ├── client_activities.client_id → clients.id
  └── contracts.client_id → clients.id (UNIQUE, max 1 contrat par client)
      └── contract_equipments.contract_id → contracts.id (N équipements)

core.projects (legacy, conservé pour compatibilité FK)
  ├── equipments.project_id
  ├── interventions.project_id
  ├── leads.project_id
  ├── home_details.project_id
  └── dpe_data.project_id
```

### ENUMs (schéma majordhome)

| ENUM | Valeurs |
|------|---------|
| `client_category` | particulier, entreprise |
| `housing_type` | maison, appartement, local_commercial, immeuble, autre |
| `contract_status` | active, pending, expired, cancelled |
| `contract_frequency` | mensuel, trimestriel, semestriel, annuel, biannuel |
| `activity_type` | note, comment, phone_call, email_sent/received, document_added, client_created/updated, status_changed, appointment_created/completed, intervention_scheduled/completed, equipment_added/updated, contract_created/renewed, invoice_created, quote_created, lead_converted |
| `equipment_category` | pac_air_air, pac_air_eau, chaudiere_gaz/fioul/bois, vmc, climatisation, chauffe_eau_thermo, ballon_ecs, poele, autre |
| `equipment_status` | active, maintenance_due, under_repair, decommissioned |
| `intervention_type` | maintenance, repair, installation, diagnostic, urgent |
| `intervention_status` | scheduled, in_progress, completed, cancelled, no_show |

## Rôles & Permissions

### Rôles applicatifs (AuthContext)
| Rôle | Device | Permissions |
|------|--------|-------------|
| `org_admin` (Dirigeant) | Desktop | Tout gérer, inviter, facturation |
| `team_leader` (Secrétaire/Commercial) | Desktop | Créer clients, planning, assignation |
| `user` (Technicien) | **Tablette** | Voir projets, remplir rapports, MAJ équipements |

### Permissions dérivées (AuthContext)
```jsx
const { isOrgAdmin, isTeamLeader, isTeamLeaderOrAbove, canAccessPipeline } = useAuth();
// canAccessPipeline = isOrgAdmin OU business_role === 'Commercial'
```

### RLS Supabase (pattern clients)
```sql
-- SELECT/UPDATE/DELETE : utilisateur membre de l'org du client
EXISTS (SELECT 1 FROM core.organization_members om WHERE om.org_id = clients.org_id AND om.user_id = auth.uid())
-- INSERT : org_id doit matcher un membership
```

## Conventions de Code

### Services (src/shared/services/)
- Pattern : `export const xxxService = { async method() {...} }`
- Retour : `{ data, error }` ou `{ data, count, error }`
- Logs avec préfixe : `[serviceName] methodName`

### Hooks (src/shared/hooks/)
- TanStack React Query (`useQuery`, `useMutation`, `useQueryClient`)
- Cache keys via factory : `clientKeys.list(orgId, filters)`, `clientKeys.detail(id)`
- Retournent : `{ data, isLoading, error, refetch, ...mutations }`

### Composants
- Fichiers .jsx, PascalCase
- Tailwind pour le styling (pas de CSS modules)
- Toasts via Sonner : `toast.success()`, `toast.error()`

### Routes
- Lazy loading : `React.lazy()` + `Suspense`
- Routes artisan dans `src/apps/artisan/routes.jsx`
- Protection par `ProtectedRoute` (auth + org)

## Plan de Développement

| Sprint | Titre | Statut |
|--------|-------|--------|
| 0 | Init, Auth, Layout, Routes | ✅ FAIT |
| 1 | CRM Artisan (table clients, fiche client, timeline) | ✅ FAIT |
| 2 | Planning & Événements (FullCalendar, appointments) | ✅ FAIT |
| 3 | Outil Terrain Tablette (intervention, signature, PDF) | ✅ FAIT |
| 4 | Pipeline Commercial (leads CRUD, kanban, fix dashboard) | ✅ FAIT |
| 5 | Entretiens & Contrats (groupés par CP, alertes) | ✅ FAIT |
| 6 | Portail Client (auth client, dashboard, factures) | ⬜ À FAIRE |
| 7 | Intégration Pennylane (devis/factures API) | ⬜ À FAIRE |
| 8 | N8N Avancé (Facebook Ads, Slack bidirectionnel) | ⬜ À FAIRE |

> Historique détaillé de chaque sprint : voir `docs/SPRINT_LOG.md`

## Données Existantes
- 3 301 clients (`majordhome.clients` — import Excel "Base Client NEW.xlsx", client_number CLI-XXXXX, colonne siren)
- 709 équipements (`majordhome.equipments` — stubs import Excel, catégories parsées depuis Type Contrat)
- 0 interventions (`majordhome.interventions` — purgées, à recréer)
- 666 contrats (`majordhome.contracts` — 403 actifs, 263 expirés, import Excel, contract_number CTR-XXXXX)
- 27 leads (`majordhome.leads` — 11 liés à un client via client_id, 16 non liés)
- 0 visites de maintenance (`majordhome.maintenance_visits` — purgées, FK uuid → contracts)

## Ressources
- N8N : `https://n8n.srv1102213.hstgr.cloud/`
- Site Mayer : `https://www.mayer-energie.fr`
- FullCalendar React : https://fullcalendar.io/docs/react
- API ADEME DPE : déjà intégrée
