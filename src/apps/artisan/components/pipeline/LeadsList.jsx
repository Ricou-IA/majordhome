/**
 * LeadsList.jsx - Majord'home Artisan
 * ============================================================================
 * Liste des leads avec recherche, filtres (statut, source, assigné),
 * pagination "charger plus" et bouton "Nouveau lead".
 *
 * @version 1.0.0 - Sprint 4 Pipeline Commercial
 * ============================================================================
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  X,
  ChevronDown,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  SlidersHorizontal,
  Target,
  CalendarDays,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useLeads,
  useLeadSources,
  useLeadStatuses,
  useLeadCommercials,
} from '@/shared/hooks/useLeads';
import { LeadCard, LeadCardSkeleton } from './LeadCard';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Génère les options de filtre par mois (12 derniers mois + "Tous")
 */
function getMonthOptions() {
  const options = [{ value: '', label: 'Tous les mois' }];
  const now = new Date();
  const start = new Date(2026, 0, 1); // Janvier 2026
  // Du mois courant jusqu'à janvier 2026 (ordre décroissant)
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let d = current; d >= start; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    options.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return options;
}

const MONTH_OPTIONS = getMonthOptions();

const SORT_OPTIONS = [
  { value: 'created_date:desc', label: 'Plus récent' },
  { value: 'created_date:asc', label: 'Plus ancien' },
  { value: 'last_name:asc', label: 'Nom (A-Z)' },
  { value: 'last_name:desc', label: 'Nom (Z-A)' },
  { value: 'order_amount_ht:desc', label: 'Montant décroissant' },
  { value: 'order_amount_ht:asc', label: 'Montant croissant' },
];

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Barre de recherche
 */
const SearchBar = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg
                 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors
                 text-base"
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
 * Dropdown filtre générique
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
          inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors min-h-[40px]
          ${
            hasValue
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }
        `}
      >
        {Icon && <Icon className="w-4 h-4" />}
        <span className="text-sm font-medium truncate max-w-[120px]">
          {selectedOption?.label || label}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-64 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.value ?? 'null'}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`
                  w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors
                  ${
                    option.value === value
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <span className="flex items-center gap-2 truncate">
                  {option.color && (
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: option.color }}
                    />
                  )}
                  {option.label}
                </span>
                {option.value === value && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Badge filtre actif
 */
const ActiveFilterBadge = ({ label, onClear }) => (
  <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
    {label}
    <button onClick={onClear} className="p-0.5 hover:bg-blue-200 rounded-full">
      <X className="w-3 h-3" />
    </button>
  </span>
);

/**
 * État vide
 */
const EmptyState = ({ hasFilters, onClearFilters, onAddLead }) => (
  <div className="text-center py-12">
    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
      <Target className="w-8 h-8 text-gray-400" />
    </div>
    <h3 className="text-lg font-medium text-gray-900 mb-2">
      {hasFilters ? 'Aucun lead trouvé' : 'Aucun lead'}
    </h3>
    <p className="text-gray-500 mb-6 max-w-sm mx-auto">
      {hasFilters
        ? 'Essayez de modifier vos critères de recherche ou de supprimer les filtres.'
        : 'Ajoutez votre premier lead pour démarrer le pipeline commercial.'}
    </p>
    <div className="flex items-center justify-center gap-3">
      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]"
        >
          <X className="w-4 h-4" />
          Effacer les filtres
        </button>
      )}
      <button
        onClick={onAddLead}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors min-h-[44px]"
      >
        <Plus className="w-4 h-4" />
        Nouveau lead
      </button>
    </div>
  </div>
);

/**
 * État erreur
 */
const ErrorState = ({ error, onRetry }) => (
  <div className="text-center py-12">
    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
      <AlertCircle className="w-8 h-8 text-red-500" />
    </div>
    <h3 className="text-lg font-medium text-gray-900 mb-2">Erreur de chargement</h3>
    <p className="text-gray-500 mb-6">
      {error?.message || 'Une erreur est survenue lors du chargement des leads.'}
    </p>
    <button
      onClick={onRetry}
      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors min-h-[44px]"
    >
      <RefreshCw className="w-4 h-4" />
      Réessayer
    </button>
  </div>
);

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * @param {Object} props
 * @param {Function} props.onLeadClick - (lead) => void — ouvre la modale
 * @param {Function} props.onNewLead - () => void — ouvre la modale en mode création
 */
export function LeadsList({ onLeadClick, onNewLead }) {
  const { organization, user, effectiveRole } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;

  // État local recherche + mois
  const [searchInput, setSearchInput] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');

  // Hook leads
  const {
    leads,
    totalCount,
    isLoading,
    loadingMore,
    hasMore,
    error,
    filters,
    setFilters,
    resetFilters,
    loadMore,
    refresh,
  } = useLeads({ orgId, limit: 25 });

  // Données de référence
  const { sources } = useLeadSources();
  const { statuses } = useLeadStatuses();
  const { commercials } = useLeadCommercials(orgId);

  // Résoudre l'ID commercial depuis l'ID auth (dual ID bridge)
  const myCommercialId = useMemo(() => {
    if (effectiveRole !== 'commercial' || !userId) return null;
    return commercials.find(c => c.profile_id === userId)?.id || null;
  }, [effectiveRole, userId, commercials]);

  // Commercial : forcer le filtre sur ses propres leads (via ID commercial, pas ID auth)
  useEffect(() => {
    if (effectiveRole === 'commercial' && myCommercialId && filters.assignedUserId !== myCommercialId) {
      setFilters({ assignedUserId: myCommercialId });
    }
  }, [effectiveRole, myCommercialId, filters.assignedUserId, setFilters]);

  // Debounce de la recherche (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.search) {
        setFilters({ search: searchInput });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, filters.search, setFilters]);

  // Handler filtre mois
  const handleMonthChange = useCallback(
    (value) => {
      setSelectedMonth(value);
      if (!value) {
        setFilters({ dateFrom: null, dateTo: null });
      } else {
        const [year, month] = value.split('-');
        const dateFrom = `${year}-${month}-01`;
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const dateTo = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
        setFilters({ dateFrom, dateTo });
      }
    },
    [setFilters],
  );

  // Handlers
  const handleClearFilters = useCallback(() => {
    setSearchInput('');
    setSelectedMonth('');
    resetFilters();
  }, [resetFilters]);

  const handleSortChange = useCallback(
    (value) => {
      const [orderBy, order] = value.split(':');
      setFilters({ orderBy, ascending: order === 'asc' });
    },
    [setFilters],
  );

  // Options filtres dynamiques
  const statusOptions = [
    { value: '', label: 'Tous les statuts' },
    ...statuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
  ];

  const sourceOptions = [
    { value: '', label: 'Toutes les sources' },
    ...sources.map((s) => ({ value: s.id, label: s.name, color: s.color })),
  ];

  const commercialOptions = [
    { value: '', label: 'Tous' },
    ...commercials.map((c) => ({ value: c.id, label: c.full_name })),
  ];

  // Filtres actifs
  const activeFilters = [];
  if (filters.statusId) {
    const s = statuses.find((s) => s.id === filters.statusId);
    activeFilters.push({ key: 'statusId', label: s?.label || 'Statut' });
  }
  if (filters.sourceId) {
    const s = sources.find((s) => s.id === filters.sourceId);
    activeFilters.push({ key: 'sourceId', label: s?.name || 'Source' });
  }
  if (filters.assignedUserId && effectiveRole !== 'commercial') {
    const c = commercials.find((c) => c.id === filters.assignedUserId);
    activeFilters.push({ key: 'assignedUserId', label: c?.full_name || 'Assigné' });
  }
  if (selectedMonth) {
    const m = MONTH_OPTIONS.find((o) => o.value === selectedMonth);
    activeFilters.push({ key: 'month', label: m?.label || 'Mois' });
  }

  const hasActiveFilters = searchInput || activeFilters.length > 0;
  const currentSort = `${filters.orderBy}:${filters.ascending ? 'asc' : 'desc'}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm">
            {totalCount} lead{totalCount !== 1 ? 's' : ''} au total
          </p>
        </div>
        {onNewLead && (
          <button
            onClick={onNewLead}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg
                       hover:bg-blue-700 transition-colors shadow-sm min-h-[44px]"
          >
            <Plus className="w-5 h-5" />
            Nouveau lead
          </button>
        )}
      </div>

      {/* Recherche + Filtres */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <SearchBar
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Rechercher par nom, email, téléphone, ville..."
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterDropdown
            label="Statut"
            value={filters.statusId || ''}
            options={statusOptions}
            onChange={(v) => setFilters({ statusId: v || null })}
          />
          <FilterDropdown
            label="Source"
            value={filters.sourceId || ''}
            options={sourceOptions}
            onChange={(v) => setFilters({ sourceId: v || null })}
          />
          {/* Filtre assigné masqué pour les commerciaux (voient uniquement les leurs) */}
          {effectiveRole !== 'commercial' && (
            <FilterDropdown
              label="Assigné"
              value={filters.assignedUserId || ''}
              options={commercialOptions}
              onChange={(v) => setFilters({ assignedUserId: v || null })}
            />
          )}
          <FilterDropdown
            label="Mois"
            icon={CalendarDays}
            value={selectedMonth}
            options={MONTH_OPTIONS}
            onChange={handleMonthChange}
          />
          <FilterDropdown
            label="Tri"
            icon={SlidersHorizontal}
            value={currentSort}
            options={SORT_OPTIONS}
            onChange={handleSortChange}
          />
          <button
            onClick={refresh}
            disabled={isLoading}
            className="p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[40px]"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filtres actifs */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Filtres actifs :</span>
          {activeFilters.map((f) => (
            <ActiveFilterBadge
              key={f.key}
              label={f.label}
              onClear={() => {
                if (f.key === 'month') {
                  handleMonthChange('');
                } else {
                  setFilters({ [f.key]: null });
                }
              }}
            />
          ))}
          <button
            onClick={handleClearFilters}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Tout effacer
          </button>
        </div>
      )}

      {/* État erreur */}
      {error && !isLoading && <ErrorState error={error} onRetry={refresh} />}

      {/* État vide */}
      {!error && !isLoading && leads.length === 0 && (
        <EmptyState
          hasFilters={hasActiveFilters}
          onClearFilters={handleClearFilters}
          onAddLead={onNewLead}
        />
      )}

      {/* Grille de leads */}
      {(leads.length > 0 || isLoading) && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Skeletons chargement initial */}
            {isLoading &&
              leads.length === 0 &&
              [1, 2, 3, 4, 5, 6].map((i) => <LeadCardSkeleton key={i} />)}

            {/* Cartes leads */}
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onClick={onLeadClick} />
            ))}

            {/* Skeletons pagination */}
            {loadingMore &&
              [1, 2, 3].map((i) => <LeadCardSkeleton key={`more-${i}`} />)}
          </div>

          {/* Charger plus */}
          {hasMore && !loadingMore && (
            <div className="text-center mt-6">
              <button
                onClick={loadMore}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-300
                           text-gray-700 rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]"
              >
                Charger plus de leads
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Fin de liste */}
          {!hasMore && leads.length > 0 && (
            <p className="text-center text-gray-400 text-sm mt-6">
              Fin de la liste • {leads.length} lead{leads.length !== 1 ? 's' : ''} affiché
              {leads.length !== 1 ? 's' : ''}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default LeadsList;
