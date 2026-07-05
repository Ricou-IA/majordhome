// src/apps/thermique/components/wizard/PlanResultats.jsx
// Plan de résultats LECTURE SEULE par niveau (étape 4 du wizard Thermique) — composant SVG
// dédié minimal, PAS PlanCanvas (aucune interaction). Pièces chauffées remplies selon leur
// ratio W/m² : interpolation linéaire bleu #3b82f6 → ambre #f59e0b entre le min et le max du
// bâtiment (JAMAIS rouge/vert — règle produit R12, palette deutan). Pièces non chauffées
// hachurées gris (pattern SVG en ATTRIBUT fill, pas de classe Tailwind dynamique — jamais
// extraite par le scanner, cf. PieceShape). Label au centroïde (moyenne des sommets, même
// approximation documentée que PieceShape) : « nom · NNN W ». Tableau par pièce sous le plan.
import { useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { boiteEnglobante } from '../../lib/canvasGeometry';

const BLEU = [59, 130, 246];   // #3b82f6 — pièce la moins déperditive (W/m²)
const AMBRE = [245, 158, 11];  // #f59e0b — pièce la plus déperditive (W/m²)

/** Interpolation linéaire bleu → ambre, t ∈ [0, 1]. */
function couleurRatio(t) {
  const c = BLEU.map((v, i) => Math.round(v + (AMBRE[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const fmtW = (v) => `${Math.round(v).toLocaleString('fr-FR')} W`;

/**
 * @param {Object} props
 * @param {Object} props.dessin dessin du wizard (niveaux, pieces avec polygone/niveauId/chauffee)
 * @param {Object} props.bilan  bilan de calculeBatiment — pieces: [{id, nom, surface,
 *   transmission, ventilation, relance, total}], total, parPoste (les pièces non chauffées n'y
 *   figurent pas : elles sont hachurées sans valeur sur le plan et absentes du tableau)
 */
export default function PlanResultats({ dessin, bilan }) {
  const [niveauActifId, setNiveauActifId] = useState(dessin.niveaux[0]?.id ?? null);

  // Niveau actif toujours valide (recalcul après retour au dessin, étude rechargée…).
  useEffect(() => {
    if (!dessin.niveaux.some((n) => n.id === niveauActifId)) {
      setNiveauActifId(dessin.niveaux[0]?.id ?? null);
    }
  }, [dessin.niveaux, niveauActifId]);

  const parPiece = useMemo(() => new Map(bilan.pieces.map((p) => [p.id, p])), [bilan.pieces]);

  // Échelle de couleur : min/max des ratios W/m² du BÂTIMENT entier (pas du niveau), pour que
  // deux niveaux soient comparables entre eux. Une seule pièce (min = max) → milieu de gamme.
  const { ratioMin, ratioMax } = useMemo(() => {
    const ratios = bilan.pieces.map((p) => p.total / p.surface);
    return { ratioMin: Math.min(...ratios), ratioMax: Math.max(...ratios) };
  }, [bilan.pieces]);
  const couleurPiece = (piece) => {
    const r = parPiece.get(piece.id);
    if (!r) return null;
    const ratio = r.total / r.surface;
    const t = ratioMax > ratioMin ? (ratio - ratioMin) / (ratioMax - ratioMin) : 0.5;
    return couleurRatio(t);
  };

  const piecesNiveau = dessin.pieces.filter((p) => p.niveauId === niveauActifId);
  const boite = boiteEnglobante(piecesNiveau);
  // Même convention d'échelle des textes que PlanCanvas : taille apparente constante à l'écran.
  const echelle = Math.max(boite.largeur, boite.hauteur) / 600;

  const nomNiveau = (niveauId) => dessin.niveaux.find((n) => n.id === niveauId)?.nom ?? '';
  const multiNiveaux = dessin.niveaux.length > 1;
  // Colonne Relance SEULEMENT si la relance participe au bilan (fRH effectif > 0).
  const avecRelance = (bilan.parPoste?.relance ?? 0) > 0;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-secondary-900 text-sm">Déperditions par pièce</h3>
        {multiNiveaux && (
          <div className="flex items-center gap-1 flex-wrap">
            <Layers className="w-4 h-4 text-secondary-400 flex-shrink-0" />
            {dessin.niveaux.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setNiveauActifId(n.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  n.id === niveauActifId
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-secondary-600 hover:bg-secondary-100'
                }`}
              >
                {n.nom}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Plan du niveau actif — lecture seule */}
      <div className="bg-white border border-secondary-100 rounded-lg overflow-hidden">
        <svg
          viewBox={`${boite.x} ${boite.y} ${boite.largeur} ${boite.hauteur}`}
          className="w-full max-h-[380px]"
          role="img"
          aria-label={`Plan des déperditions${multiNiveaux ? ` — ${nomNiveau(niveauActifId)}` : ''}`}
        >
          <defs>
            <pattern
              id={`hachure-res-${niveauActifId}`}
              patternUnits="userSpaceOnUse"
              width="20"
              height="20"
              patternTransform="rotate(45)"
            >
              <rect width="20" height="20" className="fill-slate-100" />
              <line x1="0" y1="0" x2="0" y2="20" className="stroke-slate-400" strokeWidth="4" />
            </pattern>
          </defs>
          {piecesNiveau.map((piece) => {
            const points = piece.polygone.map((p) => `${p.x},${p.y}`).join(' ');
            const centroide = piece.polygone.reduce(
              (acc, p) => ({
                x: acc.x + p.x / piece.polygone.length,
                y: acc.y + p.y / piece.polygone.length,
              }),
              { x: 0, y: 0 },
            );
            const resultat = parPiece.get(piece.id);
            const fill = piece.chauffee ? couleurPiece(piece) : `url(#hachure-res-${niveauActifId})`;
            return (
              <g key={piece.id}>
                <polygon
                  points={points}
                  fill={fill ?? undefined}
                  fillOpacity={piece.chauffee ? 0.55 : 1}
                  className="stroke-slate-500"
                  strokeWidth={2 * echelle}
                />
                <text
                  x={centroide.x}
                  y={centroide.y}
                  textAnchor="middle"
                  className="fill-slate-800 select-none"
                  style={{ fontSize: 20 * echelle }}
                >
                  {resultat ? `${piece.nom} · ${Math.round(resultat.total)} W` : piece.nom}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Légende de l'échelle de couleur (jamais la couleur seule : bornes chiffrées) */}
      <div className="flex items-center gap-2 text-xs text-secondary-500">
        <span>{Math.round(ratioMin)} W/m²</span>
        <span
          className="h-2 flex-1 max-w-[160px] rounded-full"
          style={{ background: 'linear-gradient(to right, #3b82f6, #f59e0b)' }}
        />
        <span>{Math.round(ratioMax)} W/m²</span>
        <span className="ml-1">— pièces non chauffées hachurées</span>
      </div>

      {/* Tableau par pièce (bâtiment entier) */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary-500 border-b border-secondary-100">
              <th className="py-2 pr-3 font-medium">Pièce</th>
              <th className="py-2 pr-3 font-medium text-right">Surface</th>
              <th className="py-2 pr-3 font-medium text-right">Transmission</th>
              <th className="py-2 pr-3 font-medium text-right">Ventilation</th>
              {avecRelance && <th className="py-2 pr-3 font-medium text-right">Relance</th>}
              <th className="py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {bilan.pieces.map((p) => (
              <tr key={p.id}>
                <td className="py-2 pr-3 text-secondary-900">
                  {p.nom}
                  {multiNiveaux && (
                    <span className="text-xs text-secondary-500">
                      {' '}— {nomNiveau(dessin.pieces.find((d) => d.id === p.id)?.niveauId)}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right text-secondary-600">{p.surface.toFixed(1)} m²</td>
                <td className="py-2 pr-3 text-right text-secondary-600">{fmtW(p.transmission)}</td>
                <td className="py-2 pr-3 text-right text-secondary-600">{fmtW(p.ventilation)}</td>
                {avecRelance && <td className="py-2 pr-3 text-right text-secondary-600">{fmtW(p.relance)}</td>}
                <td className="py-2 text-right font-medium text-secondary-900">{fmtW(p.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-secondary-200">
              <td className="py-2 pr-3 font-semibold text-secondary-900">Total</td>
              <td className="py-2 pr-3 text-right text-secondary-600">
                {bilan.pieces.reduce((s, p) => s + p.surface, 0).toFixed(1)} m²
              </td>
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3" />
              {avecRelance && <td className="py-2 pr-3" />}
              <td className="py-2 text-right font-semibold text-secondary-900">{fmtW(bilan.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
