/**
 * DpeNeighbourhoodMap.jsx — Carte interactive des DPE du voisinage
 * ============================================================================
 * Affiche l'adresse de la fiche (repère bleu) et TOUS les DPE trouvés alentour
 * (repères ambre numérotés). Cliquer un repère sélectionne le DPE correspondant
 * dans la liste en dessous.
 *
 * ⚠️ **Pas de contour cadastral.** Tenté puis retiré le 2026-08-12 : les
 * coordonnées d'un DPE viennent de la BAN, donc de l'axe de la voie, et non du
 * bâtiment. `fetchParcelleAtPoint` renvoie alors la parcelle de la VOIRIE —
 * vérifié à Pechbonnieu, où « AM 0078 · 2056 m² » dessinait la rue elle-même.
 * Une référence cadastrale a l'air officielle : en afficher une qui désigne le
 * bitume est pire que de n'en afficher aucune. Pour identifier le bâti, il
 * faudrait une emprise de bâtiment (BDNB / BD TOPO), pas une parcelle.
 *
 * `mapbox-gl` en direct, comme `TerritoireMap` (pas react-map-gl : c'est le
 * pattern déjà en place dans le projet).
 * ============================================================================
 */

import { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_CONFIG } from '@/lib/mapbox';

const CLIENT_COLOR = '#2563eb'; // bleu — repère de référence
const DPE_COLOR = '#f59e0b'; // ambre — palette deutan, jamais rouge/vert
const DPE_SELECTED = '#b45309';

/**
 * Marqueur en DEUX éléments : une racine que Mapbox positionne, et une pastille
 * interne que nous stylons.
 *
 * ⚠️ **Ne jamais écrire dans `style.transform` de la racine.** Mapbox y place
 * son `translate(...)` de positionnement ; l'écraser (ne serait-ce que par un
 * `scale()` de mise en évidence) renvoie le marqueur au coin haut-gauche du
 * conteneur et casse la carte. Vécu le 2026-08-12 : sélectionner un repère
 * faisait « disparaître » tous les autres.
 *
 * @returns {{root: HTMLElement, dot: HTMLElement}}
 */
function markerElement({ label, color, size, title }) {
  const root = document.createElement('div');
  root.title = title;
  root.style.cursor = 'pointer';

  const dot = document.createElement('div');
  dot.style.cssText = [
    `width:${size}px`, `height:${size}px`, 'border-radius:9999px',
    `background:${color}`, 'border:2px solid #fff', 'box-shadow:0 1px 4px rgba(0,0,0,.4)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'color:#fff', 'font-size:11px', 'font-weight:700', 'font-family:system-ui,sans-serif',
    'transition:transform .12s ease, background .12s ease',
  ].join(';');
  dot.textContent = label;

  root.appendChild(dot);
  return { root, dot };
}

/**
 * @param {object[]} records    DPE à placer (ceux qui ont des coordonnées)
 * @param {object}   clientPoint {lon, lat} adresse de la fiche
 * @param {string}   selectedId  id du DPE sélectionné
 * @param {Function} onSelect    (recordId) => void
 */
export function DpeNeighbourhoodMap({ records = [], clientPoint, selectedId, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  // Gardé dans une ref pour que le handler de clic reste valide sans recréer la carte
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const placeable = records.filter((r) => Number.isFinite(r.lon) && Number.isFinite(r.lat));

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_CONFIG.accessToken) return undefined;
    if (placeable.length === 0 && !clientPoint) return undefined;

    mapboxgl.accessToken = MAPBOX_CONFIG.accessToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [clientPoint?.lon ?? placeable[0].lon, clientPoint?.lat ?? placeable[0].lat],
      zoom: 17,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    const bounds = new mapboxgl.LngLatBounds();

    if (clientPoint) {
      const { root } = markerElement({
        label: '', color: CLIENT_COLOR, size: 16, title: 'Adresse de la fiche',
      });
      new mapboxgl.Marker({ element: root }).setLngLat([clientPoint.lon, clientPoint.lat]).addTo(map);
      bounds.extend([clientPoint.lon, clientPoint.lat]);
    }

    markersRef.current = placeable.map((r, i) => {
      const { root, dot } = markerElement({
        label: String(i + 1),
        color: DPE_COLOR,
        size: 24,
        title: r.rawAddress || r.address || `DPE ${i + 1}`,
      });
      root.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectRef.current?.(r.id);
      });
      new mapboxgl.Marker({ element: root }).setLngLat([r.lon, r.lat]).addTo(map);
      bounds.extend([r.lon, r.lat]);
      // On ne conserve que `dot` : la racine appartient à Mapbox.
      return { id: r.id, dot };
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 56, maxZoom: 19, duration: 0 });
    }

    return () => {
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // Les coordonnées définissent la carte : on la reconstruit si elles changent,
    // pas à chaque changement de sélection (géré dans l'effet suivant).
  }, [placeable.map((r) => `${r.id}:${r.lon},${r.lat}`).join('|'), clientPoint?.lon, clientPoint?.lat]);

  // Mise en évidence du repère sélectionné. La carte ne bouge PAS : la vue
  // d'ensemble des diagnostics doit rester lisible pendant qu'on les parcourt.
  // Le style va sur la pastille interne, jamais sur la racine (cf. markerElement).
  useEffect(() => {
    for (const m of markersRef.current) {
      const on = m.id === selectedId;
      m.dot.style.background = on ? DPE_SELECTED : DPE_COLOR;
      m.dot.style.transform = on ? 'scale(1.3)' : 'scale(1)';
      m.dot.style.boxShadow = on
        ? '0 0 0 3px rgba(180,83,9,.35), 0 1px 4px rgba(0,0,0,.4)'
        : '0 1px 4px rgba(0,0,0,.4)';
    }
  }, [selectedId]);

  if (!MAPBOX_CONFIG.accessToken || (placeable.length === 0 && !clientPoint)) return null;

  return (
    <div>
      <div
        ref={containerRef}
        className="w-full h-56 rounded-lg overflow-hidden border border-secondary-200"
      />
      <p className="mt-1.5 text-xs text-secondary-500">
        <span className="inline-block w-2 h-2 rounded-full align-middle" style={{ background: CLIENT_COLOR }} />
        {' '}adresse de la fiche{'  ·  '}
        <span className="inline-block w-2.5 h-2.5 rounded-full align-middle" style={{ background: DPE_COLOR }} />
        {' '}diagnostics du secteur — cliquez un repère pour voir le détail
      </p>
    </div>
  );
}
