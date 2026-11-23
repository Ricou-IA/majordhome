/**
 * Clients.jsx - Majord'home Artisan
 * ============================================================================
 * Page liste des clients avec recherche, filtres et pagination.
 * Navigation vers la fiche client détaillée au clic sur une ligne (ou une carte
 * sur téléphone).
 *
 * v4.0.0 - Refonte UI phase 3 : tableau triable par en-tête, segments de catégorie
 *          (même paramètre `?filter=` que les anciennes cartes), recherche « / »
 * v3.0.0 - Navigation vers ClientDetail au lieu de la modale
 * v2.0.0 - Suppression filtre secteur (sera dans Planning)
 *
 * @example
 * // Dans routes.jsx
 * <Route path="/clients" element={<Clients />} />
 * ============================================================================
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Users, X, AlertCircle, RefreshCw, Upload, MapPin } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useClients, useClientStats } from '@hooks/useClients';
import { CLIENT_CATEGORIES } from '@services/clients.service';
import { ClientModal } from '@/apps/artisan/components/clients/ClientModal';
import { ClientsBarreOutils } from '@/apps/artisan/components/clients/ClientsBarreOutils';
import { ClientsTableau } from '@/apps/artisan/components/clients/ClientsTableau';
import { PageHeader } from '@components/ui/page-header';
import { EmptyState } from '@components/ui/empty-state';
import { Button } from '@components/ui/button';
import { sousTitreClients, triSuivant } from '@/lib/clientsAffichage';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/** Segments de catégorie : valeurs du paramètre `?filter=` (« tous » = pas de paramètre). */
const SEGMENTS_CATEGORIE = ['particuliers', 'entreprises', 'publics'];

/**
 * État vide
 */
const STAT_CARD_LABELS = {
  archived: 'Aucun client archivé',
  contracts: 'Aucun client avec contrat actif',
  particuliers: 'Aucun client particulier',
  entreprises: 'Aucune entreprise',
  publics: 'Aucun client du secteur public',
};

const EtatVideClients = ({ hasFilters, onClearFilters, onAddClient, activeStatCard }) => {
  // Message contextuel selon la carte stat active
  const statCardLabel = activeStatCard ? STAT_CARD_LABELS[activeStatCard] : null;
  if (statCardLabel) return <EmptyState icon={Users} message={statCardLabel} />;

  return (
    <EmptyState
      icon={Users}
      message={hasFilters ? 'Aucun client trouvé' : 'Aucun client'}
      detail={hasFilters
        ? 'Essayez de modifier vos critères de recherche ou de supprimer les filtres.'
        : onAddClient ? 'Commencez par ajouter votre premier client.' : undefined}
      secondaryAction={hasFilters ? { label: 'Effacer les filtres', icon: X, onClick: onClearFilters } : undefined}
      action={onAddClient ? { label: 'Ajouter un client', icon: Plus, onClick: onAddClient } : undefined}
    />
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
    <h3 className="text-lg font-medium text-secondary-900 mb-2">
      Erreur de chargement
    </h3>
    <p className="text-secondary-500 mb-6">
      {error?.message || 'Une erreur est survenue lors du chargement des clients.'}
    </p>
    <Button type="button" variant="secondary" onClick={onRetry}>
      <RefreshCw aria-hidden="true" />
      Réessayer
    </Button>
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
  const { organization, isOrgAdmin } = useAuth();
  const { can } = useCanAccess();
  const orgId = organization?.id;
  const navigate = useNavigate();
  const canCreateClient = can('clients', 'create');
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
      case 'publics':
        setFilters({ ...base, clientCategory: 'public' });
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

  // Création directe (?new=1, menu « Créer ») : ouvre la fenêtre puis retire le paramètre.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    if (canCreateClient) setShowCreateModal(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, canCreateClient]);

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
  }, [reset, setActiveStatCard]);

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
        case 'publics':
          setFilters({ ...baseFilters, clientCategory: 'public' });
          break;
        case 'archived':
          setFilters({ ...baseFilters, onlyArchived: true });
          break;
        default:
          break;
      }
    }
  }, [activeStatCard, filters.orderBy, filters.ascending, setFilters, setActiveStatCard]);

  // Segments de catégorie : mêmes filtres que les anciennes cartes ; un segment se choisit, il ne se décoche pas.
  const segment = SEGMENTS_CATEGORIE.includes(activeStatCard) ? activeStatCard : 'tous';
  // « Tous » retire tout paramètre `?filter=` (y compris une valeur hors catégorie, `total` d'un ancien lien).
  const handleSegment = useCallback((valeur) => {
    if (valeur === 'tous') {
      if (activeStatCard !== null) handleStatCardClick('total');
      return;
    }
    if (valeur === segment) return;
    handleStatCardClick(valeur);
  }, [segment, activeStatCard, handleStatCardClick]);

  const compte = (n) => (typeof n === 'number' ? n.toLocaleString('fr-FR') : undefined);
  const segments = [
    { value: 'tous', label: 'Tous', count: compte(stats?.total_clients) },
    { value: 'particuliers', label: 'Particuliers', count: compte(stats?.particuliers) },
    { value: 'entreprises', label: 'Entreprises', count: compte(stats?.entreprises) },
    // Affiché seulement s'il y en a (ou s'il est choisi par l'adresse).
    (stats?.publics > 0 || activeStatCard === 'publics')
      && { value: 'publics', label: 'Secteur public', count: compte(stats?.publics) },
  ].filter(Boolean);

  // Tri par en-tête de colonne : mêmes clés `orderBy` / `ascending` qu'avant.
  const tri = { cle: filters.orderBy, ascendant: filters.ascending };
  const handleTri = useCallback((cle) => {
    const suivant = triSuivant({ cle: filters.orderBy, ascendant: filters.ascending }, cle);
    if (suivant) setFilters({ orderBy: suivant.cle, ascending: suivant.ascendant });
  }, [filters.orderBy, filters.ascending, setFilters]);

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

  return (
    <div className="min-h-screen bg-secondary-50">
      {/* Header */}
      <div className="bg-white border-b border-secondary-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <PageHeader
            title="Clients"
            subtitle={sousTitreClients(stats) || undefined}
            actions={[
              can('territoire', 'view') && { label: 'Carte', icon: MapPin, variant: 'ghost', to: '/territoire' },
              isOrgAdmin && { label: 'Importer', icon: Upload, variant: 'secondary', onClick: () => navigate('/clients/import') },
              canCreateClient && { label: 'Nouveau client', icon: Plus, variant: 'primary', onClick: handleAddClient },
            ]}
          />
        </div>
      </div>

      {/* Barre de recherche, segments et filtres */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <ClientsBarreOutils
          recherche={searchInput}
          onRecherche={setSearchInput}
          raccourciActif={!showCreateModal}
          filtreContrat={filters.hasContract === null ? '' : (filters.hasContract ? 'with' : 'without')}
          onFiltreContrat={(v) => setFilters({ hasContract: v === '' ? null : v === 'with' })}
          onRafraichir={refresh}
          chargement={loading}
          segment={segment}
          segments={segments}
          onSegment={handleSegment}
          contratsActifs={activeStatCard === 'contracts'}
          onContratsActifs={() => handleStatCardClick('contracts')}
          archives={activeStatCard === 'archived'}
          onArchives={() => handleStatCardClick('archived')}
          inclureArchives={filters.showArchived}
          onInclureArchives={() => {
            setActiveStatCard(null);
            setFilters({ showArchived: !filters.showArchived, onlyArchived: false });
          }}
        />
      </div>

      {/* Liste des clients */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        {/* État erreur */}
        {error && !loading && (
          <ErrorState error={error} onRetry={refresh} />
        )}

        {/* État vide */}
        {!error && !loading && clients.length === 0 && (
          <EtatVideClients
            hasFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
            onAddClient={canCreateClient ? handleAddClient : undefined}
            activeStatCard={activeStatCard}
          />
        )}

        {/* Tableau (cartes sur téléphone) */}
        {(clients.length > 0 || loading) && (
          <ClientsTableau
            clients={clients}
            chargement={loading}
            chargementSuite={loadingMore}
            tri={tri}
            onTri={handleTri}
            onClient={handleClientClick}
            totalCount={totalCount}
            hasMore={hasMore}
            onChargerPlus={loadMore}
          />
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
