// src/apps/artisan/pages/settings/TelephonieSettings.jsx
// Settings → Communication → Agent téléphonique (/settings/telephonie) : relie l'agent
// vocal ElevenLabs à l'organisation (`settings.telephonie`). Créé le 2026-10-04 avec
// l'outil verifier_client (spec 2026-10-04-agent-telephonique-verifier-client-design.md).
import SettingsPage from './SettingsPage';
import TelephonieTab from './communication/TelephonieTab';

export default function TelephonieSettings() {
  return (
    <SettingsPage
      title="Agent téléphonique"
      description="L'assistante vocale qui décroche les appels non répondus et hors horaires."
    >
      <TelephonieTab />
    </SettingsPage>
  );
}
