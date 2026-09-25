// src/apps/maintenance/components/MaintenanceGate.jsx
// Garde du module Maintenance : module activé pour l'org (settings.modules.maintenance,
// opt-in — cf. src/lib/modules.js) + permission `maintenance.<action>`. Sinon retour à
// l'accueil. Pendant le chargement des réglages : loader (pas de redirection prématurée).
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useCanAccess } from '@hooks/usePermissions';
import { moduleActif } from '@/lib/modules';

export default function MaintenanceGate({ action = 'view', children }) {
  const { settings, isLoading } = useOrgSettings();
  const { can, permissionsLoading } = useCanAccess();

  if (isLoading || permissionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }
  if (!moduleActif(settings, 'maintenance') || !can('maintenance', action)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
