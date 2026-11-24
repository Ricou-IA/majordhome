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
  FileText,
} from 'lucide-react';
import { ContractCard, ContractCardSkeleton } from './ContractCard';
import { CONTRACT_STATUSES } from '@services/entretiens.service';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { toneFor } from '@/lib/tonsStatut';
import { formatEuro } from '@/lib/utils';

const nomDuMois = (m) => (m >= 1 && m <= 12
  ? new Date(2000, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long' }).replace(/^./, (c) => c.toUpperCase())
  : '—');

/** Colonnes de la vue liste (brief UX P1-13) : triables côté base (entretiens.service getContracts). */
const COLONNES_LISTE = [
  { cle: 'client_name', titre: 'Client', triable: true, rendu: (c) => <span className="font-medium text-secondary-900">{c.client_name || 'Client inconnu'}</span> },
  { cle: 'client_city', titre: 'Commune', triable: true, rendu: (c) => [c.client_postal_code, c.client_city].filter(Boolean).join(' ') || '—' },
  { cle: 'maintenance_month', titre: 'Mois d’entretien', triable: true, rendu: (c) => nomDuMois(c.maintenance_month) },
  { cle: 'amount', titre: 'Montant', alignement: 'droite', rendu: (c) => (c.amount ? formatEuro(c.amount) : '—') },
  {
    cle: 'status', titre: 'Statut', triable: true, rendu: (c) => (
      <StatusPill tone={toneFor('contrat', c.status)}>{CONTRACT_STATUSES.find((s) => s.value === c.status)?.label || c.status}</StatusPill>
    ),
  },
];

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Barre de recherche (pattern Clients.jsx)
 */
const SearchBar = ({ value, onChange, placeholder = 'Rechercher...' }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-10 pr-4 py-2.5 bg-white border border-secondary-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
    />
    {value && (
      <button
        onClick={() => onChange('')}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-secondary-400 hover:text-secondary-600"
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
            : 'bg-white border-secondary-300 text-secondary-700 hover:bg-secondary-50'
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
          <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-secondary-200 rounded-lg shadow-lg z-20 py-1">
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
                    : 'text-secondary-700 hover:bg-secondary-50'
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
  totalCount = 0,
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
  vue = 'cartes',
  onVue,
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

      {/* Contrats clos : onglet « Clos » de la page Entretiens (brief UX P1-16) — plus de
          bouton ni de bandeau ici, un seul onglet actif à la fois. */}
      {isArchivedMode && !isLoading && (
        <p className="text-sm font-semibold text-secondary-700">{totalCount} contrat{totalCount > 1 ? 's' : ''} clos</p>
      )}

      {/* Cartes ou liste (URL `?vue=`, page Entretiens) */}
      {onVue && (
        <SegmentedControl
          label="Affichage des contrats"
          value={vue}
          onChange={onVue}
          options={[{ value: 'liste', label: 'Liste' }, { value: 'cartes', label: 'Cartes' }]}
        />
      )}

      {vue === 'liste' && (isLoading || contracts.length > 0) ? (
        <>
          <DataTable
            libelle="Contrats"
            colonnes={COLONNES_LISTE}
            lignes={contracts}
            cleLigne={(c) => c.id}
            chargement={isLoading}
            tri={{ cle: filters.orderBy || 'client_name', ascendant: filters.ascending !== false }}
            onTri={(cle) => setFilters({ orderBy: cle, ascending: (filters.orderBy || 'client_name') === cle ? filters.ascending === false : true })}
            onLigne={(c) => onContractClick?.(c)}
            libelleLigne={(c) => `Ouvrir le contrat de ${c.client_name || 'ce client'}`}
          />
          {!isLoading && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-secondary-500">{contracts.length} sur {totalCount} contrat{totalCount !== 1 ? 's' : ''}</p>
              {hasMore && (
                <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary btn-sm">
                  {loadingMore ? 'Chargement…' : 'Afficher les 50 suivants'}
                </button>
              )}
            </div>
          )}
        </>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <ContractCardSkeleton key={i} />
          ))}
        </div>
      ) : contracts.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-secondary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-secondary-400" />
          </div>
          <h3 className="text-lg font-medium text-secondary-900 mb-2">
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
                className="inline-flex items-center gap-2 px-4 py-2 border border-secondary-300 text-secondary-700 rounded-lg hover:bg-secondary-50 transition-colors"
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
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-secondary-300 text-secondary-700 rounded-lg hover:bg-secondary-50 transition-colors"
              >
                Charger plus de contrats
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Indicateur fin de liste */}
          {!hasMore && contracts.length > 0 && (
            <p className="text-center text-secondary-500 mt-8">
              Fin de la liste • {contracts.length} contrat{contracts.length !== 1 ? 's' : ''} affiché{contracts.length !== 1 ? 's' : ''}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default ContractsList;
