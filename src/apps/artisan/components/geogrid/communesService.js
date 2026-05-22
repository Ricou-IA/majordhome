/**
 * communesService.js — Fetch des communes par département via geo.api.gouv.fr
 *
 * Mode GeoGrid "cities" : 1 scan par commune du département cible.
 * Cache LocalStorage 7 jours par code département.
 *
 * Multi-tenant : le département est passé par le caller (lu depuis
 * `core.organizations.settings.geogrid_target_department` via
 * `useAuth().organization.settings`). Mayer = "81" (Tarn).
 *
 * Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §9.4
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const CACHE_KEY_PREFIX = 'geogrid:communes';

// Regex stricte : métropole (01-95), DOM-TOM (971-976), Corse (2A, 2B).
const DEPARTMENT_CODE_REGEX = /^(\d{2,3}|2[AB])$/;

/**
 * Récupère les communes d'un département avec cache LocalStorage par code département.
 *
 * @param {string} departmentCode - Code à 2-3 chars ('81', '2A', '971')
 * @returns {Promise<{ data: Array<{ code, name, codesPostaux, population, lat, lng }>, error: Error|null }>}
 *
 * Renvoie `{ data: [], error: new Error('Département non configuré') }` si le code
 * est vide ou invalide — laisse l'UI rendre un message "configure ton département"
 * proprement.
 */
export async function fetchCommunes(departmentCode) {
  if (!departmentCode || !DEPARTMENT_CODE_REGEX.test(departmentCode)) {
    return { data: [], error: new Error('Département non configuré') };
  }

  const cacheKey = `${CACHE_KEY_PREFIX}:${departmentCode}`;

  // 1. Try cache LocalStorage
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (
        parsed
        && Array.isArray(parsed.data)
        && Date.now() - parsed.timestamp < CACHE_TTL_MS
      ) {
        return { data: parsed.data, error: null };
      }
    }
  } catch {
    // localStorage HS ou JSON corrompu → fallback fetch
  }

  // 2. Fetch API gouv.fr
  try {
    const url = `https://geo.api.gouv.fr/departements/${departmentCode}/communes?fields=code,nom,centre,codesPostaux,population&format=json&geometry=centre`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`API gouv ${resp.status}`);
    }

    const raw = await resp.json();
    const cleaned = raw
      .filter((c) => c.centre?.coordinates?.length === 2)
      .map((c) => ({
        code: c.code,
        name: c.nom,
        codesPostaux: Array.isArray(c.codesPostaux) ? c.codesPostaux : [],
        population: c.population || 0,
        lat: c.centre.coordinates[1],
        lng: c.centre.coordinates[0],
      }))
      .sort((a, b) => b.population - a.population);

    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ timestamp: Date.now(), data: cleaned }),
      );
    } catch {
      // quota localStorage plein, ignore
    }

    return { data: cleaned, error: null };
  } catch (err) {
    return { data: [], error: err };
  }
}

/**
 * Filtre les communes par seuil de population minimum.
 */
export function filterByPopulation(communes, minPopulation) {
  return communes.filter((c) => c.population >= minPopulation);
}

/**
 * Centroïde géographique d'une liste de communes (pour centrer la carte).
 * Si vide, retourne null — le caller doit gérer (fallback sur map_default_center).
 */
export function centroidOf(communes) {
  if (!communes?.length) return null;
  const sum = communes.reduce(
    (acc, c) => ({ lat: acc.lat + c.lat, lng: acc.lng + c.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / communes.length, lng: sum.lng / communes.length };
}
