// src/apps/thermique/components/canvas/MursOverlay.jsx
// Surlignage des murs du niveau actif : extérieur (ambre épais) vs mitoyen (slate fin) — aide à la
// validation de l'enveloppe (repérer une rupture de continuité, un mur mal classé). Présentation
// PURE : toute la géométrie vient de segmentsMursNiveau (canvasGeometry.js). Palette R12 :
// ambre/slate, jamais rouge (réservé à l'état « pièce en erreur ») ni vert.
import { segmentsMursNiveau } from '../../lib/canvasGeometry.js';

export function MursOverlay({ piecesNiveauActif, echelle = 1 }) {
  let murs;
  try {
    murs = segmentsMursNiveau(piecesNiveauActif);
  } catch {
    return null; // dessin transitoire non indexable : on ne surligne pas (jamais de crash)
  }
  return (
    <g pointerEvents="none">
      {murs.map((m) => (
        <line
          key={`${m.pieceId}-${m.segmentIndex}-${m.x1}-${m.y1}-${m.x2}-${m.y2}`}
          x1={m.x1}
          y1={m.y1}
          x2={m.x2}
          y2={m.y2}
          className={m.exterieur ? 'stroke-amber-500' : 'stroke-slate-400'}
          strokeWidth={(m.exterieur ? 7 : 3) * echelle}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

export default MursOverlay;
