// src/apps/artisan/pages/settings/WebshopSettings.jsx
// Settings → Socle → Webshop (/settings/webshop) : réglages de la boutique en ligne.
// Réglages scalaires = `settings.webshop` (défauts : src/lib/webshop/reglages.js, objet COMPLET
// sauvé à chaque onglet) ; listes (secteurs, codes postaux, tarifs colis, points de retrait) =
// tables webshop écrites par RPC (20261017_2).
import { useState } from 'react';
import { Globe, MapPinned, Package, Truck } from 'lucide-react';
import SettingsPage from './SettingsPage';
import GeneralTab from './webshop/GeneralTab';
import PaletteTab from './webshop/PaletteTab';
import SecteursTab from './webshop/SecteursTab';
import ColisTab from './webshop/ColisTab';

const TABS = [
  { key: 'general', label: 'Général', icon: Globe },
  { key: 'palette', label: 'Livraison palette', icon: Truck },
  { key: 'secteurs', label: 'Secteurs', icon: MapPinned },
  { key: 'colis', label: 'Colis', icon: Package },
];

export default function WebshopSettings() {
  const [tab, setTab] = useState('general');
  return (
    <SettingsPage
      title="Webshop"
      description="Livraison palette, secteurs, colis et adresses de la boutique en ligne."
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      {tab === 'general' && <GeneralTab />}
      {tab === 'palette' && <PaletteTab />}
      {tab === 'secteurs' && <SecteursTab />}
      {tab === 'colis' && <ColisTab />}
    </SettingsPage>
  );
}
