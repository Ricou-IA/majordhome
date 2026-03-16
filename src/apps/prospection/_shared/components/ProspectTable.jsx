/**
 * ProspectTable.jsx — Table de prospects réutilisable
 */

import { ArrowUpDown, TrendingUp, AlertTriangle, Loader2 } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

// Score badge colors (deutan-friendly: icône + label toujours)
function ScoreBadge({ score }) {
  if (score == null) return <span className="text-secondary-400">—</span>;

  let bgClass, textClass, icon;
  if (score >= 60) {
    bgClass = 'bg-emerald-100';
    textClass = 'text-emerald-700';
    icon = <TrendingUp className="w-3 h-3" />;
  } else if (score >= 30) {
    bgClass = 'bg-amber-100';
    textClass = 'text-amber-700';
    icon = <TrendingUp className="w-3 h-3" />;
  } else {
    bgClass = 'bg-red-100';
    textClass = 'text-red-700';
    icon = <AlertTriangle className="w-3 h-3" />;
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bgClass} ${textClass}`}>
      {icon}
      {score}
    </span>
  );
}

function StatusBadge({ statut, statuses }) {
  const config = statuses.find((s) => s.key === statut);
  if (!config) return <span className="text-secondary-400">{statut}</span>;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${config.color}20`, color: config.color }}
    >
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  );
}

function PrioriteBadge({ priorite }) {
  if (!priorite) return null;
  const isA = priorite === 'A';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${
      isA ? 'bg-[#F5C542]/20 text-[#B8860B]' : 'bg-secondary-200 text-secondary-600'
    }`}>
      {isA ? '★ A' : 'B'}
    </span>
  );
}

export default function ProspectTable({
  prospects,
  statuses,
  module,
  isLoading,
  onRowClick,
  onSort,
  sortField,
  sortAsc,
}) {
  const handleSort = (field) => {
    if (onSort) onSort(field);
  };

  const SortHeader = ({ field, children }) => (
    <th
      className="px-3 py-3 text-left text-xs font-semibold text-secondary-500 uppercase tracking-wider cursor-pointer hover:text-secondary-700 select-none"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className="w-3 h-3" />
      </span>
    </th>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-[#2196F3] animate-spin" />
        <span className="ml-2 text-sm text-secondary-500">Chargement...</span>
      </div>
    );
  }

  if (!prospects?.length) {
    return (
      <div className="text-center py-16 text-secondary-500">
        <p className="text-sm">Aucun prospect trouvé</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-secondary-200">
      <table className="w-full">
        <thead className="bg-secondary-50">
          <tr>
            <SortHeader field="raison_sociale">Entreprise</SortHeader>
            <SortHeader field="statut">Statut</SortHeader>
            <SortHeader field="score">Score</SortHeader>
            {module === 'cedants' && <th className="px-3 py-3 text-left text-xs font-semibold text-secondary-500 uppercase">Prio.</th>}
            <SortHeader field="departement">Dép.</SortHeader>
            <th className="px-3 py-3 text-left text-xs font-semibold text-secondary-500 uppercase">Dirigeant</th>
            <SortHeader field="ca_annuel">CA</SortHeader>
            <SortHeader field="created_at">Ajouté le</SortHeader>
          </tr>
        </thead>
        <tbody className="divide-y divide-secondary-100">
          {prospects.map((p) => (
            <tr
              key={p.id}
              onClick={() => onRowClick?.(p)}
              className="hover:bg-secondary-50 cursor-pointer transition-colors"
            >
              <td className="px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-secondary-900 truncate max-w-[200px]">{p.raison_sociale}</p>
                  <p className="text-xs text-secondary-400">{p.siren} · {p.naf || '—'}</p>
                </div>
              </td>
              <td className="px-3 py-3">
                <StatusBadge statut={p.statut} statuses={statuses} />
              </td>
              <td className="px-3 py-3">
                <ScoreBadge score={p.score} />
              </td>
              {module === 'cedants' && (
                <td className="px-3 py-3">
                  <PrioriteBadge priorite={p.priorite} />
                </td>
              )}
              <td className="px-3 py-3 text-sm text-secondary-600">{p.departement || '—'}</td>
              <td className="px-3 py-3">
                <p className="text-sm text-secondary-700 truncate max-w-[150px]">
                  {p.dirigeant_nom ? `${p.dirigeant_prenoms || ''} ${p.dirigeant_nom}`.trim() : '—'}
                </p>
              </td>
              <td className="px-3 py-3 text-sm text-secondary-600">
                {p.ca_annuel ? formatEuro(p.ca_annuel) : '—'}
              </td>
              <td className="px-3 py-3 text-sm text-secondary-500">
                {p.created_at ? formatDateShortFR(p.created_at) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
