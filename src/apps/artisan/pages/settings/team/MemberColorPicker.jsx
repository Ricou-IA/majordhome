// src/apps/artisan/pages/settings/team/MemberColorPicker.jsx
// ============================================================================
// Sélecteur de couleur planning d'une personne : grille de la palette
// (src/lib/planningPalette.js, violet facturé exclu) + saisie hexadécimale libre.
// Une teinte déjà portée par quelqu'un d'autre est signalée (initiales sur la
// pastille, libellé au survol) sans être bloquée : deux personnes peuvent
// partager une couleur, c'est l'admin qui juge.
// ============================================================================
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  PLANNING_PALETTE, FALLBACK_COLOR, normalizeHex, isReservedColor, isLightColor, paletteLabel,
} from '@/lib/planningPalette';

const initiales = (name) => (name || '?').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

/**
 * @param {{
 *   color: string|null,
 *   onPick: (hex: string) => void,
 *   disabled?: boolean,
 *   owners?: Map<string, string>  // hex normalisé → nom de la personne qui l'utilise déjà (hors membre édité)
 * }} props
 */
export function MemberColorPicker({ color, onPick, disabled = false, owners }) {
  const current = normalizeHex(color);
  const [libre, setLibre] = useState(current || '');
  const [erreur, setErreur] = useState(null);

  useEffect(() => { setLibre(current || ''); setErreur(null); }, [current]);

  const appliquerLibre = () => {
    const hex = normalizeHex(libre);
    if (!hex) { setErreur('Code attendu : #RRGGBB (ex. #1D4ED8).'); return; }
    if (isReservedColor(hex)) { setErreur('Le violet est réservé aux rendez-vous facturés sur le calendrier.'); return; }
    setErreur(null);
    if (hex !== current) onPick(hex);
  };

  const owner = current ? owners?.get(current) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-xs font-semibold"
          style={{ backgroundColor: current || FALLBACK_COLOR, color: isLightColor(current || FALLBACK_COLOR) ? '#0F172A' : '#FFFFFF' }}
          aria-hidden="true"
        >
          Aa
        </span>
        <div className="text-sm">
          <p className="font-medium text-secondary-900">{current ? paletteLabel(current) : 'Aucune couleur'}</p>
          <p className="text-xs text-secondary-500">
            {current || FALLBACK_COLOR}
            {owner && <span className="text-amber-700"> · aussi utilisée par {owner}</span>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2" role="listbox" aria-label="Palette de couleurs planning">
        {PLANNING_PALETTE.map((c) => {
          const selected = c.hex === current;
          const takenBy = owners?.get(c.hex);
          return (
            <button
              key={c.hex}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => { if (!selected) onPick(c.hex); }}
              title={takenBy ? `${c.label} — déjà utilisée par ${takenBy}` : c.label}
              className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 ${
                selected ? 'border-secondary-900 scale-110' : 'border-transparent hover:scale-110'
              }`}
              style={{ backgroundColor: c.hex }}
            >
              {selected && <Check className="h-4 w-4" style={{ color: isLightColor(c.hex) ? '#0F172A' : '#FFFFFF' }} />}
              {!selected && takenBy && (
                <span
                  className="text-[9px] font-semibold leading-none"
                  style={{ color: isLightColor(c.hex) ? '#0F172A' : '#FFFFFF' }}
                >
                  {initiales(takenBy)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2">
        <div className="flex-1">
          <label className="block text-xs text-secondary-500 mb-1" htmlFor="member-color-hex">Autre couleur (code hexadécimal)</label>
          <div className="flex items-center gap-2">
            <input
              id="member-color-hex"
              type="text"
              value={libre}
              disabled={disabled}
              onChange={(e) => { setLibre(e.target.value); setErreur(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); appliquerLibre(); } }}
              placeholder="#1D4ED8"
              spellCheck={false}
              className="w-32 px-2 py-1 text-sm font-mono border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={appliquerLibre}
              disabled={disabled || normalizeHex(libre) === current}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-secondary-300 text-secondary-700 hover:border-primary-400 hover:text-primary-700 disabled:opacity-50"
            >
              Appliquer
            </button>
          </div>
          {erreur && <p className="mt-1 text-xs text-red-600">{erreur}</p>}
        </div>
      </div>
    </div>
  );
}

export default MemberColorPicker;
