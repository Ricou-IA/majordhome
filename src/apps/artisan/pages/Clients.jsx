/**
 * Clients.jsx - Majord'home Artisan
 * ============================================================================
 * Page liste des clients avec recherche, filtres et pagination.
 * Navigation vers la fiche client détaillée au clic sur une carte.
 *
 * v3.0.0 - Navigation vers ClientDetail au lieu de la modale
 * v2.0.0 - Suppression filtre secteur (sera dans Planning)
 *
 * @example
 * // Dans routes.jsx
 * <Route path="/clients" element={<Clients />} />
 * ============================================================================
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  Filter,
  Plus,
  Users,
  FileText,
  X,
  ChevronDown,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  SlidersHorizontal,
  Building2,
  Archive,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClients, useClientStats } from '@/shared/hooks/useClients';
import { CLIENT_CATEGORIES } from '@/shared/services/clients.service';
import { ClientCard, ClientCardSkeleton } from '@/apps/artisan/components/clients/ClientCard';
import { ClientModal } from '@/apps/artisan/components/clients/ClientModal';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Options de tri
 */
const SORT_OPTIONS = [
  { value: 'display_name:asc', label: 'Nom (A-Z)' },
  { value: 'display_name:desc', label: 'Nom (Z-A)' },
  { value: 'created_at:desc', label: 'Plus récent' },
  { value: 'created_at:asc', label: 'Plus ancien' },
];

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Barre de recherche
 */
const SearchBar = ({ value, onChange, placeholder = "Rechercher un client..." }) => {
  return (
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
};

/**
 * Bouton filtre dropdown
 */
const FilterDropdown = ({ label, icon: Icon, value, options, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const selectedOption = options.find(opt => opt.value === value);
  const hasValue = value !== '' && value !== null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors
          ${hasValue 
            ? 'bg-blue-50 border-blue-200 text-blue-700' 
            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }
        `}
      >
        {Icon && <Icon className="w-4 h-4" />}
        <span className="text-sm font-medium">
          {selectedOption?.label || label}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)} 
          />
          <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
            {options.map(option => (
              <button
                key={option.value}
                onClick={() => { onChange(option.value); setIsOpen(false); }}
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

/**
 * Badge filtre actif
 */
const ActiveFilterBadge = ({ label, onClear }) => (
  <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
    {label}
    <button 
      onClick={onClear}
      className="p-0.5 hover:bg-blue-200 rounded-full"
    >
      <X className="w-3 h-3" />
    </button>
  </span>
);

/**
 * Carte statistiques
 */
const StatCard = ({ icon: Icon, label, value, color = 'blue', onClick, active = false }) => {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    amber: 'bg-amber-100 text-amber-600',
    purple: 'bg-purple-100 text-purple-600',
    red: 'bg-red-100 text-red-600',
  };

  const borderColor = {
    blue: 'border-blue-500 ring-1 ring-blue-200',
    green: 'border-green-500 ring-1 ring-green-200',
    amber: 'border-amber-500 ring-1 ring-amber-200',
    purple: 'border-purple-500 ring-1 ring-purple-200',
    red: 'border-red-500 ring-1 ring-red-200',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg border p-4 transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      } ${active ? borderColor[color] : 'border-gray-200'}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
};

/**
 * État vide
 */
const STAT_CARD_LABELS = {
  archived: 'Aucun client archivé',
  contracts: 'Aucun client avec contrat actif',
  particuliers: 'Aucun client particulier',
  entreprises: 'Aucune entreprise',
};

const EmptyState = ({ hasFilters, onClearFilters, onAddClient, activeStatCard }) => {
  // Message contextuel selon la carte stat active
  const statCardLabel = activeStatCard ? STAT_CARD_LABELS[activeStatCard] : null;

  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Users className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        {statCardLabel || (hasFilters ? 'Aucun client trouvé' : 'Aucun client')}
      </h3>
      {!statCardLabel && (
        <>
          <p className="text-gray-500 mb-6 max-w-sm mx-auto">
            {hasFilters
              ? 'Essayez de modifier vos critères de recherche ou de supprimer les filtres.'
              : 'Commencez par ajouter votre premier client.'
            }
          </p>
          <div className="flex items-center justify-center gap-3">
            {hasFilters && (
              <button
                onClick={onClearFilters}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="w-4 h-4" />
                Effacer les filtres
              </button>
            )}
            <button
              onClick={onAddClient}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Ajouter un client
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * État erreur
 */
const ErrorState = ({ error, onRetry }) => (
  <div className="text-center py-12">
    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
      <AlertCircle className="w-8 h-8 text-red-500" />
    </div>
    <h3 className="text-lg font-medium text-gray-900 mb-2">
      Erreur de chargement
    </h3>
    <p className="text-gray-500 mb-6">
      {error?.message || 'Une erreur est survenue lors du chargement des clients.'}
    </p>
    <button
      onClick={onRetry}
      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
 * Page liste des clients
 */
export function Clients() {
  // Auth context pour récupérer l'org_id
  const { organization } = useAuth();
  const orgId = organization?.id;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // État local
  const [searchInput, setSearchInput] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Filtre stat card persisté dans l'URL (?filter=particuliers)
  const activeStatCard = searchParams.get('filter') || null;
  const setActiveStatCard = useCallback((cardKey) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (cardKey) {
        next.set('filter', cardKey);
      } else {
        next.delete('filter');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Hook clients
  const {
    clients,
    isLoading: loading,
    loadingMore,
    error,
    totalCount,
    hasMore,
    filters,
    setFilters,
    loadMore,
    refresh,
    reset,
  } = useClients({ orgId, limit: 25 });

  // Hook stats
  const { stats } = useClientStats(orgId);

  // Appliquer le filtre stat card depuis l'URL au montage
  const initialFilter = searchParams.get('filter');
  useEffect(() => {
    if (!initialFilter) return;
    const base = {
      search: '',
      clientCategory: null,
      hasContract: null,
      showArchived: false,
      onlyArchived: false,
      orderBy: 'display_name',
      ascending: true,
    };
    switch (initialFilter) {
      case 'contracts':
        setFilters({ ...base, hasContract: true });
        break;
      case 'particuliers':
        setFilters({ ...base, clientCategory: 'particulier' });
        break;
      case 'entreprises':
        setFilters({ ...base, clientCategory: 'entreprise' });
        break;
      case 'archived':
        setFilters({ ...base, onlyArchived: true });
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Seulement au montage

  // Debounce de la recherche
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.search) {
        setFilters({ search: searchInput });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, filters.search, setFilters]);

  // Handlers
  const handleClientClick = useCallback((client) => {
    navigate(`/clients/${client.id}`);
  }, [navigate]);

  const handleAddClient = useCallback(() => {
    setShowCreateModal(true);
  }, []);

  // Callback après création réussie : naviguer vers la fiche client
  const handleClientCreated = useCallback((newClient) => {
    setShowCreateModal(false);
    refresh();
    if (newClient?.id) {
      navigate(`/clients/${newClient.id}`);
    }
  }, [navigate, refresh]);

  const handleClearFilters = useCallback(() => {
    setSearchInput('');
    setActiveStatCard(null);
    reset();
  }, [reset]);

  const handleSortChange = useCallback((value) => {
    const [orderBy, order] = value.split(':');
    setFilters({
      orderBy,
      ascending: order === 'asc'
    });
  }, [setFilters]);

  // Handler clic sur une carte stat (toggle filtre)
  const handleStatCardClick = useCallback((cardKey) => {
    // "Total" = toujours reset, pas de toggle
    if (cardKey === 'total') {
      if (activeStatCard === null) return; // déjà sur total, ne rien faire
      setActiveStatCard(null);
      setSearchInput('');
      setFilters({
        search: '',
        clientCategory: null,
        hasContract: null,
        showArchived: false,
        onlyArchived: false,
        orderBy: filters.orderBy,
        ascending: filters.ascending,
      });
      return;
    }

    setSearchInput('');
    const baseFilters = {
      search: '',
      clientCategory: null,
      hasContract: null,
      showArchived: false,
      onlyArchived: false,
      orderBy: filters.orderBy,
      ascending: filters.ascending,
    };

    if (activeStatCard === cardKey) {
      // Re-clic sur la même carte = désactiver le filtre (retour à total)
      setActiveStatCard(null);
      setFilters(baseFilters);
    } else {
      // Activer le filtre correspondant
      setActiveStatCard(cardKey);

      switch (cardKey) {
        case 'contracts':
          setFilters({ ...baseFilters, hasContract: true });
          break;
        case 'particuliers':
          setFilters({ ...baseFilters, clientCategory: 'particulier' });
          break;
        case 'entreprises':
          setFilters({ ...baseFilters, clientCategory: 'entreprise' });
          break;
        case 'archived':
          setFilters({ ...baseFilters, onlyArchived: true });
          break;
        default:
          break;
      }
    }
  }, [activeStatCard, filters.orderBy, filters.ascending, setFilters]);

  // Calcul des filtres actifs
  const activeFilters = [];
  if (filters.clientCategory) {
    const categoryLabel = CLIENT_CATEGORIES.find(s => s.value === filters.clientCategory)?.label;
    activeFilters.push({ key: 'clientCategory', label: categoryLabel });
  }
  if (filters.hasContract !== null) {
    activeFilters.push({
      key: 'hasContract',
      label: filters.hasContract ? 'Avec contrat' : 'Sans contrat'
    });
  }
  if (filters.showArchived) {
    activeFilters.push({ key: 'showArchived', label: 'Clients archivés inclus' });
  }

  const hasActiveFilters = searchInput || activeFilters.length > 0;

  // Current sort value
  const currentSort = `${filters.orderBy}:${filters.ascending ? 'asc' : 'desc'}`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
              <p className="text-gray-500 mt-1">
                {totalCount} client{totalCount !== 1 ? 's' : ''} au total
              </p>
            </div>
            <button
              onClick={handleAddClient}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="w-5 h-5" />
              Nouveau client
            </button>
          </div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
              <StatCard
                icon={Users}
                label="Total clients"
                value={stats.total_clients}
                color="blue"
                onClick={() => handleStatCardClick('total')}
                active={activeStatCard === 'total'}
              />
              <StatCard
                icon={FileText}
                label="Contrats actifs"
                value={stats.active_contracts}
                color="green"
                onClick={() => handleStatCardClick('contracts')}
                active={activeStatCard === 'contracts'}
              />
              <StatCard
                icon={Users}
                label="Particuliers"
                value={stats.particuliers || 0}
                color="amber"
                onClick={() => handleStatCardClick('particuliers')}
                active={activeStatCard === 'particuliers'}
              />
              <StatCard
                icon={Building2}
                label="Entreprises"
                value={stats.entreprises || 0}
                color="purple"
                onClick={() => handleStatCardClick('entreprises')}
                active={activeStatCard === 'entreprises'}
              />
              <StatCard
                icon={Archive}
                label="Archivés"
                value={stats.archived || 0}
                color="red"
                onClick={() => handleStatCardClick('archived')}
                active={activeStatCard === 'archived'}
              />
            </div>
          )}
        </div>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Recherche */}
          <div className="flex-1">
            <SearchBar 
              value={searchInput}
              onChange={setSearchInput}
              placeholder="Rechercher par nom, email, téléphone, ville..."
            />
          </div>

          {/* Filtres */}
          <div className="flex items-center gap-2 flex-wrap">
            <FilterDropdown
              label="Catégorie"
              value={filters.clientCategory || ''}
              options={[
                { value: '', label: 'Toutes les catégories' },
                ...CLIENT_CATEGORIES,
              ]}
              onChange={(v) => setFilters({ clientCategory: v || null })}
            />

            <FilterDropdown
              label="Contrat"
              icon={FileText}
              value={filters.hasContract === null ? '' : (filters.hasContract ? 'with' : 'without')}
              options={[
                { value: '', label: 'Tous' },
                { value: 'with', label: 'Avec contrat' },
                { value: 'without', label: 'Sans contrat' },
              ]}
              onChange={(v) => setFilters({ 
                hasContract: v === '' ? null : v === 'with' 
              })}
            />

            <FilterDropdown
              label="Tri"
              icon={SlidersHorizontal}
              value={currentSort}
              options={SORT_OPTIONS}
              onChange={handleSortChange}
            />

            {/* Toggle Archivés */}
            <button
              onClick={() => {
                setActiveStatCard(null);
                setFilters({ showArchived: !filters.showArchived, onlyArchived: false });
              }}
              className={`
                inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm font-medium
                ${filters.showArchived || filters.onlyArchived
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                }
              `}
              title={filters.showArchived ? 'Masquer les archivés' : 'Afficher les archivés'}
            >
              <Archive className="w-4 h-4" />
            </button>

            {/* Bouton refresh */}
            <button
              onClick={refresh}
              disabled={loading}
              className="p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Rafraîchir"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>



      </div>

      {/* Liste des clients */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        {/* État erreur */}
        {error && !loading && (
          <ErrorState error={error} onRetry={refresh} />
        )}

        {/* État vide */}
        {!error && !loading && clients.length === 0 && (
          <EmptyState
            hasFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
            onAddClient={handleAddClient}
            activeStatCard={activeStatCard}
          />
        )}

        {/* Grille de clients */}
        {(clients.length > 0 || loading) && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Skeletons pendant le chargement initial */}
              {loading && clients.length === 0 && (
                <>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                    <ClientCardSkeleton key={i} />
                  ))}
                </>
              )}

              {/* Cartes clients */}
              {clients.map(client => (
                <ClientCard
                  key={client.id}
                  client={client}
                  onClick={handleClientClick}
                />
              ))}

              {/* Skeletons pendant loadMore */}
              {loadingMore && (
                <>
                  {[1, 2, 3, 4].map(i => (
                    <ClientCardSkeleton key={`loading-${i}`} />
                  ))}
                </>
              )}
            </div>

            {/* Bouton charger plus */}
            {hasMore && !loadingMore && (
              <div className="text-center mt-8">
                <button
                  onClick={loadMore}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Charger plus de clients
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Indicateur fin de liste */}
            {!hasMore && clients.length > 0 && (
              <p className="text-center text-gray-500 mt-8">
                Fin de la liste • {clients.length} client{clients.length !== 1 ? 's' : ''} affiché{clients.length !== 1 ? 's' : ''}
              </p>
            )}
          </>
        )}
      </div>

      {/* Modale création client */}
      <ClientModal
        clientId={null}
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleClientCreated}
      />
    </div>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Clients;
