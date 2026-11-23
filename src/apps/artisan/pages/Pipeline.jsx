/**
 * Pipeline.jsx - Majord'home Artisan
 * ============================================================================
 * Page Pipeline Commercial avec 3 onglets :
 *   1. Dashboard (le mois de l'entreprise, commerciaux, à traiter, sources)
 *   2. Kanban (drag & drop)
 *   3. Suivi MT-LT (projets long terme)
 *
 * @version 4.0.0 - Dashboard refait (événements du mois / cycle de vie / portefeuille)
 * ============================================================================
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Columns3, Hourglass } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { PipelineDashboard } from '@components/pipeline/dashboard/PipelineDashboard';
import { LeadModal } from '@apps/artisan/components/pipeline/LeadModal';
import { LeadKanban } from '@apps/artisan/components/pipeline/LeadKanban';
import { LongTermTab } from '@apps/artisan/components/pipeline/longTerm/LongTermTab';
import NouveauDevisRapideModal from '@apps/artisan/components/devis/NouveauDevisRapideModal';
import { PageHeader } from '@/components/ui/page-header';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function Pipeline() {
  const { organization, loading: authLoading } = useAuth();
  const { can } = useCanAccess();

  // État modale lead
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [autoSchedule, setAutoSchedule] = useState(false);
  const [autoQuote, setAutoQuote] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [nouveauDevis, setNouveauDevis] = useState(false); // « Nouveau devis » : fiche client courte puis devis

  // Onglet actif (supporte ?tab=kanban depuis le dashboard)
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'dashboard');
  // Commercial sur lequel le Kanban s'ouvre quand on vient du bloc « À traiter » du Dashboard
  const [kanbanCommercialId, setKanbanCommercialId] = useState('');

  const handleTabChange = (tab) => {
    if (tab !== 'kanban') setKanbanCommercialId('');
    setActiveTab(tab);
  };

  const ouvrirKanban = (commercialId) => {
    setKanbanCommercialId(commercialId || '');
    setActiveTab('kanban');
  };

  // Création directe depuis le Dashboard (?new=1) : ouvre la modale en création
  // puis retire le param de l'URL pour éviter la réouverture au refresh/navigation
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setSelectedLeadId(null);
    setModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Ouverture directe d'un lead (?lead=<id>) : recherche globale, mémo vocal. Même
  // principe : la fiche s'ouvre, le paramètre est retiré de l'URL.
  useEffect(() => {
    const leadId = searchParams.get('lead');
    if (!leadId) return;
    setSelectedLeadId(leadId);
    setModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('lead');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Handlers modale
  const handleLeadClick = (lead, options) => {
    setSelectedLeadId(lead.id);
    setAutoSchedule(!!options?.autoSchedule);
    setAutoQuote(!!options?.autoQuote);
    setModalOpen(true);
  };

  const handleNewLead = () => {
    setSelectedLeadId(null);
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setSelectedLeadId(null);
    setAutoSchedule(false);
    setAutoQuote(false);
  };

  const handleModalSaved = () => {
    setRefreshKey((k) => k + 1);
  };

  // ======== Loader initial ========
  if (authLoading || !organization?.id) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4" />
          <div className="h-12 bg-muted rounded w-full" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const canCreateLead = can('pipeline', 'create');
  const canCreateQuote = canCreateLead && can('devis', 'create');

  return (
    <div className="p-4 md:p-8 space-y-4">
      {/* Header */}
      <PageHeader title="Leads" />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full justify-start gap-1 bg-secondary-100/80 p-1">
          <TabsTrigger value="dashboard" className="gap-2 data-[state=active]:bg-white">
            <BarChart3 className="h-4 w-4" />
            Statistiques
          </TabsTrigger>
          <TabsTrigger value="kanban" className="gap-2 data-[state=active]:bg-white">
            <Columns3 className="h-4 w-4" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="long-term" className="gap-2 data-[state=active]:bg-white">
            <Hourglass className="h-4 w-4" />
            Moyen et long terme
          </TabsTrigger>
        </TabsList>

        {/* ==================== TAB DASHBOARD ==================== */}
        <TabsContent value="dashboard" className="mt-4">
          <PipelineDashboard onOuvrirKanban={ouvrirKanban} />
        </TabsContent>

        {/* ==================== TAB KANBAN ==================== */}
        <TabsContent value="kanban" className="mt-4">
          <LeadKanban initialCommercialId={kanbanCommercialId} onLeadClick={handleLeadClick} onNewLead={canCreateLead ? handleNewLead : null} onNewQuote={canCreateQuote ? () => setNouveauDevis(true) : null} refreshTrigger={refreshKey} />
        </TabsContent>

        {/* ==================== TAB SUIVI MT-LT ==================== */}
        <TabsContent value="long-term" className="mt-4">
          <LongTermTab />
        </TabsContent>
      </Tabs>

      {nouveauDevis && (
        <NouveauDevisRapideModal onClose={() => setNouveauDevis(false)} onDone={() => setRefreshKey((k) => k + 1)} />
      )}

      {/* Modale Lead (ouverte depuis le Kanban) */}
      <LeadModal
        leadId={selectedLeadId}
        isOpen={modalOpen}
        onClose={handleModalClose}
        onSaved={handleModalSaved}
        autoSchedule={autoSchedule}
        autoQuote={autoQuote}
        onOpenLead={(id) => handleLeadClick({ id })}
      />
    </div>
  );
}
