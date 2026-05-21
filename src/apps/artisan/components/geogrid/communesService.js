/**
 * Service de récupération des communes d'un département français
 * via l'API Découpage Administratif gouv (gratuit, sans auth, INSEE).
 *
 * Doc : https://geo.api.gouv.fr/decoupage-administratif/communes
 *
 * P0.20 (2026-05-21) — Multi-tenant : le département est paramétré
 * par l'org via `core.organizations.settings.geogrid_department_code`.
 * Mayer = "81" (Tarn), Cimaj devra configurer sa valeur.
 */

const CACHE_KEY_BASE = 'communes-dept';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

function readCache(depCode) {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_BASE}-${depCode}-v1`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(depCode, data) {
  try {
    localStorage.setItem(
      `${CACHE_KEY_BASE}-${depCode}-v1`,
      JSON.stringify({ timestamp: Date.now(), data }),
    );
  } catch {
    /* noop */
  }
}

/**
 * Retourne la liste des communes d'un département avec lat/lng et population,
 * triées par population décroissante.
 *
 * @param {string} depCode - Code département INSEE (ex: "81", "44", "75")
 */
export async function fetchDepartementCommunes(depCode) {
  if (!depCode || !/^\d{2,3}[AB]?$/i.test(depCode)) {
    throw new Error(`[communesService] Code département invalide : "${depCode}"`);
  }

  const cached = readCache(depCode);
  if (cached) return cached;

  const url = `https://geo.api.gouv.fr/departements/${depCode}/communes?fields=code,nom,centre,population&format=json&geometry=centre`;
  const resp = await fetch(url);
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

  writeCache(depCode, cleaned);
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
