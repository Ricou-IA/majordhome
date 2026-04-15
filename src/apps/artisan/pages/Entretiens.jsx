/**
 * Entretiens.jsx - Page Entretiens & SAV
 * ============================================================================
 * Module unifié Entretien (visites annuelles) & SAV (réparations).
 *
 * 4 onglets :
 *   - Kanban (défaut) : board unifié EntretienSAVKanban
 *   - Contrats : liste contrats existante
 *   - Programmation : vue secteurs avec CTA « Planifier »
 *   - Dashboard : KPIs contrats + SAV
 *
 * Header : 4 stat cards workflow (Entretiens à planifier, SAV en cours,
 * Planifiés, Réalisés) basées sur useEntretienSAVStats.
 *
 * @version 4.0.0 - Sprint 8 Entretien & SAV (Kanban unifié, KPIs SAV)
 * ============================================================================
 */

import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  BarChart3,
  List,
  Map,
  Loader2,
  AlertCircle,
  RefreshCw,
  Columns3,
  Clock,
  Wrench,
  Calendar,
  CheckCircle2,
  FileText,
  Archive,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useContracts, useContractStats, useContractSectors } from '@hooks/useContracts';
import { useEntretienSAVStats, entretienSavKeys } from '@hooks/useEntretienSAV';
import { savService } from '@services/sav.service';
import { supabase } from '@/lib/supabaseClient';
import { EntretienSAVKanban } from '@apps/artisan/components/entretiens/EntretienSAVKanban';
import { EntretiensDashboard } from '@apps/artisan/components/entretiens/EntretiensDashboard';
import { ContractsList } from '@apps/artisan/components/entretiens/ContractsList';
import { SectorGroupView } from '@apps/artisan/components/entretiens/SectorGroupView';
import { ContractModal } from '@apps/artisan/components/entretiens/ContractModal';
import { CreateContractModal } from '@apps/artisan/components/entretiens/CreateContractModal';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Carte statistique (lecture seule, pas de toggle)
 */
const StatCard = ({ icon: Icon, label, value, subtitle, color = 'blue' }) => {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    amber: 'bg-amber-100 text-amber-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    red: 'bg-red-100 text-red-600',
    orange: 'bg-orange-100 text-orange-600',
    violet: 'bg-violet-100 text-violet-600',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              colorClasses[color] || colorClasses.blue
            }`}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-semibold text-gray-900">{value ?? '—'}</p>
            <p className="text-sm text-gray-500">{label}</p>
          </div>
        </div>
        {subtitle && (
          <p className="text-xs font-medium text-gray-400 whitespace-nowrap">{subtitle}</p>
        )}
      </div>
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
  const { can } = useCanAccess();
  const orgId = organization?.id;
  const canCreateContract = can('entretiens', 'create');
  const currentYear = new Date().getFullYear();
  const queryClient = useQueryClient();

  // ---------- URL / Tab ----------
  const [searchParams] = useSearchParams();

  // Tab par défaut : kanban (backward compat : si ?filter= → onglet contrats)
  const [activeTab, setActiveTab] = useState(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab) return tab;
    const filter = new URLSearchParams(window.location.search).get('filter');
    return filter ? 'contrats' : 'kanban';
  });

  // Backward compat : lire le filtre stat card depuis l'URL
  const activeStatCard = searchParams.get('filter') || null;

  // ---------- Modales ----------
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // ---------- Filtres contrats (backward compat URL) ----------
  const [initialFilters] = useState(() => {
    const filter = new URLSearchParams(window.location.search).get('filter');
    const base = { search: '', status: '', visitStatus: '' };
    switch (filter) {
      case 'actifs':
        return { ...base, status: 'active' };
      case 'clos':
        return { ...base, status: 'cancelled' };
      case 'visites-restantes':
        return { ...base, visitStatus: 'remaining' };
      case 'visites-faites':
        return { ...base, visitStatus: 'done' };
      default:
        return { ...base, status: 'active' };
    }
  });

  // ---------- Hooks données ----------

  // Stats SAV/Entretien pour les KPIs header
  const { stats: savStats, isLoading: savStatsLoading } = useEntretienSAVStats(orgId);

  // Contrats (onglet Contrats)
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

  // Stats contrats (onglet Dashboard)
  const { stats: contractStats, isLoading: contractStatsLoading } =
    useContractStats(orgId, currentYear);

  // Nombre de contrats clos (cancelled)
  const cancelledCount = useMemo(() => {
    if (!contractStats) return null;
    return contractStats.closedContracts ?? 0;
  }, [contractStats]);

  // Secteurs (onglet Programmation)
  const { sectors, isLoading: sectorsLoading } = useContractSectors(orgId);

  // Contrats ayant déjà un entretien actif (pour désactiver le bouton Planifier)
  const { data: plannedContractIds } = useQuery({
    queryKey: [...entretienSavKeys.all, 'planned-contracts', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('majordhome_entretien_sav')
        .select('contract_id')
        .eq('org_id', orgId)
        .eq('intervention_type', 'entretien')
        .neq('workflow_status', 'realise');
      return new Set((data || []).map(r => r.contract_id).filter(Boolean));
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  // ---------- Planning state ----------
  const [isPlanning, setIsPlanning] = useState(false);

  // ---------- Handlers ----------

  const handleContractClick = useCallback((contract) => {
    setSelectedContractId(contract.id);
    setModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setSelectedContractId(null);
  }, []);

  const handleCreateSuccess = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleClearFilters = useCallback(() => {
    resetFilters();
  }, [resetFilters]);

  const handleToggleArchived = useCallback(
    (showArchived) => {
      if (showArchived) {
        setFilters({ search: '', status: 'cancelled', visitStatus: '' });
      } else {
        setFilters({ search: '', status: 'active', visitStatus: '' });
      }
    },
    [setFilters],
  );

  // Planifier un contrat → créer entretien « à planifier »
  const handlePlanContract = useCallback(
    async (contract) => {
      if (!contract.client_project_id) {
        toast.error('Projet client introuvable — impossible de programmer');
        return;
      }
      setIsPlanning(true);
      try {
        const result = await savService.createEntretien({
          orgId,
          clientId: contract.client_id,
          contractId: contract.id,
          projectId: contract.client_project_id,
          scheduledDate: null,
          createdBy: user?.id,
        });
        if (result.error) {
          console.error('[Entretiens] createEntretien error:', result.error);
          toast.error(`Erreur : ${result.error.message || 'programmation échouée'}`);
        } else {
          toast.success('Entretien programmé');
          queryClient.invalidateQueries({ queryKey: entretienSavKeys.all });
        }
      } catch (err) {
        console.error('[Entretiens] handlePlanContract error:', err);
        toast.error(`Erreur : ${err.message || 'programmation échouée'}`);
      } finally {
        setIsPlanning(false);
      }
    },
    [orgId, user?.id, queryClient],
  );

  // Planifier tout un secteur (bulk)
  const handlePlanSector = useCallback(
    async (sector) => {
      setIsPlanning(true);
      let created = 0;
      let errors = 0;
      try {
        for (const contract of sector.contracts) {
          if (!contract.client_project_id) {
            console.warn('[Entretiens] Skipping contract without project_id:', contract.id);
            errors++;
            continue;
          }
          const result = await savService.createEntretien({
            orgId,
            clientId: contract.client_id,
            contractId: contract.id,
            projectId: contract.client_project_id,
            scheduledDate: null,
            createdBy: user?.id,
          });
          if (result.error) {
            console.error('[Entretiens] createEntretien error for contract:', contract.id, result.error);
            errors++;
          } else {
            created++;
          }
        }
        if (created > 0) {
          toast.success(
            `${created} entretien${created > 1 ? 's' : ''} programmé${created > 1 ? 's' : ''}`,
          );
          queryClient.invalidateQueries({ queryKey: entretienSavKeys.all });
        }
        if (errors > 0) {
          toast.error(`${errors} erreur${errors > 1 ? 's' : ''} de programmation`);
        }
        if (created === 0 && errors === 0) {
          toast.info('Aucun contrat à programmer dans ce secteur');
        }
      } catch (err) {
        console.error('[Entretiens] handlePlanSector error:', err);
        toast.error(`Erreur : ${err.message || 'programmation échouée'}`);
      } finally {
        setIsPlanning(false);
      }
    },
    [orgId, user?.id, queryClient],
  );

  // ---------- Loader initial ----------

  if (authLoading || !orgId) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4" />
          <div className="h-12 bg-muted rounded w-full" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // (removed — stats are now direct from savStats)

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* ===== HEADER ===== */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Entretiens & SAV</h1>
          <p className="text-gray-500 mt-1">
            {contractStats
              ? `${contractStats.openContracts} contrats actifs`
              : '...'}{' '}
            · Année {currentYear}
          </p>
        </div>
        {canCreateContract && (
          <button
            onClick={() => setCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Nouveau contrat
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Calendar}
          label="Entretiens à faire"
          value={savStatsLoading ? '...' : (savStats?.entretien_a_faire ?? 0)}
          subtitle={!savStatsLoading && savStats?.ca_a_faire != null ? `CA : ${Math.round(savStats.ca_a_faire).toLocaleString('fr-FR')} €` : null}
          color="blue"
        />
        <StatCard
          icon={Wrench}
          label="SAV gérés"
          value={savStatsLoading ? '...' : (savStats?.sav_en_cours ?? 0)}
          color="orange"
        />
        <StatCard
          icon={Clock}
          label="Planifiés"
          value={savStatsLoading ? '...' : (savStats?.entretien_planifie ?? 0)}
          color="violet"
        />
        <StatCard
          icon={CheckCircle2}
          label="Réalisés"
          value={savStatsLoading ? '...' : (savStats?.entretien_realise ?? 0)}
          subtitle={!savStatsLoading && savStats?.ca_realise != null ? `CA : ${Math.round(savStats.ca_realise).toLocaleString('fr-FR')} €` : null}
          color="emerald"
        />
      </div>

      {/* ===== TABS ===== */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start gap-1 bg-gray-100/80 p-1">
          <TabsTrigger value="kanban" className="gap-2 data-[state=active]:bg-white">
            <Columns3 className="h-4 w-4" />
            Kanban
          </TabsTrigger>
          <TabsTrigger value="contrats" className="gap-2 data-[state=active]:bg-white">
            <List className="h-4 w-4" />
            Contrats
            {totalCount > 0 && (
              <span className="ml-1 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                {totalCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="programmation" className="gap-2 data-[state=active]:bg-white">
            <Map className="h-4 w-4" />
            Programmation
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-2 data-[state=active]:bg-white">
            <BarChart3 className="h-4 w-4" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger
            value="clos"
            className="gap-2 data-[state=active]:bg-white"
            onClick={(e) => {
              e.preventDefault();
              setFilters({ search: '', status: 'cancelled', visitStatus: '' });
              setActiveTab('contrats');
            }}
          >
            <Archive className="h-4 w-4" />
            Clos
            {cancelledCount != null && (
              <span className="ml-1 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                {cancelledCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* TAB KANBAN */}
        <TabsContent value="kanban" className="mt-6">
          <EntretienSAVKanban />
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

        {/* TAB PROGRAMMATION */}
        <TabsContent value="programmation" className="mt-6">
          <SectorGroupView
            sectors={sectors}
            isLoading={sectorsLoading}
            onContractClick={handleContractClick}
            onPlanContract={handlePlanContract}
            onPlanSector={handlePlanSector}
            isPlanningDisabled={isPlanning}
            canPlan={canCreateContract}
            plannedContractIds={plannedContractIds}
          />
        </TabsContent>

        {/* TAB DASHBOARD */}
        <TabsContent value="dashboard" className="mt-6">
          <EntretiensDashboard
            stats={contractStats}
            savStats={savStats}
            isLoading={contractStatsLoading || savStatsLoading}
          />
        </TabsContent>
      </Tabs>

      {/* ===== MODALES ===== */}

      {/* Modale consultation contrat */}
      <ContractModal
        contractId={selectedContractId}
        isOpen={modalOpen}
        onClose={handleModalClose}
      />

      {/* Modale création contrat */}
      <CreateContractModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
