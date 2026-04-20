/**
 * cacheKeys.js — Factories de clés de cache React Query centralisées
 * ============================================================================
 * Source unique pour toutes les clés de cache TanStack React Query.
 * Élimine les imports croisés entre hooks et garantit la cohérence.
 * ============================================================================
 */

// --- Clients ---
export const clientKeys = {
  all: ['clients'],
  lists: () => [...clientKeys.all, 'list'],
  list: (orgId, filters) => [...clientKeys.lists(), orgId, filters],
  details: () => [...clientKeys.all, 'detail'],
  detail: (id) => [...clientKeys.details(), id],
  stats: (orgId) => [...clientKeys.all, 'stats', orgId],
  search: (orgId, query) => [...clientKeys.all, 'search', orgId, query],
  activities: (clientId) => [...clientKeys.all, 'activities', clientId],
  equipments: (clientId) => [...clientKeys.all, 'equipments', clientId],
  brands: () => [...clientKeys.all, 'brands'],
  pricingTypes: () => [...clientKeys.all, 'pricing-types'],
  duplicates: (orgId, name, postal) => [...clientKeys.all, 'duplicates', orgId, name, postal],
  linked: (clientId) => [...clientKeys.all, 'linked', clientId],
};

// --- Contracts ---
export const contractKeys = {
  all: ['contracts'],
  lists: () => [...contractKeys.all, 'list'],
  detail: (contractId) => [...contractKeys.all, 'detail', contractId],
  byClient: (clientId) => [...contractKeys.all, 'byClient', clientId],
  equipments: (contractId) => [...contractKeys.all, 'equipments', contractId],
  stats: (orgId, year) => [...contractKeys.all, 'stats', orgId, year],
};

// --- Leads ---
export const leadKeys = {
  all: ['leads'],
  lists: () => [...leadKeys.all, 'list'],
  list: (orgId, filters) => [...leadKeys.lists(), orgId, filters],
  detail: (id) => [...leadKeys.all, 'detail', id],
  activities: (leadId) => [...leadKeys.all, 'activities', leadId],
  sources: () => [...leadKeys.all, 'sources'],
  statuses: () => [...leadKeys.all, 'statuses'],
  commercials: (orgId) => [...leadKeys.all, 'commercials', orgId],
  search: (orgId, query) => [...leadKeys.all, 'search', orgId, query],
};

// --- Appointments ---
export const appointmentKeys = {
  all: ['appointments'],
  lists: () => [...appointmentKeys.all, 'list'],
  list: (orgId, dateRange, filters) => [...appointmentKeys.lists(), orgId, dateRange, filters],
  detail: (id) => [...appointmentKeys.all, 'detail', id],
  teamMembers: (orgId) => ['team-members', orgId],
  technicians: (appointmentIds) => [...appointmentKeys.all, 'technicians', appointmentIds],
};

// --- Interventions ---
export const interventionKeys = {
  all: ['interventions'],
  detail: (id) => [...interventionKeys.all, 'detail', id],
  fileUrls: (id) => [...interventionKeys.all, 'files', id],
  byProject: (projectId) => [...interventionKeys.all, 'project', projectId],
  slots: (parentId) => [...interventionKeys.all, 'slots', parentId],
};

// --- Chantiers ---
export const chantierKeys = {
  all: ['chantiers'],
  lists: () => [...chantierKeys.all, 'list'],
  list: (orgId) => [...chantierKeys.lists(), orgId],
};

// --- Prospects ---
export const prospectKeys = {
  all: ['prospects'],
  lists: () => [...prospectKeys.all, 'list'],
  list: (orgId, module, filters) => [...prospectKeys.lists(), orgId, module, filters],
  details: () => [...prospectKeys.all, 'detail'],
  detail: (id) => [...prospectKeys.details(), id],
  interactions: (id) => [...prospectKeys.all, 'interactions', id],
  stats: (orgId, module) => [...prospectKeys.all, 'stats', orgId, module],
  sirens: (orgId, module) => [...prospectKeys.all, 'sirens', orgId, module],
};

// --- Mailing ---
export const mailingKeys = {
  all: ['mailing'],
  byClient: (clientId) => [...mailingKeys.all, 'client', clientId],
  byLead: (leadId) => [...mailingKeys.all, 'lead', leadId],
};

// --- Mail Campaigns (templates paramétrables) ---
export const mailCampaignKeys = {
  all: ['mail-campaigns'],
  lists: () => [...mailCampaignKeys.all, 'list'],
  list: (orgId) => [...mailCampaignKeys.lists(), orgId],
  detail: (id) => [...mailCampaignKeys.all, 'detail', id],
};

// --- Mail Segments (catalogue de ciblages réutilisables) ---
export const mailSegmentKeys = {
  all: ['mail-segments'],
  lists: () => [...mailSegmentKeys.all, 'list'],
  list: (orgId) => [...mailSegmentKeys.lists(), orgId],
  detail: (id) => [...mailSegmentKeys.all, 'detail', id],
  count: (filters, campaignName, orgId) => [...mailSegmentKeys.all, 'count', orgId, campaignName, filters],
  preview: (filters, campaignName, orgId) => [...mailSegmentKeys.all, 'preview', orgId, campaignName, filters],
};

// --- SMS ---
export const smsKeys = {
  all: ['sms'],
  byClient: (clientId) => [...smsKeys.all, 'client', clientId],
  byIntervention: (interventionId) => [...smsKeys.all, 'intervention', interventionId],
};

// --- Pricing ---
export const pricingKeys = {
  all: ['pricing'],
  zones: () => [...pricingKeys.all, 'zones'],
  equipmentTypes: () => [...pricingKeys.all, 'equipmentTypes'],
  rates: () => [...pricingKeys.all, 'rates'],
  ratesByZone: (zoneId) => [...pricingKeys.all, 'rates', zoneId],
  discounts: () => [...pricingKeys.all, 'discounts'],
  extras: () => [...pricingKeys.all, 'extras'],
  allData: () => [...pricingKeys.all, 'allData'],
  contractItems: (contractId) => [...pricingKeys.all, 'contractItems', contractId],
};

// --- Permissions ---
export const permissionKeys = {
  all: ['permissions'],
  org: (orgId) => [...permissionKeys.all, orgId],
  members: (orgId) => [...permissionKeys.all, 'members', orgId],
};

// --- Entretien SAV ---
export const entretienSavKeys = {
  all: ['entretien-sav'],
  lists: () => [...entretienSavKeys.all, 'list'],
  list: (orgId) => [...entretienSavKeys.lists(), orgId],
  stats: (orgId) => [...entretienSavKeys.all, 'stats', orgId],
  children: (parentId) => [...entretienSavKeys.all, 'children', parentId],
};

// --- Technical Visit ---
export const technicalVisitKeys = {
  all: ['technical-visits'],
  byLead: (leadId) => [...technicalVisitKeys.all, 'lead', leadId],
  photos: (visitId) => [...technicalVisitKeys.all, 'photos', visitId],
};

// --- Certificats ---
export const certificatKeys = {
  all: ['certificats'],
  byIntervention: (interventionId) => [...certificatKeys.all, 'intervention', interventionId],
};

// --- Suppliers ---
export const supplierKeys = {
  all: ['suppliers'],
  lists: () => [...supplierKeys.all, 'list'],
  list: (orgId) => [...supplierKeys.lists(), orgId],
  detail: (id) => [...supplierKeys.all, 'detail', id],
  products: (supplierId) => [...supplierKeys.all, 'products', supplierId],
  productDetail: (productId) => [...supplierKeys.all, 'product', productId],
  productVariants: (parentId) => [...supplierKeys.all, 'variants', parentId],
  allProducts: (orgId) => [...supplierKeys.all, 'all-products', orgId],
  searchProducts: (orgId, query) => [...supplierKeys.all, 'search-products', orgId, query],
  productDocuments: (productId) => [...supplierKeys.all, 'product-documents', productId],
  productDocumentsByIds: (ids) => [...supplierKeys.all, 'product-documents-batch', ...(ids || [])],
};

// --- GeoGrid ---
export const geogridKeys = {
  all: ['geogrid'],
  lists: () => [...geogridKeys.all, 'list'],
  list: (orgId) => [...geogridKeys.lists(), orgId],
  detail: (scanId) => [...geogridKeys.all, 'detail', scanId],
  results: (scanId) => [...geogridKeys.all, 'results', scanId],
};

// --- Tasks ---
export const taskKeys = {
  all: ['tasks'],
  lists: () => [...taskKeys.all, 'list'],
  list: (orgId) => [...taskKeys.lists(), orgId],
  archived: (orgId) => [...taskKeys.all, 'archived', orgId],
  detail: (id) => [...taskKeys.all, 'detail', id],
  notes: (taskId) => [...taskKeys.all, 'notes', taskId],
};

// --- Google Calendar ---
export const googleCalendarKeys = {
  all: ['google-calendar'],
  status: (orgId) => [...googleCalendarKeys.all, 'status', orgId],
};

// --- Pennylane ---
export const pennylaneKeys = {
  all: ['pennylane'],
  sync: (entityType, localId) => [...pennylaneKeys.all, 'sync', entityType, localId],
  syncByClient: (clientId) => [...pennylaneKeys.all, 'sync', 'client', clientId],
  ledgerAccounts: () => [...pennylaneKeys.all, 'ledger-accounts'],
  invoicesByClient: (clientId) => [...pennylaneKeys.all, 'invoices', clientId],
  quotesByClient: (clientId) => [...pennylaneKeys.all, 'quotes', clientId],
};

// --- Meta Ads ---
export const metaAdsKeys = {
  all: ['meta-ads'],
  stats: (orgId, range, level) => [...metaAdsKeys.all, 'stats', orgId, range, level],
  attribution: (orgId, range, commercialId) => [...metaAdsKeys.all, 'attribution', orgId, range, commercialId || 'all'],
  accounts: (orgId) => [...metaAdsKeys.all, 'accounts', orgId],
  commercials: (orgId) => [...metaAdsKeys.all, 'commercials', orgId],
};

// --- Devis (Quotes) ---
export const devisKeys = {
  all: ['devis'],
  lists: () => [...devisKeys.all, 'list'],
  list: (orgId, filters) => [...devisKeys.lists(), orgId, filters],
  detail: (id) => [...devisKeys.all, 'detail', id],
  lines: (quoteId) => [...devisKeys.all, 'lines', quoteId],
  byLead: (leadId) => [...devisKeys.all, 'byLead', leadId],
  byClient: (clientId) => [...devisKeys.all, 'byClient', clientId],
};
