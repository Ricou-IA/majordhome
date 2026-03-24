/**
 * SectionDevis.jsx — Section "Devis fournisseurs" dans le LeadModal
 * ============================================================================
 * Affiche la liste des devis liés à un lead + bouton créer.
 * Wrappé dans un ErrorBoundary pour ne pas crasher le LeadModal entier.
 * ============================================================================
 */

import { Component } from 'react';
import { useDevisByLead } from '@/shared/hooks/useDevis';

import { formatEuro, formatDateFR } from '@/lib/utils';
import { FileText, Plus, ChevronRight, Loader2, Send } from 'lucide-react';

// Error boundary pour isoler les erreurs
class DevisErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[SectionDevis] Error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-xs text-red-500 bg-red-50 p-2 rounded mt-4">
          Erreur section devis : {this.state.error?.message || 'Erreur inconnue'}
        </div>
      );
    }
    return this.props.children;
  }
}

// Composant interne
function SectionDevisContent({ leadId, onCreateDevis, onOpenDevis, onSendDevis }) {
  const { quotes, isLoading, error } = useDevisByLead(leadId);
  const hasUnsent = quotes?.some((q) => q.status === 'brouillon');

  return (
    <>
      {error ? (
        <div className="text-xs text-red-500 bg-red-50 p-2 rounded mt-4">
          Erreur : {error?.message || JSON.stringify(error)}
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2 mt-2">
          {/* Devis existants */}
          {quotes.map((quote) => (
            <button
              key={quote.id}
              type="button"
              onClick={() => onOpenDevis(quote.id)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white
                         hover:border-blue-300 hover:bg-blue-50/50 transition-colors group text-left"
            >
              <FileText className="h-5 w-5 text-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-900 group-hover:text-blue-700">
                  {quote.quote_number}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-900 shrink-0">{formatEuro(quote.total_ttc)}</span>
              <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-blue-500 shrink-0" />
            </button>
          ))}

          {/* CTA envoyer le devis */}
          {hasUnsent && (
            <button
              type="button"
              onClick={onSendDevis}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white
                         bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" /> Envoyer le devis
            </button>
          )}

          {/* CTA ajouter */}
          <button
            type="button"
            onClick={onCreateDevis}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-blue-600
                       hover:text-blue-700 hover:bg-blue-50 rounded-lg border border-dashed border-blue-300 transition-colors"
          >
            <Plus className="w-4 h-4" /> Ajouter un devis
          </button>
        </div>
      )}
    </>
  );
}

// Export wrappé dans l'error boundary
export default function SectionDevis({ leadId, isEditing, onCreateDevis, onOpenDevis, onSendDevis }) {
  if (!isEditing) return null;

  return (
    <DevisErrorBoundary>
      <SectionDevisContent
        leadId={leadId}
        onCreateDevis={onCreateDevis}
        onOpenDevis={onOpenDevis}
        onSendDevis={onSendDevis}
      />
    </DevisErrorBoundary>
  );
}
