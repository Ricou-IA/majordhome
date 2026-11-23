/**
 * SAVUrgency.jsx — degré d'urgence d'une demande SAV : sélecteur (création + fiche) et pastille (carte).
 * Les niveaux viennent de `src/lib/savUrgency.js` (source unique). Chaque niveau porte une icône ET
 * son libellé : la couleur seule ne porte jamais l'information.
 */

import { Zap, Hourglass, Minus } from 'lucide-react';
import { StatusPill } from '@components/ui/status-pill';
import { SAV_URGENCES, urgenceDe, urgenceVisible, libelleUrgence } from '@/lib/savUrgency';

// Ton de la pastille de la carte : l'urgence est la seule à crier ; « peut attendre » reste informatif.
const TON_URGENCE = { urgent: 'alerte', normal: 'neutre', peut_attendre: 'info' };

const VISUELS = {
  urgent: { Icon: Zap, actif: 'bg-red-600 text-white border-red-600' },
  normal: { Icon: Minus, actif: 'bg-secondary-700 text-white border-secondary-700' },
  peut_attendre: { Icon: Hourglass, actif: 'bg-secondary-500 text-white border-secondary-500' },
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
              estActif ? actif : 'bg-white text-secondary-600 border-secondary-200 hover:bg-secondary-50'
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
  const { Icon } = VISUELS[niveau];
  return (
    <StatusPill
      tone={TON_URGENCE[niveau]}
      taille={taille === 'fiche' ? 'normale' : 'compacte'}
      icone={<Icon className={taille === 'fiche' ? 'h-3.5 w-3.5' : 'h-3 w-3'} aria-hidden="true" />}
    >
      {libelleUrgence(niveau)}
    </StatusPill>
  );
}
