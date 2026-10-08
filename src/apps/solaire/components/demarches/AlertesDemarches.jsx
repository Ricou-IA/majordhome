// src/apps/solaire/components/demarches/AlertesDemarches.jsx
// Alertes du parcours : couleur + icône + libellé du niveau (jamais la couleur seule, deutan).
import { Info, AlertTriangle, ShieldAlert } from 'lucide-react';

const NIVEAUX = {
  info: { Icon: Info, libelle: 'Information', classes: 'border-[#2196F3] bg-[#E3F0FD] text-[#0D47A1]' },
  avertissement: { Icon: AlertTriangle, libelle: 'À vérifier', classes: 'border-[#F5C542] bg-[#FFF6D6] text-[#7C4A03]' },
  bloquant: { Icon: ShieldAlert, libelle: 'Bloquant', classes: 'border-[#0D47A1] bg-[#0D47A1] text-white' },
};

export default function AlertesDemarches({ alertes }) {
  if (!alertes?.length) return null;
  return (
    <div className="space-y-2">
      {alertes.map((a, i) => {
        const n = NIVEAUX[a.niveau] ?? NIVEAUX.info;
        const Icon = n.Icon;
        return (
          <div key={`${a.code}-${i}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${n.classes}`}>
            <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <span className="font-semibold">{n.libelle} · </span>
              <span>{a.message}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
