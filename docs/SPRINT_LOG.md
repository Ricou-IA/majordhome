# SPRINT_LOG.md - Historique des sprints Majord'home

> **Dernière MàJ** : 2026-04-19 — Mailing : campagnes paramétrables (table mail_campaigns + onglet Éditeur wizard 3 étapes + caisse à outils URLs Mayer)

---

## Sprint 0 — Init, Auth, Layout ✅
**Date** : Avant février 2026

### Réalisé
- Setup React 18 + Vite 5 + Tailwind + Radix UI
- Supabase Auth (login, signup, Google SSO, reset password)
- AuthContext avec profils multi-rôle (org_admin, team_leader, user)
- Layout principal (sidebar + header)
- ProtectedRoute (auth + org)
- Routes lazy-loaded (`routes.jsx`)
- Pages placeholder (Dashboard, Planning, Clients, Pipeline, Entretiens)
- Pipeline Dashboard (charts, filtres, stats) — fonctionnel avec données leads

### Refacto
- Fix `.schema('core')` sur requêtes organization_members
- Nettoyage console.logs debug
- Simplification routes (suppression pages orphelines)

---

## Sprint 1 — CRM Artisan ✅
**Date** : 2026-02-20
**Objectif** : Table clients dédiée avec colonnes typées, fiche client complète, timeline activités

### Phase 1 — Base de données (4 migrations Supabase)

#### Migration 1 : `create_clients_table`
- 3 ENUMs créés : `client_type`, `housing_type`, `contract_frequency`
- Table `majordhome.clients` : 36 colonnes typées
- 9 index dont GIN full-text search (`to_tsvector('french', display_name || email || phone || city)`)
- Trigger `updated_at` automatique
- 4 RLS policies (SELECT/INSERT/UPDATE/DELETE via `core.organization_members`)
- ⚠️ Première tentative échouée : colonnes `organization_id`/`profile_id` n'existent pas → fix avec `org_id`/`user_id`

#### Migration 2 : `create_client_activities_table`
- ENUM `activity_type` (20 valeurs)
- Table timeline avec reference_type/reference_id (polymorphique)
- 5 index, 3 RLS policies

#### Migration 3 : `migrate_clients_from_projects`
- INSERT INTO depuis `core.projects` avec mapping CASE pour les enums
- 3393 clients migrés, types preservés (prospect: 2495, contrat_actif: 789, client_equipement: 109)
- 3393 activités `client_created` générées

#### Migration 4 : `create_clients_public_view`
- `public.majordhome_clients` + `public.majordhome_client_activities`
- GRANT SELECT/INSERT/UPDATE/DELETE aux rôles Supabase

### Phase 2 — Frontend (7 fichiers)

#### `clients.service.js` → v5.0.0 (RÉÉCRIT)
- Supprimé : `flattenClient()`, `CLIENT_STATUSES`
- Ajouté : `HOUSING_TYPES`, `getClientByProjectId()`, `getClientActivities()`, `addClientNote()`
- Toutes les requêtes sur `majordhome_clients` (vue publique)
- `createClient` : dual write (core.projects + majordhome.clients)
- `updateClient` : sync retour vers `core.projects.identity` (compatibilité)

#### `useClients.js` → v5.0.0 (RÉÉCRIT)
- TanStack React Query v5
- `clientKeys` factory pour cache keys
- 6 hooks : `useClients`, `useClient`, `useClientEquipments`, `useClientActivities`, `useClientStats`, `useClientSearch`
- `isLoading` remplace `loading`

#### `main.jsx` — Ajout QueryClientProvider
```jsx
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } }
});
// Wrapping: QueryClientProvider > AuthProvider > App
```

#### `ClientDetail.jsx` — NOUVEAU (~600 lignes)
- Route : `/artisan/clients/:id`
- 4 onglets : Informations, Équipements, Interventions, Timeline
- Système lock/unlock pour l'édition
- Formulaire complet (identité, contact, adresse, logement, contrat, notes)
- Timeline : liste activités + formulaire ajout note
- Hooks : `useClient`, `useClientEquipments`, `useClientActivities`

#### `Clients.jsx` → v3.0.0
- Navigation `useNavigate` vers `/artisan/clients/:id` au clic
- Suppression du modal `ClientModal` de la liste
- Filtres par type client (`CLIENT_TYPES`), stats adaptées

#### `ClientModal.jsx` — Adapté
- `CLIENT_TYPES` remplace `CLIENT_STATUSES`
- `HOUSING_TYPES` importé depuis service
- Champs mis à jour : `display_name`, `has_contract`, `client_type`

#### `ClientCard.jsx` — Compatibilité dual
- Accepte ancien (`has_contrat`, `name`) et nouveau (`has_contract`, `display_name`)

#### `routes.jsx` — Ajout route
- `clients/:id` → `ClientDetail` (lazy-loaded)

### Vérifications
- ✅ Build production : 0 erreur, 5.08s
- ✅ RLS advisories : aucun problème sur les nouvelles tables
- ✅ Migration : 3393/3393 clients migrés avec types corrects

---

## Sprint 2 — Planning & Événements ✅
**Date** : 2026-02-20
**Objectif** : FullCalendar interactif, gestion RDV, assignation techniciens

### Phase 1 — Base de données (1 migration Supabase)

#### Migration : `planning_rls_and_org_mapping`
- Ajout colonne `core_org_id` dans `majordhome.organizations` (bridge vers core.organizations)
- Fonction SQL `majordhome.get_majordhome_org_id(uuid)` pour résoudre le mapping
- 4 RLS policies sur `majordhome.appointments` (SELECT/INSERT/UPDATE/DELETE via cross-schema join)
- 3 RLS policies sur `majordhome.team_members` (SELECT pour members, INSERT/UPDATE pour admins)
- 3 RLS policies sur `majordhome.appointment_technicians` (via join appointments)
- 3 vues publiques : `majordhome_appointments`, `majordhome_team_members`, `majordhome_appointment_technicians`
- ⚠️ Problème résolu : dual org_id (`core.organizations.id` ≠ `majordhome.organizations.id`) — bridgé via `core_org_id`

### Phase 2 — Frontend (4 fichiers)

#### `appointments.service.js` — NOUVEAU (~445 lignes)
- Constantes exportées : `APPOINTMENT_TYPES` (7 types avec couleurs), `APPOINTMENT_STATUSES` (6), `PRIORITIES` (4)
- `getMajordhomeOrgId(coreOrgId)` : cache en mémoire pour le mapping org_id
- CRUD complet : `getAppointments`, `getAppointmentById`, `createAppointment`, `updateAppointment`, `moveAppointment`, `cancelAppointment`, `deleteAppointment`
- Gestion techniciens : `getTeamMembers`, `getAppointmentTechnicians`
- Filtrage technicien côté client via table pivot `appointment_technicians`
- Helpers FullCalendar : `toCalendarEvent(appointment)`, `fromCalendarEvent(event)`

#### `useAppointments.js` — NOUVEAU (~290 lignes)
- `appointmentKeys` factory pour cache React Query
- `useAppointments({ orgId, startDate, endDate })` : events, filtres (technicianId, appointmentType, status), 5 mutations CRUD
- Optimistic update pour drag & drop (onMutate + rollback onError)
- `useAppointment(appointmentId)` : détail avec staleTime 30s
- `useTeamMembers(orgId)` : liste techniciens avec staleTime 60s

#### `Planning.jsx` → v2.0.0 (RÉÉCRIT, ~615 lignes)
- FullCalendar 6 : timeGridWeek (défaut), timeGridDay, dayGridMonth
- Toolbar custom : navigation, sélecteur vue, bouton ajouter
- Filtres : dropdown technicien (avec couleur calendrier), dropdown type RDV
- Événements : rendu custom (`renderEventContent`), couleurs par type
- Interactions : drag & drop, resize, select-to-create, clic-to-edit
- Config : locale fr, firstDay=1, 07h-20h, slots 30min, nowIndicator
- Intégration EventModal (create/edit/delete/cancel)

#### `EventModal.jsx` — NOUVEAU (~530 lignes)
- Panel latéral droit (slide-over pattern, max-w-lg)
- Mode création : defaultDate + defaultTime depuis sélection calendrier
- Mode édition : pré-remplissage depuis appointment existant
- Sections formulaire : Type & Priorité, Date & Heure, Client, Techniciens, Notes
- Auto-calcul heure fin quand on change début/durée (et inversement)
- Sélecteur multi-techniciens avec checkboxes et couleurs calendrier
- Confirmation annulation (avec motif) et suppression (avec warning)
- Champs disabled quand RDV annulé
- Validation : date, heure début, nom client obligatoires

### Vérifications
- ✅ Build production : 0 erreur, 5.49s
- ✅ RLS advisories : aucune alerte sur appointments/team_members/appointment_technicians
- ✅ Org mapping : Mayer Énergie core_org_id correctement lié

---

## Sprint 3 — Outil Terrain Tablette ✅
**Date** : 2026-02-20
**Objectif** : Fiche intervention terrain tablette, photos, signature, génération PDF N8N, envoi email

### Phase 1 — Base de données (1 migration Supabase)

#### Migration : `create_interventions_storage_bucket`
- Bucket Storage `interventions` (privé, 10MB max, image/* + application/pdf)
- 4 RLS policies (INSERT/SELECT/UPDATE/DELETE) via cross-schema join
- Chemin : `storage.objects → core.projects → core.organization_members`
- Convention path : `{project_id}/{intervention_id}/{type}_{timestamp}.{ext}`

### Phase 2 — Frontend (9 fichiers)

#### `interventions.service.js` — NOUVEAU (~350 lignes)
- Constantes exportées : `INTERVENTION_TYPES` (6 types avec couleurs/icônes), `INTERVENTION_STATUSES` (5), `FILE_TYPES` (5)
- Helpers : `getInterventionTypeConfig(type)`, `getInterventionStatusConfig(status)`
- CRUD : `getInterventionById` (+ client + equipment en parallèle), `getInterventionsByProject`, `updateIntervention`, `updateInterventionStatus`
- Storage : `uploadFile(projectId, interventionId, file, fileType)`, `getFileUrl(path)`, `getInterventionFileUrls(intervention)`, `deleteFile(path)`
- N8N webhooks : `triggerPdfGeneration(interventionId)`, `triggerSignedReport(interventionId)`
- Helper : `getEquipmentById(equipmentId)`

#### `useInterventions.js` — NOUVEAU (~250 lignes)
- `interventionKeys` factory pour cache React Query
- `useIntervention(id)` → { intervention, client, equipment, isLoading, error, refresh }
- `useInterventionFileUrls(intervention)` → { photoBeforeUrl, photoAfterUrl, photosExtraUrls, signatureUrl, refreshUrls }
- `useInterventionMutations(id)` → { updateIntervention, updateStatus, uploadFile, deleteFile, triggerPdf, triggerSignedReport, isUpdating, isUploading... }
- `useInterventionDraft(id)` → auto-save localStorage 30s, { loadDraft, saveDraft, clearDraft, startAutoSave, stopAutoSave }

#### `InterventionHeader.jsx` — NOUVEAU (~130 lignes)
- Résumé lecture seule : client, équipement, type, date, status badge
- Bouton "Commencer l'intervention" (scheduled) / "Terminer" (in_progress)
- Lien téléphone client cliquable, instructions d'accès

#### `PhotoCapture.jsx` — NOUVEAU (~150 lignes)
- Input caméra tablette (`capture="environment"`)
- Preview locale immédiate + upload Storage + delete
- Overlay plein écran pour consultation
- Touch-friendly (min 44px targets)

#### `SignaturePad.jsx` — NOUVEAU (~130 lignes)
- Wrapper react-signature-canvas (déjà installé)
- Export PNG → Blob → upload Storage
- Champ nom signataire obligatoire
- État confirmé avec affichage signature + bouton refaire

#### `PartsReplacedList.jsx` — NOUVEAU (~100 lignes)
- Liste dynamique pièces (nom, référence, quantité)
- Add/remove rows, compatible formulaire
- Touch targets tablette

#### `PdfViewer.jsx` — NOUVEAU (~50 lignes)
- iframe PDF depuis URL Storage signée
- États : loading (spinner), erreur, vide, PDF disponible
- Bouton télécharger, fallback si iframe non supporté

#### `InterventionDetail.jsx` → v1.0.0 (RÉÉCRIT, ~500 lignes)
- Route : `/artisan/intervention/:id`
- 4 onglets : Résumé, Rapport, Photos, Signature & Envoi
- Onglets 2-4 verrouillés tant que status ≠ `in_progress`
- Rapport : travaux effectués, notes, durée, facturable, pièces remplacées
- Photos : avant, après, supplémentaires (multi-upload)
- Signature : pad → PDF viewer → envoi N8N
- Auto-save brouillon localStorage 30s
- UX tablette : touch targets 44px, font-size 16px

#### `.env` — Variables N8N ajoutées
- `VITE_N8N_WEBHOOK_PDF` : webhook génération PDF
- `VITE_N8N_WEBHOOK_SIGNED` : webhook envoi rapport signé

### Vérifications
- ✅ Build production : 0 erreur, 6.74s
- ✅ RLS advisories : aucune alerte
- ✅ Chunk InterventionDetail : 63KB (18.8KB gzip)

## Sprint 4 — Pipeline Commercial ✅
**Date** : 2026-02-22
**Objectif** : CRUD leads, kanban drag & drop, restructuration Pipeline 3 onglets, fix dashboard

### Phase 1 — Base de données (1 migration Supabase)

#### Migration : `add_org_id_to_leads_and_fix_rls`
- Ajout `org_id uuid NOT NULL REFERENCES core.organizations(id)` sur `majordhome.leads`
- Ajout `org_id` sur `majordhome.lead_activities`
- Backfill existing row (Mayer Énergie `3c68193e-...`)
- 7 index créés : `idx_leads_org_id`, `idx_leads_status_id`, `idx_leads_source_id`, `idx_leads_assigned_user_id`, `idx_leads_created_date`, `idx_lead_activities_lead_id`, `idx_lead_activities_org_id`
- Drop 4 anciennes policies permissives → 4 org-scoped RLS sur leads, 2 sur lead_activities

### Phase 2 — Dépendance

#### `@hello-pangea/dnd` — npm install
- Fork maintenu de react-beautiful-dnd pour le kanban drag & drop

### Phase 3 — Frontend (8 fichiers créés, 2 modifiés)

#### `leads.service.js` — NOUVEAU (~420 lignes)
- Constantes : `LEAD_ACTIVITY_TYPES` (8 types), `ACTIVITY_LABELS`, `ACTIVITY_CONFIG` (icônes/couleurs)
- Référence : `getSources()`, `getStatuses()`, `getCommercials()`
- CRUD : `getLeads({ orgId, filters, limit, offset })` avec joins statuses+sources, `getLeadById`, `createLead`, `updateLead`, `softDeleteLead`
- Statut : `updateLeadStatus(leadId, newStatusId, userId, extra)` — crée lead_activity old→new
- Activities : `getLeadActivities`, `addLeadNote`
- Assignation : `assignLead`
- Conversion : `convertLeadToClient` — crée client via majordhome_clients + met à jour lead
- Helper interne : `_createActivity()`
- Accès : `.schema('majordhome').from('leads')` (pas de vue publique)

#### `useLeads.js` — NOUVEAU (~300 lignes)
- `leadKeys` factory pour cache (all, lists, list, detail, activities, sources, statuses, commercials)
- `useLeads({ orgId, limit })` : pagination, filtres internes (search, statusId, sourceId, assignedUserId, orderBy), loadMore, hasMore
- `useLead(leadId)` : détail
- `useLeadActivities(leadId)` : timeline
- `useLeadSources()` / `useLeadStatuses()` : staleTime 5min
- `useLeadCommercials()` : pour dropdown assignation
- `useLeadMutations()` : 7 mutations + isPending states

#### `LeadCard.jsx` — NOUVEAU (~200 lignes)
- Mode normal (liste) : nom, statut badge coloré, source badge, montant EUR, téléphone, prochaine action + date, jours dans statut, indicateur assigné
- Mode compact (kanban) : nom, montant, source, jours, next action truncated
- Export `LeadCardSkeleton`

#### `LeadActivityTimeline.jsx` — NOUVEAU (~200 lignes)
- Timeline verticale avec icônes colorées par type d'activité
- ICON_MAP : map noms string → composants Lucide
- Status change : badges old→new avec couleurs
- Formulaire ajout note (textarea expandable)
- Date française

#### `LeadsList.jsx` — NOUVEAU (~330 lignes)
- Header avec compteur + bouton "Nouveau lead"
- SearchBar avec debounce 300ms
- FilterDropdown dynamiques : statut (avec pastille couleur), source, assigné, tri
- ActiveFilterBadge avec clear
- Grille responsive (1/2/3 colonnes) de LeadCard
- Pagination "Charger plus" + indicateur fin
- États : loading (skeleton), erreur, vide

#### `LeadModal.jsx` — NOUVEAU (~500 lignes)
- Slide-over droite (max-w-lg, animated)
- Mode création / édition
- Sections : Contact (nom, tel, email, adresse), Pipeline (source, statut, assigné, probabilité, montants), Action suivante, Notes
- Changement statut instantané (via mutation séparée)
- Actions lead : Convertir en client (si gagné), Supprimer (avec confirmation)
- Timeline intégrée (LeadActivityTimeline)
- Raison de perte si statut final non-gagné
- Phone formatting auto

#### `LeadKanban.jsx` — NOUVEAU (~240 lignes)
- DragDropContext → Droppable (par status_id) → Draggable (par lead.id)
- KanbanColumn : header (label, couleur, count, montant total), zone droppable scrollable
- Optimistic update : déplace localement avant réponse API
- Rollback automatique en cas d'erreur
- Scroll horizontal pour 8 colonnes
- Charger tous les leads (limit 500)

#### `Pipeline.jsx` → v2.0.0 (RÉÉCRIT, ~180 lignes)
- 3 onglets Radix Tabs : Dashboard, Leads, Kanban
- Icônes onglets : BarChart3, List, Columns3
- LeadModal partagée entre les 3 onglets
- Dashboard : conserve tout l'existant (DashboardFilters, Cards, Funnel, Charts, Table)
- État modale : selectedLeadId + modalOpen, handlers communs
- Suppression console.log debug

#### `useDashboardData.js` — FIX CRITIQUE
- **Bug corrigé** : labels statuts hardcodés `'Rendez-vous'` et `'Vendu'` ne matchaient pas les vrais labels DB (`'RDV planifié'`, `'Gagné'`)
- Requêtes : ajout `display_order, is_final, is_won` dans les SELECT statuses
- `appointments` : `l.statuses?.display_order >= 3` (RDV planifié et au-delà)
- `sales` : `l.statuses?.is_won === true` (Gagné)
- `revenue` : idem is_won
- Appliqué aux 3 contextes : stats globales, sourceMetrics, monthlyTrends

### Vérifications
- ✅ Build production : 0 erreur, 7.41s
- ✅ Chunk Pipeline : 697KB (199KB gzip) — inclut @hello-pangea/dnd, lazy-loaded
- ⚠️ Warning chunk size > 500KB — acceptable car lazy-loaded, optimisation future possible

---

## Sprint 5 — Entretiens & Contrats ✅
**Date** : 2026-02-23
**Objectif** : Page Entretiens fonctionnelle, vue enrichie contrats+clients, maintenance visits

### Phase 1 — Base de données (5 migrations Supabase)
- `prepare_contracts_drop_view_and_columns` — Retrait champs contrat de la table clients
- `create_contracts_views_rls_and_client_view` — Vue enrichie `majordhome_contracts` (JOIN clients)
- `enrich_contracts_view_with_client_info` — Colonnes client_name, client_address, etc.
- `fix_maintenance_visits_contract_id_to_uuid` — FK integer→uuid (legacy conservé)
- `create_maintenance_visits_view` — Vue `majordhome_maintenance_visits`

### Phase 2 — Frontend (8 fichiers)

#### `entretiens.service.js` — NOUVEAU
- Requête vue enrichie `majordhome_contracts` (colonnes client JOINées)
- Méthodes : getContracts, getContractById, getContractStats, getContractSectors, getContractVisits, upsertVisit

#### `useContracts.js` — v3.0 (hooks reconnectés)
- `useContracts` / `useContract` / `useContractStats` / `useContractSectors` / `useContractVisits` / `useContractMutations` reconnectés (anciens stubs remplacés)

#### 6 composants `entretiens/`
- `EntretiensDashboard.jsx` — Stats cards (total, actifs, expirés, à renouveler) + chart répartition fréquence
- `ContractsList.jsx` — Filtres (status/frequency/search) + grille paginée de ContractCard
- `SectorGroupView.jsx` — Groupement par code postal, sections dépliables
- `ContractCard.jsx` — Carte contrat (infos client JOINées, statut, fréquence, prochaine visite)
- `ContractModal.jsx` — Slide-over détail contrat + enregistrer visite maintenance
- `VisitBadge.jsx` — Badge statut visite (completed/pending/overdue)

#### `Entretiens.jsx` — v1.0 (RÉÉCRIT)
- 3 onglets Radix Tabs : Dashboard | Contrats | Secteurs
- ContractModal slide-over partagée entre les 3 onglets

### Vérifications
- ✅ Build production : 0 erreur
- ✅ Vue enrichie contrats+clients fonctionnelle

---

## UI/UX Polish — Page Clients ✅
**Date** : 2026-02-25
**Objectif** : Amélioration visuelle et fonctionnelle de la page Clients

### Changements

#### `Clients.jsx` → v4.0
- **5 stat cards cliquables** : Total | Particuliers | Entreprises | Contrats actifs | Archivés
- Clic = filtre actif, re-clic = reset (sauf Total qui reset toujours)
- **Filtre persisté dans URL** via `useSearchParams` (`?filter=particuliers|entreprises|contracts|archived`)
- Navigation vers fiche client et retour préserve le filtre actif
- **EmptyState contextuel** par stat card (`STAT_CARD_LABELS` : "Aucun client archivé", etc.)
- Suppression ligne "Filtres actifs" redondante
- Grille 5 stat cards/ligne, 4 cartes client/ligne

#### `ClientCard.jsx` → v2.0
- **Icônes catégorie** : Users (amber) particulier, Building2 (purple) entreprise, Archive (amber) archivé
- **Adresse 2 lignes** : rue + CP/ville séparés
- **Contrat icône** : FileText vert (masquée si pas de contrat, remplace ancien badge texte)
- **Style archivé** : `bg-gray-50/80 opacity-60`
- Téléphone/email cliquables (`tel:` / `mailto:`)

#### `clients.service.js` → v7.0
- Ajout paramètre `onlyArchived` : `.eq('is_archived', true)` quand actif
- Distinction `showArchived` (montre tous) vs `onlyArchived` (filtre archivés uniquement)

#### `useClients.js` → v6.0
- `onlyArchived: false` ajouté aux `DEFAULT_FILTERS`
- Paramètre passé au service dans queryFn et loadMore

### Vérifications
- ✅ Build production : 0 erreur
- ✅ Filtres stat cards fonctionnels (clic/toggle/reset)
- ✅ Filtre préservé après navigation retour
- ✅ Empty state contextuel par filtre

---

## Pipeline→Planning — Prise de RDV depuis les leads ✅
**Date** : 2026-03-04
**Objectif** : Quand un lead passe en "RDV planifié", créer un vrai appointment en DB lié au lead, visible dans le Planning avec badge

### Phase 1 — Base de données (1 migration Supabase)

#### Migration : `add_appointment_lead_client_links`
- FK constraint `lead_id` → `majordhome.leads(id)` sur `majordhome.appointments` (colonne existait déjà, FK manquante)
- Ajout colonne `client_id UUID` sur `majordhome.appointments` (FK → `majordhome.clients(id)`)
- Ajout colonne `appointment_id UUID` sur `majordhome.leads` (FK → `majordhome.appointments(id)`)
- 3 index créés : `idx_appointments_lead_id`, `idx_appointments_client_id`, `idx_leads_appointment_id`
- Vue `majordhome_appointments` recréée (inclut `client_id`)
- Vue `majordhome_leads` recréée via DROP CASCADE + CREATE (inclut `appointment_id`)
- 3 RPCs recréées (dépendaient de la vue) :
  - `create_majordhome_lead` — inchangée
  - `update_majordhome_lead` — ajout support `appointment_id`
  - `get_majordhome_lead_raw` — inchangée

### Phase 2 — Frontend (3 fichiers créés, 4 modifiés)

#### `TechnicianSelect.jsx` — NOUVEAU (extrait d'EventModal, ~90 lignes)
- Sélecteur multi-techniciens avec dropdown checkbox
- Couleurs calendrier, spécialités, compteur sélection
- Props : `selectedIds`, `onChange`, `members`, `placeholder`
- Réutilisé par EventModal et SchedulingPanel

#### `MiniWeekCalendar.jsx` — NOUVEAU (~280 lignes)
- Calendrier semaine pur CSS Grid (PAS FullCalendar)
- 6 jours (Lun-Sam) × 24 créneaux 30 min (07h-19h)
- Créneaux occupés colorés par type de RDV via `getAppointmentTypeConfig()`
- Filtrage par techniciens sélectionnés (côté client)
- Navigation semaine ← Sem. N → avec bouton "Auj."
- Highlight aujourd'hui + sélection créneau (dot bleu)
- Props : `weekStartDate`, `appointments`, `selectedDate`, `selectedTime`, `onSelectSlot`, `onWeekChange`, `technicianFilter`

#### `SchedulingPanel.jsx` — NOUVEAU (~260 lignes)
- Panneau de planification inline (affiché dans LeadModal)
- Compose : TechnicianSelect + MiniWeekCalendar + champs form
- Champs : Type RDV (dropdown APPOINTMENT_TYPES), Techniciens, Créneau, Durée (30min-4h), Objet (auto "RDV technique - {nom}"), Notes
- Validation : date, heure, ≥1 technicien, type requis
- Hooks : `useTeamMembers(orgId)`, `useAppointments({ orgId, startDate, endDate })`
- Résumé créneau sélectionné en bannière bleue

#### `EventModal.jsx` → v1.1
- TechnicianSelect extrait en fichier séparé
- Import depuis `./TechnicianSelect` remplace la fonction inline

#### `LeadModal.jsx` → v2.0 (Pipeline→Planning)
- Nouveaux imports : `appointmentsService`, `SchedulingPanel`
- States : `pendingRdvStatusId`, `schedulingLoading`
- `handleStatusChange` intercepte "RDV planifié" → affiche SchedulingPanel
- `handleConfirmScheduling` : auto-save lead → `appointmentsService.createAppointment()` → `updateLeadStatus()` avec `appointmentId`
- SchedulingPanel rendu inline en bg-blue-50 (même pattern que panneau Perdu)

#### `leads.service.js` → v1.1
- `updateLeadStatus` : gère `appointment_id` dans les updates pour "RDV planifié"

#### `Planning.jsx` → v2.1
- `renderEventContent` : badge "P" (blanc sur fond transparent) si `lead_id` présent dans extendedProps
- `toCalendarEvent()` propage automatiquement `lead_id`/`client_id` via spread `...appointment`

### Vérifications
- ✅ Build production : 0 erreur
- ✅ Migration DB : colonnes + FK + indexes + vues + RPCs mis à jour
- ✅ RLS : 4 policies existantes sur appointments (inchangées)

---

## Recherche client EventModal (Planning) ✅
**Date** : 2026-03-04
**Objectif** : Permettre de sélectionner un client existant depuis l'EventModal du Planning. Stocker le `client_id` sur l'appointment. Les techniciens accèdent à la fiche client directement depuis le calendrier.

### Contexte
L'EventModal avait des champs client en saisie libre (nom, téléphone, email, adresse). La colonne `client_id` existait sur `majordhome.appointments` (ajoutée dans la migration Pipeline→Planning) mais n'était pas utilisée.

### Changements

#### `EventModal.jsx` → v1.2
- **Imports** : `useNavigate`, `Search`, `UserCircle`, `ExternalLink`, `useClientSearch`, `supabase`
- **Prop `orgId`** : nécessaire pour `useClientSearch`
- **States** : `selectedClient` (objet client ou null), `showClientDropdown`
- **Hook** : `useClientSearch(orgId)` — debounce 300ms, min 2 caractères
- **`handleSelectClient`** : fetch client complet depuis `majordhome_clients`, auto-fill formData (nom, téléphone, email, adresse, CP, ville)
- **`handleUnlinkClient`** : reset `selectedClient`, champs restent remplis mais éditables
- **`handleSave`** : `client_id: selectedClient?.id || null` dans le payload
- **Section Client JSX** :
  - Bannière bleue (bg-blue-50) quand client lié : icône UserCircle, nom, client_number, ville, bouton "Fiche" (navigate), bouton X "Délier"
  - Champ recherche avec dropdown résultats (nom, numéro client, ville, téléphone)
  - Séparateur "— ou saisie manuelle —"
  - Champs manuels disabled quand client lié (`disabled={isCancelled || !!selectedClient}`)

#### `Planning.jsx`
- Ajout prop `orgId={orgId}` sur `<EventModal>` (1 ligne)

### Aucun changement nécessaire
| Fichier | Raison |
|---------|--------|
| `appointments.service.js` | spread `...appointmentData`/`...updates` → `client_id` passe automatiquement |
| `useAppointments.js` | mutations passent `...data` au service |
| `useClients.js` | `useClientSearch` hook existe déjà |
| `clients.service.js` | `searchClients` existe déjà |
| DB / Migrations | `client_id` colonne déjà présente |

### Flux
1. **Création avec client** : taper dans recherche → `useClientSearch` → clic résultat → `handleSelectClient` (fetch + auto-fill) → enregistrer avec `client_id`
2. **Création manuelle** : ignorer recherche, taper dans champs → `client_id: null`
3. **Édition d'un RDV lié** : EventModal init détecte `appointment.client_id` → bannière bleue avec bouton "Fiche"
4. **Navigation technicien** : bouton "Fiche" → `navigate('/artisan/clients/:id')`

### Vérifications
- ✅ Build production : 0 erreur
- ✅ Réutilisation hooks existants (`useClientSearch`, `searchClients`)
- ✅ Pattern identique à LeadModal (handleSelectClient, bannière, délier)

---

## EventModal v2.0 — Recherche unifiée, Contexte RDV, Auto-création lead ✅
**Date** : 2026-03-04
**Objectif** : Transformer l'EventModal du Planning en hub intelligent : recherche unifiée clients+leads, contexte métier du RDV, auto-création lead pour prospects walk-in

### Phase 1 — Bug fixes (colonnes + edit mode + unlink)
- Fix mismatch colonnes dans handleSave : `client_address` → `address`, `client_city` → `city`, `client_postal_code` → `postal_code`
- Fix init mode édition (restauration correcte selectedClient depuis appointment.client_id)
- Fix handleUnlinkClient : clear tous les champs contact (nom, prénom, téléphone, email, adresse, CP, ville)

### Phase 2 — Champ Prénom séparé
- Ajout `client_first_name` au formData
- Champs Nom / Prénom en `grid-cols-2` côte à côte
- Combinaison `client_first_name + " " + client_name` dans le payload de sauvegarde

### Phase 3 — searchLeads (backend)
- `leads.service.js` : ajout méthode `searchLeads(orgId, query)` — requête vue `majordhome_leads`, ilike sur first_name/last_name/email/phone/company_name, joins statuses+sources, limit 10
- `useLeads.js` : ajout hook `useLeadSearch(orgId, { debounceMs, minChars })` — même pattern que `useClientSearch` (debounce 300ms, min 2 chars)
- `leadKeys.search` ajouté au cache key factory

### Phase 4 — Recherche unifiée (dropdown sectionné)
- Champ recherche unique dans EventModal appelle `searchClient` + `searchLead` en parallèle
- Dropdown résultats avec sections "Clients" / "Leads" (headers gris séparateurs)
- Résultats clients : nom, client_number, ville, téléphone
- Résultats leads : nom, statut badge coloré, source badge
- Sélection client → bannière bleue (bg-blue-50) avec bouton "Fiche" (navigate) et "Délier"
- Sélection lead → bannière violet (bg-violet-50) avec bouton "Pipeline" (navigate) et "Délier"
- `lead_id` inclus dans le payload de sauvegarde

### Phase 5 — Contexte RDV + Auto-création lead
- Sélecteur "Contexte du RDV" en mode création : prospect / entretien / autre
- Dropdown Source (depuis `useLeadSources()`) quand contexte = prospect
- Auto-création lead via `leadsService.createLead()` quand :
  - contexte = prospect
  - pas de lead existant lié (`!selectedLead`)
  - sauvegarde de l'appointment réussie
- Lead créé avec : nom, prénom, email, téléphone, source sélectionnée, statut "RDV planifié", `appointment_id`, `client_id` si client lié
- Prop `userId` ajoutée à EventModal (passée depuis Planning.jsx via `useAuth().user.id`)

### Fichiers modifiés
| Fichier | Changement |
|---------|------------|
| `EventModal.jsx` | v2.0 — réécriture majeure (5 phases) |
| `leads.service.js` | v1.2 — ajout `searchLeads()` |
| `useLeads.js` | v1.1 — ajout `useLeadSearch()`, `leadKeys.search` |
| `Planning.jsx` | v2.2 — passe `userId` à EventModal, destructure `user` depuis useAuth |

### Vérifications
- ✅ Build production : 0 erreur
- ✅ Recherche unifiée clients+leads fonctionnelle
- ✅ Auto-création lead pour prospects walk-in
- ✅ Bannières client (bleue) et lead (violet) distinctes

---

## Sprint 6 — Chantiers + Dashboard réel + Planning multi-select ✅
**Date** : 2026-03-10
**Objectif** : Kanban post-vente (Gagné → Réalisé), dashboard avec données réelles, planning multi-sélection équipe

### Phase 1 — Base de données (4 migrations Supabase)

#### Migration 1 : `add_chantier_columns_to_leads`
- 5 colonnes ajoutées sur `majordhome.leads` : `chantier_status` (CHECK 6 valeurs), `equipment_order_status` (na/commande/recu), `materials_order_status`, `estimated_date` (DATE), `chantier_notes` (TEXT)
- Index `idx_leads_chantier_status` sur (org_id, chantier_status)

#### Migration 2 : `add_intervention_chantier_columns`
- Colonnes sur `majordhome.interventions` : `lead_id` (FK leads), `parent_id` (FK self), `slot_date`, `slot_start_time`, `slot_end_time`, `slot_notes`
- Table `majordhome.intervention_technicians` (junction intervention↔team_members, RLS + policy)
- 2 index : `idx_interventions_parent_id`, `idx_interventions_lead_id`

#### Migration 3 : `create_chantier_views`
- Vue `majordhome_chantiers` : leads WHERE chantier_status IS NOT NULL, JOIN `pricing_equipment_types` (label), JOIN intervention parent
- Vue `majordhome_intervention_slots` : interventions enfants + techniciens agrégés JSON
- Vue `majordhome_intervention_technicians`
- Vue `majordhome_leads` recréée (ajout 5 colonnes chantier)
- 3 RPCs recréées (CASCADE de la vue leads)

#### Migration 4 : `add_planification_date_to_leads`
- Colonne `planification_date DATE` sur `majordhome.leads`
- Vue `majordhome_chantiers` recréée (DROP + CREATE) pour inclure `planification_date`

### Phase 2 — Frontend : Chantiers (8 fichiers créés, 5 modifiés)

#### `chantiers.service.js` — NOUVEAU
- `CHANTIER_STATUSES` (6 colonnes Kanban), `CHANTIER_TRANSITIONS` (matrice de transitions)
- `getChantierStatusConfig(status)` → { label, color, display_order }
- `getChantiers({ orgId })` — depuis vue `majordhome_chantiers`
- `updateChantierStatus(leadId, newStatus)` — via RPC `update_majordhome_lead`, auto-set `planification_date` pour transition vers `planification`
- `updateOrderStatus(leadId, { equipment, materials })` — mise à jour + auto-transition vers `commande_recue`

#### `useChantiers.js` — NOUVEAU
- `chantierKeys` factory
- `useChantiers(orgId)` — chargement kanban avec staleTime 15s
- `useChantierMutations(orgId)` — updateStatus, updateOrderStatus, updateEstimatedDate

#### `ChantierKanban.jsx` — NOUVEAU
- Board 5 colonnes (facture masqué), recherche par nom, compteurs/colonne
- Pas de DnD Phase 1 (transitions via boutons dans modale)

#### `ChantierCard.jsx` — NOUVEAU
- Bande date à gauche (won_date), nom client, CP, montant, OrderIndicator (Éq./Mat. en couleur), type équipement badge
- Ligne dates : Estim. DD/MM/YY + Planif. DD/MM/YY quand disponible
- Commercial initiales en pastille colorée

#### `ChantierModal.jsx` — NOUVEAU
- Orchestrateur modal : infos chantier, ChantierOrderSection, ChantierInterventionSection
- Footer : boutons transition bidirectionnels (← retour gauche, → avancer droite)
- Auto-transition `planification` quand intervention parent créée
- Section intervention désactivée en statut `gagne`

#### `ChantierOrderSection.jsx` — NOUVEAU
- Selects équipement/matériaux (Non commandé / Commandé / Reçu / N/A)
- Auto-transition `commande_recue` quand les deux = reçu ou NA

#### `ChantierInterventionSection.jsx` — NOUVEAU
- Création intervention parent + liste slots avec techniciens
- Bouton créer/ajouter slot, date picker, TechnicianSelect réutilisé

#### `Chantiers.jsx` — NOUVEAU
- Page wrapper : header + ChantierKanban

#### Fichiers modifiés
- `leads.service.js` — auto-set `chantier_status: 'gagne'` quand lead passe en Gagné
- `interventions.service.js` — méthodes createChantierIntervention, createInterventionSlot, setInterventionTechnicians, getInterventionsByLeadId
- `useInterventions.js` — useInterventionSlots(parentId)
- `AppLayout.jsx` — entrée nav `Chantiers` (icône HardHat, entre Pipeline et Entretiens)
- `routes.jsx` — route lazy-loaded `/chantiers`

### Phase 3 — Dashboard réel (1 fichier réécrit)

#### `Dashboard.jsx` → v2.0 (RÉÉCRIT)
- Hook interne `useDashboardHome(orgId)` : queries parallèles Supabase (KPIs leads + chantiers + planning jour)
- 4 KPI cards : Nouveaux leads, Devis envoyés, Commandes à faire, À planifier
- Clics naviguent vers `/pipeline?tab=kanban` ou `/chantiers`
- Planning du jour réel depuis `majordhome_appointments`
- Alertes dynamiques basées sur KPIs
- Action rapide "Nouveau lead" avec LeadModal

#### `Pipeline.jsx` — FIX
- Lecture `?tab=` via `useSearchParams` pour onglet initial (KPI cards → Kanban directement)

### Phase 4 — Planning multi-select (2 fichiers modifiés)

#### `useAppointments.js` → v2.0
- Filtre `technicianId` (single) → `memberIds[]` (multi-select)
- Suppression filtrage côté service, remplacé par filtrage côté client
- Batch query `majordhome_appointment_technicians` pour liens tech↔RDV
- Filtrage : match tech via `techLinks` OU commercial via `assigned_commercial_id`

#### `Planning.jsx` → v3.0
- Import `useLeadCommercials` pour liste commerciaux
- `teamList` unifié via `useMemo` : merge techniciens (roleLabel='Tech') + commerciaux (roleLabel='Com.')
- `CalendarFilters` réécrit : dropdown multi-select avec checkboxes, pastilles couleur, labels rôle
- Bouton "Équipe" affiche les prénoms sélectionnés

### Phase 5 — Team members DB
- Eric Mayer désactivé (`is_active = false`)
- Antoine Verloo ajouté (technician, color #43A047 green)
- Ludovic Robert ajouté (technician, color #FB8C00 orange)

### Vérifications
- ✅ Build production : 0 erreur
- ✅ Transitions chantier bidirectionnelles fonctionnelles
- ✅ Auto-transition commande_recue et planification
- ✅ Dashboard données réelles + navigation KPI → Kanban
- ✅ Planning multi-select tech + commerciaux

---

## Sprint 7 — Droits & Accès ⬜
- Permissions granulaires par rôle (org_admin, team_leader, user/technicien)

## Sprint 8 — Portail Client ⬜
- Auth client, dashboard, factures/devis, équipements, historique

## Sprint 9 — Intégration Pennylane ⬜
- Sync API devis/factures

## Sprint 10 — N8N Avancé ⬜
- Facebook Ads leads, Slack bidirectionnel

---

## Enrichissement Pipeline Contrats (2026-04-19) ✅

**Objectif** : Tracer l'origine des contrats en attente (colonne "Nouveau") pour adapter la relance commerciale, et finaliser le flow Pipeline Leads → Entretien.

### Base de données
- Migration `contracts_source_tagging` :
  - `UPDATE` 666 contrats `'app'` pré-import Excel → `'import'`, 48 post → `'manual'`
  - `ALTER COLUMN source SET DEFAULT 'manual'`
  - `CHECK CONSTRAINT` sur 5 valeurs : `chantier | pipeline | web | manual | import`
- Migration `resync_client_number_sequence` : fix séquence désynchronisée (3411 vs max 3412) qui bloquait la création de client lors requalification

### Code
| Fichier | Modification |
|---|---|
| `contracts.service.js:126` | Default `'app'` → `'manual'` |
| `CreateContractModal.jsx:243` | Fallback `'app'` → `'manual'` |
| `LeadModal.jsx` | Restauration handleRequalifyEntretien avec `source='pipeline'`, remplace `updateLeadStatus('Requalifié')` par `leadsService.softDeleteLead` (le statut n'existait plus en DB) |
| `LeadFormSections.jsx` | Bouton "→ Entretien" (icône Wrench, indigo) dans SectionActions, visible leads statut "Nouveau" |
| `PipelineContrats.jsx` | `SOURCE_CONFIG` + tag emoji+label sur cartes + composant `SourceFilter` (pills toggle avec compteurs) + filteredContracts mémoïsés |

### 4 points d'entrée taguant `contracts.source`
| Source | Flow | État |
|---|---|---|
| 🔧 `chantier` | Bouton "Proposer un contrat" fin chantier | Existant (`ChantierModal.jsx:561`) |
| 🎯 `pipeline` | Bouton "→ Entretien" sur lead Nouveau | Restauré (soft-delete du lead après) |
| 🌐 `web` | Form `mayer-energie.fr/entretien` | Existant (RPC `process_web_entretien`) |
| ✋ `manual` | Création directe UI | Nouveau défaut |

### Bugs corrigés
1. **Séquence `client_number_seq` décalée** — `setval` recalé après import Excel
2. **Statut "Requalifié" inexistant en DB** — flow remplacé par soft-delete (`leads.is_deleted=true`)

### Non fait (prochaine session)
- Passage Kanban 2 → 5 colonnes (À relancer auto / Relance en cours / Négociation)
- Enrichissement mail Proposition Contrat (prix visible dans le corps + CTA page web au lieu de PDF) — baseline 44% open / 3% CTR à battre
- Dashboard stats mailing (taux ouverture/clic par campagne)

---

## Mailing — Campagnes paramétrables (2026-04-19) ✅

**Objectif** : Sortir les 9 templates mail de `Mailing.jsx` (~1000 LOC en dur) vers une table DB éditable depuis l'UI, avec un éditeur wizard guidé par IA pour créer de nouvelles campagnes sans déploiement.

### Base de données
- Migration `mail_campaigns_schema` :
  - Table `majordhome.mail_campaigns` (key UNIQUE per org, label, subject, preheader, html_body, tracking_type_value, default_segment, allowed_segments[], purpose, audience, tone, trigger_description, notes, blocks JSONB, is_archived, audit cols)
  - 4 RLS policies (select/insert/update/delete via `core.organization_members`) + service_role bypass
  - Trigger `trg_mail_campaigns_updated_at`
  - Vue `public.majordhome_mail_campaigns`
- Seed initial : 9 campagnes (mail_a à mail_i_newsletter) avec carte d'identité (purpose/audience/tone/trigger/notes) remplie

### Code — refactor complet de Mailing.jsx (1221 LOC → 55 LOC)
| Fichier | Rôle |
|---|---|
| `pages/Mailing.jsx` | Wrapper 2 onglets : Envoi (tous) / Éditeur (admin only) |
| `components/mailing/SendTab.jsx` | Onglet Envoi (sélection + ciblage + preview + envoi N8n) |
| `components/mailing/EditorTab.jsx` | Liste cards + actions (Éditer/Dupliquer/Archiver) + lance wizard |
| `components/mailing/CampaignWizard.jsx` | Modal wizard 3 étapes : Identité → Brief → Génération |
| `components/mailing/CampaignIdentityPanel.jsx` | Panneau repliable carte d'identité |
| `components/mailing/segments.js` | 8 segments de ciblage SQL extraits (constantes techniques) |
| `components/mailing/resources.js` | 📌 **SOURCE DE VÉRITÉ** caisse à outils URLs Mayer (32 entrées : CTA, services, blog, zones, contact). Injecté auto dans le prompt Claude. |
| `shared/services/mailCampaigns.service.js` | CRUD Supabase (list/getById/create/update/archive/duplicate/remove) |
| `shared/hooks/useMailCampaigns.js` | React Query (campaigns + 4 mutations + invalidation) |
| `shared/hooks/cacheKeys.js` | Ajout `mailCampaignKeys` |

### Workflow V1 (copier-coller)
1. Onglet Éditeur → "Nouvelle campagne" → wizard
2. **Étape 1 Identité** : libellé (clé auto-slugifiée), Contexte (objectif/cible/notes), Ton éditorial (5 choix + Autre), Ciblage technique (segments)
3. **Étape 2 Brief** : ligne éditoriale (textarea libre — l'IA structure les blocs elle-même), objet/preheader facultatifs (l'IA propose)
4. **Étape 3 Génération** : prompt système copiable (carte ID + brief + caisse à outils URLs + 4 types de blocs disponibles + contraintes techniques + UTM auto), JSON structuré, textarea HTML final, bouton Prévisualiser (iframe overlay)
5. User colle le prompt dans Claude → reçoit le HTML → colle dans textarea (auto-extraction OBJET/PREHEADER depuis commentaire HTML) → **Sauvegarder**
6. Validation : bloque save/envoi si subject vide

### Caisse à outils URLs (resources.js — 32 ressources)
| Catégorie | # | Détails |
|---|---|---|
| CTA | 7 | contact, dépannage SAV, entretien, espace client, simulateur aides, avis Google (edge function), parrainage |
| Services | 7 | PAC, climatisation, poêle granulés, poêle bois, chaudière fioul, photovoltaïque, électricité |
| Blog | 10 | comparatif poêles, prix PAC 2026, aides, DPE, confort thermique, etc. |
| Zones | 10 | Gaillac, Albi, Toulouse, Montauban, Castres, Lavaur, Carmaux, Rabastens, Graulhet, Mazamet |
| Info / Légal | 4 | site, à propos, mentions légales, RGPD |
| Contact | 2 | tel, email |
| Spécifique | 1 | offre pellets TotalEnergies (avec token) |

### Ce qui change pour l'utilisateur
- Plus de templates en dur dans le code → édition direct depuis l'UI
- Un nouveau template = 3 écrans + 1 chat Claude + 1 paste, pas de redeploy
- Carte d'identité visible (purpose, audience, tone…) → mémoire éditoriale préservée
- Filtre `mailing_logs.campaign_name = ...` corrigé (un client peut recevoir A puis B sans être bloqué)
- Bouton Prévisualiser dans le wizard (iframe overlay)

### Vdef prévue
- Remplacer l'étape 3 par appel API direct Anthropic (au lieu du copier-coller chat)
- Migration `parrainage` URL quand la page sera publiée
- Dashboard stats mailing (taux ouverture/clic par campagne)
