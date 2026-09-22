// src/apps/artisan/pages/settings/PennylaneSettings.jsx
// Settings → Socle → Facturation (/settings/pennylane) : deux onglets.
//  - Émission : ce que Majord'home met sur les factures qu'il émet (préfixe, IBAN,
//    mentions) — hub de facturation phase 1 (spec 2026-09-22).
//  - Pennylane : activation de l'intégration, mode de création des factures
//    d'entretien (brouillon / finalisée / émise par Majord'home), comptes de vente.
import { useState } from 'react';
import { FileText, Receipt } from 'lucide-react';
import SettingsPage from './SettingsPage';
import EmissionTab from './pennylane/EmissionTab';
import FacturationTab from './pennylane/FacturationTab';

const TABS = [
  { key: 'emission', label: 'Émission', icon: FileText, Component: EmissionTab },
  { key: 'pennylane', label: 'Pennylane', icon: Receipt, Component: FacturationTab },
];

export default function PennylaneSettings() {
  const [tab, setTab] = useState('emission');
  const Active = TABS.find((t) => t.key === tab)?.Component || EmissionTab;
  return (
    <SettingsPage
      title="Facturation"
      description="Les factures émises par Majord'home (numérotation, mentions, coordonnées bancaires) et le lien avec Pennylane."
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      <Active />
    </SettingsPage>
  );
}
