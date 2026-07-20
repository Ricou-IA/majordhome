// src/apps/solaire/lib/geoProject.js
// Projection géographique PURE pour les pièces graphiques de la DP (plan de situation,
// plan de masse) : bbox, math Web Mercator des images Mapbox Static, projecteur
// lon/lat → points PDF (ratio préservé), barre d'échelle métrique, polygones → tracés.
// Aucune dépendance runtime — testé via `node --test scripts/geo-project.test.mjs`.

// Convention Mapbox GL : tuiles 512 px → le « monde » fait 512 × 2^zoom px logiques.
const TILE_SIZE = 512;
const MAX_MERCATOR_LAT = 85.051129;

const clampLat = (lat) => Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));

/** lon/lat WGS84 → coordonnées « monde » Web Mercator (px logiques) au zoom donné. */
export function lonLatToWorld(lon, lat, zoom) {
  const s = TILE_SIZE * 2 ** zoom;
  const rad = (clampLat(lat) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * s,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * s,
  };
}

/** Inverse de lonLatToWorld. */
export function worldToLonLat(x, y, zoom) {
  const s = TILE_SIZE * 2 ** zoom;
  const lon = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
}

// Itère toutes les positions [lon, lat] d'une géométrie GeoJSON (Point/Polygon/MultiPolygon…).
function eachPosition(geometry, cb) {
  if (!geometry) return;
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      cb(coords[0], coords[1]);
      return;
    }
    for (const c of coords) walk(c);
  };
  walk(geometry.coordinates);
}

/**
 * Bbox englobante d'une liste de features/géométries GeoJSON, élargie d'une marge
 * proportionnelle. Retourne null si aucune coordonnée.
 */
export function computeBbox(features, marginRatio = 0.1) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const f of features ?? []) {
    const geom = f?.type === 'Feature' ? f.geometry : f;
    eachPosition(geom, (lon, lat) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  }
  if (!Number.isFinite(minLon)) return null;
  const dLon = (maxLon - minLon) * marginRatio;
  const dLat = (maxLat - minLat) * marginRatio;
  return { minLon: minLon - dLon, minLat: minLat - dLat, maxLon: maxLon + dLon, maxLat: maxLat + dLat };
}

/**
 * Bbox géographique EXACTE couverte par une image Mapbox Static `wPx×hPx` (px logiques,
 * le @2x ne change pas l'emprise) centrée sur (lon, lat) au zoom donné — permet de
 * superposer nos vecteurs parfaitement alignés sur l'image de fond.
 */
export function mapboxStaticBbox(lon, lat, zoom, wPx, hPx) {
  const c = lonLatToWorld(lon, lat, zoom);
  const tl = worldToLonLat(c.x - wPx / 2, c.y - hPx / 2, zoom);
  const br = worldToLonLat(c.x + wPx / 2, c.y + hPx / 2, zoom);
  return { minLon: tl.lon, minLat: br.lat, maxLon: br.lon, maxLat: tl.lat };
}

/**
 * Zoom (fractionnaire) maximal auquel `bbox` tient dans une image `wPx×hPx`,
 * borné à `maxZoom`. Les URLs Static acceptent les zooms décimaux.
 */
export function fitZoom(bbox, wPx, hPx, maxZoom = 19) {
  const a = lonLatToWorld(bbox.minLon, bbox.maxLat, 0);
  const b = lonLatToWorld(bbox.maxLon, bbox.minLat, 0);
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx === 0 && dy === 0) return maxZoom;
  const zx = dx > 0 ? Math.log2(wPx / dx) : Infinity;
  const zy = dy > 0 ? Math.log2(hPx / dy) : Infinity;
  return Math.min(maxZoom, Math.floor(Math.min(zx, zy) * 100) / 100);
}

/**
 * Projecteur (lon, lat) → { x, y } en points PDF (origine haut-gauche, y vers le bas),
 * ratio préservé (Web Mercator local — l'écart au Lambert-93 est négligeable à
 * l'échelle parcelle/quartier pour un plan d'offre). La bbox est centrée dans wPt×hPt.
 */
export function makeProjector(bbox, wPt, hPt) {
  const tl = lonLatToWorld(bbox.minLon, bbox.maxLat, 0);
  const br = lonLatToWorld(bbox.maxLon, bbox.minLat, 0);
  const dx = br.x - tl.x || 1e-12;
  const dy = br.y - tl.y || 1e-12;
  const scale = Math.min(wPt / dx, hPt / dy);
  const offX = (wPt - dx * scale) / 2;
  const offY = (hPt - dy * scale) / 2;
  return (lon, lat) => {
    const p = lonLatToWorld(lon, lat, 0);
    return { x: offX + (p.x - tl.x) * scale, y: offY + (p.y - tl.y) * scale };
  };
}

/** Largeur métrique réelle (m) couverte par la bbox à sa latitude médiane. */
export function bboxWidthMeters(bbox) {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  return (bbox.maxLon - bbox.minLon) * 111320 * Math.cos((midLat * Math.PI) / 180);
}

/**
 * Barre d'échelle « ronde » (1/2/5 × 10ⁿ m) pour une carte affichant `bbox` sur `wPt`
 * points de large : vise ~1/4 de la largeur. → { meters, lengthPt, label }.
 */
export function metricScale(bbox, wPt) {
  const metersWidth = bboxWidthMeters(bbox);
  if (!(metersWidth > 0)) return null;
  const target = metersWidth / 4;
  const pow = 10 ** Math.floor(Math.log10(target));
  let meters = pow;
  for (const m of [1, 2, 5, 10]) {
    if (m * pow <= target) meters = m * pow;
  }
  const lengthPt = (meters / metersWidth) * wPt;
  return { meters, lengthPt, label: meters >= 1000 ? `${meters / 1000} km` : `${meters} m` };
}

/**
 * Géométrie GeoJSON (Polygon | MultiPolygon) → anneaux projetés [{x,y}, …][].
 * Seuls les anneaux extérieurs + trous sont retournés, dans l'ordre GeoJSON.
 */
export function polygonToRings(geometry, projector) {
  if (!geometry) return [];
  const polys = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      rings.push(ring.map(([lon, lat]) => projector(lon, lat)));
    }
  }
  return rings;
}

/** Anneaux projetés → attribut `d` d'un <Path> SVG (M/L/Z par anneau). */
export function ringsToSvgPath(rings) {
  return (rings ?? [])
    .filter((r) => r.length > 1)
    .map((r) => `M ${r.map((p) => `${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`).join(' L ')} Z`)
    .join(' ');
}

/** Centroïde simple (moyenne des sommets) d'anneaux projetés — pour poser une étiquette. */
export function ringsCentroid(rings) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const r of rings ?? []) {
    for (const p of r) {
      sx += p.x;
      sy += p.y;
      n += 1;
    }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}
