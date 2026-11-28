// src/apps/artisan/components/devis/metre/ComplementsForm.jsx
// Compléments FACULTATIFS du relevé (src/lib/fumisterie/complements.js) : replié par défaut, rien n'est
// exigé, un champ vide laisse la règle « non vérifiée ». Les valeurs vont dans le relevé enregistré.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { complementsDuGabarit } from '@/lib/fumisterie/complements.js';

const INPUT = 'w-full px-2 py-1.5 border border-secondary-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500';
const GROUPES = { debouche: 'Débouché', raccordement: 'Raccordement', ventouse: 'Ventouse', dimensionnement: 'Dimensionnement', existant: 'Conduit existant' };

export default function ComplementsForm({ gabaritCode, releve, onChange }) {
  const champs = complementsDuGabarit(gabaritCode);
  const renseignes = champs.filter((c) => releve[c.cle] != null && releve[c.cle] !== '').length;
  const [ouvert, setOuvert] = useState(renseignes > 0);
  if (!champs.length) return null;
  const set = (cle, v) => onChange({ ...releve, [cle]: v });
  const groupes = [...new Set(champs.map((c) => c.groupe))];
  return (
    <section className="border-t border-secondary-200 pt-3 mt-4">
      <button type="button" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-secondary-600 hover:text-secondary-900">
        {ouvert ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Compléments facultatifs (règles du DTU){renseignes ? ` · ${renseignes} renseigné${renseignes > 1 ? 's' : ''}` : ''}
      </button>
      {ouvert && (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-secondary-500">Rien n’est obligatoire. Un champ vide laisse la règle « non vérifiée ».</p>
          {groupes.map((g) => (
            <fieldset key={g}>
              <legend className="text-xs font-semibold text-secondary-500">{GROUPES[g] || g}</legend>
              <div className="grid grid-cols-2 gap-3 mt-1">
                {champs.filter((c) => c.groupe === g).map((c) => (
                  <div key={c.cle} className={c.type === 'texte' || (c.choix && c.choix.length > 2) ? 'col-span-2' : ''}>
                    <label htmlFor={`fum-${c.cle}`} className="block text-xs text-secondary-600 mb-1">{c.libelle}</label>
                    {c.type === 'choix' ? (
                      <div id={`fum-${c.cle}`} role="group" aria-label={c.libelle} className="flex border border-secondary-300 rounded-md overflow-hidden">
                        {c.choix.map((v) => (
                          <button key={v} type="button" aria-pressed={releve[c.cle] === v} onClick={() => set(c.cle, releve[c.cle] === v ? '' : v)}
                            className={`flex-1 px-2 py-1.5 text-sm border-l first:border-l-0 border-secondary-200 ${releve[c.cle] === v ? 'bg-secondary-700 text-white font-semibold' : 'bg-secondary-50 text-secondary-800'}`}>
                            {c.libelles?.[v] || v}
                          </button>
                        ))}
                      </div>
                    ) : c.type === 'texte' ? (
                      <input id={`fum-${c.cle}`} type="text" value={releve[c.cle] ?? ''} onChange={(e) => set(c.cle, e.target.value)} className={INPUT} />
                    ) : (
                      <div className="flex items-center gap-1">
                        <input id={`fum-${c.cle}`} type="number" step={c.pas} min={c.min} max={c.max} value={releve[c.cle] ?? ''} onChange={(e) => set(c.cle, e.target.value === '' ? '' : Number(e.target.value))} className={INPUT} />
                        <span className="text-xs text-secondary-500 w-6">{c.unite}</span>
                      </div>
                    )}
                    {c.aide && <p className="text-xs text-secondary-500 mt-0.5">{c.aide}</p>}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </section>
  );
}
