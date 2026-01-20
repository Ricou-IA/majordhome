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

// Helper pour déterminer le rôle affiché dans le dashboard
// Priorité : profil.app_role (core.profiles), puis business_role
const getRole = (profile) => {
  if (profile?.app_role === 'org_admin') return 'Admin';
  if (typeof profile?.business_role === 'string' && profile.business_role.toLowerCase() === 'commercial') {
    return 'Commercial';
  }
  return 'Technicien';
};

// Helper to get profile for dashboard
// Utilise exclusivement le profil métier (core.profiles)
const getProfileForDashboard = (profile) => {
  if (!profile) return null;
  const role = getRole(profile);
  return {
    id: profile.id || profile.user_id,
    role: role || 'Commercial',
  };
};

export default function Pipeline() {
  const { profile, loading: authLoading, canAccessPipeline, appRole, businessRole } = useAuth();
  
  // Debug: log pour vérifier les valeurs
  console.log('[Pipeline] Debug access:', {
    hasProfile: !!profile,
    appRole,
    businessRole,
    canAccessPipeline,
    profileAppRole: profile?.app_role,
    profileBusinessRole: profile?.business_role,
  });
  
  // Mémoriser dashboardProfile pour éviter les rechargements inutiles
  const dashboardProfile = useMemo(() => {
    return getProfileForDashboard(profile);
  }, [
    profile?.id ?? profile?.user_id,
    profile?.app_role,
    profile?.business_role,
  ]);
  const {
    filters,
    updatePeriod,
    updateSourceIds,
    updateCommercialId,
    resetFilters,
  } = useDashboardFilters();
  const { data, loading } = useDashboardData(filters, dashboardProfile);

  // Si le profil n'a pas le droit d'accéder au Pipeline, on n'affiche pas la page
  // Mais on attend que le profil soit chargé avant de bloquer
  if (!authLoading && !loading && profile && !canAccessPipeline) {
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

  // Loader pendant l'initialisation
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

  // Utiliser un profil par défaut si dashboardProfile est null
  const effectiveProfile = dashboardProfile || { id: user?.id || 'unknown', role: 'Commercial' };
  const isAdmin = effectiveProfile.role === 'Admin';

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
