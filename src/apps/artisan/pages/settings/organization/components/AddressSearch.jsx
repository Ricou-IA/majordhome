import { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { MAPBOX_CONFIG } from '@lib/mapbox';

/**
 * Autocomplete Mapbox Geocoding pour saisir une adresse.
 * Debounce 300ms. Retourne { lat, lng, label, departmentCode } à la sélection.
 *
 * @param {Object} props
 * @param {string} [props.initialValue] - adresse formatée initiale (label affiché)
 * @param {Function} props.onSelect - (result) => void
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 */
export default function AddressSearch({
  initialValue = '',
  onSelect,
  placeholder = '🔍 Rechercher une adresse...',
  disabled = false,
}) {
  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState(null);
  const debounceTimer = useRef(null);

  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const token = MAPBOX_CONFIG.accessToken;
        if (!token) throw new Error('VITE_MAPBOX_TOKEN non configuré');
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=fr&language=fr&access_token=${token}&limit=5`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSuggestions(data.features || []);
      } catch (err) {
        setError(err.message || 'Recherche indisponible');
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceTimer.current);
  }, [query]);

  const handleSelect = (feature) => {
    const [lng, lat] = feature.center;
    // Extraction du code département depuis le context Mapbox
    // context : [{ id: 'place...', short_code: '...' }, { id: 'region...', short_code: 'FR-XX' }, ...]
    let departmentCode = null;
    if (Array.isArray(feature.context)) {
      const region = feature.context.find(
        (c) => c.id?.startsWith('region.') && c.short_code?.startsWith('FR-')
      );
      if (region?.short_code) {
        departmentCode = region.short_code.replace('FR-', '');
      }
    }
    setQuery(feature.place_name);
    setShowSuggestions(false);
    onSelect({
      lat,
      lng,
      label: feature.place_name,
      departmentCode,
    });
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-secondary-50"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400 animate-spin" />
        )}
      </div>

      {error && (
        <p className="mt-1 text-xs text-red-600">⚠️ {error} — utilise la saisie manuelle ci-dessous.</p>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border border-secondary-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map((s) => (
            <li
              key={s.id}
              className="px-3 py-2 text-sm hover:bg-secondary-50 cursor-pointer border-b border-secondary-100 last:border-b-0"
              onMouseDown={() => handleSelect(s)}
            >
              {s.place_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
