// src/apps/solaire/lib/googleSolar.js
// Accès Google Solar via l'edge google-solar-proxy (clé edge-only). Repli manuel si 404/hors couverture.
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';
import { googleAzimuthToPvgisAspect } from './pvEngine';

/**
 * Géométrie de toiture Google Solar (buildingInsights).
 * → { data: { source:'google_solar'|'manual', imageryQuality, segments, dominant, fluxImagePath }, error }
 *   dominant = { pitch_deg, azimuth_google_deg, aspect_pvgis, area_m2 } ou null.
 *   source==='manual' (avec data non-null) = repli silencieux (404/hors couverture) : l'UI garde la saisie.
 */
export async function fetchBuildingInsights({ lat, lon, requiredQuality = 'MEDIUM' }) {
  try {
    const { data, error } = await supabase.functions.invoke('google-solar-proxy', {
      body: { mode: 'building_insights', lat, lon, requiredQuality },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.notFound) {
      return { data: { source: 'manual', imageryQuality: null, segments: [], dominant: null, fluxImagePath: null }, error: null };
    }
    const bi = data?.buildingInsights;
    const d = bi?.dominant
      ? {
          pitch_deg: bi.dominant.pitch_deg,
          azimuth_google_deg: bi.dominant.azimuth_google_deg,
          aspect_pvgis: bi.dominant.azimuth_google_deg != null
            ? googleAzimuthToPvgisAspect(bi.dominant.azimuth_google_deg)
            : 0,
          area_m2: bi.dominant.area_m2,
        }
      : null;
    // Cas pan plat (spec §5.1) : pente ~0 → ne pas propager l'azimut arbitraire, forcer Sud (aspect 0).
    if (d && (d.pitch_deg == null || d.pitch_deg < 1)) {
      d.pitch_deg = 0;
      d.aspect_pvgis = 0;
    }
    return {
      data: {
        source: 'google_solar',
        imageryQuality: data?.imageryQuality ?? bi?.imageryQuality ?? null,
        segments: bi?.segments ?? [],
        dominant: d,
        fluxImagePath: data?.fluxImagePath ?? null,
      },
      error: null,
    };
  } catch (err) {
    logger.error('[googleSolar] fetchBuildingInsights', err);
    // Échec réseau/quota → repli manuel silencieux, jamais bloquant (spec §5.3).
    return { data: { source: 'manual', imageryQuality: null, segments: [], dominant: null, fluxImagePath: null }, error: err };
  }
}

/** Heatmap de flux (dataLayers) → { data: { fluxImagePath: string|null }, error }. Non bloquant. */
export async function fetchFluxHeatmap({ lat, lon }) {
  try {
    const { data, error } = await supabase.functions.invoke('google-solar-proxy', {
      body: { mode: 'data_layers', lat, lon },
    });
    if (error) throw error;
    return { data: { fluxImagePath: data?.fluxImagePath ?? null }, error: null };
  } catch (err) {
    logger.error('[googleSolar] fetchFluxHeatmap', err);
    return { data: { fluxImagePath: null }, error: err };
  }
}
