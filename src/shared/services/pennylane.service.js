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
import { cleanPhone } from '@/lib/phoneUtils';
import { logger } from '@/lib/logger';

// ============================================================================
// CONCURRENCY LIMIT — helper interne sans dépendance
// ============================================================================
// Pennylane rate limit : 25 req / 5s. Lancer 30+ fetch /customers/{id} en
// parallèle illimité sature le proxy → 429 retry interne → 500 remontés
// côté front. Toujours wrapper les batches PL avec pLimit(5).
// ============================================================================

function pLimit(concurrency) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(
        (val) => { active--; resolve(val); next(); },
        (err) => { active--; reject(err); next(); },
      );
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

// ============================================================================
// CONSTANTES & MAPPINGS
// ============================================================================

const TVA_MAPPING = {
  20: 'FR_200',
  10: 'FR_100',
  5.5: 'FR_055',
  0: 'exempt',
};

const VAT_RATE_REVERSE = {
  FR_200: 20,
  FR_100: 10,
  FR_055: 5.5,
  exempt: 0,
};

function parseVatRate(plRate) {
  if (plRate == null) return null;
  if (typeof plRate === 'number') return plRate;
  return VAT_RATE_REVERSE[plRate] ?? null;
}

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
 * Construit un display name défensif depuis un objet customer Pennylane V2.
 * Particulier : "first_name last_name". Entreprise : "name" (raison sociale).
 * @param {object|null|undefined} customer
 * @returns {string|null}
 */
function formatPennylaneCustomerName(customer) {
  if (!customer) return null;
  const fn = (customer.first_name || '').trim();
  const ln = (customer.last_name || '').trim();
  const full = [fn, ln].filter(Boolean).join(' ');
  if (full) return full;
  const name = (customer.name || '').trim();
  return name || null;
}

/**
 * Fetch /customers/{id} en parallèle pour chaque ID unique. Retourne le
 * customer COMPLET (pas juste le name) afin de pouvoir matcher email/phone
 * dans le fuzzy matching de suggestions.
 *
 * @param {Array<number|string>} customerIds
 * @returns {Promise<Map<string, object>>} Map de string(id) → customer
 */
async function fetchCustomersByIds(customerIds) {
  const uniqueIds = Array.from(
    new Set((customerIds || []).filter(Boolean).map(id => String(id)))
  );
  if (uniqueIds.length === 0) return new Map();

  // Concurrency cap : Pennylane rate limit 25 req/5s. Au-delà → 429 → proxy 500.
  const limit = pLimit(5);
  const results = await Promise.allSettled(
    uniqueIds.map(id => limit(() => apiCall('GET', `/customers/${id}`)))
  );

  const map = new Map();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      map.set(uniqueIds[i], r.value);
    }
  });
  return map;
}

/**
 * Extracteurs défensifs sur le payload customer V2 (multi-shape).
 */
function extractCustomerEmail(c) {
  if (!c) return null;
  if (typeof c.billing_email === 'string' && c.billing_email) return c.billing_email;
  if (typeof c.email === 'string' && c.email) return c.email;
  if (Array.isArray(c.emails) && c.emails[0]) {
    const first = c.emails[0];
    return typeof first === 'string' ? first : first.email || first.address || null;
  }
  return null;
}

function extractCustomerPhone(c) {
  if (!c) return null;
  return c.phone || c.billing_phone || c.mobile || null;
}

/**
 * Extrait { firstName, lastName, fullName } depuis un customer PL multi-shape.
 * Supporte les individuals (first_name/last_name) et fallback sur `name` global.
 */
function extractCustomerName(c) {
  if (!c) return { firstName: null, lastName: null, fullName: null };
  const firstName = c.first_name || c.firstName || null;
  const lastName = c.last_name || c.lastName || null;
  const fullName = c.name || c.label || (firstName && lastName ? `${firstName} ${lastName}` : null);
  return { firstName, lastName, fullName };
}

/**
 * Normalise un nom pour comparaison fuzzy : NFD + strip diacritics + lowercase + trim
 * + collapse multiple spaces. Retourne null si vide.
 */
function normalizeName(s) {
  if (!s || typeof s !== 'string') return null;
  const cleaned = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

/**
 * Fetch /quotes/{id} en parallèle pour récupérer les quote_number (D-YYYY-XXXX)
 * qui ne sont PAS stockés en DB (`quote_label` peut contenir le subject à la
 * place du numéro, héritage des premiers attachements).
 *
 * @param {Array<number|string>} quoteIds
 * @returns {Promise<Map<string, string>>} Map de string(id) → quote_number
 */
async function fetchQuoteNumbersByIds(quoteIds) {
  const uniqueIds = Array.from(
    new Set((quoteIds || []).filter(Boolean).map(id => String(id)))
  );
  if (uniqueIds.length === 0) return new Map();

  const limit = pLimit(5);
  const results = await Promise.allSettled(
    uniqueIds.map(id => limit(() => apiCall('GET', `/quotes/${id}`)))
  );

  const map = new Map();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      const num = r.value.quote_number || r.value.label || null;
      if (num) map.set(uniqueIds[i], num);
    }
  });
  return map;
}

/**
 * Wrapper sur fetchCustomersByIds pour la rétro-compat des consumers qui
 * n'ont besoin que du display name.
 *
 * @param {Array<number|string>} customerIds
 * @returns {Promise<Map<string, string>>} Map de string(id) → name
 */
async function fetchCustomerNamesByIds(customerIds) {
  const customers = await fetchCustomersByIds(customerIds);
  const names = new Map();
  customers.forEach((c, id) => {
    const name = formatPennylaneCustomerName(c);
    if (name) names.set(id, name);
  });
  return names;
}

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

  // 2. Fetch les devis PL paginés (l'API V2 ne supporte pas filter[customer_id]
  //    → renvoie 400) + safety MAX_PAGES pour éviter timeout edge function (~50s).
  //    Filtre côté client par customer.id.
  const allQuotes = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;
  const MAX_PAGES = 10;

  while (hasMore && pageCount < MAX_PAGES) {
    let path = '/quotes?limit=100';
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    const result = await apiCall('GET', path);
    const items = result?.items || [];
    allQuotes.push(...items);
    hasMore = result?.has_more && !!result?.next_cursor;
    cursor = result?.next_cursor || null;
    pageCount++;
  }

  if (pageCount === MAX_PAGES && hasMore) {
    console.warn(
      `[pennylane.getQuotesByClient] reached MAX_PAGES=${MAX_PAGES}, some quotes may be missing for plCustomerId=${plCustomerId}`,
    );
  }

  // 3. Filtrer par customer.id côté client
  const clientQuotes = allQuotes.filter(q => q.customer?.id === plCustomerId);

  // 4. Enrichir avec customer_name via /customers/{id} (1 seul appel : même customer)
  const namesById = await fetchCustomerNamesByIds([plCustomerId]);
  const customerName = namesById.get(String(plCustomerId)) || null;

  // 5. Formater pour l'affichage
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
    customer_id: q.customer?.id || null,
    customer_name: formatPennylaneCustomerName(q.customer) || customerName,
  }));
}

/**
 * Extrait un array depuis une valeur Pennylane V2 qui peut être :
 *  - un array brut [...]
 *  - un wrapper paginé { items: [...], has_more, next_cursor }
 *  - null/undefined/autre → []
 */
function extractList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data)) return value.data;
  return [];
}

async function fetchQuoteSubResource(pennylaneQuoteId, subPath) {
  const all = [];
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const path = `/quotes/${pennylaneQuoteId}/${subPath}${qs}`;
    const result = await apiCall('GET', path);
    const items = extractList(result);
    all.push(...items);
    hasMore = !!result?.has_more && !!result?.next_cursor;
    cursor = result?.next_cursor || null;
  }
  return all;
}

function formatQuoteLine(l) {
  return {
    id: l.id,
    label: l.label || '',
    description: l.description || null,
    quantity: Number(l.quantity ?? 0),
    unit: l.unit || 'piece',
    unit_price_ht: Number(l.raw_currency_unit_price ?? l.unit_price ?? 0),
    vat_rate: parseVatRate(l.vat_rate),
    amount_ht: Number(l.currency_amount_before_tax ?? 0),
    amount_ttc: Number(l.currency_amount ?? l.amount ?? 0),
    section_rank: l.section_rank ?? null,
    ledger_account_id: l.ledger_account_id ?? l.ledger_account?.id ?? null,
  };
}

function formatQuoteSection(s, idx) {
  return {
    rank: s.rank ?? idx,
    label: s.label || '',
  };
}

/**
 * Récupère les lignes d'un devis Pennylane (par pennylane_id du devis).
 * Appelle GET /quotes/{id} pour les métadonnées, et fallback sur les
 * sub-resources /invoice_lines + /invoice_line_sections si les listes
 * ne sont pas embarquées dans le quote.
 *
 * @param {number|string} pennylaneQuoteId — pennylane_id du devis
 * @returns {Promise<{ quote, sections, lines }>}
 */
async function getQuoteLines(pennylaneQuoteId) {
  if (!pennylaneQuoteId) return { quote: null, sections: [], lines: [] };

  // 3 appels en parallèle : quote (métadonnées) + lignes + sections
  // Pennylane V2 ne renvoie pas les lignes dans /quotes/{id}, donc on hit
  // directement les sub-resources sans attendre la métadonnée.
  const [quote, linesResult, sectionsResult] = await Promise.all([
    apiCall('GET', `/quotes/${pennylaneQuoteId}`),
    fetchQuoteSubResource(pennylaneQuoteId, 'invoice_lines').catch(() => []),
    fetchQuoteSubResource(pennylaneQuoteId, 'invoice_line_sections').catch(() => []),
  ]);

  if (!quote) return { quote: null, sections: [], lines: [] };

  // Si les sub-resources renvoient vides, fallback sur le payload du quote
  // (au cas où une autre version de l'API V2 embedde les lignes)
  const rawLines = linesResult.length > 0
    ? linesResult
    : extractList(quote.invoice_lines).concat(
        extractList(quote.lines),
        extractList(quote.items),
      );

  const rawSections = sectionsResult.length > 0
    ? sectionsResult
    : extractList(quote.invoice_line_sections).concat(
        extractList(quote.sections),
      );

  return {
    quote: {
      id: quote.id,
      quote_number: quote.quote_number || quote.label || null,
      label: quote.label || null,
      subject: quote.pdf_invoice_subject || null,
      date: quote.date || null,
      deadline: quote.deadline || null,
      status: quote.status || null,
      pdf_url: quote.public_file_url || null,
      amount_ht: quote.currency_amount_before_tax || null,
      amount_ttc: quote.amount || quote.currency_amount || null,
      tax: quote.tax || quote.currency_tax || null,
      customer_id: quote.customer?.id || null,
    },
    sections: rawSections.map(formatQuoteSection),
    lines: rawLines.map(formatQuoteLine),
  };
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

  // 2. Fetch les factures PL paginées (l'API V2 ne supporte pas filter[customer_id]
  //    → renvoie 400) + safety MAX_PAGES pour éviter timeout edge function.
  //    Filtre côté client par customer.id.
  const allInvoices = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;
  const MAX_PAGES = 10;

  while (hasMore && pageCount < MAX_PAGES) {
    let path = '/customer_invoices?limit=100';
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    const result = await apiCall('GET', path);
    const items = result?.items || [];
    allInvoices.push(...items);
    hasMore = result?.has_more && !!result?.next_cursor;
    cursor = result?.next_cursor || null;
    pageCount++;
  }

  if (pageCount === MAX_PAGES && hasMore) {
    console.warn(
      `[pennylane.getInvoicesByClient] reached MAX_PAGES=${MAX_PAGES}, some invoices may be missing for plCustomerId=${plCustomerId}`,
    );
  }

  // 3. Filtrer par customer.id côté client
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
// LIAISON LEAD ↔ DEVIS PENNYLANE (multi-devis par chantier)
// ============================================================================

/**
 * Liste les devis Pennylane liés à un lead (chantier), actifs uniquement.
 * Triés par date de devis desc (le plus récent en haut).
 */
async function getLinkedQuotesByLead(leadId) {
  const { data, error } = await supabase
    .from('majordhome_lead_pennylane_quotes')
    .select('id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, assigned_at')
    .eq('lead_id', leadId)
    .is('ejected_at', null)
    .order('quote_date', { ascending: false, nullsFirst: false })
    .order('assigned_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];

  // Enrichir avec quote_number PL (D-YYYY-XXXX) — quote_label peut contenir
  // le subject à la place du numéro selon l'origine du rattachement.
  if (rows.length > 0) {
    const ids = rows.map(r => r.pennylane_quote_id).filter(Boolean);
    const numbersById = await fetchQuoteNumbersByIds(ids);
    return rows.map(r => ({
      ...r,
      quote_number_pl: r.pennylane_quote_id
        ? numbersById.get(String(r.pennylane_quote_id)) || null
        : null,
    }));
  }
  return rows;
}

/**
 * Lie un devis Pennylane à un lead via la RPC SECURITY DEFINER.
 * @param {string} orgId
 * @param {number|string} pennylaneQuoteId — id PL (bigint)
 * @param {string} leadId
 * @param {object} [quoteData] — métadonnées (label, amount_ht, date, status, customer_id)
 * @returns {Promise<object>} action: 'inserted' | 'already_assigned' | 'moved'
 */
async function assignQuoteToLead(orgId, pennylaneQuoteId, leadId, quoteData = null) {
  const { data, error } = await supabase.rpc('assign_pennylane_quote_to_lead', {
    p_org_id: orgId,
    p_quote_pl_id: Number(pennylaneQuoteId),
    p_target_lead_id: leadId,
    p_quote_data: quoteData,
  });
  if (error) throw error;
  return data;
}

// ============================================================================
// BRIDGE PIPELINE ↔ PENNYLANE (spec 2026-05-23 §8)
// ============================================================================

/**
 * Normalise un téléphone pour comparaison stricte (digits uniquement).
 * Sert au matching fuzzy téléphone — `cleanPhone()` conserve les espaces,
 * ici on veut une clé de comparaison pure.
 * @param {string|null|undefined} phone
 * @returns {string|null} digits only, ou null si vide
 */
function phoneDigits(phone) {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return null;
  const digits = cleaned.replace(/\D/g, '');
  return digits || null;
}

/**
 * Récupère TOUS les devis PL d'un customer (sans fenêtre temporelle).
 *
 * Stratégie :
 *   1. Tentative API V2 filter natif : `?filter=[{"field":"customer_id","operator":"eq","value":X}]`
 *      → 1-few requêtes paginées, sans scan global
 *   2. Fallback si le filter renvoie 400 (syntaxe rejetée, doc API évolue) :
 *      pagine all + filter côté client par `q.customer.id` (scan exhaustif).
 *
 * Adresse bug #4 (SYLVIE ANE) : avant ce helper, getCandidateQuotesForLead
 * limitait à une fenêtre 30j tronquant les devis anciens d'un client bridgé.
 *
 * @param {number|string} customerPlId
 * @returns {Promise<Array>} devis PL bruts (pas formatés)
 */
async function fetchQuotesForCustomerId(customerPlId) {
  if (!customerPlId) return [];

  const filterParam = encodeURIComponent(
    JSON.stringify([{ field: 'customer_id', operator: 'eq', value: Number(customerPlId) }])
  );

  try {
    const collected = [];
    let cursor = null;
    let hasMore = true;
    let pageCount = 0;
    const MAX_PAGES = 5;
    while (hasMore && pageCount < MAX_PAGES) {
      let path = `/quotes?limit=100&filter=${filterParam}`;
      if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
      const result = await apiCall('GET', path);
      const items = result?.items || [];
      collected.push(...items);
      hasMore = result?.has_more && !!result?.next_cursor;
      cursor = result?.next_cursor || null;
      pageCount++;
    }
    return collected;
  } catch (err) {
    logger.warn(
      '[pennylane.fetchQuotesForCustomerId] filter natif échoué, fallback scan paginé',
      err?.message || err,
    );
    // Fallback exhaustif : pagine all puis filter côté client.
    const collected = [];
    let cursor = null;
    let hasMore = true;
    let pageCount = 0;
    const MAX_PAGES = 10;
    const targetId = Number(customerPlId);
    while (hasMore && pageCount < MAX_PAGES) {
      let path = '/quotes?limit=100';
      if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
      const result = await apiCall('GET', path);
      const items = result?.items || [];
      collected.push(...items.filter(q => q.customer?.id === targetId));
      hasMore = result?.has_more && !!result?.next_cursor;
      cursor = result?.next_cursor || null;
      pageCount++;
    }
    return collected;
  }
}

/**
 * Récupère les devis PL candidats à un lead via matching direct lead ↔ customer
 * Pennylane (sans dépendre du mapping pennylane_sync ou des clients MDH).
 *
 * Stratégie de fetch (depuis bridge prioritaire — commit fix bug #4) :
 *   - Si `bridgeCustomerId` résolu (lead.client_id → pennylane_sync) :
 *     fetch direct via fetchQuotesForCustomerId(bridgeCustomerId) — TOUS les
 *     devis du customer, SANS fenêtre temporelle (devis anciens compris).
 *   - Sinon (ou en complément si lead a email/phone pour matcher d'autres
 *     customers) : scan paginé /quotes par date desc avec fenêtre sinceDays.
 *   - Dedup par q.id (un devis bridgé peut tomber dans le scan).
 *
 * Matchers déclaratifs :
 *   - 'pennylane_sync' : customer PL mappé via pennylane_sync (bridge fort)
 *   - 'email' : customer.billing_email/emails match lead.email
 *   - 'phone' : customer.phone match lead.phone (digits-only)
 *   - 'name' : (first+last) ou fullName match (NFD-stripped, case insensitive)
 *
 * Garde seulement les devis avec >=1 signal, exclut ceux rattachés à un
 * AUTRE lead actif.
 *
 * Coût (post-optim commit perf + bridge) :
 *   - Lead bridgé sans email/phone : 1 requête /quotes filter → ~200ms
 *   - Lead non-bridgé avec email : 1-3 pages /quotes + pLimit(5) fetch customers
 *   - Lead bridgé + email : 1 requête filter + 1-3 pages scan
 *
 * @param {string} leadId
 * @param {string} orgId
 * @param {object} [opts]
 * @param {number} [opts.sinceDays=30] — fenêtre du scan paginé (ignore pour bridge)
 * @param {number} [opts.maxQuotes=200] — cap pour éviter timeout edge function
 * @returns {Promise<Array<{quote, signals: string[], alreadyAttached: boolean}>>}
 */
async function getCandidateQuotesForLead(leadId, orgId, { sinceDays = 30, maxQuotes = 200 } = {}) {
  if (!leadId || !orgId) return [];

  // 1. Charger le lead (email, phone, client_id) — via la vue publique
  // (le schema 'majordhome' n'est PAS exposé via PostgREST, .schema() donne 406)
  const { data: lead, error: leadErr } = await supabase
    .from('majordhome_leads')
    .select('id, email, phone, client_id, first_name, last_name')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return [];

  // Normalise une fois les champs du lead (réutilisés pour chaque devis)
  const leadNorm = {
    email: lead.email ? lead.email.trim().toLowerCase() : null,
    phone: phoneDigits(lead.phone),
    firstName: normalizeName(lead.first_name),
    lastName: normalizeName(lead.last_name),
  };

  // 2. Récupérer le pennylane_customer_id qui mapperait lead.client_id (signal fort)
  let bridgeCustomerId = null;
  if (lead.client_id) {
    const { data: syncRow } = await supabase
      .from('majordhome_pennylane_sync')
      .select('pennylane_id')
      .eq('org_id', orgId)
      .eq('entity_type', 'client')
      .eq('local_id', lead.client_id)
      .maybeSingle();
    bridgeCustomerId = syncRow?.pennylane_id || null;
  }

  // Matchers déclaratifs (ordre = priorité d'affichage des chips côté UI).
  // Ajouter un signal = ajouter 1 entrée + 1 chip dans QuoteCandidatesModal.SIGNAL_CONFIG.
  const matchers = [
    {
      name: 'pennylane_sync',
      check: ({ customerKey }) =>
        bridgeCustomerId && String(bridgeCustomerId) === customerKey,
    },
    {
      name: 'email',
      check: ({ customer }) => {
        if (!leadNorm.email || !customer) return false;
        const custEmail = extractCustomerEmail(customer);
        return custEmail && custEmail.trim().toLowerCase() === leadNorm.email;
      },
    },
    {
      name: 'phone',
      check: ({ customer }) => {
        if (!leadNorm.phone || !customer) return false;
        const custPhone = phoneDigits(extractCustomerPhone(customer));
        return custPhone && custPhone === leadNorm.phone;
      },
    },
    {
      name: 'name',
      check: ({ customer }) => {
        if (!leadNorm.firstName || !leadNorm.lastName || !customer) return false;
        const { firstName, lastName, fullName } = extractCustomerName(customer);
        const custFirst = normalizeName(firstName);
        const custLast = normalizeName(lastName);
        const custFull = normalizeName(fullName);
        // Strict : (first, last) exactement égaux, OU fallback : fullName contient les deux
        const strictMatch = custFirst === leadNorm.firstName && custLast === leadNorm.lastName;
        const fullNameMatch = custFull
          && custFull.includes(leadNorm.firstName)
          && custFull.includes(leadNorm.lastName);
        return strictMatch || fullNameMatch;
      },
    },
  ];

  // 3. Liste des rattachements actifs (exclusion + flag)
  const { data: existingLinks } = await supabase
    .from('majordhome_lead_pennylane_quotes')
    .select('pennylane_quote_id, lead_id')
    .eq('org_id', orgId)
    .is('ejected_at', null);
  const attachedToOtherLead = new Set();
  const attachedToThisLead = new Set();
  (existingLinks || []).forEach(link => {
    if (link.lead_id === leadId) attachedToThisLead.add(link.pennylane_quote_id);
    else attachedToOtherLead.add(link.pennylane_quote_id);
  });

  // 4. Fetch devis PL — stratégie selon bridge :
  //   - Bridge présent → 1 appel direct via filter customer_id (SANS fenêtre
  //     temporelle, fix bug #4 SYLVIE ANE où les devis anciens étaient ignorés)
  //   - Scan paginé par date desc ajouté SEULEMENT si pas de bridge ou si
  //     le lead a email/phone (sinon les autres matchers n'ont rien à matcher)
  //   - Dedup par q.id (un devis bridgé peut aussi tomber dans le scan)
  const quotesById = new Map();

  if (bridgeCustomerId) {
    const bridgeQuotes = await fetchQuotesForCustomerId(bridgeCustomerId);
    bridgeQuotes.forEach(q => quotesById.set(q.id, q));
  }

  const needsRecentScan = !bridgeCustomerId || !!(leadNorm.email || leadNorm.phone);
  if (needsRecentScan) {
    const cutoffMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    let cursor = null;
    let hasMore = true;
    let pageCount = 0;
    const MAX_PAGES = 10;

    while (hasMore && pageCount < MAX_PAGES && quotesById.size < maxQuotes) {
      let path = '/quotes?limit=100';
      if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
      const result = await apiCall('GET', path);
      const items = result?.items || [];
      for (const q of items) {
        if (quotesById.has(q.id)) continue;
        // Fenêtre temporelle pour le scan UNIQUEMENT (bridge skip ce filtre)
        if (q.date) {
          const d = new Date(q.date).getTime();
          if (!Number.isNaN(d) && d < cutoffMs) continue;
        }
        quotesById.set(q.id, q);
        if (quotesById.size >= maxQuotes) break;
      }
      hasMore = result?.has_more && !!result?.next_cursor;
      cursor = result?.next_cursor || null;
      pageCount++;
    }
  }

  const recentQuotes = Array.from(quotesById.values());
  if (recentQuotes.length === 0) return [];

  // 5. Batch fetch customers uniquement si on a besoin de matcher email ou phone
  // (l'embedded `q.customer` suffit pour bridge + name). Skip si lead sans
  // email NI phone → 0 requête /customers, latence ~ instant.
  const needsCustomerFetch = !!(leadNorm.email || leadNorm.phone);
  const customersById = needsCustomerFetch
    ? await fetchCustomersByIds(recentQuotes.map(q => q.customer?.id).filter(Boolean))
    : new Map();

  // 6. Pour chaque devis, calculer les signaux via les matchers déclaratifs
  const results = [];
  for (const q of recentQuotes) {
    if (!q.customer?.id) continue;
    if (attachedToOtherLead.has(q.id)) continue; // déjà rattaché ailleurs

    const customerKey = String(q.customer.id);
    // customer (fetched complet) en priorité, fallback sur q.customer embedded
    // (si le GET /customers/{id} a échoué silencieusement on a quand même name+id)
    const customer = customersById.get(customerKey) || q.customer;
    const ctx = { q, customer, customerKey };

    const signals = matchers.filter(m => m.check(ctx)).map(m => m.name);
    if (signals.length === 0) continue; // pas de match, skip

    results.push({
      quote: formatQuoteForCandidate(q, customer),
      signals,
      alreadyAttached: attachedToThisLead.has(q.id),
    });
  }

  return results;
}

/**
 * Formate un quote PL brut en payload uniforme pour QuoteCandidatesModal.
 * Cohérent avec la shape retournée par getQuotesByClient.
 */
function formatQuoteForCandidate(q, customer) {
  return {
    id: q.id,
    quote_number: q.quote_number || q.label || null,
    label: q.label || null,
    subject: q.pdf_invoice_subject || null,
    date: q.date || null,
    deadline: q.deadline || null,
    amount_ht: q.currency_amount_before_tax || null,
    amount_ttc: q.amount || q.currency_amount || null,
    status: q.status || null,
    pdf_url: q.public_file_url || null,
    customer_id: q.customer?.id || null,
    customer_name: formatPennylaneCustomerName(customer),
  };
}

/**
 * Devis PL des N derniers jours sans rattachement actif en MDH.
 * Sert à la section "Explorer les devis non rattachés" de QuoteCandidatesModal
 * et au calcul de `countUnlinkedQuotes` (voyant de discipline).
 *
 * Note : `since_days` filtre sur `quote.date` (date du devis Pennylane), pas
 * sur `assigned_at` (qui n'existe que si déjà rattaché).
 *
 * @param {string} orgId
 * @param {object} [opts]
 * @param {number} [opts.sinceDays=60]
 * @param {number} [opts.limit=100]
 * @returns {Promise<Array>} devis PL formatés (même shape que getQuotesByClient)
 */
async function getUnlinkedQuotes(orgId, { sinceDays = 60, limit = 100 } = {}) {
  if (!orgId) return [];

  // 1. Set des pennylane_quote_id déjà rattachés activement
  const { data: existingLinks } = await supabase
    .from('majordhome_lead_pennylane_quotes')
    .select('pennylane_quote_id')
    .eq('org_id', orgId)
    .is('ejected_at', null);
  const attachedSet = new Set((existingLinks || []).map(l => l.pennylane_quote_id));

  // 2. Fetch devis PL paginés (safety MAX_PAGES pour éviter timeout edge function)
  const cutoffMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const allQuotes = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;
  const MAX_PAGES = 10;

  while (hasMore && pageCount < MAX_PAGES && allQuotes.length < limit) {
    let path = '/quotes?limit=100';
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    const result = await apiCall('GET', path);
    const items = result?.items || [];
    allQuotes.push(...items);
    hasMore = result?.has_more && !!result?.next_cursor;
    cursor = result?.next_cursor || null;
    pageCount++;
  }

  // 3. Filtrer : pas déjà rattaché + dans la fenêtre temporelle
  const filtered = allQuotes.filter(q => {
    if (attachedSet.has(q.id)) return false;
    if (q.date) {
      const d = new Date(q.date).getTime();
      if (!Number.isNaN(d) && d < cutoffMs) return false;
    }
    return true;
  });

  // 4. Tri date desc + limit + format
  filtered.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  const sliced = filtered.slice(0, limit);

  // Note perf : on n'enrichit PLUS via /customers/{id}. Pennylane V2 retourne
  // déjà `q.customer.name` / `first_name` / `last_name` embedded dans /quotes,
  // suffisant pour l'affichage. Le fetch batch saturait le proxy (cf pLimit).
  return sliced.map(q => ({
    id: q.id,
    quote_number: q.quote_number || q.label || null,
    label: q.label || null,
    subject: q.pdf_invoice_subject || null,
    date: q.date || null,
    deadline: q.deadline || null,
    amount_ht: q.currency_amount_before_tax || null,
    amount_ttc: q.amount || q.currency_amount || null,
    status: q.status || null,
    pdf_url: q.public_file_url || null,
    customer_id: q.customer?.id || null,
    customer_name: formatPennylaneCustomerName(q.customer),
  }));
}

/**
 * Compteur "devis PL non rattachés des N derniers jours".
 * Voyant de discipline org_admin (Dashboard + Pipeline header).
 *
 * Variante minimale : pagine /quotes + filtre attached set, RIEN d'autre.
 * Pas de fetch /customers/{id} (le compteur n'a pas besoin des noms).
 * Plafond `softCap` pour éviter timeout edge function et capper l'usage proxy
 * — au-delà on retourne `softCap` (le voyant doit juste signaler "beaucoup").
 *
 * @param {string} orgId
 * @param {object} [opts]
 * @param {number} [opts.sinceDays=30]
 * @param {number} [opts.softCap=500]
 * @returns {Promise<number>}
 */
async function countUnlinkedQuotes(orgId, { sinceDays = 30, softCap = 500 } = {}) {
  if (!orgId) return 0;

  const { data: existingLinks } = await supabase
    .from('majordhome_lead_pennylane_quotes')
    .select('pennylane_quote_id')
    .eq('org_id', orgId)
    .is('ejected_at', null);
  const attachedSet = new Set((existingLinks || []).map(l => l.pennylane_quote_id));

  const cutoffMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;
  let count = 0;
  const MAX_PAGES = 10;

  while (hasMore && pageCount < MAX_PAGES && count < softCap) {
    let path = '/quotes?limit=100';
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    const result = await apiCall('GET', path);
    const items = result?.items || [];
    for (const q of items) {
      if (attachedSet.has(q.id)) continue;
      if (q.date) {
        const d = new Date(q.date).getTime();
        if (!Number.isNaN(d) && d < cutoffMs) continue;
      }
      count++;
      if (count >= softCap) break;
    }
    hasMore = result?.has_more && !!result?.next_cursor;
    cursor = result?.next_cursor || null;
    pageCount++;
  }

  return count;
}

/**
 * Multi-attach + bascule statut en 1 transaction (RPC PR 2).
 * @param {string} orgId
 * @param {string} leadId
 * @param {Array<{quote_pl_id: number, customer_id?: number, amount_ht?: number, label?: string, date?: string, status?: string}>} quotes
 * @returns {Promise<object>} { attached, lead_status_changed, new_status_id, results: [...] }
 */
async function attachQuotesAndSendLead(orgId, leadId, quotes) {
  const { data, error } = await supabase.rpc('lead_attach_quotes_and_send', {
    p_org_id: orgId,
    p_lead_id: leadId,
    p_quotes: quotes,
  });
  if (error) throw error;
  return data;
}

/**
 * Mark Won côté MDH (RPC PR 3).
 * @param {string} orgId
 * @param {string} leadId
 * @param {number|string} winningQuotePlId
 * @returns {Promise<object>} { lead_status_changed, winning_quote_pl_id, winning_quote_label }
 */
async function markLeadWonWithQuote(orgId, leadId, winningQuotePlId) {
  const { data, error } = await supabase.rpc('lead_mark_won_with_quote', {
    p_org_id: orgId,
    p_lead_id: leadId,
    p_winning_quote_pl_id: Number(winningQuotePlId),
  });
  if (error) throw error;
  return data;
}

/**
 * Détache (soft-delete) un devis Pennylane d'un lead.
 * @param {string} orgId
 * @param {number|string} pennylaneQuoteId
 * @param {string} [reason]
 */
async function ejectQuoteFromLead(orgId, pennylaneQuoteId, reason = null) {
  const { data, error } = await supabase.rpc('eject_pennylane_quote', {
    p_org_id: orgId,
    p_quote_pl_id: Number(pennylaneQuoteId),
    p_reason: reason,
  });
  if (error) throw error;
  return data;
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
  getQuoteLines: (pennylaneQuoteId) => withErrorHandling(() => getQuoteLines(pennylaneQuoteId), 'pennylane.getQuoteLines'),

  // Factures
  pullInvoices: (orgId, since) => withErrorHandling(() => pullInvoices(orgId, since), 'pennylane.pullInvoices'),
  getInvoicesByClient: (clientId, orgId) => withErrorHandling(() => getInvoicesByClient(clientId, orgId), 'pennylane.getInvoicesByClient'),

  // Config
  getLedgerAccounts: () => withErrorHandling(() => getLedgerAccounts(), 'pennylane.getLedgerAccounts'),

  // Sync table
  getSyncRecord: (orgId, entityType, localId) => withErrorHandling(() => getSyncRecord(orgId, entityType, localId), 'pennylane.getSyncRecord'),

  // Liaison lead ↔ devis (multi-devis par chantier)
  getLinkedQuotesByLead: (leadId) => withErrorHandling(() => getLinkedQuotesByLead(leadId), 'pennylane.getLinkedQuotesByLead'),
  assignQuoteToLead: (orgId, pennylaneQuoteId, leadId, quoteData) => withErrorHandling(() => assignQuoteToLead(orgId, pennylaneQuoteId, leadId, quoteData), 'pennylane.assignQuoteToLead'),
  ejectQuoteFromLead: (orgId, pennylaneQuoteId, reason) => withErrorHandling(() => ejectQuoteFromLead(orgId, pennylaneQuoteId, reason), 'pennylane.ejectQuoteFromLead'),

  // Bridge Pipeline ↔ Pennylane (spec 2026-05-23 PR 4+)
  getCandidateQuotesForLead: (leadId, orgId) => withErrorHandling(() => getCandidateQuotesForLead(leadId, orgId), 'pennylane.getCandidateQuotesForLead'),
  getUnlinkedQuotes: (orgId, opts) => withErrorHandling(() => getUnlinkedQuotes(orgId, opts), 'pennylane.getUnlinkedQuotes'),
  countUnlinkedQuotes: (orgId, opts) => withErrorHandling(() => countUnlinkedQuotes(orgId, opts), 'pennylane.countUnlinkedQuotes'),
  attachQuotesAndSendLead: (orgId, leadId, quotes) => withErrorHandling(() => attachQuotesAndSendLead(orgId, leadId, quotes), 'pennylane.attachQuotesAndSendLead'),
  markLeadWonWithQuote: (orgId, leadId, winningQuotePlId) => withErrorHandling(() => markLeadWonWithQuote(orgId, leadId, winningQuotePlId), 'pennylane.markLeadWonWithQuote'),

  // Mappings (exportés pour usage externe)
  TVA_MAPPING,
  UNIT_MAPPING,
};
