/**
 * PropositionContratDialog — la proposition de contrat d'entretien d'un client, ouverte depuis
 * la fiche d'un chantier réceptionné : ce qu'elle contient, à qui elle part, et les gestes de
 * la fiche client (voir le PDF, envoyer la proposition, faire signer).
 * ============================================================================
 * Aucun envoi n'est réécrit ici : la fenêtre monte `ContractPdfSection`, seule définition de
 * l'envoi d'une proposition (PDF, e-mail, passage en « Proposition envoyée »).
 * ============================================================================
 */

import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useClient } from '@hooks/useClients';
import { useClientContract } from '@hooks/useContracts';
import { MAINTENANCE_MONTHS } from '@services/contracts.service';
import { ContractPdfSection } from '@/apps/artisan/pages/client-detail/ContractPdfSection';
import { formatEuro } from '@/lib/utils';

function Fait({ libelle, children }) {
  return (
    <div>
      <dt className="text-xs text-secondary-500">{libelle}</dt>
      <dd className="text-sm font-medium text-secondary-900">{children}</dd>
    </div>
  );
}

export function PropositionContratDialog({ clientId, orgId, onClose }) {
  const { client, isLoading: clientEnChargement, error: clientEnErreur } = useClient(clientId);
  const { contract, isLoading: contratEnChargement, error: contratEnErreur } = useClientContract(clientId);
  const enChargement = clientEnChargement || contratEnChargement;
  const enErreur = clientEnErreur || contratEnErreur;
  const mois = MAINTENANCE_MONTHS.find((m) => m.value === contract?.maintenance_month)?.label;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog" aria-modal="true" aria-label="Proposition de contrat d'entretien"
          className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Proposition de contrat{contract?.contract_number ? ` · ${contract.contract_number}` : ''}
            </h2>
            <button
              type="button" onClick={onClose} aria-label="Fermer"
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto px-6 py-5">
            {enChargement && (
              <p className="flex items-center gap-2 text-sm text-secondary-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement de la proposition…
              </p>
            )}

            {!enChargement && enErreur && (
              <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                La proposition n&apos;a pas pu être lue. Fermez et réessayez.
              </p>
            )}

            {!enChargement && !enErreur && (!contract || !client) && (
              <p className="text-sm text-secondary-700">Ce client n&apos;a plus de proposition de contrat.</p>
            )}

            {!enChargement && !enErreur && contract && client && (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Fait libelle="Client">
                    {client.display_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || '—'}
                  </Fait>
                  <Fait libelle="Envoyée à">{client.email || '—'}</Fait>
                  <Fait libelle="Montant annuel">{contract.amount != null ? formatEuro(contract.amount) : '—'}</Fait>
                  <Fait libelle="Mois de maintenance">{mois || '—'}</Fait>
                </dl>

                {!client.email && (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    Ce client n&apos;a pas d&apos;adresse e-mail : la proposition ne peut pas lui être envoyée. Ajoutez-la sur sa fiche.
                  </p>
                )}

                <ContractPdfSection contract={contract} clientId={clientId} client={client} orgId={orgId} />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default PropositionContratDialog;
