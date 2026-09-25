// src/apps/maintenance/pages/Maintenance.jsx
// ============================================================================
// Module Maintenance — côté responsable (/maintenance) : Suivi (défaut), Historique,
// Unités & tâches (org_admin). La borne d'atelier vit sur /maintenance/borne.
// Spec : docs/superpowers/specs/2026-09-25-module-maintenance-taches-recurrentes-design.md § 6.
// ============================================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, History, Boxes, MonitorPlay } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import SuiviTab from '../components/SuiviTab';
import HistoriqueTab from '../components/HistoriqueTab';
import UnitesTab from '../components/UnitesTab';

export default function Maintenance() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { can } = useCanAccess();
  const peutEditer = can('maintenance', 'edit');
  const [onglet, setOnglet] = useState('suivi');

  const onglets = [
    { key: 'suivi', label: 'Suivi', icon: Activity },
    { key: 'historique', label: 'Historique', icon: History },
    ...(peutEditer ? [{ key: 'unites', label: 'Unités & tâches', icon: Boxes }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Maintenance</h1>
          <p className="text-secondary-600">Tâches récurrentes des unités, suivi et traçabilité.</p>
        </div>
        <Link
          to="/maintenance/borne"
          className="inline-flex items-center gap-2 rounded-lg bg-secondary-900 px-4 py-2 text-sm font-medium text-white hover:bg-secondary-800"
        >
          <MonitorPlay className="w-4 h-4" /> Ouvrir la borne
        </Link>
      </div>

      <div className="flex border-b border-secondary-200 overflow-x-auto">
        {onglets.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setOnglet(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 whitespace-nowrap ${
              onglet === t.key
                ? 'border-primary-500 text-primary-700'
                : 'border-transparent text-secondary-500 hover:text-secondary-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {onglet === 'suivi' && <SuiviTab orgId={orgId} />}
      {onglet === 'historique' && <HistoriqueTab orgId={orgId} />}
      {onglet === 'unites' && peutEditer && <UnitesTab orgId={orgId} />}
    </div>
  );
}
