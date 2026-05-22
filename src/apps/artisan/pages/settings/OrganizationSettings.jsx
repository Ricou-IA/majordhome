import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Building2, Phone, MapPinned, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import IdentityTab from './organization/IdentityTab';
import ContactTab from './organization/ContactTab';
import TerritoryTab from './organization/TerritoryTab';

const TABS = [
  { key: 'identity', label: 'Identité', icon: Building2, Component: IdentityTab },
  { key: 'contact', label: 'Coordonnées', icon: Phone, Component: ContactTab },
  { key: 'territory', label: 'Territoire', icon: MapPinned, Component: TerritoryTab },
];

export default function OrganizationSettings() {
  const { isOrgAdmin } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('identity');

  // Garde org_admin (en complément du RouteGuard côté routes.jsx)
  if (!isOrgAdmin) {
    toast.error("Accès réservé à l'administrateur de l'organisation");
    navigate('/settings');
    return null;
  }

  const ActiveComponent = TABS.find((t) => t.key === activeTab)?.Component;

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-1 text-sm text-secondary-500 hover:text-secondary-700 mb-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Paramètres
        </button>
        <h1 className="text-2xl font-bold text-secondary-900">Organisation</h1>
        <p className="text-secondary-600">
          Configure l'identité, les coordonnées et le territoire de ton entreprise.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar gauche */}
        <nav className="w-56 flex-shrink-0 space-y-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-secondary-600 hover:bg-secondary-50'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          {ActiveComponent && <ActiveComponent />}
        </div>
      </div>
    </div>
  );
}
