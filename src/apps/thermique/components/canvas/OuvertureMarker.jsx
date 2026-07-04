// src/apps/thermique/components/canvas/OuvertureMarker.jsx
import { normalisePolygone, segmentsDe, intervalleAxial } from '../../lib/geometryEngine.js';

const COULEURS = {
  fenetre: 'stroke-blue-500',
  porte: 'stroke-amber-800',
  'porte-fenetre': 'stroke-amber-800',
};

/**
 * Marqueur d'ouverture : trait épais superposé à la portion du mur porteur qu'elle occupe.
 * Couleur par type — fenêtre en bleu, porte/porte-fenêtre en brun. La portion occupée est
 * calculée par `intervalleAxial` (geometryEngine.js) à partir de `segmentIndex`/`position` de
 * l'ouverture ; ce composant ne fait AUCUN calcul géométrique propre, seulement la conversion
 * de l'intervalle d'axe en segment SVG (x1,y1,x2,y2).
 *
 * @param {Object} props
 * @param {{polygone: {x: number, y: number}[]}} props.piece pièce porteuse (pour ses segments)
 * @param {{id: (string|number), segmentIndex: number, type: 'fenetre'|'porte'|'porte-fenetre',
 *   largeur: number, position: number}} props.ouverture ouverture à dessiner (cm entiers)
 * @param {boolean} [props.selectionnee=false] surligne l'ouverture (sélection courante)
 */
export function OuvertureMarker({ piece, ouverture, selectionnee = false }) {
  const segments = segmentsDe(normalisePolygone(piece.polygone));
  const segment = segments[ouverture.segmentIndex];
  if (!segment) return null;

  const { de, a } = intervalleAxial(segment, ouverture.position, ouverture.largeur);

  // L'intervalle {de, a} est en coordonnée d'AXE (x si segment horizontal, y si vertical) —
  // l'autre coordonnée est constante sur tout le segment (axis-aligned).
  const x1 = segment.axe === 'h' ? de : segment.x1;
  const y1 = segment.axe === 'v' ? de : segment.y1;
  const x2 = segment.axe === 'h' ? a : segment.x1;
  const y2 = segment.axe === 'v' ? a : segment.y1;

  const couleur = COULEURS[ouverture.type] || 'stroke-slate-400';

  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className={`${couleur} ${selectionnee ? 'opacity-100' : 'opacity-90'}`}
      strokeWidth={selectionnee ? 16 : 12}
      strokeLinecap="butt"
    />
  );
}

export default OuvertureMarker;
