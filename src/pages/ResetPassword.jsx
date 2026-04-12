import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { authService } from '@services/auth.service';
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';

// =============================================================================
// PAGE RESET PASSWORD
// =============================================================================

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resetPassword, updatePassword } = useAuth();

  // Détecter si on est en mode "demande" ou "nouveau mot de passe"
  // Le mode "update" est activé quand l'utilisateur arrive via le lien email
  const [mode, setMode] = useState('request'); // 'request' | 'update'

  // État
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Formulaire — pré-remplir l'email depuis l'URL si présent
  const [formData, setFormData] = useState({
    email: searchParams.get('email') || '',
    password: '',
    confirmPassword: '',
  });

  // ===========================================================================
  // DÉTECTION MODE
  // ===========================================================================

  useEffect(() => {
    // Vérifier si on arrive via un lien de reset (présence de tokens dans l'URL)
    const accessToken = searchParams.get('access_token');
    const type = searchParams.get('type');

    if (accessToken || type === 'recovery') {
      setMode('update');
    }
  }, [searchParams]);

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleRequestReset = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const { error } = await resetPassword(formData.email);

      if (error) {
        throw error;
      }

      setSuccess(
        'Si un compte existe avec cet email, vous recevrez un lien de réinitialisation.'
      );
      setFormData({ ...formData, email: '' });
    } catch (err) {
      console.error('[ResetPassword] Erreur:', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      // Validation
      if (formData.password !== formData.confirmPassword) {
        throw new Error('Les mots de passe ne correspondent pas');
      }

      if (formData.password.length < 6) {
        throw new Error('Le mot de passe doit contenir au moins 6 caractères');
      }

      // Tenter updateUser standard (fonctionne pour artisans + recovery mode)
      const { error } = await updatePassword(formData.password);

      if (error) {
        // Fallback Edge Function pour les clients (contourne le 403 GoTrue)
        const fallback = await authService.clientChangePassword(formData.password);
        if (fallback.error) throw fallback.error;
      }

      setSuccess('Mot de passe mis à jour avec succès !');

      // Rediriger vers la page de connexion après 2 secondes
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err) {
      console.error('[ResetPassword] Erreur:', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const getErrorMessage = (error) => {
    const message = error?.message || error?.error_description || String(error);

    if (message.includes('Password should be at least')) {
      return 'Le mot de passe doit contenir au moins 6 caractères';
    }
    if (message.includes('Auth session missing')) {
      return 'Session expirée. Veuillez redemander un lien de réinitialisation.';
    }

    return message;
  };

  // ===========================================================================
  // RENDER - MODE REQUEST
  // ===========================================================================

  if (mode === 'request') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-secondary-100 px-4 py-12">
        <div className="w-full max-w-md">
          {/* Titre */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-secondary-900">
              Mot de passe oublié
            </h1>
            <p className="text-secondary-600 mt-2">
              Entrez votre email pour recevoir un lien de réinitialisation
            </p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
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
                <p className="text-sm text-green-700">{success}</p>
              </div>
            )}

            {/* Formulaire */}
            <form onSubmit={handleRequestReset} className="space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="email" className="label">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="vous@exemple.com"
                    className="input pl-10"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Bouton submit */}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  'Envoyer le lien'
                )}
              </button>
            </form>

            {/* Retour connexion */}
            <Link
              to="/login"
              className="mt-6 flex items-center justify-center gap-2 text-sm text-secondary-600 hover:text-secondary-800"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour à la connexion
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // RENDER - MODE UPDATE
  // ===========================================================================

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-secondary-100 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Titre */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-secondary-900">
            Nouveau mot de passe
          </h1>
          <p className="text-secondary-600 mt-2">
            Choisissez un nouveau mot de passe sécurisé
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
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
                <p className="text-sm text-green-700">{success}</p>
                <p className="text-xs text-green-600 mt-1">
                  Redirection vers la connexion...
                </p>
              </div>
            </div>
          )}

          {/* Formulaire */}
          {!success && (
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              {/* Nouveau mot de passe */}
              <div>
                <label htmlFor="password" className="label">
                  Nouveau mot de passe
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    className="input pl-10 pr-10"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary-400 hover:text-secondary-600"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-secondary-500">
                  Minimum 6 caractères
                </p>
              </div>

              {/* Confirmer mot de passe */}
              <div>
                <label htmlFor="confirmPassword" className="label">
                  Confirmer le mot de passe
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="••••••••"
                    className="input pl-10"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {/* Bouton submit */}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Mise à jour...
                  </>
                ) : (
                  'Mettre à jour le mot de passe'
                )}
              </button>
            </form>
          )}

          {/* Retour connexion */}
          <Link
            to="/login"
            className="mt-6 flex items-center justify-center gap-2 text-sm text-secondary-600 hover:text-secondary-800"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
