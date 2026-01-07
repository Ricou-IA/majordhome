import { Routes, Route } from 'react-router-dom';

// Layouts
import AppLayout from '@layouts/AppLayout';

// Pages publiques
import Login from '@pages/Login';
import ResetPassword from '@pages/ResetPassword';

// Components
import ProtectedRoute, { PublicOnlyRoute } from '@components/ProtectedRoute';

// Routes module Artisan
import { artisanRoutes } from '@apps/artisan/routes';

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
