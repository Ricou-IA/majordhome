/**
 * SearchBar.jsx — Barre de recherche réutilisable
 * ============================================================================
 * Composant partagé pour la recherche dans les listes et Kanbans.
 * Remplace les implémentations dupliquées dans Clients, LeadKanban,
 * ChantierKanban, EntretienSAVKanban, etc.
 * ============================================================================
 */

import { Search, X } from 'lucide-react';

/**
 * @param {Object} props
 * @param {string} props.value - Valeur de recherche
 * @param {Function} props.onChange - Callback (newValue: string) => void
 * @param {string} [props.placeholder='Rechercher...'] - Placeholder
 * @param {string} [props.className] - Classes CSS additionnelles
 * @param {React.Ref<HTMLInputElement>} [props.inputRef] - Accès au champ (raccourci clavier)
 * @param {boolean} [props.grande=false] - Champ de 48 px (recherche principale d'une liste)
 * @param {string} [props.ariaLabel] - Nom du champ pour un lecteur d'écran (défaut : le placeholder)
 */
export function SearchBar({ value, onChange, placeholder = 'Rechercher...', className = '', inputRef, grande = false, ariaLabel }) {
  return (
    <div className={`relative ${className}`}>
      <Search className={`absolute top-1/2 -translate-y-1/2 text-secondary-400 ${grande ? 'left-4 h-5 w-5' : 'left-3 h-4 w-4'}`} aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        className={`w-full border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white ${
          grande ? 'h-12 pl-11 pr-10 text-body' : 'pl-9 pr-8 py-2 text-sm'
        }`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-secondary-100"
        >
          <X className="h-3.5 w-3.5 text-secondary-400" />
        </button>
      )}
    </div>
  );
}
