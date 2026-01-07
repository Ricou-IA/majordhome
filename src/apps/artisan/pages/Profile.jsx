import { useState } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { User, Mail, Phone, Camera, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

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
