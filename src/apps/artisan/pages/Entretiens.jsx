/**
 * Entretiens.jsx - Page Entretiens
 * ============================================================================
 * Entretiens (visites annuelles). Le SAV a sa propre page (/sav, Eric 2026-11-25) ;
 * une carte SAV à laquelle on ajoute l'entretien se suit ici.
 *
 * 4 onglets (+ raccourci « Clos ») :
 *   - Suivi (défaut, valeur `kanban`) : kanban des entretiens (EntretienSAVKanban zone="entretien")
 *   - Contrats : liste contrats existante
 *   - Programmation : vue secteurs avec CTA « Planifier »
 *   - Dashboard : KPIs contrats + SAV, tournées à surveiller, planification
 *     automatique
 * L'ancien onglet Tournées a disparu (spec auto-RDV 2026-09-29 § 9) : remplir
 * une journée se fait depuis le Planning (puce d'état de la journée), ses
 * alertes vivent dans le Dashboard.
 *
 * Header : bande de repères (À planifier, Planifiés, Réalisés) basée sur
 * useEntretienSAVStats.
 *
 * @version 4.0.0 - Sprint 8 Entretien & SAV (Kanban unifié, KPIs SAV)
 * ============================================================================
 */

import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useContracts, useContractStats, useContractSectors } from '@hooks/useContracts';
import { useEntretienSAVStats, entretienSavKeys } from '@hooks/useEntretienSAV';
import { smsKeys } from '@hooks/cacheKeys';
import { savService } from '@services/sav.service';
import { getPlannedContractIds } from '@services/entretiens.service';
import { supabase } from '@/lib/supabaseClient';
import { EntretienSAVKanban } from '@apps/artisan/components/entretiens/EntretienSAVKanban';
import { EntretiensDashboard } from '@apps/artisan/components/entretiens/EntretiensDashboard';
import { ContractsList } from '@apps/artisan/components/entretiens/ContractsList';
import { SectorGroupView } from '@apps/artisan/components/entretiens/SectorGroupView';
import { ContractModal } from '@apps/artisan/components/entretiens/ContractModal';
import { CreateContractModal } from '@apps/artisan/components/entretiens/CreateContractModal';
import { logger } from '@lib/logger';
import { PageHeader } from '@/components/ui/page-header';
import { StatStrip } from '@apps/artisan/components/shared/StatStrip';
import { Squelette } from '@/components/ui/squelette';

// Onglet souligné, comme la fiche client : actif = texte foncé + filet cuivre (« vous êtes ici »).
const ONGLET = 'gap-2 rounded-none border-b-2 border-transparent px-4 py-3 text-body-sm font-medium text-secondary-500 hover:text-secondary-700 data-[state=active]:border-primary-600 data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-secondary-900 data-[state=active]:shadow-none';
const COMPTEUR = 'rounded-full bg-secondary-100 px-1.5 py-0.5 text-caption text-secondary-600';

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
  const [searchParams, setSearchParams] = useSearchParams();

  // Onglet dans l'URL (`?onglet=`, brief UX P1-11) : F5 et Retour le restaurent. Anciens liens
  // compris : `?tab=`, `?filter=clos` (onglet Clos), `?filter=…` (onglet Contrats).
  const ONGLETS_ENTRETIENS = ['kanban', 'contrats', 'programmation', 'dashboard', 'clos'];
  const ongletDemande = searchParams.get('onglet') || searchParams.get('tab');
  const filtreDemande = searchParams.get('filter');
  const activeTab = ongletDemande === 'tournees' ? 'dashboard'
    : ONGLETS_ENTRETIENS.includes(ongletDemande) ? ongletDemande
      : filtreDemande === 'clos' ? 'clos'
        : filtreDemande ? 'contrats' : 'kanban';

  // Backward compat : lire le filtre stat card depuis l'URL
  const activeStatCard = searchParams.get('filter') || null;

  // ---------- Modales ----------
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // ---------- Filtres contrats (backward compat URL) ----------
  const [initialFilters] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const filter = params.get('onglet') === 'clos' ? 'clos' : params.get('filter');
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

  // Contrats en liste ou en cartes (`?vue=`, brief UX P1-13) : liste d'office au-delà de 50 contrats.
  const vueUrl = searchParams.get('vue');
  const vueContrats = vueUrl === 'liste' || vueUrl === 'cartes' ? vueUrl : (totalCount > 50 ? 'liste' : 'cartes');
  const setVueContrats = useCallback((vue) => {
    setSearchParams((prev) => {
      const suivant = new URLSearchParams(prev);
      suivant.set('vue', vue);
      return suivant;
    }, { replace: true });
  }, [setSearchParams]);

  // Changer d'onglet écrit l'URL ; Clos et Contrats partagent la liste, chacun avec son statut.
  const setActiveTab = useCallback((onglet) => {
    if (onglet === 'clos') setFilters({ search: '', status: 'cancelled', visitStatus: '' });
    else if (onglet === 'contrats' && filters.status === 'cancelled') setFilters({ search: '', status: 'active', visitStatus: '' });
    setSearchParams((prev) => {
      const suivant = new URLSearchParams(prev);
      suivant.delete('tab');
      suivant.delete('filter');
      if (onglet && onglet !== 'kanban') suivant.set('onglet', onglet); else suivant.delete('onglet');
      return suivant;
    });
  }, [filters.status, setFilters, setSearchParams]);

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
  // — logique factorisée dans entretiensService.getPlannedContractIds (réutilisée
  // telle quelle par tournees.service.js::getContratsDus, cf. revue finale C3).
  const { data: plannedContractIds } = useQuery({
    queryKey: [...entretienSavKeys.all(orgId), 'planned-contracts'],
    queryFn: async () => {
      const { data, error } = await getPlannedContractIds({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  // Clients ayant déjà reçu le SMS de rappel cette année (campagne 'rappel_entretien').
  // Dérivé de sms_logs (option A — pas de colonne dédiée). Réinit. au 01/01.
  // ⚠️ Cette liste EST le seul garde-fou anti-doublon de la bulle SMS : une erreur avalée
  // renverrait un Set vide, donc « personne n'a été relancé », donc réenvoi à tout le monde
  // en silence. On lève → React Query retente, `remindedClientIds` reste undefined, et
  // SectorGroupView verrouille la bulle tant qu'il ne sait pas.
  const { data: remindedClientIds } = useQuery({
    queryKey: smsKeys.remindedClients(orgId, currentYear),
    queryFn: async () => {
      const yearStart = new Date(currentYear, 0, 1).toISOString();
      const { data, error } = await supabase
        .from('majordhome_sms_logs')
        .select('client_id')
        .eq('org_id', orgId)
        .eq('campaign_name', 'rappel_entretien')
        .gte('sent_at', yearStart);
      if (error) throw error;
      return new Set((data || []).map((r) => r.client_id).filter(Boolean));
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
          logger.error('[Entretiens] createEntretien error:', result.error);
          toast.error(`Erreur : ${result.error.message || 'programmation échouée'}`);
        } else {
          toast.success('Entretien programmé');
          queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
        }
      } catch (err) {
        logger.error('[Entretiens] handlePlanContract error:', err);
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
            logger.warn('[Entretiens] Skipping contract without project_id:', contract.id);
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
            logger.error('[Entretiens] createEntretien error for contract:', contract.id, result.error);
            errors++;
          } else {
            created++;
          }
        }
        if (created > 0) {
          toast.success(
            `${created} entretien${created > 1 ? 's' : ''} programmé${created > 1 ? 's' : ''}`,
          );
          queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
        }
        if (errors > 0) {
          toast.error(`${errors} erreur${errors > 1 ? 's' : ''} de programmation`);
        }
        if (created === 0 && errors === 0) {
          toast.info('Aucun contrat à programmer dans ce secteur');
        }
      } catch (err) {
        logger.error('[Entretiens] handlePlanSector error:', err);
        toast.error(`Erreur : ${err.message || 'programmation échouée'}`);
      } finally {
        setIsPlanning(false);
      }
    },
    [orgId, user?.id, queryClient],
  );

  // Envoyer un SMS de rappel d'entretien (depuis l'onglet Programmation).
  // Renvoie { data, error } pour que la ligne gère son état visuel.
  const handleSendReminder = useCallback(
    async (contract) => {
      const res = await savService.sendEntretienReminder({
        contractId: contract.id,
        clientId: contract.client_id,
        clientFirstName: contract.client_first_name,
        clientName: contract.client_name,
        clientPhone: contract.client_phone,
        orgId,
      });
      if (!res.error) {
        queryClient.invalidateQueries({
          queryKey: smsKeys.remindedClients(orgId, currentYear),
        });
      }
      return res;
    },
    [orgId, currentYear, queryClient],
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
  // Compteur des repères : bloc gris pendant le chargement (plus de « ... »), « — » si inconnu (jamais 0).
  const compteur = (n) => (savStatsLoading
    ? <Squelette className="inline-block h-6 w-12 align-middle" />
    : (n ?? '—'));

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* ===== HEADER ===== */}
      <PageHeader
        title="Entretiens"
        subtitle={[
          contractStats ? `${contractStats.openContracts.toLocaleString('fr-FR')} contrats actifs` : null,
          // Reste à faire = planifiés + à planifier : le même « à faire » que la Programmation.
          !savStatsLoading && savStats?.entretien_reste_a_faire != null
            ? `${savStats.entretien_reste_a_faire.toLocaleString('fr-FR')} entretiens à faire`
            : null,
          `Année ${currentYear}`,
        ].filter(Boolean).join(' · ')}
        actions={[
          canCreateContract && {
            label: 'Nouveau contrat',
            icon: Plus,
            variant: 'primary',
            onClick: () => setCreateModalOpen(true),
          },
        ]}
      />

      {/* Repères de l'année (mêmes chiffres et sous-lignes que les anciennes cartes) */}
      <StatStrip
        items={[
          {
            key: 'a_faire',
            // À planifier = rien de fait ni d'ouvert cette année ; + « Planifiés » = reste à faire.
            // Même partition que la Programmation (compterProgrammation).
            label: 'À planifier',
            value: compteur(savStats?.entretien_a_faire),
            // Les refus du client ne sont pas « à faire » : on les nomme pour que le compteur s'explique.
            sub: !savStatsLoading && savStats?.ca_a_faire != null
              ? `CA : ${Math.round(savStats.ca_a_faire).toLocaleString('fr-FR')} €${savStats.entretien_refuse > 0 ? ` · ${savStats.entretien_refuse} refus` : ''}`
              : null,
          },
          { key: 'planifies', label: 'Planifiés', value: compteur(savStats?.entretien_planifie) },
          {
            key: 'realises',
            label: 'Réalisés',
            value: compteur(savStats?.entretien_realise),
            sub: !savStatsLoading && savStats?.ca_realise != null ? `CA : ${Math.round(savStats.ca_realise).toLocaleString('fr-FR')} €` : null,
          },
        ]}
      />

      {/* ===== TABS ===== (soulignés comme la fiche client ; valeurs inchangées) */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto border-b border-secondary-200">
          <TabsList className="h-auto justify-start gap-1 rounded-none bg-transparent p-0">
            <TabsTrigger value="kanban" className={ONGLET}>
              Suivi
            </TabsTrigger>
            <TabsTrigger value="contrats" className={ONGLET}>
              Contrats
              {/* Contrats ACTIFS (ce que la liste montre à l'ouverture), quel que soit le filtre en
                  cours : compté sur la liste filtrée, l'onglet affichait le même chiffre que « Clos »
                  dès qu'on l'ouvrait. */}
              {contractStats?.openContracts > 0 && (
                <span className={COMPTEUR} title="Contrats actifs">
                  {contractStats.openContracts}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="programmation" className={ONGLET}>
              Programmation
            </TabsTrigger>
            <TabsTrigger value="dashboard" className={ONGLET}>
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="clos" className={ONGLET}>
              Clos
              {cancelledCount != null && (
                <span className={COMPTEUR}>
                  {cancelledCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* TAB KANBAN */}
        <TabsContent value="kanban" className="mt-6">
          <EntretienSAVKanban zone="entretien" />
        </TabsContent>

        {/* TAB CONTRATS et TAB CLOS : même liste, statut actif ou clos (setActiveTab) */}
        {['contrats', 'clos'].map((onglet) => (
          <TabsContent key={onglet} value={onglet} className="mt-6">
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
              vue={vueContrats}
              onVue={setVueContrats}
            />
          </TabsContent>
        ))}

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
            remindedClientIds={remindedClientIds}
            onSendReminder={handleSendReminder}
            canSendReminder={canCreateContract}
          />
        </TabsContent>

        {/* TAB DASHBOARD */}
        <TabsContent value="dashboard" className="mt-6">
          <EntretiensDashboard
            stats={contractStats}
            savStats={savStats}
            isLoading={contractStatsLoading || savStatsLoading}
            coreOrgId={orgId}
            onOpenContract={(contractId) => handleContractClick({ id: contractId })}
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
