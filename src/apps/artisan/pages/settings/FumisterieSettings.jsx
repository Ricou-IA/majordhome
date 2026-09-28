// src/apps/artisan/pages/settings/FumisterieSettings.jsx
// Settings → Entretiens & Contrats → Fumisterie (/settings/fumisterie) : réglages du
// métré de conduits (`settings.fumisterie`). Défauts et sémantique : src/lib/fumisterie/config.js.
import SettingsPage from './SettingsPage';
import FumisterieTab from './entretiens/FumisterieTab';

export default function FumisterieSettings() {
  return (
    <SettingsPage title="Fumisterie" description="Réglages du métré de conduits : finition proposée, éléments disponibles, fixations, règle de zone 1. Les quantités « provisoires » se corrigent ici, pas dans le code.">
      <FumisterieTab />
    </SettingsPage>
  );
}
