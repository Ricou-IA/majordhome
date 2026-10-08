// src/apps/solaire/components/demarches/ParcoursSynoptique.jsx
// Synoptique du parcours : Étape | Ce que vous faites (jaune) | Ce que nous faisons (bleu).
// Rendu pur depuis `resultat.etapes` (étapes applicables seulement).
import { User, Building2, Clock } from 'lucide-react';

export default function ParcoursSynoptique({ etapes }) {
  const visibles = (etapes ?? []).filter((e) => e.applicable);
  if (!visibles.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-y-1">
        <thead>
          <tr className="text-left text-xs">
            <th className="px-2 py-1 font-medium text-secondary-500 w-[22%]">Étape</th>
            <th className="px-2 py-1 font-semibold text-[#7C4A03] bg-[#FFF6D6] border-b-2 border-[#F5C542] rounded-t-md">
              <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" aria-hidden="true" /> Ce que vous faites</span>
            </th>
            <th className="px-2 py-1 font-semibold text-[#0D47A1] bg-[#E3F0FD] border-b-2 border-[#2196F3] rounded-t-md">
              <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" aria-hidden="true" /> Ce que nous faisons</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((e, i) => (
            <tr key={e.code} className="align-top">
              <td className="px-2 py-2">
                <div className="flex items-start gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-secondary-900 text-white text-[11px] font-semibold flex-shrink-0">{i + 1}</span>
                  <div>
                    <p className="font-medium text-secondary-900">{e.libelle}</p>
                    {e.delai?.libelle && (
                      <p className="text-xs text-secondary-500 inline-flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden="true" /> {e.delai.libelle}</p>
                    )}
                    {e.tiers && <p className="text-xs text-secondary-500">avec : {e.tiers}</p>}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 bg-[#FFF6D6] border-l-2 border-[#F5C542] text-secondary-800">{e.client ?? <span className="text-secondary-400">—</span>}</td>
              <td className="px-3 py-2 bg-[#E3F0FD] border-l-2 border-[#2196F3] text-secondary-800">{e.installateur}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
