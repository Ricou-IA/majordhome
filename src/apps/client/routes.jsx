import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

// =============================================================================
// LAZY LOADING DES PAGES
// =============================================================================

const ClientDashboard = lazy(() => import('./pages/ClientDashboard'));
const ClientContrat = lazy(() => import('./pages/ClientContrat'));
const ClientEquipements = lazy(() => import('./pages/ClientEquipements'));
const ClientInterventions = lazy(() => import('./pages/ClientInterventions'));
const ClientInterventionDetail = lazy(() => import('./pages/ClientInterventionDetail'));

// =============================================================================
// SUSPENSE WRAPPER
// =============================================================================

function SuspenseWrapper({ children }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

// =============================================================================
// ROUTES CLIENT
// =============================================================================

export const clientRoutes = [
  {
    index: true,
    element: <SuspenseWrapper><ClientDashboard /></SuspenseWrapper>,
  },
  {
    path: 'contrat',
    element: <SuspenseWrapper><ClientContrat /></SuspenseWrapper>,
  },
  {
    path: 'equipements',
    element: <SuspenseWrapper><ClientEquipements /></SuspenseWrapper>,
  },
  {
    path: 'interventions',
    element: <SuspenseWrapper><ClientInterventions /></SuspenseWrapper>,
  },
  {
    path: 'interventions/:id',
    element: <SuspenseWrapper><ClientInterventionDetail /></SuspenseWrapper>,
  },
];
