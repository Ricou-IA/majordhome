import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { User, Mail, Phone, Camera, Loader2, CheckCircle, AlertCircle, Calendar, Link2, Unlink, RefreshCw } from 'lucide-react';
import { useGoogleCalendarStatus, useGoogleCalendarConnection } from '@hooks/useGoogleCalendar';
import { toast } from 'sonner';

// =============================================================================
// GOOGLE CALENDAR SECTION
// =============================================================================

function GoogleCalendarSection() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const [searchParams, setSearchParams] = useSearchParams();
  const { isConnected, googleEmail, isLoading, refetch } = useGoogleCalendarStatus(orgId);
  const { connect, disconnect, isConnecting, isDisconnecting } = useGoogleCalendarConnection(orgId);

  // Handle OAuth redirect back from Google → ?gcal=success or ?gcal=error
  useEffect(() => {
    const gcalResult = searchParams.get('gcal');
    if (!gcalResult) return;

    if (gcalResult === 'success') {
      const email = searchParams.get('gcal_email') || '';
      toast.success(email ? `Google Calendar connecté (${email})` : 'Google Calendar connecté');
      refetch();
    } else if (gcalResult === 'error') {
      const errorDetail = searchParams.get('gcal_error') || 'Erreur inconnue';
      toast.error(`Connexion Google échouée : ${errorDetail}`);
    }

    // Clean URL params
    searchParams.delete('gcal');
    searchParams.delete('gcal_email');
    searchParams.delete('gcal_error');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, refetch]);

  const handleConnect = async () => {
    try {
      await connect();
      refetch();
    } catch (err) {
      toast.error(err.message || 'Erreur de connexion Google');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      toast.success('Google Calendar déconnecté');
    } catch (err) {
      toast.error(err.message || 'Erreur de déconnexion');
    }
  };

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
          <Calendar className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">
            Google Calendar
          </h2>
          <p className="text-sm text-secondary-500">
            Synchronisez vos RDV avec votre calendrier Google
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-secondary-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Vérification...
        </div>
      ) : isConnected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-800">Connecté</p>
              <p className="text-sm text-green-600 truncate">{googleEmail}</p>
            </div>
            <button
              onClick={() => refetch()}
              className="p-1.5 text-green-600 hover:bg-green-100 rounded"
              title="Vérifier la connexion"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-secondary-500">
            Les nouveaux RDV et modifications sont automatiquement synchronisés vers votre Google Calendar.
          </p>
          <button
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="btn-secondary text-sm"
          >
            {isDisconnecting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Déconnexion...</>
            ) : (
              <><Unlink className="w-4 h-4" /> Déconnecter Google Calendar</>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-secondary-600">
            Connectez votre compte Google pour voir vos RDV Majord'home directement dans Google Calendar.
            Idéal pour consulter votre planning sur mobile sans ouvrir l'application.
          </p>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="btn-primary text-sm"
          >
            {isConnecting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Connexion en cours...</>
            ) : (
              <><Link2 className="w-4 h-4" /> Connecter Google Calendar</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PAGE PROFILE
// =============================================================================

export default function Profile() {
  const { user, profile, updateProfile } = useAuth();

  // État
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  // Formulaire
  const [formData, setFormData] = useState({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
  });

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setSuccess(false);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    setError(null);

    try {
      const { error } = await updateProfile(formData);

      if (error) {
        throw error;
      }

      setSuccess(true);
    } catch (err) {
      console.error('[Profile] Erreur:', err);
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">Mon profil</h1>
        <p className="text-secondary-600">
          Gérez vos informations personnelles
        </p>
      </div>

      {/* Avatar */}
      <div className="card">
        <div className="flex items-center gap-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-primary-600 flex items-center justify-center">
              <span className="text-2xl font-semibold text-white">
                {formData.full_name
                  ? formData.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
                  : 'U'}
              </span>
            </div>
            <button className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white border border-secondary-200 shadow-sm flex items-center justify-center hover:bg-secondary-50">
              <Camera className="w-4 h-4 text-secondary-600" />
            </button>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">
              {formData.full_name || 'Utilisateur'}
            </h2>
            <p className="text-secondary-600">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Formulaire */}
      <div className="card">
        <h2 className="text-lg font-semibold text-secondary-900 mb-6">
          Informations personnelles
        </h2>

        {/* Messages */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <p className="text-sm text-green-700">Profil mis à jour avec succès</p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email (lecture seule) */}
          <div>
            <label className="label">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="input pl-10 bg-secondary-50 cursor-not-allowed"
              />
            </div>
            <p className="mt-1 text-xs text-secondary-500">
              L'email ne peut pas être modifié
            </p>
          </div>

          {/* Nom complet */}
          <div>
            <label htmlFor="full_name" className="label">
              Nom complet
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
              <input
                type="text"
                id="full_name"
                name="full_name"
                value={formData.full_name}
                onChange={handleChange}
                placeholder="Jean Dupont"
                className="input pl-10"
              />
            </div>
          </div>

          {/* Téléphone */}
          <div>
            <label htmlFor="phone" className="label">
              Téléphone
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="06 12 34 56 78"
                className="input pl-10"
              />
            </div>
          </div>

          {/* Bouton submit */}
          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                'Enregistrer les modifications'
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Google Calendar */}
      <GoogleCalendarSection />

      {/* Sécurité */}
      <div className="card">
        <h2 className="text-lg font-semibold text-secondary-900 mb-4">
          Sécurité
        </h2>
        <p className="text-secondary-600 mb-4">
          Modifiez votre mot de passe pour sécuriser votre compte.
        </p>
        <button className="btn-secondary">
          Changer le mot de passe
        </button>
      </div>
    </div>
  );
}
