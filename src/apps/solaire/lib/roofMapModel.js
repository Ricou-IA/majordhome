// src/apps/solaire/lib/roofMapModel.js
// Modèle de la vue satellite du toit (fond Mapbox Static + vecteurs projetés) —
// partagé entre le plan de masse DPC2 (dossier DP) et la page « plan de votre toit »
// de l'étude PDF. Fail-loud : throw si aucune géométrie ou fond indisponible —
// le caller décide (bloquant pour la pièce DP, optionnel pour l'étude).
import {
  computeBbox, mapboxStaticBbox, fitZoom, makeProjector, metricScale,
  polygonToRings, ringsToSvgPath, ringsCentroid,
} from './geoProject';
import { fetchStaticMapDataUrl, MAPBOX_STYLE_SATELLITE } from './mapboxStatic';

const IMG_W = 1000; // px logiques Static API (l'@2x double la densité, pas l'emprise)
const DEFAULT_MAX_ZOOM = 19; // au-delà, l'ortho satellite n'apporte plus de détail fiable

/**
 * @param {object} p
 * @param {{ lat?: number, lon?: number }} [p.location] fallback de centrage
 * @param {object} [p.cadastre] bloc dossier (geojson.features = parcelles)
 * @param {object} [p.roofGeometry] bloc dossier (pans[].polygon si cartographiés)
 * @param {number} [p.panelsCount] annotation « N modules PV »
 * @param {number} p.wPt largeur d'affichage PDF (pt) — la hauteur suit le ratio demandé
 * @param {number} p.hPt hauteur d'affichage PDF (pt)
 * @returns {Promise<{ mapDataUrl, parcelPaths, panPaths, pvLabel, scale, hasPans, wPt, hPt }>}
 */
export async function buildSatelliteRoofModel({ location, cadastre, roofGeometry, panelsCount, wPt, hPt }) {
  const parcelFeatures = cadastre?.geojson?.features ?? [];
  const panPolygons = (roofGeometry?.pans ?? []).map((p) => p.polygon).filter(Boolean);
  const all = [...parcelFeatures, ...panPolygons];
  if (!all.length && !(location?.lat != null && location?.lon != null)) {
    throw new Error('Vue du toit : aucune géométrie (parcelle ou pans)');
  }

  const imgH = Math.round((IMG_W * hPt) / wPt);
  const bbox = computeBbox(all, 0.18)
    ?? computeBbox([{ type: 'Point', coordinates: [location.lon, location.lat] }], 0);
  const center = { lon: (bbox.minLon + bbox.maxLon) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 };
  const zoom = Math.min(DEFAULT_MAX_ZOOM, all.length ? fitZoom(bbox, IMG_W, imgH, DEFAULT_MAX_ZOOM) : DEFAULT_MAX_ZOOM);

  const mapDataUrl = await fetchStaticMapDataUrl({
    style: MAPBOX_STYLE_SATELLITE, lon: center.lon, lat: center.lat, zoom, wPx: IMG_W, hPx: imgH,
  });
  const imgBbox = mapboxStaticBbox(center.lon, center.lat, zoom, IMG_W, imgH);
  const project = makeProjector(imgBbox, wPt, hPt);

  const parcelPaths = parcelFeatures
    .map((f) => ringsToSvgPath(polygonToRings(f.geometry, project)))
    .filter(Boolean);
  const panRings = panPolygons.map((g) => polygonToRings(g, project));
  const panPaths = panRings.map(ringsToSvgPath).filter(Boolean);
  const pvCenter = ringsCentroid(panRings.flat());

  return {
    mapDataUrl,
    parcelPaths,
    panPaths,
    pvLabel: pvCenter && panelsCount ? { ...pvCenter, text: `${panelsCount} modules PV` } : null,
    scale: metricScale(imgBbox, wPt),
    hasPans: panPaths.length > 0,
    wPt,
    hPt,
  };
}
