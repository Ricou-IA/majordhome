// src/apps/thermique/components/canvas/PlanCanvas.jsx
import { useRef, useState } from 'react';
import {
  boiteEnglobante,
  pointDansPolygone,
  segmentLePlusProche,
  rectDepuisDrag,
} from '../../lib/canvasGeometry.js';
import { PieceShape } from './PieceShape.jsx';
import { CotesPiece } from './CotesPiece.jsx';
import { OuvertureMarker } from './OuvertureMarker.jsx';
import { RoseNord } from './RoseNord.jsx';

const TOLERANCE_MUR_CM = 30;

/**
 * Convertit les coordonnées écran (px) d'un événement pointeur en coordonnées du dessin (cm),
 * via le viewBox du `<svg>` cible (`svg.getScreenCTM().inverse()` — gère nativement le zoom/pan
 * du navigateur et le redimensionnement du canevas, contrairement à un calcul manuel sur
 * `clientX`/`getBoundingClientRect`). Utilitaire interne à PlanCanvas (pas partagé, pas dans
 * canvasGeometry.js car il touche le DOM — les helpers purs n'importent rien du DOM).
 * @param {PointerEvent} event
 * @param {SVGSVGElement} svgEl élément `<svg>` racine du canevas
 * @returns {{x: number, y: number}} coordonnées en cm (non accrochées à la grille)
 */
function pointeurVersCm(event, svgEl) {
  const pt = svgEl.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const ctm = svgEl.getScreenCTM();
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

/**
 * Orchestrateur du canevas de dessin du plan (module thermique). Composant CONTRÔLÉ et MINCE :
 * tout l'état durable vit dans `dessin` (prop) et remonte via `onChange` — le seul état local
 * (`useState`) est l'état TRANSITOIRE d'interaction (ghost rect en cours de drag). Toute la
 * géométrie (hit-test, snapping, calcul du rectangle, boîte englobante) est déléguée aux modules
 * purs `canvasGeometry.js`/`geometryEngine.js` : ce composant ne fait QUE de la conversion
 * px↔cm, du câblage d'événements, et de la construction immutable du nouveau `dessin`.
 *
 * Modes (prop `mode`) :
 * - 'selection' : tap → hit-test des pièces du niveau actif (`pointDansPolygone`) → si une pièce
 *   matche, `onSelect({ type: 'piece', id })` ; sinon, si un mur de la pièce SÉLECTIONNÉE est à
 *   moins de 30 cm (`segmentLePlusProche`), `onSelect({ type: 'mur', pieceId, segmentIndex,
 *   position })`.
 * - 'rectangle' : drag (pointerdown → pointermove → pointerup) → rectangle fantôme affiché en
 *   état local pendant le drag ; au relâchement, `rectDepuisDrag` produit le polygone final et
 *   une nouvelle pièce est ajoutée au dessin (immutablement) via `onChange`.
 * - 'ouverture' : tap près d'un mur (n'importe quelle pièce du niveau actif) →
 *   `onSelect({ type: 'pose-ouverture', pieceId, segmentIndex, position })` — CE COMPOSANT NE
 *   POSE PAS l'ouverture lui-même : il ne fait que reporter où l'utilisateur a tapé. Le wizard
 *   (plan 4) ouvre le dialogue de saisie (type/largeur/hauteur) et appelle `onChange`.
 * - 'polygone' : **NON IMPLÉMENTÉ en v1** — mode ignoré (aucun pointer handler dédié). Décision
 *   assumée du plan 3 : le tracé polygone libre est livré au plan 4 si le besoin se confirme ;
 *   les rectangles accolés (mode 'rectangle' répété) couvrent les cas courants (L, T, etc.).
 *
 * Dette de test assumée (documentée ici, cf. self-review du plan 3, Task 8) : il n'y a PAS
 * d'infrastructure de test React dans ce repo (aucun `@testing-library/react` ni équivalent
 * installé) — la validation de ce composant est donc VISUELLE, reportée au plan 4 (câblage
 * wizard + preview réelle). Toute la logique géométrique qu'il consomme (hit-test, snapping,
 * décomposition, adjacences…) est en revanche testée exhaustivement côté `node:test` dans
 * `canvasGeometry.js`/`geometryEngine.js` — ce composant ne fait que les appeler.
 *
 * @param {Object} props
 * @param {Object} props.dessin dessin complet (cf. modèle de données figé au plan 3 : `nord`,
 *   `plancherBasType`, `toitureType`, `niveaux[]`, `pieces[]`, `ouvertures[]`)
 * @param {(string|number)} props.niveauActifId id du niveau actuellement édité/affiché au premier
 *   plan (les pièces du niveau immédiatement inférieur sont montrées en filigrane, non
 *   interactives — repère visuel de superposition)
 * @param {{type: 'piece'|'mur'|'pose-ouverture', pieceId?: *, segmentIndex?: number,
 *   position?: number, id?: *}|null} props.selection sélection courante (pièce, mur, ou point de
 *   pose d'ouverture) — pilote l'affichage des cotes et du surlignage
 * @param {'selection'|'rectangle'|'polygone'|'ouverture'} props.mode mode d'interaction courant
 * @param {(dessin: Object) => void} props.onChange callback avec le dessin COMPLET modifié
 *   (jamais de mutation de la prop `dessin` — un nouvel objet est toujours construit)
 * @param {(selection: Object) => void} props.onSelect callback de sélection/désignation (voir
 *   modes ci-dessus pour la forme exacte de l'objet remonté)
 */
export function PlanCanvas({ dessin, niveauActifId, selection, mode, onChange, onSelect }) {
  const svgRef = useRef(null);
  const [dragRect, setDragRect] = useState(null); // { p1: {x,y}, p2: {x,y} } en cm, transitoire

  const piecesNiveauActif = dessin.pieces.filter((p) => p.niveauId === niveauActifId);
  const indexNiveauActif = dessin.niveaux.findIndex((n) => n.id === niveauActifId);
  const niveauInferieur = indexNiveauActif > 0 ? dessin.niveaux[indexNiveauActif - 1] : null;
  const piecesNiveauInferieur = niveauInferieur
    ? dessin.pieces.filter((p) => p.niveauId === niveauInferieur.id)
    : [];

  const boite = boiteEnglobante([...piecesNiveauActif, ...piecesNiveauInferieur]);
  const viewBox = `${boite.x} ${boite.y} ${boite.largeur} ${boite.hauteur}`;

  const pieceSelectionnee = selection?.pieceId != null
    ? piecesNiveauActif.find((p) => p.id === selection.pieceId)
    : selection?.type === 'piece'
      ? piecesNiveauActif.find((p) => p.id === selection.id)
      : null;

  function gererSelectionTap(ptCm) {
    for (const piece of piecesNiveauActif) {
      if (pointDansPolygone(ptCm, piece.polygone)) {
        onSelect?.({ type: 'piece', id: piece.id });
        return;
      }
    }
    if (pieceSelectionnee) {
      const proche = segmentLePlusProche(ptCm, pieceSelectionnee.polygone, TOLERANCE_MUR_CM);
      if (proche) {
        onSelect?.({
          type: 'mur',
          pieceId: pieceSelectionnee.id,
          segmentIndex: proche.segmentIndex,
          position: proche.position,
        });
      }
    }
  }

  function gererPoseOuvertureTap(ptCm) {
    for (const piece of piecesNiveauActif) {
      const proche = segmentLePlusProche(ptCm, piece.polygone, TOLERANCE_MUR_CM);
      if (proche) {
        onSelect?.({
          type: 'pose-ouverture',
          pieceId: piece.id,
          segmentIndex: proche.segmentIndex,
          position: proche.position,
        });
        return;
      }
    }
  }

  function handlePointerDown(event) {
    if (mode !== 'rectangle') return;
    const ptCm = pointeurVersCm(event, svgRef.current);
    setDragRect({ p1: ptCm, p2: ptCm });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (mode !== 'rectangle' || !dragRect) return;
    const ptCm = pointeurVersCm(event, svgRef.current);
    setDragRect((prev) => ({ ...prev, p2: ptCm }));
  }

  function handlePointerUp(event) {
    if (mode === 'rectangle' && dragRect) {
      const polygone = rectDepuisDrag(dragRect.p1, dragRect.p2);
      setDragRect(null);
      if (polygone) {
        const nouvellePiece = {
          id: crypto.randomUUID(),
          niveauId: niveauActifId,
          nom: 'Pièce',
          typePiece: 'autre',
          chauffee: true,
          thetaInt: null,
          polygone,
        };
        onChange?.({ ...dessin, pieces: [...dessin.pieces, nouvellePiece] });
      }
      return;
    }

    const ptCm = pointeurVersCm(event, svgRef.current);
    if (mode === 'selection') {
      gererSelectionTap(ptCm);
    } else if (mode === 'ouverture') {
      gererPoseOuvertureTap(ptCm);
    }
    // mode 'polygone' : v1 non implémenté, aucun traitement (cf. JSDoc ci-dessus).
  }

  const rectFantome = dragRect ? rectDepuisDrag(dragRect.p1, dragRect.p2) : null;

  return (
    <div className="relative w-full h-full bg-white">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="w-full h-full touch-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <defs>
          {/* Grille 10 cm imbriquée dans une grille majeure 1 m — deux <pattern> simples plutôt
              qu'un calcul de zoom dynamique (garde le composant mince, cf. requirement Task 8). */}
          <pattern id="grille-mineure" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" className="stroke-slate-200" strokeWidth="0.5" />
          </pattern>
          <pattern id="grille-majeure" width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill="url(#grille-mineure)" />
            <path d="M 100 0 L 0 0 0 100" fill="none" className="stroke-slate-300" strokeWidth="1" />
          </pattern>
        </defs>

        <rect x={boite.x} y={boite.y} width={boite.largeur} height={boite.hauteur} fill="url(#grille-majeure)" />

        {/* Niveau inférieur en filigrane — repère de superposition, non interactif. */}
        {piecesNiveauInferieur.map((piece) => (
          <PieceShape key={`fantome-${piece.id}`} piece={piece} interactive={false} />
        ))}

        {/* Pièces du niveau actif. */}
        {piecesNiveauActif.map((piece) => (
          <PieceShape
            key={piece.id}
            piece={piece}
            selectionnee={pieceSelectionnee?.id === piece.id}
            enErreur={false}
          />
        ))}

        {/* Ouvertures du niveau actif. */}
        {dessin.ouvertures
          .filter((o) => piecesNiveauActif.some((p) => p.id === o.pieceId))
          .map((ouverture) => {
            const piece = piecesNiveauActif.find((p) => p.id === ouverture.pieceId);
            return (
              <OuvertureMarker
                key={ouverture.id}
                piece={piece}
                ouverture={ouverture}
                selectionnee={selection?.type === 'pose-ouverture' && selection.pieceId === piece.id}
              />
            );
          })}

        {/* Cotes de la pièce sélectionnée. */}
        {pieceSelectionnee && <CotesPiece piece={pieceSelectionnee} />}

        {/* Rectangle fantôme pendant un drag en mode 'rectangle'. */}
        {rectFantome && (
          <polygon
            points={rectFantome.map((p) => `${p.x},${p.y}`).join(' ')}
            className="fill-blue-300/40 stroke-blue-500"
            strokeWidth={4}
            strokeDasharray="12 8"
          />
        )}
      </svg>

      <div className="absolute top-2 right-2">
        <RoseNord dessin={dessin} onChange={onChange} />
      </div>
    </div>
  );
}

export default PlanCanvas;
