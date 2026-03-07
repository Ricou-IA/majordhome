import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Loader2 } from 'lucide-react';

// =============================================================================
// PROTECTED ROUTE
// =============================================================================

/**
 * Composant de route protégée
 * Redirige vers /login si l'utilisateur n'est pas connecté
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children - Contenu à afficher si autorisé
 * @param {string[]} props.allowedRoles - Rôles autorisés (optionnel)
 * @param {boolean} props.requireOrganization - Nécessite une organisation (défaut: true)
 */
export default function ProtectedRoute({ 
  children, 
  allowedRoles = null,
  requireOrganization = true,
}) {
  const location = useLocation();
  const {
    user,
    profile,
    membership,
    organization,
    loading,
    initialized,
  } = useAuth();

  // ===========================================================================
  // LOADING STATE
  // ===========================================================================

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto" />
          <p className="mt-4 text-secondary-600">Chargement...</p>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // AUTH CHECK
  // ===========================================================================

  // Non connecté → redirection vers login
  if (!user) {
    return (
      <Navigate 
        to="/login" 
        state={{ from: location.pathname }} 
        replace 
      />
    );
  }

  // ===========================================================================
  // ORGANIZATION CHECK - DÉSACTIVÉ TEMPORAIREMENT
  // ===========================================================================

  // TODO: Réactiver quand le système d'organisation sera fonctionnel
  // if (requireOrganization && !organization) {
  //   return (
  //     <Navigate 
  //       to="/join-organization" 
  //       state={{ from: location.pathname }} 
  //       replace 
  //     />
  //   );
  // }

  // ===========================================================================
  // ROLE CHECK
  // ===========================================================================

  // Vérification des rôles si spécifiés
  if (allowedRoles && allowedRoles.length > 0) {
    // Priorité au rôle applicatif venant de core.profiles (app_role)
    const appRole = profile?.app_role;
    const membershipRole = membership?.role;
    const userRole = appRole || membershipRole;
    
    if (!userRole || !allowedRoles.includes(userRole)) {
      // Pas le bon rôle → redirection vers page d'accès refusé ou dashboard
      return (
        <Navigate 
          to="/unauthorized" 
          state={{ from: location.pathname, requiredRoles: allowedRoles }} 
          replace 
        />
      );
    }
  }

  // ===========================================================================
  // AUTHORIZED
  // ===========================================================================

  return children;
}

// =============================================================================
// VARIANTES PRÉCONFIGURÉES
// =============================================================================

/**
 * Route réservée aux admins de l'organisation
 */
export function AdminRoute({ children }) {
  return (
    <ProtectedRoute allowedRoles={['org_admin']}>
      {children}
    </ProtectedRoute>
  );
}

/**
 * Route réservée aux team leaders et admins
 */
export function TeamLeaderRoute({ children }) {
  return (
    <ProtectedRoute allowedRoles={['org_admin', 'team_leader']}>
      {children}
    </ProtectedRoute>
  );
}

/**
 * Route publique qui redirige vers le dashboard si déjà connecté
 */
export function PublicOnlyRoute({ children }) {
  const { user, initialized, loading } = useAuth();
  const location = useLocation();

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto" />
          <p className="mt-4 text-secondary-600">Chargement...</p>
        </div>
      </div>
    );
  }

  // Déjà connecté → rediriger vers la page d'origine ou le dashboard
  if (user) {
    const from = location.state?.from || '/';
    return <Navigate to={from} replace />;
  }

  return children;
}
