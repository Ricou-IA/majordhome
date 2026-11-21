// src/apps/artisan/pages/settings/CommunicationSettings.jsx
// Réglages → Communication (/settings/communication) : les e-mails et les SMS de
// l'entreprise au même endroit (Eric 2026-11-21 : « c'est le module Communication »).
// Onglet E-mails : adresse, e-mails automatiques, propre domaine (`EmailsTab`) ;
// onglet SMS & WhatsApp : gabarits et rappel des RDV (`SmsTab`). Les anciennes
// adresses /settings/emails et /settings/sms y renvoient.
import { useSearchParams } from 'react-router-dom';
import { Mail, MessageSquare } from 'lucide-react';
import SettingsPage from './SettingsPage';
import EmailsTab from './communication/EmailsTab';
import SmsTab from './communication/SmsTab';

const TABS = [
  { key: 'emails', label: 'E-mails', icon: Mail },
  { key: 'sms', label: 'SMS & WhatsApp', icon: MessageSquare },
];

export default function CommunicationSettings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'emails';

  return (
    <SettingsPage
      title="E-mails & SMS"
      description="Ce que votre entreprise envoie à ses clients : d'où partent vos e-mails, leurs textes, vos SMS."
      tabs={TABS}
      tab={tab}
      onTabChange={(key) => setParams(key === 'emails' ? {} : { tab: key }, { replace: true })}
    >
      {tab === 'sms' ? <SmsTab /> : <EmailsTab />}
    </SettingsPage>
  );
}
