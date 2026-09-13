// src/apps/artisan/pages/settings/TourneesSettings.jsx
// Settings → Entretiens & Contrats → Tournées (/settings/tournees) : réglages du
// moteur de tournées (`settings.tournees`). L'onglet vient de Organisation →
// Tournées, déplacé le 2026-09-13 (regroupement par module) ; il est inchangé.
import SettingsPage from './SettingsPage';
import TourneesTab from './entretiens/TourneesTab';

export default function TourneesSettings() {
  return (
    <SettingsPage
      title="Tournées"
      description="Horizons de planification, pause, souplesse des rendez-vous, figeage des journées pleines."
    >
      <TourneesTab />
    </SettingsPage>
  );
}
