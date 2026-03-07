/**
 * geocoding.service.js
 * Service de géocodage via api-adresse.data.gouv.fr (gratuit, illimité)
 * Utilisé pour :
 *  - Géocoder une adresse en lat/lng
 *  - Batch géocodage des clients existants
 *  - Auto-géocodage à la saisie dans ClientModal
 *
 * @version 1.0.0
 */

import { supabase } from '@/lib/supabaseClient';

const API_BASE = 'https://api-adresse.data.gouv.fr';

// ============================================================================
// GÉOCODAGE UNITAIRE
// ============================================================================

/**
 * Géocode une adresse française complète
 * @param {string} address - Adresse rue
 * @param {string} postalCode - Code postal
 * @param {string} city - Ville
 * @returns {{ lat: number, lng: number, score: number, label: string } | null}
 */
export async function geocodeAddress(address, postalCode, city) {
  try {
    // Construire la requête
    const parts = [address, postalCode, city].filter(Boolean);
    const q = parts.join(' ');

    if (!q || q.trim().length < 5) return null;

    const params = new URLSearchParams({
      q,
      limit: '1',
    });

    // Ajouter le code postal comme filtre si disponible
    if (postalCode) {
      params.set('postcode', postalCode);
    }

    const res = await fetch(`${API_BASE}/search/?${params}`);
    if (!res.ok) {
      console.warn('[geocoding] API error:', res.status);
      return null;
    }

    const data = await res.json();

    if (!data.features || data.features.length === 0) {
      console.warn('[geocoding] Aucun résultat pour:', q);
      return null;
    }

    const feature = data.features[0];
    const [lng, lat] = feature.geometry.coordinates;
    const score = feature.properties.score;
    const label = feature.properties.label;

    // Seuil de confiance minimal
    if (score < 0.3) {
      console.warn('[geocoding] Score trop faible:', score, 'pour', q);
      return null;
    }

    return { lat, lng, score, label };
  } catch (error) {
    console.error('[geocoding] Erreur:', error);
    return null;
  }
}

// ============================================================================
// MISE À JOUR COORDONNÉES CLIENT
// ============================================================================

/**
 * Met à jour les coordonnées d'un client dans majordhome.clients
 * @param {string} clientId - UUID du client
 * @param {number} lat
 * @param {number} lng
 */
export async function updateClientCoordinates(clientId, lat, lng) {
  try {
    const { error } = await supabase
      .schema('majordhome')
      .from('clients')
      .update({
        latitude: lat,
        longitude: lng,
        geocoded_at: new Date().toISOString(),
      })
      .eq('id', clientId);

    if (error) throw error;

    console.log('[geocoding] Coordonnées mises à jour pour client:', clientId);
    return { success: true, error: null };
  } catch (error) {
    console.error('[geocoding] Erreur updateClientCoordinates:', error);
    return { success: false, error };
  }
}

/**
 * Géocode et met à jour un client en une opération
 * @param {string} clientId - UUID majordhome.clients
 * @param {string} address
 * @param {string} postalCode
 * @param {string} city
 */
export async function geocodeAndUpdateClient(clientId, address, postalCode, city) {
  const result = await geocodeAddress(address, postalCode, city);
  if (!result) return { success: false, error: 'Géocodage impossible' };

  return updateClientCoordinates(clientId, result.lat, result.lng);
}

/**
 * Géocode et met à jour un client via son project_id (legacy)
 * Le ClientModal utilise le project_id, pas l'id majordhome.clients
 * @param {string} projectId - UUID core.projects
 * @param {string} address
 * @param {string} postalCode
 * @param {string} city
 */
export async function geocodeAndUpdateByProjectId(projectId, address, postalCode, city) {
  const result = await geocodeAddress(address, postalCode, city);
  if (!result) return { success: false, error: 'Géocodage impossible' };

  try {
    const { error } = await supabase
      .schema('majordhome')
      .from('clients')
      .update({
        latitude: result.lat,
        longitude: result.lng,
        geocoded_at: new Date().toISOString(),
      })
      .eq('project_id', projectId);

    if (error) throw error;

    console.log('[geocoding] Coordonnées mises à jour via project_id:', projectId);
    return { success: true, error: null };
  } catch (error) {
    console.error('[geocoding] Erreur geocodeAndUpdateByProjectId:', error);
    return { success: false, error };
  }
}

// ============================================================================
// BATCH GÉOCODAGE
// ============================================================================

/**
 * Géocode par batch via l'API CSV de api-adresse.data.gouv.fr
 * Plus efficace que les appels unitaires pour > 100 adresses
 *
 * @param {Array<{id: string, address: string, postal_code: string, city: string}>} clients
 * @param {function} onProgress - Callback (processed, total)
 * @returns {{ success: number, failed: number, errors: string[] }}
 */
export async function batchGeocodeClients(clients, onProgress) {
  const results = { success: 0, failed: 0, errors: [] };
  const BATCH_SIZE = 15; // Petit batch pour éviter les timeouts
  const DELAY_MS = 500;  // Pause entre batches
  const FETCH_TIMEOUT = 15000; // 15s timeout par requête CSV

  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const batch = clients.slice(i, i + BATCH_SIZE);

    try {
      // Tenter le batch CSV (plus rapide)
      const batchOk = await tryBatchCSV(batch, results);

      if (!batchOk) {
        // Fallback : géocodage unitaire
        console.log('[geocoding] CSV échoué, fallback unitaire pour', batch.length, 'clients');
        await fallbackUnitaire(batch, results);
      }
    } catch (error) {
      console.error('[geocoding] Erreur batch:', error);
      // Fallback unitaire si erreur
      await fallbackUnitaire(batch, results);
    }

    if (onProgress) {
      onProgress(Math.min(i + BATCH_SIZE, clients.length), clients.length);
    }

    if (i + BATCH_SIZE < clients.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}

/** Tente le géocodage batch via API CSV. Retourne false si échec. */
async function tryBatchCSV(batch, results) {
  const FETCH_TIMEOUT = 15000;

  const csvLines = ['id,adresse,postcode,city'];
  for (const client of batch) {
    const addr = (client.address || '').replace(/,/g, ' ').replace(/"/g, '');
    const cp = client.postal_code || '';
    const city = (client.city || '').replace(/,/g, ' ').replace(/"/g, '');
    csvLines.push(`${client.id},"${addr}",${cp},"${city}"`);
  }

  const formData = new FormData();
  formData.append('data', new Blob([csvLines.join('\n')], { type: 'text/csv' }), 'addresses.csv');
  formData.append('columns', 'adresse');
  formData.append('postcode', 'postcode');
  formData.append('city_column', 'city');
  formData.append('result_columns', 'result_score,latitude,longitude');

  // Fetch avec timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(`${API_BASE}/search/csv/`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return false;

    const csvResult = await res.text();
    const lines = csvResult.split('\n').slice(1);

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = parseCSVLine(line);
      const id = parts[0];
      const score = parseFloat(parts[parts.length - 3]) || 0;
      const lat = parseFloat(parts[parts.length - 2]);
      const lng = parseFloat(parts[parts.length - 1]);

      if (score >= 0.3 && !isNaN(lat) && !isNaN(lng)) {
        await updateClientCoordinates(id, lat, lng);
        results.success++;
      } else {
        results.failed++;
      }
    }
    return true;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

/** Géocodage unitaire (fallback quand CSV échoue) */
async function fallbackUnitaire(batch, results) {
  for (const client of batch) {
    try {
      const result = await geocodeAddress(client.address, client.postal_code, client.city);
      if (result && result.score >= 0.3) {
        await updateClientCoordinates(client.id, result.lat, result.lng);
        results.success++;
      } else {
        results.failed++;
      }
    } catch {
      results.failed++;
    }
    await new Promise(r => setTimeout(r, 150)); // Rate limit unitaire
  }
}

/**
 * Parse une ligne CSV en tenant compte des guillemets
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ============================================================================
// EXPORT SERVICE
// ============================================================================

export const geocodingService = {
  geocodeAddress,
  updateClientCoordinates,
  geocodeAndUpdateClient,
  batchGeocodeClients,
};

export default geocodingService;
