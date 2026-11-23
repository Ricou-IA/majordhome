import { useEffect, useId, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { fr } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from './popover';
import { cn } from '@lib/utils';
import { useDeviceClass } from '@hooks/useDeviceClass';
import {
  depuisIso, formatDateLongueFR, joursFeries, lireSaisieDate, raccourcisDate, saisieDepuisIso, versIso,
} from '@/lib/datesFr';

/**
 * Champ de date en français (DA § 7) : affiché « lun. 23 nov. 2026 », saisi au clavier en
 * jj/mm/aaaa, calendrier qui commence le lundi, jours fériés grisés (mais choisissables),
 * raccourcis Aujourd'hui / Demain / Lundi prochain. `onChange(iso)` reçoit `YYYY-MM-DD` ou
 * `''`, exactement comme `e.target.value` d'un `<input type="date">`. Une saisie impossible
 * ne change pas la valeur : le champ passe en rouge et le dit. Sur téléphone, le champ de
 * date du système (au pouce).
 *
 * @param {Object} props
 * @param {string} props.value  `YYYY-MM-DD` ou `''`
 * @param {(iso: string) => void} props.onChange
 * @param {string} [props.min]  `YYYY-MM-DD`
 * @param {string} [props.max]  `YYYY-MM-DD`
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.required]
 * @param {string} [props.id]
 * @param {string} [props.libelle]  nom lu par un lecteur d'écran
 * @param {string} [props.className]
 * @param {boolean} [props.autoFocus]
 */
export function DateInput({ value, onChange, min, max, disabled = false, required = false, id, libelle, className, autoFocus = false }) {
  const { isPhone } = useDeviceClass();
  const idAuto = useId();
  const idChamp = id || idAuto;
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState(null); // null = pas en cours de saisie
  const [erreur, setErreur] = useState(null);
  const [moisAffiche, setMoisAffiche] = useState(null);

  useEffect(() => { setErreur(null); }, [value]);

  const choisie = depuisIso(value);
  // Jours fériés de l'année affichée (et des voisines), pas seulement de celle de la valeur.
  const annee = (moisAffiche || choisie || new Date()).getFullYear();
  const feries = useMemo(
    () => [annee - 1, annee, annee + 1].flatMap(joursFeries).map(depuisIso),
    [annee],
  );
  const desactives = [
    min && depuisIso(min) ? { before: depuisIso(min) } : null,
    max && depuisIso(max) ? { after: depuisIso(max) } : null,
  ].filter(Boolean);

  const horsLimites = (iso) => (min && iso < min) || (max && iso > max);

  const valider = (iso) => {
    if (iso === null) { setErreur('Date invalide (jj/mm/aaaa)'); return false; }
    if (iso && horsLimites(iso)) { setErreur('Date hors des limites permises'); return false; }
    setErreur(null);
    if (iso !== (value || '')) onChange?.(iso);
    return true;
  };

  if (isPhone) {
    return (
      <input
        id={idChamp}
        type="date"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        aria-label={libelle}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn(
          'h-11 w-full rounded-lg border border-secondary-300 bg-white px-3 text-secondary-900 outline-none focus:border-primary-600 focus:shadow-ring disabled:bg-secondary-50',
          className,
        )}
      />
    );
  }

  return (
    <Popover modal open={ouvert} onOpenChange={(o) => { if (!disabled) setOuvert(o); }}>
      <PopoverAnchor asChild>
      <div className={cn('relative w-full', className)}>
        <input
          id={idChamp}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="jj/mm/aaaa"
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          aria-label={libelle}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? `${idChamp}-erreur` : undefined}
          value={saisie ?? formatDateLongueFR(value)}
          onFocus={() => setSaisie(saisieDepuisIso(value))}
          onChange={(e) => setSaisie(e.target.value)}
          // Quitter le champ sans rien changer n'écrit rien (une valeur stockée sous une autre forme reste telle quelle).
          onBlur={() => { if (saisie !== null && saisie !== saisieDepuisIso(value)) valider(lireSaisieDate(saisie)); setSaisie(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (valider(lireSaisieDate(saisie ?? ''))) e.currentTarget.blur(); }
            if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); setOuvert(true); }
          }}
          className={cn(
            'h-[38px] w-full rounded-lg border bg-white pl-3 pr-10 text-sm text-secondary-900 shadow-xs outline-none transition-colors',
            'focus:border-primary-600 focus:shadow-ring disabled:cursor-not-allowed disabled:bg-secondary-50 disabled:text-secondary-600',
            erreur ? 'border-st-alerte' : 'border-secondary-300',
          )}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Ouvrir le calendrier"
            className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-secondary-500 hover:bg-secondary-100 hover:text-secondary-900 focus-visible:shadow-ring focus-visible:outline-none disabled:opacity-50"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        {erreur && (
          <p id={`${idChamp}-erreur`} className="mt-1 text-caption text-st-alerte">{erreur}</p>
        )}
      </div>
      </PopoverAnchor>
      <PopoverContent align="start" className="mdh-calendrier z-[90] w-auto p-3 shadow-lg">
        <div className="mb-2 flex flex-wrap gap-1">
          {raccourcisDate().map((r) => (
            <button
              key={r.label}
              type="button"
              disabled={horsLimites(r.iso)}
              onClick={() => { if (valider(r.iso)) setOuvert(false); }}
              className="rounded-md border border-secondary-200 px-2 py-1 text-caption text-secondary-700 hover:bg-secondary-100 disabled:opacity-40"
            >
              {r.label}
            </button>
          ))}
        </div>
        <DayPicker
          mode="single"
          locale={fr}
          weekStartsOn={1}
          selected={choisie || undefined}
          defaultMonth={choisie || undefined}
          onMonthChange={setMoisAffiche}
          disabled={desactives}
          modifiers={{ ferie: feries }}
          modifiersClassNames={{ ferie: 'mdh-jour-ferie' }}
          onSelect={(jour) => { if (jour && valider(versIso(jour))) setOuvert(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}

export default DateInput;
