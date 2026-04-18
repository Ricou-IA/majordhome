#!/usr/bin/env node
/**
 * geocode-clients.mjs
 * Script one-shot : géocode tous les clients sans coordonnées via api-adresse.data.gouv.fr
 *
 * Usage :
 *   node scripts/geocode-clients.mjs              # Run (dry-run par défaut)
 *   node scripts/geocode-clients.mjs --commit      # Écrire en DB
 *   node scripts/geocode-clients.mjs --limit 100   # Limiter à 100 clients
 *
 * API : https://api-adresse.data.gouv.fr/search/csv/
 *   - Gratuit, sans clé API
 *   - Batch CSV : ~50 adresses par requête recommandé
 *   - Rate limit souple (~50 req/s)
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================================
// CONFIG
// ============================================================================

const SUPABASE_URL = 'https://odspcxgafcqxjzrarsqf.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const API_BASE = 'https://api-adresse.data.gouv.fr';
const BATCH_SIZE = 50;     // Adresses par requête CSV
const DELAY_MS = 200;      // Pause entre batches
const MIN_SCORE = 0.3;     // Score minimum de confiance
const ORG_ID = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'; // Mayer Energie (core)

// ============================================================================
// ARGS
// ============================================================================

const args = process.argv.slice(2);
const commitMode = args.includes('--commit');
const limitIdx = args.indexOf('--limit');
const maxClients = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

console.log(`🔧 Mode : ${commitMode ? '✅ COMMIT (écriture DB)' : '🔍 DRY-RUN (lecture seule)'}`);
if (maxClients < Infinity) console.log(`📊 Limite : ${maxClients} clients`);

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

// Préférer la service_role key (bypass RLS), sinon anon key (nécessite auth)
const supabaseKey = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.warn('⚠️  SUPABASE_SERVICE_KEY non définie. Utilisation de la anon key.');
  console.warn('   → Si erreur RLS, lancer avec : SUPABASE_SERVICE_KEY=... node scripts/geocode-clients.mjs');
}

const supabase = createClient(SUPABASE_URL, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ============================================================================
// FETCH CLIENTS À GÉOCODER
// ============================================================================

async function fetchUngeocodedClients() {
  console.log('\n📥 Récupération des clients sans coordonnées...');

  let query = supabase
    .from('majordhome_clients')
    .select('id, address, postal_code, city, display_name')
    .eq('org_id', ORG_ID)
    .eq('is_archived', false)
    .is('latitude', null)
    .not('address', 'is', null)
    .not('postal_code', 'is', null)
    .not('city', 'is', null)
    .order('id');

  // Supabase limite à 1000 par défaut, paginer si besoin
  const allClients = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Erreur Supabase: ${error.message}`);
    if (!data || data.length === 0) break;
    allClients.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  const limited = allClients.slice(0, maxClients);
  console.log(`   ${allClients.length} clients non géocodés trouvés`);
  if (limited.length < allClients.length) {
    console.log(`   → Limité à ${limited.length}`);
  }

  return limited;
}

// ============================================================================
// GÉOCODAGE BATCH CSV
// ============================================================================

function buildCSV(clients) {
  const header = 'id,adresse,postcode,city';
  const rows = clients.map(c => {
    const esc = (s) => `"${(s || '').replace(/"/g, '""')}"`;
    return `${c.id},${esc(c.address)},${esc(c.postal_code)},${esc(c.city)}`;
  });
  return [header, ...rows].join('\n');
}

function parseCSVResponse(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split(',');
  const latIdx = header.indexOf('latitude');
  const lngIdx = header.indexOf('longitude');
  const scoreIdx = header.indexOf('result_score');
  const idIdx = header.indexOf('id');

  if (latIdx === -1 || lngIdx === -1) {
    console.warn('   ⚠️ Colonnes lat/lng manquantes dans la réponse CSV');
    return [];
  }

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    // Parse CSV avec guillemets
    const fields = parseCSVLine(lines[i]);
    const id = fields[idIdx];
    const lat = parseFloat(fields[latIdx]);
    const lng = parseFloat(fields[lngIdx]);
    const score = parseFloat(fields[scoreIdx] || '0');

    if (id && !isNaN(lat) && !isNaN(lng) && score >= MIN_SCORE) {
      results.push({ id, lat, lng, score });
    }
  }

  return results;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function geocodeBatch(clients) {
  const csv = buildCSV(clients);

  const formData = new FormData();
  formData.append('data', new Blob([csv], { type: 'text/csv' }), 'clients.csv');
  formData.append('columns', 'adresse');
  formData.append('postcode', 'postcode');
  formData.append('city', 'city');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${API_BASE}/search/csv/`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    return parseCSVResponse(text);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.warn('   ⏱️ Timeout batch, tentative unitaire...');
    } else {
      console.warn(`   ❌ Erreur batch: ${err.message}`);
    }
    return null; // Signal pour fallback unitaire
  }
}

async function geocodeSingle(client) {
  const q = [client.address, client.postal_code, client.city].filter(Boolean).join(' ');
  try {
    const response = await fetch(
      `${API_BASE}/search/?q=${encodeURIComponent(q)}&postcode=${client.postal_code}&limit=1`
    );
    if (!response.ok) return null;

    const data = await response.json();
    const feat = data?.features?.[0];
    if (!feat) return null;

    const score = feat.properties?.score || 0;
    if (score < MIN_SCORE) return null;

    const [lng, lat] = feat.geometry.coordinates;
    return { id: client.id, lat, lng, score };
  } catch {
    return null;
  }
}

// ============================================================================
// UPDATE DB
// ============================================================================

async function updateCoordinates(results) {
  if (!commitMode) return;

  let updated = 0;
  let errors = 0;

  // Batch update par lots de 50
  for (let i = 0; i < results.length; i += 50) {
    const batch = results.slice(i, i + 50);

    await Promise.all(
      batch.map(async (r) => {
        const { error } = await supabase
          .from('majordhome_clients')
          .update({
            latitude: r.lat,
            longitude: r.lng,
            geocoded_at: new Date().toISOString(),
          })
          .eq('id', r.id);

        if (error) {
          errors++;
          if (errors <= 5) console.warn(`   ❌ Update ${r.id}: ${error.message}`);
        } else {
          updated++;
        }
      })
    );
  }

  return { updated, errors };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const startTime = Date.now();

  // 1. Fetch clients
  const clients = await fetchUngeocodedClients();
  if (clients.length === 0) {
    console.log('✅ Tous les clients sont déjà géocodés !');
    return;
  }

  // 2. Géocodage par batches
  console.log(`\n🌍 Géocodage de ${clients.length} clients (batches de ${BATCH_SIZE})...\n`);

  const allResults = [];
  let batchNum = 0;
  let failedSingle = 0;

  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const batch = clients.slice(i, i + BATCH_SIZE);
    batchNum++;
    const progress = Math.round(((i + batch.length) / clients.length) * 100);

    process.stdout.write(`   Batch ${batchNum} [${i + 1}-${i + batch.length}/${clients.length}] ${progress}%...`);

    // Essayer batch CSV
    let results = await geocodeBatch(batch);

    if (results === null) {
      // Fallback unitaire
      results = [];
      for (const client of batch) {
        const r = await geocodeSingle(client);
        if (r) results.push(r);
        else failedSingle++;
        await sleep(100);
      }
    }

    allResults.push(...results);
    const missed = batch.length - results.length;
    console.log(` → ${results.length}/${batch.length} géocodés${missed > 0 ? ` (${missed} manqués)` : ''}`);

    if (i + BATCH_SIZE < clients.length) {
      await sleep(DELAY_MS);
    }
  }

  // 3. Résumé
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n📊 Résumé :`);
  console.log(`   Total clients : ${clients.length}`);
  console.log(`   Géocodés      : ${allResults.length} (${Math.round((allResults.length / clients.length) * 100)}%)`);
  console.log(`   Échoués        : ${clients.length - allResults.length}`);
  console.log(`   Durée          : ${elapsed}s`);

  // Score moyen
  if (allResults.length > 0) {
    const avgScore = (allResults.reduce((s, r) => s + r.score, 0) / allResults.length).toFixed(3);
    console.log(`   Score moyen    : ${avgScore}`);
  }

  // 4. Écriture DB
  if (commitMode && allResults.length > 0) {
    console.log(`\n💾 Écriture en DB...`);
    const { updated, errors } = await updateCoordinates(allResults);
    console.log(`   ✅ ${updated} clients mis à jour`);
    if (errors > 0) console.log(`   ❌ ${errors} erreurs`);
  } else if (!commitMode && allResults.length > 0) {
    console.log(`\n🔍 DRY-RUN : aucune écriture. Relancer avec --commit pour sauvegarder.`);
  }

  console.log('\n✅ Terminé !');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err);
  process.exit(1);
});
