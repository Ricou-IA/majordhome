/**
 * TabDevisFactures.jsx — onglet « Devis et factures » de la fiche client (refonte UI
 * phase 3, tâche 6 ; brief UX P1-21 le 2026-11-24).
 * - Les devis faits dans Majord'home pour ce client s'affichent toujours (useDevisByClient),
 *   qu'il ait ou non une fiche Pennylane, à qui a le droit de voir les devis ; un clic les ouvre (DevisModal).
 * - Devis et factures Pennylane (`TabDevisPL`, `TabFacturesPL`) seulement si le client a un
 *   code comptable Pennylane ; sinon une phrase courte : « Pas encore de fiche dans Pennylane ».
 * - Chargement : lignes grises, jamais un message seul.
 */

import { useState } from 'react';
import { AlertTriangle, Receipt } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { LignesSquelette } from '@/components/ui/squelette';
import { useDevisByClient } from '@hooks/useDevis';
import { useCanAccess } from '@hooks/usePermissions';
import { statutDevis } from '@/lib/devisListe';
import { formatEuro, formatDateShortFR } from '@/lib/utils';
import DevisModal from '@apps/artisan/components/devis/DevisModal';
import { TabDevisPL } from './TabDevisPL';
import { TabFacturesPL } from './TabFacturesPL';

const Section = ({ title, children }) => (
  <Card as="section">
    <CardHeader title={title} />
    <div className="px-5 pb-5">{children}</div>
  </Card>
);

/** Devis faits dans Majord'home pour ce client. */
function DevisMajordhome({ clientId }) {
  const { quotes, isLoading, error } = useDevisByClient(clientId);
  const [ouvert, setOuvert] = useState(null);

  if (isLoading) return <LignesSquelette nombre={2} libelle="Chargement des devis" className="py-2" />;
  if (error) {
    return (
      <p className="flex items-start gap-2 text-sm text-st-alerte">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Les devis n&apos;ont pas pu être lus.
      </p>
    );
  }
  if (quotes.length === 0) return <p className="text-sm text-secondary-500">Aucun devis fait dans Majord&apos;home pour ce client.</p>;

  return (
    <>
      <ul className="divide-y divide-secondary-100">
        {quotes.map((q) => {
          const s = statutDevis(q.status);
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setOuvert(q)}
                className="flex w-full items-center gap-3 py-3 text-left hover:bg-secondary-50 focus-visible:bg-secondary-50 focus-visible:outline-none"
              >
                <span className="w-28 shrink-0 text-sm font-medium text-secondary-900">{q.quote_number || '—'}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-secondary-700">{q.subject || 'Sans objet'}</span>
                <span className="shrink-0 text-sm tabular-nums text-secondary-900">{Number(q.total_ht) > 0 ? formatEuro(q.total_ht) : '—'}</span>
                <StatusPill tone={s.ton} taille="compacte">{s.label}</StatusPill>
                <span className="hidden w-24 shrink-0 text-right text-xs text-secondary-500 sm:block">{formatDateShortFR(q.created_at)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {ouvert && (
        <DevisModal quoteId={ouvert.id} leadId={ouvert.lead_id || null} onClose={() => setOuvert(null)} onStatusChange={() => {}} />
      )}
    </>
  );
}

/**
 * @param {object} props
 * @param {object} props.client
 * @param {string} props.clientId
 * @param {string} props.orgId
 */
export function TabDevisFactures({ client, clientId, orgId }) {
  const aUneFichePennylane = !!client.pennylane_account_number;
  // Sans le droit de voir les devis, la base ne rend rien : on ne dirait pas « aucun devis » à tort.
  const { can } = useCanAccess();
  return (
    <div className="space-y-6">
      {can('devis', 'view') && <Section title="Devis Majord’home"><DevisMajordhome clientId={clientId} /></Section>}
      {aUneFichePennylane ? (
        <>
          <Section title="Devis Pennylane"><TabDevisPL clientId={clientId} orgId={orgId} /></Section>
          <Section title="Factures"><TabFacturesPL clientId={clientId} orgId={orgId} /></Section>
        </>
      ) : (
        <Card className="flex items-center gap-3 px-5 py-4">
          <Receipt className="h-5 w-5 shrink-0 text-secondary-400" aria-hidden="true" />
          <p className="text-sm text-secondary-600">Pas encore de fiche dans Pennylane : ni devis ni factures Pennylane à afficher.</p>
        </Card>
      )}
    </div>
  );
}

export default TabDevisFactures;
