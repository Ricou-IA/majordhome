// src/apps/thermique/components/wizard/ResultatsPiecesGrid.jsx
// Rendu paramétrique des résultats par pièce (étape 4, saisie paramétrique) — pas de polygone
// dessiné (aucune emprise pièce par pièce en mode paramétrique), donc chaque pièce = vignette
// proportionnelle à sa surface (côté √surface), disposées en grille flex, colorée par ratio W/m²
// (interpolation linéaire bleu #3b82f6 → ambre #f59e0b, palette et fmtW copiés de PlanResultats —
// JAMAIS rouge/vert, règle produit R12, palette deutan). Tableau détaillé par pièce sous la
// grille, avec la colonne Puissance émetteur (= total × foisonnement, posée par buildEtudeModel).
// Seules les pièces chauffées figurent dans bilan.pieces (cf. calculeBatiment).
import { useMemo } from 'react';

const BLEU = [59, 130, 246];   // #3b82f6 — pièce la moins déperditive (W/m²)
const AMBRE = [245, 158, 11];  // #f59e0b — pièce la plus déperditive (W/m²)

/** Interpolation linéaire bleu → ambre, t ∈ [0, 1]. */
function couleurRatio(t) {
  const c = BLEU.map((v, i) => Math.round(v + (AMBRE[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const fmtW = (v) => `${Math.round(v).toLocaleString('fr-FR')} W`;

// Échelle des vignettes : côté proportionnel à √surface (m²), borné pour rester lisible en grille.
const PX_PAR_RACINE_M2 = 26;
const COTE_MIN = 64;
const COTE_MAX = 180;

/**
 * @param {Object} props
 * @param {Object} props.bilan bilan de calculeBatiment (mode paramétrique) — pieces: [{id, nom,
 *   surface, transmission, ventilation, relance, total, puissanceEmetteur}], total, parPoste.
 */
export default function ResultatsPiecesGrid({ bilan }) {
  const { ratioMin, ratioMax } = useMemo(() => {
    const ratios = bilan.pieces.map((p) => p.total / p.surface);
    return { ratioMin: Math.min(...ratios), ratioMax: Math.max(...ratios) };
  }, [bilan.pieces]);

  const couleurPiece = (p) => {
    const ratio = p.total / p.surface;
    const t = ratioMax > ratioMin ? (ratio - ratioMin) / (ratioMax - ratioMin) : 0.5;
    return couleurRatio(t);
  };

  // Colonne Relance SEULEMENT si la relance participe au bilan (fRH effectif > 0).
  const avecRelance = (bilan.parPoste?.relance ?? 0) > 0;

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-secondary-900 text-sm">Déperditions par pièce</h3>

      {/* Vignettes proportionnelles (côté √surface) — pas de plan dessiné en saisie paramétrique */}
      <div className="flex flex-wrap items-end gap-2 bg-white border border-secondary-100 rounded-lg p-3">
        {bilan.pieces.map((p) => {
          const cote = Math.min(COTE_MAX, Math.max(COTE_MIN, Math.sqrt(p.surface) * PX_PAR_RACINE_M2));
          return (
            <div
              key={p.id}
              className="flex flex-col items-center justify-center text-center rounded-md border border-slate-500/40 px-1.5 py-1 overflow-hidden"
              style={{ width: cote, height: cote, backgroundColor: couleurPiece(p), opacity: 0.85 }}
              title={`${p.nom} · ${Math.round(p.total)} W`}
            >
              <span className="text-xs font-medium text-slate-900 leading-tight truncate w-full">{p.nom}</span>
              <span className="text-[11px] text-slate-800">{Math.round(p.total)} W</span>
            </div>
          );
        })}
      </div>

      {/* Légende de l'échelle de couleur (jamais la couleur seule : bornes chiffrées) */}
      <div className="flex items-center gap-2 text-xs text-secondary-500">
        <span>{Math.round(ratioMin)} W/m²</span>
        <span
          className="h-2 flex-1 max-w-[160px] rounded-full"
          style={{ background: 'linear-gradient(to right, #3b82f6, #f59e0b)' }}
        />
        <span>{Math.round(ratioMax)} W/m²</span>
      </div>

      {/* Tableau par pièce */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary-500 border-b border-secondary-100">
              <th className="py-2 pr-3 font-medium">Pièce</th>
              <th className="py-2 pr-3 font-medium text-right">Surface</th>
              <th className="py-2 pr-3 font-medium text-right">Transmission</th>
              <th className="py-2 pr-3 font-medium text-right">Ventilation</th>
              {avecRelance && <th className="py-2 pr-3 font-medium text-right">Relance</th>}
              <th className="py-2 pr-3 font-medium text-right">Total</th>
              <th className="py-2 font-medium text-right">Puissance émetteur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {bilan.pieces.map((p) => (
              <tr key={p.id}>
                <td className="py-2 pr-3 text-secondary-900">{p.nom}</td>
                <td className="py-2 pr-3 text-right text-secondary-600">{p.surface.toFixed(1)} m²</td>
                <td className="py-2 pr-3 text-right text-secondary-600">{fmtW(p.transmission)}</td>
                <td className="py-2 pr-3 text-right text-secondary-600">{fmtW(p.ventilation)}</td>
                {avecRelance && <td className="py-2 pr-3 text-right text-secondary-600">{fmtW(p.relance)}</td>}
                <td className="py-2 pr-3 text-right font-medium text-secondary-900">{fmtW(p.total)}</td>
                <td className="py-2 text-right text-secondary-900">{fmtW(p.puissanceEmetteur ?? p.total)}</td>
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
              <td className="py-2 pr-3 text-right font-semibold text-secondary-900">{fmtW(bilan.total)}</td>
              <td className="py-2 text-right font-semibold text-secondary-900">
                {fmtW(bilan.pieces.reduce((s, p) => s + (p.puissanceEmetteur ?? p.total), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
