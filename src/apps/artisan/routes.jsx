import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useCanAccess } from '@hooks/usePermissions';

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
const Chantiers = lazy(() => import('./pages/Chantiers'));
const GeoGrid = lazy(() => import('./pages/GeoGrid'));
const TeamManagement = lazy(() => import('./pages/settings/TeamManagement'));
const PermissionsEditor = lazy(() => import('./pages/settings/PermissionsEditor'));
const SupplierManagement = lazy(() => import('./pages/settings/SupplierManagement'));
const PricingSettings = lazy(() => import('./pages/settings/PricingSettings'));
const OrganizationSettings = lazy(() => import('./pages/settings/OrganizationSettings'));
const SolaireSettings = lazy(() => import('./pages/settings/SolaireSettings'));
const ThermiqueSettings = lazy(() => import('./pages/settings/ThermiqueSettings'));

// Certificat
const CertificatEntretien = lazy(() => import('./pages/CertificatEntretien'));

// Contrat signature
const ContractSign = lazy(() => import('./pages/ContractSign'));

// PV de Réception
const PvReceptionSign = lazy(() => import('./pages/PvReceptionSign'));

// Tasks
const Tasks = lazy(() => import('./pages/Tasks'));

// Prospection
const CedantsPipeline = lazy(() => import('@apps/prospection/cedants/CedantsPipeline'));
const CommercialPipeline = lazy(() => import('@apps/prospection/commercial/CommercialPipeline'));

// Pipeline Contrats
const PipelineContrats = lazy(() => import('./pages/PipelineContrats'));

// Webshop (commandes site web + tarifs produits)
const Webshop = lazy(() => import('./pages/Webshop'));

// Mailing
const Mailing = lazy(() => import('./pages/Mailing'));

// Meta Ads
const MetaAds = lazy(() => import('./pages/MetaAds'));

// Solaire (calculateur PV)
const SolaireSimulateur = lazy(() => import('@apps/solaire/pages/Simulateur'));
const SolaireHistorique = lazy(() => import('@apps/solaire/pages/Historique'));

// Thermique (étude de déperditions)
const ThermiqueWizard = lazy(() => import('@apps/thermique/pages/ThermiqueWizard'));
const ThermiqueHistorique = lazy(() => import('@apps/thermique/pages/ThermiqueHistorique'));

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
// ROUTE GUARD — Vérifie la permission avant d'afficher la page
// =============================================================================

/**
 * Garde de route basé sur les permissions DB.
 * Redirige vers le dashboard si l'accès est refusé.
 *
 * @param {string} resource - Resource à vérifier (ex: 'pipeline', 'settings')
 * @param {string} [action='view'] - Action à vérifier
 */
function RouteGuard({ resource, action = 'view', children }) {
  const { can, permissionsLoading } = useCanAccess();

  // Pendant le chargement des permissions, afficher le loader
  if (permissionsLoading) {
    return <PageLoader />;
  }

  if (!can(resource, action)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

// =============================================================================
// ROUTES CONFIGURATION
// =============================================================================
//
// Sécurité (audit P1.10, 2026-05-21) :
// - TOUTES les routes ci-dessous sont rendues à l'intérieur de <ProtectedRoute>
//   + <AppLayout /> (cf. src/App.jsx:163-179). ProtectedRoute exige (a) un user
//   authentifié, (b) une organization assignée via core.organization_members
//   (garde réactivée en P0.7 — 2026-05-21).
// - Pas de route artisan accessible sans auth + org.
// - Le <RouteGuard resource="..."> ajoute une couche de permission fine
//   (consume `majordhome.role_permissions` via useCanAccess). Posé sur
//   pipeline / settings / chantiers / tasks / cedants / prospection_commerciale /
//   mailing / meta_ads / geogrid. Les routes "core métier" (clients, planning,
//   entretiens, contrats, profile, territoire, intervention/:id, certificat/:id,
//   contrat/signer) sont accessibles à tout user authentifié de l'org, et la
//   RLS DB scope ce qu'ils voient — pas un trou de sécurité.
// - Dette résiduelle : on pourrait ajouter RouteGuard fin (par resource) sur
//   les routes métier pour blocer en amont l'accès UI (UX). À faire si on
//   définit des resources granulaires côté permissions DB.
//
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
        <RouteGuard resource="pipeline">
          <Pipeline />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'contrats',
    element: (
      <SuspenseWrapper>
        <PipelineContrats />
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
    path: 'certificat/:interventionId',
    element: (
      <SuspenseWrapper>
        <CertificatEntretien />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'clients/:clientId/contrat/signer',
    element: (
      <SuspenseWrapper>
        <ContractSign />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <Settings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/team',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <TeamManagement />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/permissions',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <PermissionsEditor />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/organization',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <OrganizationSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/suppliers',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <SupplierManagement />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/pricing',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <PricingSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/solaire',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <SolaireSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/thermique',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <ThermiqueSettings />
        </RouteGuard>
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
  {
    path: 'geogrid',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <GeoGrid />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'chantiers',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="chantiers">
          <Chantiers />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'chantiers/:leadId/pv-reception',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="chantiers">
          <PvReceptionSign />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'tasks',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="tasks">
          <Tasks />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    // Webshop : même périmètre d'accès que le pipeline (équipe commerciale)
    path: 'webshop',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="pipeline">
          <Webshop />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'cedants',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="cedants">
          <CedantsPipeline />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'prospection',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="prospection_commerciale">
          <CommercialPipeline />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'mailing',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <Mailing />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'meta-ads',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="meta_ads">
          <MetaAds />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'solaire',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="pv_calculator">
          <SolaireSimulateur />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'solaire/historique',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="pv_calculator">
          <SolaireHistorique />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'thermique',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="thermal_study">
          <ThermiqueWizard />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'thermique/historique',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="thermal_study">
          <ThermiqueHistorique />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
];

export default artisanRoutes;
