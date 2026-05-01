/**
 * LinkPennylaneQuoteModal.jsx — Majord'home Artisan
 * ============================================================================
 * Sélecteur de devis Pennylane pour lier un chantier (lead) à un devis.
 *
 * Affiche la liste des devis Pennylane du client (via usePennylaneQuotes),
 * triée par statut (accepted en haut) puis date desc. Click → UPDATE
 * leads.pennylane_quote_id via la RPC update_majordhome_lead.
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { X, ExternalLink, FileText, Loader2, CheckCircle2, Link2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { usePennylaneQuotes } from '@hooks/usePennylane';
import { leadsService } from '@services/leads.service';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

// ============================================================================
// Statuts Pennylane — couleurs deutan-friendly (jaune/bleu/gris, jamais rouge/vert)
// ============================================================================

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

const STATUS_ORDER = { accepted: 0, pending: 1, draft: 2, denied: 3, refused: 3, expired: 4 };

// ============================================================================
// Composant
// ============================================================================

export function LinkPennylaneQuoteModal({
  isOpen,
  onClose,
  chantierId,
  clientId,
  currentQuoteId,
  onLinked,
}) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { quotes, isLoading } = usePennylaneQuotes(clientId, orgId);
  const [linkingId, setLinkingId] = useState(null);

  const sortedQuotes = useMemo(() => {
    const list = quotes || [];
    return [...list].sort((a, b) => {
      const oa = STATUS_ORDER[a.status] ?? 99;
      const ob = STATUS_ORDER[b.status] ?? 99;
      if (oa !== ob) return oa - ob;
      return (b.date || '').localeCompare(a.date || '');
    });
  }, [quotes]);

  if (!isOpen) return null;

  const handleLink = async (quote) => {
    setLinkingId(quote.id);
    try {
      const { error } = await leadsService.updateLead(chantierId, {
        pennylane_quote_id: String(quote.id),
      });
      if (error) throw error;
      toast.success(`Devis ${quote.quote_number || `#${quote.id}`} lié au chantier`);
      onLinked?.(quote);
      onClose();
    } catch (e) {
      toast.error('Erreur lors de la liaison du devis');
      console.error('[LinkPennylaneQuoteModal] link error:', e);
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-8 pb-8">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-4rem)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3">
            <Link2 className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Lier un devis Pennylane
              </h2>
              <p className="text-xs text-gray-500">
                Sélectionnez le devis correspondant à ce chantier
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!clientId ? (
            <div className="text-center py-12">
              <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
              <p className="text-sm text-gray-700 font-medium">
                Aucun client lié à ce chantier
              </p>
              <p className="text-xs text-gray-500 mt-2 max-w-sm mx-auto">
                La liaison Pennylane nécessite une fiche client. Repassez le lead par le statut « Gagné » (drag-and-drop pipeline) pour déclencher la création automatique du client, ou liez-le manuellement.
              </p>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : sortedQuotes.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600 font-medium">
                Aucun devis Pennylane pour ce client
              </p>
              <p className="text-xs text-gray-400 mt-2 max-w-sm mx-auto">
                Le client doit être synchronisé avec Pennylane et avoir au moins un devis.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {sortedQuotes.map((quote) => {
                const isCurrent =
                  currentQuoteId != null && String(quote.id) === String(currentQuoteId);
                const isLinking = linkingId === quote.id;
                const cfg = getQuoteStatusConfig(quote.status);
                return (
                  <li key={quote.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 text-sm">
                            {quote.quote_number || `#${quote.id}`}
                          </span>
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ color: cfg.color, backgroundColor: cfg.bgColor }}
                          >
                            {cfg.label}
                          </span>
                          {isCurrent && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Lié actuellement
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                          {quote.date && <span>{formatDateShortFR(quote.date)}</span>}
                          {quote.subject && (
                            <span className="truncate max-w-md">{quote.subject}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-gray-900">
                          {quote.amount_ht != null
                            ? formatEuro(Number(quote.amount_ht))
                            : '—'}
                        </div>
                        {quote.pdf_url && (
                          <a
                            href={quote.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 mt-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            PDF
                          </a>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLink(quote)}
                        disabled={isCurrent || isLinking}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLinking ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Liaison...
                          </>
                        ) : isCurrent ? (
                          'Lié'
                        ) : (
                          'Lier'
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default LinkPennylaneQuoteModal;
