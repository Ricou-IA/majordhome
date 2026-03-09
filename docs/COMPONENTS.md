# COMPONENTS.md - Cartographie des composants Majord'home

> **Dernière MàJ** : 2026-03-10 — Sprint 6 Chantiers + Dashboard réel + Planning multi-select

---

## Arbre de fichiers complet

```
src/
├── main.jsx                              # Entry point : React.StrictMode > BrowserRouter > QueryClientProvider > AuthProvider > App > Toaster
├── App.jsx                               # Routes principales (publiques + /artisan/*)
│
├── lib/
│   ├── supabaseClient.js                 # createClient Supabase
│   └── utils.js                          # cn() — clsx + twMerge
│
├── contexts/
│   └── AuthContext.jsx                   # Provider + useAuth()
│       Expose: user, profile, organization, membership
│       Computed: isOrgAdmin, isTeamLeader, isTeamLeaderOrAbove, canAccessPipeline
│       Actions: signIn, signUp, signOut, signInWithGoogle, resetPassword, updateProfile, joinOrganization
│
├── pages/                                # Pages publiques (hors layout)
│   ├── Login.jsx
│   ├── ResetPassword.jsx
│   ├── AuthCallback.jsx                  # Callback OAuth
│   ├── JoinOrganization.jsx              # Rejoindre org via code
│   ├── NotFound.jsx
│   └── Unauthorized.jsx
│
├── components/
│   ├── ProtectedRoute.jsx                # Vérifie auth + org, redirect si non connecté
│   ├── ui/                               # Radix UI / Shadcn primitives
│   │   ├── badge.jsx
│   │   ├── button.jsx
│   │   ├── calendar.jsx
│   │   ├── card.jsx
│   │   ├── checkbox.jsx
│   │   ├── collapsible.jsx
│   │   ├── input.jsx
│   │   ├── label.jsx
│   │   ├── popover.jsx
│   │   ├── select.jsx
│   │   ├── sonner.jsx                    # Config Toaster
│   │   ├── table.jsx
│   │   ├── tabs.jsx
│   │   ├── textarea.jsx
│   │   └── tooltip.jsx
│   │
│   └── pipeline/dashboard/               # Composants dashboard pipeline
│       ├── ConversionFunnel.jsx
│       ├── CostComparisonChart.jsx
│       ├── DashboardCards.jsx
│       ├── DashboardFilters.jsx
│       ├── MonthlyTrendsChart.jsx
│       └── SourcesTable.jsx
│
├── layouts/
│   └── AppLayout.jsx                     # Sidebar + Header + main content
│       Sidebar: nav links (Dashboard, Planning, Clients, Pipeline, Chantiers, Entretiens, Territoire)
│       Header: org name, user avatar, profil/settings links
│
├── hooks/pipeline/
│   ├── useDashboardData.js               # Données dashboard pipeline (leads, stats)
│   └── useDashboardFilters.js            # Filtres dashboard (dates, sources, statuts)
│
├── apps/artisan/
│   ├── routes.jsx                        # 12 routes lazy-loaded
│   │   Routes:
│   │   - index → Dashboard
│   │   - planning → Planning
│   │   - clients → Clients
│   │   - clients/:id → ClientDetail
│   │   - pipeline → Pipeline
│   │   - chantiers → Chantiers
│   │   - entretiens → Entretiens
│   │   - territoire → Territoire
│   │   - intervention/:id → InterventionDetail
│   │   - settings → Settings
│   │   - profile → Profile
│   │
│   ├── pages/
│   │   ├── Dashboard.jsx                 # v2.0 — KPIs réels + planning du jour + alertes + action rapide
│   │   │   Hook interne: useDashboardHome(orgId) — queries parallèles Supabase (KPIs + planning jour)
│   │   │   4 KPI cards cliquables: Nouveaux leads, Devis envoyés, Commandes à faire, À planifier
│   │   │   Clics: /pipeline?tab=kanban (leads/devis), /chantiers (commandes/planifier)
│   │   │   Planning du jour depuis majordhome_appointments (filtre today + non annulés)
│   │   │   Alertes dynamiques basées sur KPIs, action rapide "Nouveau lead" (LeadModal)
│   │   │   Hooks: useAuth
│   │   │
│   │   ├── Clients.jsx                   # v4.0 — Liste clients avec stat cards cliquables + filtres URL
│   │   │   Props internes: SearchBar, FilterDropdown, StatCard (×5 cliquables), EmptyState (contextuel), ErrorState
│   │   │   5 stat cards : Total | Particuliers | Entreprises | Contrats actifs | Archivés (toggle filtre)
│   │   │   Filtre persisté URL via useSearchParams (?filter=particuliers|entreprises|contracts|archived)
│   │   │   EmptyState contextuel par stat card (STAT_CARD_LABELS), grille 4 cartes/ligne
│   │   │   Navigation: clic card → /artisan/clients/:id (filtre préservé au retour)
│   │   │   Hooks: useClients({ orgId }), useClientStats(orgId)
│   │   │
│   │   ├── ClientDetail.jsx              # v2.0 — Fiche client complète
│   │   │   Route: /artisan/clients/:id (useParams)
│   │   │   5 onglets: Informations | Contrat | Équipements | Interventions | Timeline
│   │   │   Lock/Unlock editing, onglet Contrat dédié (CRUD), client_number affiché
│   │   │   Hooks: useClient(id), useClientContract(id), useClientEquipments(id), useClientActivities(id)
│   │   │
│   │   ├── Pipeline.jsx                  # v2.1 — 3 onglets: Dashboard | Leads | Kanban (Sprint 4)
│   │   │   Onglets Radix Tabs: dashboard, leads, kanban
│   │   │   **Tab initial** via useSearchParams (`?tab=kanban` depuis Dashboard KPI cards)
│   │   │   LeadModal partagée entre les 3 onglets
│   │   │   Hooks: useDashboardData, useDashboardFilters, useAuth
│   │   │
│   │   ├── Planning.jsx                  # v3.0 — FullCalendar + multi-select équipe (Sprint 2/6)
│   │   │   Sous-composants: CalendarToolbar, CalendarFilters (multi-select checkboxes), renderEventContent
│   │   │   Vues: timeGridWeek (défaut), timeGridDay, dayGridMonth
│   │   │   Interactions: drag & drop, resize, select-to-create, clic-to-edit
│   │   │   **Badge "P"** sur events avec lead_id (RDV créés depuis pipeline)
│   │   │   **teamList unifié** : merge useTeamMembers (Tech) + useLeadCommercials (Com.) via useMemo
│   │   │   **CalendarFilters** : dropdown multi-select checkboxes, pastilles couleur, labels rôle (Tech/Com.)
│   │   │   Passe `userId` (de useAuth) à EventModal pour auto-création lead
│   │   │   Hooks: useAppointments, useTeamMembers, useLeadCommercials, useAuth
│   │   │
│   │   ├── Chantiers.jsx                 # v1.0 — Page chantiers post-vente (Sprint 6)
│   │   │   Route: /artisan/chantiers
│   │   │   Wrapper: header + ChantierKanban
│   │   │   ChantierModal slide-over partagée
│   │   │   Hooks: useChantiers(orgId), useChantierMutations(orgId), useAuth
│   │   │
│   │   ├── Entretiens.jsx                # v1.0 — 3 onglets: Dashboard | Contrats | Secteurs (Sprint 5)
│   │   │   Onglets Radix Tabs: dashboard, contrats, secteurs
│   │   │   Composants: EntretiensDashboard, ContractsList, SectorGroupView
│   │   │   ContractModal slide-over partagée, VisitBadge pour statut visite
│   │   │   Hooks: useContracts, useContractStats, useContractSectors, useContractVisits, useContractMutations
│   │   ├── InterventionDetail.jsx        # v1.0 — Fiche terrain tablette (Sprint 3)
│   │   │   Route: /artisan/intervention/:id (useParams)
│   │   │   4 onglets: Résumé | Rapport | Photos | Signature & Envoi
│   │   │   Onglets 2-4 verrouillés si status ≠ in_progress
│   │   │   Auto-save brouillon localStorage 30s
│   │   │   Hooks: useIntervention(id), useInterventionFileUrls, useInterventionMutations, useInterventionDraft
│   │   │
│   │   ├── Settings.jsx                  # Paramètres organisation
│   │   └── Profile.jsx                   # Profil utilisateur
│   │
│   └── components/
│       ├── clients/
│       │   ├── ClientCard.jsx            # v2.0 — Carte client redesignée
│       │   │   Exports: ClientCard, ClientCardCompact, ClientCardSkeleton
│       │   │   Props: client, onClick, selected
│       │   │   Icônes catégorie : Users (amber) particulier, Building2 (purple) entreprise, Archive (amber) archivé
│       │   │   Adresse 2 lignes (rue + CP/ville), contrat icône verte (masquée si pas de contrat)
│       │   │   Archivé : bg-gray-50/80 opacity-60, téléphone/email cliquables (tel:/mailto:)
│       │   │
│       │   ├── ClientModal.jsx           # Modale création/édition client
│       │   │   Props: clientId, isOpen, onClose, onSaved
│       │   │   Mode création (clientId=null) ou édition
│       │   │   Hook: useClient(clientId)
│       │   │
│       │   └── EquipmentList.jsx         # Liste équipements d'un client
│       │       Props: clientId
│       │       CRUD complet avec modales ajout/édition
│       │       Hook: useClientEquipments(clientId)
│       │
│       ├── interventions/
│       │   ├── InterventionHeader.jsx    # Résumé lecture seule : client, équipement, type, statut, boutons
│       │   ├── PhotoCapture.jsx          # Capture photo tablette (camera capture=environment), preview, upload/delete
│       │   ├── SignaturePad.jsx          # Wrapper react-signature-canvas, export PNG, champ nom signataire
│       │   ├── PartsReplacedList.jsx     # Liste dynamique pièces remplacées (nom, réf, qté), add/remove
│       │   └── PdfViewer.jsx            # iframe PDF Storage, états loading/erreur/vide, bouton télécharger
│       │
│       ├── pipeline/                     # Composants pipeline leads (Sprint 4 + Pipeline→Planning)
│       │   ├── LeadCard.jsx             # Carte lead (mode normal + compact kanban)
│       │   │   Exports: LeadCard, LeadCardSkeleton
│       │   │   Props: lead, onClick, compact
│       │   │   Normal: nom, statut badge, source badge, montant, tel, action, jours
│       │   │   Compact: nom, montant, source, jours, next action
│       │   │
│       │   ├── LeadsList.jsx            # Liste leads filtrable + pagination
│       │   │   Props: onLeadClick, onNewLead
│       │   │   SearchBar debounce 300ms, FilterDropdown (statut/source/assigné/tri)
│       │   │   Hooks: useLeads, useLeadSources, useLeadStatuses, useLeadCommercials
│       │   │
│       │   ├── LeadModal.jsx            # Slide-over créer/éditer lead (v2.0 — Pipeline→Planning)
│       │   │   Props: leadId, isOpen, onClose, onSaved
│       │   │   Sections: Contact, Pipeline, Action suivante, Notes, Actions, Timeline
│       │   │   **Planification RDV** : intercepte statut "RDV planifié" → affiche SchedulingPanel inline
│       │   │   States: pendingRdvStatusId, schedulingLoading (même pattern que pendingLostStatusId)
│       │   │   handleConfirmScheduling: auto-save lead → créer appointment → update statut lead
│       │   │   Hooks: useLead, useLeadActivities, useLeadStatuses, useLeadSources, useLeadCommercials, useLeadMutations
│       │   │   Imports: appointmentsService, SchedulingPanel
│       │   │
│       │   ├── SchedulingPanel.jsx      # v1.0 — Panneau planification RDV depuis pipeline (Sprint 4+)
│       │   │   Props: lead, orgId, onConfirm, onCancel, isLoading
│       │   │   Compose: TechnicianSelect + MiniWeekCalendar + champs formulaire
│       │   │   Champs: Type RDV (dropdown), Techniciens, Créneau (mini-cal), Durée, Objet, Notes
│       │   │   Validation: date, heure, ≥1 technicien, type de RDV requis
│       │   │   Hooks: useTeamMembers(orgId), useAppointments({ orgId, startDate, endDate })
│       │   │
│       │   ├── LeadActivityTimeline.jsx # Timeline activités avec ajout note
│       │   │   Props: activities, isLoading, onAddNote, isAddingNote, disabled
│       │   │   ICON_MAP: Lucide icons par type d'activité
│       │   │
│       │   └── LeadKanban.jsx           # Vue kanban drag & drop
│       │       Props: onLeadClick, onNewLead
│       │       @hello-pangea/dnd: DragDropContext > Droppable (par status_id) > Draggable
│       │       KanbanColumn interne: header (label, count, montant), LeadCard compact
│       │       Optimistic update + rollback
│       │
│       ├── chantiers/                   # Composants page Chantiers (Sprint 6)
│       │   ├── ChantierKanban.jsx      # Board 5 colonnes (facture masqué), recherche nom, compteurs
│       │   │   Props: chantiers, onChantierClick, searchQuery
│       │   │   5 colonnes: Gagné, Commande à faire, Commande reçue, Planification, Réalisé
│       │   │   Pas de DnD Phase 1 (transitions via boutons dans modale)
│       │   │
│       │   ├── ChantierCard.jsx        # Carte chantier Kanban
│       │   │   Props: chantier, onClick, commercialsMap
│       │   │   Bande date gauche (won_date), nom, CP, montant, OrderIndicator (Éq./Mat.)
│       │   │   Type équipement badge violet, dates Estim. + Planif., commercial initiales
│       │   │
│       │   ├── ChantierModal.jsx       # Modale orchestrateur au clic sur carte
│       │   │   Props: chantier, isOpen, onClose, onUpdated
│       │   │   Sections: infos, ChantierOrderSection, ChantierInterventionSection
│       │   │   Footer bidirectionnel: ← retour (gauche), → avancer (droite)
│       │   │   Auto-transition planification quand intervention parent créée
│       │   │   Section intervention disabled quand status = gagne
│       │   │
│       │   ├── ChantierOrderSection.jsx # Selects commande équipement/matériaux
│       │   │   Props: chantier, onUpdate
│       │   │   Status: Non commandé / Commandé / Reçu / N/A
│       │   │   Auto-transition commande_recue quand les 2 = reçu ou NA
│       │   │
│       │   └── ChantierInterventionSection.jsx # Gestion intervention parent + slots
│       │       Props: chantier, disabled
│       │       Création intervention parent, liste slots (date + TechnicianSelect + notes)
│       │
│       ├── entretiens/                  # Composants page Entretiens (Sprint 5)
│       │   ├── EntretiensDashboard.jsx  # Stats cards + chart répartition par fréquence
│       │   ├── ContractsList.jsx        # Liste contrats filtrable (status/frequency/search) + pagination
│       │   ├── SectorGroupView.jsx      # Groupement contrats par code postal, sections dépliables
│       │   ├── ContractCard.jsx         # Carte contrat (infos client JOINées, statut, fréquence, prochaine visite)
│       │   ├── ContractModal.jsx        # Slide-over détail contrat + enregistrer visite maintenance
│       │   └── VisitBadge.jsx           # Badge statut visite (completed/pending/overdue)
│       │
│       └── planning/
│           ├── TechnicianSelect.jsx      # v1.0 — Sélecteur multi-techniciens partagé (extrait d'EventModal)
│           │   Props: selectedIds, onChange, members, placeholder
│           │   Dropdown checkbox multi-select avec couleurs calendrier et spécialités
│           │   Utilisé par: EventModal, SchedulingPanel
│           │
│           ├── MiniWeekCalendar.jsx      # v1.0 — Calendrier semaine CSS Grid (Sprint 4+)
│           │   Props: weekStartDate, appointments, selectedDate, selectedTime,
│           │          onSelectSlot, onWeekChange, technicianFilter
│           │   6 jours (Lun-Sam) × créneaux 30 min (07h-19h), pur CSS Grid (PAS FullCalendar)
│           │   Créneaux occupés colorés par type de RDV, filtrage par techniciens
│           │   Navigation semaine (← Sem. N →), highlight aujourd'hui + sélection
│           │   Utilisé par: SchedulingPanel
│           │
│           └── EventModal.jsx            # v2.0 — Modale création/édition RDV (recherche unifiée, contexte RDV, auto-lead)
│               Props: isOpen, mode, appointment, defaultDate, defaultTime, members,
│                      orgId, onClose, onSave, onDelete, onCancel, isSaving, userId
│               Mode création (defaultDate/defaultTime depuis sélection calendrier)
│               Mode édition (pré-remplissage depuis appointment, restauration selectedClient/selectedLead si client_id/lead_id)
│               Sections: Contexte RDV (create), Type & Priorité, Date & Heure, Client/Lead (recherche unifiée), Techniciens, Notes
│               **Contexte RDV** (mode création uniquement) :
│                 - Sélecteur contexte : prospect / entretien / autre
│                 - Dropdown Source quand contexte = prospect (affiche sources depuis useLeadSources)
│                 - Auto-création lead quand prospect walk-in (pas de lead lié) via leadsService.createLead()
│               **Recherche unifiée clients + leads** :
│                 - Champ recherche unique → appelle searchClient + searchLead en parallèle
│                 - Dropdown avec sections "Clients" / "Leads" (headers séparés)
│                 - Résultats clients : nom, client_number, ville, téléphone
│                 - Résultats leads : nom, statut badge coloré, source
│               **Bannière client lié** (bleue bg-blue-50) : icône UserCircle, nom, client_number, ville, bouton "Fiche", bouton "Délier"
│               **Bannière lead lié** (violet bg-violet-50) : nom, statut, bouton "Pipeline" (navigate), bouton "Délier"
│               Champ Prénom séparé (grid-cols-2 Nom/Prénom), combinés à la sauvegarde
│               handleSelectClient → fetch complet + auto-fill champs (address, city, postal_code corrigés)
│               handleSelectLead → auto-fill champs contact, set lead_id
│               handleUnlinkClient → reset selectedClient + clear tous les champs contact
│               client_id + lead_id inclus dans payload handleSave
│               Auto-calcul heures début/fin/durée
│               Import: TechnicianSelect, useClientSearch, useLeadSearch, useLeadSources, leadsService, useNavigate
│               Confirmations: CancelConfirmation, DeleteConfirmation
│
└── shared/
    ├── services/
    │   ├── auth.service.js               # signIn, signUp, signOut, getProfile, isOrgAdmin, etc.
    │   ├── clients.service.js            # v7.0 — Service clients CRM (+ onlyArchived filter)
    │   │   Constantes exportées: CLIENT_CATEGORIES, EQUIPMENT_TYPES, HOUSING_TYPES, LEAD_SOURCES
    │   │   Méthodes: getClients (params: search, showArchived, onlyArchived, hasContract, clientCategory, orderBy),
    │   │             getClientById, getClientByProjectId, createClient, updateClient,
    │   │             deleteClient, archiveClient, unarchiveClient, getClientStats, searchClients,
    │   │             getClientEquipments, addEquipment, updateEquipment, deleteEquipment,
    │   │             getClientInterventions, getClientActivities, addClientNote
    │   │
    │   ├── contracts.service.js          # v1.0 — Service contrats d'entretien (fiche client)
    │   │   Constantes exportées: CONTRACT_STATUSES (4), CONTRACT_FREQUENCIES (5)
    │   │   Méthodes: getContractByClientId, getContractById, createContract, updateContract,
    │   │             deleteContract, getContractEquipments, addEquipmentToContract,
    │   │             removeEquipmentFromContract
    │   │
    │   ├── entretiens.service.js        # v1.0 — Service page Entretiens (Sprint 5)
    │   │   Méthodes: getContracts (liste enrichie via vue majordhome_contracts),
    │   │             getContractById, getContractStats, getContractSectors (groupement CP),
    │   │             getContractVisits (maintenance_visits), upsertVisit, getContractEquipments
    │   │
    │   ├── chantiers.service.js           # v1.0 — Service chantiers post-vente (Sprint 6)
    │   │   Constantes exportées: CHANTIER_STATUSES (6), CHANTIER_TRANSITIONS (matrice transitions)
    │   │   Helper: getChantierStatusConfig(status) → { label, color, display_order }
    │   │   Méthodes: getChantiers({ orgId }), updateChantierStatus(leadId, newStatus),
    │   │             updateOrderStatus(leadId, { equipment, materials })
    │   │   Auto-set planification_date quand transition vers planification
    │   │   Auto-transition commande_recue quand equipment+materials = reçu/NA
    │   │
    │   ├── appointments.service.js       # v1.0 — Service planning RDV (Sprint 2)
    │   │   Constantes exportées: APPOINTMENT_TYPES (7), APPOINTMENT_STATUSES (6), PRIORITIES (4)
    │   │   Helper: getAppointmentTypeConfig(type) → { value, label, color, bgClass }
    │   │   Cache org_id: getMajordhomeOrgId(coreOrgId) — résout core→majordhome org mapping
    │   │   Méthodes CRUD: getAppointments, getAppointmentById, createAppointment, updateAppointment,
    │   │                  moveAppointment, cancelAppointment, deleteAppointment
    │   │   Méthodes team: getTeamMembers, getAppointmentTechnicians
    │   │   Helpers FullCalendar: toCalendarEvent(appointment), fromCalendarEvent(event)
    │   │
    │   ├── interventions.service.js      # v1.0 — Service interventions terrain (Sprint 3)
    │   │   Constantes exportées: INTERVENTION_TYPES (6), INTERVENTION_STATUSES (5), FILE_TYPES (5)
    │       Helpers: getInterventionTypeConfig(type), getInterventionStatusConfig(status)
    │       Méthodes CRUD: getInterventionById, getInterventionsByProject, updateIntervention,
    │                      updateInterventionStatus
    │       Storage: uploadFile, getFileUrl, getInterventionFileUrls, deleteFile
    │       N8N webhooks: triggerPdfGeneration, triggerSignedReport
    │   │   Helper: getEquipmentById
    │   │
    │   └── leads.service.js              # v1.2 — Service leads pipeline (Sprint 4 + EventModal v2.0)
    │       Constantes exportées: LEAD_ACTIVITY_TYPES (8), ACTIVITY_LABELS, ACTIVITY_CONFIG (icônes/couleurs)
    │       Référence: getSources(), getStatuses(), getCommercials()
    │       CRUD: getLeads, getLeadById, createLead, updateLead, softDeleteLead
    │       Recherche: searchLeads(orgId, query) — vue majordhome_leads, ilike first_name/last_name/email/phone/company_name, joins statuses+sources, limit 10
    │       Statut: updateLeadStatus (+ lead_activity old→new)
    │       Activities: getLeadActivities, addLeadNote
    │       Assignation: assignLead
    │       Conversion: convertLeadToClient (→ majordhome_clients)
    │       Accès: .schema('majordhome').from('leads') — pas de vue publique. searchLeads utilise vue majordhome_leads
    │
    └── hooks/
        ├── useClients.js                 # v6.0 — Hooks React Query (+ onlyArchived filter)
        │   Exports:
        │   - clientKeys (cache key factory)
        │   - useClients({ orgId, limit }) → { clients, isLoading, loadingMore, hasMore, filters, setFilters, loadMore, refresh }
        │   - useClient(clientId) → { client, isLoading, updateClient, isUpdating, refresh }
        │   - useClientEquipments(clientId) → { equipments, addEquipment, updateEquipment, deleteEquipment, ... }
        │   - useClientActivities(clientId) → { activities, addNote, isAddingNote, refresh }
        │   - useClientStats(orgId) → { stats, isLoading, refresh }
        │   - useClientSearch(orgId, { debounceMs, minChars }) → { query, results, searching, search, clear }
        │
        ├── useContracts.js               # v3.0 — Hooks contrats React Query (fiche client + page Entretiens)
        │   Exports:
        │   - contractKeys (cache key factory)
        │   - useClientContract(clientId) → { contract, isLoading, createContract, updateContract, deleteContract, ... }
        │   - useContractEquipments(contractId) → { equipments, addEquipment, removeEquipment, ... }
        │   - useContracts({ orgId, filters }) → { contracts, totalCount, isLoading, ... } (page Entretiens)
        │   - useContract(contractId) → { contract, isLoading }
        │   - useContractStats(orgId) → { stats }
        │   - useContractSectors(orgId) → { sectors } (groupement par CP)
        │   - useContractVisits(contractId) → { visits }
        │   - useContractMutations() → { upsertVisit, ... }
        │
        ├── useChantiers.js                # v1.0 — Hooks chantiers React Query (Sprint 6)
        │   Exports:
        │   - chantierKeys (cache key factory)
        │   - useChantiers(orgId) → { chantiers, isLoading, error, refresh }
        │   - useChantierMutations(orgId) → { updateStatus, updateOrderStatus, updateEstimatedDate, isUpdating }
        │
        ├── useAppointments.js            # v2.0 — Hooks planning React Query (Sprint 2 + Sprint 6 multi-select)
        │   Exports:
        │   - appointmentKeys (cache key factory)
        │   - useAppointments({ orgId, startDate, endDate }) → { events, appointments, isLoading, error,
        │       filters (memberIds[], appointmentType, status), setFilters,
        │       createAppointment, updateAppointment, moveAppointment,
        │       cancelAppointment, deleteAppointment, isCreating, isUpdating, isMoving, isCancelling,
        │       isDeleting, refresh }
        │   - useAppointment(appointmentId) → { appointment, isLoading, error, refresh }
        │   - useTeamMembers(orgId) → { members, isLoading, error, refresh }
        │   NOTE: v2.0 — filtrage multi-membre côté client via batch query appointment_technicians
        │
        ├── useInterventions.js           # v1.0 — Hooks interventions React Query (Sprint 3)
        │   Exports:
        │   - interventionKeys (cache key factory)
        │   - useIntervention(id) → { intervention, client, equipment, isLoading, error, refresh }
        │   - useInterventionFileUrls(intervention) → { photoBeforeUrl, photoAfterUrl, photosExtraUrls, signatureUrl, refreshUrls }
        │   - useInterventionMutations(id) → { updateIntervention, updateStatus, uploadFile, deleteFile,
        │       triggerPdf, triggerSignedReport, isUpdating, isUploading, isGeneratingPdf, isSendingReport }
        │   - useInterventionDraft(id) → { loadDraft, saveDraft, clearDraft, hasDraft, startAutoSave, stopAutoSave, lastSaved }
        │
        └── useLeads.js                  # v1.1 — Hooks leads pipeline React Query (Sprint 4 + EventModal v2.0)
            Exports:
            - leadKeys (cache key factory: all, lists, list, detail, activities, sources, statuses, commercials, search)
            - useLeads({ orgId, limit }) → { leads, totalCount, isLoading, loadingMore, hasMore, filters, setFilters, resetFilters, loadMore, refresh }
            - useLead(leadId) → { lead, isLoading, error, refresh }
            - useLeadActivities(leadId) → { activities, isLoading, error, refresh }
            - useLeadSources() → { sources, isLoading } (staleTime 5min)
            - useLeadStatuses() → { statuses, isLoading } (staleTime 5min)
            - useLeadCommercials() → { commercials, isLoading }
            - useLeadSearch(orgId, { debounceMs, minChars }) → { query, results, searching, search, clear } (debounce 300ms, min 2 chars)
            - useLeadMutations() → { createLead, updateLead, deleteLead, updateLeadStatus, assignLead,
                convertLead, addNote, isCreating, isUpdating, isDeleting, isChangingStatus, isAssigning,
                isConverting, isAddingNote }
```

---

## Patterns clés

### Pattern service
```js
export const clientsService = {
  async getClients({ orgId, search, limit, offset, ...filters }) {
    // Requête Supabase avec filtres dynamiques
    return { data, count, error };
  }
};
```

### Pattern hook React Query
```js
export function useClients({ orgId, limit = 25 } = {}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: clientKeys.list(orgId, filters),
    queryFn: () => clientsService.getClients({ orgId, ...filters }),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  // ... pagination manuelle avec loadMore
}
```

### Cache keys factory
```js
export const clientKeys = {
  all: ['clients'],
  lists: () => [...clientKeys.all, 'list'],
  list: (orgId, filters) => [...clientKeys.lists(), orgId, filters],
  detail: (id) => [...clientKeys.all, 'detail', id],
  stats: (orgId) => [...clientKeys.all, 'stats', orgId],
  search: (orgId, query) => [...clientKeys.all, 'search', orgId, query],
  activities: (clientId) => [...clientKeys.all, 'activities', clientId],
};
```

### Pattern navigation
```jsx
// Clients.jsx
const navigate = useNavigate();
const handleClientClick = (client) => navigate(`/artisan/clients/${client.id}`);

// ClientDetail.jsx
const { id } = useParams();
const { client, isLoading } = useClient(id);
```

---

## Composants UI disponibles (Radix/Shadcn)

| Composant | Import | Usage |
|-----------|--------|-------|
| `Badge` | `@components/ui/badge` | Labels colorés |
| `Button` | `@components/ui/button` | Boutons (variants: default, destructive, outline, ghost) |
| `Calendar` | `@components/ui/calendar` | Date picker |
| `Card` | `@components/ui/card` | CardHeader, CardTitle, CardContent, CardFooter |
| `Checkbox` | `@components/ui/checkbox` | Cases à cocher |
| `Collapsible` | `@components/ui/collapsible` | Sections pliables |
| `Input` | `@components/ui/input` | Champs texte |
| `Label` | `@components/ui/label` | Labels de formulaire |
| `Popover` | `@components/ui/popover` | Popovers |
| `Select` | `@components/ui/select` | Listes déroulantes (SelectTrigger, SelectContent, SelectItem) |
| `Sonner/Toaster` | `@components/ui/sonner` | Config toasts (toast.success, toast.error) |
| `Table` | `@components/ui/table` | Tables (TableHeader, TableBody, TableRow, TableCell) |
| `Tabs` | `@components/ui/tabs` | Onglets (TabsList, TabsTrigger, TabsContent) |
| `Textarea` | `@components/ui/textarea` | Zones de texte multiligne |
| `Tooltip` | `@components/ui/tooltip` | Infobulles |
