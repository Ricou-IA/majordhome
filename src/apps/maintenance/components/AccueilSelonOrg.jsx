// src/apps/maintenance/components/AccueilSelonOrg.jsx
// Route d'accueil `/` : un compte borne (settings.maintenance.kiosk_user_ids) part sur la
// borne ; une org sans CRM (settings.modules.crm === false) sur /maintenance ; sinon le
// tableau de bord habituel (inchangé pour Mayer).
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { crmActif, moduleActif } from '@/lib/modules';

export default function AccueilSelonOrg({ children }) {
  const { user } = useAuth();
  const { settings, isLoading } = useOrgSettings();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }
  if (moduleActif(settings, 'maintenance')) {
    const bornes = settings?.maintenance?.kiosk_user_ids || [];
    if (user?.id && bornes.includes(user.id)) return <Navigate to="/maintenance/borne" replace />;
    if (!crmActif(settings)) return <Navigate to="/maintenance" replace />;
  }
  return children;
}
