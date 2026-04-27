/**
 * Service de récupération des communes du Tarn (département 81)
 * via l'API Découpage Administratif gouv (gratuit, sans auth, INSEE).
 *
 * Doc : https://geo.api.gouv.fr/decoupage-administratif/communes
 */

const API_URL =
  'https://geo.api.gouv.fr/departements/81/communes?fields=code,nom,centre,population&format=json&geometry=centre';

const CACHE_KEY = 'tarn-communes-v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    /* noop */
  }
}

/**
 * Retourne la liste des communes du Tarn avec lat/lng et population,
 * triées par population décroissante.
 */
export async function fetchTarnCommunes() {
  const cached = readCache();
  if (cached) return cached;

  const resp = await fetch(API_URL);
  if (!resp.ok) throw new Error(`API gouv ${resp.status}`);

  const raw = await resp.json();
  const cleaned = raw
    .filter((c) => c.centre?.coordinates?.length === 2)
    .map((c) => ({
      code: c.code,
      name: c.nom,
      population: c.population || 0,
      lat: c.centre.coordinates[1],
      lng: c.centre.coordinates[0],
    }))
    .sort((a, b) => b.population - a.population);

  writeCache(cleaned);
  return cleaned;
}

/**
 * Filtre les communes par seuil de population minimum.
 */
export function filterByPopulation(communes, minPopulation) {
  return communes.filter((c) => c.population >= minPopulation);
}

/**
 * Centroïde géographique d'une liste de communes (pour centrer la carte).
 */
export function centroidOf(communes) {
  if (!communes?.length) return { lat: 43.78, lng: 2.20 }; // fallback centre Tarn (Réalmont)
  const sum = communes.reduce(
    (acc, c) => ({ lat: acc.lat + c.lat, lng: acc.lng + c.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / communes.length, lng: sum.lng / communes.length };
}
