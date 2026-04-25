/**
 * Pipeline.jsx - Majord'home Artisan
 * ============================================================================
 * Page Pipeline Commercial avec 3 onglets :
 *   1. Dashboard (analytics)
 *   2. Leads (liste CRUD)
 *   3. Kanban (drag & drop)
 *
 * @version 3.0.0 - Redesign dashboard (KPIs enrichis, commerciaux inline)
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, List, Columns3, Hourglass, Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useDashboardFilters } from '@hooksPipeline/useDashboardFilters';
import { useDashboardData } from '@hooksPipeline/useDashboardData';
import { DashboardFilters } from '@components/pipeline/dashboard/DashboardFilters';
import { DashboardCards } from '@components/pipeline/dashboard/DashboardCards';
import { CommercialKpis } from '@components/pipeline/dashboard/CommercialKpis';
import { SourcesTable } from '@components/pipeline/dashboard/SourcesTable';
import { ConversionFunnel } from '@components/pipeline/dashboard/ConversionFunnel';
import { MonthlyTrendsChart } from '@components/pipeline/dashboard/MonthlyTrendsChart';
import { LeadsList } from '@apps/artisan/components/pipeline/LeadsList';
import { LeadModal } from '@apps/artisan/components/pipeline/LeadModal';
import { LeadKanban } from '@apps/artisan/components/pipeline/LeadKanban';
import { LongTermTab } from '@apps/artisan/components/pipeline/longTerm/LongTermTab';

// ============================================================================
// HELPERS
// ============================================================================

const getRole = (profile, effectiveRole) => {
  if (effectiveRole === 'org_admin') return 'Admin';
  if (effectiveRole === 'commercial') return 'Commercial';
  if (effectiveRole === 'team_leader') return 'Admin';
  return 'Technicien';
};

const getProfileForDashboard = (profile, organization, effectiveRole) => {
  if (!profile) return null;
  const role = getRole(profile, effectiveRole);
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
  const { profile, user, organization, loading: authLoading, effectiveRole } =
    useAuth();
  const { can } = useCanAccess();

  // État modale lead
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [autoSchedule, setAutoSchedule] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Onglet actif (supporte ?tab=kanban depuis le dashboard)
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'dashboard');

  // Dashboard data
  const dashboardProfile = useMemo(
    () => getProfileForDashboard(profile, organization, effectiveRole),
    [profile?.id ?? profile?.user_id, profile?.app_role, profile?.business_role, organization?.id, effectiveRole],
  );
  const { filters, updateMonths, updateSourceIds, resetFilters } =
    useDashboardFilters();
  const { data, loading } = useDashboardData(filters, dashboardProfile);

  // Handlers modale
  const handleLeadClick = (lead, options) => {
    setSelectedLeadId(lead.id);
    setAutoSchedule(!!options?.autoSchedule);
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
  };

  const handleModalSaved = () => {
    setRefreshKey((k) => k + 1);
  };

  // ======== Loader initial ========
  if (authLoading || !dashboardProfile || !dashboardProfile.orgId) {
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

  const isAdmin = effectiveRole === 'org_admin' || effectiveRole === 'team_leader';
  const canCreateLead = can('pipeline', 'create');

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Pipeline</h1>
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
          <TabsTrigger value="long-term" className="gap-2 data-[state=active]:bg-white">
            <Hourglass className="h-4 w-4" />
            Suivi MT-LT
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
                onUpdateMonths={updateMonths}
                onUpdateSourceIds={updateSourceIds}
                onReset={resetFilters}
              />

              <DashboardCards data={data} />

              {isAdmin && data.commercialMetrics.length > 0 && (
                <CommercialKpis commercialMetrics={data.commercialMetrics} />
              )}

              <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
                <ConversionFunnel data={data} />
                <MonthlyTrendsChart data={data} />
              </div>

              <SourcesTable sourceMetrics={data.sourceMetrics} />
            </>
          )}
        </TabsContent>

        {/* ==================== TAB LEADS ==================== */}
        <TabsContent value="leads" className="mt-6">
          <LeadsList onLeadClick={handleLeadClick} onNewLead={canCreateLead ? handleNewLead : null} />
        </TabsContent>

        {/* ==================== TAB KANBAN ==================== */}
        <TabsContent value="kanban" className="mt-6">
          <LeadKanban onLeadClick={handleLeadClick} onNewLead={canCreateLead ? handleNewLead : null} refreshTrigger={refreshKey} />
        </TabsContent>

        {/* ==================== TAB SUIVI MT-LT ==================== */}
        <TabsContent value="long-term" className="mt-6">
          <LongTermTab />
        </TabsContent>
      </Tabs>

      {/* Modale Lead (partagée entre les 3 onglets) */}
      <LeadModal
        leadId={selectedLeadId}
        isOpen={modalOpen}
        onClose={handleModalClose}
        onSaved={handleModalSaved}
        autoSchedule={autoSchedule}
      />
    </div>
  );
}
