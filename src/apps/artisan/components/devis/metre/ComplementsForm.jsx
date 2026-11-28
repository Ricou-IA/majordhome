// src/apps/artisan/components/devis/metre/ComplementsForm.jsx
// Compléments FACULTATIFS du relevé (src/lib/fumisterie/complements.js) : replié par défaut, rien n'est
// exigé, un champ vide laisse la règle « non vérifiée ». Les valeurs vont dans le relevé enregistré.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { complementsDuGabarit } from '@/lib/fumisterie/complements.js';
import ChampMesure from './ChampMesure';
import { inputClass } from '../../FormFields';
import { ChoixValeur } from './Puce';
import { InfoTip } from '@/components/ui/info-tip';

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
      <button type="button" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert} className="flex items-center gap-1.5 text-label text-secondary-800 hover:text-secondary-900">
        {ouvert ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Compléments facultatifs (règles du DTU){renseignes ? ` · ${renseignes} renseigné${renseignes > 1 ? 's' : ''}` : ''}
      </button>
      {ouvert && (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-secondary-600">Rien n’est obligatoire. Un champ vide laisse la règle « non vérifiée ».</p>
          {groupes.map((g) => (
            <fieldset key={g}>
              <legend className="text-label text-secondary-900">{GROUPES[g] || g}</legend>
              <div className="grid grid-cols-2 gap-3 mt-1">
                {champs.filter((c) => c.groupe === g).map((c) => (
                  <div key={c.cle} className={c.type === 'texte' || (c.choix && c.choix.length > 2) ? 'col-span-2' : ''}>
                    <div className="flex items-center gap-1 mb-1">
                      {c.type === 'choix'
                        ? <p className="text-sm text-secondary-700">{c.libelle}</p>
                        : <label htmlFor={`fum-${c.cle}`} className="text-sm text-secondary-700">{c.libelle}</label>}
                      {c.aide && <InfoTip>{c.aide}</InfoTip>}
                    </div>
                    {c.type === 'choix' ? (
                      <ChoixValeur id={`fum-${c.cle}`} libelle={c.libelle} choix={c.choix} valeur={releve[c.cle]} libelleDe={(v) => c.libelles?.[v] || v}
                        onChange={(v) => set(c.cle, v)} effacable />
                    ) : c.type === 'texte' ? (
                      <input id={`fum-${c.cle}`} type="text" value={releve[c.cle] ?? ''} onChange={(e) => set(c.cle, e.target.value)} className={inputClass} />
                    ) : (
                      <ChampMesure id={`fum-${c.cle}`} valeur={releve[c.cle]} unite={c.unite} onChange={(v) => set(c.cle, v)} />
                    )}
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
