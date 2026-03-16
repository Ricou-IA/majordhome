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
 */
export function SearchBar({ value, onChange, placeholder = 'Rechercher...', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-8 py-2 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-secondary-100"
        >
          <X className="h-3.5 w-3.5 text-secondary-400" />
        </button>
      )}
    </div>
  );
}
