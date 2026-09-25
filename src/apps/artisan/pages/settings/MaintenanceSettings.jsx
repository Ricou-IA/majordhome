// src/apps/artisan/pages/settings/MaintenanceSettings.jsx
// Settings → Maintenance (/settings/maintenance) : opérateurs et PIN, e-mail du soir,
// compte borne. Module opt-in (settings.modules.maintenance) — cf. src/lib/modules.js.
import { useState } from 'react';
import { Users, Mail, MonitorPlay } from 'lucide-react';
import SettingsPage from './SettingsPage';
import OperateursTab from './maintenance/OperateursTab';
import DigestTab from './maintenance/DigestTab';
import BorneTab from './maintenance/BorneTab';

const TABS = [
  { key: 'operateurs', label: 'Opérateurs', icon: Users },
  { key: 'digest', label: 'E-mail du soir', icon: Mail },
  { key: 'borne', label: 'Borne', icon: MonitorPlay },
];

export default function MaintenanceSettings() {
  const [tab, setTab] = useState('operateurs');
  return (
    <SettingsPage
      title="Maintenance"
      description="Opérateurs de la borne et codes PIN, e-mail du soir, compte de la borne d'atelier."
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      {tab === 'operateurs' && <OperateursTab />}
      {tab === 'digest' && <DigestTab />}
      {tab === 'borne' && <BorneTab />}
    </SettingsPage>
  );
}
