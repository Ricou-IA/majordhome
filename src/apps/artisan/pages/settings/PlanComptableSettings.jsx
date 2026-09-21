// src/apps/artisan/pages/settings/PlanComptableSettings.jsx
// Settings → Socle → Plan comptable (/settings/plan-comptable) : le plan comptable
// de GESTION — les comptes de vente Pennylane que Majord'home peut utiliser, avec
// alias. Source unique des sélecteurs de compte (Eric, 2026-09-21).
import SettingsPage from './SettingsPage';
import PlanComptableTab from './pennylane/PlanComptableTab';

export default function PlanComptableSettings() {
  return (
    <SettingsPage
      title="Plan comptable"
      description="Les comptes de vente Pennylane que Majord'home a le droit d'utiliser. Pennylane reste la référence : numéros et libellés viennent de là."
    >
      <PlanComptableTab />
    </SettingsPage>
  );
}
