// src/apps/thermique/components/wizard/PortesAFauxPanel.jsx
// Panneau des porte-à-faux (plancher d'un niveau supérieur donnant sur l'extérieur/vide) — partagé
// par les panneaux de validation de Step2Dessin et Step3. Chaque condition est soit à VALIDER
// (ambre + bouton « Valider (volontaire) »), soit CONFIRMÉE (note neutre). Présentation pure :
// la donnée vient de valideDessin().portesAFaux ([{ pieceId, nom, surfaceM2, valide }]).
// Le calcul reste inchangé quel que soit le statut (la paroi b=1 est toujours émise) : valider ne
// fait que masquer l'alerte « à vérifier » (drapeau piece.porteAFauxValide).
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

const fmtM2 = (m2) => (Math.round(m2 * 100) / 100).toString().replace('.', ',');

export default function PortesAFauxPanel({ portesAFaux, onValider }) {
  if (!portesAFaux || portesAFaux.length === 0) return null;
  return (
    <ul className="space-y-2">
      {portesAFaux.map((pf) => (pf.valide ? (
        <li key={pf.pieceId} className="flex items-start gap-2 text-sm text-secondary-600">
          <CheckCircle2 className="w-4 h-4 text-secondary-400 mt-0.5 flex-shrink-0" />
          <span>« {pf.nom} » : porte-à-faux confirmé — {fmtM2(pf.surfaceM2)} m² sur extérieur</span>
        </li>
      ) : (
        <li key={pf.pieceId} className="flex items-start gap-2 text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p>
              « {pf.nom} » : plancher en porte-à-faux sur l’extérieur ({fmtM2(pf.surfaceM2)} m²) —
              vérifiez le dessin, ou validez si c’est volontaire.
            </p>
            {onValider && (
              <button
                type="button"
                onClick={() => onValider(pf.pieceId)}
                className="px-2 py-1 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg"
              >
                Valider (porte-à-faux volontaire)
              </button>
            )}
          </div>
        </li>
      )))}
    </ul>
  );
}
