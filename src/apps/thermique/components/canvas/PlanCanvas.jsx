// src/apps/thermique/components/canvas/PlanCanvas.jsx
import { useId, useRef, useState } from 'react';
import {
  boiteEnglobante,
  pointDansPolygone,
  segmentLePlusProche,
  rectDepuisDrag,
  zoomBoite,
  snapPoint,
} from '../../lib/canvasGeometry.js';
import { PieceShape } from './PieceShape.jsx';
import { CotesPiece } from './CotesPiece.jsx';
import { OuvertureMarker } from './OuvertureMarker.jsx';
import { RoseNord } from './RoseNord.jsx';
import MursOverlay from './MursOverlay.jsx';
import ZoomControls from './ZoomControls.jsx';

const TOLERANCE_MUR_CM = 30;

/**
 * Convertit les coordonnées écran (px) d'un événement pointeur en coordonnées du dessin (cm),
 * via le viewBox du `<svg>` cible (`svg.getScreenCTM().inverse()` — gère nativement le zoom/pan
 * du navigateur et le redimensionnement du canevas, contrairement à un calcul manuel sur
 * `clientX`/`getBoundingClientRect`). Utilitaire interne à PlanCanvas (pas partagé, pas dans
 * canvasGeometry.js car il touche le DOM — les helpers purs n'importent rien du DOM).
 * `getScreenCTM()` peut renvoyer `null` (svg détaché ou `display: none`) → retourne `null` ;
 * chaque appelant DOIT gérer ce cas par un early return (jamais de crash).
 * @param {PointerEvent} event
 * @param {SVGSVGElement} svgEl élément `<svg>` racine du canevas
 * @returns {{x: number, y: number}|null} coordonnées en cm (non accrochées à la grille), ou
 *   null si la matrice écran n'est pas disponible
 */
function pointeurVersCm(event, svgEl) {
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  const pt = svgEl.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
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
 * Échelle des textes/traits : les tailles des composants enfants sont exprimées en unités du
 * viewBox (cm) — sur un grand plan (viewBox de 1500-2200 cm de large), une police « 22 » ferait
 * moins de 8 px à l'écran. PlanCanvas calcule donc `echelle = Math.max(boite.largeur, boite.hauteur)
 * / 600` (≈ 1 pour un petit plan) et le passe aux enfants, qui multiplient leurs fontSize/
 * strokeWidth par ce facteur → taille apparente CONSTANTE à l'écran quelle que soit l'étendue du
 * plan, y compris pour un plan « en hauteur » (hauteur > largeur, ex. maison tout en longueur nord-sud).
 *
 * Dette de test assumée (documentée ici, cf. self-review du plan 3, Task 8) : il n'y a PAS
 * d'infrastructure de test React dans ce repo (aucun `@testing-library/react` ni équivalent
 * installé) — la validation de ce composant est donc VISUELLE, reportée au plan 4 (câblage
 * wizard + preview réelle). Toute la logique géométrique qu'il consomme (hit-test, snapping,
 * décomposition, adjacences…) est en revanche testée exhaustivement côté `node:test` dans
 * `canvasGeometry.js`/`geometryEngine.js` — ce composant ne fait que les appeler.
 *
 * Dette plan 3 soldée au plan 4 (Task 12) : `enErreur` branché via la prop `piecesEnErreur`
 * (Set d'ids calculé par le wizard) ; error boundary côté wizard (`CanvasErrorBoundary`) ;
 * ids de `<pattern>` via `useId` (multi-instance : étape 2 + futur plan résultats).
 * Dette restante (plan 5) :
 * - centroïde d'AIRE (pas de sommets) pour le libellé des formes en L/U ;
 * - re-sélection/édition des ouvertures existantes (tap sur un OuvertureMarker).
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
 * @param {Set<*>} [props.piecesEnErreur] ids des pièces à teinter en erreur (calculés par le
 *   wizard — ce composant ne valide rien lui-même, il ne fait qu'afficher). Défaut : Set vide.
 */
export function PlanCanvas({ dessin, niveauActifId, selection, mode, onChange, onSelect, piecesEnErreur }) {
  const svgRef = useRef(null);
  // Ids des <pattern> de grille uniques par instance (useId — plusieurs PlanCanvas coexistent :
  // étape 2 du wizard + futur plan des résultats). Colons de useId strippés par prudence
  // (référencés dans des url(#…) SVG).
  const uid = useId().replace(/:/g, '');
  const grilleMineureId = `grille-mineure-${uid}`;
  const grilleMajeureId = `grille-majeure-${uid}`;
  // { pointerId, p1: {x,y}, p2: {x,y} } en cm, transitoire. `pointerId` identifie le doigt/
  // stylet/souris qui a initié le drag : les événements des AUTRES pointeurs (multi-touch) sont
  // ignorés tant que ce drag est actif.
  const [dragRect, setDragRect] = useState(null);
  // Déplacement d'une pièce par glisser en mode 'sélection' (pièce = objet manipulable). Transitoire,
  // grid-quantisé : { pointerId, pieceId, startCm:{x,y}, lastDelta:{dx,dy}, moved }.
  const [dragMove, setDragMove] = useState(null);
  // Facteur de zoom manuel du canevas (1 = auto-cadrage sur le contenu ; −/+/Ajuster = ZoomControls).
  const [zoom, setZoom] = useState(1);

  const piecesNiveauActif = dessin.pieces.filter((p) => p.niveauId === niveauActifId);
  const indexNiveauActif = dessin.niveaux.findIndex((n) => n.id === niveauActifId);
  const niveauInferieur = indexNiveauActif > 0 ? dessin.niveaux[indexNiveauActif - 1] : null;
  const piecesNiveauInferieur = niveauInferieur
    ? dessin.pieces.filter((p) => p.niveauId === niveauInferieur.id)
    : [];

  const boiteFit = boiteEnglobante([...piecesNiveauActif, ...piecesNiveauInferieur]);
  const boite = zoomBoite(boiteFit, zoom);
  const viewBox = `${boite.x} ${boite.y} ${boite.largeur} ${boite.hauteur}`;
  // Facteur d'échelle des textes/traits des enfants (cf. JSDoc ci-dessus) : 1.0 pour un plan de
  // 600 cm dans sa plus grande dimension, proportionnel au-delà → taille apparente constante à
  // l'écran, que le plan soit dominant en largeur ou en hauteur. Calculé sur la boîte RÉELLEMENT
  // RENDUE (boite = boiteFit / zoom) : la fontSize étant en unités viewBox, l'agrandir quand on
  // dézoome (boîte plus grande) compense le viewBox élargi → taille apparente stable à TOUT zoom.
  const echelle = Math.max(boite.largeur, boite.hauteur) / 600;

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
    if (dragRect || dragMove) return; // un geste est déjà en cours (multi-touch : 2ᵉ doigt ignoré)
    const ptCm = pointeurVersCm(event, svgRef.current);
    if (!ptCm) return; // CTM indisponible (cf. pointeurVersCm)
    if (mode === 'rectangle') {
      setDragRect({ pointerId: event.pointerId, p1: ptCm, p2: ptCm });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (mode === 'selection') {
      // Glisser sur le CORPS d'une pièce = la déplacer (pièce = objet manipulable). On la sélectionne
      // dès la prise ; le déplacement effectif ne démarre qu'au premier franchissement de cellule.
      const piece = piecesNiveauActif.find((p) => pointDansPolygone(ptCm, p.polygone));
      if (piece) {
        onSelect?.({ type: 'piece', id: piece.id });
        setDragMove({ pointerId: event.pointerId, pieceId: piece.id, startCm: ptCm, lastDelta: { dx: 0, dy: 0 }, moved: false });
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      // Pas de pièce sous le curseur : on laisse pointerup gérer le tap (sélection mur / rien).
    }
  }

  function handlePointerMove(event) {
    if (dragRect && event.pointerId === dragRect.pointerId) {
      const ptCm = pointeurVersCm(event, svgRef.current);
      if (!ptCm) return;
      setDragRect((prev) => (prev ? { ...prev, p2: ptCm } : prev));
      return;
    }
    if (dragMove && event.pointerId === dragMove.pointerId) {
      const ptCm = pointeurVersCm(event, svgRef.current);
      if (!ptCm) return;
      // Delta depuis la prise, accroché à la grille : le déplacement est quantifié à la cellule
      // (10 cm) → au plus quelques onChange par glisser, et l'overlay des murs se recolorie en
      // direct (le mur commun devient slate dès que la continuité avec la voisine est atteinte).
      const snapped = snapPoint({ x: ptCm.x - dragMove.startCm.x, y: ptCm.y - dragMove.startCm.y });
      if (snapped.x === dragMove.lastDelta.dx && snapped.y === dragMove.lastDelta.dy) return;
      const incDx = snapped.x - dragMove.lastDelta.dx;
      const incDy = snapped.y - dragMove.lastDelta.dy;
      onChange?.({
        ...dessin,
        pieces: dessin.pieces.map((p) => (p.id === dragMove.pieceId
          ? { ...p, polygone: p.polygone.map((pt) => ({ x: pt.x + incDx, y: pt.y + incDy })) }
          : p)),
      });
      setDragMove((prev) => (prev ? { ...prev, lastDelta: { dx: snapped.x, dy: snapped.y }, moved: true } : prev));
    }
  }

  function handlePointerUp(event) {
    if (dragRect) {
      if (event.pointerId !== dragRect.pointerId) return; // autre pointeur : ignoré
      const polygone = rectDepuisDrag(dragRect.p1, dragRect.p2);
      setDragRect(null);
      if (mode === 'rectangle' && polygone) {
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

    if (dragMove) {
      if (event.pointerId !== dragMove.pointerId) return; // autre pointeur : ignoré
      // La pièce est déjà à sa position finale (appliquée en direct pendant le glisser) et
      // sélectionnée. Un « glisser » qui n'a franchi aucune cellule (moved=false) = simple clic :
      // la pièce a été sélectionnée au pointerdown, rien de plus à faire.
      setDragMove(null);
      return;
    }

    const ptCm = pointeurVersCm(event, svgRef.current);
    if (!ptCm) return; // CTM indisponible (cf. pointeurVersCm)
    if (mode === 'selection') {
      gererSelectionTap(ptCm);
    } else if (mode === 'ouverture') {
      gererPoseOuvertureTap(ptCm);
    }
    // mode 'polygone' : v1 non implémenté, aucun traitement (cf. JSDoc ci-dessus).
  }

  function handlePointerCancel(event) {
    // Geste interrompu (ex. le navigateur reprend la main sur un scroll/zoom tactile) : on
    // abandonne le geste en cours — uniquement pour LE pointeur concerné. Une pièce en cours de
    // déplacement reste à sa dernière position accrochée (déjà committée), pas de corruption.
    if (dragRect && event.pointerId === dragRect.pointerId) setDragRect(null);
    if (dragMove && event.pointerId === dragMove.pointerId) setDragMove(null);
  }

  const rectFantome = dragRect ? rectDepuisDrag(dragRect.p1, dragRect.p2) : null;

  return (
    <div className="relative w-full h-full bg-white">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className={`w-full h-full touch-none ${dragMove ? 'cursor-grabbing' : ''}`}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <defs>
          {/* Grille 10 cm imbriquée dans une grille majeure 1 m — deux <pattern> simples plutôt
              qu'un calcul de zoom dynamique (garde le composant mince, cf. requirement Task 8). */}
          <pattern id={grilleMineureId} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" className="stroke-slate-200" strokeWidth="0.5" />
          </pattern>
          <pattern id={grilleMajeureId} width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill={`url(#${grilleMineureId})`} />
            <path d="M 100 0 L 0 0 0 100" fill="none" className="stroke-slate-300" strokeWidth="1" />
          </pattern>
        </defs>

        <rect x={boite.x} y={boite.y} width={boite.largeur} height={boite.hauteur} fill={`url(#${grilleMajeureId})`} />

        {/* Niveau inférieur en filigrane — repère de superposition, non interactif. */}
        {piecesNiveauInferieur.map((piece) => (
          <PieceShape key={`fantome-${piece.id}`} piece={piece} interactive={false} echelle={echelle} />
        ))}

        {/* Pièces du niveau actif. */}
        {piecesNiveauActif.map((piece) => (
          <PieceShape
            key={piece.id}
            piece={piece}
            selectionnee={pieceSelectionnee?.id === piece.id}
            enErreur={!!piecesEnErreur?.has(piece.id)}
            echelle={echelle}
          />
        ))}

        {/* Surlignage de l'enveloppe : murs extérieurs (ambre) vs mitoyens (slate). */}
        <MursOverlay piecesNiveauActif={piecesNiveauActif} echelle={echelle} />

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
                echelle={echelle}
              />
            );
          })}

        {/* Cotes de la pièce sélectionnée. */}
        {pieceSelectionnee && <CotesPiece piece={pieceSelectionnee} echelle={echelle} />}

        {/* Rectangle fantôme pendant un drag en mode 'rectangle'. */}
        {rectFantome && (
          <polygon
            points={rectFantome.map((p) => `${p.x},${p.y}`).join(' ')}
            className="fill-blue-300/40 stroke-blue-500"
            strokeWidth={4 * echelle}
            strokeDasharray={`${12 * echelle} ${8 * echelle}`}
          />
        )}

        {/* Cotes live du rectangle en cours de tracé (L × l en m) — l'utilisateur voit la taille
            qu'il dessine en temps réel. */}
        {rectFantome && (() => {
          const xs = rectFantome.map((p) => p.x);
          const ys = rectFantome.map((p) => p.y);
          const L = (Math.max(...xs) - Math.min(...xs)) / 100;
          const l = (Math.max(...ys) - Math.min(...ys)) / 100;
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          return (
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              className="fill-blue-700 font-medium select-none"
              style={{ fontSize: 20 * echelle }}
            >
              {L.toFixed(1)} × {l.toFixed(1)} m
            </text>
          );
        })()}
      </svg>

      <div className="absolute top-2 right-2">
        <RoseNord dessin={dessin} onChange={onChange} />
      </div>

      <div className="absolute bottom-2 left-2">
        <ZoomControls
          onZoomIn={() => setZoom((z) => Math.min(5, z * 1.25))}
          onZoomOut={() => setZoom((z) => Math.max(0.2, z / 1.25))}
          onReset={() => setZoom(1)}
        />
      </div>
    </div>
  );
}

export default PlanCanvas;
