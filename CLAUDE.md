# CLAUDE.md - Majord'home Module Artisan

> **Dernière MàJ** : 2026-04-04 — Mailing : configurateur campagnes + table mailing_logs + onglet Mailings fiche client
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
│   ├── routes.jsx              # Routes lazy-loaded (15 routes)
│   ├── pages/                  # Dashboard, Clients, ClientDetail (+ client-detail/Tab*.jsx), Pipeline, Planning, Chantiers, Entretiens, Territoire, InterventionDetail, Settings, Profile, Mailing
│   └── components/
│       ├── FormFields.jsx      # Composants formulaire partagés (FormField, TextInput, etc.)
│       ├── shared/             # KanbanBoard, SearchBar, ColumnHeader, CardSkeleton (composants génériques)
│       ├── clients/            # ClientModal+Tabs (4 onglets: Info/Contrat/Équipements/Historique), ClientCard, EquipmentList, EquipmentFormModal
│       # Note : ClientDetail a 6 onglets : Info/Contrat/Équipements/Interventions/Timeline/Mailings
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
- `majordhome_mailing_logs` → historique des emails envoyés par campagne (client_id, campaign_name, subject, email_to, sent_at, status)
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
  - Familles : clientKeys, contractKeys, leadKeys, appointmentKeys, interventionKeys, chantierKeys, prospectKeys, pricingKeys, mailingKeys
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

## Module Mailing

### Architecture
- **Page** : `src/apps/artisan/pages/Mailing.jsx` — Configurateur de campagnes (admin only, `RouteGuard resource="settings"`)
- **Onglet client** : `src/apps/artisan/pages/client-detail/TabMailings.jsx` — Historique des mails envoyés à un client
- **Table** : `majordhome.mailing_logs` (client_id, lead_id, org_id, campaign_name, subject, email_to, sent_at, status)
- **Vue** : `public.majordhome_mailing_logs`
- **Cache keys** : `mailingKeys.byClient(clientId)`, `mailingKeys.byLead(leadId)`
- **Env** : `VITE_N8N_WEBHOOK_MAILING` → webhook N8n `POST /webhook/mayer-mailing`

### Workflow N8n : "Mayer - Mailing" (id: 1COgLUuiMtSq2sUq)
Moteur d'emailing générique piloté par webhook POST. Payload attendu :
```json
{
  "subject": "Objet du mail",
  "html_body": "<html>...{{SALUTATION}}...</html>",
  "segment_sql": "SELECT id, first_name, last_name, display_name, email FROM ...",
  "campaign_name": "Nom de la campagne",
  "org_id": "uuid",
  "recipient_type": "client|lead",
  "batch_size": 400,
  "test_email": "optionnel@test.fr"
}
```
- Le placeholder `{{SALUTATION}}` est remplacé par "Bonjour Prénom Nom," automatiquement
- En mode test (`test_email` rempli) : LIMIT 1 sur le SQL, envoi redirigé vers l'email de test
- `recipient_type` : `client` (défaut) ou `lead` — détermine si l'INSERT va dans `client_id` ou `lead_id`
- Noeud 7 fait un INSERT dans `majordhome.mailing_logs` après chaque envoi

### Templates campagnes (7)
| Template | Cible | Objet |
|----------|-------|-------|
| `mail_a` | Clients contrat actif | Information — Mayer Energie reprend le suivi |
| `mail_b` | Clients sans contrat | Offre Exclusive — reprise Econhome |
| `mail_c` | Clients contrat clos | Reconquête Info — ancien contrat |
| `mail_d` | Clients contrat clos | Offre Reconquête — retour client |
| `mail_e` | Leads Contacté | Relance Contacté — rappel à bon souvenir |
| `mail_f` | Leads Devis envoyé | Relance Devis — suivi devis + aides + prix |
| `mail_g` | Leads Perdu | Remerciement — ressources site web |

### Segments de ciblage pré-chargés
| Segment | Description | Exclusion |
|---------|-------------|-----------|
| `clients_contrat` | Clients avec contrat actif | déjà mailé (tout mailing_logs) |
| `clients_contrat_clos` | Clients contrat clos, sans contrat actif | déjà mailé |
| `clients_sans_contrat` | Clients sans aucun contrat (jamais eu) | déjà mailé |
| `clients_tous` | Tous les clients | déjà mailé |
| `leads_contacte` | Leads au statut "Contacté" | déjà mailé campagne Contacté |
| `leads_devis` | Leads au statut "Devis envoyé" | déjà mailé campagne Devis |
| `leads_perdu` | Leads au statut "Perdu" | déjà mailé campagne Perdu |

### Tags mailing dans fiche lead
- Statut **Contacté** (display_order 2) : tag indigo "Mailing Relance" si campagne Contacté envoyée
- Statut **Devis envoyé** (display_order 4) : tag ambre "Mailing Relance Devis" si campagne Devis envoyée
- Tags en lecture seule, chargés depuis `mailing_logs` via `lead_id`
- La checkbox "Mail envoyé" reste manuelle (usage commercial)

### Compteur destinataires
Utilise la RPC `public.exec_sql(query_text)` pour exécuter un COUNT(*) sur le segment SQL sélectionné. Le résultat s'affiche en badge à côté du sélecteur de ciblage. Le toast et la confirmation utilisent le nombre réel de destinataires.

### Évolutions prévues
- Migration Gmail → Resend (tracking ouverture/clic/bounce natif)
- Tracking avancé (pixel ouverture, redirect clic CTA)
- Gestion erreurs/bounces dans mailing_logs (status: bounced, failed)
- Skip tracking en mode test dans N8n

## Module Certificats d'entretien (multi-équipements)

### Architecture
- **1 certificat par équipement** : interventions enfants (`parent_id` + `equipment_id`)
- **Parent** = carte Kanban (1 par contrat/client), **enfants** = 1 par équipement du contrat
- **Vue `majordhome_entretien_sav`** filtrée `parent_id IS NULL` (enfants exclus du Kanban et des stats)
- **Lazy create** : les enfants sont créés à la première ouverture de la modale si absents

### Composants
| Fichier | Rôle |
|---------|------|
| `CertificatEquipmentRow.jsx` | Ligne équipement : statut (À faire/Rempli/Néant) + CTA Remplir/Voir/Néant |
| `CertificatsEntretienModal.jsx` | Modale standalone (non utilisée, section intégrée dans EntretienSAVModal) |
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

## Plan de Développement
| Sprint | Titre | Statut |
|--------|-------|--------|
| 0-5b | Auth, CRM, Planning, Terrain, Pipeline, Entretiens, Territoire | ✅ FAIT |
| 6 | Chantiers (Kanban post-vente, commandes, planification) + Dashboard réel + Planning multi-select | ✅ FAIT |
| 7 | Droits & Accès (permissions granulaires par rôle) | ✅ FAIT |
| P | Prospection (Cédants + Commercial, Screener SIRENE, Pipeline, Drawer) | ✅ FAIT |
| M | Mailing (Configurateur campagnes, mailing_logs, onglet Mailings fiche client) | ✅ FAIT |
| 8 | Portail Client | ⬜ À FAIRE |
| 9 | Intégration Pennylane (devis/factures) | ⬜ À FAIRE |
| 10 | N8N Avancé (Facebook Ads, Slack bidirectionnel) | ⬜ À FAIRE |
