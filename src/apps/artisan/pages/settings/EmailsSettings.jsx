// src/apps/artisan/pages/settings/EmailsSettings.jsx
// Settings → Communication → Emails (/settings/emails) : expéditeur, adresse de
// réponse et domaine d'envoi (Resend). Champs sortis de Organisation →
// Coordonnées le 2026-09-13 (regroupement par module).
import SettingsPage from './SettingsPage';
import EmailsTab from './communication/EmailsTab';

export default function EmailsSettings() {
  return (
    <SettingsPage
      title="Emails"
      description="L'adresse qui signe vos emails, celle qui reçoit les réponses, et le domaine d'envoi vérifié."
    >
      <EmailsTab />
    </SettingsPage>
  );
}
