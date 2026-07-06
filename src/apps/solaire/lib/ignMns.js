// src/apps/solaire/lib/ignMns.js
// Récupère le MNS IGN LiDAR HD (élévation) sur l'emprise d'un polygone toit tracé, décode en
// navigateur, et ajuste un plan → pente/orientation/surface réelles du pan (source fraîche 2025,
// indépendante de la détection Google). Passe par l'edge ign-mns-proxy (CORS + auth).
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import * as turf from '@turf/turf';
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';
import { fitRoofPlane } from './planeFit';

// Lambert-93 (EPSG:2154) — def standard IGN.
proj4.defs('EPSG:2154',
  '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 '
  + '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const toL93 = proj4('WGS84', 'EPSG:2154'); // forward([lon,lat]) → [E, N]

const PX = 0.5;        // résolution MNS (m)
const PAD_M = 2;       // marge autour du toit (m)
const MAX_DIM = 800;   // garde-fou taille raster

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Géométrie d'un pan depuis son polygone tracé (GeoJSON WGS84, Feature ou geometry Polygon).
 * → { data: { source:'ign'|'none'|'error', pitchDeg, pitchPercent, aspectPvgis, azimuthCompass,
 *     slopeAreaM2, footprintM2, nPoints, residualRms }, error }
 */
export async function fetchRoofPlaneFromIgn(polygon) {
  try {
    const geom = polygon?.geometry ?? polygon;
    const ringWgs = geom?.coordinates?.[0];
    if (!ringWgs || ringWgs.length < 4) return { data: { source: 'error' }, error: new Error('polygone invalide') };

    // Anneau en Lambert-93 + bbox.
    const ringL93 = ringWgs.map(([lon, lat]) => toL93.forward([lon, lat]));
    let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
    for (const [E, N] of ringL93) { minE = Math.min(minE, E); minN = Math.min(minN, N); maxE = Math.max(maxE, E); maxN = Math.max(maxN, N); }
    minE -= PAD_M; minN -= PAD_M; maxE += PAD_M; maxN += PAD_M;
    let width = Math.ceil((maxE - minE) / PX);
    let height = Math.ceil((maxN - minN) / PX);
    if (width > MAX_DIM || height > MAX_DIM) {
      // toit énorme : borne la résolution (rare)
      const k = Math.max(width, height) / MAX_DIM;
      width = Math.round(width / k); height = Math.round(height / k);
    }
    const bboxL93 = [minE, minN, maxE, maxN];

    const { data, error } = await supabase.functions.invoke('ign-mns-proxy', {
      body: { bboxL93, width, height },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data?.mnsTiff) return { data: { source: 'none' }, error: null };

    // Décodage GeoTIFF → grille d'élévation.
    const tiff = await fromArrayBuffer(b64ToArrayBuffer(data.mnsTiff));
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const elev = rasters[0];
    const W = image.getWidth(), H = image.getHeight();
    const [bMinE, bMinN, bMaxE, bMaxN] = data.bboxL93 ?? bboxL93;
    const pxE = (bMaxE - bMinE) / W;
    const pxN = (bMaxN - bMinN) / H;

    // Polygone L93 pour test d'appartenance (turf en planaire).
    const polyL93 = turf.polygon([ringL93]);

    // Points (x=E, y=N, z) dont le centre pixel est DANS le toit et dont z est plausible.
    const points = [];
    for (let row = 0; row < H; row++) {
      const N = bMaxN - (row + 0.5) * pxN; // ligne 0 = haut = maxN
      for (let col = 0; col < W; col++) {
        const E = bMinE + (col + 0.5) * pxE;
        const z = elev[row * W + col];
        if (!Number.isFinite(z) || z < -100 || z > 5000) continue;
        if (turf.booleanPointInPolygon([E, N], polyL93)) points.push({ x: E, y: N, z });
      }
    }
    if (points.length < 5) return { data: { source: 'none' }, error: null }; // pas assez de pixels toit

    const fit = fitRoofPlane(points);
    if (!fit) return { data: { source: 'none' }, error: null };

    // Surface pentée = empreinte / cos(pente). Empreinte via turf sur le polygone WGS84.
    const footprintM2 = turf.area(geom);
    const slopeAreaM2 = footprintM2 / Math.cos((fit.pitchDeg * Math.PI) / 180);
    logger.info('[ign] plane', { pitch: fit.pitchDeg, aspect: fit.aspectPvgis, rms: fit.residualRms, n: fit.nPoints });
    return {
      data: {
        source: 'ign',
        pitchDeg: fit.pitchDeg, pitchPercent: fit.pitchPercent,
        aspectPvgis: fit.aspectPvgis, azimuthCompass: fit.azimuthCompass,
        slopeAreaM2, footprintM2, nPoints: fit.nPoints, residualRms: fit.residualRms,
      },
      error: null,
    };
  } catch (err) {
    logger.error('[ign] fetchRoofPlaneFromIgn', err);
    return { data: { source: 'error' }, error: err };
  }
}
