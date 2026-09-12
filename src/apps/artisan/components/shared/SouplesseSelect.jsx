// src/apps/artisan/components/shared/SouplesseSelect.jsx
// ============================================================================
// Souplesse d'un rendez-vous (spec 2026-09-12 « fenêtres d'abord, heures
// ensuite ») : jusqu'où son heure peut glisser pour améliorer une tournée.
// Un seul composant pour la prise (CTA, assistant), l'édition (EventModal) et
// le panneau Tournées — aucune logique dupliquée.
//
// Valeurs, libellés, phrase d'annonce : src/lib/souplesse.js (module pur).
// ============================================================================
import { Lock, MoveHorizontal } from 'lucide-react';
import { SOUPLESSES } from '@/lib/souplesse';

/**
 * @param {object} props
 * @param {number|null} props.value     souplesse choisie ; null = défaut d'org
 * @param {(next: number) => void} props.onChange
 * @param {number} [props.defaut=30]    souplesse par défaut de l'org (présélectionnée quand value est null)
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.compact]     boutons plus petits (panneaux)
 */
export function SouplesseSelect({ value, onChange, defaut = 30, disabled = false, compact = false }) {
  const effectif = value ?? defaut;
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Souplesse du rendez-vous">
      {SOUPLESSES.map((s) => {
        const on = s.value === effectif;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={s.aide}
            onClick={() => onChange(s.value)}
            className={`inline-flex items-center gap-1 rounded-full border transition-colors disabled:opacity-50 ${compact ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'} ${on
              ? 'bg-primary-600 text-white border-primary-600'
              : 'bg-white text-secondary-700 border-secondary-300 hover:border-primary-400'}`}
          >
            {s.value === 0 ? <Lock className="h-3 w-3" /> : <MoveHorizontal className="h-3 w-3" />}
            {s.label}
            {value == null && s.value === defaut && <span className="opacity-70">(défaut)</span>}
          </button>
        );
      })}
    </div>
  );
}
