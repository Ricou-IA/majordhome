/**
 * cacheKeys.js — Factories de clés de cache React Query centralisées
 * ============================================================================
 * Source unique pour toutes les clés de cache TanStack React Query.
 * Élimine les imports croisés entre hooks et garantit la cohérence.
 *
 * Convention (P0.11 — 2026-05-21) : toutes les familles utilisent
 * `all: (orgId) => [<domain>, orgId]` en racine, et toutes les sous-keys
 * prennent `orgId` en 1ᵉʳ paramètre. Pattern défini par `pricingKeys`
 * (P0.0.6) et généralisé à toutes les familles.
 *
 *   Avantages :
 *     - Le cache est scopé par org à TOUS les niveaux → un user qui
 *       changerait d'org (multi-tenant futur) ne voit jamais le cache
 *       d'une autre org via partial match.
 *     - `invalidateQueries({ queryKey: clientKeys.all(orgId) })` invalide
 *       tout le cache clients d'une org spécifique sans toucher aux autres.
 *     - `invalidateQueries({ queryKey: ['clients'] })` reste possible
 *       (préfixe match TanStack v5) si on veut tout invalider toutes orgs.
 *
 *   Bénéfice net aujourd'hui : nul tant qu'aucun user n'est dans 2 orgs
 *   simultanément. `queryClient.clear()` au logout (P0.12) couvre déjà le
 *   switch d'org. Mais c'est de la défense en profondeur indispensable
 *   avant l'onboarding 2ᵉ entreprise.
 *
 * Usage côté hook (pattern standard) :
 *
 *   const { organization } = useAuth();
 *   const orgId = organization?.id;
 *   useQuery({
 *     queryKey: clientKeys.detail(orgId, clientId),
 *     queryFn: () => clientsService.getById(clientId),
 *     enabled: !!orgId && !!clientId,  // évite fire avant que orgId soit résolu
 *   });
 * ============================================================================
 */

// --- Clients ---
export const clientKeys = {
  all: (orgId) => ['clients', orgId],
  lists: (orgId) => [...clientKeys.all(orgId), 'list'],
  list: (orgId, filters) => [...clientKeys.lists(orgId), filters],
  details: (orgId) => [...clientKeys.all(orgId), 'detail'],
  detail: (orgId, id) => [...clientKeys.details(orgId), id],
  stats: (orgId) => [...clientKeys.all(orgId), 'stats'],
  search: (orgId, query) => [...clientKeys.all(orgId), 'search', query],
  activities: (orgId, clientId) => [...clientKeys.all(orgId), 'activities', clientId],
  equipments: (orgId, clientId) => [...clientKeys.all(orgId), 'equipments', clientId],
  brands: (orgId) => [...clientKeys.all(orgId), 'brands'],
  pricingTypes: (orgId) => [...clientKeys.all(orgId), 'pricing-types'],
  duplicates: (orgId, name, postal) => [...clientKeys.all(orgId), 'duplicates', name, postal],
  linked: (orgId, clientId) => [...clientKeys.all(orgId), 'linked', clientId],
};

// --- Contracts ---
export const contractKeys = {
  all: (orgId) => ['contracts', orgId],
  lists: (orgId) => [...contractKeys.all(orgId), 'list'],
  detail: (orgId, contractId) => [...contractKeys.all(orgId), 'detail', contractId],
  byClient: (orgId, clientId) => [...contractKeys.all(orgId), 'byClient', clientId],
  equipments: (orgId, contractId) => [...contractKeys.all(orgId), 'equipments', contractId],
  stats: (orgId, year) => [...contractKeys.all(orgId), 'stats', year],
};

// --- Leads ---
export const leadKeys = {
  all: (orgId) => ['leads', orgId],
  lists: (orgId) => [...leadKeys.all(orgId), 'list'],
  list: (orgId, filters) => [...leadKeys.lists(orgId), filters],
  detail: (orgId, id) => [...leadKeys.all(orgId), 'detail', id],
  activities: (orgId, leadId) => [...leadKeys.all(orgId), 'activities', leadId],
  sources: (orgId) => [...leadKeys.all(orgId), 'sources'],
  statuses: (orgId) => [...leadKeys.all(orgId), 'statuses'],
  commercials: (orgId) => [...leadKeys.all(orgId), 'commercials'],
  search: (orgId, query) => [...leadKeys.all(orgId), 'search', query],
  longTerm: (orgId, filters) => [...leadKeys.all(orgId), 'longTerm', filters],
};

// --- Lead Interactions (timeline MT-LT) ---
export const leadInteractionKeys = {
  all: (orgId) => ['lead-interactions', orgId],
  byLead: (orgId, leadId) => [...leadInteractionKeys.all(orgId), 'byLead', leadId],
};

// --- Kanban Cards (Phase 1 pipeline multi-devis) ---
export const kanbanCardKeys = {
  all: (orgId) => ['kanban-cards', orgId],
};

// --- Appointments ---
export const appointmentKeys = {
  all: (orgId) => ['appointments', orgId],
  lists: (orgId) => [...appointmentKeys.all(orgId), 'list'],
  list: (orgId, dateRange, filters) => [...appointmentKeys.lists(orgId), dateRange, filters],
  detail: (orgId, id) => [...appointmentKeys.all(orgId), 'detail', id],
  teamMembers: (orgId) => ['team-members', orgId],
  technicians: (orgId, appointmentIds) => [...appointmentKeys.all(orgId), 'technicians', appointmentIds],
};

// --- Interventions ---
export const interventionKeys = {
  all: (orgId) => ['interventions', orgId],
  detail: (orgId, id) => [...interventionKeys.all(orgId), 'detail', id],
  fileUrls: (orgId, id) => [...interventionKeys.all(orgId), 'files', id],
  byProject: (orgId, projectId) => [...interventionKeys.all(orgId), 'project', projectId],
  slots: (orgId, parentId) => [...interventionKeys.all(orgId), 'slots', parentId],
};

// --- Chantiers ---
export const chantierKeys = {
  all: (orgId) => ['chantiers', orgId],
  lists: (orgId) => [...chantierKeys.all(orgId), 'list'],
  list: (orgId) => [...chantierKeys.lists(orgId)],
};

// --- Chantier Receptions (réceptions ligne par ligne) ---
export const chantierReceptionKeys = {
  all: (orgId) => ['chantier-receptions', orgId],
  byChantier: (orgId, chantierId) => [...chantierReceptionKeys.all(orgId), 'byChantier', chantierId],
};

// --- Chantier Slots (Phase 0 transitoire — supprimé en Phase 1) ---
export const chantierSlotKeys = {
  all: (orgId) => ['chantier-slots', orgId],
  lists: (orgId) => [...chantierSlotKeys.all(orgId), 'list'],
  list: (orgId, dateRange) => [...chantierSlotKeys.lists(orgId), dateRange],
};

// --- Prospects ---
export const prospectKeys = {
  all: (orgId) => ['prospects', orgId],
  lists: (orgId) => [...prospectKeys.all(orgId), 'list'],
  list: (orgId, module, filters) => [...prospectKeys.lists(orgId), module, filters],
  details: (orgId) => [...prospectKeys.all(orgId), 'detail'],
  detail: (orgId, id) => [...prospectKeys.details(orgId), id],
  interactions: (orgId, id) => [...prospectKeys.all(orgId), 'interactions', id],
  stats: (orgId, module) => [...prospectKeys.all(orgId), 'stats', module],
  sirens: (orgId, module) => [...prospectKeys.all(orgId), 'sirens', module],
};

// --- Mailing (logs) ---
export const mailingKeys = {
  all: (orgId) => ['mailing', orgId],
  byClient: (orgId, clientId) => [...mailingKeys.all(orgId), 'client', clientId],
  byLead: (orgId, leadId) => [...mailingKeys.all(orgId), 'lead', leadId],
};

// --- Mail Campaigns (templates paramétrables) ---
export const mailCampaignKeys = {
  all: (orgId) => ['mail-campaigns', orgId],
  lists: (orgId) => [...mailCampaignKeys.all(orgId), 'list'],
  list: (orgId) => [...mailCampaignKeys.lists(orgId)],
  detail: (orgId, id) => [...mailCampaignKeys.all(orgId), 'detail', id],
};

// --- Mail Segments (catalogue de ciblages réutilisables) ---
export const mailSegmentKeys = {
  all: (orgId) => ['mail-segments', orgId],
  lists: (orgId) => [...mailSegmentKeys.all(orgId), 'list'],
  list: (orgId) => [...mailSegmentKeys.lists(orgId)],
  detail: (orgId, id) => [...mailSegmentKeys.all(orgId), 'detail', id],
  count: (orgId, filters, campaignName) => [...mailSegmentKeys.all(orgId), 'count', campaignName, filters],
  preview: (orgId, filters, campaignName) => [...mailSegmentKeys.all(orgId), 'preview', campaignName, filters],
};

// --- Mail Campaign Stats (KPIs agrégés par campagne) ---
export const mailCampaignStatsKeys = {
  all: (orgId) => ['mail-campaign-stats', orgId],
  list: (orgId) => [...mailCampaignStatsKeys.all(orgId), 'list'],
};

// --- SMS ---
export const smsKeys = {
  all: (orgId) => ['sms', orgId],
  byClient: (orgId, clientId) => [...smsKeys.all(orgId), 'client', clientId],
  byIntervention: (orgId, interventionId) => [...smsKeys.all(orgId), 'intervention', interventionId],
};

// --- Pricing per-org (P0.0.6 — pattern de référence pour P0.11) ---
export const pricingKeys = {
  all: (orgId) => ['pricing', orgId],
  zones: (orgId) => [...pricingKeys.all(orgId), 'zones'],
  equipmentTypes: (orgId) => [...pricingKeys.all(orgId), 'equipmentTypes'],
  rates: (orgId) => [...pricingKeys.all(orgId), 'rates'],
  ratesByZone: (orgId, zoneId) => [...pricingKeys.all(orgId), 'rates', zoneId],
  discounts: (orgId) => [...pricingKeys.all(orgId), 'discounts'],
  extras: (orgId) => [...pricingKeys.all(orgId), 'extras'],
  allData: (orgId) => [...pricingKeys.all(orgId), 'allData'],
  contractItems: (orgId, contractId) => [...pricingKeys.all(orgId), 'contractItems', contractId],
};

// --- Permissions ---
export const permissionKeys = {
  all: (orgId) => ['permissions', orgId],
  org: (orgId) => [...permissionKeys.all(orgId)],
  members: (orgId) => [...permissionKeys.all(orgId), 'members'],
};

// --- Entretien SAV ---
export const entretienSavKeys = {
  all: (orgId) => ['entretien-sav', orgId],
  lists: (orgId) => [...entretienSavKeys.all(orgId), 'list'],
  list: (orgId) => [...entretienSavKeys.lists(orgId)],
  stats: (orgId) => [...entretienSavKeys.all(orgId), 'stats'],
  children: (orgId, parentId) => [...entretienSavKeys.all(orgId), 'children', parentId],
};

// --- Technical Visit ---
export const technicalVisitKeys = {
  all: (orgId) => ['technical-visits', orgId],
  byLead: (orgId, leadId) => [...technicalVisitKeys.all(orgId), 'lead', leadId],
  photos: (orgId, visitId) => [...technicalVisitKeys.all(orgId), 'photos', visitId],
};

// --- Certificats ---
export const certificatKeys = {
  all: (orgId) => ['certificats', orgId],
  byIntervention: (orgId, interventionId) => [...certificatKeys.all(orgId), 'intervention', interventionId],
};

// --- Suppliers ---
export const supplierKeys = {
  all: (orgId) => ['suppliers', orgId],
  lists: (orgId) => [...supplierKeys.all(orgId), 'list'],
  list: (orgId) => [...supplierKeys.lists(orgId)],
  detail: (orgId, id) => [...supplierKeys.all(orgId), 'detail', id],
  products: (orgId, supplierId) => [...supplierKeys.all(orgId), 'products', supplierId],
  productDetail: (orgId, productId) => [...supplierKeys.all(orgId), 'product', productId],
  productVariants: (orgId, parentId) => [...supplierKeys.all(orgId), 'variants', parentId],
  allProducts: (orgId) => [...supplierKeys.all(orgId), 'all-products'],
  searchProducts: (orgId, query) => [...supplierKeys.all(orgId), 'search-products', query],
  productDocuments: (orgId, productId) => [...supplierKeys.all(orgId), 'product-documents', productId],
  productDocumentsByIds: (orgId, ids) => [...supplierKeys.all(orgId), 'product-documents-batch', ...(ids || [])],
};

// --- GeoGrid ---
export const geogridKeys = {
  all: (orgId) => ['geogrid', orgId],
  lists: (orgId) => [...geogridKeys.all(orgId), 'list'],
  list: (orgId) => [...geogridKeys.lists(orgId)],
  detail: (orgId, scanId) => [...geogridKeys.all(orgId), 'detail', scanId],
  results: (orgId, scanId) => [...geogridKeys.all(orgId), 'results', scanId],
  quota: (orgId) => [...geogridKeys.all(orgId), 'quota'],
  keywordLists: (orgId) => [...geogridKeys.all(orgId), 'keyword-lists'],
  benchmarks: (orgId) => [...geogridKeys.all(orgId), 'benchmarks'],
  benchmarkScans: (orgId, benchmarkId) => [...geogridKeys.all(orgId), 'benchmark-scans', benchmarkId],
};

// --- GSC (Google Search Console) ---
export const gscKeys = {
  all: (orgId) => ['gsc', orgId],
  status: (orgId) => [...gscKeys.all(orgId), 'status'],
  metrics: (orgId, range, queries) => [...gscKeys.all(orgId), 'metrics', range, queries],
};

// --- Tasks ---
export const taskKeys = {
  all: (orgId) => ['tasks', orgId],
  lists: (orgId) => [...taskKeys.all(orgId), 'list'],
  list: (orgId) => [...taskKeys.lists(orgId)],
  archived: (orgId) => [...taskKeys.all(orgId), 'archived'],
  detail: (orgId, id) => [...taskKeys.all(orgId), 'detail', id],
  notes: (orgId, taskId) => [...taskKeys.all(orgId), 'notes', taskId],
};

// --- Google Calendar ---
export const googleCalendarKeys = {
  all: (orgId) => ['google-calendar', orgId],
  status: (orgId) => [...googleCalendarKeys.all(orgId), 'status'],
};

// --- Pennylane ---
export const pennylaneKeys = {
  all: (orgId) => ['pennylane', orgId],
  sync: (orgId, entityType, localId) => [...pennylaneKeys.all(orgId), 'sync', entityType, localId],
  syncByClient: (orgId, clientId) => [...pennylaneKeys.all(orgId), 'sync', 'client', clientId],
  ledgerAccounts: (orgId) => [...pennylaneKeys.all(orgId), 'ledger-accounts'],
  invoicesByClient: (orgId, clientId) => [...pennylaneKeys.all(orgId), 'invoices', clientId],
  quotesByClient: (orgId, clientId) => [...pennylaneKeys.all(orgId), 'quotes', clientId],
  quoteLines: (orgId, pennylaneQuoteId) => [...pennylaneKeys.all(orgId), 'quote-lines', pennylaneQuoteId],
  linkedQuotesByLead: (orgId, leadId) => [...pennylaneKeys.all(orgId), 'linked-quotes', leadId],
  // PR 4 bridge : candidats fuzzy + devis PL non rattachés (exploration + compteur)
  candidatesByLead: (orgId, leadId) => [...pennylaneKeys.all(orgId), 'candidates', leadId],
  unlinkedQuotes: (orgId, sinceDays) => [...pennylaneKeys.all(orgId), 'unlinked-quotes', sinceDays],
  unlinkedQuotesCount: (orgId, sinceDays) => [...pennylaneKeys.all(orgId), 'unlinked-quotes-count', sinceDays],
};

// --- Meta Ads ---
export const metaAdsKeys = {
  all: (orgId) => ['meta-ads', orgId],
  stats: (orgId, range, level) => [...metaAdsKeys.all(orgId), 'stats', range, level],
  attribution: (orgId, range, commercialId) => [...metaAdsKeys.all(orgId), 'attribution', range, commercialId || 'all'],
  accounts: (orgId) => [...metaAdsKeys.all(orgId), 'accounts'],
  commercials: (orgId) => [...metaAdsKeys.all(orgId), 'commercials'],
};

// --- Devis (Quotes) ---
export const devisKeys = {
  all: (orgId) => ['devis', orgId],
  lists: (orgId) => [...devisKeys.all(orgId), 'list'],
  list: (orgId, filters) => [...devisKeys.lists(orgId), filters],
  detail: (orgId, id) => [...devisKeys.all(orgId), 'detail', id],
  lines: (orgId, quoteId) => [...devisKeys.all(orgId), 'lines', quoteId],
  byLead: (orgId, leadId) => [...devisKeys.all(orgId), 'byLead', leadId],
  byClient: (orgId, clientId) => [...devisKeys.all(orgId), 'byClient', clientId],
};

// Settings de l'organisation — convention P0.11 (orgId scoped)
export const orgSettingsKeys = {
  all: (orgId) => ['orgSettings', orgId],
  byOrg: (orgId) => [...orgSettingsKeys.all(orgId)],
};
