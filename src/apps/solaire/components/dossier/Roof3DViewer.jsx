// src/apps/solaire/components/dossier/Roof3DViewer.jsx
// Viewer 3D toiture (modale plein écran) : maillage construit UNIQUEMENT à partir des pixels toit
// (masque Google Solar) — pas de terrain, pas de sol, pas de no-data. Heatmap flux drapée par
// sommet (ironPalette), mesure de distance au clic (2 points → mètres réels).
// Lazy-loadé (Three.js est lourd) → ne charge pas le bundle principal.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, RotateCcw } from 'lucide-react';
import { logger } from '@lib/logger';

// ironPalette officielle Google (annualFlux) — mêmes stops que googleSolarFlux.js. MAX_FLUX 1800.
const RAMP = [[0x00, 0x00, 0x0A], [0x91, 0x00, 0x9C], [0xE6, 0x46, 0x16], [0xFE, 0xB4, 0x00], [0xFF, 0xFF, 0xF6]];
const MAX_FLUX = 1800;
// DSM : sentinelle no-data = grande valeur négative. On garde le plausible [-100, 9000] m.
const MIN_PLAUSIBLE = -100;
const MAX_PLAUSIBLE = 9000;
// Clamp anti-pic : une toiture est à quelques → dizaines de mètres au-dessus de sa base.
const CLAMP_MIN = -5;
const CLAMP_MAX = 40;

function ramp(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[Math.min(i + 1, RAMP.length - 1)];
  return [
    (a[0] + (b[0] - a[0]) * f) / 255,
    (a[1] + (b[1] - a[1]) * f) / 255,
    (a[2] + (b[2] - a[2]) * f) / 255,
  ];
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const plausible = (h) => Number.isFinite(h) && h > MIN_PLAUSIBLE && h < MAX_PLAUSIBLE;

export default function Roof3DViewer({ roof, onClose }) {
  const mountRef = useRef(null);
  const [distance, setDistance] = useState(null); // mètres ; null = pas encore 2 points
  const [empty, setEmpty] = useState(false); // masque vide → pas de toit détecté
  const apiRef = useRef(null); // { resetMeasure } exposé par l'effet Three

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !roof?.dsm) return undefined;

    const { dsm, flux, mask, width: w, height: h, pixelSizeMeters: px } = roof;

    // ── Sélection des pixels toit : mask truthy ET DSM plausible ──────────────────────────
    // vertMap[i] = index du sommet (row-major i = y*w + x), -1 si non-toit.
    const n = w * h;
    const vertMap = new Int32Array(n).fill(-1);
    const roofDsm = [];
    for (let i = 0; i < n; i++) {
      if (mask?.[i] && plausible(dsm[i])) roofDsm.push(dsm[i]);
    }

    if (roofDsm.length === 0) {
      // Aucun pixel toit → on n'affiche rien, message dans la modale.
      logger.info('[roof3d] no roof pixels (mask empty or DSM invalid)', { w, h });
      setEmpty(true);
      return undefined;
    }
    setEmpty(false);

    // ── Baseline robuste = médiane des DSM toit (tue les pics résiduels via clamp) ─────────
    const sorted = roofDsm.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const rawMin = sorted[0];
    const rawMax = sorted[sorted.length - 1];
    logger.info('[roof3d] roof DSM range', {
      count: roofDsm.length, min: rawMin, max: rawMax, median,
      clamp: [CLAMP_MIN, CLAMP_MAX], w, h, px,
    });
    const baseH = median;

    // ── Construction des sommets (position + couleur) UNIQUEMENT pour les pixels toit ──────
    // Orientation : on place directement z = (y - h/2) * px et on couche le mesh via
    // rotation.x = -PI/2 (le plan XY → horizontal XZ). Row 0 du raster (haut) mappe à z le plus
    // négatif ; après rotation cela correspond au fond de la scène. DÉCISION v1 : pas de Y-flip
    // explicite. Si le rendu paraît miroir en test live, appliquer y -> (h-1-y). ⚠ à vérifier.
    const positions = [];
    const colors = [];
    let vCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!(mask?.[i] && plausible(dsm[i]))) continue;
        vertMap[i] = vCount++;
        const pxPos = (x - w / 2) * px;
        const pzPos = (y - h / 2) * px;
        const py = clamp(dsm[i] - baseH, CLAMP_MIN, CLAMP_MAX);
        positions.push(pxPos, py, pzPos);
        const [r, g, b] = ramp((flux?.[i] ?? 0) / MAX_FLUX);
        colors.push(r, g, b);
      }
    }

    // ── Faces (2 triangles/cellule) SEULEMENT quand les 4 coins sont des sommets toit ──────
    const indices = [];
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = vertMap[y * w + x];
        const b = vertMap[y * w + (x + 1)];
        const c = vertMap[(y + 1) * w + x];
        const d = vertMap[(y + 1) * w + (x + 1)];
        if (a === -1 || b === -1 || c === -1 || d === -1) continue;
        // quad a b / c d → triangles (a, c, b) et (b, c, d) — CCW vu de dessus
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    // Recentre le mesh sur l'origine (bbox centrée) pour un cadrage/orbite propres.
    const bbox = geometry.boundingBox;
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const span = Math.max(size.x, size.z, 1); // étendue horizontale réelle (m)

    // ── Scène / caméra / renderer ────────────────────────────────────────────────────────
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1020); // bleu nuit — les couleurs toit ressortent

    const camDist = span * 1.4;
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, camDist * 20 + 100);
    camera.position.set(0, camDist * 0.9, camDist * 0.9); // vue oblique en surplomb
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // le plan (XY) devient horizontal (XZ)
    scene.add(mesh);

    // ── Lumières : directionnelle (relief lisible) + ambiante douce ──────────────────────
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(span * 0.5, span, span * 0.3);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    // ── Contrôles orbite ──────────────────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.update();

    // ── Mesure au clic : raycaster → 2 points → distance 3D en mètres + ligne jaune ───────
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let picks = [];
    let lineObj = null;
    const markers = [];
    const markerR = span * 0.008;

    const clearMeasure = () => {
      if (lineObj) { scene.remove(lineObj); lineObj.geometry.dispose(); lineObj.material.dispose(); lineObj = null; }
      markers.forEach((mk) => { scene.remove(mk); mk.geometry.dispose(); mk.material.dispose(); });
      markers.length = 0;
      picks = [];
      setDistance(null);
    };
    apiRef.current = { resetMeasure: clearMeasure };

    const addMarker = (p) => {
      const sph = new THREE.Mesh(
        new THREE.SphereGeometry(markerR, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd400 }),
      );
      sph.position.copy(p);
      scene.add(sph);
      markers.push(sph);
    };

    let dragged = false;
    const onDown = () => { dragged = false; };
    const onMove = () => { dragged = true; };
    const onClick = (e) => {
      if (dragged) return; // ignore les clics issus d'un drag orbite
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit) return;
      if (picks.length === 2) clearMeasure();
      picks.push(hit.point.clone());
      addMarker(hit.point);
      if (picks.length === 2) {
        const d = picks[0].distanceTo(picks[1]);
        setDistance(d);
        const lg = new THREE.BufferGeometry().setFromPoints(picks);
        lineObj = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffd400 }));
        scene.add(lineObj);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('click', onClick);

    // ── Resize ────────────────────────────────────────────────────────────────────────────
    const onResize = () => {
      const nw = mount.clientWidth; const nh = mount.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    // ── Boucle de rendu ───────────────────────────────────────────────────────────────────
    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();

    // ── Nettoyage ─────────────────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('click', onClick);
      clearMeasure();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, [roof]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/95 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 text-white flex-shrink-0">
        <div>
          <h3 className="font-semibold text-sm">Toiture 3D — Google Solar</h3>
          <p className="text-xs text-slate-400">
            {distance != null
              ? `Distance : ${distance.toFixed(2)} m`
              : 'Cliquez 2 points pour mesurer'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => apiRef.current?.resetMeasure?.()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser la mesure
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      {empty ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-slate-300 text-sm px-6 text-center">
          Pas de surface toit détectée par Google ici.
        </div>
      ) : (
        <div ref={mountRef} className="flex-1 min-h-0" />
      )}
      <p className="px-4 py-2 text-[11px] text-slate-400 bg-slate-800 flex-shrink-0 text-center">
        Toiture reconstruite depuis le masque Google Solar · couleurs = flux annuel (bleu foncé faible → jaune fort).
        Faites pivoter avec la souris, zoomez à la molette. Mesure indicative à l'échelle réelle.
      </p>
    </div>
  );
}
