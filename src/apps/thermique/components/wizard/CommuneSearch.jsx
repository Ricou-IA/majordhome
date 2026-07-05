// src/apps/thermique/components/wizard/CommuneSearch.jsx
// Autocomplete commune sur communes.json (~7 Mo) — chargé en import() DYNAMIQUE au premier focus
// (jamais d'import statique : le JSON doit rester un chunk séparé du bundle).
// Sélection → onSelect(commune, communes) : le parent résout le DJU (fallback départemental) et
// dispatch SET_COMMUNE.
import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { logger } from '@lib/logger';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { loadCommunes } from '../../data';
import { chercheCommunes } from '../../lib/refDataResolvers';

const MAX_RESULTATS = 20;

export default function CommuneSearch({ initialQuery = '', onSelect }) {
  const [query, setQuery] = useState(initialQuery);
  const [communes, setCommunes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const loadStartedRef = useRef(false);
  const touchedRef = useRef(false);

  // initialQuery peut arriver APRÈS le mount (ville du client fetchée en async) —
  // on ne remplace que si l'utilisateur n'a pas encore tapé lui-même.
  useEffect(() => {
    if (initialQuery && !touchedRef.current) setQuery(initialQuery);
  }, [initialQuery]);

  const ensureCommunes = async () => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    setLoading(true);
    setLoadError(false);
    try {
      const data = await loadCommunes(); // { _meta, communes } (cf. convert-communes.mjs)
      setCommunes(Array.isArray(data) ? data : data.communes ?? []);
    } catch (err) {
      logger.error('[thermique] chargement communes.json échoué', err);
      setLoadError(true);
      loadStartedRef.current = false; // retry possible au prochain focus
    } finally {
      setLoading(false);
    }
  };

  const pick = (commune) => {
    touchedRef.current = true;
    setQuery(`${commune.nom} (${commune.dept})`);
    setOpen(false);
    onSelect(commune, communes);
  };

  const results = open && communes ? chercheCommunes(communes, query).slice(0, MAX_RESULTATS) : [];

  return (
    <div className="relative">
      <FormField label="Commune" required>
        <div className="relative">
          <input
            className={inputClass}
            value={query}
            placeholder="Gaillac, Albi…"
            autoComplete="off"
            onFocus={() => {
              setOpen(true);
              ensureCommunes();
            }}
            onBlur={() => setOpen(false)}
            onChange={(e) => {
              touchedRef.current = true;
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length > 0) {
                e.preventDefault();
                pick(results[0]);
              }
            }}
          />
          {loading && (
            <Loader2 className="w-4 h-4 animate-spin text-secondary-400 absolute right-3 top-1/2 -translate-y-1/2" />
          )}
        </div>
        {loadError && (
          <p className="text-xs text-red-600 mt-1">
            Impossible de charger la liste des communes — réessayez en cliquant dans le champ.
          </p>
        )}
      </FormField>
      {results.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-secondary-200 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {results.map((c) => (
            <li key={c.insee}>
              <button
                type="button"
                // onMouseDown (pas onClick) : passe AVANT le blur de l'input qui ferme la liste
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-secondary-50 flex items-center gap-2"
              >
                <MapPin className="w-4 h-4 text-secondary-400 flex-shrink-0" />
                <span className="font-medium text-secondary-900">{c.nom}</span>
                <span className="text-secondary-500 ml-auto flex-shrink-0">
                  {c.dept} · {c.altitude != null ? `${c.altitude} m` : 'alt. inconnue'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
