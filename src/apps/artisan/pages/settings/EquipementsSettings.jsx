/**
 * EquipementsSettings.jsx — Settings → Équipements (socle)
 * ============================================================================
 * Le référentiel d'équipements de l'organisation : catégories (niveau 1) →
 * types (niveau 2). C'est ce qui relie un client à son parc, entretien ou pas
 * (socle, décision Eric 2026-09-13). La valorisation de ce parc pour
 * l'entretien — zones, grille, durées — est dans Settings → Tarification.
 * Données : mêmes tables que la tarification (`usePricingAdmin`).
 * ============================================================================
 */
import { useState } from 'react';
import { Layers, Loader2, Wrench } from 'lucide-react';
import { usePricingAdmin } from '@hooks/usePricing';
import SettingsPage from './SettingsPage';
import { CategoriesPanel } from './equipements/CategoriesTab';
import { TypesPanel } from './equipements/TypesTab';

const TABS = [
  { key: 'categories', label: 'Catégories', icon: Layers },
  { key: 'types', label: 'Types d\'équipement', icon: Wrench },
];

export default function EquipementsSettings() {
  const [tab, setTab] = useState('categories');
  const admin = usePricingAdmin();

  return (
    <SettingsPage
      title="Équipements"
      description="Le référentiel de votre parc client : d'abord les catégories, puis les types de chaque catégorie."
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      {!admin.orgId || admin.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        </div>
      ) : (
        <div className="card">
          {tab === 'categories' && <CategoriesPanel admin={admin} />}
          {tab === 'types' && <TypesPanel admin={admin} />}
        </div>
      )}
    </SettingsPage>
  );
}
