/**
 * segmentBuilder.constants.js — Constantes + utilitaires pour le SegmentBuilderDrawer
 * ============================================================================
 * Les valeurs doivent rester cohérentes avec les ENUMs Postgres côté schema
 * `majordhome` (contract_status, housing_type, dpe_rating, etc.).
 * ============================================================================
 */

export const AUDIENCES = [
  { value: 'clients', label: 'Clients' },
  { value: 'leads', label: 'Leads' },
];

export const CLIENT_BASE_KINDS = [
  { value: 'all', label: 'Tous les clients' },
  { value: 'has_contract', label: 'Avec contrat' },
  { value: 'no_contract', label: 'Sans contrat (jamais eu)' },
];

export const CONTRACT_STATUSES = [
  { value: 'active', label: 'Actif' },
  { value: 'pending', label: 'En attente' },
  { value: 'cancelled', label: 'Résilié' },
];

export const HOUSING_TYPES = [
  { value: 'maison', label: 'Maison' },
  { value: 'appartement', label: 'Appartement' },
  { value: 'local_commercial', label: 'Local commercial' },
  { value: 'immeuble', label: 'Immeuble' },
  { value: 'autre', label: 'Autre' },
];

export const DPE_RATINGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export const LEAD_SOURCES = [
  'appointment_legacy',
  'website',
  'phone',
  'walk_in',
  'referral',
  'meta_ads',
  'google_ads',
  'other',
];

export const ORDER_BY_OPTIONS = [
  { value: 'recency_desc', label: 'Récents en premier' },
  { value: 'recency_asc', label: 'Anciens en premier' },
  { value: 'city', label: 'Par ville' },
  { value: 'random', label: 'Aléatoire' },
];

/**
 * Filters vides par défaut pour une nouvelle création
 */
export function buildEmptyFilters(audience = 'clients') {
  return {
    audience,
    base: audience === 'clients' ? { kind: 'all' } : { kind: 'lead_status', status_ids: [] },
    attributes: {},
    mailing_history: { exclude_current_campaign: true },
    limits: { order_by: 'recency_desc' },
  };
}

/**
 * Parse une chaîne "a, b, c" en tableau de strings (trim + suppression vides)
 */
export function parseCsvList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Inverse : array -> chaîne CSV pour UI
 */
export function arrayToCsv(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.join(', ');
}

/**
 * Clone + update d'un path nested dans l'objet filters (immutable)
 */
export function updateFilters(filters, path, value) {
  const clone = { ...filters };
  let cursor = clone;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    cursor[key] = { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  const leafKey = path[path.length - 1];
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    delete cursor[leafKey];
  } else {
    cursor[leafKey] = value;
  }
  return clone;
}
