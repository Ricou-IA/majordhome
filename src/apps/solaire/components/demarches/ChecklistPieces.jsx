// src/apps/solaire/components/demarches/ChecklistPieces.jsx
// Pièces à collecter : statut par pièce (a_demander | recue | non_applicable), persisté par le parent.
import { Check, Circle, Minus, Loader2 } from 'lucide-react';

const STATUTS = {
  a_demander: { Icon: Circle, libelle: 'À demander', classes: 'text-secondary-500' },
  recue: { Icon: Check, libelle: 'Reçue', classes: 'text-[#1565C0]' },
  non_applicable: { Icon: Minus, libelle: 'Sans objet', classes: 'text-secondary-400' },
};

export default function ChecklistPieces({ pieces, statuts, onToggle, busy }) {
  if (!pieces?.length) return null;
  return (
    <ul className="divide-y divide-secondary-100">
      {pieces.map((p) => {
        const statut = p.applicable ? (statuts?.[p.code] === 'recue' ? 'recue' : 'a_demander') : 'non_applicable';
        const s = STATUTS[statut];
        const Icon = s.Icon;
        return (
          <li key={p.code} className="py-1.5">
            <button
              type="button"
              disabled={!p.applicable || busy}
              onClick={() => onToggle(p.code, statut === 'recue' ? 'a_demander' : 'recue')}
              className={`w-full flex items-center gap-2 text-left text-sm rounded-md px-2 py-1 ${p.applicable ? 'hover:bg-secondary-50' : 'cursor-default'}`}
              aria-label={`${p.libelle} : ${s.libelle}`}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin text-secondary-400" /> : <Icon className={`w-4 h-4 ${s.classes}`} aria-hidden="true" />}
              <span className={`flex-1 ${p.applicable ? 'text-secondary-800' : 'text-secondary-400 line-through'}`}>{p.libelle}</span>
              <span className={`text-xs ${s.classes}`}>{s.libelle}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
