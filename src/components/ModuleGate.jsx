// src/components/ModuleGate.jsx
// Garde d'un module activable (catalogue src/lib/modules.js) : module fermé pour l'org ⇒
// retour à l'accueil, pour qu'une case décochée dans Baikal ne laisse pas l'URL ouverte.
// `resource` optionnel : contrôle de permission en plus (ex. la borne, hors RouteGuard).
// Pendant le chargement des réglages : loader, jamais de redirection prématurée.
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useCanAccess } from '@hooks/usePermissions';
import { moduleActif } from '@/lib/modules';

export default function ModuleGate({ module, resource, action = 'view', children }) {
  const { settings, isLoading } = useOrgSettings();
  const { can, permissionsLoading } = useCanAccess();

  if (isLoading || (resource && permissionsLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }
  if (!moduleActif(settings, module) || (resource && !can(resource, action))) {
    return <Navigate to="/" replace />;
  }
  return children;
}
