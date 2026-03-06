/**
 * Pipeline.jsx - Majord'home Artisan
 * ============================================================================
 * Page Pipeline Commercial avec 3 onglets :
 *   1. Dashboard (analytics existant)
 *   2. Leads (liste CRUD)
 *   3. Kanban (drag & drop)
 *
 * @version 2.0.0 - Sprint 4 — Ajout onglets Leads + Kanban
 * @version 1.0.0 - Sprint 1 — Dashboard analytics
 * ============================================================================
 */

import { useState, useMemo, lazy, Suspense } from 'react';
import { BarChart3, List, Columns3, Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@contexts/AuthContext';
import { useDashboardFilters } from '@hooksPipeline/useDashboardFilters';
import { useDashboardData } from '@hooksPipeline/useDashboardData';
import { DashboardFilters } from '@components/pipeline/dashboard/DashboardFilters';
import { DashboardCards } from '@components/pipeline/dashboard/DashboardCards';
import { SourcesTable } from '@components/pipeline/dashboard/SourcesTable';
import { ConversionFunnel } from '@components/pipeline/dashboard/ConversionFunnel';
import { CostComparisonChart } from '@components/pipeline/dashboard/CostComparisonChart';
import { MonthlyTrendsChart } from '@components/pipeline/dashboard/MonthlyTrendsChart';
import { LeadsList } from '@apps/artisan/components/pipeline/LeadsList';
import { LeadModal } from '@apps/artisan/components/pipeline/LeadModal';
import { LeadKanban } from '@apps/artisan/components/pipeline/LeadKanban';

// ============================================================================
// HELPERS
// ============================================================================

const getRole = (profile) => {
  if (profile?.app_role === 'org_admin') return 'Admin';
  if (
    typeof profile?.business_role === 'string' &&
    profile.business_role.toLowerCase() === 'commercial'
  ) {
    return 'Commercial';
  }
  return 'Technicien';
};

const getProfileForDashboard = (profile, organization) => {
  if (!profile) return null;
  const role = getRole(profile);
  return {
    id: profile.id || profile.user_id,
    role: role || 'Commercial',
    orgId: organization?.id || null,
  };
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function Pipeline() {
  const { profile, user, organization, loading: authLoading, dataLoading, canAccessPipeline, appRole, businessRole } =
    useAuth();

  // État modale lead
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Onglet actif
  const [activeTab, setActiveTab] = useState('dashboard');

  // Dashboard data
  const dashboardProfile = useMemo(
    () => getProfileForDashboard(profile, organization),
    [profile?.id ?? profile?.user_id, profile?.app_role, profile?.business_role, organization?.id],
  );
  const { filters, updatePeriod, updateSourceIds, updateCommercialId, resetFilters } =
    useDashboardFilters();
  const { data, loading } = useDashboardData(filters, dashboardProfile);

  // Handlers modale
  const handleLeadClick = (lead) => {
    setSelectedLeadId(lead.id);
    setModalOpen(true);
  };

  const handleNewLead = () => {
    setSelectedLeadId(null);
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setSelectedLeadId(null);
  };

  const handleModalSaved = () => {
    setRefreshKey((k) => k + 1);
  };

  // ======== Accès non autorisé ========
  if (!authLoading && !dataLoading && !loading && profile && !canAccessPipeline) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-2">Accès non autorisé</h1>
        <p className="text-muted-foreground">
          Votre profil ne dispose pas des droits nécessaires pour accéder au pipeline commercial.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          App Role: {appRole || 'non défini'} | Business Role: {businessRole || 'non défini'}
        </p>
      </div>
    );
  }

  // ======== Loader initial ========
  // Attendre que l'auth ET les données utilisateur soient chargées
  if (authLoading || dataLoading || !dashboardProfile || !dashboardProfile.orgId) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4" />
          <div className="h-12 bg-muted rounded w-full" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const effectiveProfile = dashboardProfile || {
    id: user?.id || 'unknown',
    role: 'Commercial',
  };
  const isAdmin = effectiveProfile.role === 'Admin';

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Pipeline</h1>
        <p className="text-muted-foreground">
          Gestion commerciale : analytics, leads et kanban
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start gap-1 bg-gray-100/80 p-1">
          <TabsTrigger value="dashboard" className="gap-2 data-[state=active]:bg-white">
            <BarChart3 className="h-4 w-4" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="leads" className="gap-2 data-[state=active]:bg-white">
            <List className="h-4 w-4" />
            Leads
          </TabsTrigger>
          <TabsTrigger value="kanban" className="gap-2 data-[state=active]:bg-white">
            <Columns3 className="h-4 w-4" />
            Kanban
          </TabsTrigger>
        </TabsList>

        {/* ==================== TAB DASHBOARD ==================== */}
        <TabsContent value="dashboard" className="mt-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              <DashboardFilters
                filters={filters}
                onUpdatePeriod={updatePeriod}
                onUpdateSourceIds={updateSourceIds}
                onUpdateCommercialId={updateCommercialId}
                onReset={resetFilters}
                isAdmin={isAdmin}
                orgId={organization?.id}
              />

              <DashboardCards data={data} isAdmin={isAdmin} />

              <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
                <ConversionFunnel data={data} />
                {isAdmin && <CostComparisonChart sourceMetrics={data.sourceMetrics} />}
              </div>

              <MonthlyTrendsChart data={data} isAdmin={isAdmin} />
              <SourcesTable sourceMetrics={data.sourceMetrics} isAdmin={isAdmin} />
            </>
          )}
        </TabsContent>

        {/* ==================== TAB LEADS ==================== */}
        <TabsContent value="leads" className="mt-6">
          <LeadsList onLeadClick={handleLeadClick} onNewLead={handleNewLead} />
        </TabsContent>

        {/* ==================== TAB KANBAN ==================== */}
        <TabsContent value="kanban" className="mt-6">
          <LeadKanban onLeadClick={handleLeadClick} onNewLead={handleNewLead} refreshTrigger={refreshKey} />
        </TabsContent>
      </Tabs>

      {/* Modale Lead (partagée entre les 3 onglets) */}
      <LeadModal
        leadId={selectedLeadId}
        isOpen={modalOpen}
        onClose={handleModalClose}
        onSaved={handleModalSaved}
      />
    </div>
  );
}
