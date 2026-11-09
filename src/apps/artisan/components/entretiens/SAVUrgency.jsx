/**
 * SAVUrgency.jsx — degré d'urgence d'une demande SAV : sélecteur (création + fiche) et pastille (carte).
 * Les niveaux viennent de `src/lib/savUrgency.js` (source unique). Chaque niveau porte une icône ET
 * son libellé : la couleur seule ne porte jamais l'information.
 */

import { Zap, Hourglass, Minus } from 'lucide-react';
import { SAV_URGENCES, urgenceDe, urgenceVisible, libelleUrgence } from '@/lib/savUrgency';

const VISUELS = {
  urgent: { Icon: Zap, actif: 'bg-red-600 text-white border-red-600', pastille: 'bg-red-600 text-white' },
  normal: { Icon: Minus, actif: 'bg-gray-700 text-white border-gray-700', pastille: 'bg-gray-100 text-gray-600' },
  peut_attendre: { Icon: Hourglass, actif: 'bg-slate-500 text-white border-slate-500', pastille: 'bg-slate-100 text-slate-600' },
};

/**
 * Choix du niveau (trois boutons, un seul actif).
 * @param {{ value: string, onChange?: (v: string) => void, disabled?: boolean }} props
 */
export function SAVUrgencySelect({ value, onChange, disabled = false }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Degré d'urgence">
      {SAV_URGENCES.map((niveau) => {
        const { Icon, actif } = VISUELS[niveau.value];
        const estActif = value === niveau.value;
        return (
          <button
            key={niveau.value}
            type="button"
            role="radio"
            aria-checked={estActif}
            onClick={() => onChange?.(niveau.value)}
            disabled={disabled}
            title={niveau.description}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50 ${
              estActif ? actif : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {niveau.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pastille de la carte : rien pour « Normal », rien une fois l'intervention réalisée.
 * @param {{ item: object, taille?: 'carte' | 'fiche' }} props
 */
export function SAVUrgencyBadge({ item, taille = 'carte' }) {
  if (!urgenceVisible(item)) return null;
  const niveau = urgenceDe(item);
  const { Icon, pastille } = VISUELS[niveau];
  const classes = taille === 'fiche' ? 'text-xs px-2 py-0.5 gap-1' : 'text-[10px] px-1.5 py-0.5 gap-0.5';
  return (
    <span className={`inline-flex items-center font-semibold rounded ${classes} ${pastille}`}>
      <Icon className={taille === 'fiche' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
      {libelleUrgence(niveau)}
    </span>
  );
}
