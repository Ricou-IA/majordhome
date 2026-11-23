/**
 * TabDevisFactures.jsx — onglet « Devis et factures » de la fiche client (refonte UI
 * phase 3, tâche 6). Regroupe les anciens onglets Devis et Factures (Pennylane), sous
 * la même condition qu'avant : le client a un code comptable Pennylane. Contenus
 * inchangés : `TabDevisPL`, `TabFacturesPL`.
 */

import { Receipt } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { TabDevisPL } from './TabDevisPL';
import { TabFacturesPL } from './TabFacturesPL';

const Section = ({ title, children }) => (
  <Card as="section">
    <CardHeader title={title} />
    <div className="px-5 pb-5">{children}</div>
  </Card>
);

/**
 * @param {object} props
 * @param {object} props.client
 * @param {string} props.clientId
 * @param {string} props.orgId
 */
export function TabDevisFactures({ client, clientId, orgId }) {
  if (!client.pennylane_account_number) {
    return (
      <Card className="flex flex-col items-center justify-center px-5 py-16 text-center">
        <Receipt className="mb-3 h-10 w-10 text-secondary-300" aria-hidden="true" />
        <p className="text-sm font-medium text-secondary-600">Client non synchronisé avec Pennylane</p>
        <p className="mt-1 text-xs text-secondary-400">Ce client n&apos;a pas encore de code comptable Pennylane</p>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <Section title="Devis"><TabDevisPL clientId={clientId} orgId={orgId} /></Section>
      <Section title="Factures"><TabFacturesPL clientId={clientId} orgId={orgId} /></Section>
    </div>
  );
}

export default TabDevisFactures;
