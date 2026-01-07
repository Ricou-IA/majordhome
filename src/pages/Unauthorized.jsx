import { Link, useLocation } from 'react-router-dom';
import { ShieldX, Home, ArrowLeft } from 'lucide-react';

// =============================================================================
// PAGE UNAUTHORIZED
// =============================================================================

export default function Unauthorized() {
  const location = useLocation();
  const requiredRoles = location.state?.requiredRoles || [];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-secondary-100 px-4">
      <div className="text-center">
        {/* Icône */}
        <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
          <ShieldX className="w-10 h-10 text-red-600" />
        </div>
        
        {/* Message */}
        <h1 className="mt-6 text-2xl font-semibold text-secondary-900">
          Accès non autorisé
        </h1>
        <p className="mt-2 text-secondary-600 max-w-md mx-auto">
          Vous n'avez pas les permissions nécessaires pour accéder à cette page.
        </p>

        {/* Rôles requis */}
        {requiredRoles.length > 0 && (
          <p className="mt-4 text-sm text-secondary-500">
            Rôles requis : {requiredRoles.join(', ')}
          </p>
        )}

        {/* Actions */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/"
            className="btn-primary"
          >
            <Home className="w-5 h-5" />
            Retour à l'accueil
          </Link>
          <button
            onClick={() => window.history.back()}
            className="btn-secondary"
          >
            <ArrowLeft className="w-5 h-5" />
            Page précédente
          </button>
        </div>
      </div>
    </div>
  );
}
