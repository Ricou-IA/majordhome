import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Mail, Lock, User, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

// =============================================================================
// PAGE LOGIN
// =============================================================================

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const isClientLogin = searchParams.get('from') === 'portal';

  // État
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Formulaire
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    confirmPassword: '',
  });

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        // Connexion
        const result = await signIn(formData.email, formData.password);

        if (result.error) {
          throw result.error;
        }

        navigate(result.isClient ? '/client' : '/');
      } else {
        // Inscription
        if (formData.password !== formData.confirmPassword) {
          throw new Error('Les mots de passe ne correspondent pas');
        }

        if (formData.password.length < 6) {
          throw new Error('Le mot de passe doit contenir au moins 6 caractères');
        }

        const { error } = await signUp(formData.email, formData.password, {
          fullName: formData.fullName,
        });

        if (error) {
          throw error;
        }

        setSuccess(
          'Inscription réussie ! Vérifiez votre email pour confirmer votre compte.'
        );
        setMode('login');
        setFormData((prev) => ({ ...prev, password: '', confirmPassword: '' }));
      }
    } catch (err) {
      console.error('[Login] Erreur:', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) {
      setError(getErrorMessage(error));
    }
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const getErrorMessage = (error) => {
    const message = error?.message || error?.error_description || String(error);

    // Messages d'erreur personnalisés
    if (message.includes('Invalid login credentials')) {
      return 'Email ou mot de passe incorrect';
    }
    if (message.includes('Email not confirmed')) {
      return 'Veuillez confirmer votre email avant de vous connecter';
    }
    if (message.includes('User already registered')) {
      return 'Un compte existe déjà avec cet email';
    }
    if (message.includes('Password should be at least')) {
      return 'Le mot de passe doit contenir au moins 6 caractères';
    }

    return message;
  };

  const toggleMode = () => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
    setError(null);
    setSuccess(null);
    setFormData({
      email: formData.email,
      password: '',
      fullName: '',
      confirmPassword: '',
    });
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-secondary-100 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo / Titre */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-secondary-900">
            Majord'home
          </h1>
          <p className="text-secondary-600 mt-2">
            {mode === 'login' ? 'Connectez-vous à votre espace' : 'Créez votre compte'}
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
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-700">{success}</p>
            </div>
          )}

          {/* Formulaire */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Nom complet (inscription uniquement) */}
            {mode === 'register' && (
              <div>
                <label htmlFor="fullName" className="label">
                  Nom complet
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
                  <input
                    type="text"
                    id="fullName"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleChange}
                    placeholder="Jean Dupont"
                    className="input pl-10"
                    required={mode === 'register'}
                  />
                </div>
              </div>
            )}

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

            {/* Mot de passe */}
            <div>
              <label htmlFor="password" className="label">
                Mot de passe
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
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
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
            </div>

            {/* Confirmation mot de passe (inscription uniquement) */}
            {mode === 'register' && (
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
                    required={mode === 'register'}
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}

            {/* Mot de passe oublié (connexion uniquement) */}
            {mode === 'login' && (
              <div className="text-right">
                <Link
                  to="/forgot-password"
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            )}

            {/* Bouton submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Chargement...
                </>
              ) : mode === 'login' ? (
                'Se connecter'
              ) : (
                "S'inscrire"
              )}
            </button>
          </form>

          {/* Google OAuth — désactivé pour l'instant */}

          {/* Toggle mode */}
          <p className="mt-6 text-center text-sm text-secondary-600">
            {mode === 'login' ? (
              <>
                Pas encore de compte ?{' '}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="font-medium text-primary-600 hover:text-primary-700"
                >
                  S'inscrire
                </button>
              </>
            ) : (
              <>
                Déjà un compte ?{' '}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="font-medium text-primary-600 hover:text-primary-700"
                >
                  Se connecter
                </button>
              </>
            )}
          </p>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-secondary-500">
          © {new Date().getFullYear()} Majord'home. Tous droits réservés.
        </p>
      </div>
    </div>
  );
}
