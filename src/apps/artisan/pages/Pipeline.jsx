import { useMemo } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useDashboardFilters } from '@hooksPipeline/useDashboardFilters';
import { useDashboardData } from '@hooksPipeline/useDashboardData';
import { DashboardFilters } from '@components/pipeline/dashboard/DashboardFilters';
import { DashboardCards } from '@components/pipeline/dashboard/DashboardCards';
import { SourcesTable } from '@components/pipeline/dashboard/SourcesTable';
import { ConversionFunnel } from '@components/pipeline/dashboard/ConversionFunnel';
import { CostComparisonChart } from '@components/pipeline/dashboard/CostComparisonChart';
import { MonthlyTrendsChart } from '@components/pipeline/dashboard/MonthlyTrendsChart';

// Helper to get role from membership
const getRole = (membership) => {
  if (!membership) return null;
  // Map Majordhome roles to mayer-energie roles
  // For now, we'll use org_admin as Admin, others as Commercial
  // You may need to adjust this based on your actual role mapping
  return membership.role === 'org_admin' ? 'Admin' : 'Commercial';
};

// Helper to get profile for dashboard
const getProfileForDashboard = (profile, membership) => {
  if (!profile) return null;
  const role = getRole(membership);
  return {
    id: profile.id || profile.user_id,
    role: role || 'Commercial',
  };
};

export default function Pipeline() {
  const { profile, membership, loading: authLoading } = useAuth();
  
  // Mémoriser dashboardProfile pour éviter les rechargements inutiles
  // Utiliser une clé stable basée sur les valeurs primitives
  const dashboardProfile = useMemo(() => {
    if (!profile) return null;
    return getProfileForDashboard(profile, membership);
  }, [
    profile?.id ?? profile?.user_id, // Utiliser l'ID ou user_id comme clé
    membership?.role,
    // Ne pas inclure profile ou membership directement pour éviter les changements de référence
  ]);
  const {
    filters,
    updatePeriod,
    updateSourceIds,
    updateCommercialId,
    resetFilters,
  } = useDashboardFilters();
  const { data, loading } = useDashboardData(filters, dashboardProfile);

  if (authLoading || loading || !dashboardProfile) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-20 bg-muted rounded"></div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = dashboardProfile.role === 'Admin';

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Pipeline</h1>
        <p className="text-muted-foreground">
          Analyse complète de vos performances commerciales
        </p>
      </div>

      <DashboardFilters
        filters={filters}
        onUpdatePeriod={updatePeriod}
        onUpdateSourceIds={updateSourceIds}
        onUpdateCommercialId={updateCommercialId}
        onReset={resetFilters}
        isAdmin={isAdmin}
      />

      <DashboardCards data={data} isAdmin={isAdmin} />

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <ConversionFunnel data={data} />
        {isAdmin && <CostComparisonChart sourceMetrics={data.sourceMetrics} />}
      </div>

      <MonthlyTrendsChart data={data} isAdmin={isAdmin} />

      <SourcesTable sourceMetrics={data.sourceMetrics} isAdmin={isAdmin} />
    </div>
  );
}
