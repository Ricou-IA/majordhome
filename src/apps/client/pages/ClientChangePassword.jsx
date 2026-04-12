/**
 * ClientChangePassword.jsx - Portail Client
 * ============================================================================
 * Page de changement de mot de passe obligatoire au premier login.
 * Affichée quand user_metadata.must_change_password === true.
 * ============================================================================
 */

import logoMayer from '@/assets/logo-mayer.png';
import PasswordChangeForm from '../components/PasswordChangeForm';

export default function ClientChangePassword() {
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

        <PasswordChangeForm />
      </div>
    </div>
  );
}
