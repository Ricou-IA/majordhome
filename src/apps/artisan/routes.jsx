/* eslint-disable react-refresh/only-export-components -- fichier de routes : wrappers locaux + export de config, l'édition recharge l'app entière, fast refresh sans objet */
import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { useCanAccess } from '@hooks/usePermissions';
import AccueilSelonOrg from '@apps/maintenance/components/AccueilSelonOrg';

// =============================================================================
// LAZY LOADING DES PAGES
// =============================================================================

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Planning = lazy(() => import('./pages/Planning'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));
const ClientsImport = lazy(() => import('./pages/ClientsImport'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const Entretiens = lazy(() => import('./pages/Entretiens'));
const Sav = lazy(() => import('./pages/Sav'));
const InterventionDetail = lazy(() => import('./pages/InterventionDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const Territoire = lazy(() => import('./pages/Territoire'));
const Chantiers = lazy(() => import('./pages/Chantiers'));
const GeoGrid = lazy(() => import('./pages/GeoGrid'));
const TeamManagement = lazy(() => import('./pages/settings/TeamManagement'));
const SupplierManagement = lazy(() => import('./pages/settings/SupplierManagement'));
const ArticlesPage = lazy(() => import('./pages/settings/catalogue/ArticlesPage'));
const ArticlesImport = lazy(() => import('./pages/settings/catalogue/ArticlesImport'));
const HarmonisationPage = lazy(() => import('./pages/settings/catalogue/HarmonisationPage'));
const PricingSettings = lazy(() => import('./pages/settings/PricingSettings'));
const OrganizationSettings = lazy(() => import('./pages/settings/OrganizationSettings'));
const SolaireSettings = lazy(() => import('./pages/settings/SolaireSettings'));
const ThermiqueSettings = lazy(() => import('./pages/settings/ThermiqueSettings'));
const ActiviteSettings = lazy(() => import('./pages/settings/ActiviteSettings'));
const TourneesSettings = lazy(() => import('./pages/settings/TourneesSettings'));
const FumisterieSettings = lazy(() => import('./pages/settings/FumisterieSettings'));
const CommunicationSettings = lazy(() => import('./pages/settings/CommunicationSettings'));
const TelephonieSettings = lazy(() => import('./pages/settings/TelephonieSettings'));
const PennylaneSettings = lazy(() => import('./pages/settings/PennylaneSettings'));
const PlanComptableSettings = lazy(() => import('./pages/settings/PlanComptableSettings'));

// Certificat
const CertificatEntretien = lazy(() => import('./pages/CertificatEntretien'));

// Contrat signature
const ContractSign = lazy(() => import('./pages/ContractSign'));

// PV de Réception
const PvReceptionSign = lazy(() => import('./pages/PvReceptionSign'));

// Prospection
const CedantsPipeline = lazy(() => import('@apps/prospection/cedants/CedantsPipeline'));
const CommercialPipeline = lazy(() => import('@apps/prospection/commercial/CommercialPipeline'));

// Pipeline Contrats
const PipelineContrats = lazy(() => import('./pages/PipelineContrats'));

// Explorateur de devis Pennylane
const Devis = lazy(() => import('./pages/Devis'));

// Webshop (commandes site web + tarifs produits)
const Webshop = lazy(() => import('./pages/Webshop'));

// Mailing
const Mailing = lazy(() => import('./pages/Mailing'));

// Meta Ads
const MetaAds = lazy(() => import('./pages/MetaAds'));

// Solaire (calculateur PV)
const SolaireSimulateur = lazy(() => import('@apps/solaire/pages/Simulateur'));
const SolaireHistorique = lazy(() => import('@apps/solaire/pages/Historique'));
const SolaireAutoconso = lazy(() => import('@apps/solaire/pages/AutoconsoSimulateur'));

// Maintenance (tâches récurrentes, borne d'atelier) — module opt-in
const MaintenancePage = lazy(() => import('@apps/maintenance/pages/Maintenance'));
const MaintenanceSettings = lazy(() => import('./pages/settings/MaintenanceSettings'));

// Climatisation (dimensionnement)
const ClimDimensionnement = lazy(() => import('@apps/clim/pages/Dimensionnement'));
const ClimSettings = lazy(() => import('./pages/settings/ClimSettings'));
const DevisSettings = lazy(() => import('./pages/settings/DevisSettings'));
const WebshopSettings = lazy(() => import('./pages/settings/WebshopSettings'));

// Thermique (étude de déperditions)
const ThermiqueWizard = lazy(() => import('@apps/thermique/pages/ThermiqueWizard'));
const ThermiqueHistorique = lazy(() => import('@apps/thermique/pages/ThermiqueHistorique'));

// Chantier Gaillac — module PROVISOIRE (retrait : CLAUDE.md → Modules provisoires)
import { CHANTIER_GAILLAC_ACTIF } from '@apps/chantier-gaillac/config';
import { ChargementPage } from '@/components/ui/chargement-app';
const ChantierGaillac = lazy(() => import('@apps/chantier-gaillac/pages/ChantierGaillac'));

// =============================================================================
// LOADING COMPONENT
// =============================================================================

function PageLoader() {
  // Structure de page en blocs gris (brief UX P1-06) : jamais un « Chargement… » seul.
  return <ChargementPage />;
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
/**
 * @param {{ resource?: string, action?: string, anyOf?: Array<[string, string]>, children: React.ReactNode }} p
 *   `anyOf` = liste de couples [resource, action] dont UN suffit (hub Paramètres : `settings.view` OU une tuile à droit).
 */
function RouteGuard({ resource, action = 'view', anyOf, children }) {
  const { can, permissionsLoading } = useCanAccess();

  // Pendant le chargement des permissions, afficher le loader
  if (permissionsLoading) {
    return <PageLoader />;
  }

  const droits = anyOf || [[resource, action]];
  if (!droits.some(([r, a]) => can(r, a) === true)) {
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
        <AccueilSelonOrg>
          <Dashboard />
        </AccueilSelonOrg>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'maintenance',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="maintenance">
          <MaintenancePage />
        </RouteGuard>
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
    // Import des clients d'un autre logiciel — garde org_admin in-component
    path: 'clients/import',
    element: (
      <SuspenseWrapper>
        <ClientsImport />
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
    // Devis faits dans Majord'home (+ onglet « Orphelins Pennylane », admin, garde dans la page)
    path: 'devis',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="devis">
          <Devis />
        </RouteGuard>
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
    // SAV : son écran et son kanban, à part des entretiens (Eric 2026-11-25)
    path: 'sav',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="sav">
          <Sav />
        </RouteGuard>
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
        {/* hub : admins (settings.view) ou tout rôle qui a une tuile à droit (Fournisseurs & catalogue → articles.edit) */}
        <RouteGuard anyOf={[['settings', 'view'], ['articles', 'edit']]}>
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
        {/* ancienne adresse : les droits vivent dans Administration utilisateurs */}
        <Navigate to="/settings/team?tab=droits" replace />
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
        {/* Fournisseurs & catalogue et Articles : ouverts au rôle qui a articles.edit (team_leader par défaut, Eric 2026-10-27) ; Harmoniser reste admin */}
        <RouteGuard resource="articles" action="edit">
          <SupplierManagement />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/suppliers/articles',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="articles" action="edit">
          <ArticlesPage />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    // Import d'articles depuis un fichier : org_admin seul, tenu dans la page (et par chaque RPC).
    path: 'settings/suppliers/articles/import',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="articles" action="edit">
          <ArticlesImport />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/suppliers/harmoniser',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <HarmonisationPage />
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
    path: 'settings/maintenance',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <MaintenanceSettings />
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
    path: 'settings/activite',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <ActiviteSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/equipements',
    element: (
      <SuspenseWrapper>
        {/* ancienne adresse : les équipements vivent dans Mon activité */}
        <Navigate to="/settings/activite?tab=categories" replace />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/fumisterie',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <FumisterieSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/clim',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <ClimSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/webshop',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <WebshopSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/projets',
    element: (
      <SuspenseWrapper>
        {/* ancienne adresse : les types de projet vivent dans Mon activité */}
        <Navigate to="/settings/activite?tab=projets" replace />
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/devis',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <DevisSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'clim',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="devis">
          <ClimDimensionnement />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/tournees',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <TourneesSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/communication',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <CommunicationSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  // Anciennes adresses (e-mails et SMS réunis le 2026-11-21).
  { path: 'settings/emails', element: <Navigate to="/settings/communication" replace /> },
  { path: 'settings/sms', element: <Navigate to="/settings/communication?tab=sms" replace /> },
  {
    path: 'settings/telephonie',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <TelephonieSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/pennylane',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <PennylaneSettings />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
  {
    path: 'settings/plan-comptable',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="settings">
          <PlanComptableSettings />
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
    path: 'chantiers/:chantierId/pv-reception',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="chantiers">
          <PvReceptionSign />
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
    path: 'solaire/autoconso',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="pv_calculator">
          <SolaireAutoconso />
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
  // Chantier Gaillac (provisoire) : la page vérifie elle-même l'org (chantierGaillacVisible)
  ...(CHANTIER_GAILLAC_ACTIF
    ? [{
      path: 'chantier-gaillac',
      element: (
        <SuspenseWrapper>
          <ChantierGaillac />
        </SuspenseWrapper>
      ),
    }]
    : []),
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
