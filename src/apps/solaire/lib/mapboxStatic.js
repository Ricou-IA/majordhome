// src/apps/solaire/lib/mapboxStatic.js
// Fond de carte Mapbox Static Images API → dataURL (react-pdf <Image src=dataURL>).
// Les vecteurs (parcelles, pans) sont superposés côté PDF via geoProject — on n'envoie
// JAMAIS de géométrie dans l'URL (pas de limite d'URL, alignement exact garanti).
// Fail-loud : tout échec réseau throw — le caller décide (pièce ignorée + signalée).
import { MAPBOX_CONFIG } from '@lib/mapbox';

export const MAPBOX_STYLE_STREETS = 'mapbox/streets-v12';
export const MAPBOX_STYLE_SATELLITE = 'mapbox/satellite-v9';

/** URL Static Images (image @2x, sans logo/attribution incrustés — mention au cartouche). */
export function mapboxStaticUrl({ style, lon, lat, zoom, wPx, hPx }) {
  const token = MAPBOX_CONFIG.accessToken;
  if (!token) throw new Error('Token Mapbox absent (VITE_MAPBOX_TOKEN)');
  const z = Math.round(zoom * 100) / 100;
  return `https://api.mapbox.com/styles/v1/${style}/static/${lon},${lat},${z}/${wPx}x${hPx}@2x`
    + `?access_token=${encodeURIComponent(token)}&attribution=false&logo=false`;
}

/** Fetch l'image de fond → dataURL. Throw si HTTP non-2xx (jamais de pièce muette). */
export async function fetchStaticMapDataUrl(params) {
  const res = await fetch(mapboxStaticUrl(params));
  if (!res.ok) throw new Error(`Fond de carte Mapbox indisponible (HTTP ${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Lecture du fond de carte impossible'));
    reader.readAsDataURL(blob);
  });
}
