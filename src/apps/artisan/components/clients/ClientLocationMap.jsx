/**
 * ClientLocationMap.jsx — Carte de l'adresse du client (fiche client, onglet Infos)
 * ============================================================================
 * Deux repères : le client (bleu) et le siège de l'org (ardoise, réglage
 * Organisation → Territoire). Zoom +/− via NavigationControl.
 *
 * Position du client, dans l'ordre :
 *  1. coordonnées ENREGISTRÉES (géocodage serveur / saisie BAN), tant que
 *     l'adresse affichée est celle enregistrée ;
 *  2. sinon (adresse modifiée, ou jamais géocodée) : estimation BAN en direct
 *     de l'adresse saisie, puis repli sur la commune — toujours signalée
 *     comme estimée, rien n'est écrit en base.
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Loader2 } from 'lucide-react';
import { MAPBOX_CONFIG } from '@/lib/mapbox';
import { haversineKm } from '@/lib/sectorClustering';
import { geocodeAddress, geocodeCommune } from '@services/geocoding.service';

const CLIENT_COLOR = '#2563eb'; // bleu
const SIEGE_COLOR = '#475569'; // ardoise — palette deutan, jamais rouge/vert

/** Racine positionnée par Mapbox + pastille stylée (ne jamais toucher style.transform de la racine). */
function markerElement(color, title) {
  const root = document.createElement('div');
  root.title = title;
  const dot = document.createElement('div');
  dot.style.cssText = `width:16px;height:16px;border-radius:9999px;background:${color};`
    + 'border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)';
  root.appendChild(dot);
  return root;
}

function coordOk(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat !== null && lng !== null;
}

/**
 * Position du client : enregistrée si l'adresse n'a pas bougé, sinon estimée en direct.
 * @returns {{ point: {lat:number,lng:number}|null, source: 'enregistree'|'adresse'|'commune'|'introuvable'|null, isLoading: boolean }}
 */
function useClientPoint({ saved, savedAddress, address, postalCode, city }) {
  const memeAdresse = savedAddress
    && savedAddress.address === address && savedAddress.postalCode === postalCode && savedAddress.city === city;
  const enregistree = memeAdresse && coordOk(saved?.lat, saved?.lng)
    ? { lat: Number(saved.lat), lng: Number(saved.lng) } : null;
  const [estime, setEstime] = useState({ cle: null, point: null, source: null });
  const cle = `${address}|${postalCode}|${city}`;

  useEffect(() => {
    if (enregistree) return undefined;
    if (!`${address}${postalCode}${city}`.trim()) return undefined;
    let annule = false;
    const t = setTimeout(async () => {
      const a = await geocodeAddress(address, postalCode, city);
      if (annule) return;
      if (a) { setEstime({ cle, point: { lat: a.lat, lng: a.lng }, source: 'adresse' }); return; }
      const c = await geocodeCommune(postalCode, city);
      if (annule) return;
      setEstime({ cle, point: c ? { lat: c.lat, lng: c.lng } : null, source: c ? 'commune' : 'introuvable' });
    }, 600);
    return () => { annule = true; clearTimeout(t); };
  }, [enregistree === null, cle]); // eslint-disable-line react-hooks/exhaustive-deps

  if (enregistree) return { point: enregistree, source: 'enregistree', isLoading: false };
  if (!`${address}${postalCode}${city}`.trim()) return { point: null, source: null, isLoading: false };
  if (estime.cle !== cle) return { point: null, source: null, isLoading: true };
  return { point: estime.point, source: estime.source, isLoading: false };
}

const LEGENDE_SOURCE = {
  enregistree: null,
  adresse: 'Position estimée d’après l’adresse saisie (non enregistrée).',
  commune: 'Adresse introuvable : point placé au centre de la commune.',
  introuvable: 'Adresse et commune introuvables.',
};

/**
 * @param {object} props
 * @param {{lat:any,lng:any}|null} props.saved           coordonnées enregistrées du client
 * @param {{address:string,postalCode:string,city:string}|null} props.savedAddress  adresse enregistrée
 * @param {string} props.address
 * @param {string} props.postalCode
 * @param {string} props.city
 * @param {{lat:number,lng:number,label:string}|null} props.siege  getOrgHeadquarters(settings)
 * @param {string} [props.mapHeight]  classe de hauteur EXPLICITE de la carte (Mapbox a besoin d'une hauteur définie)
 */
export function ClientLocationMap({ saved, savedAddress, address, postalCode, city, siege, mapHeight = 'h-[300px]' }) {
  const containerRef = useRef(null);
  const { point, source, isLoading } = useClientPoint({ saved, savedAddress, address, postalCode, city });

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_CONFIG.accessToken) return undefined;
    if (!point && !siege) return undefined;
    mapboxgl.accessToken = MAPBOX_CONFIG.accessToken;
    const centre = point || siege;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [centre.lng, centre.lat],
      zoom: 11,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    const bounds = new mapboxgl.LngLatBounds();
    if (siege) {
      new mapboxgl.Marker({ element: markerElement(SIEGE_COLOR, siege.label) })
        .setLngLat([siege.lng, siege.lat]).addTo(map);
      bounds.extend([siege.lng, siege.lat]);
    }
    if (point) {
      new mapboxgl.Marker({ element: markerElement(CLIENT_COLOR, 'Client') })
        .setLngLat([point.lng, point.lat]).addTo(map);
      bounds.extend([point.lng, point.lat]);
    }
    if (point && siege) map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
    return () => map.remove();
  }, [point?.lat, point?.lng, siege?.lat, siege?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!MAPBOX_CONFIG.accessToken) {
    return <p className="text-xs text-secondary-500">Carte indisponible (jeton Mapbox absent).</p>;
  }

  const km = point && siege ? Math.round(haversineKm(point, siege)) : null;
  const legende = source ? LEGENDE_SOURCE[source] : null;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className={`relative ${mapHeight} overflow-hidden rounded-lg border border-secondary-200 bg-secondary-50`}>
        {/* Pas d'`absolute` ici : la classe .mapboxgl-map force position:relative → hauteur nulle. */}
        <div ref={containerRef} className="h-full w-full" />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-secondary-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Localisation…
          </div>
        )}
        {!isLoading && !point && !siege && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-secondary-500">
            Saisissez une adresse pour la voir sur la carte.
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: CLIENT_COLOR }} /> Client
        </span>
        {siege && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SIEGE_COLOR }} /> {siege.label}
          </span>
        )}
        {km !== null && <span>{km} km à vol d’oiseau</span>}
      </div>
      {legende && <p className="text-xs text-amber-700">{legende}</p>}
      {!siege && (
        <p className="text-xs text-secondary-500">Siège non configuré (Réglages → Organisation → Territoire).</p>
      )}
    </div>
  );
}

export default ClientLocationMap;
