import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

// =============================================================================
// LAZY LOADING DES PAGES
// =============================================================================

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Planning = lazy(() => import('./pages/Planning'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const Entretiens = lazy(() => import('./pages/Entretiens'));
const InterventionDetail = lazy(() => import('./pages/InterventionDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const Territoire = lazy(() => import('./pages/Territoire'));

// =============================================================================
// LOADING COMPONENT
// =============================================================================

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
        <p className="mt-3 text-sm text-secondary-500">Chargement...</p>
      </div>
    </div>
  );
}

// =============================================================================
// WRAPPER SUSPENSE
// =============================================================================

function SuspenseWrapper({ children }) {
  return (
    <Suspense fallback={<PageLoader />}>
      {children}
    </Suspense>
  );
}

// =============================================================================
// ROUTES CONFIGURATION
// =============================================================================

export const artisanRoutes = [
  {
    index: true,
    element: (
      <SuspenseWrapper>
        <Dashboard />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'planning',
    element: (
      <SuspenseWrapper>
        <Planning />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'clients',
    element: (
      <SuspenseWrapper>
        <Clients />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'clients/:id',
    element: (
      <SuspenseWrapper>
        <ClientDetail />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'pipeline',
    element: (
      <SuspenseWrapper>
        <Pipeline />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'entretiens',
    element: (
      <SuspenseWrapper>
        <Entretiens />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'intervention/:id',
    element: (
      <SuspenseWrapper>
        <InterventionDetail />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings',
    element: (
      <SuspenseWrapper>
        <Settings />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'profile',
    element: (
      <SuspenseWrapper>
        <Profile />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'territoire',
    element: (
      <SuspenseWrapper>
        <Territoire />
      </SuspenseWrapper>
    ),
  },
];

export default artisanRoutes;
