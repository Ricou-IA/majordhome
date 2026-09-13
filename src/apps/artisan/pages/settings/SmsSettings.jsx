// src/apps/artisan/pages/settings/SmsSettings.jsx
// Settings → Communication → SMS & WhatsApp (/settings/sms) : gabarits par
// campagne et rappel automatique des RDV (`settings.sms`). L'onglet vient de
// Organisation → SMS, déplacé le 2026-09-13 (regroupement par module) ; inchangé.
import SettingsPage from './SettingsPage';
import SmsTab from './communication/SmsTab';

export default function SmsSettings() {
  return (
    <SettingsPage
      title="SMS & WhatsApp"
      description="Gabarits de chaque campagne et rappel automatique des rendez-vous d'entretien."
    >
      <SmsTab />
    </SettingsPage>
  );
}
