/**
 * geocoding.service.js
 * Service de géocodage via api-adresse.data.gouv.fr (gratuit, illimité)
 * Utilisé pour :
 *  - Géocoder une adresse en lat/lng (clients + leads)
 *  - Batch géocodage des clients existants
 *  - Auto-géocodage à la saisie dans ClientModal et LeadModal
 *  - Détection zone + auto-assignation commercial pour les leads
 *
 * @version 2.0.0
 */

import { supabase } from '@/lib/supabaseClient';
import { ZONE_COMMERCIAL_MAPPING } from '@/lib/territoire-config';
import * as turf from '@turf/turf';

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
      .from('majordhome_clients')
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
      .from('majordhome_clients')
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
// GÉOCODAGE LEADS
// ============================================================================

/**
 * Géocode par code postal uniquement (centroïde de commune)
 * Utilisé quand seul le CP est connu (début de qualification lead)
 * @param {string} postalCode
 * @returns {{ lat: number, lng: number, score: number, label: string } | null}
 */
export async function geocodeByPostalCode(postalCode) {
  try {
    if (!postalCode || postalCode.length < 4) return null;

    const params = new URLSearchParams({
      q: postalCode,
      type: 'municipality',
      postcode: postalCode,
      limit: '1',
    });

    const res = await fetch(`${API_BASE}/search/?${params}`);
    if (!res.ok) {
      console.warn('[geocoding] API error (CP):', res.status);
      return null;
    }

    const data = await res.json();

    if (!data.features || data.features.length === 0) {
      console.warn('[geocoding] Aucun résultat pour CP:', postalCode);
      return null;
    }

    const feature = data.features[0];
    const [lng, lat] = feature.geometry.coordinates;
    const score = feature.properties.score;
    const label = feature.properties.label;

    if (score < 0.3) {
      console.warn('[geocoding] Score CP trop faible:', score, 'pour', postalCode);
      return null;
    }

    return { lat, lng, score, label };
  } catch (error) {
    console.error('[geocoding] Erreur geocodeByPostalCode:', error);
    return null;
  }
}

/**
 * Géocode une lead : adresse complète si disponible, sinon par code postal
 * @param {string|null} address
 * @param {string|null} postalCode
 * @param {string|null} city
 * @returns {{ lat: number, lng: number, score: number, label: string } | null}
 */
export async function geocodeLeadAddress(address, postalCode, city) {
  // Si adresse rue présente → géocodage précis
  if (address && address.trim().length > 3) {
    const result = await geocodeAddress(address, postalCode, city);
    if (result) return result;
  }
  // Fallback : centroïde du code postal
  if (postalCode) {
    return geocodeByPostalCode(postalCode);
  }
  return null;
}

/**
 * Détecte la zone commerciale (gaillac/pechbonnieu) à partir de coordonnées
 * Utilise les polygones zones cachés dans localStorage par useMapZones
 * @param {number} lat
 * @param {number} lng
 * @returns {'gaillac' | 'pechbonnieu' | null}
 */
export function detectLeadZone(lat, lng) {
  try {
    const cached = localStorage.getItem('mayer-territoire-zones-v8');
    if (!cached) {
      console.warn('[geocoding] Zones non disponibles en cache — zone non détectée');
      return null;
    }

    const zones = JSON.parse(cached);
    const point = turf.point([lng, lat]);

    // Vérifier Pechbonnieu en premier (plus petite, plus spécifique)
    if (zones.zone_pechbonnieu && turf.booleanPointInPolygon(point, zones.zone_pechbonnieu)) {
      return 'pechbonnieu';
    }
    if (zones.zone_gaillac && turf.booleanPointInPolygon(point, zones.zone_gaillac)) {
      return 'gaillac';
    }

    return null;
  } catch (error) {
    console.error('[geocoding] Erreur detectLeadZone:', error);
    return null;
  }
}

/**
 * Met à jour les coordonnées + zone d'une lead via RPC
 * (écriture directe sur majordhome.leads impossible — PostgREST n'expose pas ce schéma)
 * @param {string} leadId
 * @param {number} lat
 * @param {number} lng
 * @param {string|null} zone
 */
export async function updateLeadCoordinates(leadId, lat, lng, zone) {
  try {
    const { error } = await supabase.rpc('update_majordhome_lead', {
      p_id: leadId,
      p_data: {
        latitude: lat,
        longitude: lng,
        geocoded_at: new Date().toISOString(),
        zone: zone,
      },
    });

    if (error) throw error;

    console.log('[geocoding] Lead coordonnées mises à jour:', leadId, '→ zone:', zone);
    return { success: true, error: null };
  } catch (error) {
    console.error('[geocoding] Erreur updateLeadCoordinates:', error);
    return { success: false, error };
  }
}

// Cache module-level pour les IDs commerciaux (ne change pas en session)
const _commercialIdCache = {};

/**
 * Résout l'ID profil d'un commercial à partir de son email
 * @param {string} email
 * @returns {string|null} profile UUID
 */
export async function resolveCommercialId(email) {
  if (_commercialIdCache[email]) return _commercialIdCache[email];

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (error || !data) {
      console.warn('[geocoding] Commercial non trouvé pour:', email);
      return null;
    }

    _commercialIdCache[email] = data.id;
    return data.id;
  } catch (error) {
    console.error('[geocoding] Erreur resolveCommercialId:', error);
    return null;
  }
}

/**
 * Géocode une lead + détecte zone + assigne commercial
 * Fonction principale appelée en fire-and-forget par LeadModal
 * @param {string} leadId
 * @param {string|null} address
 * @param {string|null} postalCode
 * @param {string|null} city
 */
export async function geocodeAndAssignLead(leadId, address, postalCode, city) {
  // 1. Géocoder
  const coords = await geocodeLeadAddress(address, postalCode, city);
  if (!coords) {
    console.log('[geocoding] Lead non géocodable:', leadId);
    return;
  }

  // 2. Détecter zone
  const zone = detectLeadZone(coords.lat, coords.lng);

  // 3. Mettre à jour coordonnées + zone
  await updateLeadCoordinates(leadId, coords.lat, coords.lng, zone);

  // 4. Auto-assigner commercial si zone détectée
  if (zone && ZONE_COMMERCIAL_MAPPING[zone]) {
    const mapping = ZONE_COMMERCIAL_MAPPING[zone];
    const commercialId = await resolveCommercialId(mapping.email);

    if (commercialId) {
      try {
        // N'assigner que si pas déjà assigné — lecture via vue publique
        const { data: lead } = await supabase
          .from('majordhome_leads')
          .select('assigned_user_id')
          .eq('id', leadId)
          .single();

        if (!lead?.assigned_user_id) {
          await supabase.rpc('update_majordhome_lead', {
            p_id: leadId,
            p_data: { assigned_user_id: commercialId },
          });

          console.log(`[geocoding] Lead ${leadId} → zone ${zone} → commercial ${mapping.name}`);
        }
      } catch (error) {
        console.warn('[geocoding] Erreur auto-assignation:', error);
      }
    }
  }
}

// ============================================================================
// BATCH GÉOCODAGE LEADS
// ============================================================================

/**
 * Géocode un batch de leads (par CP ou adresse complète) + détecte zone + assigne commercial
 * @param {Array<{id: string, address: string|null, postal_code: string|null, city: string|null}>} leads
 * @param {function} onProgress - Callback (processed, total)
 * @returns {{ success: number, failed: number, assigned: number }}
 */
export async function batchGeocodeLeads(leads, onProgress) {
  const results = { success: 0, failed: 0, assigned: 0 };
  const DELAY_MS = 200; // Rate limit API adresse.data.gouv.fr

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];

    try {
      // 1. Géocoder
      const coords = await geocodeLeadAddress(
        lead.address || null,
        lead.postal_code || null,
        lead.city || null,
      );

      if (!coords) {
        results.failed++;
        continue;
      }

      // 2. Détecter zone
      const zone = detectLeadZone(coords.lat, coords.lng);

      // 3. Mettre à jour coordonnées + zone
      const { success } = await updateLeadCoordinates(lead.id, coords.lat, coords.lng, zone);
      if (!success) {
        results.failed++;
        continue;
      }

      results.success++;

      // 4. Auto-assigner commercial si zone détectée
      if (zone && ZONE_COMMERCIAL_MAPPING[zone]) {
        const mapping = ZONE_COMMERCIAL_MAPPING[zone];
        const commercialId = await resolveCommercialId(mapping.email);

        if (commercialId && !lead.assigned_user_id) {
          try {
            await supabase.rpc('update_majordhome_lead', {
              p_id: lead.id,
              p_data: { assigned_user_id: commercialId },
            });

            results.assigned++;
            console.log(`[geocoding] Lead batch: ${lead.id} → zone ${zone} → ${mapping.name}`);
          } catch (err) {
            console.warn('[geocoding] Batch auto-assign failed:', err);
          }
        }
      }
    } catch (error) {
      console.error(`[geocoding] Batch lead error for ${lead.id}:`, error);
      results.failed++;
    }

    if (onProgress) {
      onProgress(i + 1, leads.length);
    }

    // Rate limit
    if (i < leads.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}

// ============================================================================
// EXPORT SERVICE
// ============================================================================

export const geocodingService = {
  geocodeAddress,
  geocodeByPostalCode,
  geocodeLeadAddress,
  geocodeAndAssignLead,
  detectLeadZone,
  updateClientCoordinates,
  geocodeAndUpdateClient,
  batchGeocodeClients,
  batchGeocodeLeads,
};

export default geocodingService;
