import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

// Layouts
import AppLayout from '@layouts/AppLayout';

// Pages publiques
import Login from '@pages/Login';
import ResetPassword from '@pages/ResetPassword';

// Components
import ProtectedRoute, { PublicOnlyRoute, ClientRoute } from '@components/ProtectedRoute';

// Routes module Artisan
import { artisanRoutes } from '@apps/artisan/routes';

// Routes module Client (portail)
import { clientRoutes } from '@apps/client/routes';
const ClientLayout = lazy(() => import('@apps/client/layouts/ClientLayout'));

// Pages utilitaires
import NotFound from '@pages/NotFound';
import Unauthorized from '@pages/Unauthorized';
import JoinOrganization from '@pages/JoinOrganization';
import AuthCallback from '@pages/AuthCallback';

// =============================================================================
// APP
// =============================================================================

export default function App() {
  return (
    <Routes>
      {/* ===================================================================
          ROUTES PUBLIQUES
          =================================================================== */}
      
      {/* Login - redirige vers dashboard si déjà connecté */}
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <Login />
          </PublicOnlyRoute>
        }
      />

      {/* Mot de passe oublié */}
      <Route
        path="/forgot-password"
        element={
          <PublicOnlyRoute>
            <ResetPassword />
          </PublicOnlyRoute>
        }
      />

      {/* Reset password (depuis lien email) */}
      <Route
        path="/reset-password"
        element={<ResetPassword />}
      />

      {/* Callback OAuth */}
      <Route
        path="/auth/callback"
        element={<AuthCallback />}
      />

      {/* ===================================================================
          ROUTES SEMI-PROTÉGÉES (auth requise, pas d'organisation)
          =================================================================== */}

      {/* Rejoindre une organisation */}
      <Route
        path="/join-organization"
        element={
          <ProtectedRoute requireOrganization={false}>
            <JoinOrganization />
          </ProtectedRoute>
        }
      />

      {/* Accès non autorisé */}
      <Route
        path="/unauthorized"
        element={
          <ProtectedRoute requireOrganization={false}>
            <Unauthorized />
          </ProtectedRoute>
        }
      />

      {/* ===================================================================
          PORTAIL CLIENT (auth + client record requis)
          =================================================================== */}

      <Route
        path="/client"
        element={
          <ClientRoute>
            <Suspense
              fallback={
                <div className="min-h-screen flex items-center justify-center bg-gray-50">
                  <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
                </div>
              }
            >
              <ClientLayout />
            </Suspense>
          </ClientRoute>
        }
      >
        {clientRoutes.map((route, index) => (
          <Route
            key={index}
            index={route.index}
            path={route.path}
            element={route.element}
          />
        ))}
      </Route>

      {/* ===================================================================
          ROUTES PROTÉGÉES (auth + organisation requises)
          =================================================================== */}

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        {/* Routes du module Artisan */}
        {artisanRoutes.map((route, index) => (
          <Route
            key={index}
            index={route.index}
            path={route.path}
            element={route.element}
          />
        ))}
      </Route>

      {/* ===================================================================
          404 - PAGE NON TROUVÉE
          =================================================================== */}
      
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
