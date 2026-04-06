/**
 * ContractsList.jsx - Liste filtrable des contrats d'entretien
 * ============================================================================
 * Harmonisé avec le pattern Clients.jsx :
 *   - SearchBar + FilterDropdown inline (pas de Radix Select)
 *   - Grille 4 colonnes (lg:grid-cols-4)
 *   - Load more + indicateur fin de liste
 *   - EmptyState contextuel selon stat card active
 *
 * @version 2.0.0 - Restyle filtres/grille pattern Clients
 * @version 1.0.0 - Sprint 5
 * ============================================================================
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  X,
  ChevronDown,
  CheckCircle2,
  Loader2,
  FileText,
  RefreshCw,
  Archive,
} from 'lucide-react';
import { ContractCard, ContractCardSkeleton } from './ContractCard';
import { CONTRACT_STATUSES } from '@services/entretiens.service';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Barre de recherche (pattern Clients.jsx)
 */
const SearchBar = ({ value, onChange, placeholder = 'Rechercher...' }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
    />
    {value && (
      <button
        onClick={() => onChange('')}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
      >
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
);

/**
 * Bouton filtre dropdown (pattern Clients.jsx)
 */
const FilterDropdown = ({ label, icon: Icon, value, options, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find((opt) => opt.value === value);
  const hasValue = value !== '' && value !== null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm font-medium
          ${hasValue
            ? 'bg-blue-50 border-blue-200 text-blue-700'
            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }
        `}
      >
        {Icon && <Icon className="w-4 h-4" />}
        <span>{selectedOption?.label || label}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`
                  w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors
                  ${option.value === value
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                {option.label}
                {option.value === value && <CheckCircle2 className="w-4 h-4" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function ContractsList({
  contracts,
  totalCount,
  isLoading,
  loadingMore,
  hasMore,
  filters,
  setFilters,
  setSearch,
  resetFilters,
  loadMore,
  onContractClick,
  activeStatCard = null,
  onToggleArchived,
}) {
  const isArchivedMode = filters.status === 'cancelled';
  const [searchInput, setSearchInput] = useState(filters.search || '');
  const debounceRef = useRef(null);

  // Debounce search
  const handleSearchChange = useCallback(
    (value) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSearch(value);
      }, 300);
    },
    [setSearch]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleResetFilters = () => {
    setSearchInput('');
    resetFilters();
  };

  return (
    <div className="space-y-4">
      {/* Barre de recherche + filtres */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Recherche */}
        <div className="flex-1">
          <SearchBar
            value={searchInput}
            onChange={handleSearchChange}
            placeholder="Rechercher par nom, code postal, commune..."
          />
        </div>

        {/* Filtres */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Bouton Archivés (toggle) */}
          <button
            onClick={() => onToggleArchived?.(!isArchivedMode)}
            className={`
              inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm font-medium
              ${isArchivedMode
                ? 'bg-slate-100 border-slate-300 text-slate-700'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }
            `}
            title={isArchivedMode ? 'Masquer les clos' : 'Voir les clos'}
          >
            <Archive className="w-4 h-4" />
            <span>Clos</span>
          </button>

          {/* Séparateur visuel */}
          <div className="w-px h-6 bg-gray-200" />

          {/* Dropdowns (masqués en mode archivé car le filtre status est forcé) */}
          {!isArchivedMode && (
            <>
              <FilterDropdown
                label="Statut"
                value={filters.visitStatus === 'done' ? '_realise' : (filters.status || '')}
                options={[
                  { value: '', label: 'Tous statuts' },
                  ...CONTRACT_STATUSES.filter((s) => s.value !== 'archived').map((s) => ({
                    value: s.value,
                    label: s.label,
                  })),
                  { value: '_realise', label: 'Réalisé' },
                ]}
                onChange={(v) => {
                  if (v === '_realise') {
                    setFilters({ status: '', visitStatus: 'done' });
                  } else {
                    setFilters({ status: v, visitStatus: '' });
                  }
                }}
              />

            </>
          )}
        </div>
      </div>

      {/* Grille de contrats */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <ContractCardSkeleton key={i} />
          ))}
        </div>
      ) : contracts.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {isArchivedMode
              ? 'Aucun contrat clos'
              : activeStatCard
                ? {
                    actifs: 'Aucun contrat actif',
                    clos: 'Aucun contrat clos',
                    'visites-restantes': 'Aucune visite restante',
                    'visites-faites': 'Aucune visite réalisée',
                  }[activeStatCard] || 'Aucun contrat trouvé'
                : searchInput
                  ? 'Aucun contrat trouvé'
                  : 'Aucun contrat'
            }
          </h3>
          {searchInput && (
            <div className="mt-4">
              <button
                onClick={handleResetFilters}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="w-4 h-4" />
                Effacer les filtres
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {contracts.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                onClick={onContractClick}
              />
            ))}

            {/* Skeletons pendant loadMore */}
            {loadingMore &&
              [...Array(4)].map((_, i) => (
                <ContractCardSkeleton key={`loading-${i}`} />
              ))}
          </div>

          {/* Bouton charger plus */}
          {hasMore && !loadingMore && (
            <div className="text-center mt-8">
              <button
                onClick={loadMore}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Charger plus de contrats
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Indicateur fin de liste */}
          {!hasMore && contracts.length > 0 && (
            <p className="text-center text-gray-500 mt-8">
              Fin de la liste • {contracts.length} contrat{contracts.length !== 1 ? 's' : ''} affiché{contracts.length !== 1 ? 's' : ''}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default ContractsList;
