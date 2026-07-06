// src/apps/thermique/components/canvas/ZoomControls.jsx
// Contrôles de zoom du canevas de dessin : − (arrière) / + (avant) / Ajuster (recadre sur la
// maison). Présentation pure — l'état du facteur de zoom vit dans PlanCanvas.
import { Minus, Plus, Maximize2 } from 'lucide-react';

export function ZoomControls({ onZoomIn, onZoomOut, onReset }) {
  const btn = 'p-1.5 bg-white/90 hover:bg-secondary-100 border border-secondary-200 rounded-lg text-secondary-600 shadow-sm';
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={btn} onClick={onZoomIn} title="Zoom avant" aria-label="Zoom avant">
        <Plus className="w-4 h-4" />
      </button>
      <button type="button" className={btn} onClick={onZoomOut} title="Zoom arrière" aria-label="Zoom arrière">
        <Minus className="w-4 h-4" />
      </button>
      <button type="button" className={btn} onClick={onReset} title="Ajuster à la maison" aria-label="Ajuster à la maison">
        <Maximize2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export default ZoomControls;
