// Settings → Organisation (/settings/organization) : identité, coordonnées, documents, territoire.
// Les onglets restent montés (masqués) : une saisie survit au changement d'onglet, chacun
// garde sa propre barre d'enregistrement. Onglet actif dans l'URL (?tab=) pour pouvoir y renvoyer.
import { useSearchParams } from 'react-router-dom';
import { Building2, FileCheck2, MapPinned, Phone } from 'lucide-react';
import SettingsPage from './SettingsPage';
import IdentityTab from './organization/IdentityTab';
import ContactTab from './organization/ContactTab';
import DocumentsTab from './organization/DocumentsTab';
import TerritoryTab from './organization/TerritoryTab';

const TABS = [
  { key: 'identity', label: 'Identité', icon: Building2, Component: IdentityTab },
  { key: 'contact', label: 'Coordonnées', icon: Phone, Component: ContactTab },
  { key: 'documents', label: 'Documents', icon: FileCheck2, Component: DocumentsTab },
  { key: 'territory', label: 'Territoire', icon: MapPinned, Component: TerritoryTab },
];

export default function OrganizationSettings() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.some((t) => t.key === requested) ? requested : 'identity';

  return (
    <SettingsPage
      title="Organisation"
      description="Ce que vos clients voient de votre entreprise : identité, coordonnées, qualifications et territoire."
      tabs={TABS}
      tab={tab}
      onTabChange={(key) => setParams(key === 'identity' ? {} : { tab: key }, { replace: true })}
    >
      <div className="max-w-5xl">
        {TABS.map(({ key, Component }) => (
          <div key={key} hidden={key !== tab}>
            <Component />
          </div>
        ))}
      </div>
    </SettingsPage>
  );
}
