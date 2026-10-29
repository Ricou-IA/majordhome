import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import logoMayer from '@/assets/logo-mayer.png';
import { logger } from '@lib/logger';

// =============================================================================
// PAGE LOGIN — Design unifié Mayer Energie
// =============================================================================

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn } = useAuth();
  const isClientLogin = searchParams.get('from') === 'portal';

  // État
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Formulaire
  const [formData, setFormData] = useState({
    email: '',
    password: '',
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
    setLoading(true);

    try {
      const result = await signIn(formData.email, formData.password);

      if (result.error) {
        throw result.error;
      }

      navigate(result.isClient ? '/client' : '/');
    } catch (err) {
      logger.error('[Login] Erreur:', err);
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

    if (message.includes('Invalid login credentials')) {
      return 'Email ou mot de passe incorrect';
    }
    if (message.includes('Email not confirmed')) {
      return 'Veuillez confirmer votre email avant de vous connecter';
    }

    return message;
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    // 100dvh : hauteur réelle du viewport mobile (barre d'adresse comprise), le
    // formulaire tient sur un écran sans défilement. Sur téléphone (< md) la
    // carte devient la page elle-même : pas de panneau de marque, logo compact.
    <div className="min-h-[100dvh] flex items-center justify-center bg-gray-100 px-0 py-0 md:px-4 md:py-12">
      <div className="w-full min-h-[100dvh] md:min-h-0 max-w-4xl bg-white md:rounded-2xl md:shadow-xl overflow-hidden flex flex-col md:flex-row">

        {/* Partie gauche — Branding (bureau et tablette) */}
        <div className="relative hidden md:flex md:w-1/2 bg-gray-50 flex-col items-center justify-center p-12 overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage: `
                linear-gradient(rgba(0,0,0,0.3) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0,0,0,0.3) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
            }}
          />
          <div className="relative z-10 flex flex-col items-center text-center">
            <img
              src={logoMayer}
              alt="Mayer Energie"
              className="w-[260px] h-auto mb-6"
            />
            <p className="text-lg font-semibold text-gray-700">
              Votre confort,
            </p>
            <p className="text-lg font-semibold text-primary-600">
              toute l&apos;année
            </p>
          </div>
        </div>

        {/* Partie droite — Formulaire */}
        <div className="md:w-1/2 flex-1 px-6 py-8 md:p-12 flex flex-col justify-center pb-[max(2rem,env(safe-area-inset-bottom))]">
          {/* Logo compact (téléphone uniquement) */}
          <img
            src={logoMayer}
            alt="Mayer Energie"
            className="md:hidden w-[160px] h-auto mb-8 self-center"
          />

          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1 md:mb-2">
              Bienvenue
            </h1>
            <p className="text-gray-500">
              {isClientLogin
                ? 'Identifiez-vous pour accéder à votre espace client.'
                : 'Connectez-vous à votre espace.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5" noValidate>
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="votre@email.com"
                // text-base (16 px) : sous 16 px, iOS zoome la page au focus et
                // le formulaire sort de l'écran.
                className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base md:text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              />
            </div>

            {/* Mot de passe */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full h-12 px-4 pr-12 border border-gray-300 rounded-lg text-base md:text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  aria-pressed={showPassword}
                  className="absolute right-0 top-0 h-12 w-12 flex items-center justify-center rounded-r-lg text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Mot de passe oublié */}
            <div className="text-right">
              <Link
                to="/forgot-password"
                className="inline-block py-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Mot de passe oublié ?
              </Link>
            </div>

            {/* Erreur */}
            {error && (
              <div role="alert" className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Bouton connexion */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-semibold px-6 rounded-lg transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Connexion en cours...
                </>
              ) : (
                'Se connecter'
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 md:mt-8 text-center">
            <p className="text-sm text-gray-500">
              {isClientLogin ? (
                <>
                  Pas encore de compte ?{' '}
                  <a
                    href="https://www.mayer-energie.fr/contact"
                    className="text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Contactez-nous
                  </a>
                </>
              ) : (
                <>
                  Espace réservé aux collaborateurs Mayer Energie.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
