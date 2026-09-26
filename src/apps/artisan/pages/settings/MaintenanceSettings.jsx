// src/apps/artisan/pages/settings/MaintenanceSettings.jsx
// Settings → Tâches récurrentes (/settings/maintenance) : vocabulaire, opérateurs et PIN,
// e-mail du soir, compte borne. Module activable (catalogue src/lib/modules.js), ouvert
// depuis Baikal ; titre = vocabulaire de l'org.
import { useState } from 'react';
import { Users, Mail, MonitorPlay, Type } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { vocabulaire } from '@/lib/maintenance/vocabulaire';
import SettingsPage from './SettingsPage';
import OperateursTab from './maintenance/OperateursTab';
import DigestTab from './maintenance/DigestTab';
import BorneTab from './maintenance/BorneTab';
import VocabulaireTab from './maintenance/VocabulaireTab';

const TABS = [
  { key: 'operateurs', label: 'Opérateurs', icon: Users },
  { key: 'digest', label: 'E-mail du soir', icon: Mail },
  { key: 'borne', label: 'Borne', icon: MonitorPlay },
  { key: 'vocabulaire', label: 'Vocabulaire', icon: Type },
];

export default function MaintenanceSettings() {
  const [tab, setTab] = useState('operateurs');
  const { settings } = useOrgSettings();
  return (
    <SettingsPage
      title={vocabulaire(settings).module}
      description="Opérateurs de la borne et codes PIN, e-mail du soir, compte de la borne d'atelier, vocabulaire du module."
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      {tab === 'operateurs' && <OperateursTab />}
      {tab === 'digest' && <DigestTab />}
      {tab === 'borne' && <BorneTab />}
      {tab === 'vocabulaire' && <VocabulaireTab />}
    </SettingsPage>
  );
}
