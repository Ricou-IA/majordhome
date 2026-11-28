// src/apps/artisan/components/devis/metre/ReleveForm.jsx
// Formulaire généré depuis fum_gabarits.troncons (aucun champ codé en dur). `si` masque un
// paramètre conditionnel ({ nbEtages: 1 } ou { angle: '>0' }). Les inputs portent id=`fum-${cle}`
// pour le focus depuis la coupe cotée. Visibilité = même règle que la validation du moteur.
import { parametreVisible as visible } from '@/lib/fumisterie/index.js';
import { libelleChoix } from '@/lib/fumisterie/planModel.js';
import { messageChamp } from '@/lib/fumisterie/messagesReleve.js';
import ChampMesure from './ChampMesure';
import { Button } from '@/components/ui/button';

// `erreurs` : refus du relevé par clé (champsAcorriger), écrits sous le champ fautif.
// `sortie` : textes du bloc « Ajuster » (textesSortie) — d'où vient la valeur appliquée et la hauteur réelle. null = rien à expliquer.
export default function ReleveForm({ gabarit, releve, onChange, onAjuster, sortie = null, erreurs = {} }) {
  const set = (cle, v) => onChange({ ...releve, [cle]: v });
  const idErreur = (cle) => (erreurs[cle] ? `fum-${cle}-erreur` : null);
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
                  <div id={`fum-${p.cle}`} tabIndex={-1} className="flex border border-secondary-300 rounded-md overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary-500" role="group" aria-label={p.libelle} aria-describedby={idErreur(p.cle) || undefined}>
                    {p.choix.map((c) => (
                      <button key={String(c)} type="button" aria-pressed={releve[p.cle] === c} onClick={() => set(p.cle, c)}
                        className={`flex-1 px-2 py-1.5 text-sm font-mono border-l first:border-l-0 border-secondary-200 ${releve[p.cle] === c ? 'bg-secondary-700 text-white font-semibold' : 'bg-secondary-50 text-secondary-800'}`}>
                        {libelleChoix(p, c)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <ChampMesure id={`fum-${p.cle}`} valeur={releve[p.cle]} unite={p.unite} onChange={(v) => set(p.cle, v)} message={erreurs[p.cle] ? messageChamp(erreurs[p.cle]) : null} />
                )}
                {p.choix && erreurs[p.cle] && <p id={idErreur(p.cle)} className="mt-1 text-caption text-st-alerte">{messageChamp(erreurs[p.cle])}</p>}
              </div>
            ))}
            {t.type === 'sortie_toit' && (
              <div className="col-span-2">
                <Button type="button" variant="secondary" size="sm" onClick={onAjuster}>{sortie?.bouton || 'Ajuster la sortie au minimum'}</Button>
                {sortie?.aViser && <p className="text-caption text-secondary-700 mt-1.5">{sortie.aViser}</p>}
                {sortie?.hauteur && <p className="text-caption text-secondary-600 mt-0.5">{sortie.hauteur}</p>}
              </div>
            )}
          </div>
        </fieldset>
      ))}
    </form>
  );
}
