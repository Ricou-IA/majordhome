import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

// =============================================================================
// PAGE 404 - NOT FOUND
// =============================================================================

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-secondary-100 px-4">
      <div className="text-center">
        {/* Code erreur */}
        <h1 className="text-9xl font-bold text-primary-600">404</h1>
        
        {/* Message */}
        <h2 className="mt-4 text-2xl font-semibold text-secondary-900">
          Page non trouvée
        </h2>
        <p className="mt-2 text-secondary-600 max-w-md mx-auto">
          Désolé, la page que vous recherchez n'existe pas ou a été déplacée.
        </p>

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
