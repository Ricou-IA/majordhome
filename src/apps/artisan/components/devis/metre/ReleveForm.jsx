// src/apps/artisan/components/devis/metre/ReleveForm.jsx
// Formulaire généré depuis fum_gabarits.troncons (aucun champ codé en dur). `si` masque un
// paramètre conditionnel ({ nbEtages: 1 } ou { angle: '>0' }). Les inputs portent id=`fum-${cle}`
// pour le focus depuis la coupe cotée. Visibilité = même règle que la validation du moteur.
import { parametreVisible as visible } from '@/lib/fumisterie/index.js';
import { libelleChoix } from '@/lib/fumisterie/planModel.js';
import { messageChamp } from '@/lib/fumisterie/messagesReleve.js';
import ChampMesure from './ChampMesure';
import { Button } from '@/components/ui/button';
import { ChoixValeur } from './Puce';

// `erreurs` : refus du relevé par clé (champsAcorriger), écrits sous le champ fautif.
// `sortie` : textes du bloc « Ajuster » (textesSortie) — d'où vient la valeur appliquée et la hauteur réelle. null = rien à expliquer.
export default function ReleveForm({ gabarit, releve, onChange, onAjuster, sortie = null, erreurs = {} }) {
  const set = (cle, v) => onChange({ ...releve, [cle]: v });
  const idErreur = (cle) => (erreurs[cle] ? `fum-${cle}-erreur` : null);
  return (
    <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="space-y-4">
      {gabarit.troncons.map((t) => (
        <fieldset key={t.type} className="border-t border-secondary-200 pt-3">
          <legend className="text-label text-secondary-900">{t.libelle}</legend>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {t.parametres.filter((p) => visible(p, releve)).map((p) => (
              <div key={p.cle} className={p.choix && p.choix.length > 2 ? 'col-span-2' : ''}>
                {p.choix
                  ? <p className="block text-sm text-secondary-700 mb-1">{p.libelle}</p>
                  : <label htmlFor={`fum-${p.cle}`} className="block text-sm text-secondary-700 mb-1">{p.libelle}</label>}
                {p.choix ? (
                  <ChoixValeur id={`fum-${p.cle}`} libelle={p.libelle} choix={p.choix} valeur={releve[p.cle]} libelleDe={(c) => libelleChoix(p, c)}
                    onChange={(v) => set(p.cle, v)} decritPar={idErreur(p.cle) || undefined} />
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
