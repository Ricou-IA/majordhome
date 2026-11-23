/**
 * TabEchanges.jsx — onglet Échanges de la fiche client (refonte UI phase 3, tâche 6).
 * Regroupe, dans l'ordre, les anciens onglets Timeline, Mailings et SMS, chacun sous
 * son titre. Contenus inchangés : `TabTimeline`, `TabMailings`, `TabSms`.
 */

import { Card, CardHeader } from '@/components/ui/card';
import { TabTimeline } from './TabTimeline';
import { TabMailings } from './TabMailings';
import { TabSms } from './TabSms';

const Section = ({ title, children }) => (
  <Card as="section">
    <CardHeader title={title} />
    <div className="px-5 pb-5">{children}</div>
  </Card>
);

/**
 * @param {object} props
 * @param {string} props.clientId
 * @param {string|null} props.projectId
 */
export function TabEchanges({ clientId, projectId }) {
  return (
    <div className="space-y-6">
      <Section title="Historique"><TabTimeline clientId={clientId} projectId={projectId} /></Section>
      <Section title="E-mails"><TabMailings clientId={clientId} /></Section>
      <Section title="SMS"><TabSms clientId={clientId} /></Section>
    </div>
  );
}

export default TabEchanges;
