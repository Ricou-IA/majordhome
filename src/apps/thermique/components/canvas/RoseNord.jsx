// src/apps/thermique/components/canvas/RoseNord.jsx

/**
 * Rose des vents cliquable, coin haut-droit du canevas — flèche N pointant vers `dessin.nord`
 * degrés (0 = haut du plan, sens horaire — même convention que `orientationDe` de
 * geometryEngine.js). Un clic fait pivoter le nord par pas de 45° et remonte le dessin complet
 * modifié via `onChange` (immutable — jamais de mutation de `dessin`). Double modulo pour
 * garantir un résultat dans [0, 360[ même si un `nord` négatif arrive en entrée.
 * SVG simple (pas de dépendance icône) : un triangle + la lettre « N ».
 *
 * @param {Object} props
 * @param {{nord: number}} props.dessin dessin courant (seul `nord` est lu)
 * @param {(dessin: Object) => void} [props.onChange] callback avec le dessin complet mis à jour
 */
export function RoseNord({ dessin, onChange }) {
  const tourner = () => onChange?.({ ...dessin, nord: (((dessin.nord + 45) % 360) + 360) % 360 });

  return (
    <svg
      viewBox="0 0 100 100"
      width={72}
      height={72}
      onClick={tourner}
      role="button"
      aria-label="Orienter le nord (clic = pivote de 45°)"
      className="cursor-pointer select-none"
    >
      <circle cx="50" cy="50" r="46" className="fill-white/90 stroke-slate-400" strokeWidth="2" />
      <g transform={`rotate(${dessin.nord} 50 50)`}>
        <polygon points="50,12 62,52 50,42 38,52" className="fill-red-600 stroke-red-700" strokeWidth="1" />
        <line x1="50" y1="42" x2="50" y2="88" className="stroke-slate-400" strokeWidth="2" />
        <text x="50" y="34" textAnchor="middle" className="fill-white select-none" style={{ fontSize: 14, fontWeight: 700 }}>
          N
        </text>
      </g>
    </svg>
  );
}

export default RoseNord;
