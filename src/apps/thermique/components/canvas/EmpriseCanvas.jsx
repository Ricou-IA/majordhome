// src/apps/thermique/components/canvas/EmpriseCanvas.jsx
// Dessin d'UN contour d'emprise au sol (par niveau) pour la saisie paramétrique — SVG contrôlé.
// Réutilise snapPoint/rectDepuisDrag (canvasGeometry). Rectangle en v1 (drag pour tracer/retracer).
import { useRef, useState } from 'react';
import { snapPoint, rectDepuisDrag } from '../../lib/canvasGeometry';

const VIEW = 1000; // cm de côté visible par défaut (ajusté au polygone existant)

export default function EmpriseCanvas({ polygone, onChange }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null); // { p1, p2 } en cm

  const toCm = (evt) => {
    const svg = ref.current; const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = vb.x + ((evt.clientX - r.left) / r.width) * vb.width;
    const y = vb.y + ((evt.clientY - r.top) / r.height) * vb.height;
    return snapPoint({ x, y });
  };

  const onDown = (e) => setDrag({ p1: toCm(e), p2: toCm(e) });
  const onMove = (e) => drag && setDrag((d) => ({ ...d, p2: toCm(e) }));
  const onUp = () => {
    if (drag) {
      const poly = rectDepuisDrag(drag.p1, drag.p2);
      if (poly) onChange(poly);
      setDrag(null);
    }
  };

  const xs = polygone.map((p) => p.x); const ys = polygone.map((p) => p.y);
  const minX = polygone.length ? Math.min(...xs) : 0;
  const minY = polygone.length ? Math.min(...ys) : 0;
  const w = polygone.length ? Math.max(...xs) - minX : VIEW;
  const h = polygone.length ? Math.max(...ys) - minY : VIEW;
  const pad = Math.max(w, h, VIEW) * 0.1;
  const vb = `${minX - pad} ${minY - pad} ${Math.max(w, VIEW) + 2 * pad} ${Math.max(h, VIEW) + 2 * pad}`;
  const preview = drag ? rectDepuisDrag(drag.p1, drag.p2) : null;

  return (
    <svg
      ref={ref} viewBox={vb} className="w-full h-full touch-none bg-secondary-50"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      role="img" aria-label="Emprise au sol du niveau"
    >
      {polygone.length >= 3 && (
        <polygon points={polygone.map((p) => `${p.x},${p.y}`).join(' ')}
          className="fill-amber-100 stroke-amber-500" strokeWidth={Math.max(w, h) / 200} />
      )}
      {preview && (
        <polygon points={preview.map((p) => `${p.x},${p.y}`).join(' ')}
          className="fill-primary-100/50 stroke-primary-400" strokeDasharray="8 6" strokeWidth={Math.max(w, h) / 200} />
      )}
    </svg>
  );
}
