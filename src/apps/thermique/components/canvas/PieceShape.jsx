// src/apps/thermique/components/canvas/PieceShape.jsx
import { surfaceCm2 } from '../../lib/geometryEngine.js';

/**
 * Polygone SVG d'une pièce du plan — composant de présentation pur (aucune logique métier,
 * toute la géométrie vient de `geometryEngine.js`). Le remplissage varie selon l'état :
 * chauffée (bleu clair), non chauffée (gris hachuré via `<pattern>`), sélectionnée (contour
 * « ring » surligné), en erreur (teinte rouge légère, prioritaire sur les autres états).
 * Le nom et la surface (m², 1 décimale) sont centrés au CENTROÏDE = moyenne des sommets — une
 * APPROXIMATION du vrai centre de masse du polygone, suffisante pour nos pièces rectilinéaires
 * usuelles (rectangles et L simples) où l'écart est visuellement négligeable ; documenté ici
 * plutôt que de complexifier avec le centroïde exact d'un polygone.
 *
 * @param {Object} props
 * @param {{id: (string|number), nom: string, chauffee: boolean,
 *   polygone: {x: number, y: number}[]}} props.piece pièce à dessiner (polygone en cm)
 * @param {boolean} [props.selectionnee=false] surligne le contour (sélection courante)
 * @param {boolean} [props.enErreur=false] applique la teinte d'erreur (dessin invalide)
 * @param {boolean} [props.interactive=true] si false, le polygone ignore les clics (watermark
 *   du niveau inférieur, `pointer-events: none`)
 * @param {number} [props.echelle=1] facteur d'échelle des tailles de texte/trait (calculé par
 *   PlanCanvas depuis l'étendue du viewBox — les tailles ci-dessous sont en unités viewBox (cm),
 *   sans ce facteur elles deviendraient illisibles sur un grand plan)
 * @param {(id: (string|number)) => void} [props.onClick] callback clic pièce (mode sélection —
 *   le hit-test précis se fait dans PlanCanvas via `pointDansPolygone`, ce handler est un relai
 *   optionnel pour un clic natif SVG direct sur la forme)
 */
export function PieceShape({ piece, selectionnee = false, enErreur = false, interactive = true, echelle = 1, onClick }) {
  const points = piece.polygone.map((p) => `${p.x},${p.y}`).join(' ');
  const centroide = piece.polygone.reduce(
    (acc, p) => ({ x: acc.x + p.x / piece.polygone.length, y: acc.y + p.y / piece.polygone.length }),
    { x: 0, y: 0 },
  );
  const surfaceM2 = (surfaceCm2(piece.polygone) / 10000).toFixed(1);

  const patternId = `hachure-lnc-${piece.id}`;

  let fillClassName = piece.chauffee ? 'fill-sky-100' : `fill-[url(#${patternId})]`;
  let strokeClassName = 'stroke-slate-500';
  if (enErreur) {
    fillClassName = 'fill-red-200';
    strokeClassName = 'stroke-red-600';
  }

  return (
    <g
      className={interactive ? 'cursor-pointer' : 'pointer-events-none opacity-60'}
      onClick={interactive && onClick ? () => onClick(piece.id) : undefined}
    >
      {!piece.chauffee && !enErreur && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="rotate(45)">
            <rect width="20" height="20" className="fill-slate-100" />
            <line x1="0" y1="0" x2="0" y2="20" className="stroke-slate-400" strokeWidth="4" />
          </pattern>
        </defs>
      )}
      <polygon
        points={points}
        className={`${fillClassName} ${strokeClassName} ${selectionnee ? 'stroke-blue-600' : ''}`}
        strokeWidth={(selectionnee ? 6 : 2) * echelle}
      />
      <text
        x={centroide.x}
        y={centroide.y - 15 * echelle}
        textAnchor="middle"
        className="fill-slate-700 select-none"
        style={{ fontSize: 22 * echelle }}
      >
        {piece.nom}
      </text>
      <text
        x={centroide.x}
        y={centroide.y + 15 * echelle}
        textAnchor="middle"
        className="fill-slate-500 select-none"
        style={{ fontSize: 18 * echelle }}
      >
        {surfaceM2}&nbsp;m²
      </text>
    </g>
  );
}

export default PieceShape;
