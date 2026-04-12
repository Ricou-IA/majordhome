/**
 * ClientChangePassword.jsx - Portail Client
 * ============================================================================
 * Page de changement de mot de passe obligatoire au premier login.
 * Affichée quand user_metadata.must_change_password === true.
 * ============================================================================
 */

import { useState } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { Lock, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import logoMayer from '@/assets/logo-mayer.png';

export default function ClientChangePassword() {
  const { user, updatePassword, refreshUserData } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (password.length < 6) {
      toast.error('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }

    setLoading(true);
    try {
      const { error } = await updatePassword(password);
      if (error) throw error;

      // Retirer le flag must_change_password
      const { supabase } = await import('@lib/supabaseClient');
      await supabase.auth.updateUser({
        data: { must_change_password: false },
      });

      toast.success('Mot de passe mis à jour !');

      // Recharger pour que le flag soit à jour
      await refreshUserData();
    } catch (err) {
      console.error('[ChangePassword] error:', err);
      toast.error(err?.message || 'Erreur lors du changement de mot de passe');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src={logoMayer} alt="Mayer Energie" className="h-20 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">
            Bienvenue sur votre espace client
          </h1>
          <p className="mt-2 text-gray-500">
            Pour sécuriser votre compte, veuillez choisir un nouveau mot de passe.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nouveau mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Minimum 6 caractères"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Confirmer le mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Retapez votre mot de passe"
                required
                minLength={6}
              />
              {confirmPassword && password === confirmPassword && (
                <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !password || !confirmPassword}
            className="w-full py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? 'Mise à jour...' : 'Valider mon nouveau mot de passe'}
          </button>
        </form>
      </div>
    </div>
  );
}
