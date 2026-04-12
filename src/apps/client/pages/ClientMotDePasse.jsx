/**
 * ClientMotDePasse.jsx - Portail Client
 * ============================================================================
 * Page de changement de mot de passe volontaire (depuis le portail).
 * ============================================================================
 */

import PasswordChangeForm from '../components/PasswordChangeForm';

export default function ClientMotDePasse() {
  return (
    <div className="max-w-md mx-auto mt-8">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Changer mon mot de passe</h1>
      <p className="text-sm text-gray-500 mb-6">
        Choisissez un nouveau mot de passe pour votre espace client.
      </p>

      <PasswordChangeForm />
    </div>
  );
}
