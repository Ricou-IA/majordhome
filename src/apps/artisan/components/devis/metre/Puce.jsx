// src/apps/artisan/components/devis/metre/Puce.jsx
// Choix du métré, un seul code visuel partout (recette du 2026-11-28 : noir dans le relevé, orange clair dans la
// qualification). 2 à 4 valeurs exclusives ⇒ SegmentedControl (segment actif blanc) ; au-delà ⇒ puces, la sélection
// en cuivre doux (une sélection est un usage du cuivre permis par la charte).
import { SegmentedControl } from '@/components/ui/segmented-control';

export function Puce({ actif, onClick, children, disabled = false }) {
  return (
    <button type="button" aria-pressed={actif} disabled={disabled} onClick={onClick}
      className={`min-h-[38px] px-3 py-1.5 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:shadow-ring tabular-nums ${actif ? 'bg-primary-50 border-primary-600 text-primary-800 font-medium' : 'bg-white border-secondary-300 text-secondary-700 hover:border-secondary-400'}`}>
      {children}
    </button>
  );
}

/**
 * Choix exclusif d'une valeur (nombre ou texte) parmi `choix`. `effacable` : re-choisir la valeur la retire
 * (compléments facultatifs). Rend `id` sur le conteneur pour le focus depuis la coupe et le bandeau d'erreurs.
 */
export function ChoixValeur({ id, libelle, choix, valeur, libelleDe, onChange, effacable = false, decritPar }) {
  const choisir = (c) => onChange(effacable && valeur === c ? '' : c);
  if (choix.length >= 2 && choix.length <= 4) {
    const options = choix.map((c) => ({ value: String(c), label: libelleDe(c) }));
    return (
      <div id={id} tabIndex={-1} aria-describedby={decritPar} className="focus:outline-none">
        <SegmentedControl label={libelle} value={valeur == null || valeur === '' ? '' : String(valeur)} options={options}
          onChange={(v) => choisir(choix.find((c) => String(c) === v))} className="flex w-full [&>button]:flex-1 [&>button]:justify-center" />
      </div>
    );
  }
  return (
    <div id={id} tabIndex={-1} role="group" aria-label={libelle} aria-describedby={decritPar} className="flex flex-wrap gap-2 focus:outline-none">
      {choix.map((c) => <Puce key={String(c)} actif={valeur === c} onClick={() => choisir(c)}>{libelleDe(c)}</Puce>)}
    </div>
  );
}
