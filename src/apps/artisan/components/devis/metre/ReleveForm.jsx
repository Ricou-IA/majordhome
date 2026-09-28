// src/apps/artisan/components/devis/metre/ReleveForm.jsx
// Formulaire généré depuis fum_gabarits.troncons (aucun champ codé en dur). `si` masque un
// paramètre conditionnel ({ nbEtages: 1 } ou { angle: '>0' }). Les inputs portent id=`fum-${cle}`
// pour le focus depuis la coupe cotée. Visibilité = même règle que la validation du moteur.
import { parametreVisible as visible } from '@/lib/fumisterie/index.js';

const INPUT = 'w-full px-2 py-1.5 border border-secondary-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500';

function libelleChoix(p, c) {
  if (typeof c === 'number' && p.unite === '°') return c === 0 ? 'Aucun' : `${c}°`;
  if (typeof c === 'number' && p.cle === 'nbEtages') return c === 0 ? 'Aucun' : '1 étage';
  if (typeof c === 'number') return `Ø ${c}`;
  if (c === 'noir') return 'Noir';
  if (c === 'inox') return 'Inox';
  return String(c);
}

export default function ReleveForm({ gabarit, releve, onChange, onAjuster, minSortie }) {
  const set = (cle, v) => onChange({ ...releve, [cle]: v });
  return (
    <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="space-y-4">
      {gabarit.troncons.map((t) => (
        <fieldset key={t.type} className="border-t border-secondary-200 pt-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-secondary-500">{t.libelle}</legend>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {t.parametres.filter((p) => visible(p, releve)).map((p) => (
              <div key={p.cle} className={p.choix && p.choix.length > 2 ? 'col-span-2' : ''}>
                <label htmlFor={`fum-${p.cle}`} className="block text-xs text-secondary-600 mb-1">{p.libelle}</label>
                {p.choix ? (
                  <div id={`fum-${p.cle}`} tabIndex={-1} className="flex border border-secondary-300 rounded-md overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary-500" role="group" aria-label={p.libelle}>
                    {p.choix.map((c) => (
                      <button key={String(c)} type="button" aria-pressed={releve[p.cle] === c} onClick={() => set(p.cle, c)}
                        className={`flex-1 px-2 py-1.5 text-sm font-mono border-l first:border-l-0 border-secondary-200 ${releve[p.cle] === c ? 'bg-secondary-700 text-white font-semibold' : 'bg-secondary-50 text-secondary-800'}`}>
                        {libelleChoix(p, c)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <input id={`fum-${p.cle}`} type="number" step={p.pas} min={p.min} max={p.max} value={releve[p.cle] ?? ''} onChange={(e) => set(p.cle, e.target.value === '' ? '' : Number(e.target.value))} className={INPUT} />
                    <span className="text-xs text-secondary-500 w-6">{p.unite}</span>
                  </div>
                )}
              </div>
            ))}
            {t.type === 'sortie_toit' && (
              <div className="col-span-2">
                <button type="button" onClick={onAjuster} className="w-full text-left px-3 py-2 rounded-md border border-secondary-400 bg-secondary-50 text-sm font-medium text-secondary-800 hover:bg-secondary-700 hover:text-white">↥ Ajuster la sortie au minimum de zone 1</button>
                {minSortie != null && <p className="text-xs text-secondary-500 mt-1">Minimum réglementaire calculé : {Number(minSortie).toFixed(2).replace('.', ',')} m au-dessus du toit.</p>}
              </div>
            )}
          </div>
        </fieldset>
      ))}
    </form>
  );
}
