// src/apps/solaire/components/dossier/CadastreSection.jsx
// Capture cadastre write-once à la géolocalisation (spec tranche 1 §5.4) : parcelle(s)
// contenant le point auto-sélectionnée(s), voisines cliquables sur carte satellite
// (une propriété peut chevaucher plusieurs parcelles — le CERFA exige TOUTES les références),
// + statut ABF via GPU. Fail-loud : échec GPU = « à vérifier manuellement », jamais un faux
// « non protégé ». Remonté via key={lat,lon} par le parent (état neuf à chaque lieu).
import { useState, useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Landmark, Loader2, AlertTriangle, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { MAPBOX_CONFIG } from '@/lib/mapbox';
import { logger } from '@lib/logger';
import { fetchParcelleAtPoint, fetchParcellesAround, fetchAbfAtPoint } from '../../lib/cadastre';

const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
const CERFA_MAX_PARCELLES = 3;

const fmtM2 = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} m²`);

export default function CadastreSection({ location, cadastre, abf, onCadastre, onAbf }) {
  const selected = cadastre ?? [];
  const [around, setAround] = useState([]); // parcelles voisines (UI locale, non persistée)
  const [status, setStatus] = useState('loading'); // loading | ok | empty | error
  const [abfStatus, setAbfStatus] = useState(abf ? 'ok' : 'loading'); // loading | ok | error

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onCadastreRef = useRef(onCadastre);
  onCadastreRef.current = onCadastre;

  // Fetch parcelles (au point + voisines) + ABF. La sélection déjà en state (brouillon
  // restauré) est conservée — on ne re-sélectionne au point que si rien n'est sélectionné.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [atPoint, near] = await Promise.all([
          fetchParcelleAtPoint(location.lon, location.lat),
          fetchParcellesAround(location.lon, location.lat, 45),
        ]);
        if (cancelled) return;
        // Voisines ∪ parcelles au point (dédup par idu) — toutes cliquables sur la carte.
        const byIdu = new Map([...near, ...atPoint].map((p) => [p.idu, p]));
        setAround([...byIdu.values()]);
        if (!selectedRef.current.length && atPoint.length) {
          onCadastreRef.current(atPoint);
        }
        setStatus(byIdu.size ? 'ok' : 'empty');
      } catch (err) {
        if (cancelled) return;
        logger.error('[solaire] cadastre apicarto', err);
        setStatus('error');
      }
    })();
    if (!abf) {
      (async () => {
        try {
          const summary = await fetchAbfAtPoint(location.lon, location.lat);
          if (cancelled) return;
          onAbf(summary);
          setAbfStatus('ok');
        } catch (err) {
          if (cancelled) return;
          logger.error('[solaire] ABF GPU', err);
          setAbfStatus('error');
        }
      })();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.lat, location.lon]);

  const toggleParcelle = (idu) => {
    const cur = selectedRef.current;
    if (cur.some((p) => p.idu === idu)) {
      onCadastreRef.current(cur.filter((p) => p.idu !== idu));
    } else {
      const found = around.find((p) => p.idu === idu);
      if (found) onCadastreRef.current([...cur, found]);
    }
  };
  const toggleRef = useRef(toggleParcelle);
  toggleRef.current = toggleParcelle;

  // Carte : parcelles voisines en liseré, sélectionnées en jaune, clic = toggle.
  // ⚠️ Le container n'est rendu QUE quand status==='ok' → l'init doit se déclencher sur [status]
  // (avec deps [], l'effet tournerait pendant 'loading' sur un containerRef null et la carte ne
  // serait JAMAIS créée). Idempotent via mapRef ; status est terminal après 'ok'.
  useEffect(() => {
    if (status !== 'ok' || mapRef.current || !containerRef.current || !MAPBOX_CONFIG.accessToken || location.lat == null) return undefined;
    mapboxgl.accessToken = MAPBOX_CONFIG.accessToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [location.lon, location.lat],
      zoom: 17.5,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('parcelles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'parcelles-fill', type: 'fill', source: 'parcelles', paint: { 'fill-color': '#FFFFFF', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'parcelles-line', type: 'line', source: 'parcelles', paint: { 'line-color': '#FFFFFF', 'line-width': 1.5, 'line-dasharray': [2, 1.5] } });
      map.addLayer({
        id: 'parcelles-selected-fill', type: 'fill', source: 'parcelles',
        paint: { 'fill-color': '#F5C542', 'fill-opacity': 0.35 }, filter: ['in', ['get', 'idu'], ['literal', []]],
      });
      map.addLayer({
        id: 'parcelles-selected-line', type: 'line', source: 'parcelles',
        paint: { 'line-color': '#B45309', 'line-width': 2.5 }, filter: ['in', ['get', 'idu'], ['literal', []]],
      });
      map.addLayer({
        id: 'parcelles-labels', type: 'symbol', source: 'parcelles',
        layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-allow-overlap': false },
        paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#1F2937', 'text-halo-width': 1.2 },
      });
      map.on('click', 'parcelles-fill', (e) => {
        const idu = e.features?.[0]?.properties?.idu;
        if (idu) toggleRef.current(idu);
      });
      map.on('mouseenter', 'parcelles-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'parcelles-fill', () => { map.getCanvas().style.cursor = ''; });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Alimente la source (voisines) — attend le style prêt si l'init n'est pas finie.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('parcelles');
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: around
          .filter((p) => p.geometry)
          .map((p) => ({
            type: 'Feature',
            properties: { idu: p.idu, label: `${p.section} ${p.numero}` },
            geometry: p.geometry,
          })),
      });
    };
    if (map.getSource('parcelles')) apply(); else map.once('load', apply);
  }, [around]);

  // Surbrillance des sélectionnées (filtre par idu).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const idus = selected.map((p) => p.idu);
    const apply = () => {
      if (!map.getLayer('parcelles-selected-fill')) return;
      const filter = ['in', ['get', 'idu'], ['literal', idus]];
      map.setFilter('parcelles-selected-fill', filter);
      map.setFilter('parcelles-selected-line', filter);
    };
    if (map.getLayer('parcelles-selected-fill')) apply(); else map.once('load', apply);
  }, [selected]);

  const commune = selected[0] ?? around[0] ?? null;

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Landmark className="w-4 h-4 text-secondary-500" />
        <h2 className="font-semibold text-secondary-900">Parcelle cadastrale</h2>
        {commune && (
          <span className="text-xs text-secondary-500">
            {commune.nom_com} ({commune.code_insee})
          </span>
        )}
      </div>
      <p className="text-xs text-secondary-500">
        Références requises pour la déclaration préalable. La parcelle du logement est
        pré-sélectionnée — cliquez les parcelles voisines si la propriété en couvre plusieurs.
      </p>

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-secondary-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Recherche de la parcelle…
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-secondary-800 bg-secondary-100 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Cadastre indisponible (apicarto IGN) — les références seront à saisir au dossier.
        </div>
      )}
      {status === 'empty' && (
        <div className="flex items-center gap-2 text-sm text-secondary-800 bg-secondary-100 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Aucune parcelle trouvée à ce point (domaine public ?) — affinez la position.
        </div>
      )}

      {(status === 'ok') && (
        <>
          <div ref={containerRef} className="w-full h-56 rounded-lg overflow-hidden border border-secondary-200" />
          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selected.map((p) => (
                <span
                  key={p.idu}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#F5C542] bg-amber-50 px-2.5 py-1 text-xs font-medium text-[#B45309]"
                >
                  {p.section} {p.numero} · {fmtM2(p.superficie_m2)}
                  <button
                    type="button"
                    onClick={() => toggleParcelle(p.idu)}
                    className="hover:text-secondary-900"
                    aria-label={`Retirer la parcelle ${p.section} ${p.numero}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-secondary-500">Aucune parcelle sélectionnée — cliquez-en une sur la carte.</p>
          )}
          {selected.length > CERFA_MAX_PARCELLES && (
            <div className="flex items-center gap-2 text-xs text-secondary-800 bg-secondary-100 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              Le CERFA ne porte que {CERFA_MAX_PARCELLES} références — les suivantes exigeront une fiche complémentaire papier.
            </div>
          )}
        </>
      )}

      {/* Statut ABF (GPU) — 3 états, jamais de faux « non protégé » */}
      {abfStatus === 'loading' && !abf && (
        <div className="flex items-center gap-2 text-sm text-secondary-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Vérification secteur protégé (GPU)…
        </div>
      )}
      {abfStatus === 'error' && !abf && (
        <div className="flex items-center gap-2 text-sm text-secondary-800 bg-secondary-100 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Vérification ABF indisponible — statut secteur protégé à contrôler manuellement.
        </div>
      )}
      {abf && abf.secteur_protege && (
        <div className="flex items-start gap-2 text-sm text-[#B45309] bg-amber-50 border border-[#F5C542] rounded-lg px-3 py-2">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <span className="font-medium">Secteur protégé — avis ABF probable.</span>{' '}
            {abf.protections.map((p) => p.nom).filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
      {abf && !abf.secteur_protege && (
        <div className="flex items-center gap-2 text-sm text-secondary-600 bg-secondary-50 rounded-lg px-3 py-2">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          Aucune protection patrimoniale recensée au Géoportail de l'Urbanisme.
        </div>
      )}
    </div>
  );
}
