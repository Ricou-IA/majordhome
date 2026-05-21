import { Navigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { Lock } from 'lucide-react';

/**
 * Accès à la PWA voice piloté par la permission DB
 * `voice_recorder.use` dans la matrice role_permissions
 * (org_admin bypass, autres rôles configurables via Settings → Permissions).
 *
 * Avant P0.10 : whitelist de 2 UUIDs hardcodés (Eric + Philippe). Pas
 * multi-tenant et bloquant pour onboarding 2ème entreprise.
 */
export default function VoiceAccessGate({ children }) {
  const { user } = useAuth();
  const { can, permissionsLoading } = useCanAccess();

  if (!user) {
    return <Navigate to="/login?from=/voice" replace />;
  }

  if (permissionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-secondary-300">
        Chargement…
      </div>
    );
  }

  if (!can('voice_recorder', 'use')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <Lock className="w-12 h-12 text-orange-400 mb-4" />
        <h1 className="text-2xl font-semibold mb-2">Accès restreint</h1>
        <p className="text-secondary-300 max-w-sm">
          La PWA Compte-rendu vocal n'est pas activée sur ton compte. Demande
          à un administrateur d'activer la permission « Compte-rendu vocal »
          pour ton rôle dans Paramètres → Permissions.
        </p>
      </div>
    );
  }

  return children;
}
