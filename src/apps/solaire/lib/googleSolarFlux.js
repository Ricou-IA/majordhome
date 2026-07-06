// src/apps/solaire/lib/googleSolarFlux.js
// Décode le GeoTIFF flux Google DANS LE NAVIGATEUR (contourne le node:vm de l'edge),
// reprojette la bbox en WGS84 (recette du sample officiel js-solar-potential), colorise
// (ironPalette + masque toit) → image PNG + coins lng/lat pour un overlay Mapbox.
//
// Recette officielle mirroir : googlemaps-samples/js-solar-potential src/routes/solar.ts
//   (downloadGeoTIFF) + src/routes/visualize.ts (renderPalette / renderRGB).
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import * as geokeysToProj4 from 'geotiff-geokeys-to-proj4';
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';

// ironPalette officielle Google (annualFlux). min 0 / max 1800 kWh/kW/an (doc Solar API).
const RAMP = [[0x00, 0x00, 0x0A], [0x91, 0x00, 0x9C], [0xE6, 0x46, 0x16], [0xFE, 0xB4, 0x00], [0xFF, 0xFF, 0xF6]];
const MAX_FLUX = 1800;

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function ramp(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[Math.min(i + 1, RAMP.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

async function readTiff(buf) {
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  return { image, data: rasters[0], width: image.getWidth(), height: image.getHeight() };
}

/**
 * → { data: { source, imageUrl, coordinates:[[lng,lat]×4 TL,TR,BR,BL], width, height, imageryQuality }, error }
 * coordinates dans l'ordre attendu par une image source Mapbox : top-left, top-right, bottom-right, bottom-left.
 * source === 'none' si pas de couverture (notFound), 'error' si échec décodage/réseau.
 */
export async function fetchFluxOverlay({ lat, lon }) {
  try {
    const { data, error } = await supabase.functions.invoke('google-solar-proxy', {
      body: { mode: 'data_layers_raw', lat, lon },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.notFound) return { data: { source: 'none' }, error: null };

    const flux = await readTiff(b64ToArrayBuffer(data.fluxTiff));
    const mask = await readTiff(b64ToArrayBuffer(data.maskTiff));

    // ── Reprojection bbox → WGS84 (recette officielle downloadGeoTIFF) ────────────────────
    // toProj4(geoKeys) → { proj4:string, coordinatesConversionParameters:{x,y}, ... }.
    // On multiplie la bbox par les params d'unité puis proj4 .forward({x,y}) → {x:lng, y:lat}.
    const geoKeys = flux.image.getGeoKeys();
    const projObj = geokeysToProj4.toProj4(geoKeys);
    const projection = proj4(projObj.proj4, 'WGS84');
    const box = flux.image.getBoundingBox(); // [minX, minY, maxX, maxY] dans le CRS du TIFF
    const ccp = projObj.coordinatesConversionParameters || { x: 1, y: 1 };
    const sw = projection.forward({ x: box[0] * ccp.x, y: box[1] * ccp.y }); // { x:lng, y:lat }
    const ne = projection.forward({ x: box[2] * ccp.x, y: box[3] * ccp.y });
    const west = sw.x, south = sw.y, east = ne.x, north = ne.y;
    logger.info('[flux] CRS/bbox', {
      proj4: projObj.proj4, coordConv: ccp, box,
      west, south, east, north,
      fluxWH: [flux.width, flux.height], maskWH: [mask.width, mask.height],
    });

    // ── Colorisation + masque → canvas RGBA (recette renderPalette/renderRGB) ──────────────
    // Le canvas prend les dimensions du MASK ; on ré-échantillonne le flux vers cette grille
    // (mêmes deltas dw/dh que renderRGB). Alpha = masque toit × opacité.
    const width = mask.width, height = mask.height;
    const dw = flux.width / width;
    const dh = flux.height / height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const maskIdx = y * width + x;
        const imgIdx = maskIdx * 4;
        const m = mask.data[maskIdx] ?? 0;
        if (!m) { img.data[imgIdx + 3] = 0; continue; }
        const fluxIdx = Math.floor(y * dh) * flux.width + Math.floor(x * dw);
        const [r, g, b] = ramp((flux.data[fluxIdx] ?? 0) / MAX_FLUX);
        img.data[imgIdx] = r;
        img.data[imgIdx + 1] = g;
        img.data[imgIdx + 2] = b;
        img.data[imgIdx + 3] = 220;
      }
    }
    ctx.putImageData(img, 0, 0);

    return {
      data: {
        source: 'google',
        imageUrl: canvas.toDataURL('image/png'),
        // Mapbox image source coordinates : [TL, TR, BR, BL] en [lng, lat].
        coordinates: [[west, north], [east, north], [east, south], [west, south]],
        width,
        height,
        imageryQuality: data.imageryQuality ?? null,
      },
      error: null,
    };
  } catch (err) {
    logger.error('[flux] fetchFluxOverlay', err);
    return { data: { source: 'error' }, error: err };
  }
}
