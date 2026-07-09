// src/apps/thermique/components/wizard/PanneauCoherence.jsx
// Affiche reconcilieBatiment(saisie) : par niveau, surface pièces vs emprise et métré mur ext vs
// périmètre, avec badge ambre si alerte. Non bloquant.
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { reconcilieBatiment } from '../../lib/reconciliationEmprise';

const pct = (x) => `${Math.round(x * 100)} %`;

export default function PanneauCoherence({ saisie }) {
  const r = reconcilieBatiment(saisie, { seuilPct: 0.10 });
  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-2">
        {r.alerteGlobale ? <AlertTriangle className="w-4 h-4 text-amber-600" /> : <CheckCircle2 className="w-4 h-4 text-green-600" />}
        <h3 className="font-semibold text-secondary-900 text-sm">Cohérence emprise ↔ pièces</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary-500 border-b border-secondary-100">
              <th className="py-1.5 pr-3 font-medium">Niveau</th>
              <th className="py-1.5 pr-3 font-medium text-right">Surface pièces / emprise</th>
              <th className="py-1.5 pr-3 font-medium text-right">Mur ext / périmètre</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {r.parNiveau.map((n) => (
              <tr key={n.niveauId} className={n.alerte ? 'text-amber-800' : 'text-secondary-700'}>
                <td className="py-1.5 pr-3">{n.nom}</td>
                <td className="py-1.5 pr-3 text-right">{n.surfacePieces.toFixed(1)} / {n.surfaceEmprise.toFixed(1)} m² {n.ecartSurfacePct > 0.10 && `(${pct(n.ecartSurfacePct)})`}</td>
                <td className="py-1.5 pr-3 text-right">{n.mlExtPieces.toFixed(1)} / {n.perimetreEmprise.toFixed(1)} m {n.ecartMlPct > 0.10 && `(${pct(n.ecartMlPct)})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.alerteGlobale && (
        <p className="text-xs text-amber-700">Écart {'>'} 10 % — vérifiez les métrés (non bloquant).</p>
      )}
    </div>
  );
}
