import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { cn } from '@lib/utils';
import { avecRecherche, filtrerOptions, libelleDe } from '@/lib/listeOptions';

/**
 * Liste déroulante stylée (DA § 7 « Plus de `<select>` natif ») : champ de recherche dès
 * 7 options, clavier (↑ ↓ Entrée Échap), sélection en cuivre clair. `onChange` reçoit
 * `String(option.value)` — exactement ce que rendait `e.target.value` d'un `<select>` —,
 * option vide comprise (`''`). La liste est une couche Radix : dans une fenêtre ou un
 * panneau, Échap ferme la liste, pas la fenêtre.
 *
 * @param {Object} props
 * @param {unknown} props.value
 * @param {(valeur: string) => void} props.onChange
 * @param {Array<{ value: unknown, label: string, disabled?: boolean }>} props.options
 * @param {string} [props.placeholder]  texte quand aucune option ne correspond à `value`
 * @param {boolean} [props.disabled]
 * @param {string} [props.libelle]      nom lu par un lecteur d'écran (sinon le libellé de champ associé)
 * @param {string} [props.id]
 * @param {string} [props.className]    classes du déclencheur
 * @param {boolean} [props.required]    annoncé (aria-required) ; la vérification reste à l'appelant
 *   (un Combobox ne bloque pas l'envoi d'un formulaire comme un <select required>).
 */
export function Combobox({ value, onChange, options = [], placeholder = 'Choisir…', disabled = false, libelle, id, className, required = false }) {
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [actif, setActif] = useState(0);
  const listeId = useId();
  const listeRef = useRef(null);

  const recherche = avecRecherche(options);
  const visibles = useMemo(() => filtrerOptions(options, saisie), [options, saisie]);
  const libelle_ = libelleDe(options, value);
  const cleCourante = value === null || value === undefined ? '' : String(value);

  // À l'ouverture : la saisie se vide, l'option choisie devient l'option active.
  const ouvrir = (o) => {
    if (disabled) return;
    if (o) {
      setSaisie('');
      const rang = options.findIndex((opt) => String(opt.value ?? '') === cleCourante);
      setActif(rang >= 0 ? rang : 0);
    }
    setOuvert(o);
  };

  // L'option active reste visible quand on la déplace au clavier — en réglant le défilement de
  // la liste seule (scrollIntoView ferait aussi défiler la page ou la fenêtre derrière).
  useEffect(() => {
    if (!ouvert) return;
    const liste = listeRef.current;
    const ligne = liste?.querySelector(`[data-rang="${actif}"]`);
    if (!liste || !ligne) return;
    if (ligne.offsetTop < liste.scrollTop) liste.scrollTop = ligne.offsetTop;
    else if (ligne.offsetTop + ligne.offsetHeight > liste.scrollTop + liste.clientHeight) {
      liste.scrollTop = ligne.offsetTop + ligne.offsetHeight - liste.clientHeight;
    }
  }, [actif, ouvert]);

  /** Prochaine option non désactivée dans le sens `pas` (+1 / -1), sinon la position actuelle. */
  const suivante = (depuis, pas) => {
    for (let i = depuis + pas; i >= 0 && i < visibles.length; i += pas) if (!visibles[i].disabled) return i;
    return depuis;
  };

  const choisir = (option) => {
    if (!option || option.disabled) return;
    // Comme un <select> : rechoisir l'option déjà choisie ne déclenche pas onChange.
    if (String(option.value ?? '') !== cleCourante) onChange?.(String(option.value ?? ''));
    setOuvert(false);
  };

  const auClavier = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif((i) => suivante(i, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((i) => suivante(i, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActif(suivante(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setActif(suivante(visibles.length, -1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choisir(visibles[actif]); }
    // Tab : on referme et le focus repart du champ, vers le champ suivant du formulaire.
    else if (e.key === 'Tab') { setOuvert(false); }
  };

  return (
    // modal : la liste bloque le défilement de la page mais défile elle-même, même dans un panneau latéral.
    <Popover modal open={ouvert} onOpenChange={ouvrir}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={ouvert}
          aria-haspopup="listbox"
          aria-controls={listeId}
          aria-label={libelle}
          aria-required={required || undefined}
          disabled={disabled}
          onKeyDown={(e) => {
            if (!ouvert && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); ouvrir(true); }
          }}
          className={cn(
            'flex h-[38px] w-full items-center justify-between gap-2 rounded-lg border border-secondary-300 bg-white px-3 text-left text-sm text-secondary-900 shadow-xs outline-none transition-colors',
            'focus-visible:border-primary-600 focus-visible:shadow-ring',
            'disabled:cursor-not-allowed disabled:border-secondary-200 disabled:bg-secondary-50 disabled:text-secondary-600',
            className,
          )}
        >
          <span className={cn('min-w-0 truncate', libelle_ === null && 'text-secondary-400')}>
            {libelle_ ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-secondary-400" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Au-dessus de toute fenêtre de l'application (les plus hautes sont à z-[80]).
        className="z-[90] w-[var(--radix-popover-trigger-width)] min-w-[12rem] p-1 shadow-lg"
        onOpenAutoFocus={(e) => { if (!recherche) { e.preventDefault(); listeRef.current?.focus(); } }}
      >
        {recherche && (
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" aria-hidden="true" />
            <input
              type="text"
              value={saisie}
              onChange={(e) => { setSaisie(e.target.value); setActif(0); }}
              onKeyDown={auClavier}
              placeholder="Rechercher…"
              aria-label="Rechercher dans la liste"
              aria-controls={listeId}
              className="h-9 w-full rounded-md border border-secondary-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-primary-600 focus:shadow-ring"
            />
          </div>
        )}
        <ul
          id={listeId}
          ref={listeRef}
          role="listbox"
          tabIndex={-1}
          aria-label={libelle}
          onKeyDown={recherche ? undefined : auClavier}
          className="max-h-[320px] overflow-y-auto outline-none"
        >
          {visibles.length === 0 && (
            <li className="px-3 py-2 text-sm text-secondary-500">Aucun résultat</li>
          )}
          {visibles.map((option, rang) => {
            const choisie = String(option.value ?? '') === cleCourante;
            return (
              <li
                key={`${String(option.value ?? '')}-${rang}`}
                role="option"
                data-rang={rang}
                aria-selected={choisie}
                aria-disabled={option.disabled || undefined}
                onMouseEnter={() => setActif(rang)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choisir(option)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm',
                  rang === actif ? 'bg-secondary-100' : '',
                  choisie ? 'font-semibold text-secondary-900' : 'text-secondary-800',
                  option.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {choisie && <Check className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default Combobox;
