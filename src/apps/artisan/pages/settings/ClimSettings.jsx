// src/apps/artisan/pages/settings/ClimSettings.jsx
// Settings → Socle → Climatisation (/settings/clim) : règles de dimensionnement (`settings.clim`).
// Défauts et sources : src/lib/clim/config.js.
import SettingsPage from './SettingsPage';
import ClimTab from './clim/ClimTab';

export default function ClimSettings() {
  return (
    <SettingsPage title="Climatisation" description="Règles de dimensionnement : W/m² par isolation, expositions, vitrage, choix des unités, multi-split, liaisons. Les valeurs « provisoires » se corrigent ici, pas dans le code.">
      <ClimTab />
    </SettingsPage>
  );
}
