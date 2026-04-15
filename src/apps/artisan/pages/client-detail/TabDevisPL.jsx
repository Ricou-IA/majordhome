/**
 * TabDevisPL.jsx — Onglet Devis Pennylane sur la fiche client
 * ============================================================================
 * Affiche les devis Pennylane du client (fetch live via proxy).
 * Lecture seule — les devis sont gérés dans Pennylane.
 * ============================================================================
 */

import {
  FileText,
  ExternalLink,
  Loader2,
  AlertCircle,
  RefreshCw,
  FileDown,
} from 'lucide-react';
import { usePennylaneQuotes } from '@hooks/usePennylane';
import { formatEuro } from '@/lib/utils';

// =============================================================================
// STATUS CONFIG
// =============================================================================

// Mapping Pennylane → Majordhome : on simplifie pour le client
// pending/draft/expired → En attente | accepted/invoiced → Validé | denied/canceled → Refusé
const STATUS_CONFIG = {
  pending: {
    label: 'En attente',
    color: 'bg-amber-100 text-amber-700 border border-amber-200',
  },
  draft: {
    label: 'Brouillon',
    color: 'bg-gray-100 text-gray-500 border border-gray-200',
    hideSensitive: true,
  },
  expired: {
    label: 'En attente',
    color: 'bg-amber-100 text-amber-700 border border-amber-200',
  },
  accepted: {
    label: 'Validé',
    color: 'bg-green-100 text-green-700 border border-green-200',
  },
  invoiced: {
    label: 'Validé',
    color: 'bg-green-100 text-green-700 border border-green-200',
  },
  denied: {
    label: 'Refusé',
    color: 'bg-red-100 text-red-700 border border-red-200',
  },
  canceled: {
    label: 'Refusé',
    color: 'bg-red-100 text-red-700 border border-red-200',
  },
};

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || {
    label: status || 'Inconnu',
    color: 'bg-gray-100 text-gray-600 border border-gray-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${config.color}`}>
      {config.label}
    </span>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatAmount(str) {
  if (!str) return '—';
  const num = parseFloat(str);
  if (isNaN(num)) return str;
  return formatEuro(num);
}

// =============================================================================
// COMPOSANT PRINCIPAL
// =============================================================================

export function TabDevisPL({ clientId, orgId }) {
  const { quotes, isLoading, error, refetch } = usePennylaneQuotes(clientId, orgId);

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        <span className="ml-2 text-sm text-secondary-500">Chargement des devis Pennylane...</span>
      </div>
    );
  }

  // Erreur
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
        <p className="text-sm text-secondary-600">Erreur de chargement des devis Pennylane</p>
        <p className="text-xs text-secondary-400 mt-1">{error.message}</p>
        <button
          onClick={() => refetch()}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Réessayer
        </button>
      </div>
    );
  }

  // Vide
  if (!quotes.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="w-10 h-10 text-secondary-300 mb-3" />
        <p className="text-sm font-medium text-secondary-600">Aucun devis Pennylane</p>
        <p className="text-xs text-secondary-400 mt-1">Les devis apparaitront ici une fois créés dans Pennylane</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary-600" />
          <h3 className="text-sm font-semibold text-secondary-800">
            Devis Pennylane
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 text-primary-700">
              {quotes.length}
            </span>
          </h3>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-secondary-600 hover:text-secondary-800 hover:bg-secondary-100 rounded-lg transition-colors"
          title="Rafraichir"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tableau */}
      <div className="bg-white border border-secondary-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary-50 border-b border-secondary-200">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-secondary-500 uppercase">Numéro</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-secondary-500 uppercase">Date</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-secondary-500 uppercase">Objet</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-secondary-500 uppercase">HT</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-secondary-500 uppercase">TTC</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-secondary-500 uppercase">Statut</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-secondary-500 uppercase">PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {quotes.map((q) => {
              const statusConfig = STATUS_CONFIG[q.status] || {};
              const isDraft = statusConfig.hideSensitive;

              return (
                <tr key={q.id} className="hover:bg-secondary-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-secondary-700">
                    {q.quote_number || q.label || '—'}
                  </td>
                  <td className="px-4 py-3 text-secondary-600">
                    {formatDate(q.date)}
                  </td>
                  <td className="px-4 py-3 text-secondary-700 max-w-[200px] truncate" title={q.subject || q.label}>
                    {q.subject || q.label || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-secondary-800">
                    {isDraft ? '—' : formatAmount(q.amount_ht)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-secondary-800">
                    {isDraft ? '—' : formatAmount(q.amount_ttc)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    {!isDraft && q.pdf_url ? (
                      <a
                        href={q.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 transition-colors"
                        title="Voir le PDF"
                      >
                        <FileDown className="w-4 h-4" />
                      </a>
                    ) : (
                      <span className="text-secondary-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
