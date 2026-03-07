/**
 * MapSearch.jsx
 * Champ de recherche flottant pour trouver et localiser un client sur la carte
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, MapPin, FileCheck } from 'lucide-react';

export default function MapSearch({ points = [], onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Filtrer les points selon la recherche
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const q = query.toLowerCase();
    const matches = points
      .filter(p =>
        p.label?.toLowerCase().includes(q) ||
        p.city?.toLowerCase().includes(q) ||
        p.postalCode?.includes(q) ||
        p.clientNumber?.toLowerCase().includes(q)
      )
      .slice(0, 8);

    setResults(matches);
    setIsOpen(matches.length > 0);
    setActiveIndex(-1);
  }, [query, points]);

  // Fermer au clic extérieur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback((point) => {
    setQuery(point.label || '');
    setIsOpen(false);
    onSelect?.(point);
  }, [onSelect]);

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    onClear?.();
    inputRef.current?.focus();
  }, [onClear]);

  // Navigation clavier
  const handleKeyDown = useCallback((e) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, [isOpen, results, activeIndex, handleSelect]);

  return (
    <div ref={containerRef} className="absolute top-4 left-14 z-10 w-72">
      {/* Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Rechercher un client..."
          className="w-full pl-9 pr-9 py-2.5 text-sm bg-white border border-secondary-200 rounded-lg shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 placeholder:text-secondary-400"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-secondary-100 text-secondary-400 hover:text-secondary-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Dropdown résultats */}
      {isOpen && results.length > 0 && (
        <div className="mt-1 bg-white border border-secondary-200 rounded-lg shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {results.map((point, index) => (
            <button
              key={point.id}
              onClick={() => handleSelect(point)}
              className={`flex items-start gap-3 w-full px-3 py-2.5 text-left transition-colors ${
                index === activeIndex
                  ? 'bg-primary-50'
                  : 'hover:bg-secondary-50'
              }`}
            >
              <MapPin className="w-4 h-4 mt-0.5 text-secondary-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-secondary-800 truncate">
                    {point.label}
                  </span>
                  {point.hasContract && (
                    <FileCheck className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-secondary-500 truncate">
                  {[point.postalCode, point.city].filter(Boolean).join(' ')}
                  {point.clientNumber && ` · ${point.clientNumber}`}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pas de résultats */}
      {isOpen && query.length >= 2 && results.length === 0 && (
        <div className="mt-1 bg-white border border-secondary-200 rounded-lg shadow-xl px-3 py-3 text-center">
          <p className="text-xs text-secondary-500">Aucun client trouvé</p>
        </div>
      )}
    </div>
  );
}
