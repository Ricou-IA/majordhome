// src/apps/solaire/lib/googleSolar3D.js
// Récupère DSM + flux + masque Google Solar et les décode dans le navigateur (grille commune,
// aucun reprojection). Sert le viewer 3D (relief + heatmap drapée + mesure à l'échelle réelle).
import { fromArrayBuffer } from 'geotiff';
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function readBand(buf) {
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  return { data: rasters[0], width: image.getWidth(), height: image.getHeight() };
}

// Ré-échantillonne une bande (flux/mask) sur la grille DSM par plus-proche-voisin.
// N'est utilisé que si les dimensions diffèrent (elles devraient matcher au même pixelSizeMeters).
function resampleToGrid(band, targetW, targetH) {
  if (band.width === targetW && band.height === targetH) return band.data;
  const out = new Float64Array(targetW * targetH);
  const dw = band.width / targetW;
  const dh = band.height / targetH;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(band.width - 1, Math.floor(x * dw));
      const sy = Math.min(band.height - 1, Math.floor(y * dh));
      out[y * targetW + x] = band.data[sy * band.width + sx];
    }
  }
  return out;
}

/**
 * → { data: { source, dsm:Float array, flux, mask, width, height, pixelSizeMeters, imageryQuality }, error }
 * source==='none' si pas de couverture (notFound / réponse incomplète), 'error' si échec réseau/décodage.
 */
export async function fetchRoof3D({ lat, lon, pixelSizeMeters = 0.5 }) {
  try {
    const { data, error } = await supabase.functions.invoke('google-solar-proxy', {
      body: { mode: 'data_layers_raw', lat, lon, pixelSizeMeters },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.notFound) return { data: { source: 'none' }, error: null };
    if (!data?.dsmTiff || !data?.fluxTiff || !data?.maskTiff) {
      logger.warn('[roof3d] réponse incomplète — edge redéployé ?', data);
      return { data: { source: 'none' }, error: null };
    }
    const dsm = await readBand(b64ToArrayBuffer(data.dsmTiff));
    const flux = await readBand(b64ToArrayBuffer(data.fluxTiff));
    const mask = await readBand(b64ToArrayBuffer(data.maskTiff));

    // Grille de référence = DSM (le relief). flux/mask devraient matcher (même pas) ; sinon on
    // les ramène sur la grille DSM par plus-proche-voisin (et on le signale).
    if (flux.width !== dsm.width || flux.height !== dsm.height
      || mask.width !== dsm.width || mask.height !== dsm.height) {
      logger.warn('[roof3d] dimensions divergentes — resample sur grille DSM', {
        dsm: [dsm.width, dsm.height], flux: [flux.width, flux.height], mask: [mask.width, mask.height],
      });
    }
    const fluxData = resampleToGrid(flux, dsm.width, dsm.height);
    const maskData = resampleToGrid(mask, dsm.width, dsm.height);

    logger.info('[roof3d] decoded', { w: dsm.width, h: dsm.height, px: data.pixelSizeMeters });
    return {
      data: {
        source: 'google',
        dsm: dsm.data, flux: fluxData, mask: maskData,
        width: dsm.width, height: dsm.height,
        pixelSizeMeters: data.pixelSizeMeters ?? pixelSizeMeters,
        imageryQuality: data.imageryQuality ?? null,
        imageryDate: data.imageryDate ?? null,
      },
      error: null,
    };
  } catch (err) {
    logger.error('[roof3d] fetchRoof3D', err);
    return { data: { source: 'error' }, error: err };
  }
}
