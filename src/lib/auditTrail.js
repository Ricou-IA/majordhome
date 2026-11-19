/**
 * auditTrail.js — mise en forme du mouchard (journal d'audit des écritures)
 * ============================================================================
 * Module PUR (aucun import React / Supabase) — testé par
 * `node --test scripts/audit-trail.test.mjs`.
 *
 * Source : lignes de la vue `majordhome_audit_log`, écrites par le trigger
 * `majordhome.audit_row_change()` (migrations 20260916_3 puis 20261116_5). Une ligne =
 * une écriture sur `leads`, `appointments`, `chantiers`, et depuis le 2026-11-16 sur la
 * fiche client (`clients`, `equipments`, `contracts`, `contract_equipments`, puis
 * `interventions` le 2026-11-17 — rattachées par `client_id`) : QUI (`changed_by` = auth.uid() côté
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
    project_family_key: 'Projet',
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
    chantier_id: 'Chantier lié',
  },
  chantiers: {
    label: 'Libellé du chantier',
    chantier_id: 'Chantier lié',
  },
  clients: {
    first_name: 'Prénom',
    last_name: 'Nom',
    display_name: 'Nom affiché',
    company_name: 'Société',
    client_category: 'Catégorie',
    client_number: 'Numéro client',
    email: 'Email',
    phone: 'Téléphone',
    phone_secondary: 'Téléphone secondaire',
    address: 'Adresse',
    address_complement: 'Complément d’adresse',
    postal_code: 'Code postal',
    city: 'Ville',
    country: 'Pays',
    access_instructions: 'Instructions d’accès',
    housing_type: 'Type de logement',
    surface: 'Surface',
    floor_count: 'Nombre d’étages',
    construction_year: 'Année de construction',
    dpe_number: 'Numéro de DPE',
    dpe_rating: 'Étiquette DPE',
    lead_source: 'Source',
    tags: 'Étiquettes',
    is_reliable: 'Client fiable',
    notes: 'Notes',
    internal_notes: 'Notes internes',
    is_archived: 'Archivé',
    archived_at: 'Archivé le',
    siren: 'SIREN',
    owner_client_id: 'Propriétaire lié',
    mail_optin: 'Accepte les emails',
    sms_optin: 'Accepte les SMS',
    email_unsubscribed_at: 'Désabonnement email',
    email_unsubscribe_reason: 'Raison du désabonnement',
    parrain_id: 'Parrain',
    parrainage_code: 'Code de parrainage',
    auth_user_id: 'Compte du portail client',
    pennylane_account_number: 'Code comptable Pennylane',
    is_web_draft: 'Brouillon du site',
    import_source: 'Origine de l’import',
    project_id: 'Projet lié',
    created_by: 'Créé par',
  },
  equipments: {
    equipment_type_id: 'Type d’équipement',
    category_id: 'Catégorie',
    brand: 'Marque',
    model: 'Modèle',
    serial_number: 'Numéro de série',
    installation_year: 'Année d’installation',
    install_date: 'Date d’installation',
    installation_type: 'Type de pose',
    warranty_end_date: 'Fin de garantie',
    maintenance_frequency_months: 'Fréquence d’entretien (mois)',
    unit_count: 'Nombre d’unités',
    status: 'État',
    notes: 'Notes',
    supplier_product_id: 'Article du catalogue',
    equipment_model_id: 'Modèle fabricant',
    nameplate_photo_path: 'Photo de la plaque',
    metadata: 'Données de saisie',
    contract_status: 'Statut de contrat (ancien champ)',
    contract_type: 'Type de contrat (ancien champ)',
    contract_tarif: 'Tarif de contrat (ancien champ)',
    contract_start_date: 'Début de contrat (ancien champ)',
    project_id: 'Projet lié',
    created_by: 'Créé par',
  },
  contracts: {
    contract_number: 'Numéro de contrat',
    status: 'Statut',
    workflow_status: 'Étape de la proposition',
    frequency: 'Fréquence',
    start_date: 'Date de début',
    end_date: 'Date de fin',
    renewal_date: 'Date de renouvellement',
    next_maintenance_date: 'Prochain entretien',
    maintenance_month: 'Mois d’entretien',
    estimated_time: 'Temps estimé',
    amount: 'Montant',
    subtotal: 'Sous-total',
    discount_percent: 'Remise',
    exceptional_discount: 'Remise exceptionnelle',
    amount_forced: 'Montant forcé',
    zone_id: 'Zone tarifaire',
    source: 'Origine',
    notes: 'Notes',
    contract_pdf_path: 'PDF du contrat',
    signed_at: 'Signé le',
    signature_client_nom: 'Signataire',
    cancellation_reason: 'Motif de clôture',
    cancelled_at: 'Clos le',
    client_id: 'Client',
  },
  contract_equipments: {
    equipment_id: 'Équipement',
    contract_id: 'Contrat',
  },
  interventions: {
    intervention_type: 'Type',
    workflow_status: 'État',
    status: 'Statut technique',
    scheduled_date: 'Date prévue',
    scheduled_time_start: 'Heure de début',
    scheduled_time_end: 'Heure de fin',
    sav_description: 'Description',
    sav_urgency: 'Urgence',
    sav_origin: 'Origine',
    includes_entretien: 'Avec entretien',
    devis_amount: 'Montant du devis',
    devis_status: 'Devis',
    parts_order_status: 'Pièces',
    invoiced_at: 'Facturé le',
    invoice_id: 'Facture',
    is_billable: 'Facturable',
    planned_team_size: 'Personnes prévues',
    planned_days: 'Jours prévus',
    duration_minutes: 'Durée',
    report_date: 'Date du compte rendu',
    report_notes: 'Notes',
    work_performed: 'Travaux effectués',
    parts_replaced: 'Pièces remplacées',
    client_comment: 'Commentaire du client',
    technician_id: 'Technicien',
    technician_name: 'Technicien',
    equipment_id: 'Équipement',
    contract_id: 'Contrat',
    client_id: 'Client',
    lead_id: 'Lead lié',
    parent_id: 'Intervention parente',
    source_certificat_id: 'Certificat d’origine',
    signed_at: 'Signé le',
    signed_by_name: 'Signataire',
    signature_url: 'Signature',
    photo_before_url: 'Photo avant',
    photo_after_url: 'Photo après',
    photos_extra: 'Photos',
    slot_date: 'Créneau (date)',
    slot_start_time: 'Créneau (début)',
    slot_end_time: 'Créneau (fin)',
    slot_notes: 'Créneau (notes)',
    tags: 'Étiquettes',
    metadata: 'Données techniques',
    project_id: 'Projet lié',
    created_by: 'Créé par',
  },
};

/**
 * Chemin d'écriture (`source` = RPC ou vue racine de la requête) → libellé.
 * Un chemin inconnu est montré tel quel : mieux vaut un nom technique qu'un
 * « via inconnu » qui masque l'information.
 */
const AUDIT_SOURCE_LABELS = {
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
  auto_rdv_poser: 'prise de rendez-vous',
  meta_ads_backfill_lead_attribution: 'attribution Meta Ads',
  chantier_group: 'groupement de chantiers',
  chantier_detach: 'détachement de chantier',
  chantier_delete: 'suppression de chantier',
  chantier_ensure_for_lead: 'gain sans devis',
  majordhome_chantiers_write: 'fiche chantier',
  // Fiche client (20261116_5)
  majordhome_clients: 'fiche client',
  majordhome_clients_all: 'fiche client',
  majordhome_equipments: 'fiche équipement',
  majordhome_contracts: 'fiche contrat',
  majordhome_contracts_write: 'fiche contrat',
  majordhome_contract_equipments: 'équipements du contrat',
  client_set_location: 'adresse vérifiée',
  client_dpe_record: 'rattachement du DPE',
  client_hard_delete: 'suppression définitive',
  pennylane_sync_update_client_fields: 'synchro Pennylane',
  find_or_create_client: 'création automatique',
  process_web_entretien: 'site web',
  link_client_auth: 'portail client',
  mailing_apply_unsubscribe: 'désabonnement email',
  resend_apply_webhook_event: 'retour d’envoi email',
  equipment_model_merge: 'fusion de modèles d’appareil',
  equipment_models_close: 'relevé du fabricant',
  // Cartes Entretien / SAV (20261117_1)
  majordhome_interventions: 'fiche Entretien / SAV',
  sync_intervention_from_visit: 'visite d’entretien enregistrée',
  maintenance_visit_clear: 'visite d’entretien annulée',
  entretien_card_release_orphan: 'carte d’entretien libérée',
  contract_activation_promote_cards: 'activation du contrat',
  assign_pending_contract: 'rattachement du contrat',
  merge_dedup_pair: 'fusion de doublons',
};

/** Sujet affiché selon la table auditée. */
const SUBJECTS = {
  leads: 'Lead',
  appointments: 'RDV',
  chantiers: 'Chantier',
  clients: 'Fiche',
  equipments: 'Équipement',
  contracts: 'Contrat',
  contract_equipments: 'Contrat',
  interventions: 'Intervention',
};

/** Sujets féminins : « Fiche — Modifiée par… » (le verbe s'accorde). */
const FEMININE_TABLES = new Set(['clients', 'interventions']);

/**
 * Écritures qui se disent mieux autrement que « Créé / Supprimé » : le lien entre un
 * contrat et un équipement n'est pas un objet qu'on crée, c'est un équipement qui entre
 * au contrat ou qui en sort.
 */
const ACTION_TITLES = {
  contract_equipments: { INSERT: 'Équipement ajouté au contrat', DELETE: 'Équipement retiré du contrat' },
};

/**
 * À la création, seuls ces champs sont détaillés (la ligne entière noierait
 * l'information : 60 colonnes pour un RDV).
 */
const AUDIT_INSERT_HIGHLIGHTS = {
  leads: ['status_id', 'source_id', 'assigned_user_id', 'appointment_date', 'client_id'],
  appointments: ['appointment_type', 'scheduled_date', 'scheduled_start', 'assigned_commercial_id', 'status'],
  clients: ['last_name', 'first_name', 'company_name', 'city', 'lead_source'],
  equipments: ['equipment_type_id', 'brand', 'model', 'installation_year'],
  contracts: ['contract_number', 'status', 'amount', 'start_date'],
  contract_equipments: ['equipment_id'],
  interventions: ['workflow_status', 'scheduled_date', 'sav_urgency', 'sav_description', 'equipment_id'],
};

/**
 * À la suppression, ce qui permet de savoir CE qui a disparu (la ligne n'existe plus :
 * sans ces champs, « Supprimé par X » ne dit pas quoi).
 */
const AUDIT_DELETE_HIGHLIGHTS = {
  equipments: ['equipment_type_id', 'brand', 'model'],
  contracts: ['contract_number', 'amount'],
  contract_equipments: ['equipment_id'],
  interventions: ['workflow_status', 'scheduled_date', 'sav_description'],
};

const ACTION_VERBS = { INSERT: 'Créé', UPDATE: 'Modifié', DELETE: 'Supprimé' };

// Familles de format par nom de colonne (communes aux deux tables).
const DATE_FIELDS = new Set([
  'appointment_date', 'quote_sent_date', 'won_date', 'next_action_date', 'created_date',
  'converted_date', 'estimated_date', 'planification_date', 'scheduled_date',
  'start_date', 'end_date', 'renewal_date', 'next_maintenance_date', 'install_date',
  'warranty_end_date', 'contract_start_date', 'report_date', 'slot_date',
]);
const TIME_FIELDS = new Set([
  'scheduled_start', 'scheduled_end', 'announced_start',
  'scheduled_time_start', 'scheduled_time_end', 'slot_start_time', 'slot_end_time',
]);
const TIMESTAMP_FIELDS = new Set([
  'last_call_date', 'last_followup_date', 'long_term_started_at', 'email_unsubscribed_at',
  'cancelled_at', 'completed_at', 'hour_confirmed_at', 'created_at', 'updated_at',
  'archived_at', 'signed_at', 'invoiced_at',
]);
const AMOUNT_FIELDS = new Set([
  'order_amount_ht', 'estimated_revenue', 'estimated_amount', 'final_amount',
  'amount', 'subtotal', 'exceptional_discount', 'contract_tarif', 'devis_amount',
]);
const PERCENT_FIELDS = new Set(['probability', 'discount_percent']);
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
 * @param {Record<string, Map<string, string>>} [resolvers] - `{ [field]: Map<id, libellé> }` ;
 *   une clé `table.champ` prime sur `champ` (`status` n'a pas le même sens pour un RDV et un contrat)
 * @returns {string}
 */
export function formatAuditValue(table, field, value, resolvers = {}) {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';

  const resolved = (resolvers[`${table}.${field}`] || resolvers[field])?.get(String(value));
  if (resolved) return resolved;

  if (DATE_FIELDS.has(field)) return formatDateFR(value);
  if (TIME_FIELDS.has(field)) return formatTimeFR(value);
  if (TIMESTAMP_FIELDS.has(field)) return formatTimestampFR(value);
  if (AMOUNT_FIELDS.has(field)) return formatEuro(value);
  if (PERCENT_FIELDS.has(field)) return `${value} %`;
  if (MINUTE_FIELDS.has(field)) return `${value} min`;

  // Rapport d'intervention SAV : sa trace vit dans `interventions.metadata.rapport_sav` — dire ce
  // qui s'est passé plutôt qu'afficher le JSON (chemin du fichier, contenu saisi).
  if (table === 'interventions' && field === 'metadata' && typeof value === 'object' && value.rapport_sav) {
    const rapport = value.rapport_sav;
    return rapport.envoye_le ? `Rapport d’intervention envoyé à ${rapport.envoye_a || 'un client'}` : 'Rapport d’intervention édité';
  }

  if (typeof value === 'object') return truncate(JSON.stringify(value), MAX_JSON);

  const text = String(value);
  if (UUID_RE.test(text)) return `${text.slice(0, 8)}…`;
  return truncate(text, MAX_TEXT);
}

/** Libellé FR d'une colonne (nom technique si inconnue). */
function auditFieldLabel(table, field) {
  return AUDIT_FIELD_LABELS[table]?.[field] || field;
}

// ----------------------------------------------------------------------------
// Entrée de journal
// ----------------------------------------------------------------------------

/**
 * Auteur d'un RDV posé SANS humain connecté, lu dans `appointments.source` (gravé à la
 * création par auto_rdv_poser) : sans lui, la page client et l'agent téléphonique
 * apparaissent tous deux en « Automatisation » (Eric 2026-10-04 : savoir qui a posé le RDV,
 * humain ou agent, pour éviter les incompréhensions).
 */
const AUDIT_RDV_SOURCE_AUTHORS = {
  'auto_rdv:agent': 'l’agent téléphonique',
  'auto_rdv:client': 'le client (prise de RDV en ligne)',
  'auto_rdv:operateur': 'la prise de RDV en ligne (lien opérateur)',
};

function authorOf(row) {
  if (row.changed_by) return { author: row.changed_by_name || 'Utilisateur inconnu', isHuman: true };
  const rdvSource = row.table_name === 'appointments' && row.action === 'INSERT' ? row.new_values?.source : null;
  if (rdvSource && AUDIT_RDV_SOURCE_AUTHORS[rdvSource]) return { author: AUDIT_RDV_SOURCE_AUTHORS[rdvSource], isHuman: false };
  return { author: row.changed_by_role === 'service_role' ? 'Automatisation' : 'Système', isHuman: false };
}

/**
 * Transforme une ligne brute de `majordhome_audit_log` en entrée affichable.
 * @param {object} row - ligne de la vue
 * @param {{ resolvers?: Record<string, Map<string, string>>, subjectOf?: (row: object) => (string|null|undefined) }} [options]
 *   `subjectOf` : sujet affiché quand l'appelant sait mieux que la table (une intervention est un
 *   « SAV » ou un « Entretien ») ; valeur vide → sujet par défaut de la table.
 * @returns {{ id: string, kind: 'audit', at: string, action: string, table: string, subject: string,
 *   author: string, isHuman: boolean, sourceLabel: string|null, title: string,
 *   changes: Array<{ field: string, label: string, from: string|null, to: string|null }> }}
 */
export function buildAuditEntry(row, { resolvers = {}, subjectOf = null } = {}) {
  const table = row.table_name;
  const { author, isHuman } = authorOf(row);
  const sourceLabel = row.source ? (AUDIT_SOURCE_LABELS[row.source] || row.source) : null;
  const verb = ACTION_TITLES[table]?.[row.action]
    || `${ACTION_VERBS[row.action] || 'Modifié'}${FEMININE_TABLES.has(table) ? 'e' : ''}`;
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
  } else if (row.action === 'DELETE') {
    changes = (AUDIT_DELETE_HIGHLIGHTS[table] || [])
      .filter((field) => row.old_values?.[field] !== null && row.old_values?.[field] !== undefined)
      .map((field) => ({
        field,
        label: auditFieldLabel(table, field),
        from: null,
        to: formatAuditValue(table, field, row.old_values[field], resolvers),
      }));
  }

  return {
    id: `audit-${row.id}`,
    kind: 'audit',
    at: row.changed_at,
    action: row.action,
    table,
    subject: subjectOf?.(row) || SUBJECTS[table] || table,
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
 * Écriture mécanique, sans intérêt dans une Timeline : la création et la purge des lignes
 * ENFANTS d'un entretien (une par équipement, `parent_id` renseigné). Elles sont posées à la
 * planification et retirées à la déplanification — trois équipements, trois lignes « créée »
 * à chaque RDV posé. Le journal les garde (la base enregistre tout) ; l'écran les saute.
 * Leurs MODIFICATIONS, elles, restent affichées : c'est là qu'on lit qui a rempli un
 * certificat ou marqué un équipement « néant ».
 * @param {object} row - ligne de `majordhome_audit_log`
 * @returns {boolean}
 */
export function estEcritureMecanique(row) {
  if (row?.table_name !== 'interventions') return false;
  if (row.action === 'INSERT') return !!row.new_values?.parent_id;
  if (row.action === 'DELETE') return !!row.old_values?.parent_id;
  return false;
}

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

/**
 * Sujet d'une écriture sur `interventions` : « SAV », « Entretien », ou « Certificat » pour une
 * ligne enfant (un équipement d'un entretien). Une modification ne porte que les champs changés :
 * le type et le parent se lisent alors sur l'intervention connue de l'appelant (liste du client).
 * Rien de reconnaissable → null (le sujet par défaut « Intervention » s'applique).
 * @param {object} row - ligne de `majordhome_audit_log`
 * @param {{ intervention_type?: string, parent_id?: string|null }|null} [connue] - l'intervention, si elle existe encore
 * @param {string|null} [equipement] - libellé de l'équipement d'une ligne enfant
 * @returns {string|null}
 */
export function sujetIntervention(row, connue = null, equipement = null) {
  if (row?.table_name !== 'interventions') return null;
  const valeurs = row.new_values || row.old_values || {};
  const parent = connue?.parent_id ?? valeurs.parent_id ?? null;
  if (parent) return equipement ? `Certificat · ${equipement}` : 'Certificat';
  const type = connue?.intervention_type ?? valeurs.intervention_type ?? null;
  if (type === 'sav') return 'SAV';
  if (type === 'entretien' || type === 'maintenance') return 'Entretien';
  return null;
}
