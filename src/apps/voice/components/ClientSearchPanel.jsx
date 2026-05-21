import { useState } from 'react';
import { X, Search, Loader2, Phone, MapPin, FileText } from 'lucide-react';
import { useClientSearch } from '../hooks/useVoiceContext';

/**
 * Overlay de recherche fuzzy client.
 * Recherche par nom, prénom, ville, téléphone (chiffres).
 */
export default function ClientSearchPanel({ onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const { data: results = [], isLoading, isFetching } = useClientSearch(query, { limit: 12 });

  return (
    <div className="fixed inset-0 z-50 bg-secondary-900 flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-white/10 flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="p-2 -ml-2 rounded-lg hover:bg-white/10 transition"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold flex-1">Sélectionner un client</h2>
      </header>

      {/* Search input */}
      <div className="px-4 py-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, ville, téléphone…"
            className="w-full pl-10 pr-10 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-secondary-500 focus:outline-none focus:border-orange-500/50 focus:bg-white/10"
            inputMode="search"
          />
          {(isLoading || isFetching) && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400 animate-spin" />
          )}
        </div>
        <p className="text-secondary-500 text-xs mt-2">
          Tape au moins 2 caractères pour chercher
        </p>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {query.trim().length < 2 && (
          <div className="text-center text-secondary-500 text-sm py-12">
            Commence à taper le nom, la ville, ou le téléphone du client
          </div>
        )}

        {query.trim().length >= 2 && !isLoading && results.length === 0 && (
          <div className="text-center text-secondary-400 text-sm py-12">
            <FileText className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Aucun client trouvé.
            <br />
            <span className="text-secondary-500 text-xs">
              Reviens en arrière pour créer un nouveau prospect.
            </span>
          </div>
        )}

        <div className="space-y-2">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c)}
              className="w-full text-left rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition px-4 py-3 active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{c.display_name}</div>
                  <div className="text-secondary-400 text-xs flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
                    {c.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {c.phone}
                      </span>
                    )}
                    {c.city && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {c.city}
                      </span>
                    )}
                    <span className="text-secondary-500">{c.client_number}</span>
                  </div>
                </div>
                {c.has_active_contract && (
                  <span className="text-emerald-400 text-xs px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 shrink-0">
                    Contrat
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
