// src/apps/solaire/components/dossier/Roof3DViewer.jsx
// Viewer 3D toiture (modale plein écran) : maillage relief depuis le DSM Google Solar, heatmap
// flux drapée par sommet (ironPalette), mesure de distance au clic (2 points → mètres réels).
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

const plausible = (h) => Number.isFinite(h) && h > MIN_PLAUSIBLE && h < MAX_PLAUSIBLE;

export default function Roof3DViewer({ roof, onClose }) {
  const mountRef = useRef(null);
  const [distance, setDistance] = useState(null); // mètres ; null = pas encore 2 points
  const apiRef = useRef(null); // { resetMeasure } exposé par l'effet Three

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !roof?.dsm) return undefined;

    const { dsm, flux, mask, width: w, height: h, pixelSizeMeters: px } = roof;

    // ── Hauteur de référence : min plausible du DSM (relief remis à zéro) ────────────────
    let minH = Infinity;
    for (let i = 0; i < dsm.length; i++) if (plausible(dsm[i]) && dsm[i] < minH) minH = dsm[i];
    if (!Number.isFinite(minH)) minH = 0;
    logger.info('[roof3d] mesh', { w, h, px, minH });

    // ── Scène / caméra / renderer ────────────────────────────────────────────────────────
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a); // slate-900

    const spanX = (w - 1) * px; // largeur réelle (m)
    const spanZ = (h - 1) * px; // profondeur réelle (m)
    const diag = Math.hypot(spanX, spanZ);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, diag * 10);
    camera.position.set(0, diag * 0.9, diag * 0.9); // vue oblique en surplomb
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    // ── Géométrie relief : PlaneGeometry(w-1, h-1, w-1, h-1) → w×h sommets row-major ──────
    // z = hauteur DSM (m) zéroée sur minH ; sommets no-data → z=0 (baseline).
    // Y-flip : PlaneGeometry ligne 0 = +Y (haut). Le raster a la ligne 0 en HAUT. Pour que la
    // scène corresponde au raster on mappe raster row r → geometry row (h-1-r). DÉCISION v1 :
    // on applique ce flip. Si le relief paraît miroir en test live, c'est le caveat connu.
    const geometry = new THREE.PlaneGeometry(spanX, spanZ, w - 1, h - 1);
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let gy = 0; gy < h; gy++) {
      const ry = h - 1 - gy; // flip vertical raster→geometry
      for (let gx = 0; gx < w; gx++) {
        const vIdx = gy * w + gx;
        const rIdx = ry * w + gx;
        const raw = dsm[rIdx];
        pos.setZ(vIdx, plausible(raw) ? raw - minH : 0);
        const m = mask?.[rIdx] ?? 1;
        if (m) {
          const [r, g, b] = ramp((flux?.[rIdx] ?? 0) / MAX_FLUX);
          colors[vIdx * 3] = r; colors[vIdx * 3 + 1] = g; colors[vIdx * 3 + 2] = b;
        } else {
          colors[vIdx * 3] = 0.18; colors[vIdx * 3 + 1] = 0.2; colors[vIdx * 3 + 2] = 0.26; // slate hors toit
        }
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // le plan (XY) devient horizontal (XZ)
    scene.add(mesh);

    // ── Lumières : directionnelle (relief lisible) + ambiante douce ──────────────────────
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(spanX * 0.5, diag, spanZ * 0.3);
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
        new THREE.SphereGeometry(diag * 0.006, 12, 12),
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
      <div ref={mountRef} className="flex-1 min-h-0" />
      <p className="px-4 py-2 text-[11px] text-slate-400 bg-slate-800 flex-shrink-0 text-center">
        Relief depuis le DSM Google Solar · couleurs = flux annuel (bleu foncé faible → jaune fort).
        Faites pivoter avec la souris, zoomez à la molette. Mesure indicative à l'échelle réelle.
      </p>
    </div>
  );
}
