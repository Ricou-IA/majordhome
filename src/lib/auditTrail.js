/**
 * auditTrail.js — mise en forme du mouchard (journal d'audit des écritures)
 * ============================================================================
 * Module PUR (aucun import React / Supabase) — testé par
 * `node --test scripts/audit-trail.test.mjs`.
 *
 * Source : lignes de la vue `majordhome_audit_log`, écrites par le trigger
 * `majordhome.audit_row_change()` (migration 20260916_3). Une ligne = une
 * écriture sur `leads` ou `appointments` : QUI (`changed_by` = auth.uid() côté
 * serveur), QUAND (`changed_at`), QUOI (`changed_fields` + `old_values` /
 * `new_values` limités aux champs modifiés), PAR OÙ (`source` = RPC ou vue).
 *
 * Ce module ne fait QUE traduire : libellés FR des colonnes, formats (dates,
 * heures, montants), résolution des ids en noms via des `resolvers` fournis
 * par l'appelant (statuts, commerciaux…), fusion avec les activités
 * déclaratives existantes (`lead_activities`). Il ne décide de rien.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// Dictionnaires
// ----------------------------------------------------------------------------

/** Libellés FR des colonnes auditées. Colonne absente → nom technique affiché. */
export const AUDIT_FIELD_LABELS = {
  leads: {
    first_name: 'Prénom',
    last_name: 'Nom',
    company_name: 'Société',
    email: 'Email',
    phone: 'Téléphone',
    phone_secondary: 'Téléphone secondaire',
    address: 'Adresse',
    address_complement: 'Complément d’adresse',
    postal_code: 'Code postal',
    city: 'Ville',
    source_id: 'Source',
    status_id: 'Statut',
    assigned_user_id: 'Commercial assigné',
    equipment_type_id: 'Type d’équipement',
    order_amount_ht: 'Montant HT',
    estimated_revenue: 'CA estimé',
    probability: 'Probabilité',
    notes: 'Notes',
    next_action: 'Prochaine action',
    next_action_date: 'Date de la prochaine action',
    created_date: 'Date de création',
    converted_date: 'Date de conversion',
    lost_reason: 'Raison de la perte',
    is_deleted: 'Supprimé',
    appointment_date: 'Date du RDV',
    appointment_id: 'RDV lié',
    quote_sent_date: 'Date d’envoi du devis',
    won_date: 'Date de gain',
    client_id: 'Client lié',
    project_id: 'Projet lié',
    last_call_date: 'Dernier appel',
    last_call_result: 'Résultat du dernier appel',
    call_count: 'Nombre d’appels',
    followup_count: 'Nombre de relances',
    last_followup_date: 'Dernière relance',
    email_sent: 'Email envoyé',
    chantier_status: 'Statut chantier',
    equipment_order_status: 'Commande équipement',
    materials_order_status: 'Commande matériel',
    estimated_date: 'Date de pose estimée',
    planification_date: 'Date de planification',
    chantier_notes: 'Notes chantier',
    pv_reception_path: 'PV de réception',
    is_long_term_project: 'Projet long terme',
    long_term_started_at: 'Début du suivi long terme',
    long_term_notes: 'Notes long terme',
    pennylane_quote_id: 'Devis Pennylane',
    external_id: 'Identifiant externe',
    external_source: 'Source externe',
    external_data: 'Données externes',
    email_unsubscribed_at: 'Désabonnement email',
    email_unsubscribe_reason: 'Raison du désabonnement',
    meta_campaign_id: 'Campagne Meta',
    meta_adset_id: 'Ensemble de publicités Meta',
    meta_ad_id: 'Publicité Meta',
  },
  appointments: {
    scheduled_date: 'Date du RDV',
    scheduled_start: 'Heure de début',
    scheduled_end: 'Heure de fin',
    duration_minutes: 'Durée',
    appointment_type: 'Type de RDV',
    status: 'Statut',
    priority: 'Priorité',
    subject: 'Objet',
    description: 'Description',
    internal_notes: 'Notes internes',
    completion_notes: 'Compte-rendu',
    client_name: 'Client',
    client_first_name: 'Prénom du client',
    client_phone: 'Téléphone du client',
    client_email: 'Email du client',
    address: 'Adresse',
    postal_code: 'Code postal',
    city: 'Ville',
    assigned_commercial_id: 'Commercial',
    lead_id: 'Lead lié',
    client_id: 'Client lié',
    intervention_id: 'Intervention liée',
    service_request_id: 'Demande SAV liée',
    equipment_type: 'Type d’équipement',
    is_billable: 'Facturable',
    estimated_amount: 'Montant estimé',
    final_amount: 'Montant final',
    invoice_id: 'Facture',
    invoice_status: 'Statut de la facture',
    cancelled_at: 'Annulé le',
    cancellation_reason: 'Raison de l’annulation',
    completed_at: 'Terminé le',
    source: 'Source',
    created_by: 'Créé par',
    time_flex_minutes: 'Souplesse',
    hour_confirmed_at: 'Heure figée le',
    announced_start: 'Heure annoncée',
    grand_secteur: 'Grand secteur',
    is_recurring: 'Récurrent',
    recurrence_rule: 'Règle de récurrence',
    parent_appointment_id: 'RDV parent',
    parts_used: 'Pièces utilisées',
    photos_urls: 'Photos',
    signature_url: 'Signature',
  },
};

/**
 * Chemin d'écriture (`source` = RPC ou vue racine de la requête) → libellé.
 * Un chemin inconnu est montré tel quel : mieux vaut un nom technique qu'un
 * « via inconnu » qui masque l'information.
 */
export const AUDIT_SOURCE_LABELS = {
  update_majordhome_lead: 'fiche lead',
  create_majordhome_lead: 'création de lead',
  get_majordhome_lead_raw: 'fiche lead',
  majordhome_leads: 'pipeline',
  majordhome_appointments: 'planning',
  lead_attach_quotes_and_send: 'rattachement de devis',
  assign_quote_to_lead: 'rattachement de devis',
  lead_mark_won_with_quote: 'gain via devis',
  lead_merge: 'fusion de doublons',
  lead_hard_delete: 'suppression définitive',
  create_lead_from_webhook: 'formulaire web (N8N)',
  upsert_pennylane_lead: 'synchro Pennylane',
  pennylane_sync_update_quote_fields: 'synchro Pennylane',
  pennylane_sync_ensure_winning_quotes: 'synchro Pennylane',
  tournees_figer_journee: 'figeage de la journée',
  meta_ads_backfill_lead_attribution: 'attribution Meta Ads',
};

/** Sujet affiché selon la table auditée. */
const SUBJECTS = { leads: 'Lead', appointments: 'RDV' };

/**
 * À la création, seuls ces champs sont détaillés (la ligne entière noierait
 * l'information : 60 colonnes pour un RDV).
 */
export const AUDIT_INSERT_HIGHLIGHTS = {
  leads: ['status_id', 'source_id', 'assigned_user_id', 'appointment_date', 'client_id'],
  appointments: ['appointment_type', 'scheduled_date', 'scheduled_start', 'assigned_commercial_id', 'status'],
};

const ACTION_VERBS = { INSERT: 'Créé', UPDATE: 'Modifié', DELETE: 'Supprimé' };

// Familles de format par nom de colonne (communes aux deux tables).
const DATE_FIELDS = new Set([
  'appointment_date', 'quote_sent_date', 'won_date', 'next_action_date', 'created_date',
  'converted_date', 'estimated_date', 'planification_date', 'scheduled_date',
]);
const TIME_FIELDS = new Set(['scheduled_start', 'scheduled_end', 'announced_start']);
const TIMESTAMP_FIELDS = new Set([
  'last_call_date', 'last_followup_date', 'long_term_started_at', 'email_unsubscribed_at',
  'cancelled_at', 'completed_at', 'hour_confirmed_at', 'created_at', 'updated_at',
]);
const AMOUNT_FIELDS = new Set(['order_amount_ht', 'estimated_revenue', 'estimated_amount', 'final_amount']);
const PERCENT_FIELDS = new Set(['probability']);
const MINUTE_FIELDS = new Set(['duration_minutes', 'time_flex_minutes']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY = '—';
const MAX_TEXT = 120;
const MAX_JSON = 80;

// ----------------------------------------------------------------------------
// Formatage des valeurs
// ----------------------------------------------------------------------------

function formatDateFR(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}

function formatTimeFR(value) {
  const m = /^(\d{2}):(\d{2})/.exec(String(value));
  return m ? `${m[1]}:${m[2]}` : String(value);
}

function formatTimestampFR(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatEuro(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  // Espace simple pour les milliers (Intl insère U+202F, illisible dans certains rendus).
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ')} €`;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Formate une valeur brute d'audit pour l'affichage.
 * @param {string} table - 'leads' | 'appointments'
 * @param {string} field - nom de colonne
 * @param {*} value - valeur jsonb brute
 * @param {Record<string, Map<string, string>>} [resolvers] - `{ [field]: Map<id, libellé> }`
 * @returns {string}
 */
export function formatAuditValue(table, field, value, resolvers = {}) {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';

  const resolved = resolvers[field]?.get(String(value));
  if (resolved) return resolved;

  if (DATE_FIELDS.has(field)) return formatDateFR(value);
  if (TIME_FIELDS.has(field)) return formatTimeFR(value);
  if (TIMESTAMP_FIELDS.has(field)) return formatTimestampFR(value);
  if (AMOUNT_FIELDS.has(field)) return formatEuro(value);
  if (PERCENT_FIELDS.has(field)) return `${value} %`;
  if (MINUTE_FIELDS.has(field)) return `${value} min`;

  if (typeof value === 'object') return truncate(JSON.stringify(value), MAX_JSON);

  const text = String(value);
  if (UUID_RE.test(text)) return `${text.slice(0, 8)}…`;
  return truncate(text, MAX_TEXT);
}

/** Libellé FR d'une colonne (nom technique si inconnue). */
export function auditFieldLabel(table, field) {
  return AUDIT_FIELD_LABELS[table]?.[field] || field;
}

// ----------------------------------------------------------------------------
// Entrée de journal
// ----------------------------------------------------------------------------

function authorOf(row) {
  if (row.changed_by) return { author: row.changed_by_name || 'Utilisateur inconnu', isHuman: true };
  return { author: row.changed_by_role === 'service_role' ? 'Automatisation' : 'Système', isHuman: false };
}

/**
 * Transforme une ligne brute de `majordhome_audit_log` en entrée affichable.
 * @param {object} row - ligne de la vue
 * @param {{ resolvers?: Record<string, Map<string, string>> }} [options]
 * @returns {{ id: string, kind: 'audit', at: string, action: string, table: string, subject: string,
 *   author: string, isHuman: boolean, sourceLabel: string|null, title: string,
 *   changes: Array<{ field: string, label: string, from: string|null, to: string|null }> }}
 */
export function buildAuditEntry(row, { resolvers = {} } = {}) {
  const table = row.table_name;
  const { author, isHuman } = authorOf(row);
  const sourceLabel = row.source ? (AUDIT_SOURCE_LABELS[row.source] || row.source) : null;
  const verb = ACTION_VERBS[row.action] || 'Modifié';
  const title = `${verb} par ${author}${sourceLabel ? ` via ${sourceLabel}` : ''}`;

  let changes = [];
  if (row.action === 'UPDATE') {
    changes = (row.changed_fields || []).map((field) => ({
      field,
      label: auditFieldLabel(table, field),
      from: formatAuditValue(table, field, row.old_values?.[field], resolvers),
      to: formatAuditValue(table, field, row.new_values?.[field], resolvers),
    }));
  } else if (row.action === 'INSERT') {
    changes = (AUDIT_INSERT_HIGHLIGHTS[table] || [])
      .filter((field) => row.new_values?.[field] !== null && row.new_values?.[field] !== undefined)
      .map((field) => ({
        field,
        label: auditFieldLabel(table, field),
        from: null,
        to: formatAuditValue(table, field, row.new_values[field], resolvers),
      }));
  }

  return {
    id: `audit-${row.id}`,
    kind: 'audit',
    at: row.changed_at,
    action: row.action,
    table,
    subject: SUBJECTS[table] || table,
    author,
    isHuman,
    sourceLabel,
    title,
    changes,
  };
}

// ----------------------------------------------------------------------------
// Helpers d'intégration
// ----------------------------------------------------------------------------

/**
 * Construit un résolveur `Map<id, nom>` depuis une liste de référentiel, quelle
 * que soit sa forme (statuts `label`, sources `name`, commerciaux `full_name`,
 * membres d'équipe `display_name`).
 * @param {Array<object>} list
 * @param {string} [idKey='id']
 * @returns {Map<string, string>}
 */
export function toNameMap(list = [], idKey = 'id') {
  const map = new Map();
  for (const item of list) {
    const id = item?.[idKey];
    if (id === null || id === undefined) continue;
    const name = item.label ?? item.name ?? item.full_name ?? item.display_name ?? null;
    if (name) map.set(String(id), String(name));
  }
  return map;
}

/**
 * Fusionne les activités déclaratives (`lead_activities`) et les entrées
 * d'audit en une seule timeline, la plus récente en tête.
 * @param {Array<object>} activities - lignes de `majordhome_lead_activities`
 * @param {Array<object>} auditEntries - sorties de `buildAuditEntry`
 * @returns {Array<object>} entrées `{ kind: 'activity'|'audit', at, ... }`
 */
export function mergeTimeline(activities = [], auditEntries = []) {
  const acts = activities.map((a) => ({ ...a, kind: 'activity', at: a.created_at }));
  return [...acts, ...auditEntries].sort((a, b) => new Date(b.at) - new Date(a.at));
}
