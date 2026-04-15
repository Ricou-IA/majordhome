/**
 * TabFacturesPL.jsx — Onglet Factures Pennylane sur la fiche client
 * ============================================================================
 * Affiche les factures Pennylane du client (fetch live via proxy).
 * Groupées par devis (quote_id) : en-tête devis + lignes factures.
 * Factures sans devis : affichées directement.
 * Lecture seule — les factures sont gérées dans Pennylane.
 * ============================================================================
 */

import { useState } from 'react';
import {
  Receipt,
  Loader2,
  AlertCircle,
  RefreshCw,
  FileDown,
  ChevronDown,
  ChevronRight,
  FileText,
} from 'lucide-react';
import { usePennylaneInvoices } from '@hooks/usePennylane';
import { formatEuro } from '@/lib/utils';

// =============================================================================
// STATUS CONFIG
// =============================================================================

const STATUS_CONFIG = {
  paid: {
    label: 'Payée',
    color: 'bg-green-100 text-green-700 border border-green-200',
  },
  pending: {
    label: 'En attente',
    color: 'bg-amber-100 text-amber-700 border border-amber-200',
  },
  partial: {
    label: 'Partielle',
    color: 'bg-blue-100 text-blue-700 border border-blue-200',
  },
  late: {
    label: 'Impayée',
    color: 'bg-red-100 text-red-700 border border-red-200',
  },
  unpaid: {
    label: 'Impayée',
    color: 'bg-red-100 text-red-700 border border-red-200',
  },
  draft: {
    label: 'Brouillon',
    color: 'bg-gray-100 text-gray-500 border border-gray-200',
    hideSensitive: true,
  },
  canceled: {
    label: 'Annulée',
    color: 'bg-gray-100 text-gray-500 border border-gray-200',
  },
};

function resolveStatus(invoice) {
  if (invoice.status === 'draft') return 'draft';
  if (invoice.status === 'canceled') return 'canceled';
  if (invoice.paid) return 'paid';
  if (invoice.status === 'late') return 'late';
  const ht = parseFloat(invoice.amount_ht) || 0;
  const remaining = parseFloat(invoice.remaining_amount) || 0;
  if (remaining > 0 && remaining < ht) return 'partial';
  if (!invoice.paid) return 'unpaid';
  return 'pending';
}

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
// GROUPEMENT PAR DEVIS
// =============================================================================

/**
 * Groupe les factures par quote_id.
 * Factures triées par date asc (acomptes d'abord, finale en dernier).
 * Factures sans quote_id restent en standalone.
 */
function groupInvoices(invoices) {
  const groups = new Map();
  const standalone = [];

  for (const inv of invoices) {
    if (!inv.quote_id) {
      standalone.push(inv);
      continue;
    }
    if (!groups.has(inv.quote_id)) {
      groups.set(inv.quote_id, { quote_id: inv.quote_id, quote_number: inv.quote_number, invoices: [] });
    }
    const group = groups.get(inv.quote_id);
    group.invoices.push(inv);
    // Garder le quote_number s'il est trouvé sur une des factures
    if (inv.quote_number && !group.quote_number) {
      group.quote_number = inv.quote_number;
    }
  }

  // Trier les factures dans chaque groupe par date asc (acomptes d'abord)
  for (const [, group] of groups) {
    group.invoices.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // Convertir en array et trier les groupes par date de la dernière facture desc
  const groupArray = [...groups.values()].sort((a, b) => {
    const lastA = a.invoices[a.invoices.length - 1]?.date || '';
    const lastB = b.invoices[b.invoices.length - 1]?.date || '';
    return lastB.localeCompare(lastA);
  });

  // Standalone triées par date desc
  standalone.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return { groups: groupArray, standalone };
}

// =============================================================================
// COMPOSANTS
// =============================================================================

function InvoiceRow({ inv, isDeposit = false }) {
  const displayStatus = resolveStatus(inv);
  const statusConfig = STATUS_CONFIG[displayStatus] || {};
  const isDraft = statusConfig.hideSensitive;

  return (
    <tr className={`hover:bg-secondary-50 transition-colors ${isDeposit ? 'bg-secondary-50/40' : ''}`}>
      <td className="px-4 py-2.5 pl-10 font-mono text-xs text-secondary-700">
        <span className="inline-flex items-center gap-1.5">
          {inv.invoice_number || '—'}
          {isDeposit && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-100 text-violet-600 border border-violet-200">
              Acompte
            </span>
          )}
        </span>
      </td>
      <td className="px-4 py-2.5 text-secondary-600">{formatDate(inv.date)}</td>
      <td className="px-4 py-2.5 text-secondary-700 max-w-[200px] truncate" title={inv.subject || inv.label}>
        {inv.subject || inv.label || '—'}
      </td>
      <td className="px-4 py-2.5 text-right font-medium text-secondary-800">
        {isDraft ? '—' : formatAmount(inv.amount_ht)}
      </td>
      <td className="px-4 py-2.5 text-right font-medium text-secondary-800">
        {isDraft ? '—' : formatAmount(inv.amount_ttc)}
      </td>
      <td className="px-4 py-2.5 text-center"><StatusBadge status={displayStatus} /></td>
      <td className="px-4 py-2.5 text-center">
        {!isDraft && inv.pdf_url ? (
          <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center text-primary-600 hover:text-primary-800 transition-colors" title="Voir le PDF">
            <FileDown className="w-4 h-4" />
          </a>
        ) : <span className="text-secondary-300">—</span>}
      </td>
    </tr>
  );
}

function QuoteGroup({ group, tableHeader }) {
  const [expanded, setExpanded] = useState(true);
  const invoiceCount = group.invoices.length;
  const isMulti = invoiceCount > 1;

  // Calcul du solde : TTC de la facture finale - somme TTC des acomptes payés
  let soldeRestant = null;
  if (isMulti) {
    const finale = group.invoices[invoiceCount - 1];
    const totalTTC = parseFloat(finale.amount_ttc) || 0;
    const acomptesPaids = group.invoices.slice(0, -1).reduce((sum, inv) => {
      return sum + (inv.paid ? (parseFloat(inv.amount_ttc) || 0) : 0);
    }, 0);
    soldeRestant = totalTTC - acomptesPaids;
  }

  return (
    <div className="bg-white border border-secondary-200 rounded-xl overflow-hidden">
      {/* En-tête commande */}
      <div className="px-4 py-2.5 bg-secondary-50 border-b border-secondary-200">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-xs font-medium text-secondary-700 hover:text-secondary-900 transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <FileText className="w-3.5 h-3.5 text-primary-500" />
            <span className="font-semibold">Commande {group.quote_number ? `Devis ${group.quote_number}` : '—'}</span>
            <span className="text-secondary-400 font-normal">
              — {invoiceCount} facture{invoiceCount > 1 ? 's' : ''}
            </span>
          </button>
          <div className="flex items-center gap-2">
            {soldeRestant !== null && soldeRestant > 0 && (
              <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                Solde à facturer : {formatEuro(soldeRestant)}
              </span>
            )}
            {soldeRestant !== null && soldeRestant <= 0 && (
              <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                Soldé
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Tableau des factures */}
      {expanded && (
        <table className="w-full text-sm">
          {tableHeader}
          <tbody className="divide-y divide-secondary-100">
            {group.invoices.map((inv, idx) => (
              <InvoiceRow
                key={inv.id}
                inv={inv}
                isDeposit={isMulti && idx < invoiceCount - 1}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// =============================================================================
// COMPOSANT PRINCIPAL
// =============================================================================

export function TabFacturesPL({ clientId, orgId }) {
  const { invoices, isLoading, error, refetch } = usePennylaneInvoices(clientId, orgId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        <span className="ml-2 text-sm text-secondary-500">Chargement des factures Pennylane...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
        <p className="text-sm text-secondary-600">Erreur de chargement des factures Pennylane</p>
        <p className="text-xs text-secondary-400 mt-1">{error.message}</p>
        <button onClick={() => refetch()}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg">
          <RefreshCw className="w-3.5 h-3.5" /> Réessayer
        </button>
      </div>
    );
  }

  if (!invoices.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Receipt className="w-10 h-10 text-secondary-300 mb-3" />
        <p className="text-sm font-medium text-secondary-600">Aucune facture Pennylane</p>
        <p className="text-xs text-secondary-400 mt-1">Les factures apparaitront ici une fois créées dans Pennylane</p>
      </div>
    );
  }

  const { groups, standalone } = groupInvoices(invoices);

  const tableHeader = (
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
  );

  return (
    <div className="space-y-4">
      {/* Header global */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-primary-600" />
          <h3 className="text-sm font-semibold text-secondary-800">
            Vos Factures
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 text-primary-700">
              {invoices.length}
            </span>
          </h3>
        </div>
        <button onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-secondary-600 hover:text-secondary-800 hover:bg-secondary-100 rounded-lg transition-colors"
          title="Rafraichir">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Un tableau par commande */}
      {groups.map((group) => (
        <QuoteGroup key={group.quote_id} group={group} tableHeader={tableHeader} />
      ))}

      {/* Factures sans devis */}
      {standalone.length > 0 && (
        <div className="bg-white border border-secondary-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            {tableHeader}
            <tbody className="divide-y divide-secondary-100">
              {standalone.map((inv) => (
                <InvoiceRow key={inv.id} inv={inv} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
