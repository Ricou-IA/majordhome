/**
 * SAVLinkedQuotes.jsx — devis de la carte SAV : liste, création, ouverture (Eric, 2026-11-09 :
 * « que la fiche SAV reprenne la modale de création de devis »).
 *
 * Le devis est créé avec la fenêtre de devis habituelle, fléché vers la carte
 * (`quotes.intervention_id`) et rattaché au client : aucun lead n'est créé, et un devis fléché
 * SAV n'entre jamais dans le pipeline commercial. Un changement de statut du devis (envoi
 * Pennylane, accepté, refusé) est reporté sur la carte par `effetDevisSurCarte` — mêmes règles
 * que les boutons Envoyé / Accepté / Refusé de la fiche.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { FilePlus2, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCanAccess } from '@hooks/usePermissions';
import { useDevisByIntervention } from '@hooks/useDevis';
import { useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { devisService, QUOTE_STATUSES } from '@services/devis.service';
import { KANBAN_COLUMNS } from '@services/sav.service';
import { effetDevisSurCarte, leadDepuisCarteSav } from '@/lib/savDevis';
import { formatEuro, formatDateShortFR } from '@/lib/utils';
import CreateDevisModal from '../devis/CreateDevisModal';
import DevisModal from '../devis/DevisModal';

/**
 * @param {object} props
 * @param {object} props.item carte SAV à jour (ligne de `majordhome_entretien_sav`)
 * @param {boolean} [props.canEdit]
 * @param {() => void} [props.onUpdated] rafraîchir le kanban (montant et statut de la carte)
 * @param {(devisStatus: string) => void} [props.onCardSynced] statut de devis reporté sur la carte
 */
export function SAVLinkedQuotes({ item, canEdit = true, onUpdated, onCardSynced }) {
  const { can } = useCanAccess();
  const { quotes, isLoading } = useDevisByIntervention(item.id);
  const { updateFields, updateWorkflowStatus } = useEntretienSAVMutations();
  const [showCreate, setShowCreate] = useState(false);
  const [openQuoteId, setOpenQuoteId] = useState(null);

  const peutCreer = canEdit && can('devis', 'create');

  // Reporte sur la carte le statut du devis qui vient de changer. Le devis est relu en base :
  // la fenêtre de devis ne dit pas ce qui a changé, et il peut avoir été supprimé.
  const reporterSurCarte = async (quoteId) => {
    const { data: quote, error } = await devisService.getQuoteById(quoteId);
    if (error || !quote) { onUpdated?.(); return; }
    const { devisStatus, workflow } = effetDevisSurCarte(item, quote);
    if (!devisStatus && !workflow) { onUpdated?.(); return; }
    try {
      if (devisStatus) await updateFields(item.id, { devis_status: devisStatus });
      if (workflow) await updateWorkflowStatus(item.id, workflow);
      const colonne = workflow ? KANBAN_COLUMNS.find((c) => c.value === workflow)?.label : null;
      toast.success(colonne ? `Carte SAV passée en « ${colonne} »` : 'Statut du devis reporté sur la carte SAV');
      if (devisStatus) onCardSynced?.(devisStatus);
    } catch {
      // Toast d'erreur déjà émis par la mutation (useEntretienSAVMutations) ; le devis, lui, a bien changé.
    } finally {
      onUpdated?.();
    }
  };

  return (
    <div className="space-y-2">
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement des devis…</div>
      )}

      {quotes.length > 0 && (
        <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          {quotes.map((quote) => {
            const statut = QUOTE_STATUSES.find((s) => s.value === quote.status);
            return (
              <li key={quote.id}>
                <button
                  type="button"
                  onClick={() => setOpenQuoteId(quote.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                  title="Ouvrir le devis"
                >
                  <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 truncate">
                      {quote.quote_number || 'Devis'}
                      {quote.subject ? <span className="font-normal text-gray-500"> · {quote.subject}</span> : null}
                    </span>
                    <span className="block text-xs text-gray-400">
                      {formatDateShortFR(quote.created_at)}
                      {quote.pennylane_quote_id ? ' · envoyé dans Pennylane' : ''}
                    </span>
                  </span>
                  {statut && (
                    <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded border ${statut.color}`}>{statut.label}</span>
                  )}
                  <span className="shrink-0 text-sm font-semibold text-gray-900">{formatEuro(Number(quote.total_ht) || 0)} HT</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {peutCreer && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={!item.client_id}
          title={item.client_id ? 'Créer un devis pour ce SAV' : 'La carte n’est liée à aucun client'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FilePlus2 className="w-4 h-4" />
          {quotes.length > 0 ? 'Créer un autre devis' : 'Créer un devis'}
        </button>
      )}

      {/* Fenêtres de devis rendues hors de la fiche SAV (portail) : son corps défile, et une
          fenêtre plein écran imbriquée dans un conteneur qui défile dépend de ses ancêtres. */}
      {showCreate && createPortal(
        <CreateDevisModal
          lead={leadDepuisCarteSav(item)}
          interventionId={item.id}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            // Brouillon : la carte ne change pas de colonne, seul son montant suit le devis.
            onUpdated?.();
            if (created?.id) setOpenQuoteId(created.id);
          }}
        />,
        document.body,
      )}

      {openQuoteId && createPortal(
        <DevisModal
          quoteId={openQuoteId}
          onClose={() => { setOpenQuoteId(null); onUpdated?.(); }}
          onStatusChange={() => reporterSurCarte(openQuoteId)}
        />,
        document.body,
      )}
    </div>
  );
}

export default SAVLinkedQuotes;
