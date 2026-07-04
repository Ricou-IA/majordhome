// src/apps/thermique/components/canvas/CotesPiece.jsx
import { normalisePolygone, segmentsDe } from '../../lib/geometryEngine.js';

const OFFSET_CM = 15;

/**
 * Cotes (longueurs en mètres, 1 décimale) de chaque segment de la pièce sélectionnée, affichées
 * au milieu du segment et décalées de 15 cm vers l'EXTÉRIEUR de la pièce. Composant de
 * présentation pur : la géométrie (segments, normalisation CCW) vient de `geometryEngine.js`.
 *
 * Normale extérieure inline (mêmes conventions que `orientationDe` de geometryEngine.js —
 * n = (−dy, dx) sur un polygone CCW en repère y-bas pointe à l'extérieur) : ré-implémentée ici
 * en 5 lignes plutôt qu'importée, car on n'a besoin que du VECTEUR (pas du secteur cardinal).
 *
 * @param {Object} props
 * @param {{polygone: {x: number, y: number}[]}} props.piece pièce sélectionnée dont on cote
 *   les segments (polygone en cm — sera normalisé CCW en interne)
 */
export function CotesPiece({ piece }) {
  const segments = segmentsDe(normalisePolygone(piece.polygone));

  return (
    <g className="pointer-events-none">
      {segments.map((s, i) => {
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const longueur = Math.hypot(dx, dy) || 1;
        // Normale extérieure n = (−dy, dx) normalisée (CCW, repère y-bas — cf. orientationDe).
        const nx = (-dy / longueur) * OFFSET_CM;
        const ny = (dx / longueur) * OFFSET_CM;
        const milieuX = (s.x1 + s.x2) / 2 + nx;
        const milieuY = (s.y1 + s.y2) / 2 + ny;
        const longueurM = (s.longueur / 100).toFixed(1);

        return (
          <text
            key={i}
            x={milieuX}
            y={milieuY}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-blue-700 select-none"
            style={{ fontSize: 16 }}
          >
            {longueurM}&nbsp;m
          </text>
        );
      })}
    </g>
  );
}

export default CotesPiece;
