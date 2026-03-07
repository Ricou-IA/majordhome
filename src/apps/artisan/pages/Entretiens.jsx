/**
 * Entretiens.jsx - Page Entretiens & Contrats
 * ============================================================================
 * Layout harmonisé avec Clients.jsx :
 *   - Header blanc avec stat cards cliquables (filtres toggle)
 *   - Bouton CTA "Nouveau contrat" → CreateContractModal
 *   - Indicateur année civile en cours
 *   - 3 onglets Radix Tabs restylés (Dashboard | Contrats | Secteurs)
 *   - Filtres persistés en URL via useSearchParams
 *
 * @version 3.0.0 - Harmonisation UI + CreateContractModal + stat cards filtres
 * @version 2.0.0 - Sprint 5 — Page complète
 * ============================================================================
 */

import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FileText,
  FileCheck,
  XCircle,
  Clock,
  Check,
  Plus,
  BarChart3,
  List,
  Map,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@contexts/AuthContext';
import { useContracts, useContractStats, useContractSectors } from '@hooks/useContracts';
import { EntretiensDashboard } from '@apps/artisan/components/entretiens/EntretiensDashboard';
import { ContractsList } from '@apps/artisan/components/entretiens/ContractsList';
import { SectorGroupView } from '@apps/artisan/components/entretiens/SectorGroupView';
import { ContractModal } from '@apps/artisan/components/entretiens/ContractModal';
import { CreateContractModal } from '@apps/artisan/components/entretiens/CreateContractModal';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Carte statistiques (identique à Clients.jsx)
 */
const StatCard = ({ icon: Icon, label, value, color = 'blue', onClick, active = false }) => {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    amber: 'bg-amber-100 text-amber-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    red: 'bg-red-100 text-red-600',
  };

  const borderColor = {
    blue: 'border-blue-500 ring-1 ring-blue-200',
    green: 'border-green-500 ring-1 ring-green-200',
    amber: 'border-amber-500 ring-1 ring-amber-200',
    emerald: 'border-emerald-500 ring-1 ring-emerald-200',
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
          <p className="text-2xl font-semibold text-gray-900">{value ?? '—'}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Labels contextuels pour l'EmptyState quand un filtre stat card est actif
 */
const STAT_CARD_LABELS = {
  actifs: 'Aucun contrat actif',
  clos: 'Aucun contrat clos',
  'visites-restantes': 'Aucune visite restante',
  'visites-faites': 'Aucune visite réalisée',
};

/**
 * État vide
 */
const EmptyState = ({ hasFilters, onClearFilters, activeStatCard }) => {
  const statCardLabel = activeStatCard ? STAT_CARD_LABELS[activeStatCard] : null;

  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <FileText className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        {statCardLabel || (hasFilters ? 'Aucun contrat trouvé' : 'Aucun contrat')}
      </h3>
      {!statCardLabel && hasFilters && (
        <div className="mt-4">
          <button
            onClick={onClearFilters}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Effacer les filtres
          </button>
        </div>
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
    <h3 className="text-lg font-medium text-gray-900 mb-2">Erreur de chargement</h3>
    <p className="text-gray-500 mb-6">
      {error?.message || 'Une erreur est survenue lors du chargement.'}
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

export default function Entretiens() {
  const { organization, user, loading: authLoading } = useAuth();
  const orgId = organization?.id;
  const currentYear = new Date().getFullYear();

  const [searchParams, setSearchParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Onglet initial : si filtre URL → "contrats", sinon "dashboard"
  const [activeTab, setActiveTab] = useState(() => {
    const filter = new URLSearchParams(window.location.search).get('filter');
    return filter ? 'contrats' : 'dashboard';
  });

  // Filtres initiaux calculés depuis l'URL (une seule fois au montage)
  // Évite la race condition : useContracts démarre directement avec les bons filtres
  const [initialFilters] = useState(() => {
    const filter = new URLSearchParams(window.location.search).get('filter');
    const base = { search: '', status: '', frequency: '', visitStatus: '' };
    switch (filter) {
      case 'actifs': return { ...base, status: 'active' };
      case 'clos': return { ...base, status: 'cancelled' };
      case 'visites-restantes': return { ...base, visitStatus: 'remaining' };
      case 'visites-faites': return { ...base, visitStatus: 'done' };
      case 'archives': return { ...base, status: 'archived' };
      default: return { ...base, status: 'active' };
    }
  });

  // Filtre stat card persisté dans l'URL (?filter=actifs|clos|visites-restantes|visites-faites)
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

  // Hook contrats (liste paginée avec filtres)
  const {
    contracts,
    totalCount,
    isLoading: contractsLoading,
    loadingMore,
    hasMore,
    filters,
    setFilters,
    setSearch,
    resetFilters,
    loadMore,
    refresh,
  } = useContracts({ orgId, initialFilters });

  // Hook stats dashboard
  const { stats, isLoading: statsLoading } = useContractStats(orgId, currentYear);

  // Hook secteurs
  const { sectors, isLoading: sectorsLoading } = useContractSectors(orgId);

  // Handler clic sur une carte stat (toggle filtre)
  const handleStatCardClick = useCallback((cardKey) => {
    const base = { search: '', status: '', frequency: '', visitStatus: '' };

    // "Total" = toujours reset
    if (cardKey === 'total') {
      if (activeStatCard === null) return;
      setActiveStatCard(null);
      setFilters({ ...base, status: 'active' }); // défaut = actifs
      return;
    }

    if (activeStatCard === cardKey) {
      // Re-clic = désactiver le filtre (retour à défaut)
      setActiveStatCard(null);
      setFilters({ ...base, status: 'active' });
    } else {
      // Activer le filtre + basculer sur onglet Contrats
      setActiveStatCard(cardKey);
      setActiveTab('contrats');

      switch (cardKey) {
        case 'actifs':
          setFilters({ ...base, status: 'active' });
          break;
        case 'clos':
          setFilters({ ...base, status: 'cancelled' });
          break;
        case 'visites-restantes':
          setFilters({ ...base, visitStatus: 'remaining' });
          break;
        case 'visites-faites':
          setFilters({ ...base, visitStatus: 'done' });
          break;
        default:
          break;
      }
    }
  }, [activeStatCard, setFilters, setActiveStatCard]);

  // Ouvrir modale contrat (consultation)
  const handleContractClick = useCallback((contract) => {
    setSelectedContractId(contract.id);
    setModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setSelectedContractId(null);
  }, []);

  // Création contrat réussie → rafraîchir la liste
  const handleCreateSuccess = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleClearFilters = useCallback(() => {
    setActiveStatCard(null);
    resetFilters();
  }, [resetFilters, setActiveStatCard]);

  // Toggle mode archivés (bouton ContractsList)
  const handleToggleArchived = useCallback((showArchived) => {
    if (showArchived) {
      // Activer le mode archivés
      setFilters({ search: '', status: 'archived', frequency: '', visitStatus: '' });
      setActiveStatCard('archives');
      setActiveTab('contrats');
    } else {
      // Retour aux actifs
      setFilters({ search: '', status: 'active', frequency: '', visitStatus: '' });
      setActiveStatCard(null);
    }
  }, [setFilters, setActiveStatCard]);

  // Loader initial
  if (authLoading || !orgId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-gray-200 rounded w-1/4" />
              <div className="h-5 bg-gray-200 rounded w-1/3" />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-20 bg-gray-200 rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ===== HEADER BLANC ===== */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Titre + CTA */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Entretiens</h1>
              <p className="text-gray-500 mt-1">
                {stats ? `${stats.totalContracts} contrats` : '...'} · Année {currentYear}
              </p>
            </div>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="w-5 h-5" />
              Nouveau contrat
            </button>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
            <StatCard
              icon={FileText}
              label="Total contrats"
              value={stats?.totalContracts}
              color="blue"
              onClick={() => handleStatCardClick('total')}
              active={activeStatCard === null}
            />
            <StatCard
              icon={FileCheck}
              label="Actifs"
              value={stats?.openContracts}
              color="green"
              onClick={() => handleStatCardClick('actifs')}
              active={activeStatCard === 'actifs'}
            />
            <StatCard
              icon={XCircle}
              label="Clos"
              value={stats?.closedContracts}
              color="red"
              onClick={() => handleStatCardClick('clos')}
              active={activeStatCard === 'clos'}
            />
            <StatCard
              icon={Clock}
              label="Visites restantes"
              value={stats?.visitesRestantes}
              color="amber"
              onClick={() => handleStatCardClick('visites-restantes')}
              active={activeStatCard === 'visites-restantes'}
            />
            <StatCard
              icon={Check}
              label="Visites faites"
              value={stats?.visitsDone}
              color="emerald"
              onClick={() => handleStatCardClick('visites-faites')}
              active={activeStatCard === 'visites-faites'}
            />
          </div>
        </div>
      </div>

      {/* ===== TABS ===== */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-auto inline-flex gap-1 bg-white border border-gray-200 p-1 rounded-lg shadow-sm">
            <TabsTrigger
              value="dashboard"
              className="gap-2 px-4 py-2 rounded-md text-sm font-medium data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-none text-gray-600 hover:text-gray-900"
            >
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value="contrats"
              className="gap-2 px-4 py-2 rounded-md text-sm font-medium data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-none text-gray-600 hover:text-gray-900"
            >
              <List className="h-4 w-4" />
              Contrats
              {totalCount > 0 && (
                <span className="ml-1 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                  {totalCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="secteurs"
              className="gap-2 px-4 py-2 rounded-md text-sm font-medium data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-none text-gray-600 hover:text-gray-900"
            >
              <Map className="h-4 w-4" />
              Secteurs
            </TabsTrigger>
          </TabsList>

          {/* ===== CONTENU ONGLET ===== */}
          <div className="pb-8">
            {/* TAB DASHBOARD */}
            <TabsContent value="dashboard" className="mt-6">
              <EntretiensDashboard stats={stats} isLoading={statsLoading} />
            </TabsContent>

            {/* TAB CONTRATS */}
            <TabsContent value="contrats" className="mt-6">
              <ContractsList
                contracts={contracts}
                totalCount={totalCount}
                isLoading={contractsLoading}
                loadingMore={loadingMore}
                hasMore={hasMore}
                filters={filters}
                setFilters={setFilters}
                setSearch={setSearch}
                resetFilters={handleClearFilters}
                loadMore={loadMore}
                onContractClick={handleContractClick}
                activeStatCard={activeStatCard}
                onToggleArchived={handleToggleArchived}
              />
            </TabsContent>

            {/* TAB SECTEURS */}
            <TabsContent value="secteurs" className="mt-6">
              <SectorGroupView
                sectors={sectors}
                isLoading={sectorsLoading}
                onContractClick={handleContractClick}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* ===== MODALES ===== */}

      {/* Modale consultation contrat (slide-over existante) */}
      <ContractModal
        contractId={selectedContractId}
        isOpen={modalOpen}
        onClose={handleModalClose}
      />

      {/* Modale création contrat (centrée, 2 étapes) */}
      <CreateContractModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
