// src/apps/thermique/components/canvas/EmpriseCanvas.jsx
// Dessin d'UN contour d'emprise au sol (par niveau) pour la saisie paramétrique — SVG contrôlé.
// Rectangle en v1 (glisser pour tracer/retracer). Réutilise snapPoint (grille 10 cm) et
// rectDepuisDrag (canvasGeometry). Mapping pointeur → cm via getScreenCTM (robuste à l'aspect et au
// preserveAspectRatio — un mapping manuel « clientX/width » est FAUX dès que la vue est
// letterboxée). viewBox à l'aspect réel de l'élément (ResizeObserver) → toute la largeur est
// utilisée, pas de bandes vides. Grille au mètre + cotes live (L × l en m).
import { useEffect, useRef, useState } from 'react';
import { snapPoint, rectDepuisDrag } from '../../lib/canvasGeometry';

const GRID_CM = 100;        // maille de fond = 1 m
const SPAN_DEFAUT = 900;    // hauteur visible par défaut (cm) ≈ 9 m
const MARGE = 1.35;         // marge autour de l'emprise tracée

const fmtM = (cm) => (cm / 100).toFixed(1).replace('.', ',');

export default function EmpriseCanvas({ polygone, onChange }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);          // { p1, p2 } en cm
  const [aspect, setAspect] = useState(2);         // largeur/hauteur de l'élément

  // Aspect réel de l'élément → viewBox de même ratio (aucun letterbox, largeur pleinement utilisée).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mapping pointeur → coordonnées SVG (cm), correct quel que soit l'aspect / preserveAspectRatio.
  const pointerCm = (evt) => {
    const svg = ref.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
    return snapPoint({ x: p.x, y: p.y });
  };

  const onDown = (e) => {
    const p = pointerCm(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ p1: p, p2: p });
  };
  const onMove = (e) => {
    if (!drag) return;
    const p = pointerCm(e);
    if (p) setDrag((d) => ({ ...d, p2: p }));
  };
  const onUp = () => {
    if (!drag) return;
    const poly = rectDepuisDrag(drag.p1, drag.p2);
    if (poly) onChange(poly);
    setDrag(null);
  };

  // viewBox : centré sur le contenu (ou origine par défaut), à l'aspect de l'élément.
  const xs = polygone.map((p) => p.x);
  const ys = polygone.map((p) => p.y);
  const has = polygone.length >= 3;
  const cx = has ? (Math.min(...xs) + Math.max(...xs)) / 2 : SPAN_DEFAUT / 2;
  const cy = has ? (Math.min(...ys) + Math.max(...ys)) / 2 : SPAN_DEFAUT / 2;
  const contentH = has ? Math.max(...ys) - Math.min(...ys) : 0;
  const contentW = has ? Math.max(...xs) - Math.min(...xs) : 0;
  const vbH = Math.max(contentH * MARGE, (contentW * MARGE) / aspect, SPAN_DEFAUT);
  const vbW = vbH * aspect;
  const vb = `${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`;
  const unit = vbH / 320;   // épaisseur de trait / texte ~ constante à l'écran

  const preview = drag ? rectDepuisDrag(drag.p1, drag.p2) : null;

  // Cote centrée sur un rectangle (poly à 4 points) : « L × l m ».
  const cote = (poly) => {
    if (!poly || poly.length < 3) return null;
    const px = poly.map((p) => p.x);
    const py = poly.map((p) => p.y);
    const w = Math.max(...px) - Math.min(...px);
    const h = Math.max(...py) - Math.min(...py);
    return {
      x: (Math.min(...px) + Math.max(...px)) / 2,
      y: (Math.min(...py) + Math.max(...py)) / 2,
      label: `${fmtM(w)} × ${fmtM(h)} m`,
    };
  };
  const coteAffichee = cote(preview) ?? (has ? cote(polygone) : null);

  return (
    <svg
      ref={ref}
      viewBox={vb}
      className="w-full h-full touch-none bg-secondary-50 cursor-crosshair"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="img"
      aria-label="Emprise au sol du niveau"
    >
      <defs>
        <pattern id="emprise-grille" width={GRID_CM} height={GRID_CM} patternUnits="userSpaceOnUse">
          <path
            d={`M ${GRID_CM} 0 L 0 0 0 ${GRID_CM}`}
            fill="none"
            className="stroke-secondary-200"
            strokeWidth={unit * 0.6}
          />
        </pattern>
      </defs>
      <rect x={cx - vbW / 2} y={cy - vbH / 2} width={vbW} height={vbH} fill="url(#emprise-grille)" />

      {has && (
        <polygon
          points={polygone.map((p) => `${p.x},${p.y}`).join(' ')}
          className="fill-amber-100/70 stroke-amber-500"
          strokeWidth={unit * 1.6}
        />
      )}
      {preview && (
        <polygon
          points={preview.map((p) => `${p.x},${p.y}`).join(' ')}
          className="fill-primary-100/40 stroke-primary-400"
          strokeDasharray={`${unit * 3} ${unit * 2}`}
          strokeWidth={unit * 1.6}
        />
      )}
      {coteAffichee && (
        <text
          x={coteAffichee.x}
          y={coteAffichee.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-secondary-700 font-medium select-none"
          style={{ fontSize: unit * 14 }}
        >
          {coteAffichee.label}
        </text>
      )}
      {!has && !preview && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-secondary-400 select-none"
          style={{ fontSize: unit * 13 }}
        >
          Glissez pour tracer l’emprise au sol
        </text>
      )}
    </svg>
  );
}
