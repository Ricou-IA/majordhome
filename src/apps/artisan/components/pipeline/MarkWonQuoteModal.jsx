/**
 * MarkWonQuoteModal.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Pivot "Gagné" du bridge Pipeline ↔ Pennylane (spec §9).
 *
 * Le commercial choisit quel devis attaché a été signé (parmi les variantes
 * proposées au client). Le devis sélectionné devient canonique
 * (`is_winning_quote=true`), les autres restent attachés en mémoire pour
 * la traçabilité historique.
 *
 * Si 1 seul devis attaché : pré-sélectionné automatiquement, un clic Confirmer
 * suffit. Pas de skip silencieux (traçabilité obligatoire, cf spec §11).
 *
 * Si 0 devis attaché : la modale ne devrait pas s'ouvrir (LeadModal toast
 * en amont "Rattache d'abord un devis"). Garde-fou défensif quand même.
 *
 * Effets de bord post-RPC :
 *   - Bascule lead → Gagné côté DB (RPC PR 3)
 *   - Lock fiche technique terrain (fire-and-forget côté front, parité avec
 *     leads.service.js:updateLeadStatus)
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Loader2, Trophy, Info, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  useLinkedPennylaneQuotes,
  useMarkLeadWonWithQuote,
} from '@hooks/usePennylane';
import { technicalVisitService } from '@services/technicalVisit.service';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

// Même palette deutan-friendly que QuoteCandidatesModal
const QUOTE_STATUS_CONFIG = {
  accepted: { label: 'Accepté', color: '#1d4ed8', bgColor: '#dbeafe' },
  pending: { label: 'En attente', color: '#b45309', bgColor: '#fef3c7' },
  draft: { label: 'Brouillon', color: '#6b7280', bgColor: '#f3f4f6' },
  denied: { label: 'Refusé', color: '#4b5563', bgColor: '#e5e7eb' },
  refused: { label: 'Refusé', color: '#4b5563', bgColor: '#e5e7eb' },
  expired: { label: 'Expiré', color: '#4b5563', bgColor: '#e5e7eb' },
};

function getQuoteStatusConfig(status) {
  return QUOTE_STATUS_CONFIG[status] || {
    label: status || 'Inconnu',
    color: '#6b7280',
    bgColor: '#f3f4f6',
  };
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {Function} props.onClose
 * @param {string} props.leadId
 * @param {string} props.orgId
 * @param {string} [props.userId] - Pour le lock fiche technique fire-and-forget
 * @param {Function} [props.onBeforeMark] - callback async appelé avant la RPC
 *   (sauve form LeadModal + syncClientFields). Si throw → annule.
 * @param {Function} [props.onMarked] - callback après mark won réussi
 */
export function MarkWonQuoteModal({
  isOpen,
  onClose,
  leadId,
  orgId,
  userId,
  onBeforeMark,
  onMarked,
}) {
  const [selectedQuotePlId, setSelectedQuotePlId] = useState(null);

  const { linkedQuotes, isLoading } = useLinkedPennylaneQuotes(leadId);
  const { markWon, isMarking } = useMarkLeadWonWithQuote(orgId, leadId);

  // Tri stable : accepté en haut, puis date desc
  const sortedQuotes = useMemo(() => {
    const list = linkedQuotes || [];
    const order = { accepted: 0, pending: 1, draft: 2, denied: 3, refused: 3, expired: 4 };
    return [...list].sort((a, b) => {
      const oa = order[a.quote_status] ?? 99;
      const ob = order[b.quote_status] ?? 99;
      if (oa !== ob) return oa - ob;
      return (b.quote_date || '').localeCompare(a.quote_date || '');
    });
  }, [linkedQuotes]);

  // Pré-sélection si 1 seul devis (cf spec §11 — pas de skip silencieux,
  // mais on facilite le clic unique). Reset à la fermeture.
  useEffect(() => {
    if (!isOpen) {
      setSelectedQuotePlId(null);
      return;
    }
    if (sortedQuotes.length === 1) {
      setSelectedQuotePlId(sortedQuotes[0].pennylane_quote_id);
    }
  }, [isOpen, sortedQuotes]);

  const handleClose = useCallback(() => {
    if (isMarking) return;
    onClose();
  }, [isMarking, onClose]);

  const handleConfirm = useCallback(async () => {
    if (!selectedQuotePlId) return;

    try {
      if (onBeforeMark) await onBeforeMark();
    } catch (err) {
      console.error('[MarkWonQuoteModal] onBeforeMark failed:', err);
      toast.error('Erreur en sauvegardant le lead avant bascule');
      return;
    }

    try {
      const result = await markWon(selectedQuotePlId);

      // Fire-and-forget : lock fiche technique terrain (parité avec le flow
      // MDH classique dans leads.service.js:updateLeadStatus). Erreur loggée
      // mais n'interrompt pas le flow.
      if (userId) {
        technicalVisitService.getByLeadId(leadId).then(({ data: visit }) => {
          if (visit?.id) {
            technicalVisitService.lock(visit.id, userId).catch((e) =>
              console.error('[MarkWonQuoteModal] lock technical visit error:', e)
            );
          }
        }).catch(() => { /* silencieux : pas de fiche technique = pas de lock */ });
      }

      const label = result?.winning_quote_label || `#${selectedQuotePlId}`;
      const statusMsg = result?.lead_status_changed
        ? ` — lead passé en « Gagné » (devis ${label})`
        : ` — devis canonique mis à jour (${label})`;
      toast.success(`Devis signé enregistré${statusMsg}`);
      onMarked?.(result);
      handleClose();
    } catch (err) {
      console.error('[MarkWonQuoteModal] markWon error:', err);
      toast.error(err?.message || 'Erreur lors de la bascule en Gagné');
    }
  }, [
    selectedQuotePlId, onBeforeMark, markWon, userId, leadId,
    onMarked, handleClose,
  ]);

  if (!isOpen) return null;

  const isEmpty = !isLoading && sortedQuotes.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-8 pb-8">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-4rem)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Marquer comme « Gagné »
              </h2>
              <p className="text-xs text-gray-500">
                Quel devis Pennylane a été signé ?
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isMarking}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : isEmpty ? (
            <div className="text-center py-6 text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="font-medium">Aucun devis Pennylane attaché à ce lead.</p>
              <p className="text-xs text-gray-500 mt-2">
                Rattache d&apos;abord un devis via le statut « Devis envoyé ».
              </p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-gray-100">
                {sortedQuotes.map((q) => {
                  const cfg = getQuoteStatusConfig(q.quote_status);
                  const isChecked = selectedQuotePlId === q.pennylane_quote_id;
                  return (
                    <li key={q.id} className="py-3">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="winning_quote"
                          checked={isChecked}
                          onChange={() => setSelectedQuotePlId(q.pennylane_quote_id)}
                          disabled={isMarking}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 text-sm">
                              {q.quote_label || `#${q.pennylane_quote_id}`}
                            </span>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ color: cfg.color, backgroundColor: cfg.bgColor }}
                            >
                              {cfg.label}
                            </span>
                          </div>
                          {q.quote_date && (
                            <div className="text-xs text-gray-500 mt-1">
                              {formatDateShortFR(q.quote_date)}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold text-gray-900">
                            {q.quote_amount_ht != null
                              ? formatEuro(Number(q.quote_amount_ht))
                              : '—'}
                          </div>
                          {q.pdf_url ? (
                            <a
                              href={q.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 mt-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              PDF
                            </a>
                          ) : (
                            <span
                              className="text-xs text-gray-300 inline-flex items-center gap-1 mt-1 cursor-not-allowed"
                              title="PDF non encore synchronisé"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="w-3 h-3" />
                              PDF
                            </span>
                          )}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>

              {sortedQuotes.length > 1 && (
                <div className="mt-4 flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Les autres devis restent attachés au lead pour référence
                    historique. Le devis sélectionné devient canonique.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button
            type="button"
            onClick={handleClose}
            disabled={isMarking}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedQuotePlId || isMarking || isEmpty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isMarking ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Bascule…
              </>
            ) : (
              <>
                <Trophy className="w-3.5 h-3.5" />
                Confirmer Gagné
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MarkWonQuoteModal;
