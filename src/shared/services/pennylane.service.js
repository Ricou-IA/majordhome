/**
 * pennylane.service.js — Majord'home Artisan
 * ============================================================================
 * Service d'intégration Pennylane V2.
 * Toutes les requêtes passent par l'Edge Function pennylane-proxy
 * (le token API ne transite jamais côté client).
 *
 * Flow : Frontend → pennylane-proxy (Edge Function) → API Pennylane V2
 *
 * API V2 — conventions découvertes lors de l'audit (2026-04-12) :
 *   - Endpoint clients : /customers (PAS /company_customers — 404 en V2)
 *   - Pagination : { items, has_more, next_cursor } avec params limit + cursor
 *   - Page size : param `limit` (PAS `page_size` — ignoré)
 *   - Cursor : param `cursor` (PAS `page_after` — retourne la même page)
 *   - Writes clients : POST /customers OK, PUT/PATCH /customers/{id} = 404
 *     → les updates passent par V1 (nécessite scope customer_invoices)
 *   - Code comptable client : ledger_account.id sur le customer,
 *     puis GET /ledger_accounts/{id} → .number (ex: "411100078")
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

// ============================================================================
// CONSTANTES & MAPPINGS
// ============================================================================

const TVA_MAPPING = {
  20: 'FR_200',
  10: 'FR_100',
  5.5: 'FR_055',
  0: 'exempt',
};

const UNIT_MAPPING = {
  'pièce': 'piece',
  'h': 'hour',
  'forfait': 'flat_rate',
  'ml': 'meter',
  'm²': 'square_meter',
};

// ============================================================================
// PROXY CALL — point d'entrée unique vers Pennylane
// ============================================================================

/**
 * Appel à l'API Pennylane via le proxy Edge Function.
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path — chemin API (ex: '/quotes', '/customers')
 * @param {Object} [body] — corps de la requête (POST/PUT/PATCH)
 * @returns {Promise<any>} — données Pennylane (déjà dépaquetées du wrapper proxy)
 */
async function apiCall(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Non authentifié');

  const { data, error } = await supabase.functions.invoke('pennylane-proxy', {
    body: { method, path, body },
  });

  if (error) throw error;

  // Le proxy retourne { data, pennylane_status }
  if (data?.pennylane_status && data.pennylane_status >= 400) {
    const msg = data.data?.error || data.data?.message || `Pennylane error ${data.pennylane_status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  return data?.data;
}

// ============================================================================
// SYNC TABLE — helpers pour pennylane_sync
// ============================================================================

async function getSyncRecord(orgId, entityType, localId) {
  const { data, error } = await supabase
    .from('majordhome_pennylane_sync')
    .select('*')
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('local_id', localId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function upsertSyncRecord(record) {
  const { data, error } = await supabase
    .from('majordhome_pennylane_sync')
    .upsert(record, { onConflict: 'org_id,entity_type,local_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================================
// CLIENTS — sync vers Pennylane /customers (V2)
// ============================================================================

function buildPennylaneCustomer(client) {
  const address = [client.address, client.address_complement].filter(Boolean).join(', ');

  return {
    customer_type: client.client_category === 'entreprise' ? 'company' : 'individual',
    first_name: client.first_name || undefined,
    last_name: client.last_name || undefined,
    name: client.display_name || `${client.first_name || ''} ${client.last_name || ''}`.trim(),
    emails: client.email ? [client.email] : [],
    phone: client.phone || undefined,
    reference: client.client_number || undefined,
    reg_no: client.siren || undefined,
    billing_address: {
      address: address || undefined,
      postal_code: client.postal_code || undefined,
      city: client.city || undefined,
      country_alpha2: 'FR',
    },
  };
}

/**
 * Récupère le numéro de compte comptable 411 d'un client PL.
 * @param {number} ledgerAccountId — l'ID du ledger_account retourné par /customers
 * @returns {Promise<string|null>} — ex: "411100078"
 */
async function fetchLedgerAccountNumber(ledgerAccountId) {
  if (!ledgerAccountId) return null;
  try {
    const la = await apiCall('GET', `/ledger_accounts/${ledgerAccountId}`);
    return la?.number || null;
  } catch {
    return null;
  }
}

/**
 * Met à jour le pennylane_account_number sur le client MDH.
 */
async function updateClientAccountNumber(clientId, accountNumber) {
  if (!accountNumber) return;
  await supabase
    .from('majordhome_clients')
    .update({ pennylane_account_number: accountNumber })
    .eq('id', clientId);
}

/**
 * Sync un client vers Pennylane (create ou update).
 * Retourne le pennylane_id du customer.
 * Récupère et stocke le code comptable 411 automatiquement.
 */
async function syncClient(client, orgId) {
  // 1. Vérifier si déjà synchro
  const existing = await getSyncRecord(orgId, 'client', client.id);

  if (existing) {
    // Déjà mappé — on ne peut pas update via V2 (404 sur PUT/PATCH)
    // On met juste à jour le sync record
    await upsertSyncRecord({
      ...existing,
      last_synced_at: new Date().toISOString(),
      sync_status: 'synced',
      sync_error: null,
    });
    return existing.pennylane_id;
  }

  // 2. Tenter un match par email via V2
  if (client.email) {
    // V2 : pas de filtre email natif, on pagine et cherche
    // Optimisation : on check d'abord dans pennylane_sync (seedé par l'audit)
    const { data: existingByEmail } = await supabase
      .from('majordhome_pennylane_sync')
      .select('*')
      .eq('org_id', orgId)
      .eq('entity_type', 'client')
      .eq('local_id', client.id)
      .maybeSingle();

    if (existingByEmail) {
      return existingByEmail.pennylane_id;
    }
  }

  // 3. Créer dans Pennylane
  const payload = buildPennylaneCustomer(client);
  const created = await apiCall('POST', '/customers', payload);

  // 4. Récupérer le code comptable 411
  const accountNumber = await fetchLedgerAccountNumber(created.ledger_account?.id);

  // 5. Stocker le mapping + le 411
  await upsertSyncRecord({
    org_id: orgId,
    entity_type: 'client',
    local_id: client.id,
    pennylane_id: created.id,
    pennylane_number: accountNumber || null,
    external_reference: client.id,
    sync_status: 'synced',
  });

  // 6. Stocker le 411 sur le client MDH
  await updateClientAccountNumber(client.id, accountNumber);

  return created.id;
}

/**
 * Récupère le pennylane_id du client, en le créant si nécessaire.
 */
async function getOrCreateCustomer(client, orgId) {
  const existing = await getSyncRecord(orgId, 'client', client.id);
  if (existing?.pennylane_id) return existing.pennylane_id;
  return syncClient(client, orgId);
}

// ============================================================================
// DEVIS — push vers Pennylane quotes
// ============================================================================

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function buildPennylaneQuote(quote, lines, pennylaneCustomerId) {
  // Extraire les sections (lignes de type section_title)
  const sections = [];
  const invoiceLines = [];
  let currentSection = -1;

  for (const line of lines) {
    if (line.line_type === 'section_title') {
      sections.push({ label: line.designation });
      currentSection++;
      continue;
    }

    invoiceLines.push({
      label: line.designation,
      description: line.description || undefined,
      quantity: String(line.quantity),
      unit: UNIT_MAPPING[line.unit] || 'piece',
      raw_currency_unit_price: String(Number(line.unit_price_ht).toFixed(2)),
      vat_rate: TVA_MAPPING[line.tva_rate] || 'FR_200',
      section_rank: currentSection >= 0 ? currentSection : 0,
      ledger_account_id: line.ledger_account_pl_id || undefined,
      product_id: null,
    });
  }

  const result = {
    customer_id: pennylaneCustomerId,
    date: new Date().toISOString().split('T')[0],
    deadline: addDays(new Date(), quote.validity_days || 30).toISOString().split('T')[0],
    currency: 'EUR',
    language: 'fr_FR',
    external_reference: quote.id,
    pdf_invoice_subject: quote.subject || 'Devis',
  };

  if (sections.length > 0) {
    result.invoice_line_sections = sections;
  }
  if (invoiceLines.length > 0) {
    result.invoice_lines = invoiceLines;
  }

  // Remise globale
  if (quote.global_discount_percent && quote.global_discount_percent > 0) {
    result.discount = {
      type: 'relative',
      amount: String(Number(quote.global_discount_percent).toFixed(2)),
    };
  }

  return result;
}

/**
 * Pousse un devis vers Pennylane.
 * Sync le client au passage si nécessaire.
 *
 * @param {Object} quote — devis Majordhome
 * @param {Array} lines — lignes du devis (ordonnées par sort_order)
 * @param {Object} client — client lié au devis
 * @param {string} orgId — org_id core
 * @returns {Promise<{ pennylane_id, pennylane_number, url }>}
 */
async function pushQuote(quote, lines, client, orgId) {
  // 1. S'assurer que le client est synchro
  const pennylaneCustomerId = await getOrCreateCustomer(client, orgId);

  // 2. Vérifier si le devis est déjà synchro
  const existingSync = await getSyncRecord(orgId, 'quote', quote.id);

  // 3. Construire et envoyer
  const payload = buildPennylaneQuote(quote, lines, pennylaneCustomerId);

  let result;
  if (existingSync) {
    // Update du devis existant
    result = await apiCall('PUT', `/quotes/${existingSync.pennylane_id}`, payload);
  } else {
    // Création
    result = await apiCall('POST', '/quotes', payload);
  }

  // 4. Sauvegarder le mapping
  const syncRecord = await upsertSyncRecord({
    org_id: orgId,
    entity_type: 'quote',
    local_id: quote.id,
    pennylane_id: result.id,
    pennylane_number: result.quote_number || null,
    external_reference: quote.id,
    sync_status: 'synced',
    sync_error: null,
    metadata: {
      public_url: result.public_url || null,
      status: result.status || null,
    },
  });

  return {
    pennylane_id: result.id,
    pennylane_number: result.quote_number,
    url: result.public_url || null,
    syncRecord,
  };
}

// ============================================================================
// DEVIS PL — fetch depuis Pennylane /quotes
// ============================================================================

/**
 * Récupère les devis Pennylane d'un client via le proxy.
 * Lookup pennylane_sync pour trouver le pennylane_id du client,
 * puis GET /quotes?customer_id={pennylane_id}.
 *
 * @param {string} clientId — UUID MDH du client
 * @param {string} orgId — org_id core
 * @returns {Promise<Array>} — devis PL formatés
 */
async function getQuotesByClient(clientId, orgId) {
  // 1. Trouver le pennylane_id via le mapping sync
  const syncRecord = await getSyncRecord(orgId, 'client', clientId);
  if (!syncRecord?.pennylane_id) return [];

  const plCustomerId = syncRecord.pennylane_id;

  // 2. Fetch TOUS les devis PL (l'API V2 ignore le filtre customer_id)
  //    puis filtrer cote client par customer.id
  const allQuotes = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    let path = '/quotes?limit=100';
    if (cursor) path += `&cursor=${cursor}`;
    const result = await apiCall('GET', path);
    const items = result?.items || [];
    allQuotes.push(...items);
    hasMore = result?.has_more && !!result?.next_cursor;
    cursor = result?.next_cursor || null;
  }

  // 3. Filtrer par customer.id
  const clientQuotes = allQuotes.filter(q => q.customer?.id === plCustomerId);

  // 4. Formater pour l'affichage
  return clientQuotes.map(q => ({
    id: q.id,
    quote_number: q.quote_number || q.label || null,
    label: q.label || null,
    subject: q.pdf_invoice_subject || null,
    date: q.date || null,
    deadline: q.deadline || null,
    amount_ht: q.currency_amount_before_tax || null,
    amount_ttc: q.amount || q.currency_amount || null,
    tax: q.tax || q.currency_tax || null,
    status: q.status || null,
    pdf_url: q.public_file_url || null,
    linked_invoices: q.linked_invoices || null,
  }));
}

// ============================================================================
// FACTURES — pull depuis Pennylane customer_invoices
// ============================================================================

/**
 * Récupère les factures depuis Pennylane pour un org_id.
 * API V2 : { items, has_more, next_cursor } avec param `limit` + `cursor`
 * @param {string} orgId
 * @param {string} [since] — date ISO pour filtre updated_at (optionnel)
 */
async function pullInvoices(orgId, since) {
  let path = '/customer_invoices?limit=100';
  if (since) {
    path += `&filter[updated_at][gte]=${since}`;
  }

  const result = await apiCall('GET', path);
  const invoices = result?.items || result?.data || result || [];

  // Pour chaque facture avec external_reference matchant un UUID local
  const synced = [];
  for (const inv of invoices) {
    if (!inv.external_reference) continue;

    // Vérifier si le quote lié existe dans notre sync
    const quoteSync = await getSyncRecord(orgId, 'quote', inv.external_reference);
    if (!quoteSync) continue;

    // Upsert le mapping facture
    const record = await upsertSyncRecord({
      org_id: orgId,
      entity_type: 'invoice',
      local_id: inv.external_reference, // on lie à l'ID local du devis
      pennylane_id: inv.id,
      pennylane_number: inv.invoice_number || null,
      sync_status: 'synced',
      metadata: {
        public_url: inv.public_url || null,
        status: inv.status || null,
        paid: inv.paid || false,
        amount_ttc: inv.amount || null,
        remaining_amount: inv.remaining_amount || null,
        invoice_date: inv.date || null,
      },
    });

    synced.push(record);
  }

  return synced;
}

/**
 * Récupère les factures Pennylane d'un client via le proxy (fetch live).
 * Même logique que getQuotesByClient : lookup sync → fetch all → filter.
 *
 * @param {string} clientId — UUID MDH du client
 * @param {string} orgId — org_id core
 * @returns {Promise<Array>} — factures PL formatées
 */
async function getInvoicesByClient(clientId, orgId) {
  // 1. Trouver le pennylane_id via le mapping sync
  const syncRecord = await getSyncRecord(orgId, 'client', clientId);
  if (!syncRecord?.pennylane_id) return [];

  const plCustomerId = syncRecord.pennylane_id;

  // 2. Fetch toutes les factures PL (l'API V2 ignore le filtre customer_id)
  //    puis filtrer côté client par customer.id
  const allInvoices = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    let path = '/customer_invoices?limit=100';
    if (cursor) path += `&cursor=${cursor}`;
    const result = await apiCall('GET', path);
    const items = result?.items || [];
    allInvoices.push(...items);
    hasMore = result?.has_more && !!result?.next_cursor;
    cursor = result?.next_cursor || null;
  }

  // 3. Filtrer par customer.id
  const clientInvoices = allInvoices.filter(inv => inv.customer?.id === plCustomerId);

  // 4. Formater pour l'affichage
  return clientInvoices.map(inv => ({
    id: inv.id,
    invoice_number: inv.invoice_number || inv.label || null,
    label: inv.label || null,
    subject: inv.pdf_invoice_subject || null,
    date: inv.date || null,
    due_date: inv.deadline || inv.due_date || null,
    amount_ht: inv.currency_amount_before_tax || null,
    amount_ttc: inv.amount || inv.currency_amount || null,
    tax: inv.tax || inv.currency_tax || null,
    status: inv.status || null,
    paid: inv.paid || false,
    remaining_amount: inv.remaining_amount || null,
    pdf_url: inv.public_file_url || null,
    quote_id: inv.quote?.id || null,
    quote_number: inv.special_mention?.match(/devis\s+(?:numéro\s+)?([A-Z]-[\d-]+)/i)?.[1] || null,
  }));
}

// ============================================================================
// CONFIG — comptes comptables (ledger_accounts)
// ============================================================================

/**
 * Récupère la liste des comptes comptables de vente (706xxx) depuis Pennylane.
 * API V2 : param `limit` (pas `page_size`)
 */
async function getLedgerAccounts() {
  const result = await apiCall('GET', '/ledger_accounts?filter[number][start_with]=706&filter[enabled][eq]=true&limit=100');
  return result?.items || result?.data || result || [];
}

// ============================================================================
// EXPORT
// ============================================================================

export const pennylaneService = {
  // Proxy
  apiCall,

  // Clients
  syncClient: (client, orgId) => withErrorHandling(() => syncClient(client, orgId), 'pennylane.syncClient'),
  getOrCreateCustomer: (client, orgId) => withErrorHandling(() => getOrCreateCustomer(client, orgId), 'pennylane.getOrCreateCustomer'),
  fetchLedgerAccountNumber: (ledgerAccountId) => withErrorHandling(() => fetchLedgerAccountNumber(ledgerAccountId), 'pennylane.fetchLedgerAccountNumber'),

  // Devis
  pushQuote: (quote, lines, client, orgId) => withErrorHandling(() => pushQuote(quote, lines, client, orgId), 'pennylane.pushQuote'),
  getQuotesByClient: (clientId, orgId) => withErrorHandling(() => getQuotesByClient(clientId, orgId), 'pennylane.getQuotesByClient'),

  // Factures
  pullInvoices: (orgId, since) => withErrorHandling(() => pullInvoices(orgId, since), 'pennylane.pullInvoices'),
  getInvoicesByClient: (clientId, orgId) => withErrorHandling(() => getInvoicesByClient(clientId, orgId), 'pennylane.getInvoicesByClient'),

  // Config
  getLedgerAccounts: () => withErrorHandling(() => getLedgerAccounts(), 'pennylane.getLedgerAccounts'),

  // Sync table
  getSyncRecord: (orgId, entityType, localId) => withErrorHandling(() => getSyncRecord(orgId, entityType, localId), 'pennylane.getSyncRecord'),

  // Mappings (exportés pour usage externe)
  TVA_MAPPING,
  UNIT_MAPPING,
};
