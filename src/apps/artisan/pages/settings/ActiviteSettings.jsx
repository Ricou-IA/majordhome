// Paramètres → Mon activité (/settings/activite) : ce que l'entreprise pose et ce qu'elle entretient, au même endroit.
// Onglet « Métiers » = la grille (src/lib/activite/metiers.js) ; les autres onglets gardent le détail : types de
// projet (ordre, types libres), catégories et types d'équipement (gabarits, TVA). Onglet actif dans l'URL (?tab=),
// pour que les anciennes adresses (/settings/projets, /settings/equipements) y renvoient.
import { useSearchParams } from 'react-router-dom';
import { Grid3x3, Layers, Loader2, ListChecks, Wrench } from 'lucide-react';
import { usePricingAdmin } from '@hooks/usePricing';
import SettingsPage from './SettingsPage';
import MetiersGrid from './activite/MetiersGrid';
import { TypesProjetPanel } from './TypesProjetSettings';
import { CategoriesPanel } from './equipements/CategoriesTab';
import { TypesPanel } from './equipements/TypesTab';

const TABS = [
  { key: 'metiers', label: 'Métiers', icon: Grid3x3 },
  { key: 'projets', label: 'Types de projet', icon: ListChecks },
  { key: 'categories', label: 'Catégories d\'équipement', icon: Layers },
  { key: 'types', label: 'Types d\'équipement', icon: Wrench },
];

export default function ActiviteSettings() {
  const [params, setParams] = useSearchParams();
  const demande = params.get('tab');
  const tab = TABS.some((t) => t.key === demande) ? demande : 'metiers';
  const admin = usePricingAdmin();
  const chargement = !admin.orgId || admin.isLoading;

  return (
    <SettingsPage
      title="Mon activité"
      description="Ce que vous posez et ce que vous entretenez : les types de projet de vos leads et devis, et les équipements de votre parc client."
      tabs={TABS}
      tab={tab}
      onTabChange={(key) => setParams(key === 'metiers' ? {} : { tab: key }, { replace: true })}
    >
      {tab === 'projets' ? <TypesProjetPanel /> : chargement ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-primary-600 animate-spin" /></div>
      ) : (
        <>
          {tab === 'metiers' && <MetiersGrid admin={admin} />}
          {tab === 'categories' && <div className="card"><CategoriesPanel admin={admin} /></div>}
          {tab === 'types' && <div className="card"><TypesPanel admin={admin} /></div>}
        </>
      )}
    </SettingsPage>
  );
}
