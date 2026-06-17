// src/lib/sectorClustering.js
// ============================================================================
// Clustering des secteurs (codes postaux) en "grands secteurs" géographiques.
// Partition stricte (chaque CP dans exactement un groupe), agglomératif sous
// contrainte de rayon (haversine). Pure, sans dépendance React/Supabase →
// testable via `node --test scripts/sector-clustering.test.mjs`.
// ============================================================================

const EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function hasCoords(c) {
  return (
    c &&
    c.client_latitude != null &&
    c.client_longitude != null &&
    Number.isFinite(Number(c.client_latitude)) &&
    Number.isFinite(Number(c.client_longitude))
  );
}

function cpCentroid(contracts) {
  const pts = (contracts || []).filter(hasCoords);
  if (pts.length === 0) return null;
  let lat = 0, lng = 0;
  for (const c of pts) { lat += Number(c.client_latitude); lng += Number(c.client_longitude); }
  return { lat: lat / pts.length, lng: lng / pts.length };
}

function geocodedCount(sector) {
  return (sector.contracts || []).filter(hasCoords).length;
}

function pendingCount(sectors) {
  return sectors.reduce(
    (n, s) => n + (s.contracts || []).filter((c) => c.current_year_visit_status !== 'completed').length,
    0,
  );
}

// Centroïde pondéré par le nb de contrats géocodés de chaque CP.
function weightedCentroid(sectors) {
  let lat = 0, lng = 0, w = 0;
  for (const s of sectors) {
    if (!s._centroid) continue;
    const n = geocodedCount(s);
    if (n === 0) continue;
    lat += s._centroid.lat * n;
    lng += s._centroid.lng * n;
    w += n;
  }
  return w === 0 ? null : { lat: lat / w, lng: lng / w };
}

// Vrai si tous les CP du cluster restent à ≤ radiusKm du barycentre pondéré.
function radiusOk(sectors, radiusKm) {
  const c = weightedCentroid(sectors);
  if (!c) return false;
  return sectors.every((s) => haversineKm(c, s._centroid) <= radiusKm);
}

function dominantCommune(sectors) {
  const counts = new Map();
  for (const s of sectors) {
    for (const c of s.contracts || []) {
      const city = (c.client_city || s.commune || '').trim();
      if (!city) continue;
      counts.set(city, (counts.get(city) || 0) + 1);
    }
  }
  let best = null, bestN = -1;
  // tri alpha pour un tie-break déterministe
  for (const [city, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestN) { best = city; bestN = n; }
  }
  return best || sectors[0].codePostal;
}

export function clusterSectorsByProximity(sectors, { radiusKm = 15 } = {}) {
  // tri d'entrée → déterminisme
  const input = [...(sectors || [])].sort((a, b) =>
    String(a.codePostal).localeCompare(String(b.codePostal)),
  );

  const localizable = [];
  const unlocalized = [];
  for (const s of input) {
    s._centroid = cpCentroid(s.contracts);
    (s._centroid ? localizable : unlocalized).push(s);
  }

  // chaque CP localisable = un cluster
  let clusters = localizable.map((s) => ({ sectors: [s], centroid: s._centroid }));

  // fusion agglomérative : paire la plus proche dont la fusion respecte le rayon
  for (;;) {
    let bi = -1, bj = -1, best = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = haversineKm(clusters[i].centroid, clusters[j].centroid);
        if (d >= best) continue;
        if (radiusOk([...clusters[i].sectors, ...clusters[j].sectors], radiusKm)) {
          best = d; bi = i; bj = j;
        }
      }
    }
    if (bi === -1) break;
    const merged = [...clusters[bi].sectors, ...clusters[bj].sectors];
    clusters.splice(bj, 1);
    clusters.splice(bi, 1, { sectors: merged, centroid: weightedCentroid(merged) });
  }

  const groups = clusters.map((cl) => {
    const codePostals = cl.sectors
      .map((s) => s.codePostal)
      .sort((a, b) => String(a).localeCompare(String(b)));
    return {
      id: codePostals.join('-'),
      name: dominantCommune(cl.sectors),
      codePostals,
      centroid: cl.centroid,
      visitsPending: pendingCount(cl.sectors),
    };
  });

  // grands secteurs ordonnés par charge à faire desc, puis nom
  groups.sort((a, b) => b.visitsPending - a.visitsPending || a.name.localeCompare(b.name));

  if (unlocalized.length) {
    groups.push({
      id: 'non-localise',
      name: 'Non localisé',
      codePostals: unlocalized
        .map((s) => s.codePostal)
        .sort((a, b) => String(a).localeCompare(String(b))),
      centroid: null,
      visitsPending: pendingCount(unlocalized),
    });
  }

  // nettoyage du champ interne posé sur les objets d'entrée
  for (const s of input) delete s._centroid;

  return groups;
}
