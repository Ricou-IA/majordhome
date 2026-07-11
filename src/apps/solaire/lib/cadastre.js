// src/apps/solaire/lib/cadastre.js
// Cadastre (parcelles) + statut ABF via apicarto IGN — appels DIRECTS navigateur
// (CORS vérifié avec l'origin app, pas de proxy edge). Aucun import React/Supabase/alias :
// les parsers sont purs et testés via `node --test scripts/cadastre-lib.test.mjs`.
// Les fetchers throwent — le caller UI gère le fail-loud (jamais de faux « non protégé »).

const APICARTO_BASE = 'https://apicarto.ign.fr/api';

// Catégories de servitudes GPU qui déclenchent l'avis ABF :
// ac1 = abords de monuments historiques (PDA), ac2 = sites classés/inscrits,
// ac4 = site patrimonial remarquable (SPR, ex-AVAP/ZPPAUP).
const ABF_SUPTYPES = new Set(['ac1', 'ac2', 'ac4']);

/** Feature apicarto /cadastre/parcelle → parcelle métier. superficie inconnue = null (pas 0). */
export function normalizeParcelle(feature) {
  const p = feature?.properties ?? {};
  return {
    idu: p.idu ?? null,
    prefixe: p.com_abs ?? '000',
    section: p.section ?? '',
    numero: p.numero ?? '',
    code_insee: p.code_insee ?? null,
    nom_com: p.nom_com ?? '',
    superficie_m2: Number.isFinite(p.contenance) ? p.contenance : null,
    geometry: feature?.geometry ?? null,
  };
}

/** Carré GeoJSON (Polygon fermé, 5 points) de demi-côté `meters` autour d'un point WGS84. */
export function makeSquareAround(lon, lat, meters) {
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - dLon, lat - dLat],
      [lon + dLon, lat - dLat],
      [lon + dLon, lat + dLat],
      [lon - dLon, lat + dLat],
      [lon - dLon, lat - dLat],
    ]],
  };
}

/**
 * Features apicarto /gpu/assiette-sup-s → bloc `abf` du dossier.
 * Un résultat vide = « aucune protection recensée au GPU » (le GPU n'est pas exhaustif —
 * les SUP non téléversées par les gestionnaires n'y figurent pas).
 */
export function buildAbfSummary(features, checkedAtIso) {
  const protections = (features ?? [])
    .map((f) => f?.properties ?? {})
    .filter((p) => ABF_SUPTYPES.has(String(p.suptype ?? '').toLowerCase()))
    .map((p) => ({
      suptype: String(p.suptype).toLowerCase(),
      nom: p.nomsuplitt ?? '',
      type: p.typeass ?? '',
    }));
  return {
    secteur_protege: protections.length > 0,
    protections,
    source: 'gpu',
    checked_at: checkedAtIso,
  };
}

/** Parcelles sélectionnées → bloc `cadastre` du dossier (shape de la migration pv_dossiers). */
export function toDbCadastre(parcelles) {
  if (!parcelles?.length) return null;
  return {
    commune_insee: parcelles[0].code_insee,
    nom_com: parcelles[0].nom_com,
    parcelles: parcelles.map(({ idu, prefixe, section, numero, superficie_m2 }) => ({
      idu, prefixe, section, numero, superficie_m2,
    })),
    geojson: {
      type: 'FeatureCollection',
      features: parcelles.map((p) => ({
        type: 'Feature',
        properties: { idu: p.idu },
        geometry: p.geometry,
      })),
    },
  };
}

/** POST apicarto (geom GeoJSON en body — les grosses géométries passent, pas de limite d'URL). */
async function postApicarto(path, body) {
  const res = await fetch(`${APICARTO_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`apicarto ${path} HTTP ${res.status}`);
  return res.json();
}

/**
 * Parcelle(s) contenant le point. Un point sur voirie/domaine public renvoie 0 feature
 * (cas nominal, pas un bug) → retry avec un petit carré de 15 m pour attraper les adjacentes.
 */
export async function fetchParcelleAtPoint(lon, lat) {
  const atPoint = await postApicarto('/cadastre/parcelle', {
    geom: { type: 'Point', coordinates: [lon, lat] },
  });
  let features = atPoint.features ?? [];
  if (!features.length) {
    const buffered = await postApicarto('/cadastre/parcelle', { geom: makeSquareAround(lon, lat, 15) });
    features = buffered.features ?? [];
  }
  return features.map(normalizeParcelle);
}

/** Parcelles voisines (carré de `meters`) pour la sélection multi-parcelles sur carte. */
export async function fetchParcellesAround(lon, lat, meters = 120) {
  const json = await postApicarto('/cadastre/parcelle', { geom: makeSquareAround(lon, lat, meters) });
  return (json.features ?? []).map(normalizeParcelle);
}

/** Parcelles intersectant un polygone arbitraire (ex. l'emprise visible de la carte). */
export async function fetchParcellesInPolygon(geom) {
  const json = await postApicarto('/cadastre/parcelle', { geom });
  return (json.features ?? []).map(normalizeParcelle);
}

/**
 * Servitudes GPU au point (1 seul appel sans `categorie`, filtre ABF côté client).
 * ⚠️ `_limit`/`_start` sont ignorés par le module GPU — ne pas s'en servir.
 */
export async function fetchAbfAtPoint(lon, lat) {
  const json = await postApicarto('/gpu/assiette-sup-s', {
    geom: { type: 'Point', coordinates: [lon, lat] },
  });
  return buildAbfSummary(json.features ?? [], new Date().toISOString());
}
