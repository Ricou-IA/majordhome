import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Building2, Loader2, AlertCircle, CheckCircle, LogOut } from 'lucide-react';

// =============================================================================
// PAGE JOIN ORGANIZATION
// =============================================================================

export default function JoinOrganization() {
  const navigate = useNavigate();
  const { joinOrganization, signOut, user } = useAuth();

  // État
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error } = await joinOrganization(inviteCode);

      if (error) {
        throw error;
      }

      setSuccess(true);
      
      // Redirection après 1.5s
      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (err) {
      console.error('[JoinOrganization] Erreur:', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const getErrorMessage = (error) => {
    const message = error?.message || String(error);

    if (message.includes('Invalid invite code') || message.includes('not found')) {
      return 'Code d\'invitation invalide ou expiré';
    }
    if (message.includes('already a member')) {
      return 'Vous êtes déjà membre de cette organisation';
    }

    return message;
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-secondary-100 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Titre */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto bg-primary-100 rounded-full flex items-center justify-center">
            <Building2 className="w-8 h-8 text-primary-600" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-secondary-900">
            Rejoindre une organisation
          </h1>
          <p className="mt-2 text-secondary-600">
            Entrez le code d'invitation fourni par votre responsable
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Info utilisateur */}
          <div className="mb-6 p-4 bg-secondary-50 rounded-lg">
            <p className="text-sm text-secondary-600">
              Connecté en tant que
            </p>
            <p className="font-medium text-secondary-900">
              {user?.email}
            </p>
          </div>

          {/* Messages */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-green-700">
                  Organisation rejointe avec succès !
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Redirection en cours...
                </p>
              </div>
            </div>
          )}

          {/* Formulaire */}
          {!success && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Code invitation */}
              <div>
                <label htmlFor="inviteCode" className="label">
                  Code d'invitation
                </label>
                <input
                  type="text"
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(e.target.value.toUpperCase());
                    setError(null);
                  }}
                  placeholder="XXXXXX"
                  className="input text-center text-2xl tracking-widest font-mono uppercase"
                  maxLength={10}
                  required
                  autoFocus
                />
                <p className="mt-2 text-xs text-secondary-500 text-center">
                  Le code est généralement composé de 6 caractères
                </p>
              </div>

              {/* Bouton submit */}
              <button
                type="submit"
                disabled={loading || inviteCode.length < 4}
                className="btn-primary w-full py-3"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Vérification...
                  </>
                ) : (
                  'Rejoindre'
                )}
              </button>
            </form>
          )}

          {/* Déconnexion */}
          <div className="mt-6 pt-6 border-t border-secondary-200">
            <button
              onClick={handleSignOut}
              className="flex items-center justify-center gap-2 w-full text-sm text-secondary-600 hover:text-secondary-800"
            >
              <LogOut className="w-4 h-4" />
              Se déconnecter
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-secondary-500">
          Vous n'avez pas de code ? Contactez votre responsable.
        </p>
      </div>
    </div>
  );
}
