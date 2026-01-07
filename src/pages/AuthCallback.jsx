import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@lib/supabaseClient';
import { Loader2, AlertCircle } from 'lucide-react';

// =============================================================================
// PAGE AUTH CALLBACK
// =============================================================================

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Récupérer la session depuis l'URL (hash fragment)
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (data.session) {
          // Session valide, rediriger vers le dashboard
          navigate('/', { replace: true });
        } else {
          // Pas de session, rediriger vers login
          navigate('/login', { replace: true });
        }
      } catch (err) {
        console.error('[AuthCallback] Erreur:', err);
        setError(err.message || 'Une erreur est survenue');
      }
    };

    handleCallback();
  }, [navigate]);

  // ===========================================================================
  // RENDER
  // ===========================================================================

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 px-4">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-secondary-900">
            Erreur d'authentification
          </h1>
          <p className="mt-2 text-secondary-600">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="mt-6 btn-primary"
          >
            Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary-50">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto" />
        <p className="mt-4 text-secondary-600">Authentification en cours...</p>
      </div>
    </div>
  );
}
    