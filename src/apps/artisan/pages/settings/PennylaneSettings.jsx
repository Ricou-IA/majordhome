// src/apps/artisan/pages/settings/PennylaneSettings.jsx
// Settings → Socle → Facturation Pennylane (/settings/pennylane) : activation de
// l'intégration (le toggle `settings.pennylane.enabled` n'avait aucune UI), échéance
// et mode (brouillon / finalisée) des factures créées depuis les cartes entretien
// (spec 2026-09-21-facturation-entretien-pennylane-push-design.md).
import SettingsPage from './SettingsPage';
import FacturationTab from './pennylane/FacturationTab';

export default function PennylaneSettings() {
  return (
    <SettingsPage
      title="Facturation Pennylane"
      description="Le lien avec votre compte Pennylane, et la façon dont les factures d'entretien y sont créées depuis les cartes."
    >
      <FacturationTab />
    </SettingsPage>
  );
}
